import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairByRoomCode, selectFour, waitRemoteCount, startBattle, runtimeSummary, resolveInteraction } from '../helpers/player-path.js';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const RELAY = process.env.CP32_LOCAL_RELAY || 'ws://127.0.0.1:8787/online';
const OUT = process.env.CP32_REAL_RELAY_ARTIFACTS || 'artifacts/real-relay';
const LEGAL_ACTION = '#actionButtons button:not([disabled]):visible, #actionButtons .skillbtn:not([disabled]):visible';

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2));
}

async function launchClient(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cp32-current-${name}-`));
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
  const sockets = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
  page.on('websocket', ws => {
    const rec = { url: ws.url(), openedAt: Date.now(), closedAt: null, errors: [] };
    sockets.push(rec);
    ws.on('socketerror', e => rec.errors.push(String(e)));
    ws.on('close', () => { rec.closedAt = Date.now(); });
  });
  const cdp = await context.newCDPSession(page);
  return { name, context, page, cdp, errors, sockets, dir, async close() { await context.close(); } };
}

async function setLifecycle(client, state) {
  await client.cdp.send('Page.setWebLifecycleState', { state });
}

async function waitInteractiveTarget(page, selector, timeout = 30000) {
  await expect.poll(async () => page.evaluate(sel => {
    const target = document.querySelector(sel);
    if (!target || target.disabled) return false;
    const style = getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || rect.width <= 0 || rect.height <= 0) return false;
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return hit === target || !!target.contains(hit);
  }, selector), { timeout, message: `${selector} must be the real topmost touch target` }).toBe(true);
}

async function waitCommitted(page, timeout = 30000) {
  await expect.poll(async () => {
    const d = await page.evaluate(() => window.OnlineRuntime?.debug?.() || null);
    return !!d?.committed;
  }, { timeout }).toBe(true);
}

async function waitBattleTransportReady(page, timeout = 45000) {
  await expect.poll(async () => {
    const d = await page.evaluate(() => window.OnlineRuntime?.debug?.() || null);
    return !!d?.committed && d?.state === 'IN_BATTLE' && d?.transport?.ready === true;
  }, { timeout, message: 'battle runtime must finish restore before interaction' }).toBe(true);
}

async function visibleLegalActionCount(page) {
  return page.locator(LEGAL_ACTION).count();
}

async function chooseCurrentActor(host, guest, timeout = 45000) {
  await expect.poll(async () => {
    const [h, g] = await Promise.all([visibleLegalActionCount(host.page), visibleLegalActionCount(guest.page)]);
    return Number(h > 0) + Number(g > 0);
  }, { timeout, message: 'exactly one peer must own a visible legal action surface' }).toBe(1);
  return (await visibleLegalActionCount(host.page)) > 0 ? host : guest;
}

async function touchFirstVisibleLegalAction(page) {
  const first = page.locator(LEGAL_ACTION).first();
  await expect(first).toBeVisible({ timeout: 30000 });
  await expect(first).toBeEnabled();
  // Locator.tap() retains real touch semantics while auto-waiting/re-resolving if the
  // battle renderer replaces a button node between frames.
  await first.tap();
  await resolveInteraction(page);
}

async function assertNoBlackScreen(page) {
  const visible = await page.evaluate(() => {
    const active = [...document.querySelectorAll('.screen.active')].filter(el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
    return active.map(el => el.id || el.className);
  });
  expect(visible.length, 'at least one visible active screen must remain').toBeGreaterThan(0);
}

test('current index + actual relay source: lobby resume, start, battle reconnect converge', async () => {
  test.setTimeout(180000);
  const host = await launchClient('host');
  const guest = await launchClient('guest');
  try {
    await Promise.all([host.page.goto(APP, { waitUntil: 'domcontentloaded' }), guest.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    expect(new URL(APP).searchParams.get('relay')).toBe(RELAY);

    await Promise.all([
      waitInteractiveTarget(host.page, '#onlineBtn'),
      waitInteractiveTarget(guest.page, '#onlineBtn'),
    ]);

    const roomCode = await pairByRoomCode(host.page, guest.page);
    await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);

    await selectFour(host.page);
    await waitRemoteCount(guest.page, 4);

    await setLifecycle(guest, 'frozen');
    await guest.context.setOffline(true);
    await host.page.waitForTimeout(1500);
    await guest.context.setOffline(false);
    await setLifecycle(guest, 'active');
    await guest.page.bringToFront();

    await expect.poll(async () => (await runtimeSummary(guest.page)).runtime?.committed, { timeout: 45000 }).toBe(true);
    await waitRemoteCount(guest.page, 4);
    await selectFour(guest.page);
    await waitRemoteCount(host.page, 4);

    await startBattle(host.page, guest.page);
    await Promise.all([waitBattleTransportReady(host.page), waitBattleTransportReady(guest.page)]);
    const h0 = await runtimeSummary(host.page);
    const g0 = await runtimeSummary(guest.page);
    expect(h0.runtime?.matchId).toBeTruthy();
    expect(g0.runtime?.matchId).toBe(h0.runtime?.matchId);

    const actor = await chooseCurrentActor(host, guest);
    const peer = actor === host ? guest : host;
    await touchFirstVisibleLegalAction(actor.page);

    await setLifecycle(actor, 'frozen');
    await actor.context.setOffline(true);
    await peer.page.waitForTimeout(1800);
    await actor.context.setOffline(false);
    await setLifecycle(actor, 'active');
    await actor.page.bringToFront();

    await Promise.all([waitBattleTransportReady(host.page), waitBattleTransportReady(guest.page)]);

    await assertNoBlackScreen(host.page);
    await assertNoBlackScreen(guest.page);

    const finalHost = await runtimeSummary(host.page);
    const finalGuest = await runtimeSummary(guest.page);
    expect(finalGuest.runtime?.matchId).toBe(finalHost.runtime?.matchId);
    expect(host.errors, 'host browser errors').toEqual([]);
    expect(guest.errors, 'guest browser errors').toEqual([]);

    write('result.json', {
      ok: true,
      roomCode,
      relay: RELAY,
      actor: actor.name,
      host: finalHost,
      guest: finalGuest,
      hostSockets: host.sockets,
      guestSockets: guest.sockets,
      hostErrors: host.errors,
      guestErrors: guest.errors,
    });
  } catch (error) {
    write('result.json', {
      ok: false,
      error: String(error),
      host: await runtimeSummary(host.page).catch(() => null),
      guest: await runtimeSummary(guest.page).catch(() => null),
      hostSockets: host.sockets,
      guestSockets: guest.sockets,
      hostErrors: host.errors,
      guestErrors: guest.errors,
    });
    throw error;
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});
