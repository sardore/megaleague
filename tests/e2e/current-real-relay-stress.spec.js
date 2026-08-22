import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairByRoomCode, waitRemoteCount, startBattle, runtimeSummary, resolveInteraction } from '../helpers/player-path.js';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const OUT = process.env.CP32_REAL_RELAY_ARTIFACTS || 'artifacts/real-relay';
const LEGAL_ACTION = '#actionButtons button:not([disabled]):visible, #actionButtons .skillbtn:not([disabled]):visible';

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2));
}

async function launchClient(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cp32-stress-${name}-`));
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
  return { name, context, page, cdp, errors, async close() { await context.close(); } };
}

async function setLifecycle(client, state) {
  await client.cdp.send('Page.setWebLifecycleState', { state });
}

async function touch(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible({ timeout: 30000 });
  await expect(locator).toBeEnabled();
  const box = await locator.boundingBox();
  if (!box) throw new Error('TOUCH_TARGET_DETACHED');
  await locator.page().touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function waitCommitted(page, timeout = 30000) {
  await expect.poll(async () => !!(await page.evaluate(() => window.OnlineRuntime?.debug?.() || null))?.committed, { timeout }).toBe(true);
}

async function waitBattleReady(page, timeout = 45000) {
  await expect.poll(async () => {
    const d = await page.evaluate(() => window.OnlineRuntime?.debug?.() || null);
    return d?.state === 'IN_BATTLE' && d?.committed === true && d?.transport?.ready === true && !d?.transport?.candidateBindingId;
  }, { timeout }).toBe(true);
}

async function assertFixedPoint(page, label, settleMs = 900) {
  const before = await page.evaluate(() => {
    const d = window.OnlineRuntime?.debug?.() || null;
    return { at: Date.now(), state:d?.state, ready:d?.transport?.ready === true, binding:d?.transport?.activeBindingId || null, candidate:d?.transport?.candidateBindingId || null };
  });
  expect(before.state, `${label}: state`).toBe('IN_BATTLE');
  expect(before.ready, `${label}: ready`).toBe(true);
  expect(before.candidate, `${label}: candidate`).toBeNull();
  await page.waitForTimeout(settleMs);
  const after = await page.evaluate(since => {
    const d = window.OnlineRuntime?.debug?.() || null;
    const trace = Array.isArray(d?.transport?.recoveryTrace) ? d.transport.recoveryTrace : [];
    return {
      state:d?.state, ready:d?.transport?.ready === true, binding:d?.transport?.activeBindingId || null, candidate:d?.transport?.candidateBindingId || null,
      newRestoreWork:trace.filter(e => Number(e?.at || 0) >= since && ['restore-request','authoritative-resync-requested','reconnect-scheduled'].includes(String(e?.stage || ''))),
    };
  }, before.at);
  expect(after.state, `${label}: state after settle`).toBe('IN_BATTLE');
  expect(after.ready, `${label}: ready after settle`).toBe(true);
  expect(after.candidate, `${label}: no candidate after settle`).toBeNull();
  expect(after.binding, `${label}: binding must not churn after settle`).toBe(before.binding);
  expect(after.newRestoreWork, `${label}: restore feedback must reach fixed point`).toEqual([]);
}

async function visibleActionCount(page) { return page.locator(LEGAL_ACTION).count(); }
async function currentActor(a, b) {
  await expect.poll(async () => Number((await visibleActionCount(a.page)) > 0) + Number((await visibleActionCount(b.page)) > 0), { timeout:45000 }).toBe(1);
  return (await visibleActionCount(a.page)) > 0 ? a : b;
}

async function actWithoutShorteningBattle(page) {
  const gather = page.locator('#actionButtons button:not([disabled]):visible').filter({ hasText:'에너지 모으기' }).first();
  const target = (await gather.count()) ? gather : page.locator(LEGAL_ACTION).first();
  await touch(target);
  await resolveInteraction(page);
}

async function selectSpecific(page, ids) {
  for (let i = 0; i < ids.length; i++) {
    const card = page.locator(`#onlineRoomDeck [data-card-id="${ids[i]}"]`).first();
    await touch(card);
    await expect.poll(() => page.locator('#onlineRoomDeck .online-room-card.selected').count(), { timeout:10000 }).toBe(i + 1);
  }
}

async function formSlot(page, surface, group) {
  const selector = surface === 'online' ? `#onlineRoomDeck [data-online-form="${group}"]` : `#deckCards [data-form-toggle="${group}"]`;
  const button = page.locator(selector).first();
  await expect(button).toBeVisible({ timeout:30000 });
  return button.evaluate(el => {
    const card = el.closest('.card');
    const root = card?.parentElement;
    const cards = root ? [...root.children].filter(node => node.classList?.contains('card')) : [];
    const rarity = [...(card?.querySelectorAll('.card-title-line .tiny') || [])].map(x => x.textContent || '').find(x => /☆/.test(x)) || '';
    return { index: cards.indexOf(card), id:card?.dataset.cardId || null, rarity:Number.parseFloat(rarity) || 0 };
  });
}

async function toggleFormAndAssertStable(page, surface, group) {
  const before = await formSlot(page, surface, group);
  const selector = surface === 'online' ? `#onlineRoomDeck [data-online-form="${group}"]` : `#deckCards [data-form-toggle="${group}"]`;
  await touch(page.locator(selector).first());
  await expect.poll(async () => (await formSlot(page, surface, group)).id, { timeout:10000 }).not.toBe(before.id);
  const after = await formSlot(page, surface, group);
  expect(after.index, `${surface}:${group} form family must own one stable placement slot`).toBe(before.index);
  return { before, after };
}

test('form grade changes never reorder the family placement slot', async () => {
  test.setTimeout(90000);
  const client = await launchClient('form-order');
  try {
    await client.page.goto(APP, { waitUntil:'domcontentloaded' });
    await client.page.locator('#deckCards .card').first().waitFor({ state:'visible', timeout:45000 });
    const rises = [];
    for (const group of ['brkeno','iruma','horizon']) {
      const first = await toggleFormAndAssertStable(client.page, 'setup', group);
      rises.push(first.after.rarity > first.before.rarity);
      if (group === 'horizon') {
        const second = await toggleFormAndAssertStable(client.page, 'setup', group);
        rises.push(second.after.rarity > second.before.rarity);
      }
    }
    expect(rises.some(Boolean), 'test must actually cross a grade-increase form transition').toBe(true);
    expect(client.errors).toEqual([]);
  } finally { await client.close(); }
});

test('long battle reaches a fixed point after repeated alternating background cycles', async () => {
  test.setTimeout(240000);
  const host = await launchClient('long-host');
  const guest = await launchClient('long-guest');
  try {
    await Promise.all([host.page.goto(APP,{waitUntil:'domcontentloaded'}), guest.page.goto(APP,{waitUntil:'domcontentloaded'})]);
    await pairByRoomCode(host.page, guest.page);
    await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);

    const onlineForm = await toggleFormAndAssertStable(host.page, 'online', 'brkeno');
    expect(onlineForm.after.rarity).toBeGreaterThan(onlineForm.before.rarity);

    await selectSpecific(host.page, ['awakenedIruma','wayli','master','sweetna']);
    await waitRemoteCount(guest.page, 4);
    await selectSpecific(guest.page, ['huve','dragonfish','ruby','flameflower']);
    await waitRemoteCount(host.page, 4);
    await startBattle(host.page, guest.page);
    await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);

    let actions = 0;
    for (let cycle = 0; cycle < 6; cycle++) {
      for (let i = 0; i < 2; i++) {
        const actor = await currentActor(host, guest);
        await actWithoutShorteningBattle(actor.page);
        actions++;
        await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
      }
      const backgrounded = cycle % 2 === 0 ? guest : host;
      const foreground = backgrounded === guest ? host : guest;
      await setLifecycle(backgrounded, 'frozen');
      await backgrounded.context.setOffline(true);
      await foreground.page.waitForTimeout(700 + cycle * 80);
      await backgrounded.context.setOffline(false);
      await setLifecycle(backgrounded, 'active');
      await backgrounded.page.bringToFront();
      await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
      await Promise.all([assertFixedPoint(host.page, `cycle-${cycle}-host`), assertFixedPoint(guest.page, `cycle-${cycle}-guest`)]);
    }

    expect(actions).toBeGreaterThanOrEqual(12);
    const [h, g] = await Promise.all([runtimeSummary(host.page), runtimeSummary(guest.page)]);
    expect(g.runtime?.matchId).toBe(h.runtime?.matchId);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    write('stress-long-battle.json', { ok:true, actions, host:h, guest:g });
  } catch (error) {
    write('stress-long-battle.json', { ok:false, error:String(error), host:await runtimeSummary(host.page).catch(()=>null), guest:await runtimeSummary(guest.page).catch(()=>null), hostErrors:host.errors, guestErrors:guest.errors });
    throw error;
  } finally { await Promise.allSettled([host.close(), guest.close()]); }
});

test('scheduled-action identity survives repeated background restore without duplication', async () => {
  test.setTimeout(180000);
  const host = await launchClient('scheduled-host');
  const guest = await launchClient('scheduled-guest');
  try {
    await Promise.all([host.page.goto(APP,{waitUntil:'domcontentloaded'}), guest.page.goto(APP,{waitUntil:'domcontentloaded'})]);
    await pairByRoomCode(host.page, guest.page);
    await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);
    await selectSpecific(host.page, ['awakenedIruma','wayli','master','sweetna']);
    await waitRemoteCount(guest.page, 4);
    await selectSpecific(guest.page, ['huve','dragonfish','ruby','flameflower']);
    await waitRemoteCount(host.page, 4);
    await startBattle(host.page, guest.page);
    await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);

    const scheduledId = await host.page.evaluate(() => {
      const units = [...(game?.teams?.P?.field || []), ...(game?.teams?.P?.bench || [])].filter(Boolean);
      const unit = units.find(u => u.card === 'awakenedIruma');
      if (!unit) throw new Error('AWAKENED_IRUMA_NOT_IN_HOST_TEAM');
      const scheduled = registerScheduledAction(game, unit, { kind:'bloom', evaded:{}, remaining:1 });
      if (!scheduled?.scheduledActionId) throw new Error('SCHEDULE_ID_NOT_ASSIGNED');
      sendAuthoritativeOnlineState([], null, true);
      return scheduled.scheduledActionId;
    });

    await expect.poll(async () => guest.page.evaluate(id => {
      const units = [...(game?.teams?.A?.field || []), ...(game?.teams?.A?.bench || []), ...(game?.teams?.P?.field || []), ...(game?.teams?.P?.bench || [])].filter(Boolean);
      return units.some(u => u.scheduledAction?.scheduledActionId === id);
    }, scheduledId), { timeout:30000 }).toBe(true);

    for (let cycle = 0; cycle < 4; cycle++) {
      await setLifecycle(guest, 'frozen');
      await guest.context.setOffline(true);
      await host.page.waitForTimeout(650);
      await guest.context.setOffline(false);
      await setLifecycle(guest, 'active');
      await guest.page.bringToFront();
      await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
      await Promise.all([assertFixedPoint(host.page, `scheduled-${cycle}-host`), assertFixedPoint(guest.page, `scheduled-${cycle}-guest`)]);
      const state = await guest.page.evaluate(id => {
        const all = [...(game?.teams?.P?.field || []), ...(game?.teams?.P?.bench || []), ...(game?.teams?.A?.field || []), ...(game?.teams?.A?.bench || [])].filter(Boolean);
        const owners = all.filter(u => u.scheduledAction?.scheduledActionId === id);
        return { owners:owners.length, consumed:(game?.consumedScheduledActionIds || []).filter(x => x === id || String(x).startsWith(`${id}:`)).length };
      }, scheduledId);
      expect(state.owners, `scheduled action must have one owner after restore cycle ${cycle}`).toBe(1);
      expect(state.consumed, `scheduled action must not be spuriously consumed during background cycle ${cycle}`).toBe(0);
    }
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
  } finally { await Promise.allSettled([host.close(), guest.close()]); }
});
