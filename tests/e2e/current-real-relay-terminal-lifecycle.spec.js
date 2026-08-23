import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairByRoomCode, selectFour, waitRemoteCount, startBattle, resolveInteraction, runtimeSummary } from '../helpers/player-path.js';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
const OUT = process.env.CP32_REAL_RELAY_ARTIFACTS || 'artifacts/real-relay';
const LEGAL_ACTION = '#actionButtons button:not([disabled]):visible, #actionButtons .skillbtn:not([disabled]):visible';

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2));
}

async function launchClient(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cp32-terminal-${name}-`));
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

async function waitCommitted(page, timeout = 45000) {
  await expect.poll(async () => !!(await page.evaluate(() => window.OnlineRuntime?.debug?.() || null))?.committed, { timeout }).toBe(true);
}

async function waitBattleReady(page, timeout = 60000) {
  await expect.poll(async () => {
    const d = await page.evaluate(() => window.OnlineRuntime?.debug?.() || null);
    return d?.state === 'IN_BATTLE' && d?.committed === true && d?.transport?.ready === true && !d?.transport?.candidateBindingId;
  }, { timeout }).toBe(true);
}

async function selectAvailableFour(page) {
  await selectFour(page);
  const ids = await page.locator('#onlineRoomDeck .online-room-card.selected').evaluateAll(cards => cards.map(card => card.dataset.cardId || null).filter(Boolean));
  expect(ids, 'four concrete online deck identities are required').toHaveLength(4);
  return ids;
}

async function setupBattle(host, guest) {
  const roomCode = await pairByRoomCode(host.page, guest.page);
  await Promise.all([waitCommitted(host.page), waitCommitted(guest.page)]);
  const hostDeck = await selectAvailableFour(host.page);
  await waitRemoteCount(guest.page, 4);
  const guestDeck = await selectAvailableFour(guest.page);
  await waitRemoteCount(host.page, 4);
  await startBattle(host.page, guest.page);
  await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
  return { roomCode, hostDeck, guestDeck };
}

async function visibleActionCount(page) {
  return page.locator(LEGAL_ACTION).count();
}

async function battleState(page) {
  return page.evaluate(() => {
    const sum = team => {
      const units = [...(team?.field || []), ...(team?.bench || [])].filter(Boolean);
      return {
        alive: units.filter(u => !u.dead && Number(u.hp || 0) > 0).length,
        hp: units.reduce((n, u) => n + Math.max(0, Number(u.hp || 0)), 0),
      };
    };
    const runtime = window.OnlineRuntime?.debug?.() || null;
    return {
      winner: game?.winner || null,
      turn: game?.turn || null,
      turnSerial: Number(game?.turnSerial || 0),
      revision: Number(game?.networkRevision || 0),
      eventSequence: Number(game?.eventSequence || 0),
      matchId: game?.matchId || runtime?.matchId || null,
      P: sum(game?.teams?.P),
      A: sum(game?.teams?.A),
      energy: ['P','A'].reduce((total,team)=>total+[...(game?.teams?.[team]?.field||[]),...(game?.teams?.[team]?.bench||[])].filter(Boolean).reduce((n,u)=>n+[...(u.energy||[]),...(u.beastEnergy||[]),...(u.riderEnergy||[])].reduce((m,e)=>m+Number(e?.a||0),0),0),0),
      pendingActionId: window.OnlineActionAdmissionOwner?.pendingActionId?.() || null,
      pendingTransaction: game?.pendingTransaction?.actionId || null,
      committedTransactions: (window.TransactionAuditChannel?.snapshot?.()||[]).filter(row=>row.type==='ACTION_TRANSACTION_COMMITTED').length,
      runtimeState: runtime?.state || null,
      committed: runtime?.committed === true,
    };
  });
}

async function terminalOrActor(host, guest, timeout = 60000) {
  let last = null;
  await expect.poll(async () => {
    const [hs, gs, hc, gc] = await Promise.all([
      battleState(host.page), battleState(guest.page), visibleActionCount(host.page), visibleActionCount(guest.page),
    ]);
    last = { hs, gs, hc, gc };
    if (hs.winner || gs.winner) return 'terminal';
    if (hc + gc === 1) return 'actor';
    return 'waiting';
  }, { timeout, message: `battle must expose exactly one actor or a terminal state; last=${JSON.stringify(last)}` }).not.toBe('waiting');
  const [hs, gs, hc, gc] = await Promise.all([
    battleState(host.page), battleState(guest.page), visibleActionCount(host.page), visibleActionCount(guest.page),
  ]);
  if (hs.winner || gs.winner) return { terminal: true, hostState: hs, guestState: gs, actor: null, receiver: null };
  expect(hc + gc, 'exactly one client must own the canonical action surface').toBe(1);
  return hc ? { terminal: false, hostState: hs, guestState: gs, actor: host, receiver: guest } : { terminal: false, hostState: hs, guestState: gs, actor: guest, receiver: host };
}

async function tapAggressiveAction(page) {
  const buttons = page.locator(LEGAL_ACTION);
  const count = await buttons.count();
  if (!count) throw new Error('NO_LEGAL_ACTION_BUTTON');
  let chosen = null;
  for (let i = count - 1; i >= 0; i--) {
    const button = buttons.nth(i);
    const text = ((await button.textContent()) || '').replace(/\s+/g, ' ').trim();
    if (!/에너지\s*모으기|후퇴|교체|대기/.test(text)) { chosen = button; break; }
  }
  chosen ||= buttons.last();
  await chosen.scrollIntoViewIfNeeded();
  await expect(chosen).toBeVisible({ timeout: 30000 });
  await expect(chosen).toBeEnabled();
  await chosen.tap();
  await resolveInteraction(page);
  return ((await chosen.textContent().catch(()=>''))||'').replace(/\s+/g,' ').trim();
}

async function waitCanonicalActionCommit(host,guest,beforeHost,beforeGuest,timeout=60000){
  expect(beforeGuest.matchId).toBe(beforeHost.matchId);
  expect(beforeGuest.revision).toBe(beforeHost.revision);
  let last=null;
  await expect.poll(async()=>{const [h,g]=await Promise.all([battleState(host.page),battleState(guest.page)]);last={h,g};const converged=h.matchId===g.matchId&&h.revision===g.revision&&h.turnSerial===g.turnSerial&&h.P.hp===g.P.hp&&h.A.hp===g.A.hp&&h.energy===g.energy;const changed=h.turnSerial!==beforeHost.turnSerial||h.eventSequence!==beforeHost.eventSequence||h.P.hp!==beforeHost.P.hp||h.A.hp!==beforeHost.A.hp||h.energy!==beforeHost.energy;return converged&&changed&&h.revision===beforeHost.revision+1&&h.committedTransactions===beforeHost.committedTransactions+1&&!h.pendingActionId&&!g.pendingActionId&&!h.pendingTransaction&&!g.pendingTransaction;},{timeout,message:`UI action must produce one canonical commit/revision and converge; last=${JSON.stringify(last)}`}).toBe(true);
  return last;
}

async function waitTerminalResult(host, guest, timeout = 90000) {
  await expect.poll(async () => {
    const [h, g] = await Promise.all([battleState(host.page), battleState(guest.page)]);
    return { h: h.winner, g: g.winner };
  }, { timeout }).toEqual(expect.objectContaining({ h: expect.anything(), g: expect.anything() }));
  const [h, g] = await Promise.all([battleState(host.page), battleState(guest.page)]);
  expect(h.winner, 'host terminal winner').toBeTruthy();
  expect(g.winner, 'guest terminal winner').toBeTruthy();
  expect(g.winner, 'both clients must converge on the same canonical winner').toBe(h.winner);
  await Promise.all([
    expect(host.page.locator('#pvpResultMenu')).toBeVisible({ timeout }),
    expect(guest.page.locator('#pvpResultMenu')).toBeVisible({ timeout }),
  ]);
  return { host: h, guest: g, winner: h.winner };
}

async function playToTerminal(host, guest, options = {}) {
  const maxActions = Number(options.maxActions || 220);
  const backgroundFinishingReceiver = options.backgroundFinishingReceiver === true;
  const history = [];
  let terminalWhileReceiverOffline = false;
  for (let action = 0; action < maxActions; action++) {
    const next = await terminalOrActor(host, guest);
    if (next.terminal) {
      const terminal = await waitTerminalResult(host, guest);
      return { actions: action, terminal, terminalWhileReceiverOffline, history };
    }
    const state = next.actor === host ? next.hostState : next.guestState;
    const turn = state.turn;
    const opponent = turn === 'P' ? state.A : turn === 'A' ? state.P : { alive: 4, hp: Infinity };
    const shouldBackground = backgroundFinishingReceiver && (action >= 6 || opponent.alive <= 3 || opponent.hp <= 500);
    history.push({ action, actor: next.actor.name, turn, opponentAlive: opponent.alive, opponentHp: opponent.hp, backgrounded: shouldBackground });

    if (shouldBackground) {
      const [beforeHost,beforeGuest]=await Promise.all([battleState(host.page),battleState(guest.page)]);
      await setLifecycle(next.receiver, 'frozen');
      await next.receiver.context.setOffline(true);
      await next.actor.page.waitForTimeout(250);
      await tapAggressiveAction(next.actor.page);
      await next.actor.page.waitForTimeout(500);
      const actorWhileReceiverOffline = await battleState(next.actor.page);
      if (actorWhileReceiverOffline.winner) terminalWhileReceiverOffline = true;
      await next.receiver.context.setOffline(false);
      await setLifecycle(next.receiver, 'active');
      await next.receiver.page.bringToFront();
      const committed=await waitCanonicalActionCommit(host,guest,beforeHost,beforeGuest,90000);
      const actorAfter=next.actor===host?committed.h:committed.g;
      if (actorAfter.winner) {
        const terminal = await waitTerminalResult(host, guest);
        return { actions: action + 1, terminal, terminalWhileReceiverOffline, history };
      }
      await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
    } else {
      const [beforeHost,beforeGuest]=await Promise.all([battleState(host.page),battleState(guest.page)]);
      await tapAggressiveAction(next.actor.page);
      await waitCanonicalActionCommit(host,guest,beforeHost,beforeGuest);
    }
  }
  throw new Error(`TERMINAL_NOT_REACHED_AFTER_${maxActions}_UI_ACTIONS`);
}

async function runtimeIdentity(page) {
  return page.evaluate(() => {
    const d = window.OnlineRuntime?.debug?.() || null;
    return {
      state: d?.state || null,
      committed: d?.committed === true,
      generation: Number(d?.generation || 0),
      sessionToken: d?.sessionToken || null,
      matchId: d?.matchId || game?.matchId || null,
      activeBindingId: d?.transport?.activeBindingId || null,
      candidateBindingId: d?.transport?.candidateBindingId || null,
      transportReady: d?.transport?.ready === true,
    };
  });
}

async function assertSetupIdle(page, timeout = 45000) {
  await expect.poll(async () => page.evaluate(() => {
    const setup = document.getElementById('setup');
    const modal = document.getElementById('modal');
    const d = window.OnlineRuntime?.debug?.() || null;
    const style = setup ? getComputedStyle(setup) : null;
    const rect = setup?.getBoundingClientRect?.();
    return {
      setupActive: !!setup?.classList.contains('active'),
      setupVisible: !!style && style.display !== 'none' && style.visibility !== 'hidden' && Number(rect?.width || 0) > 0 && Number(rect?.height || 0) > 0,
      modalOpen: !!modal?.classList.contains('open'),
      runtimeState: d?.state || null,
      candidateBindingId: d?.transport?.candidateBindingId || null,
      battleEmotes: document.querySelectorAll('.battle-emote').length,
    };
  }), { timeout }).toEqual({ setupActive: true, setupVisible: true, modalOpen: false, runtimeState: 'IDLE', candidateBindingId: null, battleEmotes: 0 });
}

async function resultMenuToSetup(host, guest) {
  await Promise.all([
    host.page.locator('#pvpResultMenu').tap(),
    guest.page.locator('#pvpResultMenu').tap(),
  ]);
  await Promise.all([assertSetupIdle(host.page), assertSetupIdle(guest.page)]);
}

test('full online match terminal teardown leaves a clean second-session start on the same mobile clients', async () => {
  test.setTimeout(720000);
  const host = await launchClient('terminal-host');
  const guest = await launchClient('terminal-guest');
  try {
    await Promise.all([host.page.goto(APP, { waitUntil:'domcontentloaded' }), guest.page.goto(APP, { waitUntil:'domcontentloaded' })]);
    const firstSetup = await setupBattle(host, guest);
    const firstIdentity = await Promise.all([runtimeIdentity(host.page), runtimeIdentity(guest.page)]);
    const first = await playToTerminal(host, guest, { maxActions: 220 });
    expect(first.actions).toBeGreaterThan(0);
    await resultMenuToSetup(host, guest);
    const idleIdentity = await Promise.all([runtimeIdentity(host.page), runtimeIdentity(guest.page)]);
    expect(idleIdentity[0].state).toBe('IDLE');
    expect(idleIdentity[1].state).toBe('IDLE');

    const secondSetup = await setupBattle(host, guest);
    const secondIdentity = await Promise.all([runtimeIdentity(host.page), runtimeIdentity(guest.page)]);
    expect(secondIdentity[0].state).toBe('IN_BATTLE');
    expect(secondIdentity[1].state).toBe('IN_BATTLE');
    expect(secondIdentity[1].matchId).toBe(secondIdentity[0].matchId);
    expect(secondIdentity[0].matchId, 'second battle must not reuse first battle match identity').not.toBe(firstIdentity[0].matchId);
    if (firstIdentity[0].sessionToken && secondIdentity[0].sessionToken) expect(secondIdentity[0].sessionToken).not.toBe(firstIdentity[0].sessionToken);
    if (firstIdentity[1].sessionToken && secondIdentity[1].sessionToken) expect(secondIdentity[1].sessionToken).not.toBe(firstIdentity[1].sessionToken);
    expect(secondIdentity[0].generation).toBeGreaterThan(firstIdentity[0].generation);
    expect(secondIdentity[1].generation).toBeGreaterThan(firstIdentity[1].generation);

    for (let i = 0; i < 4; i++) {
      const next = await terminalOrActor(host, guest);
      expect(next.terminal, 'second session should expose normal action ownership').toBe(false);
      await tapAggressiveAction(next.actor.page);
    }
    await Promise.all([waitBattleReady(host.page), waitBattleReady(guest.page)]);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    write('terminal-second-session.json', {
      ok: true,
      firstSetup,
      firstIdentity,
      first: { actions:first.actions, winner:first.terminal.winner },
      idleIdentity,
      secondSetup,
      secondIdentity,
      host: await runtimeSummary(host.page),
      guest: await runtimeSummary(guest.page),
    });
  } catch (error) {
    write('terminal-second-session.json', {
      ok: false,
      error: String(error),
      host: await runtimeSummary(host.page).catch(() => null),
      guest: await runtimeSummary(guest.page).catch(() => null),
      hostErrors: host.errors,
      guestErrors: guest.errors,
    });
    throw error;
  } finally { await Promise.allSettled([host.close(), guest.close()]); }
});

test('terminal result converges when the non-acting peer is frozen and offline across the finishing action', async () => {
  test.setTimeout(900000);
  const host = await launchClient('terminal-bg-host');
  const guest = await launchClient('terminal-bg-guest');
  try {
    await Promise.all([host.page.goto(APP, { waitUntil:'domcontentloaded' }), guest.page.goto(APP, { waitUntil:'domcontentloaded' })]);
    const setup = await setupBattle(host, guest);
    const result = await playToTerminal(host, guest, { maxActions: 240, backgroundFinishingReceiver:true });
    expect(result.terminalWhileReceiverOffline, 'the finishing action itself must occur while the peer is offline').toBe(true);
    expect(result.terminal.host.winner).toBe(result.terminal.guest.winner);
    await resultMenuToSetup(host, guest);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    write('terminal-background-finish.json', {
      ok: true,
      setup,
      actions: result.actions,
      winner: result.terminal.winner,
      terminalWhileReceiverOffline: result.terminalWhileReceiverOffline,
      lastHistory: result.history.slice(-20),
      hostIdentity: await runtimeIdentity(host.page),
      guestIdentity: await runtimeIdentity(guest.page),
    });
  } catch (error) {
    write('terminal-background-finish.json', {
      ok: false,
      error: String(error),
      host: await runtimeSummary(host.page).catch(() => null),
      guest: await runtimeSummary(guest.page).catch(() => null),
      hostErrors: host.errors,
      guestErrors: guest.errors,
    });
    throw error;
  } finally { await Promise.allSettled([host.close(), guest.close()]); }
});
