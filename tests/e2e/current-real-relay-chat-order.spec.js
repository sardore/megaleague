import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairByRoomCode, runtimeSummary } from '../helpers/player-path.js';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const OUT = process.env.CP32_REAL_RELAY_ARTIFACTS || 'artifacts/real-relay';

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2));
}

async function launch(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cp32-chat-order-${name}-`));
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
  return { name, context, page, errors, close: () => context.close() };
}

async function readyLobby(client, timeout = 60000) {
  await expect.poll(async () => client.page.evaluate(() => {
    const d = window.OnlineRuntime?.debug?.() || null;
    return [d?.state || null, d?.committed === true, d?.transport?.ready === true, d?.transport?.candidateBindingId || null];
  }), { timeout }).toEqual(['LOBBY', true, true, null]);
}

async function sendChat(page, text) {
  const sent = await page.evaluate(value => window.__megaOnlineBattleChat?.send?.(value) === true, text);
  expect(sent, `chat send must accept ${text}`).toBe(true);
}

async function transcript(page) {
  await page.evaluate(() => window.__megaOnlineBattleChat?.open?.());
  return page.locator('#onlineChatMessages .online-chat-message > span:first-child').evaluateAll(nodes =>
    nodes.map(node => String(node.textContent || '').trim())
  );
}

async function chatDebug(page) {
  return page.evaluate(() => window.__megaOnlineBattleChat?.debug?.() || null);
}

test('chat transcript has one total order when each peer queues a message across the same reconnect gap', async () => {
  test.setTimeout(180000);
  const host = await launch('host');
  const guest = await launch('guest');
  const hostText = `HOST-${process.env.GITHUB_RUN_ID || 'local'}`;
  const guestText = `GUEST-${process.env.GITHUB_RUN_ID || 'local'}`;
  try {
    await Promise.all([
      host.page.goto(APP, { waitUntil: 'domcontentloaded' }),
      guest.page.goto(APP, { waitUntil: 'domcontentloaded' }),
    ]);
    await pairByRoomCode(host.page, guest.page);
    await Promise.all([readyLobby(host), readyLobby(guest)]);

    // Force the two local optimistic histories to observe opposite arrival order.
    // A correct chat protocol must still assign one authoritative sequence and project the same order.
    await guest.context.setOffline(true);
    await sendChat(host.page, hostText);
    await sendChat(guest.page, guestText);
    await host.page.waitForTimeout(250);
    await guest.context.setOffline(false);
    await guest.page.bringToFront();

    await Promise.all([readyLobby(host), readyLobby(guest)]);
    await expect.poll(async () => {
      const [h, g] = await Promise.all([chatDebug(host.page), chatDebug(guest.page)]);
      return [h?.messageCount || 0, g?.messageCount || 0, h?.pendingCount || 0, g?.pendingCount || 0];
    }, { timeout: 45000 }).toEqual([2, 2, 0, 0]);

    const [hostTranscript, guestTranscript] = await Promise.all([transcript(host.page), transcript(guest.page)]);
    write('chat-total-order.json', {
      ok: JSON.stringify(hostTranscript) === JSON.stringify(guestTranscript),
      hostText,
      guestText,
      hostTranscript,
      guestTranscript,
      hostDebug: await chatDebug(host.page),
      guestDebug: await chatDebug(guest.page),
      hostRuntime: await runtimeSummary(host.page),
      guestRuntime: await runtimeSummary(guest.page),
    });

    expect(hostTranscript).toEqual(guestTranscript);
    expect(new Set(hostTranscript)).toEqual(new Set([hostText, guestText]));
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
  } finally {
    await Promise.allSettled([host.close(), guest.close()]);
  }
});
