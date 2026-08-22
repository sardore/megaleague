import { test, expect, chromium } from '@playwright/test';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  pairByRoomCode, selectFour, waitRemoteCount, startBattle,
  runtimeSummary, resolveInteraction, openAutoMatch, waitForLobby,
} from '../helpers/player-path.js';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const OUT = process.env.CP32_REAL_RELAY_ARTIFACTS || 'artifacts/real-relay';
const LEGAL = '#actionButtons button:not([disabled]):visible, #actionButtons .skillbtn:not([disabled]):visible';

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2));
}

async function client(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cp32-real-${name}-`));
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

async function freeze(c, yes) {
  if (yes) {
    await c.cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await c.context.setOffline(true);
  } else {
    await c.context.setOffline(false);
    await c.cdp.send('Page.setWebLifecycleState', { state: 'active' });
    await c.page.bringToFront();
  }
}

async function ready(page, state = 'LOBBY', timeout = 45000) {
  await expect.poll(async () => {
    const d = await page.evaluate(() => window.OnlineRuntime?.debug?.() || null);
    return [d?.state || null, d?.committed === true, d?.transport?.ready === true, d?.transport?.candidateBindingId || null];
  }, { timeout }).toEqual([state, true, true, null]);
}

async function battleReady(page) {
  await ready(page, 'IN_BATTLE');
  await expect(page.locator('#actions')).toBeVisible({ timeout: 45000 });
}

async function fixed(page, label) {
  const before = await page.evaluate(() => {
    const d = window.OnlineRuntime?.debug?.() || null;
    return { at: Date.now(), binding: d?.transport?.activeBindingId || null };
  });
  await page.waitForTimeout(900);
  const after = await page.evaluate(since => {
    const d = window.OnlineRuntime?.debug?.() || null;
    const trace = Array.isArray(d?.transport?.recoveryTrace) ? d.transport.recoveryTrace : [];
    return {
      state: d?.state || null,
      ready: d?.transport?.ready === true,
      binding: d?.transport?.activeBindingId || null,
      candidate: d?.transport?.candidateBindingId || null,
      newWork: trace.filter(x => Number(x?.at || 0) >= since && ['restore-request','authoritative-resync-requested','reconnect-scheduled'].includes(String(x?.stage || ''))),
    };
  }, before.at);
  expect(after.state, `${label} state`).toBe('IN_BATTLE');
  expect(after.ready, `${label} ready`).toBe(true);
  expect(after.candidate, `${label} candidate`).toBeNull();
  expect(after.binding, `${label} binding`).toBe(before.binding);
  expect(after.newWork, `${label} restore churn`).toEqual([]);
}

async function selected(page) {
  return page.locator('#onlineRoomDeck .online-room-card.selected').count();
}

async function selectNext(page) {
  const before = await selected(page);
  const card = page.locator('#onlineRoomDeck .online-room-card:not(.selected)').first();
  await expect(card).toBeVisible({ timeout: 30000 });
  const b = await card.boundingBox();
  if (!b) throw new Error('CARD_DETACHED');
  await page.touchscreen.tap(b.x + b.width / 2, b.y + Math.min(30, b.height / 2));
  await expect.poll(() => selected(page), { timeout: 15000 }).toBe(before + 1);
}

async function selectN(page, n) { for (let i = 0; i < n; i++) await selectNext(page); }
async function actionCount(page) { return page.locator(LEGAL).count(); }

async function actor(a, b) {
  await expect.poll(async () => Number((await actionCount(a.page)) > 0) + Number((await actionCount(b.page)) > 0), { timeout: 45000 }).toBe(1);
  return (await actionCount(a.page)) > 0 ? a : b;
}

async function act(page) {
  const gather = page.locator('#actionButtons button:not([disabled]):visible').filter({ hasText: '에너지 모으기' }).first();
  const target = (await gather.count()) ? gather : page.locator(LEGAL).first();
  await expect(target).toBeVisible({ timeout: 30000 });
  await target.tap();
  await resolveInteraction(page);
}

async function sameMatch(a, b) {
  const [x, y] = await Promise.all([runtimeSummary(a.page), runtimeSummary(b.page)]);
  expect(x.runtime?.matchId).toBeTruthy();
  expect(y.runtime?.matchId).toBe(x.runtime?.matchId);
}

async function startEnabled(a, b) {
  await expect.poll(async () => Number(await a.locator('#onlineRoomStart').isEnabled().catch(() => false)) + Number(await b.locator('#onlineRoomStart').isEnabled().catch(() => false)), { timeout: 30000 }).toBeGreaterThan(0);
}

async function closeSetup(c) {
  await c.page.locator('#closeModal').tap();
  await expect.poll(async () => c.page.evaluate(() => {
    const setup = document.getElementById('setup');
    const modal = document.getElementById('modal');
    return [window.OnlineRuntime?.debug?.()?.state || null, !!setup?.classList.contains('active'), !!modal?.classList.contains('open')];
  }), { timeout: 30000 }).toEqual(['IDLE', true, false]);
}

async function setupPair(a, b) {
  await Promise.all([a.page.goto(APP, { waitUntil: 'domcontentloaded' }), b.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
  await pairByRoomCode(a.page, b.page);
  await Promise.all([ready(a.page), ready(b.page)]);
}

async function setupBattle(a, b) {
  await setupPair(a, b);
  await selectFour(a.page); await waitRemoteCount(b.page, 4);
  await selectFour(b.page); await waitRemoteCount(a.page, 4);
  await startBattle(a.page, b.page);
  await Promise.all([battleReady(a.page), battleReady(b.page)]);
}

test('3/4 stale lobby recovers when each final selection is made while the peer is backgrounded', async () => {
  test.setTimeout(180000);
  const a = await client('3of4-a'), b = await client('3of4-b');
  try {
    await setupPair(a, b);
    await selectN(a.page, 3); await waitRemoteCount(b.page, 3);
    await freeze(b, true); await selectNext(a.page); await freeze(b, false);
    await ready(b.page); await waitRemoteCount(b.page, 4);
    await selectN(b.page, 3); await waitRemoteCount(a.page, 3);
    await freeze(a, true); await selectNext(b.page); await freeze(a, false);
    await ready(a.page); await Promise.all([waitRemoteCount(a.page, 4), waitRemoteCount(b.page, 4)]);
    await startEnabled(a.page, b.page);
    await startBattle(a.page, b.page);
    await Promise.all([battleReady(a.page), battleReady(b.page)]);
    await sameMatch(a, b);
    expect(a.errors).toEqual([]); expect(b.errors).toEqual([]);
  } finally { await Promise.allSettled([a.close(), b.close()]); }
});

test('peer missing a foreground committed battle action converges after background restore', async () => {
  test.setTimeout(180000);
  const a = await client('miss-a'), b = await client('miss-b');
  try {
    await setupBattle(a, b);
    const current = await actor(a, b); const peer = current === a ? b : a;
    await freeze(peer, true); await act(current.page); await current.page.waitForTimeout(900); await freeze(peer, false);
    await Promise.all([battleReady(a.page), battleReady(b.page)]);
    await Promise.all([fixed(a.page, 'miss-a'), fixed(b.page, 'miss-b')]);
    await sameMatch(a, b); await actor(a, b);
    expect(a.errors).toEqual([]); expect(b.errors).toEqual([]);
  } finally { await Promise.allSettled([a.close(), b.close()]); }
});

test('both lobby peers can freeze together then stagger resume without stale deck state', async () => {
  test.setTimeout(180000);
  const a = await client('both-a'), b = await client('both-b');
  try {
    await setupPair(a, b);
    await selectN(a.page, 2); await waitRemoteCount(b.page, 2);
    await selectN(b.page, 2); await waitRemoteCount(a.page, 2);
    await Promise.all([freeze(a, true), freeze(b, true)]);
    await new Promise(r => setTimeout(r, 800));
    await freeze(b, false); await b.page.waitForTimeout(500); await freeze(a, false);
    await Promise.all([ready(a.page), ready(b.page)]);
    await Promise.all([waitRemoteCount(a.page, 2), waitRemoteCount(b.page, 2)]);
    await selectN(a.page, 2); await waitRemoteCount(b.page, 4);
    await selectN(b.page, 2); await waitRemoteCount(a.page, 4);
    await startBattle(a.page, b.page); await Promise.all([battleReady(a.page), battleReady(b.page)]);
    await sameMatch(a, b);
  } finally { await Promise.allSettled([a.close(), b.close()]); }
});

test('battle survives repeated transport-only disconnects with no lifecycle freeze', async () => {
  test.setTimeout(240000);
  const a = await client('net-a'), b = await client('net-b');
  try {
    await setupBattle(a, b);
    for (let i = 0; i < 4; i++) {
      const current = await actor(a, b); await act(current.page);
      const drop = i % 2 ? a : b; await drop.context.setOffline(true);
      await (drop === a ? b.page : a.page).waitForTimeout(500 + 100 * i);
      await drop.context.setOffline(false); await drop.page.bringToFront();
      await Promise.all([battleReady(a.page), battleReady(b.page)]);
      await Promise.all([fixed(a.page, `net-a-${i}`), fixed(b.page, `net-b-${i}`)]);
      await sameMatch(a, b);
    }
  } finally { await Promise.allSettled([a.close(), b.close()]); }
});

test('close teardown allows the same clients to pair again and start a fresh room', async () => {
  test.setTimeout(180000);
  const a = await client('re-a'), b = await client('re-b');
  try {
    await setupPair(a, b); await selectNext(a.page); await waitRemoteCount(b.page, 1);
    await closeSetup(b); await closeSetup(a);
    await pairByRoomCode(a.page, b.page); await Promise.all([ready(a.page), ready(b.page)]);
    await selectFour(a.page); await waitRemoteCount(b.page, 4);
    await selectFour(b.page); await waitRemoteCount(a.page, 4);
    await startBattle(a.page, b.page); await Promise.all([battleReady(a.page), battleReady(b.page)]);
    await sameMatch(a, b);
  } finally { await Promise.allSettled([a.close(), b.close()]); }
});

test('automatic matchmaking pairs two real mobile clients into the canonical lobby', async () => {
  test.setTimeout(120000);
  const a = await client('auto-a'), b = await client('auto-b');
  try {
    await Promise.all([a.page.goto(APP, { waitUntil: 'domcontentloaded' }), b.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    await Promise.all([openAutoMatch(a.page), openAutoMatch(b.page)]);
    await Promise.all([waitForLobby(a.page), waitForLobby(b.page)]);
    await Promise.all([ready(a.page), ready(b.page)]);
    write('realworld-automatch.json', { a: await runtimeSummary(a.page), b: await runtimeSummary(b.page) });
    expect(a.errors).toEqual([]); expect(b.errors).toEqual([]);
  } finally { await Promise.allSettled([a.close(), b.close()]); }
});
