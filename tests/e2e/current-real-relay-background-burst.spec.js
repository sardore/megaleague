import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  pairByRoomCode,
  selectFour,
  waitRemoteCount,
  startBattle,
  resolveInteraction,
  canonicalBattleState,
  runtimeSummary,
} from '../helpers/player-path.js';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const OUT = process.env.CP32_REAL_RELAY_ARTIFACTS || 'artifacts/real-relay';
const LEGAL = '#actionButtons button:not([disabled]):visible, #actionButtons .skillbtn:not([disabled]):visible';
const SEED = (Number(process.env.CP32_BACKGROUND_BURST_SEED || process.env.GITHUB_RUN_ID || 91357) ^ 0x5bd1e995) >>> 0;
const GROUPS = Math.max(3, Number(process.env.CP32_BACKGROUND_BURST_GROUPS || 4));
const BURSTS_PER_GROUP = Math.max(6, Number(process.env.CP32_BACKGROUND_BURSTS_PER_GROUP || 8));

function rngFrom(seed) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2));
}

async function launch(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cp32-burst-${name}-`));
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
  });
  const page = context.pages()[0] || await context.newPage();
  const cover = await context.newPage();
  await cover.goto('about:blank');
  await page.bringToFront();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
  return { name, context, page, cover, cdp, errors, close: () => context.close() };
}

async function waitBattle(client, timeout = 75000) {
  await expect.poll(async () => client.page.evaluate(() => {
    const d = window.OnlineRuntime?.debug?.() || null;
    return [d?.state || null, d?.committed === true, d?.transport?.ready === true, d?.transport?.candidateBindingId || null];
  }), { timeout }).toEqual(['IN_BATTLE', true, true, null]);
  await expect(client.page.locator('#actions')).toBeVisible({ timeout });
}

async function enabled(client) { return client.page.locator(LEGAL).count(); }

async function surface(client) {
  return client.page.evaluate(() => {
    const runtime = window.OnlineRuntime?.debug?.() || null;
    const buttons = [...document.querySelectorAll('#actionButtons button, #actionButtons .skillbtn')].map((button, index) => ({
      index,
      text: String(button.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      disabled: !!button.disabled,
      ariaDisabled: button.getAttribute('aria-disabled'),
      connected: button.isConnected,
    }));
    return {
      visibility: document.visibilityState,
      inputLocked: document.documentElement.dataset.inputLocked || null,
      bodyClockLocked: document.body.classList.contains('time-input-locked'),
      buttons,
      runtime,
      recoveredErrors: (window.__megaRecoveredErrors || []).slice(-20),
    };
  });
}

async function convergePlayable(host, guest, label, timeout = 90000) {
  let last = null;
  await expect.poll(async () => {
    const [hr, gr, h, g, ha, ga] = await Promise.all([
      runtimeSummary(host.page), runtimeSummary(guest.page),
      canonicalBattleState(host.page), canonicalBattleState(guest.page),
      enabled(host), enabled(guest),
    ]);
    last = { hr, gr, h, g, ha, ga };
    if (h.winner || g.winner) return false;
    const canonical = h.matchId === g.matchId && h.battleId === g.battleId &&
      h.revision === g.revision && h.turnSerial === g.turnSerial &&
      h.actorTeam === g.actorTeam && h.actorSlot === g.actorSlot &&
      h.P.hp === g.P.hp && h.A.hp === g.A.hp && h.P.energy === g.P.energy && h.A.energy === g.A.energy;
    const runtime = hr.runtime?.state === 'IN_BATTLE' && gr.runtime?.state === 'IN_BATTLE' &&
      hr.runtime?.committed === true && gr.runtime?.committed === true &&
      hr.runtime?.transport?.ready === true && gr.runtime?.transport?.ready === true &&
      !hr.runtime?.transport?.candidateBindingId && !gr.runtime?.transport?.candidateBindingId;
    const noLocks = h.locks.length === 0 && g.locks.length === 0;
    const noPending = !h.pendingTransaction && !g.pendingTransaction && !h.admission?.pending && !g.admission?.pending;
    const onePlayable = Number(ha > 0) + Number(ga > 0) === 1;
    return canonical && runtime && noLocks && noPending && onePlayable;
  }, { timeout, message: `${label}: simultaneous background burst must restore exactly one playable actor` }).toBe(true);
  return last;
}

async function actor(host, guest) {
  await expect.poll(async () => Number((await enabled(host)) > 0) + Number((await enabled(guest)) > 0), { timeout: 45000 }).toBe(1);
  return (await enabled(host)) > 0 ? host : guest;
}

async function act(client) {
  const gather = client.page.locator('#actionButtons button:not([disabled]):visible').filter({ hasText: '에너지 모으기' }).first();
  const button = (await gather.count()) ? gather : client.page.locator(LEGAL).first();
  await expect(button).toBeVisible({ timeout: 30000 });
  await expect(button).toBeEnabled({ timeout: 30000 });
  await button.tap();
  await resolveInteraction(client.page);
}

async function background(client, state) {
  // Bringing a second tab to the front exercises the browser visibility path that a real app/tab switch uses.
  await client.cover.bringToFront();
  if (state.frozen) await client.cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  if (state.offline) await client.context.setOffline(true);
}

async function foreground(client, state) {
  if (state.offline) await client.context.setOffline(false);
  if (state.frozen) await client.cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await client.page.bringToFront();
}

async function dualBurst(host, guest, random, burstIndex) {
  const hostState = { frozen: random() < 0.92, offline: random() < 0.22 };
  const guestState = { frozen: random() < 0.92, offline: random() < 0.22 };
  const firstDown = random() < 0.5 ? host : guest;
  const secondDown = firstDown === host ? guest : host;
  const firstDownState = firstDown === host ? hostState : guestState;
  const secondDownState = secondDown === host ? hostState : guestState;
  await background(firstDown, firstDownState);
  await sleep(Math.floor(random() * 75));
  await background(secondDown, secondDownState);
  await sleep(35 + Math.floor(random() * 260));

  const simultaneousUp = random() < 0.38;
  const firstUp = random() < 0.5 ? host : guest;
  const secondUp = firstUp === host ? guest : host;
  if (simultaneousUp) {
    await Promise.all([foreground(host, hostState), foreground(guest, guestState)]);
  } else {
    await foreground(firstUp, firstUp === host ? hostState : guestState);
    await sleep(15 + Math.floor(random() * 180));
    await foreground(secondUp, secondUp === host ? hostState : guestState);
  }

  // Deliberately do not wait for restore to settle. The next burst can interrupt an in-flight restore,
  // matching rapid real-device app switching rather than the old settle-between-every-cycle tests.
  await sleep(15 + Math.floor(random() * 220));
  return {
    burstIndex,
    firstDown: firstDown.name,
    firstUp: firstUp.name,
    simultaneousUp,
    hostState,
    guestState,
  };
}

test('rapid overlapping dual-background bursts cannot leave the current actor greyed out', async () => {
  test.setTimeout(720000);
  const random = rngFrom(SEED);
  const host = await launch('burst-host');
  const guest = await launch('burst-guest');
  const trace = [];
  let group = -1;
  try {
    await Promise.all([host.page.goto(APP, { waitUntil: 'domcontentloaded' }), guest.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    await pairByRoomCode(host.page, guest.page);
    await selectFour(host.page); await waitRemoteCount(guest.page, 4);
    await selectFour(guest.page); await waitRemoteCount(host.page, 4);
    await startBattle(host.page, guest.page);
    await Promise.all([waitBattle(host), waitBattle(guest)]);
    await convergePlayable(host, guest, 'initial');

    for (group = 0; group < GROUPS; group++) {
      const beforeActor = await actor(host, guest);
      await act(beforeActor);
      await Promise.all([waitBattle(host), waitBattle(guest)]);
      await convergePlayable(host, guest, `group-${group}-pre-burst`);

      const bursts = [];
      for (let i = 0; i < BURSTS_PER_GROUP; i++) bursts.push(await dualBurst(host, guest, random, i));

      const after = await convergePlayable(host, guest, `group-${group}-post-burst`);
      trace.push({ group, bursts, after, hostSurface: await surface(host), guestSurface: await surface(guest) });
    }

    expect(host.errors, 'host page/console errors').toEqual([]);
    expect(guest.errors, 'guest page/console errors').toEqual([]);
    write('background-burst.json', { ok: true, seed: SEED, groups: GROUPS, burstsPerGroup: BURSTS_PER_GROUP, trace });
  } catch (error) {
    write('background-burst.json', {
      ok: false,
      seed: SEED,
      groups: GROUPS,
      burstsPerGroup: BURSTS_PER_GROUP,
      failedGroup: group,
      error: String(error),
      trace,
      host: await runtimeSummary(host.page).catch(() => null),
      guest: await runtimeSummary(guest.page).catch(() => null),
      hostCanonical: await canonicalBattleState(host.page).catch(() => null),
      guestCanonical: await canonicalBattleState(guest.page).catch(() => null),
      hostSurface: await surface(host).catch(() => null),
      guestSurface: await surface(guest).catch(() => null),
      hostErrors: host.errors,
      guestErrors: guest.errors,
    });
    throw error;
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});
