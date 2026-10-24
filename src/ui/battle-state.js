import { TimerManager } from "../runtime/timers.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_ui_battle_state = {
  $: undefined,
  $$: undefined,
  InvaderPortalView: undefined,
  selected: undefined,
  game: undefined,
  busy: undefined,
  onlineAutoCommandActive: undefined,
  onlineAutoCommandOwner: undefined,
  localAutoTurnTimerId: undefined,
  localAutoTurnOwner: undefined,
  localBackgroundAutoTurnOwner: undefined,
  localBattleBackgrounded: undefined,
  pendingSkill: undefined,
  lastLog: undefined,
  battleToken: undefined,
  visualEvents: undefined,
  visualHoldMs: undefined,
  lastBattleConfig: undefined,
  CombatStatPresentationOwner: undefined
};
import { state_engine_actions } from "../engine/actions.js";
import { combatStats, eclipseBlocks, traitsActive } from "../engine/combat.js";
import { energyStore } from "../engine/energy.js";
import { card, cardHasCapability, firstSkillByEffect, firstSkillByTag, skillIdByEffect } from "../engine/entities.js";
import { foxSingleCost } from "../features/foxious.js";
import { reactiveEnergyAmount, reactiveEnergyRule } from "../features/genocider.js";
import { fragmentDefense } from "../features/summons.js";
import { timeClockAlignmentsCancel, timeClockStopReason, timeIsAligned, timeNormDeg, timeSetInputLock, state_features_timeora } from "../features/timeora.js";
import { showEnd } from "../online/connection.js";
import { systems } from "../runtime/systems.js";
import { processPendingTraitChoice, scheduleAI } from "./action-choices.js";
import { state_ui_action_panel } from "./action-panel.js";
import { escapeUIHTML } from "./cards.js";
import { render } from "./payment.js";
export function initializeUiBattleState() {
  state_ui_battle_state.$ = s => document.querySelector(s);
  state_ui_battle_state.$$ = s => [...document.querySelectorAll(s)];
  state_ui_battle_state.InvaderPortalView = null;
  state_ui_battle_state.selected = [];
  state_ui_battle_state.game = null;
  state_ui_battle_state.busy = false;
  state_ui_battle_state.onlineAutoCommandActive = false;
  state_ui_battle_state.onlineAutoCommandOwner = null;
  state_ui_battle_state.localAutoTurnTimerId = 0;
  state_ui_battle_state.localAutoTurnOwner = null;
  state_ui_battle_state.localBackgroundAutoTurnOwner = null;
  state_ui_battle_state.localBattleBackgrounded = false;
  state_ui_battle_state.pendingSkill = null;
  state_ui_battle_state.lastLog = 0;
  state_ui_battle_state.battleToken = 0;
  state_ui_battle_state.visualEvents = [];
  state_ui_battle_state.visualHoldMs = 0;
  state_ui_battle_state.lastBattleConfig = null;
  state_ui_battle_state.CombatStatPresentationOwner = (() => {
    const signed = value => `${value > 0 ? "+" : ""}${combatInt(value)}`;
    const project = unit => Object.freeze([Object.freeze({
      key: "attack",
      label: "공격",
      value: combatInt(unit?.attackMod || 0),
      effectiveValue: combatInt(unit?.attackMod || 0)
    }), Object.freeze({
      key: "defense",
      label: "방어",
      value: combatInt(visibleDefense(unit) - Number(unit?.baseDefense || 0)),
      effectiveValue: visibleDefense(unit)
    })].filter(item => item.value !== 0 || item.key === "defense" && item.effectiveValue !== 0));
    const render = (unit, options = {}) => {
      const className = String(options.className || "combat-stat-chip");
      return project(unit).map(item => {
        const title = item.key === "defense" ? `${item.label} 변화 ${signed(item.value)} · 현재 방어 ${combatInt(item.effectiveValue)}` : `${item.label} 변화 ${signed(item.value)}`;
        const value = item.key === "defense" && item.value === 0 ? combatInt(item.effectiveValue) : signed(item.value);
        return `<span class="${escapeUIHTML(className)}" data-combat-stat-key="${item.key}" data-combat-stat-value="${item.value}" title="${escapeUIHTML(title)}">${item.label} ${value}</span>`;
      }).join("");
    };
    return Object.freeze({
      project,
      render
    });
  })();
}
export function clearLocalAutoTurnTimer(reason = "clear") {
  if (state_ui_battle_state.localAutoTurnTimerId) TimerManager.clear(state_ui_battle_state.localAutoTurnTimerId);
  state_ui_battle_state.localAutoTurnTimerId = 0;
  if (state_ui_battle_state.localAutoTurnOwner) state_ui_battle_state.localAutoTurnOwner.clearedReason = String(reason);
  state_ui_battle_state.localAutoTurnOwner = null;
  return true;
}
export function scheduleLocalAutoTurnTimer(kind, delay, callback) {
  clearLocalAutoTurnTimer("replace");
  const owner = {
    gameRef: state_ui_battle_state.game,
    token: state_ui_battle_state.game?.token,
    serial: state_ui_battle_state.game?.turnSerial,
    battleId: state_ui_battle_state.game?.battleId || null,
    kind: String(kind || "automatic-turn"),
    scheduledAt: Date.now()
  };
  state_ui_battle_state.localAutoTurnOwner = owner;
  state_ui_battle_state.localAutoTurnTimerId = TimerManager.setTimeout(() => {
    if (state_ui_battle_state.localAutoTurnOwner !== owner) return;
    state_ui_battle_state.localAutoTurnTimerId = 0;
    state_ui_battle_state.localAutoTurnOwner = null;
    callback(owner);
  }, Math.max(0, Number(delay) || 0));
  return owner;
}
export function markLocalBattleBackground(reason = "background") {
  if (!state_ui_battle_state.game || state_ui_battle_state.game.mode === "online" || state_ui_battle_state.game?.bossRaid?.online || state_ui_battle_state.game.winner && !state_ui_battle_state.game?.bossRaid) return false;
  state_ui_battle_state.localBattleBackgrounded = true;
  state_ui_battle_state.localBackgroundAutoTurnOwner = state_ui_battle_state.localAutoTurnOwner || state_ui_battle_state.localBackgroundAutoTurnOwner;
  if (state_ui_battle_state.localAutoTurnOwner) state_ui_battle_state.localAutoTurnOwner.backgroundReason = String(reason);
  systems.AnimationEngine?.settleInterrupted?.(`local-background:${reason}`, state_ui_battle_state.game?.battleId || null);
  return true;
}
export function recoverLocalBattleAfterResume(reason = "foreground") {
  if (!state_ui_battle_state.localBattleBackgrounded) return false;
  state_ui_battle_state.localBattleBackgrounded = false;
  if (!state_ui_battle_state.game || state_ui_battle_state.game.mode === "online" || state_ui_battle_state.game?.bossRaid?.online) return false;
  if (state_ui_battle_state.game?.bossRaid && state_ui_battle_state.game.winner) {
    showEnd();
    return true;
  }
  if (state_ui_battle_state.game?.bossRaid && state_ui_battle_state.game.pendingTraitChoices?.[0]?.kind === "bossReward") {
    state_ui_battle_state.busy = false;
    processPendingTraitChoice();
    return true;
  }
  const owner = state_ui_battle_state.localAutoTurnOwner || state_ui_battle_state.localBackgroundAutoTurnOwner;
  state_ui_battle_state.localBackgroundAutoTurnOwner = null;
  const gameAtResume = state_ui_battle_state.game;
  const tokenAtResume = state_ui_battle_state.game.token;
  systems.AnimationEngine?.settleInterrupted?.(`local-resume:${reason}`, state_ui_battle_state.game.battleId || null);
  systems.AnimationEngine?.clearViewportFx?.();
  if (owner) {
    const sameTurn = owner.gameRef === state_ui_battle_state.game && owner.token === state_ui_battle_state.game.token && owner.serial === state_ui_battle_state.game.turnSerial;
    clearLocalAutoTurnTimer(`resume:${reason}`);
    if (sameTurn) {
      state_ui_battle_state.busy = false;
      state_ui_action_panel.ActionPanelConvergenceOwner.request(`local-resume:${reason}`);
      scheduleAI();
      return true;
    }
  }
  Promise.resolve().then(() => {
    if (state_ui_battle_state.game !== gameAtResume || state_ui_battle_state.game?.token !== tokenAtResume || state_ui_battle_state.game?.winner) return;
    if (typeof timeSetInputLock === "function" && state_features_timeora.timeInputLocked && !state_ui_battle_state.game?.pendingClockTurnAdvance) timeSetInputLock(false, false);
    if (!state_ui_battle_state.game?.pendingAnimation && !state_ui_battle_state.game?.pendingClockTurnAdvance) state_ui_battle_state.busy = false;
    render();
    if (!state_ui_battle_state.game?.pendingTraitChoices?.length && !state_ui_battle_state.pendingSkill) scheduleAI();
  });
  return true;
}
export function combatInt(value) {
  let n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
export function energyAmountText(value) {
  let halves = Math.max(0, Math.round(Number(value || 0) * 2)),
    whole = Math.floor(halves / 2),
    half = halves % 2;
  return `${whole || ""}${half ? "½" : ""}` || "0";
}
export function storeHTML(store) {
  return store.length ? store.map(e => `<span class="e ${e.c}">${e.c}${e.a === 0.5 ? "½" : ""}</span>`).join("") : '<span class="muted">없음</span>';
}
export function energyHTML(u, actor = null) {
  return storeHTML(energyStore(u, actor));
}
export function visibleDefense(u) {
  return combatInt(combatStats(state_ui_battle_state.game, u).defense);
}
export function effectsHTML(u) {
  let e = [];
  if (u.graveUpConsumed) e.push('그레이브업: 발동 후 제거됨');
  const graveBarrier = (u.hpProtectionBarriers || []).find(x => x.healOnDecay === 'graveUp' && x.amount > 0);
  if (graveBarrier) e.push(`그레이브업 회복: 자기 차례 시작 보호막 -${combatInt(graveBarrier.decayPerTurn)}, 줄어든 만큼 HP 회복 · 보호막 ${combatInt(graveBarrier.amount)}`);
  if (u.speedDelayTurns > 0) e.push(`Speed ${card(u).speed}: 출전 지연 ${u.speedDelayTurns}턴`);
  if (u.hideHits) e.push(`모래숨기: 다음 공격 타격 ${u.hideHits}회 -30`);
  if (u.queuedHeals?.length) e.push(`예약 회복: ${u.queuedHeals.map(x => `${combatInt(x.amount)}×${combatInt(x.remaining)}`).join(", ")}`);
  for (const [sid, d] of Object.entries(u.skillSeals || {})) e.push(`${card(u).skills.find(x => x.id === sid)?.name || sid} 기술봉인 ${d}턴`);
  if (u.fireWingUntil != null) e.push("화염날개: 다음 자기 차례 전까지 공격 피해 무효");
  if (u.fullInvulnerableUntilOwnTurn) e.push("무적: 다음 자기 차례 시작 전까지 모든 피해 무효");
  if (u.scheduledAction?.kind === "bloom") e.push("피어나는생명: 대기 중 CC 무효");
  if (u.queuedSkillCostReduction) e.push(`다음 자기 차례 기술 코스트 -${u.queuedSkillCostReduction}`);
  if (u.turnSkillCostReduction) e.push(`이번 자기 차례 기술 코스트 -${u.turnSkillCostReduction}`);
  if (cardHasCapability(u, "eclipse") && eclipseBlocks(u)) e.push("이클립스: 공격기술 피해 무효");
  let base = e.length ? `<div class="effect-box tiny"><b>효과</b><br>${e.join("<br>")}</div>` : "";
  const jcExtra = [];
  if (cardHasCapability(u, "fragmentTrait")) {
    jcExtra.push(`프레그먼트 방어 +${fragmentDefense(u)}`);
    if (u.circuitLastGatherColor) jcExtra.push(`교류충전 직전 색 ${u.circuitLastGatherColor}`);
    if (u.scheduledAction?.kind === "voltageBurst") jcExtra.push(`볼티지버스트 준비 ${u.scheduledAction.initialN - u.scheduledAction.remaining}/${u.scheduledAction.initialN}`);
  }
  if (firstSkillByEffect(u, "junglesVineWhip")) jcExtra.push(`덩굴휩 첫 강탈 ${u.vineWhipFirstUsed ? "사용" : "대기"}`);
  if (cardHasCapability(u, "thresholdEnergy")) jcExtra.push(`생명의 문턱: ${u.lifeThresholdUses >= 2 ? "사용 완료" : `${u.lifeThresholdUses || 0}/2`}`);
  if (jcExtra.length) base = base.replace('</div>', `<br>${jcExtra.join('<br>')}</div>`) || `<div class="effect-box tiny"><b>효과</b><br>${jcExtra.join('<br>')}</div>`;
  if (firstSkillByEffect(u, "foxStrike")) base += `<div class="effect-box tiny"><b>스트라이크</b><br>현재 단일 코스트 ${foxSingleCost(u)} · 일반 피해 80D</div>`;
  if (firstSkillByTag(u, "copy") && u.memoryStrikeUses) base += `<div class="effect-box tiny"><b>메모리 · 스트라이크</b><br>다음 기본 코스트 ${u.memoryStrikeSingleColor || "*"} + 메모리 추가 *</div>`;
  if (u?.elixianResonance) base += `<div class="effect-box tiny elixian-resonance-badge"><b>잔향</b><br>자기 차례 시작마다 HP 10 영구 회복</div>`;
  if (reactiveEnergyRule(u)) {
    const b = reactiveEnergyAmount(u),
      bonus = traitsActive(u) ? combatInt(b * 60) : 0;
    base += `<div class="effect-box tiny"><b>어둠 포식</b><br>기본 최대 HP 240 · 현재 B ${energyAmountText(b)} · 최대 HP +${bonus}</div>`;
  }
  if (cardHasCapability(u, "timeControl")) {
    const g = state_engine_actions.timeTraitGame || (typeof state_ui_battle_state.game !== "undefined" ? state_ui_battle_state.game : null),
      stopReason = g ? timeClockStopReason(g, u) : null;
    const clockState = stopReason ? stopReason === "traitSeal" ? "시계 정지(특성봉인)" : "시계 정지(상대 정렬)" : g && timeClockAlignmentsCancel(g) && timeIsAligned(u) ? "동시 정렬 상쇄" : timeIsAligned(u) ? "정렬" : "비정렬";
    base += `<div class="effect-box tiny"><b>Time</b><br>시침 ${timeNormDeg(u.timeHourDeg)}° · 분침 ${timeNormDeg(u.timeMinuteDeg)}° · ${clockState}<br>타임프로텍트 +20 · 타임리콜 ${u.usedOnce?.[skillIdByEffect(u, "timeRecall")] ? "사용 완료" : "사용 가능"}</div>`;
  }
  return base;
}
