/* 전술 퍼즐 즉석 생성기(DOM 없음). 미리 만들어 둔 퍼즐은 없다.
   1) 리그·덱·에너지 사전배열을 무작위로 정해 한 판을 AI끼리 끝까지 둔다(scanGame).
   2) 플레이어 차례의 국면 중 "플레이어가 k수 안에 승리를 강제할 수 있는" 국면을 솔버로 찾는다(후보).
   3) 고른 후보의 풀이 증명(정답 수/최선 방어 표)을 만든다(provePuzzle).
   무엇을 언제 만들지는 puzzle-supply.js 가 맡는다. 계산은 시간 조각으로 쪼개 화면을 멈추지 않는다
   (ctx.pace: 조각 길이와 쉬는 시간 — 상황에 따라 바뀐다). */
import { RNG } from "../engine/entities.js";
import { chooseAI } from "../ai/specialists.js";
import { maskedStateFor } from "../ai/search.js";
import { prepareCurrentTurn } from "../engine/actions.js";
import { execute, endTurn } from "../engine/execution.js";
import { buildPuzzleGame, puzzleBudget } from "./tactics-puzzle.js";
import { TacticsSolver, cloneForSolve, currentActions, applyAction, signature, actionKeyOf, isForcedList, passTurn } from "./tactics-solver.js";

/* 리그 슬롯: 퍼즐마다 다른 리그의 전투가 나오도록 번갈아 고른다. */
export const PUZZLE_LEAGUE_SLOTS = [{
  league: "two",
  comp: null
}, {
  league: "regular",
  comp: null
}, {
  league: "comprehensive",
  comp: "2234"
}, {
  league: "comprehensive",
  comp: "2335"
}, {
  league: "mega",
  comp: null
}, {
  league: "duel",
  comp: null
}];
const ENERGY_LENGTH = 24;
const SCAN_TAIL = 9;
const SCAN_CAP = 500;
export const MAX_MOVES = 6;
const SCAN_MAX_K = 4;
export { SCAN_MAX_K };
const PROOF_CAP = 8000;
/* 난이도 단계 → 요구 조건. moves: 강제승까지 필요한 플레이어의 수, bits: 풀이 줄에서 요구되는 "정보량"(오답이 섞여 있는 정도). */
export function levelSpec(level) {
  const n = Math.max(1, Math.floor(level));
  return {
    level: n,
    moves: Math.min(MAX_MOVES, [1, 2, 2, 3, 3, 4, 4, 5, 5][n - 1] ?? MAX_MOVES),
    minBits: Math.min(2.5, 0.2 + 0.18 * n)
  };
}
export function drawLeague(rng, avoid) {
  return rng.pick(PUZZLE_LEAGUE_SLOTS.filter(s => `${s.league}${s.comp || ""}` !== avoid));
}
/* 한 판의 재료. 덱은 호출한 쪽이 넘긴다(덱 구성 규칙은 UI 쪽에 있다). */
export function makeBase({
  seed,
  league,
  comp,
  p,
  a
}) {
  const r = new RNG(`${seed}:energy`);
  return {
    id: seed,
    league,
    comp: league === "comprehensive" ? comp : null,
    p,
    a,
    seed,
    energy: Array.from({
      length: ENERGY_LENGTH
    }, () => r.pick(["R", "W", "B"])),
    prelude: [],
    moves: 1
  };
}
export const CANCELLED = new Error("puzzle generation cancelled");
const now = () => performance.now();
const rest = ctx => new Promise(resolve => setTimeout(resolve, ctx.pace.gap));
/* 솔버 질의를 시간 조각으로 나눠 끝까지 돌린다. fn 은 undefined 가 아닌 값을 돌려줘야 한다. */
async function solve(ctx, solver, fn) {
  for (;;) {
    if (ctx.signal.cancelled) throw CANCELLED;
    const out = solver.slice(ctx.pace.slice, fn);
    if (out !== undefined) return out;
    await rest(ctx);
  }
}
/* 솔버 밖의 긴 반복문에서 시간 조각이 지났으면 쉰다. */
async function breathe(ctx) {
  if (ctx.signal.cancelled) throw CANCELLED;
  if (now() - (ctx.since ??= now()) > ctx.pace.slice) {
    await rest(ctx);
    ctx.since = now();
  }
}
/* 한 판을 AI 대 AI로 끝까지 두며 플레이어(P)가 고를 수 있는 국면을 기록한다. 수는 "합법 행동 목록의 번호"로 저장한다. */
export async function playOut(base, ctx, maxSteps = 700) {
  const g = buildPuzzleGame(base);
  const snaps = [],
    prelude = [];
  let steps = 0;
  while (!g.winner && steps < maxSteps) {
    await breathe(ctx);
    const [t, s] = g.order[g.turn];
    const acts = currentActions(g);
    if (t === "P" && acts.length > 1) snaps.push({
      at: prelude.length,
      state: cloneForSolve(g)
    });
    if (!acts.length) {
      prelude.push(-1);
      endTurn(g, t, s, false);
      steps++;
      continue;
    }
    const view = maskedStateFor(g, t);
    view.puzzle = g.puzzle;
    const pick = chooseAI(view, t, s, true);
    let idx = pick ? acts.findIndex(x => actionKeyOf(x) === actionKeyOf(pick)) : -1;
    if (idx < 0) idx = 0;
    prelude.push(idx);
    if (!execute(g, t, s, acts[idx], {
      __puzzleInternal: true
    })) return null;
    steps++;
  }
  return {
    snaps,
    prelude,
    winner: g.winner
  };
}
/* 풀이 증명: 정답 수만 따라가며 모든 국면의 판정(플레이어)과 최선 방어(적)를 기록한다. 국면 서명으로 찾는다.
   국면 하나를 펼치는 일(expand)이 시간 조각의 단위이며, 중단되면 그 국면만 다시 펼친다. */
export async function provePuzzle(def, ctx, cap = PROOF_CAP) {
  const g0 = buildPuzzleGame(def);
  const solver = new TacticsSolver({
    maxNodes: cap,
    order: "engine"
  });
  const nodes = {};
  const stats = {
    bits: 0,
    maxGood: 0
  };
  const advance = g => {
    while (!g.winner) {
      const acts = currentActions(g);
      if (!acts.length) {
        g = passTurn(g);
        continue;
      }
      if (isForcedList(acts)) {
        g = applyAction(g, acts[0]);
        continue;
      }
      break;
    }
    return g;
  };
  const FAIL = {
    fail: true
  };
  const expand = ({
    g,
    left,
    main
  }) => {
    g = advance(g);
    if (g.winner) return {
      children: []
    };
    prepareCurrentTurn(g);
    const sig = signature(g);
    if (nodes[sig]) return {
      children: []
    };
    const [t] = g.order[g.turn];
    const acts = currentActions(g);
    if (t === "P") {
      const w = [],
        l = [],
        winners = [];
      for (const a of acts) {
        const c = applyAction(g, a);
        if (!c) continue;
        /* 서명은 솔버가 그 국면을 건드리기(턴 준비) 전에 읽는다 — 실행 중 판정은 건드리기 전 복제본의 서명으로 찾는다. */
        const after = signature(c);
        const ok = solver.wins(c, left - 1);
        if (solver.interrupted) return null;
        (ok ? w : l).push(after);
        if (ok) winners.push(c);
      }
      if (solver.exhausted || !winners.length) return FAIL;
      return {
        sig,
        rec: {
          w,
          l
        },
        good: w.length,
        legal: acts.length,
        main,
        children: winners.map((c, i) => ({
          g: c,
          left: left - 1,
          main: main && i === 0
        }))
      };
    }
    const best = solver.bestDefense(g, left);
    if (solver.interrupted) return null;
    if (solver.exhausted || !best || !Number.isFinite(best.d)) return FAIL;
    const c = applyAction(g, best.a);
    return {
      sig,
      rec: {
        d: signature(c)
      },
      children: [{
        g: c,
        left,
        main
      }]
    };
  };
  const stack = [{
    g: g0,
    left: puzzleBudget(def),
    main: true
  }];
  try {
    while (stack.length) {
      const item = stack.pop();
      const r = (await solve(ctx, solver, () => expand(item) ?? undefined)) ?? null;
      if (r === FAIL || r.fail) return null;
      if (r.sig && !nodes[r.sig]) {
        nodes[r.sig] = r.rec;
        if (r.good) {
          stats.maxGood = Math.max(stats.maxGood, r.good);
          if (r.main) stats.bits += Math.log2(r.legal / r.good);
        }
      }
      for (let i = r.children.length - 1; i >= 0; i--) stack.push(r.children[i]);
    }
  } finally {
    ctx.proofNodes = (ctx.proofNodes || 0) + solver.nodes;
  }
  prepareCurrentTurn(g0);
  return {
    proof: nodes,
    startSig: signature(g0),
    bits: stats.bits,
    maxGood: stats.maxGood
  };
}
/* 한 판을 두고 후보 국면을 모은다. 플레이어가 이긴 판만 본다(진 판의 끝 국면에는 강제승이 없다).
   후보: 판을 되살리는 값 + moves(강제승까지의 수). 같은 수의 후보는 판의 끝에 가까운 것 하나만 남긴다. */
export async function scanGame(game, ctx, {
  maxK = SCAN_MAX_K,
  stopAt = 0
} = {}) {
  const base = makeBase({
    seed: game.gameSeed,
    league: game.league,
    comp: game.comp,
    p: game.p,
    a: game.a
  });
  const res = await playOut(base, ctx);
  if (!res || res.winner !== "P") return [];
  const found = new Map();
  for (const sn of res.snaps.slice(-SCAN_TAIL).reverse()) {
    const solver = new TacticsSolver({
      maxNodes: SCAN_CAP,
      order: "engine"
    });
    const d = await solve(ctx, solver, () => solver.distance(sn.state, maxK));
    ctx.scanNodes = (ctx.scanNodes || 0) + solver.nodes;
    if (solver.exhausted || !Number.isFinite(d) || d < 1 || found.has(d)) continue;
    found.set(d, {
      ...base,
      prelude: res.prelude.slice(0, sn.at),
      moves: d,
      cost: solver.nodes
    });
    if (d === stopAt) break; // 필요한 국면을 찾았으면 더 보지 않는다
  }
  return [...found.values()];
}
/* 증명이 끝난 퍼즐 정의. 첫 수부터 오답이 있어야 퍼즐이다(어느 수를 둬도 이기는 국면은 null). */
export function finishPuzzle(def, proved, level) {
  const root = proved.proof[proved.startSig];
  if (!root || !root.w.length || !root.l.length) return null;
  return {
    ...def,
    id: `${def.id}-${def.moves}`,
    level,
    proof: proved.proof,
    startSig: proved.startSig,
    bits: proved.bits,
    maxGood: proved.maxGood
  };
}
export const URGENT_PACE = {
  slice: 30,
  gap: 0
};
export const BACKGROUND_PACE = {
  slice: 8,
  gap: 24
};
