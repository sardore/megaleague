import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairByRoomCode, runtimeSummary } from '../helpers/player-path.js';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const OUT = process.env.CP32_REAL_RELAY_ARTIFACTS || 'artifacts/real-relay';

async function launch(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cp32-emote-${name}-`));
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
  });
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
  return { name, dir, context, page, cdp, errors, close: () => context.close() };
}

async function committedLobby(page) {
  await expect.poll(async () => {
    const d = await page.evaluate(() => window.OnlineRuntime?.debug?.() || null);
    return [d?.state || null, d?.committed === true, d?.transport?.ready === true, d?.transport?.candidateBindingId || null];
  }, { timeout: 45000 }).toEqual(['LOBBY', true, true, null]);
}

async function freezeOffline(client, yes) {
  if (yes) {
    await client.cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await client.context.setOffline(true);
  } else {
    await client.context.setOffline(false);
    await client.cdp.send('Page.setWebLifecycleState', { state: 'active' });
    await client.page.bringToFront();
  }
}

async function tapEmote(page, emoji) {
  const button = page.locator(`.emote-bar button[data-emote="${emoji}"]`);
  await expect(button).toBeVisible({ timeout: 30000 });
  await expect(button).toBeEnabled();
  await button.tap();
  await expect(page.locator('.battle-emote').filter({ hasText: `나 ${emoji}` })).toBeVisible({ timeout: 5000 });
}

async function expectRemoteEmote(page, emoji, timeout = 15000) {
  await expect(page.locator('.battle-emote').filter({ hasText: `상대 ${emoji}` })).toBeVisible({ timeout });
}

async function noEmoteDuplicatesAfterAnimation(page, emoji) {
  const remote = page.locator('.battle-emote').filter({ hasText: `상대 ${emoji}` });
  await expect(remote).toHaveCount(0, { timeout: 6000 });
  await page.waitForTimeout(2800);
  await expect(remote).toHaveCount(0);
}

test('online lobby emotes deliver both directions once over the canonical control route', async () => {
  test.setTimeout(120000);
  const host = await launch('roundtrip-host');
  const guest = await launch('roundtrip-guest');
  try {
    await Promise.all([
      host.page.goto(APP, { waitUntil: 'domcontentloaded' }),
      guest.page.goto(APP, { waitUntil: 'domcontentloaded' }),
    ]);
    const roomCode = await pairByRoomCode(host.page, guest.page);
    await Promise.all([committedLobby(host.page), committedLobby(guest.page)]);

    await tapEmote(host.page, '👍');
    await expectRemoteEmote(guest.page, '👍');
    await noEmoteDuplicatesAfterAnimation(guest.page, '👍');

    await tapEmote(guest.page, 'GG');
    await expectRemoteEmote(host.page, 'GG');
    await noEmoteDuplicatesAfterAnimation(host.page, 'GG');

    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'emote-roundtrip.json'), JSON.stringify({
      ok: true,
      roomCode,
      host: await runtimeSummary(host.page),
      guest: await runtimeSummary(guest.page),
    }, null, 2));
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});

test('emote missed while receiver is backgrounded arrives by retry after authoritative restore without duplicate display', async () => {
  test.setTimeout(150000);
  const host = await launch('retry-host');
  const guest = await launch('retry-guest');
  try {
    await Promise.all([
      host.page.goto(APP, { waitUntil: 'domcontentloaded' }),
      guest.page.goto(APP, { waitUntil: 'domcontentloaded' }),
    ]);
    const roomCode = await pairByRoomCode(host.page, guest.page);
    await Promise.all([committedLobby(host.page), committedLobby(guest.page)]);

    await freezeOffline(guest, true);
    await tapEmote(host.page, '🔥');
    await host.page.waitForTimeout(900);
    await freezeOffline(guest, false);
    await committedLobby(guest.page);
    await expectRemoteEmote(guest.page, '🔥', 18000);
    await noEmoteDuplicatesAfterAnimation(guest.page, '🔥');

    await freezeOffline(host, true);
    await tapEmote(guest.page, '😮');
    await guest.page.waitForTimeout(900);
    await freezeOffline(host, false);
    await committedLobby(host.page);
    await expectRemoteEmote(host.page, '😮', 18000);
    await noEmoteDuplicatesAfterAnimation(host.page, '😮');

    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'emote-background-retry.json'), JSON.stringify({
      ok: true,
      roomCode,
      host: await runtimeSummary(host.page),
      guest: await runtimeSummary(guest.page),
    }, null, 2));
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});
