import { actionHeuristic } from "./specialists.js";
import { legalActions, unitAt } from "../engine/actions.js";
import { teamOf } from "../engine/combat.js";
import { status, totalEnergy, transformedSkillReq } from "../engine/energy.js";
import { RNG, actionSkillHasEffect, cardHasCapability, clone, skillIdByEffect, skillOf } from "../engine/entities.js";
import { endTurn, execute } from "../engine/execution.js";
import { timePaidAmountFromAction, timeRecallValue } from "../features/timeora.js";
import { systems } from "../runtime/systems.js";
export function initializeAiBossPlanner() {
  VERSION = "boss-timeora-rl-planner-r32";
  DECISION_BUDGET_MS = 2850;
  BASE_MODEL = {
    training: {
      opponents: "random-normal-ai-decks",
      episodes: 48,
      seed: 39026,
      wins: 43,
      losses: 5,
      draws: 0,
      actions: 4271
    },
    weights: {
      bias: 0.6255180969177222,
      bossHp: 6.052627878245241,
      playerHp: -7.019954318101187,
      bossAlive: 15.121582989567113,
      playerAlive: -14.03853533041765,
      bossEnergy: 2.245362727225574,
      playerEnergy: -0.9744065903740986,
      bossStatus: -0.428599063050634,
      playerStatus: 1.0904673258478315,
      aligned: 6.972877311074829,
      phaseDistance: -0.1838891778717741,
      playerOneCostTrap: 1.294282831950189,
      playerTwoCostTrap: 2.0925630824625485,
      recallValue: 1.5851251325909723,
      scheduled: 0.66,
      bossLowHp: -1.9499406520325624
    }
  };
  W = {
    ...BASE_MODEL.weights
  };
  mod12 = v => {
    const n = Math.round(Number(v) || 0) % 12;
    return n < 0 ? n + 12 : n;
  };
  alignedStep = s => {
    s = mod12(s);
    return s === 0 || s === 6;
  };
  phaseDistance = s => {
    s = mod12(s);
    return Math.min(s, 12 - s, Math.abs(s - 6));
  };
  bossUnit = (g, u, t = null) => !!(g?.bossRaid && u && !u.dead && (u.bossRed || (t || teamOf(g, u)) === "A" && cardHasCapability(u, "fateClock")));
  living = tm => [...(tm?.field || []), ...(tm?.bench || [])].filter(u => u && !u.dead);
  barrier = u => (u?.hpProtectionBarriers || []).reduce((n, b) => n + Math.max(0, Number(b?.amount) || 0), 0);
  ehp = u => u && !u.dead ? Math.max(0, Number(u.hp) || 0) + Math.max(0, Number(u.shield) || 0) + barrier(u) : 0;
  teamEhp = tm => living(tm).reduce((n, u) => n + ehp(u), 0);
  energy = u => {
    try {
      return Number(totalEnergy(u) || 0);
    } catch {
      return (u?.energy || []).reduce((n, e) => n + Number(e?.a || 0), 0);
    }
  };
  st = (u, k) => {
    try {
      return Number(status(u, k) || 0);
    } catch {
      return Number(u?.statuses?.[k] || u?.skillSeals?.[k] || 0);
    }
  };
  statusLoad = u => st(u, "burn") * 1.35 + st(u, "poison") * 1.5 + st(u, "paralyze") * 1.65 + st(u, "slow") * .82 + st(u, "freeze") * 2.2 + st(u, "traitSeal") * 2.65 + st(u, "skillSeal") * 2.05;
  clockInfo = g => {
    const c = g?.bossRaid?.sharedClock || {
      hourDeg: 0,
      minuteDeg: 90
    };
    const step = mod12(Math.round(((Number(c.hourDeg) || 0) - (Number(c.minuteDeg) || 0)) / 30));
    return {
      step,
      aligned: alignedStep(step),
      distance: phaseDistance(step),
      one: alignedStep(step + 1),
      two: alignedStep(step + 2)
    };
  };
}
let VERSION;
let DECISION_BUDGET_MS;
let BASE_MODEL;
let W;
let mod12;
let alignedStep;
let phaseDistance;
let bossUnit;
let living;
let barrier;
let ehp;
let teamEhp;
let energy;
let st;
let statusLoad;
let clockInfo;
function copyGame(g) {
  const c = clone(g);
  if (typeof RNG === "function") {
    const r = new RNG(1);
    r.s = Number(g?.rng?.s || 1) || 1;
    c.rng = r;
  }
  c.logs = [];
  return c;
}
function sim(g, t, s, a) {
  const c = copyGame(g);
  try {
    return execute(c, t, s, {
      ...a
    }, {
      sim: true
    }) ? c : null;
  } catch {
    return null;
  }
}
function featureVector(g) {
  const A = living(g?.teams?.A),
    P = living(g?.teams?.P),
    ph = clockInfo(g);
  let recall = 0,
    scheduled = 0,
    low = 0;
  for (const u of A) {
    if (!u.usedOnce?.[skillIdByEffect(u, "timeRecall")]) {
      try {
        recall = Math.max(recall, Number(timeRecallValue(u) || 0));
      } catch (error) {
        systems.__megaRecordRecoveredError(error, "bossTimeoraRLPlannerR32:L62");
      }
    }
    if (u.scheduledAction) scheduled++;
    if ((Number(u.hp) || 0) <= 80) low++;
  }
  return {
    bias: 1,
    bossHp: teamEhp(g?.teams?.A) / 100,
    playerHp: teamEhp(g?.teams?.P) / 100,
    bossAlive: A.length,
    playerAlive: P.length,
    bossEnergy: A.reduce((n, u) => n + energy(u), 0),
    playerEnergy: P.reduce((n, u) => n + energy(u), 0),
    bossStatus: A.reduce((n, u) => n + statusLoad(u), 0),
    playerStatus: P.reduce((n, u) => n + statusLoad(u), 0),
    aligned: ph.aligned ? 1 : 0,
    phaseDistance: ph.distance,
    playerOneCostTrap: ph.one ? 1 : 0,
    playerTwoCostTrap: ph.two ? 1 : 0,
    recallValue: recall / 100,
    scheduled,
    bossLowHp: low
  };
}
function dot(f, w = W) {
  let v = 0;
  for (const [k, x] of Object.entries(f)) v += (Number(w[k]) || 0) * (Number(x) || 0);
  return v;
}
function baseValue(g) {
  if (g?.winner) return g.winner === "A" ? 1e6 : g.winner === "P" ? -1e6 : 0;
  return dot(featureVector(g));
}
function actionKey(a) {
  return [a?.type, a?.skill, a?.costOverride, a?.target?.team, a?.target?.slot, a?.target?.uid, a?.extraW, JSON.stringify(a?.paymentPlan || null), JSON.stringify(a?.split || null)].join("|");
}
function paidUnits(g, t, u, a) {
  if (a?.type !== "skill") return 0;
  try {
    const n = Number(timePaidAmountFromAction(g, t, u, a) || 0);
    if (n > 0) return Math.ceil(n - 1e-9);
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "bossTimeoraRLPlannerR32:L101");
  }
  try {
    const sk = skillOf(u, a.skill),
      cost = a.costOverride ?? sk?.cost ?? "";
    return Math.ceil((transformedSkillReq(g, t, u, cost)?.tokens?.length || 0) + Number(a.extraW || 0));
  } catch {
    return a.costOverride === "**" ? 2 : a.costOverride === "*" ? 1 : 0;
  }
}
function expanded(g, t, s) {
  const u = unitAt(g, t, s),
    raw = legalActions(g, t, s) || [],
    out = [];
  for (const a of raw) {
    if (a?.type === "gather" && bossUnit(g, u, t)) {
      out.push({
        ...a,
        timeAccelerationChoice: "keep"
      }, {
        ...a,
        timeAccelerationChoice: "reroll"
      });
    } else out.push(a);
  }
  const seen = new Set();
  return out.filter(a => {
    const k = actionKey(a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function transitionDanger(before, after) {
  const bA = living(before.teams.A),
    aA = living(after.teams.A);
  const hpLoss = Math.max(0, teamEhp(before.teams.A) - teamEhp(after.teams.A));
  const deaths = Math.max(0, bA.length - aA.length);
  const statusGain = Math.max(0, aA.reduce((n, u) => n + statusLoad(u), 0) - bA.reduce((n, u) => n + statusLoad(u), 0));
  const energyLoss = Math.max(0, bA.reduce((n, u) => n + energy(u), 0) - aA.reduce((n, u) => n + energy(u), 0));
  const playerGain = Math.max(0, teamEhp(after.teams.P) - teamEhp(before.teams.P));
  return hpLoss * 1.05 + deaths * 520 + statusGain * 46 + energyLoss * 18 + playerGain * .42;
}
function nextPlayerThreats(g) {
  const turn = g?.order?.[g.turn];
  if (!turn || turn[0] !== "P") return {
    skills: [],
    none: true
  };
  const [t, s] = turn,
    u = unitAt(g, t, s);
  if (!u || u.dead) return {
    skills: [],
    none: true
  };
  const skills = [];
  for (const a of expanded(g, t, s)) {
    if (a?.type !== "skill") continue;
    const after = sim(g, t, s, a);
    if (!after) continue;
    let likelihood = 0;
    try {
      likelihood = Number(actionHeuristic(g, t, s, a) || 0);
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "bossTimeoraRLPlannerR32:L128");
    }
    const danger = transitionDanger(g, after),
      units = paidUnits(g, t, u, a),
      aligned = clockInfo(after).aligned;
    skills.push({
      action: a,
      danger,
      likelihood,
      units,
      aligned,
      score: danger + Math.max(-80, Math.min(220, likelihood)) * .18
    });
  }
  skills.sort((a, b) => b.score - a.score);
  return {
    skills,
    none: skills.length === 0
  };
}
function trapScore(afterBoss) {
  const q = nextPlayerThreats(afterBoss);
  if (q.none) {
    const ph = clockInfo(afterBoss);
    return {
      score: (ph.aligned ? 260 : 0) - ph.distance * 28,
      none: true,
      target: null,
      covered: false
    };
  }
  const top = q.skills.slice(0, Math.min(6, q.skills.length));
  let total = 0,
    best = top[0],
    covered = false;
  for (let i = 0; i < top.length; i++) {
    const x = top[i],
      weight = 1 / (1 + i * .55);
    if (x.aligned) {
      total += x.score * 2.35 * weight;
      if (x === best) covered = true;
    } else total -= x.score * (x === best ? 1.25 : .38) * weight;
  }
  return {
    score: total,
    none: false,
    target: best,
    covered
  };
}
function immediate(g, t, s, a) {
  const child = sim(g, t, s, a);
  if (!child) return -Infinity;
  let score = baseValue(child) - baseValue(g);
  if (t === "A") score += trapScore(child).score;
  if (actionSkillHasEffect(a, "bossTimeStrike")) score += Number(a.bossTimeStrikeDamage || 0) * .28;
  if (actionSkillHasEffect(a, "hyperClock")) score += clockInfo(g).aligned ? 4.8 : 1.5;
  return score;
}
function ordered(g, t, s, limit) {
  const arr = expanded(g, t, s).map(a => ({
    a,
    v: immediate(g, t, s, a)
  })).filter(x => Number.isFinite(x.v));
  arr.sort((x, y) => t === "A" ? y.v - x.v : x.v - y.v);
  return arr.slice(0, limit);
}
function stateKey(g, d) {
  const c = g?.bossRaid?.sharedClock || {};
  const us = ["P", "A"].map(t => [...(g.teams[t]?.field || []), ...(g.teams[t]?.bench || [])].map(u => u ? `${u.uid}:${u.hp}:${u.shield}:${u.dead ? 1 : 0}:${energy(u)}:${Object.values(u.statuses || {}).join(',')}:${u.lastSkill || ''}` : '-').join(';')).join('|');
  return `${d}|${g.turn}|${g.turnSerial || 0}|${c.hourDeg || 0},${c.minuteDeg || 0}|${g.rng?.s || 0}|${us}`;
}
function search(g, d, alpha, beta, deadline, tt) {
  if (d <= 0 || g?.winner || performance.now() >= deadline) return baseValue(g);
  const turn = g?.order?.[g.turn];
  if (!turn) return baseValue(g);
  const [t, s] = turn,
    key = stateKey(g, d);
  if (tt.has(key)) return tt.get(key);
  const max = t === "A",
    list = ordered(g, t, s, max ? 8 : 7);
  if (!list.length) {
    const c = copyGame(g);
    try {
      endTurn(c, t, s, false);
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "bossTimeoraRLPlannerR32:L173");
    }
    const v = search(c, d - 1, alpha, beta, deadline, tt);
    tt.set(key, v);
    return v;
  }
  let best = max ? -Infinity : Infinity;
  for (const x of list) {
    if (performance.now() >= deadline) break;
    const c = sim(g, t, s, x.a);
    if (!c) continue;
    let v = search(c, d - 1, alpha, beta, deadline, tt);
    if (max) v += trapScore(c).score * .08;
    if (max) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  if (!Number.isFinite(best)) best = baseValue(g);
  tt.set(key, best);
  return best;
}
export function bossSearchChooseR32(g, t, s, quick = false) {
  const actor = unitAt(g, t, s);
  if (!bossUnit(g, actor, t)) return null;
  if (actor?.scheduledAction) return {
    type: "scheduled",
    reason: "예약된 시간 공격을 실행한다.",
    bossSearchVersion: VERSION,
    bossSearchDepth: 0
  };
  const start = performance.now();
  const localBudget = quick ? 180 : DECISION_BUDGET_MS;
  const sharedDeadline = Number(systems.__bossTimeoraTurnDeadlineR39 || 0);
  const deadline = sharedDeadline > start ? Math.min(start + localBudget, sharedDeadline) : start + localBudget;
  const roots = ordered(g, t, s, quick ? 8 : 16);
  if (!roots.length) return null;
  let best = {
    a: roots[0].a,
    v: -Infinity,
    depth: 0,
    trap: null
  };
  const tt = new Map();
  for (let depth = 1; depth <= 9 && performance.now() < deadline; depth++) {
    let round = null,
      complete = true;
    for (const x of roots) {
      if (performance.now() >= deadline) {
        complete = false;
        break;
      }
      const c = sim(g, t, s, x.a);
      if (!c) continue;
      const trap = trapScore(c);
      let v = search(c, depth - 1, -Infinity, Infinity, deadline, tt) + trap.score * .34 + x.v * .12;
      if (!round || v > round.v) round = {
        a: x.a,
        v,
        depth,
        trap
      };
    }
    if (round && (complete || depth === 1)) best = round;
  }
  const chosen = {
      ...best.a
    },
    elapsed = Math.min(3000, performance.now() - start),
    tr = best.trap || {
      score: 0,
      none: true,
      target: null,
      covered: false
    };
  if (tr.none) chosen.reason = `상대의 사용 가능한 기술이 없어 공용 시계를 자유롭게 조정하는 ${best.depth}수 경로를 선택한다.`;else if (tr.covered) chosen.reason = `예상 최고위험 기술(${tr.target?.action?.skill || "기술"}, ${tr.target?.units || 0}E) 사용 직후 시계가 정렬되도록 배치한다.`;else chosen.reason = `3초 탐색에서 피해·상태이상 기대손실을 최소화하는 공용 시계 경로를 선택한다.`;
  chosen.bossSearchVersion = VERSION;
  chosen.bossSearchDepth = best.depth;
  chosen.bossDecisionMs = Math.round(elapsed);
  chosen.bossThreatSkill = tr.target?.action?.skill || null;
  chosen.bossThreatPaidUnits = tr.target?.units || 0;
  return chosen;
}
