import { actionHeuristic } from "./specialists.js";
import { legalActions, unitAt } from "../engine/actions.js";
import { teamOf } from "../engine/combat.js";
import { RNG, cardHasCapability, clone } from "../engine/entities.js";
import { execute } from "../engine/execution.js";
import { TimeClockOwnershipDomain, timeClockReactionDecision, timeCurrentSuppressionDomain, timeFieldTimeoras, timeIsAligned, timeNormDeg, state_features_timeora } from "../features/timeora.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
export function initializeAiBossTactics() {
  isRaidBossTimeora = (g, u, teamHint = null) => {
    if (!g?.bossRaid || !u || u.dead) return false;
    const team = teamHint || (typeof teamOf === "function" ? teamOf(g, u) : null);
    return team === "A" && !!(u.bossRed || cardHasCapability(u, "fateClock"));
  };
  raidBossOwners = g => [...(g?.teams?.A?.field || []), ...(g?.teams?.A?.bench || [])].filter(u => isRaidBossTimeora(g, u, "A"));
  raidSharedClock = g => {
    g.bossRaid.sharedClock ||= {
      hourDeg: 0,
      minuteDeg: 90
    };
    return g.bossRaid.sharedClock;
  };
  raidSharedAligned = g => {
    if (!g?.bossRaid) return false;
    const c = raidSharedClock(g);
    const d = timeNormDeg(Number(c.hourDeg || 0) - Number(c.minuteDeg || 0));
    return Math.abs(d) < .001 || Math.abs(d - 180) < .001;
  };
  syncRaidBossClock = g => {
    if (!g?.bossRaid) return;
    const c = raidSharedClock(g);
    for (const u of raidBossOwners(g)) {
      u.timeHourDeg = timeNormDeg(c.hourDeg);
      u.timeMinuteDeg = timeNormDeg(c.minuteDeg);
    }
  };

  /* 시계 배치 가치는 계속 높게 유지하되, 현재 행동으로 확정 처치할 수 있으면
     모든 합법 행동을 직접 시뮬레이션한 뒤 처치 행동을 우선한다. */
  alivePlayerUnits = g => [...(g?.teams?.P?.field || []), ...(g?.teams?.P?.bench || [])].filter(u => u && !u.dead);
  playerEhpR36 = g => alivePlayerUnits(g).reduce((sum, u) => {
    const barriers = (u.hpProtectionBarriers || []).reduce((n, b) => n + Math.max(0, Number(b?.amount) || 0), 0);
    return sum + Math.max(0, Number(u.hp) || 0) + Math.max(0, Number(u.shield) || 0) + barriers;
  }, 0);
  sharedAlignmentAfterR36 = g => !!g?.bossRaid && raidSharedAligned(g);
  TOTAL_BOSS_DECISION_BUDGET_MS = 2920;
}
let isRaidBossTimeora;
let raidBossOwners;
let raidSharedClock;
let raidSharedAligned;
let syncRaidBossClock;
/* 보스전에서도 지원 타임오러는 별도의 금빛 운명의 시계를 가진다.
   보스 공용 시계와 지원 시계가 동시에 정렬되면 상쇄하고,
   지원 시계만 정렬되면 보스 진영의 특성 발동 및 공용 시계 반응을 막는다. */
export function bossResolveSuppressionR36(g) {
  if (!g?.bossRaid) return null;
  if (!g || g.winner) return null;
  const playerOwners = timeFieldTimeoras(g, "P").filter(u => !Number(u?.statuses?.traitSeal || 0) && timeIsAligned(u));
  const bossOwners = raidBossOwners(g).filter(u => !Number(u?.statuses?.traitSeal || 0));
  const bossAligned = bossOwners.length > 0 && raidSharedAligned(g);
  if (playerOwners.length && bossAligned) return null;
  if (playerOwners.length) {
    return new TimeClockOwnershipDomain({
      id: `raid-support-clock:${playerOwners.map(u => u.uid).sort().join("+")}`,
      team: "P",
      owners: playerOwners,
      suppressedUnits: (g.teams?.A?.field || []).filter(u => u && !u.dead),
      shared: false,
      label: `${playerOwners[0].name}의 운명의 시계`
    });
  }
  if (bossAligned) {
    return new TimeClockOwnershipDomain({
      id: `boss-shared-clock:${g.matchId || g.seed || "raid"}`,
      team: "A",
      owners: bossOwners,
      suppressedUnits: (g.teams?.P?.field || []).filter(u => u && !u.dead),
      shared: true,
      label: "붉은 공용 시계"
    });
  }
  return null;
}
export function bossRotateClocksR36(g, t, s, actor, paidAmount, sim = false) {
  if (!g?.bossRaid) return null;
  const n = Math.ceil(Math.max(0, Number(paidAmount) || 0) - 1e-9);
  if (!n) return [];
  const clocks = [];
  const domainAtStart = timeCurrentSuppressionDomain(g);
  const bossOwners = raidBossOwners(g);
  const fieldBossOwners = (g?.teams?.A?.field || []).filter(u => isRaidBossTimeora(g, u, "A"));
  const supportBlocksShared = domainAtStart?.team === "P" && fieldBossOwners.some(u => domainAtStart?.suppresses?.(u));
  const activeSharedOwners = supportBlocksShared ? [] : fieldBossOwners.filter(u => !Number(u?.statuses?.traitSeal || 0) && !domainAtStart?.suppresses?.(u));
  const shared = raidSharedClock(g);
  const sharedBeforeHour = timeNormDeg(shared.hourDeg);
  const sharedBeforeMinute = timeNormDeg(shared.minuteDeg);
  const sharedCanReact = activeSharedOwners.length > 0;

  /* 지원 타임오러의 개인 시계도 행동 시작 시점 기준으로 별도 스냅샷한다. */
  const supportSnapshots = timeFieldTimeoras(g, "P").map(owner => ({
    owner,
    decision: timeClockReactionDecision(g, owner, actor, t, s),
    beforeHour: timeNormDeg(owner.timeHourDeg),
    beforeMinute: timeNormDeg(owner.timeMinuteDeg)
  }));
  if (sharedCanReact) {
    const hourDelta = 30 * n;
    const actorIsBoss = isRaidBossTimeora(g, actor, t);
    const minuteDelta = actorIsBoss ? 90 * n : 0;
    shared.hourDeg = timeNormDeg(sharedBeforeHour + hourDelta);
    shared.minuteDeg = timeNormDeg(sharedBeforeMinute + minuteDelta);
    syncRaidBossClock(g);
    const aligned = raidSharedAligned(g);
    clocks.push({
      uid: "boss-shared-clock",
      team: "A",
      bossShared: true,
      beforeHour: sharedBeforeHour,
      beforeMinute: sharedBeforeMinute,
      afterHour: shared.hourDeg,
      afterMinute: shared.minuteDeg,
      hourDelta,
      minuteDelta,
      aligned
    });
    log(g, `붉은 공용 시계: ${n}E 반응·시침 +${hourDelta}°${minuteDelta ? `·분침 +${minuteDelta}°` : ""}→${shared.hourDeg}°/${shared.minuteDeg}°${aligned ? "·정렬" : ""}.`, "turn");
  }
  for (const snap of supportSnapshots) {
    const {
      owner,
      decision,
      beforeHour,
      beforeMinute
    } = snap;
    if (!decision.ok) {
      if (decision.reason === "previousEnemyTurn") {
        if (!sim && typeof state_ui_battle_state.game !== "undefined" && g === state_ui_battle_state.game) log(g, `${owner.name}의 시계: 행동순서상 바로 이전 적 차례의 기술에는 반응하지 않음.`, "turn");
        clocks.push({
          uid: owner.uid,
          team: "P",
          beforeHour,
          beforeMinute,
          afterHour: beforeHour,
          afterMinute: beforeMinute,
          hourDelta: 0,
          minuteDelta: 0,
          aligned: timeIsAligned(owner),
          blocked: true,
          blockReason: decision.reason
        });
      }
      continue;
    }
    const hourDelta = 30 * n;
    const minuteDelta = owner.uid === actor?.uid ? 90 * n : 0;
    owner.timeHourDeg = timeNormDeg(beforeHour + hourDelta);
    owner.timeMinuteDeg = timeNormDeg(beforeMinute + minuteDelta);
    clocks.push({
      uid: owner.uid,
      team: "P",
      beforeHour,
      beforeMinute,
      afterHour: owner.timeHourDeg,
      afterMinute: owner.timeMinuteDeg,
      hourDelta,
      minuteDelta,
      aligned: timeIsAligned(owner)
    });
    log(g, `${owner.name}의 운명의 시계: ${n}E 반응·시침 +${hourDelta}°${minuteDelta ? `·분침 +${minuteDelta}°` : ""}→${owner.timeHourDeg}°/${owner.timeMinuteDeg}°${timeIsAligned(owner) ? "·정렬" : ""}.`, "turn");
  }
  if (!sim && typeof state_ui_battle_state.game !== "undefined" && g === state_ui_battle_state.game && clocks.length) {
    state_ui_battle_state.visualEvents.push({
      type: "timeClockRotationFx",
      actionSerial: ++state_features_timeora.timeVisualSerial,
      actorUid: actor?.uid || null,
      clocks
    });
  }
  return clocks;
}
function copyForR36(g) {
  const c = clone(g);
  if (typeof RNG === "function") {
    const r = new RNG(1);
    r.s = Number(g?.rng?.s || 1) || 1;
    c.rng = r;
  }
  c.logs = [];
  return c;
}
function simulateR36(g, t, s, action) {
  const c = copyForR36(g);
  let previousGame;
  try {
    previousGame = typeof state_ui_battle_state.game !== "undefined" ? state_ui_battle_state.game : null;
    if (typeof state_ui_battle_state.game !== "undefined") state_ui_battle_state.game = c;
    return execute(c, t, s, {
      ...action
    }, {
      sim: true
    }) ? c : null;
  } catch (_) {
    return null;
  } finally {
    if (typeof state_ui_battle_state.game !== "undefined") state_ui_battle_state.game = previousGame;
  }
}
let alivePlayerUnits;
let playerEhpR36;
let sharedAlignmentAfterR36;
let TOTAL_BOSS_DECISION_BUDGET_MS;
export function bossChooseAIController(g, t, s, quick = false, fallback) {
  const actor = unitAt(g, t, s);
  if (!isRaidBossTimeora(g, actor, t) || actor?.scheduledAction) return systems.__redTimeoraBossRaid?.searchChooseR32?.(g, t, s, quick) || systems.__redTimeoraBossRaid?.basicChoose?.(g, t, s, quick) || fallback();
  const decisionStartedAt = performance.now();
  const previousDeadline = systems.__bossTimeoraTurnDeadlineR39;
  const totalBudget = quick ? 260 : TOTAL_BOSS_DECISION_BUDGET_MS;
  systems.__bossTimeoraTurnDeadlineR39 = decisionStartedAt + totalBudget;
  try {
    const beforeAlive = alivePlayerUnits(g).length;
    const beforeEhp = playerEhpR36(g);
    const lethal = [];
    for (const action of legalActions(g, t, s) || []) {
      const sharedDeadline = Number(systems.__bossTimeoraTurnDeadlineR39 || 0);
      if (sharedDeadline > 0 && performance.now() >= sharedDeadline - 45) break;
      if (action?.type !== "skill") continue;
      const after = simulateR36(g, t, s, action);
      if (!after || after.winner === "P") continue;
      const afterAlive = alivePlayerUnits(after).length;
      const kills = Math.max(0, beforeAlive - afterAlive);
      if (!kills) continue;
      const damage = Math.max(0, beforeEhp - playerEhpR36(after));
      let heuristic = 0;
      try {
        heuristic = Number(actionHeuristic(g, t, s, action) || 0);
      } catch (error) {
        systems.__megaRecordRecoveredError(error, "bossSupportClockAndLethalPriorityR36:L238");
      }
      const victory = after.winner === "A" ? 1 : 0;
      const aligned = sharedAlignmentAfterR36(after) ? 1 : 0;
      const targetField = action?.target?.team === "P" && Number(action?.target?.slot) < 2 ? 1 : 0;
      lethal.push({
        action,
        after,
        kills,
        victory,
        aligned,
        damage,
        targetField,
        heuristic,
        score: victory * 1e9 + kills * 1e7 + targetField * 2e5 + aligned * 8e4 + damage * 100 + heuristic
      });
    }
    if (lethal.length) {
      lethal.sort((a, b) => b.score - a.score);
      const pick = lethal[0];
      return {
        ...pick.action,
        reason: pick.victory ? "즉시 승리 가능한 처치 수를 확인해 마무리한다." : `시계 정렬 가치보다 현재 확정 처치 ${pick.kills}명을 우선한다${pick.aligned ? "·처치 후 정렬도 유지한다" : ""}.`,
        bossSearchVersion: "boss-tactics-v1",
        bossSearchDepth: 0,
        bossDecisionMs: Math.round(performance.now() - decisionStartedAt),
        bossTotalBudgetMs: totalBudget,
        bossImmediateKills: pick.kills,
        bossLethalOverride: true
      };
    }
    const result = systems.__redTimeoraBossRaid?.searchChooseR32?.(g, t, s, quick) || systems.__redTimeoraBossRaid?.basicChoose?.(g, t, s, quick) || fallback();
    if (result && typeof result === "object") {
      result.bossDecisionMs = Math.round(performance.now() - decisionStartedAt);
      result.bossTotalBudgetMs = totalBudget;
    }
    return result;
  } finally {
    if (previousDeadline == null) delete systems.__bossTimeoraTurnDeadlineR39;else systems.__bossTimeoraTurnDeadlineR39 = previousDeadline;
  }
}
