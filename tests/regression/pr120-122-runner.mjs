import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';

await fs.mkdir('artifacts/regression', { recursive: true });
const bundle = await build({
  entryPoints: ['tests/helpers/pr120-122-probe.js'],
  bundle: true, write: false, outdir: 'probe',
  loader: { '.css': 'empty' }, format: 'iife'
});
const html = (await fs.readFile('index.html', 'utf8'))
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/, '<script src="/probe.js"></script>');
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/probe.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end(bundle.outputFiles[0].text);
    return;
  }
  if (pathname === '/') {
    res.setHeader('content-type', 'text/html');
    res.end(html);
    return;
  }
  if (pathname.includes('..')) { res.writeHead(403); res.end(); return; }
  try {
    if (pathname.endsWith('.css')) res.setHeader('content-type', 'text/css');
    if (pathname.endsWith('.js')) res.setHeader('content-type', 'text/javascript');
    res.end(await fs.readFile('.' + pathname));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
const results = [];
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', error => errors.push(String(error)));
async function run(name, action) {
  const started = Date.now();
  try {
    const evidence = await action();
    results.push({ name, status: 'PASS', durationMs: Date.now() - started, evidence });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, status: 'FAIL', durationMs: Date.now() - started, error: String(error), stack: error?.stack });
    console.error('FAIL ' + name + ': ' + error?.stack);
  }
}
async function load() {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.regressionProbe?.ready && window.Megaleague);
  await page.evaluate(() => document.getElementById('startupIntro')?.remove());
}
try {
  await run('NAV-01: real result button closes owned terminal session and releases settings', async () => {
    await load();
    const before = await page.evaluate(() => {
      const p = window.regressionProbe;
      const g = Megaleague.newGame(
        ['mole', 'boar', 'fang', 'frog'],
        ['turtle', 'hermit', 'mole', 'mushroom'],
        { mode: 'ai', variance: false, seed: 'nav120' }
      );
      g.mode = 'online';
      g.winner = 'P';
      g.stats.turns = 2;
      g.matchId = 'old-match-regression';
      probe.battle.game = g;
      probe.deck.onlineSide = 'P';
      Object.assign(probe.deck.p2p, {
        connected: true, role: 'host', matchId: g.matchId,
        roomCode: 'ABCDEF', battleStarted: true
      });
      const s = p.freshSession({ kind: 'room.create', mode: 'PVP', roomCode: 'ABCDEF' });
      s.machine.state = 'ENDING';
      s.matchId = g.matchId;
      p.sessionRuntime.activeSession = s;
      p.lockOnlineSettings(true);
      document.querySelectorAll('.screen').forEach(x => x.classList.remove('active'));
      document.getElementById('game').classList.add('active');
      p.showPvpResult();
      return {
        state: window.OnlineRuntime?.debug?.().state,
        menuExists: !!document.getElementById('pvpResultMenu'),
        locked: document.getElementById('leagueMode').disabled,
        connected: probe.deck.p2p.connected
      };
    });
    assert.deepEqual(before, { state: 'ENDING', menuExists: true, locked: true, connected: true });
    await page.locator('#pvpResultMenu').click();
    const after = await page.evaluate(() => ({
      state: window.OnlineRuntime?.debug?.().state,
      activeSession: window.regressionProbe.sessionRuntime.activeSession !== null,
      setup: document.getElementById('setup')?.classList.contains('active'),
      game: document.getElementById('game')?.classList.contains('active'),
      modal: document.getElementById('modal')?.classList.contains('open'),
      settingsUnlocked: [
        ...document.querySelectorAll('#variance, #difficulty, #leagueMode, .leagueTab, .composition-choice')
      ].every(el => !el.disabled),
      connected: probe.deck.p2p.connected,
      matchId: probe.deck.p2p.matchId,
      oldGameCleared: probe.battle.game === null
    }));
    assert.deepEqual(after, {
      state: 'IDLE', activeSession: false, setup: true, game: false, modal: false,
      settingsUnlocked: true, connected: false, matchId: null, oldGameCleared: true
    });
    return { before, after };
  });

  await run('CLK-01: traitless ally shares suppression domain and computed desaturation', async () => {
    await load();
    const data = await page.evaluate(async () => {
      const g = Megaleague.newGame(
        ['timeora', 'toxious', 'turtle', 'mole'],
        ['timeora', 'abigate', 'hermit', 'mushroom'],
        { mode: 'ai', variance: false, seed: 'notrait' }
      );
      g.order = [['P', 0], ['A', 0], ['P', 1], ['A', 1]];
      g.turn = 0; g.turnSerial = 0; g.preparedKey = null;
      probe.battle.game = g;
      document.querySelectorAll('.screen').forEach(x => x.classList.remove('active'));
      document.getElementById('game').classList.add('active');
      const owner = g.teams.P.field[0], ally = g.teams.P.field[1], enemy = g.teams.A.field[1];
      owner.timeHourDeg = 90; owner.timeMinuteDeg = 90;
      g.teams.A.field[0].timeHourDeg = 0; g.teams.A.field[0].timeMinuteDeg = 40;
      probe.actions.prepareCurrentTurn(g);
      probe.render();
      await new Promise(resolve => setTimeout(resolve, 450));
      probe.render();
      const domain = window.regressionProbe.timeCurrentSuppressionDomain(g);
      const cards = [...document.querySelectorAll('.arena .battle-unit-card[data-zone="field"]')]
        .map(el => ({
          slot: el.dataset.team + el.dataset.slot,
          filter: getComputedStyle(el).filter,
          suppressedClass: el.classList.contains('clock-trait-suppressed')
        }));
      window.regressionFixture = g;
      return {
        ownerUid: String(owner.uid), allyUid: String(ally.uid), enemyUid: String(enemy.uid),
        suppressedUids: [...domain.suppressedUids], cards
      };
    });
    assert.ok(!data.suppressedUids.includes(data.ownerUid));
    assert.ok(data.suppressedUids.includes(data.allyUid), 'traitless toxious not suppressed by domain');
    assert.ok(data.suppressedUids.includes(data.enemyUid));
    const cards = Object.fromEntries(data.cards.map(card => [card.slot, card]));
    assert.equal(cards.P0.filter, 'none');
    assert.equal(cards.P1.filter, 'saturate(0.33)');
    assert.equal(cards.P1.suppressedClass, true);
    assert.equal(cards.A1.filter, 'saturate(0.33)');
    await page.screenshot({ path: 'artifacts/regression/clk-traitless.png', fullPage: true });
    return data;
  });

  await run('CLK-02: cancel both alignments and exclude dead traitless field unit', async () => {
    const data = await page.evaluate(() => {
      const g = window.regressionFixture;
      const p = window.regressionProbe;
      const toxious = g.teams.P.field[1];
      toxious.dead = true;
      const afterDeath = p.timeCurrentSuppressionDomain(g);
      const excludesDead = !afterDeath?.suppressedUids?.has(String(toxious.uid));
      toxious.dead = false;
      const enemy = g.teams.A.field[0];
      enemy.timeHourDeg = 90;
      enemy.timeMinuteDeg = 90;
      const afterBoth = p.timeCurrentSuppressionDomain(g);
      return { excludesDead, bothCancel: afterBoth === null };
    });
    assert.deepEqual(data, { excludesDead: true, bothCancel: true });
    return data;
  });

  await run('CLK-03: visual lease includes traitless ally and releases independently', async () => {
    const data = await page.evaluate(() => {
      const g = window.regressionFixture;
      g.teams.A.field[0].timeHourDeg = 0;
      g.teams.A.field[0].timeMinuteDeg = 40;
      const owner = g.teams.P.field[0];
      const lease = window.regressionProbe.timeClockVisualSaturation.acquire(
        g, [{ clocks: [{ uid: owner.uid, team: 'P', blocked: false, aligned: true }] }]
      );
      const ally = document.querySelector('.arena .battle-unit-card[data-team="P"][data-slot="1"]');
      const held = ally?.classList.contains('clock-visual-saturation-held');
      const active = document.body.classList.contains('time-clock-visual-saturation-active');
      lease.release();
      return {
        held, active,
        released: !ally?.classList.contains('clock-visual-saturation-held'),
        inactive: !document.body.classList.contains('time-clock-visual-saturation-active')
      };
    });
    assert.deepEqual(data, { held: true, active: true, released: true, inactive: true });
    return data;
  });

  await run('VIS-01: small and large clock needles have proportional computed widths', async () => {
    await load();
    const data = await page.evaluate(() => {
      const holder = document.createElement('div');
      holder.dataset.regressionClock = 'true';
      holder.style.cssText = 'position:fixed;z-index:99999;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:space-around;background:#101525';
      document.body.appendChild(holder);
      const small = document.createElement('div');
      small.className = 'time-mini-clock gold';
      small.dataset.clockSize = 'small';
      small.style.flex = '0 0 82px';
      small.innerHTML = '<span class="time-clock-hand hour" style="transform:translateX(-50%) rotate(90deg)"></span><span class="time-clock-hand minute" style="transform:translateX(-50%) rotate(90deg)"></span><span class="time-clock-pin"></span>';
      holder.appendChild(small);
      for (const [size, theme, degrees] of [['large', 'blue', 90], ['opposite', 'red', 180]]) {
        const face = window.regressionProbe.timeClockFaceNode(theme, size === 'opposite' ? 0 : degrees, degrees);
        face.dataset.clockSize = size;
        face.style.cssText = 'position:relative;inset:auto;width:320px;height:320px;flex:0 0 320px;';
        holder.appendChild(face);
      }
      return [...holder.querySelectorAll('[data-clock-size]')].map(root => ({
        size: root.dataset.clockSize,
        hands: [...root.querySelectorAll('.time-clock-hand')].map(el => {
          const c = getComputedStyle(el);
          const width = Number.parseFloat(c.width), height = Number.parseFloat(c.height);
          return { kind: el.classList.contains('hour') ? 'hour' : 'minute', width, height, ratio: width / height };
        })
      }));
    });
    for (const item of data) {
      assert.equal(item.hands.length, 2);
      for (const hand of item.hands) {
        assert.ok(hand.width > 0 && hand.height > 0, JSON.stringify({ size: item.size, hand }));
        assert.ok(Math.abs(hand.ratio - .3) < .02, JSON.stringify({ size: item.size, hand }));
      }
      assert.ok(item.hands[1].width > item.hands[0].width, item.size);
    }
    await page.locator('[data-regression-clock]').screenshot({ path: 'artifacts/regression/clock-hands-2x.png' });
    return data;
  });

  assert.deepEqual(errors, [], 'uncaught browser page errors');
} catch (error) {
  results.push({ name: 'runner', status: 'FAIL', error: String(error), stack: error?.stack });
} finally {
  await fs.writeFile('artifacts/regression/results.json', JSON.stringify({ gitBase: '970d83ec9466129cedc4b05f27395511e03c91aa', results, errors }, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
const failures = results.filter(r => r.status !== 'PASS');
console.log(JSON.stringify({ passed: results.length - failures.length, failed: failures.length, results: results.map(r => ({ name: r.name, status: r.status })) }, null, 2));
if (failures.length) process.exitCode = 1;
