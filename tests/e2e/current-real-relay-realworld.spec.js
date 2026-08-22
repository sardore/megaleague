import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  pairByRoomCode,
  selectFour,
  waitRemoteCount,
  startBattle,
  runtimeSummary,
  resolveInteraction,
  openAutoMatch,
  waitForLobby,
} from '../helpers/player-path.js';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const OUT = process.env.CP32_REAL_RELAY_ARTIFACTS || 'artifacts/real-relay';
const LEGAL_ACTION = '#actionButtons button:not([disabled]):visible, #actionButtons .skillbtn:not([disabled]):visible';

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2));
}

async function launchClient(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cp32-realworld-${name}-`));
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
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  const cdp = await context.newCDPSession(page);
  return { name, context, page, cdp, errors, async close() { await context.close(); } };
}

async function setLifecycle(client, state) {
  await client.cdp.send('Page.setWebLifecycleState', { state });
}

async function setOfflineFrozen(client, offline) {
  if (offline) {
    await setLifecycle(client, 'frozen');
    await client.context.setOffline(true);
  } else {
    await client.context.setOffline(false);
    await setLifecycle(client, 'active');
    await client.page.bringToFront();
  }
}

async function waitCommitted(page, state = 'LOBBY', timeout = 45000) {
  await expect.poll(async () => {
    const d = await page.evaluate(() => window.OnlineRuntime?.debug?.() || null);
    return {
      state: d?.state || null,
      committed: d?.committed === true,
      ready: d?.transport?.ready === true,
      candidate: d?.transport?.candidateBindingId || null,
    };
  }, { timeout }).toEqual({ state, committed: true, ready: true, candidate: null });
}

async function waitBattleReady(page, timeout = 45000) {
  await waitCommitted(page, 'IN_BATTLE', timeout);
  await expect(page.locator('#actions')).toBeVisible({ timeout });
}

async function assertFixedPoint(page, label, settleMs = 850) {
  const before = await page.evaluate(() => {
    const d = window.OnlineRuntime?.debug?.() || null;
    return {
      at: Date.now(),
      state: d?.state || null,
      ready: d?.transport?.ready === true,
      binding: d?.transport?.activeBindingId || null,
      candidate: d?.transport?.candidateBindingId || null,
    };
  });
  expect(before.state, `${label}: state`).toBe('IN_BATTLE');
  expect(before.ready, `${label}: ready`).toBe(true);
  expect(before.candidate, `${label}: candidate`).toBeNull();
  await page.waitForTimeout(settleMs);
  const after = await page.evaluate(since => {
    const d = window.OnlineRuntime?.debug?.() || null;
    const trace = Array.isArray(d?.transport?.recoveryTrace) ? d.transport.recoveryTrace : [];
    return {
      state: d?.state || null,
      ready: d?.transport?.ready === true,
      binding: d?.transport?.activeBindingId || null,
      candidate: d?.transport?.candidateBindingId || null,
      churn: trace.filter(entry => Number(entry?.at || 0) >= since && [
        'restore-request',
        'authoritative-resync-requested',
        'reconnect-scheduled',
      ].includes(String(entry?.stage || ''))),
    };
  }, before.at);
  expect(after.state, `${label}: state after settle`).toBe('IN_BATTLE');
  expect(after.ready, `${label}: ready after settle`).toBe(true);
  expect(after.candidate, `${label}: no candidate after settle`).toBeNull();
  expect(after.binding, `${label}: active binding must stabilize`).toBe(before.binding);
  expect(after.churn, `${label}: restore feedback must stop`).toEqual([]);
}

async function selectedCount(page) {
  return page.locator('#onlineRoomDeck .online-room-card.selected').count();
}

async function selectNext(page) {
  const before = await selectedCount(page);
  const card = page.locator('#onlineRoomDeck .online-room-card:not(.selected)').first();
  await expect(card).toBeVisible({ timeout: 30000 });
  const box = await card.boundingBox();
  if (!box) throw new Error('ONLINE_CARD_DETACHED');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + Math.min(30, box.height / 2));
  await expect.poll(() => selectedCount(page), { timeout: 15000 }).toBe(before + 1);
}

async function selectN(page, count) {
  for (let i = 0; i < count; i++) await selectNext(page);
}

async function visibleActionCount(page) {
  return page.locator(LEGAL_ACTION).count();
}

async function currentActor(a, b) {
  await expect.poll(async () => Number((await visibleActionCount(a.page)) > 0) + Number((await visibleActionCount(b.page)) > 0), {
    timeout: 45000,
    message: 'exactly one peer must own the legal action surface',
  }).toBe(1);
  return (await visibleActionCount(a.page)) > 0 ? a : b;
}

async function actOnce(page) {
  const gather = page.locator('#actionButtons button:not([disabled]):visible').filter({ hasText: '에너지 모으기' }).first();
  const target = (await gather.count()) ? gather : page.locator(LEGAL_ACTION).first();
  await expect(target).toBeVisible({ timeout: 30000 });
  await expect(target).toBeEnabled();
  await target.tap();
  await resolveInteraction(page);
}

async function waitAnyStartEnabled(host, guest) {
  await expect.poll(async () => {
    const [h, g] = await Promise.all([
      host.locator('#onlineRoomStart').isEnabled().catch(() => false),
      guest.locator('#onlineRoomStart').isEnabled().catch(() => false),
    ]);
    return Number(h) + Number(g);
  }, { timeout: 30000, message: 'at least one canonical start control must become enabled' }).toBeGreaterThan(0);
}

async function closeToSetup(client) {
  const close = client.page.locator('#closeModal');
  await expect(close).toBeVisible({ timeout: 30000 });
  await close.tap();
  await expect.poll(async () => client.page.evaluate(() => {
    const setup = document.getElementById('setup');
    const modal = document.getElementById('modal');
    const s = setup ? getComputedStyle(setup) : null;
    const r = setup?.getBoundingClientRect();
    return {
      state: window.OnlineRuntime?.debug?.()?.state || null,
      modalOpen: !!modal?.classList.contains('open'),
      setupActive: !!setup?.classList.contains('active'),
      setupVisible: !!setup && s?.display !== 'none' && s?.visibility !== 'hidden' && !!r && r.width > 0 && r.height > 0,
    };
  }), { timeout: 30000 }).toEqual({ state: 'IDLE', modalOpen: false, setupActive: true, setupVisible: true });
}

async function assertSameMatch(host, guest) {
  const [h, g] = await Promise.all([runtimeSummary(host.page), runtimeSummary(guest.page)]);
  expect(h.runtime?.matchId).toBeTruthy();
  expect(g.runtime?.matchId).toBe(h.runtime?.matchId);
  return { host: h, guest: g };
}

test('lobby final selections made while the peer is backgrounded recover from 3/4 to a usable 4/4 start', async () => {
  test.setTimeout(180000);
  const host = await launchClient('lobby-gap-host');
  const guest = await launchClient('lobby-gap-guest');
  try {
    await Promise.all([host.page.goto(APP, { waitUntil: 'domcontentloaded' }), guest.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    const roomCode = await pairByRoomCode(host.page, guest.page);
    await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);

    await selectN(host.page, 3);
    await waitRemoteCount(guest.page, 3);
    await setOfflineFrozen(guest, true);
    await selectNext(host.page);
    expect(await selectedCount(host.page)).toBe(4);
    await host.page.waitForTimeout(750);
    await setOfflineFrozen(guest, false);
    await waitCommitted(guest.page);
    await waitRemoteCount(guest.page, 4);

    await selectN(guest.page, 3);
    await waitRemoteCount(host.page, 3);
    await setOfflineFrozen(host, true);
    await selectNext(guest.page);
    expect(await selectedCount(guest.page)).toBe(4);
    await guest.page.waitForTimeout(750);
    await setOfflineFrozen(host, false);
    await waitCommitted(host.page);
    await waitRemoteCount(host.page, 4);
    await waitRemoteCount(guest.page, 4);

    await waitAnyStartEnabled(host.page, guest.page);
    await startBattle(host.page, guest.page);
    await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
    const summary = await assertSameMatch(host, guest);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    write('realworld-lobby-3of4.json', { ok: true, roomCode, summary });
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});

test('foreground action committed while the peer misses the signal in background converges after restore', async () => {
  test.setTimeout(180000);
  const host = await launchClient('missed-action-host');
  const guest = await launchClient('missed-action-guest');
  try {
    await Promise.all([host.page.goto(APP, { waitUntil: 'domcontentloaded' }), guest.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    await pairByRoomCode(host.page, guest.page);
    await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);
    await selectFour(host.page);
    await waitRemoteCount(guest.page, 4);
    await selectFour(guest.page);
    await waitRemoteCount(host.page, 4);
    await startBattle(host.page, guest.page);
    await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);

    const actor = await currentActor(host, guest);
    const backgrounded = actor === host ? guest : host;
    await setOfflineFrozen(backgrounded, true);
    await actOnce(actor.page);
    await actor.page.waitForTimeout(1000);
    await setOfflineFrozen(backgrounded, false);

    await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
    await Promise.all([
      assertFixedPoint(host.page, 'missed-action-host'),
      assertFixedPoint(guest.page, 'missed-action-guest'),
    ]);
    const summary = await assertSameMatch(host, guest);
    await currentActor(host, guest);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    write('realworld-missed-action.json', { ok: true, actor: actor.name, backgrounded: backgrounded.name, summary });
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});

test('both lobby clients can be backgrounded together and staggered back without stale deck counts', async () => {
  test.setTimeout(180000);
  const host = await launchClient('both-bg-host');
  const guest = await launchClient('both-bg-guest');
  try {
    await Promise.all([host.page.goto(APP, { waitUntil: 'domcontentloaded' }), guest.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    await pairByRoomCode(host.page, guest.page);
    await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);
    await selectN(host.page, 2);
    await waitRemoteCount(guest.page, 2);
    await selectN(guest.page, 2);
    await waitRemoteCount(host.page, 2);

    await Promise.all([setOfflineFrozen(host, true), setOfflineFrozen(guest, true)]);
    await new Promise(resolve => setTimeout(resolve, 900));
    await setOfflineFrozen(guest, false);
    await guest.page.waitForTimeout(700);
    await setOfflineFrozen(host, false);
    await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);
    await Promise.all([waitRemoteCount(host.page, 2), waitRemoteCount(guest.page, 2)]);

    await selectN(host.page, 2);
    await waitRemoteCount(guest.page, 4);
    await selectN(guest.page, 2);
    await waitRemoteCount(host.page, 4);
    await waitAnyStartEnabled(host.page, guest.page);
    await startBattle(host.page, guest.page);
    await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
    await assertSameMatch(host, guest);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});

test('battle survives repeated transport-only drops without lifecycle freezing or restore feedback loops', async () => {
  test.setTimeout(240000);
  const host = await launchClient('transport-host');
  const guest = await launchClient('transport-guest');
  try {
    await Promise.all([host.page.goto(APP, { waitUntil: 'domcontentloaded' }), guest.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    await pairByRoomCode(host.page, guest.page);
    await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);
    await selectFour(host.page);
    await waitRemoteCount(guest.page, 4);
    await selectFour(guest.page);
    await waitRemoteCount(host.page, 4);
    await startBattle(host.page, guest.page);
    await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);

    for (let cycle = 0; cycle < 5; cycle++) {
      const actor = await currentActor(host, guest);
      await actOnce(actor.page);
      const dropped = cycle % 2 === 0 ? guest : host;
      await dropped.context.setOffline(true);
      await (dropped === guest ? host.page : guest.page).waitForTimeout(450 + cycle * 90);
      await dropped.context.setOffline(false);
      await dropped.page.bringToFront();
      await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
      await Promise.all([
        assertFixedPoint(host.page, `transport-${cycle}-host`),
        assertFixedPoint(guest.page, `transport-${cycle}-guest`),
      ]);
      await assertSameMatch(host, guest);
    }
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});

test('closing an online room tears down ownership so the same clients can create and start a fresh room', async () => {
  test.setTimeout(180000);
  const host = await launchClient('reentry-host');
  const guest = await launchClient('reentry-guest');
  try {
    await Promise.all([host.page.goto(APP, { waitUntil: 'domcontentloaded' }), guest.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    const firstRoom = await pairByRoomCode(host.page, guest.page);
    await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);
    await selectNext(host.page);
    await waitRemoteCount(guest.page, 1);

    await closeToSetup(guest);
    await closeToSetup(host);

    const secondRoom = await pairByRoomCode(host.page, guest.page);
    await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);
    await selectFour(host.page);
    await waitRemoteCount(guest.page, 4);
    await selectFour(guest.page);
    await waitRemoteCount(host.page, 4);
    await startBattle(host.page, guest.page);
    await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
    const summary = await assertSameMatch(host, guest);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    write('realworld-close-reentry.json', { ok: true, firstRoom, secondRoom, summary });
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});

test('two real mobile clients entering automatic matchmaking reach the canonical room lobby', async () => {
  test.setTimeout(120000);
  const a = await launchClient('auto-a');
  const b = await launchClient('auto-b');
  try {
    await Promise.all([a.page.goto(APP, { waitUntil: 'domcontentloaded' }), b.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    await Promise.all([openAutoMatch(a.page), openAutoMatch(b.page)]);
    await Promise.all([waitForLobby(a.page), waitForLobby(b.page)]);
    await Promise.all([waitCommitted(a.page), waitCommitted(b.page)]);
    await selectFour(a.page);
    await waitRemoteCount(b.page, 4);
    await selectFour(b.page);
    await waitRemoteCount(a.page, 4);
    await waitAnyStartEnabled(a.page, b.page);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  } catch (error) {
    const diagnostics = await Promise.all([a, b].map(async client => ({
      name: client.name,
      error: String(error),
      runtime: await runtimeSummary(client.page).catch(() => null),
      visibleButtons: await client.page.locator('button:visible').evaluateAll(buttons => buttons.map(button => ({ id: button.id, text: (button.textContent || '').trim(), disabled: button.disabled })).slice(0, 80)).catch(() => []),
      errors: client.errors,
    }))));
    write('realworld-automatch-failure.json', diagnostics);
    throw error;
  } finally {
    await Promise.allSettled([a.close(), b.close()]);
  }
});
