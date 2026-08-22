import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairByRoomCode, selectFour, waitRemoteCount } from '../helpers/player-path.js';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const OUT = process.env.CP32_REAL_RELAY_ARTIFACTS || 'artifacts/real-relay';

async function launchClient(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cp32-close-${name}-`));
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
  return { name, context, page, errors, async close() { await context.close(); } };
}

async function waitInteractiveTarget(page, selector, timeout = 30000) {
  await expect.poll(async () => page.evaluate(sel => {
    const target = document.querySelector(sel);
    if (!target || target.disabled) return false;
    const style = getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || rect.width <= 0 || rect.height <= 0) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === target || !!target.contains(hit);
  }, selector), { timeout }).toBe(true);
}

async function assertSetupSurface(page) {
  await expect.poll(async () => page.evaluate(() => {
    const setup = document.getElementById('setup');
    const modal = document.getElementById('modal');
    const runtime = window.OnlineRuntime?.debug?.() || null;
    const style = setup ? getComputedStyle(setup) : null;
    const rect = setup?.getBoundingClientRect?.();
    return {
      setupActive: !!setup?.classList.contains('active'),
      setupVisible: !!style && style.display !== 'none' && style.visibility !== 'hidden' && Number(rect?.width || 0) > 0 && Number(rect?.height || 0) > 0,
      modalOpen: !!modal?.classList.contains('open'),
      runtimeState: runtime?.state || null,
    };
  }), { timeout: 30000 }).toEqual({ setupActive: true, setupVisible: true, modalOpen: false, runtimeState: 'IDLE' });
}

test('paired online lobby close returns to setup without a black screen', async () => {
  test.setTimeout(120000);
  const host = await launchClient('host');
  const guest = await launchClient('guest');
  try {
    await Promise.all([host.page.goto(APP, { waitUntil: 'domcontentloaded' }), guest.page.goto(APP, { waitUntil: 'domcontentloaded' })]);
    await Promise.all([waitInteractiveTarget(host.page, '#onlineBtn'), waitInteractiveTarget(guest.page, '#onlineBtn')]);

    const roomCode = await pairByRoomCode(host.page, guest.page);
    await selectFour(host.page);
    await waitRemoteCount(guest.page, 4);

    await waitInteractiveTarget(host.page, '#closeModal');
    await host.page.locator('#closeModal').tap();
    await assertSetupSurface(host.page);

    const visibleActiveScreens = await host.page.evaluate(() => [...document.querySelectorAll('.screen.active')].filter(el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }).map(el => el.id));
    expect(visibleActiveScreens).toContain('setup');
    expect(host.errors, 'host browser errors after online close').toEqual([]);

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'close-result.json'), JSON.stringify({ ok: true, roomCode, visibleActiveScreens, hostErrors: host.errors }, null, 2));
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});
