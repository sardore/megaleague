/* 전술 퍼즐 — 엔진 쪽(게임 구성·판정·적 방어).
   퍼즐 정의(def)는 다음 값으로 한 국면을 완전히 되살린다.
     { id, league, comp, p:[덱], a:[덱], seed, energy:[색…], prelude:[행동 번호…], moves }
   prelude 는 같은 규칙으로 두 진영이 둔 수이며, 그 끝이 퍼즐의 출발 국면이다.
   퍼즐의 목표는 "패배하지 않고 적을 전멸시키는 것"이다. moves 는 가장 빠른 풀이의 수(난이도 지표)이고,
   판정에 쓰는 끝없는 지연 방지 한도(budget)는 moves + PUZZLE_SLACK 이다. */
import { newGame } from "../engine/entities.js";
import { execute, endTurn } from "../engine/execution.js";
import { puzzleHooks } from "../engine/puzzle-rules.js";
import { prepareCurrentTurn, unitAt } from "../engine/actions.js";
import { actionSkillHasEffect, actionSkillHasTag, skillOf } from "../engine/entities.js";
import { TacticsSolver, cloneForSolve, currentActions, applyAction, isForcedList, signature } from "./tactics-solver.js";

export const PUZZLE_MAX_NODES = 600000;
/* 가장 빠른 풀이보다 이만큼까지는 늦게 이겨도 정답으로 본다. */
export const PUZZLE_SLACK = 1;
export const puzzleBudget = def => def.moves + PUZZLE_SLACK;
export function buildPuzzleGame(def) {
  const g = newGame(def.p, def.a, {
    seed: def.seed,
    variance: false,
    difficulty: "normal",
    mode: "human",
    league: def.league,
    leagueComposition: def.league === "comprehensive" ? def.comp || "2234" : null,
    plusStar: {
      P: null,
      A: null
    }
  });
  g.puzzle = {
    id: def.id,
    budget: puzzleBudget(def),
    energy: {
      list: [...def.energy],
      pos: 0
    }
  };
  for (const team of ["P", "A"]) for (const u of [...g.teams[team].field, ...g.teams[team].bench]) if (u && !g.revealed[team].includes(u.uid)) g.revealed[team].push(u.uid);
  /* prelude: 그 시점 합법 행동 목록의 번호(-1은 행동 불가로 턴을 넘김). 같은 엔진이면 같은 국면이 재현된다. */
  for (const idx of def.prelude || []) {
    const [t, s] = g.order[g.turn];
    const acts = currentActions(g);
    const ok = g.winner ? false : idx < 0 ? endTurn(g, t, s, false) !== false : !!acts[idx] && execute(g, t, s, acts[idx], {
      __puzzleInternal: true
    });
    if (!ok) throw new Error(`puzzle prelude failed: ${def.id}`);
  }
  g.puzzle.budget = puzzleBudget(def);
  registerProof(def);
  prepareCurrentTurn(g);
  if (def.startSig && signature(g) !== def.startSig) throw new Error(`puzzle start mismatch: ${def.id}`);
  return g;
}
/* 미리 계산해 둔 풀이(proof). 국면 서명 → 그 국면에서의 판정.
     플레이어 국면: { w:[정답 수 이후 서명…], l:[오답 수 이후 서명…] }
     적 국면:       { d: 최선 방어 이후 서명 }
   서명이 일치하면 풀이를 다시 계산하지 않고 바로 판정한다. 일치하지 않는 국면(규칙이 바뀐 경우 등)은 솔버가 직접 푼다. */
const proofs = new Map();
export const proofStats = {
  fast: 0,
  slow: 0
};
export function registerProof(def) {
  if (def?.proof) proofs.set(def.id, def.proof);
}
function proofNodeFor(g) {
  const table = proofs.get(g.puzzle?.id);
  return table ? table[signature(g)] || null : null;
}
/* 퍼즐마다 풀이 캐시(전치표)를 하나만 둔다. 같은 국면은 다시 계산하지 않는다. */
const solvers = new Map();
export function solverFor(g) {
  const id = g.puzzle?.id || "-";
  let s = solvers.get(id);
  if (!s || s.tt.size > 600000) {
    s = new TacticsSolver({
      maxNodes: PUZZLE_MAX_NODES
    });
    solvers.set(id, s);
  }
  s.nodes = 0;
  s.exhausted = false;
  return s;
}
/* 지나간 퍼즐의 풀이 표와 솔버 기억을 비운다. */
export function resetPuzzleCaches() {
  solvers.clear();
  proofs.clear();
}
/* 플레이어의 수 판정: 그 수를 둔 결과 국면에서 남은 수 안에 승리를 강제할 수 있어야 정답. */
export function reviewMove(g, action, options = {}) {
  prepareCurrentTurn(g);
  const acts = currentActions(g);
  if (isForcedList(acts)) return {
    ok: true,
    counted: false
  };
  const result = applyAction(g, action, options);
  if (!result) return {
    ok: true,
    counted: false,
    illegal: true
  };
  const node = proofNodeFor(g);
  if (node?.w) {
    const after = signature(result);
    if (node.w.includes(after)) {
      proofStats.fast++;
      return {
        ok: true,
        counted: true
      };
    }
    if (node.l.includes(after)) {
      proofStats.fast++;
      return {
        ok: false,
        counted: true
      };
    }
  }
  proofStats.slow++;
  const solver = solverFor(g);
  const ok = solver.wins(result, g.puzzle.budget - 1);
  return {
    ok: ok || solver.exhausted,
    counted: true,
    exhausted: solver.exhausted
  };
}
/* 적의 최선 방어. 플레이어가 이기는 데 가장 오래 걸리는 응수를 고른다(모든 합법 행동을 끝까지 따져서). */
export function chooseDefense(g) {
  prepareCurrentTurn(g);
  const node = proofNodeFor(g);
  if (node?.d) {
    for (const a of currentActions(g)) {
      const c = applyAction(g, a);
      if (c && signature(c) === node.d) {
        proofStats.fast++;
        return a;
      }
    }
  }
  proofStats.slow++;
  const solver = solverFor(g);
  const pick = solver.bestDefense(g, g.puzzle.budget);
  return pick?.a || null;
}
export { TacticsSolver, cloneForSolve, currentActions, applyAction, puzzleHooks, signature };

/* 플레이어가 화면에서 추가 선택(에너지 양·대상 에너지·변형 등)을 해야 하는 기술인가.
   풀이는 그런 선택을 기본값으로만 따지므로, 정답 줄에는 이런 기술을 넣지 않는다(화면에서 정답을 만들 수 없게 되는 일을 막는다). */
const CHOICE_EFFECTS = ["elixianShiningWind", "genociderDisplosion", "foxStrike", "mysticBurst", "hurricaneDive", "rampage", "lightCandelabra", "holyFlame", "abyssCannon", "abyssVortex", "lifeRain", "eternaHeal"];
export function hasPlayerChoice(g, t, s, a) {
  if (a?.type !== "skill") return false;
  const def = skillOf(unitAt(g, t, s), a.skill);
  return CHOICE_EFFECTS.some(effect => actionSkillHasEffect(a, effect)) || actionSkillHasTag(a, "copy") || !!def?.extraAnyEnergy || ["targetEnergyRemoval", "targetEnergyTransfer"].includes(def?.interaction?.kind);
}
