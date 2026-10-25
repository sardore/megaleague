/* 전술 퍼즐 검증: node tools/check-puzzles.js
   퍼즐은 즉석에서 만들어지므로 데이터 파일이 아니라 "생성기·버퍼·판정·화면"을 검증한다.
   생성에 시간이 걸리므로 몇 분 걸릴 수 있다. */
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
const bundle = await build({ entryPoints: ['tests/helpers/puzzle-probe.js'], bundle: true, write: false, outdir: 'probe', loader: { '.css': 'empty' }, format: 'iife' });
const html = (await fs.readFile('index.html', 'utf8')).replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/, '<script src="/probe.js"></script>');
const server = http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/probe.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (u === '/') { res.end(html); return; }
  try { res.end(await fs.readFile('.' + u)); } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
let passed = 0;
async function check(name, run) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } }), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.probe?.puzzleUi);
    await page.waitForSelector('#startupIntro', { state: 'detached', timeout: 30000 });
    await run(page);
    assert.deepEqual(errors, []);
    passed++;
    console.log('ok -', name);
  } catch (e) { console.error('FAIL', name, e); process.exitCode = 1; } finally { await page.close(); }
}
try {
  await check('생성: 즉석에서 만들어지고 단계가 오를수록 어려워지며 리그가 다양하다', async page => {
    const out = await page.evaluate(async () => {
      window.__defs = [];
      const supply = new probe.supplyClass({ seed: 'check-1', makeDecks: (r, league, comp) => ({ p: probe.randomBattleDeck(r, league, comp), a: probe.randomBattleDeck(r, league, comp) }) });
      supply.prefetch(2);
      let blocked = 0, last = performance.now();
      const iv = setInterval(() => { const n = performance.now(); blocked = Math.max(blocked, n - last); last = n; }, 5);
      for (let level = 1; level <= 5; level++) window.__defs.push(await supply.request(level));
      clearInterval(iv);
      return { defs: window.__defs.map(d => ({ aiBlunder: d.aiBlunder, id: d.id, level: d.level, league: d.league, comp: d.comp, moves: d.moves, bits: d.bits, energy: d.energy.length, hasProof: !!d.proof && !!d.startSig })), blocked };
    });
    assert.equal(new Set(out.defs.map(d => d.id)).size, 5);
    assert.ok(out.defs.every(d => d.hasProof && d.energy >= 8 && d.moves >= 1 && d.bits > 0));
    assert.ok(Math.max(out.defs[3].moves, out.defs[4].moves) > out.defs[0].moves, `difficulty must rise: ${out.defs.map(d => d.moves)}`);
    assert.ok(new Set(out.defs.map(d => d.league + (d.comp || ''))).size >= 3, 'leagues vary');
    assert.ok(out.defs.filter(d => d.aiBlunder === true).length >= 1, 'traps: AI\'s natural move should often be wrong ' + JSON.stringify(out.defs.map(d => d.aiBlunder)));
    assert.ok(out.defs.every(d => d.moves >= 2) || out.defs.slice(1).every(d => d.moves >= 2), 'no trivial one-move puzzles after the first');
    assert.ok(out.blocked < 700, `generation must not freeze the page (longest block ${Math.round(out.blocked)}ms)`);
  });
  await check('재현·완전 풀이: 증명대로 두면 패배 없이 이기고, 오답은 거부된다', async page => {
    const out = await page.evaluate(async () => {
      const supply = new probe.supplyClass({ seed: 'check-2', makeDecks: (r, league, comp) => ({ p: probe.randomBattleDeck(r, league, comp), a: probe.randomBattleDeck(r, league, comp) }) });
      const defs = [];
      for (let level = 1; level <= 3; level++) defs.push(await supply.request(level));
      const res = [];
      for (const d of defs) {
        const g = probe.puzzle.buildPuzzleGame(d);   // 시작 서명이 다르면 여기서 throw
        const before = probe.puzzle.proofStats.slow;
        let guard = 0, rejected = 0, strictFirst = null;
        while (!g.winner && guard++ < 300) {
          const [t, s] = g.order[g.turn];
          const acts = probe.solver.currentActions(g);
          if (!acts.length) { probe.endTurn(g, t, s, false); continue; }
          if (t === 'P') {
            if (acts.length === 1 && ['scheduled', 'speedDelay', 'noLegalPass'].includes(acts[0].type)) { probe.execute(g, t, s, acts[0], { __puzzleInternal: true }); continue; }
            const verdicts = acts.map(a => ({ a, v: probe.puzzle.reviewMove(g, a) }));
            const good = verdicts.filter(x => x.v.ok);
            if (!good.length) { res.push({ id: d.id, err: 'no winning move' }); break; }
            rejected += verdicts.length - good.length;
            probe.execute(g, t, s, good[0].a, { __puzzleInternal: true });
            g.puzzle.budget--;
          } else {
            const a = probe.puzzle.chooseDefense(g);
            probe.execute(g, t, s, a || acts[0], { __puzzleInternal: true });
          }
        }
        res.push({ id: d.id, winner: g.winner, slow: probe.puzzle.proofStats.slow - before, rejected });
      }
      return res;
    });
    assert.ok(out.every(r => !r.err && r.winner === 'P'), JSON.stringify(out));
    assert.ok(out.every(r => r.slow === 0), 'solution tree must be fully covered by the proof: ' + JSON.stringify(out));
    assert.ok(out.every(r => r.rejected >= 1), 'each puzzle must have wrong moves: ' + JSON.stringify(out));
  });
  await check('에너지: 양 진영이 하나의 사전배열에서 순서대로 뽑는다', async page => {
    const r = await page.evaluate(async () => {
      const supply = new probe.supplyClass({ seed: 'check-3', makeDecks: (r, league, comp) => ({ p: probe.randomBattleDeck(r, league, comp), a: probe.randomBattleDeck(r, league, comp) }) });
      const d = await supply.request(1);
      const g = probe.puzzle.buildPuzzleGame(d);
      const q = g.puzzle.energy, list = [...q.list];
      const gained = { P: [], A: [] };
      let guard = 0;
      while (!g.winner && guard++ < 200 && gained.P.length + gained.A.length < 6) {
        const [t, s] = g.order[g.turn];
        const acts = probe.solver.currentActions(g);
        const gather = acts.find(a => a.type === 'gather');
        if (!gather) { const a = acts[0]; if (!a) { probe.endTurn(g, t, s, false); continue; } probe.execute(g, t, s, a, { __puzzleInternal: true }); continue; }
        const u = g.teams[t].field[s];
        const count = () => ({ R: 0, W: 0, B: 0, ...u.energy.reduce((n, e) => (n[e.c] = (n[e.c] || 0) + (e.n ?? 1), n), {}) });
        const before = q.pos;
        probe.execute(g, t, s, gather, { __puzzleInternal: true });
        gained[t].push(q.pos - before);
      }
      return { gained, pos: q.pos, listUnchanged: JSON.stringify(list) === JSON.stringify(q.list) };
    });
    assert.ok(r.listUnchanged && r.pos > 0, JSON.stringify(r));
    assert.ok(r.gained.P.length + r.gained.A.length >= 2, JSON.stringify(r));
  });
  await check('화면 지불: 합법인 기술은 지불 선택창에서 반드시 만들 수 있다(특성으로 W를 색 대신 내는 경우 포함)', async page => {
    const out = await page.evaluate(() => {
      const leagues = [['two', null], ['regular', null], ['comprehensive', '2234'], ['comprehensive', '2335'], ['mega', null], ['duel', null]];
      let checked = 0; const bad = [];
      for (let gi = 0; gi < 18; gi++) {
        const [league, comp] = leagues[gi % 6];
        const r = new probe.RNG('reach-' + gi);
        const base = probe.generator.makeBase({ seed: 'reach-' + gi, league, comp, p: probe.randomBattleDeck(r, league, comp), a: probe.randomBattleDeck(r, league, comp) });
        const g = probe.puzzle.buildPuzzleGame(base);
        let guard = 0;
        while (!g.winner && guard++ < 400) {
          const [t, s] = g.order[g.turn];
          const acts = probe.solver.currentActions(g);
          if (!acts.length) { probe.endTurn(g, t, s, false); continue; }
          if (t === 'P' && acts.length > 1) {
            const u = g.teams.P.field[s];
            const groups = new Map();
            for (const a of acts) if (a.type === 'skill') (groups.get(a.skill) || groups.set(a.skill, []).get(a.skill)).push(a);
            for (const [skill, list] of groups) {
              const tr0 = probe.energy.transformedSkillReq(g, t, u, probe.paymentCostForAction(u, list[0]));
              if (!(tr0.req.any > 0 || tr0.req.wb > 0 || tr0.req.rb > 0)) continue;
              checked++;
              const store = probe.energy.energyStore(u, list[0].actor || null), n = Math.min(store.length, 12);
              let ok = false;
              for (let mask = 1; mask < (1 << n) && !ok; mask++) {
                const c = { R: 0, W: 0, B: 0 };
                for (let i = 0; i < n; i++) if (mask & (1 << i)) c[store[i].c] += Number(store[i].a || 0);
                ok = list.some(a => {
                  const tr = probe.energy.transformedSkillReq(g, t, u, probe.paymentCostForAction(u, a));
                  const need = Object.values(tr.req).reduce((x, y) => x + Number(y || 0), 0);
                  if (Math.abs(c.R + c.W + c.B - need) > .001 || !probe.energy.reqAcceptsCounts(tr.req, c, u)) return false;
                  const p = a.paymentPlan;
                  return !(p && (Math.abs(Number(p.R || 0) - c.R) > .001 || Math.abs(Number(p.W || 0) - c.W) > .001 || Math.abs(Number(p.B || 0) - c.B) > .001));
                });
              }
              if (!ok) bad.push({ league, skill, unit: u.name, store: store.map(e => e.c + e.a).join(',') });
            }
          }
          const view = probe.maskedStateFor(g, t); view.puzzle = g.puzzle;
          const pick = probe.chooseAI(view, t, s, true);
          let idx = pick ? acts.findIndex(x => probe.solver.actionKeyOf(x) === probe.solver.actionKeyOf(pick)) : -1; if (idx < 0) idx = 0;
          probe.execute(g, t, s, acts[idx], { __puzzleInternal: true });
        }
      }
      return { checked, bad };
    });
    assert.ok(out.checked > 100, 'enough payment situations were examined: ' + out.checked);
    assert.deepEqual(out.bad, []);
  });
  await check('화면: 보스전 버튼 없음 · 오답 3번이면 게임 오버 · 정답이면 다음 퍼즐(미리 만들어 둠)', async page => {
    assert.equal(await page.evaluate(() => !!document.getElementById('bossRaidBtn') || [...document.querySelectorAll('button')].some(b => /보스/.test(b.textContent) && b.offsetParent)), false);
    await page.evaluate(() => document.getElementById('puzzleBtn').click());
    await page.click('#puzzleStart');
    await page.waitForSelector('#puzzleHud:not([hidden])', { timeout: 120000 });
    const info = () => page.evaluate(() => ({
      lives: document.querySelectorAll('.puzzle-lives i.on').length,
      title: document.getElementById('actionTitle').textContent,
      level: document.querySelector('.puzzle-hud-top b')?.textContent
    }));
    assert.equal((await info()).lives, 3);
    const wrongOnce = () => page.evaluate(() => {
      const g = probe.battleState.game, [t, s] = g.order[g.turn];
      const bad = probe.solver.currentActions(g).find(a => !probe.puzzle.reviewMove(g, a).ok);
      const sig = probe.solver.signature(g);
      const ok = probe.execute(g, t, s, bad);
      return { executed: ok, same: probe.solver.signature(g) === sig, hasBad: !!bad };
    });
    for (let i = 0; i < 3; i++) {
      const r = await wrongOnce();
      assert.ok(r.hasBad && r.executed === false && (i === 2 || r.same), JSON.stringify(r)); // 세 번째 오답은 게임 오버(패배 처리)
      assert.equal((await info()).lives, 2 - i);
    }
    await page.waitForSelector('#puzzleRetry');
    await page.click('#puzzleRetry');
    await page.waitForFunction(() => /퍼즐 1/.test(document.querySelector('.puzzle-hud-top b')?.textContent || '') && document.querySelectorAll('.puzzle-lives i.on').length === 3 && !document.getElementById('modal').classList.contains('open'), null, { timeout: 120000 });
    // 정답으로 푼다(게이트를 통과하는 실제 execute)
    await page.evaluate(() => {
      const g = probe.battleState.game;
      let guard = 0;
      while (!g.winner && guard++ < 300) {
        const [t, s] = g.order[g.turn], acts = probe.solver.currentActions(g);
        if (!acts.length) { probe.endTurn(g, t, s, false); continue; }
        if (t === 'P') { const good = acts.find(a => probe.puzzle.reviewMove(g, a).ok) || acts[0]; probe.execute(g, t, s, good); }
        else probe.execute(g, t, s, probe.puzzle.chooseDefense(g) || acts[0]);
      }
      probe.render();
    });
    await page.waitForFunction(() => document.getElementById('actionTitle').textContent === '정답!', null, { timeout: 30000 });
    // 클릭 없이 자동으로 다음 퍼즐로 넘어간다
    await page.waitForFunction(() => /퍼즐 2/.test(document.querySelector('.puzzle-hud-top b')?.textContent || '') && document.querySelectorAll('.puzzle-lives i.on').length === 3, null, { timeout: 180000 });
    assert.equal(await page.evaluate(() => document.querySelector('.arena').classList.contains('puzzle-fade')), false);
  });
  console.log(`${passed} puzzle checks passed`);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
