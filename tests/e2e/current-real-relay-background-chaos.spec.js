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
const CYCLES = Math.max(12, Number(process.env.CP32_BACKGROUND_CHAOS_CYCLES || 36));
const BASE_SEED = Number(process.env.CP32_BACKGROUND_CHAOS_SEED || process.env.GITHUB_RUN_ID || 73421) >>> 0;

function makeRng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2));
}

async function launchClient(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cp32-chaos-${name}-`));
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
  });
  const page = context.pages()[0] || await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
  const cdp = await context.newCDPSession(page);
  return { name, context, page, cdp, errors, close: () => context.close() };
}

async function waitBattleRuntime(client, timeout = 60000) {
  await expect.poll(async () => client.page.evaluate(() => {
    const d = window.OnlineRuntime?.debug?.() || null;
    return [d?.state || null, d?.committed === true, d?.transport?.ready === true, d?.transport?.candidateBindingId || null];
  }), { timeout }).toEqual(['IN_BATTLE', true, true, null]);
  await expect(client.page.locator('#actions')).toBeVisible({ timeout });
}

async function enabledActionCount(client) {
  return client.page.locator(LEGAL).count();
}

async function currentActor(host, guest, timeout = 60000) {
  await expect.poll(async () => Number((await enabledActionCount(host)) > 0) + Number((await enabledActionCount(guest)) > 0), { timeout }).toBe(1);
  return (await enabledActionCount(host)) > 0 ? host : guest;
}

async function actConservatively(client) {
  const gather = client.page.locator('#actionButtons button:not([disabled]):visible').filter({ hasText: '에너지 모으기' }).first();
  const target = (await gather.count()) ? gather : client.page.locator(LEGAL).first();
  await expect(target).toBeVisible({ timeout: 30000 });
  await expect(target).toBeEnabled({ timeout: 30000 });
  await target.tap();
  await resolveInteraction(client.page);
}

async function setBackground(client, { frozen, offline }) {
  if (frozen) await client.cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  if (offline) await client.context.setOffline(true);
}

async function restoreForeground(client, { frozen, offline }) {
  if (offline) await client.context.setOffline(false);
  if (frozen) await client.cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await client.page.bringToFront();
}

async function convergedPlayable(host, guest, label, timeout = 75000) {
  let last = null;
  await expect.poll(async () => {
    const [hr, gr, h, g, ha, ga] = await Promise.all([
      runtimeSummary(host.page),
      runtimeSummary(guest.page),
      canonicalBattleState(host.page),
      canonicalBattleState(guest.page),
      enabledActionCount(host),
      enabledActionCount(guest),
    ]);
    last = { hr, gr, h, g, ha, ga };
    if (h.winner || g.winner) return false;
    const sameCanonical =
      h.matchId === g.matchId &&
      h.battleId === g.battleId &&
      h.revision === g.revision &&
      h.turnSerial === g.turnSerial &&
      h.actorTeam === g.actorTeam &&
      h.actorSlot === g.actorSlot &&
      h.P.hp === g.P.hp && h.A.hp === g.A.hp &&
      h.P.energy === g.P.energy && h.A.energy === g.A.energy;
    const stableRuntime =
      hr.runtime?.state === 'IN_BATTLE' && gr.runtime?.state === 'IN_BATTLE' &&
      hr.runtime?.committed === true && gr.runtime?.committed === true &&
      hr.runtime?.transport?.ready === true && gr.runtime?.transport?.ready === true &&
      !hr.runtime?.transport?.candidateBindingId && !gr.runtime?.transport?.candidateBindingId;
    const exactlyOnePlayable = Number(ha > 0) + Number(ga > 0) === 1;
    const locksReleased = h.locks.length === 0 && g.locks.length === 0;
    const pendingReleased = !h.pendingTransaction && !g.pendingTransaction && !h.admission?.pending && !g.admission?.pending;
    return sameCanonical && stableRuntime && exactlyOnePlayable && locksReleased && pendingReleased;
  }, { timeout, message: `${label} must converge to one playable actor after background restore` }).toBe(true);
  return last;
}

async function disturbSingle(client, rng) {
  const state = { frozen: rng() < 0.9, offline: rng() < 0.55 };
  await setBackground(client, state);
  await new Promise(r => setTimeout(r, 120 + Math.floor(rng() * 1300)));
  await restoreForeground(client, state);
  return { kind: 'single', client: client.name, ...state };
}

async function disturbBoth(host, guest, rng) {
  const hostState = { frozen: true, offline: rng() < 0.6 };
  const guestState = { frozen: true, offline: rng() < 0.6 };
  const firstDown = rng() < 0.5 ? host : guest;
  const secondDown = firstDown === host ? guest : host;
  const firstState = firstDown === host ? hostState : guestState;
  const secondState = secondDown === host ? hostState : guestState;
  await setBackground(firstDown, firstState);
  await new Promise(r => setTimeout(r, Math.floor(rng() * 120)));
  await setBackground(secondDown, secondState);
  await new Promise(r => setTimeout(r, 150 + Math.floor(rng() * 1500)));

  const simultaneous = rng() < 0.35;
  const firstUp = rng() < 0.5 ? host : guest;
  const secondUp = firstUp === host ? guest : host;
  const firstUpState = firstUp === host ? hostState : guestState;
  const secondUpState = secondUp === host ? hostState : guestState;
  if (simultaneous) {
    await Promise.all([restoreForeground(host, hostState), restoreForeground(guest, guestState)]);
  } else {
    await restoreForeground(firstUp, firstUpState);
    await new Promise(r => setTimeout(r, 30 + Math.floor(rng() * 550)));
    await restoreForeground(secondUp, secondUpState);
  }
  return {
    kind: simultaneous ? 'both-simultaneous-resume' : 'both-staggered-resume',
    firstDown: firstDown.name,
    firstUp: firstUp.name,
    host: hostState,
    guest: guestState,
  };
}

test('seeded randomized battle background chaos always returns to one playable canonical actor', async () => {
  test.setTimeout(540000);
  const seed = BASE_SEED;
  const rng = makeRng(seed);
  const host = await launchClient('chaos-host');
  const guest = await launchClient('chaos-guest');
  const trace = [];
  let cycle = -1;
  try {
    await Promise.all([host.page.goto(APP, { waitUntil: 'domcontentloaded' }), guest.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    await pairByRoomCode(host.page, guest.page);
    await selectFour(host.page); await waitRemoteCount(guest.page, 4);
    await selectFour(guest.page); await waitRemoteCount(host.page, 4);
    await startBattle(host.page, guest.page);
    await Promise.all([waitBattleRuntime(host), waitBattleRuntime(guest)]);
    await convergedPlayable(host, guest, 'initial');

    for (cycle = 0; cycle < CYCLES; cycle++) {
      if (cycle % 3 === 0) {
        const actor = await currentActor(host, guest);
        await actConservatively(actor);
        await Promise.all([waitBattleRuntime(host), waitBattleRuntime(guest)]);
        await convergedPlayable(host, guest, `cycle-${cycle}-post-action`);
      }

      const disturbance = rng() < 0.68
        ? await disturbBoth(host, guest, rng)
        : await disturbSingle(rng() < 0.5 ? host : guest, rng);

      await Promise.all([waitBattleRuntime(host), waitBattleRuntime(guest)]);
      const state = await convergedPlayable(host, guest, `cycle-${cycle}-restore`);
      trace.push({ cycle, disturbance, state });
    }

    expect(host.errors, 'host page/console errors').toEqual([]);
    expect(guest.errors, 'guest page/console errors').toEqual([]);
    write('background-chaos.json', { ok: true, seed, cycles: CYCLES, trace });
  } catch (error) {
    write('background-chaos.json', {
      ok: false,
      seed,
      cycles: CYCLES,
      failedCycle: cycle,
      error: String(error),
      trace,
      host: await runtimeSummary(host.page).catch(() => null),
      guest: await runtimeSummary(guest.page).catch(() => null),
      hostCanonical: await canonicalBattleState(host.page).catch(() => null),
      guestCanonical: await canonicalBattleState(guest.page).catch(() => null),
      hostErrors: host.errors,
      guestErrors: guest.errors,
    });
    throw error;
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});
