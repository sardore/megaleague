import { state_runtime_input } from "../runtime/input.js";
import { raidClockHTML } from "../features/boss-raid.js";
import { TimerManager } from "../runtime/timers.js";

// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_features_timeora = {
  TIMEORA_CARD: undefined,
  timeInputLocked: undefined,
  timeInputLockBusyOwned: undefined,
  timeVisualChain: undefined,
  timeVisualSerial: undefined,
  timeClockTraitSuppression: undefined,
  EnergyOverflowPresentationOwner: undefined
};
import { state_catalog_cards } from "../catalog/cards.js";
import { enemyTargets, other, unitAt, state_engine_actions } from "../engine/actions.js";
import { checkDeath, dealDamage, findUnit, teamOf, traitsActive } from "../engine/combat.js";
import { memoryOptions, naturalColors } from "../engine/effects.js";
import { canPayAction, energyStore, energyValue, findPaymentPlan, normalizeStore, status, totalEnergy, transformedSkillReq, triggerEnergyGainResult } from "../engine/energy.js";
import { RNG, actionSkillHasEffect, actionSkillHasTag, card, cardHasCapability, firstSkillByTag, skillDefHasEffect, skillDefHasTag, skillIdByEffect, skillIdByEffectGlobal, skillIdByTag, skillOf, state_engine_entities } from "../engine/entities.js";
import { advanceDualOrEnd, endTurn, execute } from "../engine/execution.js";
import { cloneRng, drawNaturalColorFrom, executeGatherGains, storeAfterGain } from "../engine/multi-gather.js";
import { dmBattleInstanceId, dmMemoryAction, dmTargetRefs } from "./dragon-memory.js";
import { copiedSkillAllowed } from "./elixian.js";
import { executeCharacterAction } from "./support.js";
import { log, queueCombatNotice } from "../presentation/audio.js";
import { state_presentation_coordinates } from "../presentation/coordinates.js";
import { timeSyncContinuousTraitStates } from "../presentation/introductions.js";
import { systems } from "../runtime/systems.js";
import { openGatherGainsOverflow } from "../ui/action-choices.js";
import { state_ui_action_panel } from "../ui/action-panel.js";
import { combatInt, energyAmountText, state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_cards } from "../ui/cards.js";
import { registerCardDefinition, state_ui_deck } from "../ui/deck.js";
import { localTeamFor } from "../ui/setup.js";
export function initializeFeaturesTimeora() {
  state_features_timeora.TIMEORA_CARD = state_catalog_cards.C("timeora", "타임오러", 280, "시간 제어·특성 정지 드래곤", "메가리그", "시간 가속: 에너지 모으기 첫 결과 유지 시 총 1.5E, 버리면 1회 재추첨. 타임프로텍트: 필드 중 자신·아군 방어 +20. 운명의 시계: 기술에 쓴 에너지 1E당 시침 +30°(자기 기술은 분침 +90°, 직전 적 기술 제외). 두 바늘이 겹치거나 반대면 시계 주인 외 특성 정지, 양측 동시 정렬 시 상쇄. 특성봉인·상대 정렬 중 시계 정지.", [state_catalog_cards.S("timeRecall", "타임리콜", "**", "대상 1명의 HP·상태이상을 2턴 전 자기 차례 시작 시점으로 복구. 실드·추가 HP바·에너지·최대 HP·사용 횟수·시계 유지. 전투 1회.", "anyCharacter", [{
    type: "timeRecall"
  }], ["support", "rewind"], {
    nonAttack: true,
    once: true
  }), state_catalog_cards.S("hyperClock", "하이퍼클락", "WWorB*", "100D. 특성봉인 상태 또는 시침·분침이 일치/정반대면 160D. 특성봉인 시 코스트는 ***.", "enemy", [{
    type: "hyperClock"
  }], ["damage", "clock"])], {
    grade: "4.5☆",
    maxEnergy: 4,
    releaseOrder: 18,
    tags: ["dragon", "legendary-dragon", "time"],
    defenseAura: 20,
    timeAcceleration: true,
    fateClock: true,
    timeControl: true
  });
  registerCardDefinition(state_features_timeora.TIMEORA_CARD);
  state_ui_cards.CARD_EMOJI_MAP.timeora = ["⏳️"];

  // timeTraitGame declared with core turn state above.
  state_features_timeora.timeInputLocked = false;
  state_features_timeora.timeInputLockBusyOwned = false;
  state_features_timeora.timeVisualChain = Promise.resolve();
  state_features_timeora.timeVisualSerial = 0;
  state_features_timeora.timeClockTraitSuppression = new TimeClockTraitSuppressionPolicy();
  for (const eventName of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "touchstart", "touchend", "keydown", "keyup", "keypress", "wheel", "input", "change", "submit", "dragstart", "contextmenu"]) {
    document.addEventListener(eventName, e => {
      if (!state_features_timeora.timeInputLocked) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);
  }
  state_features_timeora.EnergyOverflowPresentationOwner = Object.freeze({
    open(model) {
      const root = state_ui_battle_state.$("#modalContent");
      if (!root) return false;
      const incoming = (model?.incoming || []).map((e, index) => ({
        ...e,
        index
      }));
      const current = (model?.current || []).map((e, index) => ({
        ...e,
        index
      }));
      const selectedIncoming = new Set(model?.initialKeepIncomingIndices || []);
      const selectedCurrentDiscard = new Set(model?.initialDiscardCurrentIndices || []);
      const max = Number(model?.max || 0);
      root.innerHTML = `<h2>${model?.title || "에너지 교환"}</h2><p>${model?.instructions || "첫 줄에서 <b>보관할 새 에너지</b>를 고르세요. 공간이 부족하면 둘째 줄에서 <b>버릴 보유 에너지</b>를 고르세요. 두 줄의 선택량은 같을 필요가 없습니다."}</p><section class="time-swap-row"><h3>보관할 새 에너지</h3><div id="timeNewEnergy" class="energy time-swap-energy"></div></section><section class="time-swap-row"><h3>버릴 보유 에너지</h3><div id="timeOwnedEnergy" class="energy time-swap-energy"></div></section><div id="timeSwapPreview" class="effect-box"></div><div class="choice-list"><button id="timeSwapConfirm" class="primary">선택 확정</button><button id="timeDiscardNew">새 에너지 모두 버리기</button><button id="timeDiscardCancel">취소</button></div>`;
      root.dataset.energyOverflowSourceActionId = String(model?.sourceActionIdentity || "");
      root.dataset.energyOverflowTransactionId = String(model?.pendingTransactionIdentity || "");
      const newBox = root.querySelector("#timeNewEnergy"),
        ownedBox = root.querySelector("#timeOwnedEnergy"),
        preview = root.querySelector("#timeSwapPreview"),
        confirm = root.querySelector("#timeSwapConfirm");
      const redraw = () => {
        newBox.innerHTML = "";
        ownedBox.innerHTML = "";
        incoming.forEach((e, index) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = `e ${e.c} time-swap-chip${selectedIncoming.has(index) ? " chosen" : ""}`;
          b.textContent = `${e.c}${Number(e.a) === .5 ? "½" : ""}`;
          b.title = selectedIncoming.has(index) ? "보관 선택 해제" : "이 새 에너지 보관";
          b.onclick = () => {
            selectedIncoming.has(index) ? selectedIncoming.delete(index) : selectedIncoming.add(index);
            redraw();
          };
          newBox.appendChild(b);
        });
        current.forEach((e, index) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = `e ${e.c} time-swap-chip${selectedCurrentDiscard.has(index) ? " chosen" : ""}`;
          b.textContent = `${e.c}${Number(e.a) === .5 ? "½" : ""}`;
          b.title = selectedCurrentDiscard.has(index) ? "버리기 선택 해제" : "이 보유 에너지 버리기";
          b.onclick = () => {
            selectedCurrentDiscard.has(index) ? selectedCurrentDiscard.delete(index) : selectedCurrentDiscard.add(index);
            redraw();
          };
          ownedBox.appendChild(b);
        });
        const kept = incoming.filter((_, index) => selectedIncoming.has(index));
        const removed = current.filter((_, index) => selectedCurrentDiscard.has(index));
        const currentTotal = current.reduce((n, e) => n + Number(e?.a || 0), 0);
        const keptAmount = kept.reduce((n, e) => n + Number(e?.a || 0), 0);
        const removedAmount = removed.reduce((n, e) => n + Number(e?.a || 0), 0);
        const finalTotal = currentTotal - removedAmount + keptAmount;
        const valid = kept.length > 0 && finalTotal <= max + .001;
        confirm.disabled = !valid;
        preview.textContent = `현재 ${energyAmountText(currentTotal)}E · 새 에너지 보관 ${kept.map(e => `${e.c}${Number(e.a) === .5 ? "½" : ""}`).join(" + ") || "없음"} · 기존 에너지 버림 ${removed.map(e => `${e.c}${Number(e.a) === .5 ? "½" : ""}`).join(" + ") || "없음"} · 최종 ${energyAmountText(finalTotal)}E / 최대 ${energyAmountText(max)}E${valid ? "" : kept.length ? " · 최대치를 넘습니다. 버릴 보유 에너지를 더 고르세요." : " · 보관할 새 에너지를 하나 이상 고르세요."}`;
      };
      confirm.onclick = () => {
        if (confirm.disabled) return;
        model?.onConfirm?.({
          keepIncomingIndices: [...selectedIncoming].sort((a, b) => a - b),
          discardCurrentIndices: [...selectedCurrentDiscard].sort((a, b) => a - b)
        });
      };
      root.querySelector("#timeDiscardNew").onclick = () => model?.onDropNew?.();
      root.querySelector("#timeDiscardCancel").onclick = () => {
        document.getElementById("modal")?.classList.remove("open");
        model?.onCancel?.();
      };
      redraw();
      state_ui_battle_state.$("#modal").classList.add("open");
      return true;
    }
  });
  state_ui_action_panel.ActionRenderEngine.registerDecorator("timeora", 400, () => decorateTimeoraActions());
}
export function timeMarkTimeline(g, type, payload = {}) {
  if (!g) return null;
  g.clockTimeline ||= [];
  const mark = {
    type,
    at: performance.now(),
    turnSerial: Number(g.turnSerial || 0),
    activeEntityId: g.activeEntityId || unitAt(g, ...(g.order?.[g.turn] || []))?.uid || null,
    ...payload
  };
  g.clockTimeline.push(mark);
  if (g.clockTimeline.length > 160) g.clockTimeline.splice(0, g.clockTimeline.length - 160);
  return mark;
}
export function timeCommitPendingTurnAdvance(g) {
  if (g === state_ui_battle_state.game && (g?.mode === "online" || g?.bossRaid?.online) && state_ui_deck.p2p?.role === "guest") return false;
  const pending = g?.pendingClockTurnAdvance;
  if (!pending) return false;
  delete g.pendingClockTurnAdvance;
  delete g._timeDeferTurnAdvance;
  const actor = findUnit(g, pending.actorEntityId) || unitAt(g, pending.teamId, pending.slotIndex);
  g._timeCommittingTurnAdvance = true;
  try {
    if (actor) advanceDualOrEnd(g, pending.teamId, pending.slotIndex, actor, pending.usedSkill, pending.switched);else endTurn(g, pending.teamId, pending.slotIndex, pending.usedSkill);
  } finally {
    delete g._timeCommittingTurnAdvance;
  }
  if (systems.StateFactory?.updateActive) systems.StateFactory.updateActive(g);
  timeMarkTimeline(g, "turnAdvanced", {
    fromTurnSerial: pending.turnSerial,
    toTurnSerial: Number(g.turnSerial || 0)
  });
  timeMarkTimeline(g, "nextActorAssigned", {
    nextActorEntityId: g.activeEntityId || null,
    nextTeamId: g.activeTeamId || null
  });
  g._timeAwaitingNextAiAction = !!(!g.winner && (g.mode === "human" && g.activeTeamId === "A" || g.mode === "aivai" || g.bossRaid && g.activeTeamId === "A"));
  return true;
}
export function timeNormDeg(n) {
  n = Number(n) || 0;
  return (n % 360 + 360) % 360;
}
export function timeIsAligned(u) {
  if (!u || !cardHasCapability(u, "timeControl")) return false;
  const d = timeNormDeg((u.timeHourDeg || 0) - (u.timeMinuteDeg || 0));
  return Math.abs(d) < .001 || Math.abs(d - 180) < .001;
}
export function timeTeamOf(g, unit) {
  return unit ? teamOf(g, unit) : null;
}
export function timeFieldUnits(g) {
  return ["P", "A"].flatMap(t => (g?.teams?.[t]?.field || []).filter(Boolean));
}
export function timeFieldTimeoras(g, t = null) {
  const teams = t ? [t] : ["P", "A"];
  return teams.flatMap(team => (g?.teams?.[team]?.field || []).filter(u => u && !u.dead && cardHasCapability(u, "timeControl")));
}
export class TimeClockOwnershipDomain {
  constructor({
    id,
    team,
    owners,
    suppressedUnits = [],
    shared = false,
    label = "운명의 시계"
  }) {
    this.id = String(id || "clock-domain");
    this.team = team || null;
    this.shared = !!shared;
    this.label = label;
    this.owners = (owners || []).filter(Boolean);
    this.ownerUids = new Set(this.owners.map(u => String(u.uid)));
    this.suppressedUnits = (suppressedUnits || []).filter(Boolean);
    this.suppressedUids = new Set(this.suppressedUnits.map(u => String(u.uid)));
  }
  owns(unitOrUid) {
    const uid = typeof unitOrUid === "object" ? unitOrUid?.uid : unitOrUid;
    return uid != null && this.ownerUids.has(String(uid));
  }
  suppresses(unitOrUid) {
    const uid = typeof unitOrUid === "object" ? unitOrUid?.uid : unitOrUid;
    return uid != null && this.suppressedUids.has(String(uid));
  }
  representative() {
    return this.owners[0] || null;
  }
}
/* 운명의 시계 정렬이 특성을 멈추는 대상: 시계 주인을 뺀 양 진영 필드의 생존 유닛 중 특성이 있는 유닛(아군 포함).
   판정 영역(TimeClockTraitSuppressionPolicy)과 채도 저하 연출이 같은 규칙을 쓰도록 이 한 곳에서만 정한다. */
export function timeUnitsSuppressedByClockOwners(g, ownerUids) {
  return [...(g?.teams?.P?.field || []), ...(g?.teams?.A?.field || [])].filter(unit => unit && !unit.dead && !ownerUids.has(String(unit.uid)) && !!String(card(unit)?.trait || "").trim());
}
export class TimeClockTraitSuppressionPolicy {
  resolve(g) {
    if (!g || g.winner) return null;
    const bossResolver = systems.__redTimeoraBossRaid?.resolveSuppression;
    if (g.bossRaid && typeof bossResolver === "function") return bossResolver(g);

    /* 보스 IIFE의 지역 함수에 기대지 않고 직렬화되는 공용 시계 상태로 직접 판정한다. */
    const bossClockState = g?.bossRaid?.sharedClock;
    const bossClockDelta = bossClockState ? timeNormDeg(Number(bossClockState.hourDeg || 0) - Number(bossClockState.minuteDeg || 0)) : null;
    const bossClockIsAligned = bossClockDelta != null && (Math.abs(bossClockDelta) < .001 || Math.abs(bossClockDelta - 180) < .001);
    if (g?.bossRaid && bossClockIsAligned) {
      const owners = [...(g.teams?.A?.field || []), ...(g.teams?.A?.bench || [])].filter(u => u && !u.dead && cardHasCapability(u, "timeControl") && !Number(u?.statuses?.traitSeal || 0));
      if (owners.length) return new TimeClockOwnershipDomain({
        id: `boss-shared-clock:${g.matchId || g.seed || "raid"}`,
        team: "A",
        owners,
        suppressedUnits: (g.teams?.P?.field || []).filter(u => u && !u.dead),
        shared: true,
        label: "붉은 공용 시계"
      });
    }
    const playerOwners = timeFieldTimeoras(g, "P").filter(u => !Number(u?.statuses?.traitSeal || 0) && timeIsAligned(u));
    const enemyOwners = timeFieldTimeoras(g, "A").filter(u => !Number(u?.statuses?.traitSeal || 0) && timeIsAligned(u));
    if (!playerOwners.length && !enemyOwners.length) return null;

    /* 양쪽이 동시에 정렬되면 두 정렬 효과가 서로 상쇄된다. 이때는 어느 쪽도
       상대를 정지시키지 않으며 두 시계 모두 계속 반응할 수 있다. */
    if (playerOwners.length && enemyOwners.length) return null;
    const owners = playerOwners.length ? playerOwners : enemyOwners;
    const ownerTeam = playerOwners.length ? "P" : "A";
    const ownerUids = new Set(owners.map(unit => String(unit.uid)));
    const suppressedUnits = timeUnitsSuppressedByClockOwners(g, ownerUids);
    return new TimeClockOwnershipDomain({
      id: `unit-clock:${owners.map(u => u.uid).sort().join("+")}`,
      team: ownerTeam,
      owners,
      suppressedUnits,
      shared: false,
      label: `${owners[0].name}의 운명의 시계`
    });
  }
  suppresses(g, unit) {
    const domain = this.resolve(g);
    return !!domain && domain.suppresses(unit);
  }
  traitsActive(g, unit) {
    return !!unit && !status(unit, "traitSeal") && !this.suppresses(g, unit);
  }
}
export function timeCurrentSuppressionDomain(g) {
  return state_features_timeora.timeClockTraitSuppression.resolve(g);
}
export function timeAlignedOwnersForTeam(g, t) {
  return timeFieldTimeoras(g, t).filter(u => !Number(u?.statuses?.traitSeal || 0) && timeIsAligned(u));
}
export function timeClockAlignmentsCancel(g) {
  return timeAlignedOwnersForTeam(g, "P").length > 0 && timeAlignedOwnersForTeam(g, "A").length > 0;
}
export function timeClockStopReason(g, u) {
  if (!u || u.dead || !cardHasCapability(u, "timeControl")) return null;
  if (status(u, "traitSeal")) return "traitSeal";
  const domain = timeCurrentSuppressionDomain(g);
  return domain?.suppresses(u) ? "opponentAlignment" : null;
}
export function timeStatusClone(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (Number(v) > 0) out[k] = Number(v);
  return out;
}
export function timeRecordTurnStart(g, u) {
  if (!u || u.dead) return;
  u.timeRecallHistory ||= [];
  const stamp = `${g.matchId || g.seed}:${g.turnSerial}:${u.uid}`;
  if (u.timeRecallHistory.at(-1)?.stamp === stamp) return;
  u.timeRecallHistory.push({
    stamp,
    turnSerial: g.turnSerial,
    ownTurn: u.turns || 0,
    hp: combatInt(u.hp),
    statuses: timeStatusClone(u.statuses),
    skillSeals: timeStatusClone(u.skillSeals)
  });
  if (u.timeRecallHistory.length > 16) u.timeRecallHistory.splice(0, u.timeRecallHistory.length - 16);
}
export function timeRecallSnapshot(u) {
  const h = u?.timeRecallHistory || [];
  if (!h.length) return {
    snapshot: {
      hp: combatInt(u?.hp || 0),
      statuses: timeStatusClone(u?.statuses),
      skillSeals: timeStatusClone(u?.skillSeals)
    },
    turnsAgo: 0
  };
  const index = Math.max(0, h.length - 3);
  return {
    snapshot: h[index],
    turnsAgo: Math.min(2, h.length - 1)
  };
}
export function timeOrderIndexForSlot(g, t, s) {
  return g?.order?.findIndex(x => x?.[0] === t && Number(x?.[1]) === Number(s)) ?? -1;
}
export function timeOrderSlotForUnit(g, u) {
  const t = timeTeamOf(g, u),
    s = g?.teams?.[t]?.field?.findIndex(x => x?.uid === u?.uid) ?? -1;
  return {
    t,
    s,
    index: timeOrderIndexForSlot(g, t, s)
  };
}
export function timeClockReactionDecision(g, timeora, actor, actorTeam = null, actorSlot = null) {
  if (!timeora || timeora.dead || !cardHasCapability(timeora, "timeControl")) return {
    ok: false,
    reason: "inactive"
  };
  if (status(timeora, "traitSeal")) return {
    ok: false,
    reason: "traitSeal"
  };
  const suppressionDomain = timeCurrentSuppressionDomain(g);
  if (suppressionDomain && suppressionDomain.suppresses(timeora)) return {
    ok: false,
    reason: "clockSuppressed"
  };
  const timePos = timeOrderSlotForUnit(g, timeora);
  let at = actorTeam,
    as = actorSlot;
  if (at == null || as == null) {
    const p = timeOrderSlotForUnit(g, actor);
    at = p.t;
    as = p.s;
  }
  const actorIndex = timeOrderIndexForSlot(g, at, as),
    tt = timeTeamOf(g, timeora);
  if (timePos.index >= 0 && actorIndex >= 0 && at && tt && at !== tt) {
    const previousIndex = (timePos.index - 1 + g.order.length) % g.order.length;
    if (actorIndex === previousIndex && !(g?.bossRaid && timeora?.bossRed)) return {
      ok: false,
      reason: "previousEnemyTurn"
    };
  }
  return {
    ok: true,
    reason: "react"
  };
}
export function timeShouldClockReact(g, timeora, actor, actorTeam = null, actorSlot = null) {
  return timeClockReactionDecision(g, timeora, actor, actorTeam, actorSlot).ok;
}
export function timePaidAmountFromAction(g, t, u, a) {
  const recorded = u?._timePaidRecord;
  if (recorded && Number(recorded.amount) > 0) return recorded.amount;
  if (a?.paymentPlan) return Number(a.paymentPlan.R || 0) + Number(a.paymentPlan.W || 0) + Number(a.paymentPlan.B || 0) + Number(a.extraW || 0);
  const base = card(u)?.skills?.find(x => x.id === a?.skill);
  const cost = a?.costOverride ?? base?.cost ?? "";
  return transformedSkillReq(g, t, u, cost).tokens.length + Number(a?.extraW || 0);
}
export function timeRotateClocks(g, t, s, actor, paidAmount, sim = false) {
  const boss = systems.__redTimeoraBossRaid;
  if (g?.bossRaid && typeof boss?.rotateClocksR36 === "function") return boss.rotateClocksR36(g, t, s, actor, paidAmount, sim);
  const n = Math.ceil(Math.max(0, Number(paidAmount) || 0) - 1e-9);
  if (!n) return [];
  const clocks = [];

  /* 모든 시계의 반응 가능 여부를 회전 시작 시점에 한 번만 스냅샷한다.
     앞에서 처리된 시계가 정렬을 풀거나 새로 맞추더라도, 같은 행동에 반응 중인
     뒤쪽 시계의 정지 여부가 중간에 바뀌어서는 안 된다. */
  const reactionSnapshot = timeFieldTimeoras(g).map(owner => ({
    owner,
    decision: timeClockReactionDecision(g, owner, actor, t, s),
    beforeHour: timeNormDeg(owner.timeHourDeg),
    beforeMinute: timeNormDeg(owner.timeMinuteDeg)
  }));
  for (const snap of reactionSnapshot) {
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
          team: timeTeamOf(g, owner),
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
      /* 특성봉인·상대 정렬로 완전히 정지한 시계는 회전 연출 목록에도 넣지 않는다. */
      continue;
    }
    const hourDelta = 30 * n,
      minuteDelta = owner.uid === actor.uid ? 90 * n : 0;
    owner.timeHourDeg = timeNormDeg(beforeHour + hourDelta);
    owner.timeMinuteDeg = timeNormDeg(beforeMinute + minuteDelta);
    clocks.push({
      uid: owner.uid,
      team: timeTeamOf(g, owner),
      beforeHour,
      beforeMinute,
      afterHour: owner.timeHourDeg,
      afterMinute: owner.timeMinuteDeg,
      hourDelta,
      minuteDelta,
      aligned: timeIsAligned(owner)
    });
    log(g, `${owner.name}의 운명의 시계: ${n}E 반응 · 시침 +${hourDelta}°${minuteDelta ? ` · 분침 +${minuteDelta}°` : ""} → ${owner.timeHourDeg}°/${owner.timeMinuteDeg}°${timeIsAligned(owner) ? " · 정렬" : ""}.`, "turn");
  }
  if (!sim && typeof state_ui_battle_state.game !== "undefined" && g === state_ui_battle_state.game && clocks.length) {
    state_ui_battle_state.visualEvents.push({
      type: "timeClockRotationFx",
      actionSerial: ++state_features_timeora.timeVisualSerial,
      actorUid: actor.uid,
      clocks
    });
  }
  return clocks;
}
export function timeHyperReason(u) {
  if (!u || !cardHasCapability(u, "timeControl")) return null;
  if (status(u, "traitSeal")) return "traitSeal";
  if (timeIsAligned(u)) return "clockAlignment";
  return null;
}
export function timeRecallValue(target) {
  if (!target || target.dead) return 0;
  const {
    snapshot
  } = timeRecallSnapshot(target);
  const hpDiff = combatInt(snapshot.hp) - combatInt(target.hp);
  const nowBad = Object.values(target.statuses || {}).reduce((n, v) => n + Number(v || 0), 0) + Object.values(target.skillSeals || {}).reduce((n, v) => n + Number(v || 0), 0);
  const oldBad = Object.values(snapshot.statuses || {}).reduce((n, v) => n + Number(v || 0), 0) + Object.values(snapshot.skillSeals || {}).reduce((n, v) => n + Number(v || 0), 0);
  return hpDiff + (nowBad - oldBad) * 16;
}
export function timeApplyRecall(g, actor, target, skill, ctx) {
  if (!target || target.dead) return 0;
  const {
    snapshot,
    turnsAgo
  } = timeRecallSnapshot(target);
  const beforeHp = target.hp;
  const keep = {
    shield: target.shield,
    barriers: target.hpProtectionBarriers,
    energy: target.energy,
    beastEnergy: target.beastEnergy,
    riderEnergy: target.riderEnergy,
    maxHp: target.maxHp
  };
  target.hp = Math.max(0, Math.min(target.maxHp, combatInt(snapshot.hp)));
  target.statuses = timeStatusClone(snapshot.statuses);
  target.statusAppliedTurnSerial = target.statuses.undead ? { undead: g.turnSerial } : {};
  target.skillSeals = timeStatusClone(snapshot.skillSeals);
  target.shield = keep.shield;
  target.hpProtectionBarriers = keep.barriers;
  target.energy = keep.energy;
  target.beastEnergy = keep.beastEnergy;
  target.riderEnergy = keep.riderEnergy;
  target.maxHp = keep.maxHp;
  const swing = target.hp - beforeHp;
  if (swing > 0) state_engine_entities.GenericBattleStatisticsOwner.recordHealing(g, {
    source: actor,
    target,
    requestedAmount: swing,
    actualAppliedAmount: swing,
    reason: "time-recall",
    effectId: "timeRecall",
    sim: !!ctx?.sim
  });
  log(g, `${actor.name}: 타임리콜로 ${target.name}을 ${turnsAgo}턴 전 자기 차례 시작 상태로 복귀 · HP ${combatInt(beforeHp)}→${combatInt(target.hp)}, 상태이상 기록 복원. 실드·추가 HP바·에너지·최대 HP는 유지.`, swing >= 0 ? "heal" : "damage");
  queueCombatNotice(g, target, `타임리콜 ${turnsAgo}턴`, "effect");
  if (typeof state_ui_battle_state.game !== "undefined" && g === state_ui_battle_state.game && !ctx?.sim) state_ui_battle_state.visualEvents.push({
    type: "timeRecallFx",
    uid: actor.uid,
    targetUid: target.uid,
    team: g.bossRaid && actor.bossRed ? "__bossRed" : timeTeamOf(g, actor),
    ...(g.bossRaid && actor.bossRed ? {
      bossRed: true
    } : {}),
    turnsAgo
  });
  if (target.hp <= 0) checkDeath(g, target, actor);
  return swing;
}
export function timePotentialReactors(g, actor, paidGuess = 1, t = null, s = null) {
  if (!(paidGuess > 0)) return [];
  return timeFieldTimeoras(g).filter(x => timeShouldClockReact(g, x, actor, t, s));
}
export function timeSetInputLock(on, holdBusy = true) {
  return state_runtime_input.InputLockManager.setClockLock(!!on, {
    holdBusy,
    owner: "timeSetInputLock"
  });
}
export function executeTimeAction(g, t, s, a, opt = {}) {
  const actor = unitAt(g, t, s);
  if (a?.type === "gather" && cardHasCapability(actor, "timeControl")) {
    const accelerationActive = timeAccelerationIsActive(g, actor);
    /* 로컬 미리보기와 권위 상태가 어긋나도 기본 1E로 조용히 행동을 소비하지 않는다. */
    if (a.timeAccelerationChoice && !accelerationActive) return false;
    if (accelerationActive) return timeExecuteTimeoraGather(g, t, s, actor, a, opt);
  }
  if (a?.type === "skill" && actionSkillHasTag(a, "copy") && actor?.memoryUsed) return false;
  if (a?.type === "skill" && actionSkillHasTag(a, "copy") && a.copySourceUid) {
    const source = (g.teams[t]?.bench || []).find(x => x?.uid === a.copySourceUid && !x.dead);
    if (!source) return false;
  }
  if (a?.type === "skill" && actionSkillHasEffect(a, "timeRecall") && cardHasCapability(actor, "timeControl") && actor.usedOnce?.[skillIdByEffect(actor, "timeRecall")]) return false;
  if (g?._timeAwaitingNextAiAction && !opt.sim) {
    timeMarkTimeline(g, "aiActionSubmitted", {
      actorEntityId: actor?.entityId || actor?.uid || null,
      actionType: a?.type || null
    });
    g._timeAwaitingNextAiAction = false;
  }
  const isSkill = a?.type === "skill";
  if (!isSkill) return executeCharacterAction(g, t, s, a, opt);
  if (cardHasCapability(actor, "timeControl") && actionSkillHasEffect(a, "hyperClock")) {
    const reason = timeHyperReason(actor);
    a = {
      ...a,
      timeHyperReason: reason,
      costOverride: status(actor, "traitSeal") ? "***" : a.costOverride || "WWorB*"
    };
    actor._timeHyperReason = reason;
  }
  const oldGame = state_engine_actions.timeTraitGame;
  state_engine_actions.timeTraitGame = g;
  const paidGuess = a.paymentPlan ? Number(a.paymentPlan.R || 0) + Number(a.paymentPlan.W || 0) + Number(a.paymentPlan.B || 0) : transformedSkillReq(g, t, actor, a.costOverride ?? skillOf(actor, a.skill)?.cost ?? "").tokens.length;
  const willReact = !!actor && timePotentialReactors(g, actor, paidGuess, t, s).length > 0;
  const liveClockBarrier = willReact && !opt.sim && g === state_ui_battle_state.game;
  if (liveClockBarrier) {
    g._timeDeferTurnAdvance = {
      teamId: t,
      slotIndex: s,
      actorEntityId: actor?.entityId || actor?.uid || null
    };
    timeMarkTimeline(g, "clockLockAcquired", {
      actorEntityId: actor?.entityId || actor?.uid || null
    });
    timeSetInputLock(true, true);
  }
  let result = false;
  try {
    result = executeCharacterAction(g, t, s, a, opt);
    if (!result) {
      if (liveClockBarrier) {
        delete g._timeDeferTurnAdvance;
        delete g.pendingClockTurnAdvance;
        timeSetInputLock(false);
        timeMarkTimeline(g, "clockLockReleased", {
          reason: "action-rejected"
        });
      }
      return result;
    }
    if (cardHasCapability(actor, "timeControl") && actionSkillHasEffect(a, "timeRecall")) actor.usedOnce[skillIdByEffect(actor, "timeRecall")] = true;
    if (!!firstSkillByTag(actor, "copy") && actionSkillHasTag(a, "copy") && a.copySkill) {
      actor.memoryUsed = true;
      actor.memoryUses = 1;
      log(g, `${actor.name}: 드래곤메모리로 ${state_catalog_cards.CARDS.find(c => c.id === a.copyCard)?.skills.find(sk => sk.id === a.copySkill)?.name || a.copySkill} 복사 · 드래곤메모리 1회 사용 소비됨.`, "turn");
    }
    const paid = timePaidAmountFromAction(g, t, actor, a);
    const rotatedClocks = timeRotateClocks(g, t, s, actor, paid, !!opt.sim);
    /* 원본 execute가 턴을 넘긴 뒤 시계가 회전하므로, 연속형 특성 수치도 여기서
       즉시 다시 계산해야 한 턴 늦게 반영되는 현상이 생기지 않는다. */
    if (rotatedClocks.length && typeof timeSyncContinuousTraitStates === "function") timeSyncContinuousTraitStates(g, "운명의 시계 회전");
    if (liveClockBarrier && !rotatedClocks.length) {
      timeSetInputLock(false);
      timeMarkTimeline(g, "clockLockReleased", {
        reason: "no-clock-events"
      });
      timeCommitPendingTurnAdvance(g);
    }
    return result;
  } finally {
    delete actor?._timeHyperReason;
    delete actor?._timePaidRecord;
    state_engine_actions.timeTraitGame = oldGame;
  }
}
export function timePeekGather(u, g, t) {
  const amt = status(u, "slow") ? .5 : 1,
    colors = naturalColors(g, t, u, amt, null, "time-acceleration-preview"),
    store = energyStore(u).map(e => ({
      ...e
    }));
  const previewState = Number(g?.rng?.s ?? 0),
    base = cloneRng(g.rng);
  const firstDraw = drawNaturalColorFrom(base, colors, store, amt),
    first = firstDraw.color,
    afterFirstState = base.s;
  const rerollRng = cloneRng(g.rng);
  rerollRng.s = afterFirstState;
  const second = drawNaturalColorFrom(rerollRng, colors, store, amt).color;
  const bonusRng = cloneRng(g.rng);
  bonusRng.s = afterFirstState;
  const afterFirst = storeAfterGain(store, first, amt),
    bonusDraw = drawNaturalColorFrom(bonusRng, colors, afterFirst, .5);
  return {
    first,
    second,
    bonusColor: bonusDraw.color,
    amt,
    previewState,
    afterFirstState
  };
}
export function timeAIShouldReroll(u, first) {
  const pool = {
    R: 0,
    W: 0,
    B: 0
  };
  energyStore(u).forEach(e => pool[e.c] += e.a);
  if (pool.W < 1 && first !== "W") return true;
  if (pool.W + pool.B < 2 && first === "R") return true;
  return false;
}
export function timeAccelerationIsActive(g, u) {
  if (!g || !u || u.dead || !cardHasCapability(u, "timeControl")) return false;
  const oldGame = state_engine_actions.timeTraitGame;
  state_engine_actions.timeTraitGame = g;
  try {
    return !!traitsActive(u);
  } finally {
    state_engine_actions.timeTraitGame = oldGame;
  }
}
export function timeExecuteTimeoraGather(g, t, s, u, a, opt = {}) {
  if (!timeAccelerationIsActive(g, u)) return false;
  const store = energyStore(u),
    baseStore = store.map(e => ({
      ...e
    })),
    amt = status(u, "slow") ? .5 : 1,
    colors = naturalColors(g, t, u, amt, null, "time-acceleration-execute");
  const stateBefore = Number(g?.rng?.s ?? 0);
  const firstDraw = drawNaturalColorFrom(g.rng, colors, baseStore, amt),
    first = firstDraw.color;
  let choice = a.timeAccelerationChoice || "auto";
  if (choice === "auto") choice = timeAIShouldReroll(u, first) ? "reroll" : "keep";
  if (choice !== "keep" && choice !== "reroll") return false;
  let gains = [];
  if (choice === "reroll") {
    const secondDraw = drawNaturalColorFrom(g.rng, colors, baseStore, amt),
      chosen = secondDraw.color;
    gains = [{
      c: chosen,
      a: amt,
      role: "reroll"
    }];
    log(g, `${u.name} 특성 · 시간 가속: 에너지를 재추첨함.`, "turn");
  } else {
    const afterFirst = storeAfterGain(baseStore, first, amt),
      bonusColor = drawNaturalColorFrom(g.rng, colors, afterFirst, .5).color;
    gains = [{
      c: first,
      a: amt,
      role: "first"
    }, {
      c: bonusColor,
      a: .5,
      role: "bonus",
      optional: true
    }];
  }
  return executeGatherGains(g, t, s, u, a, gains, {
    label: "시간 가속",
    stateBefore,
    logTotal: choice === "keep"
  }, opt);
}
export function timeOpenGatherOverflow(a, choice, peek) {
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    gains = choice === "keep" ? [{
      c: peek.first,
      a: peek.amt,
      role: "first"
    }, {
      c: peek.bonusColor,
      a: .5,
      role: "bonus",
      optional: true
    }] : [{
      c: peek.second,
      a: peek.amt,
      role: "reroll"
    }];
  openGatherGainsOverflow(a, t, s, u, gains, {
    title: "시간 가속 · 에너지 교환",
    identity: `timeAcceleration:${state_ui_battle_state.game?.turnSerial || 0}:${u.uid}`,
    extra: {
      timeAccelerationChoice: choice,
      timeFirstColor: peek.first,
      timeSecondColor: peek.second,
      timeBonusColor: peek.bonusColor,
      gatherPreviewState: peek.previewState
    }
  });
}
export function timeClockMiniHTML(u, g) {
  if (u?.bossRed) return raidClockHTML(u, g);
  const team = timeTeamOf(g, u),
    local = localTeamFor(g),
    theme = team === local ? "gold" : "blue",
    aligned = timeIsAligned(u);
  const stopReason = timeClockStopReason(g, u),
    stopped = !!stopReason,
    cancelled = aligned && timeClockAlignmentsCancel(g);
  const state = stopped ? stopReason === "traitSeal" ? "정지 · 특성봉인" : "정지 · 상대 시계 정렬" : cancelled ? "동시 정렬 · 효과 상쇄" : aligned ? "정렬 · 자신 외 전원 특성 정지" : "비정렬";
  const stateClass = stopped ? "stopped" : cancelled ? "cancelled" : aligned ? "aligned" : "";
  return `<div class="time-mini-clock-wrap ${stopped ? "clock-stopped-wrap" : ""}"><div class="time-mini-clock ${theme}${stopped ? " clock-stopped" : ""}${cancelled ? " clock-cancelled" : ""}"><span class="time-clock-hand hour" style="transform:translateX(-50%) rotate(${timeNormDeg(u.timeHourDeg)}deg)"></span><span class="time-clock-hand minute" style="transform:translateX(-50%) rotate(${timeNormDeg(u.timeMinuteDeg)}deg)"></span><span class="time-clock-pin"></span><span class="time-clock-word">Time</span></div><div><b>Time</b><br><span>시침 ${timeNormDeg(u.timeHourDeg)}° · 분침 ${timeNormDeg(u.timeMinuteDeg)}°</span><br><span class="time-mini-state ${stateClass}">${state}</span></div></div>`;
}
export function decorateTimeoraActions() {
  if (!state_ui_battle_state.game) return;
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s);
  if (!cardHasCapability(u, "timeControl")) return;
  for (const b of document.querySelectorAll('#actionButtons .skillbtn')) {
    const sk = skillOf(u, b.dataset.skillId);
    if (skillDefHasEffect(sk, "hyperClock")) {
      const reason = timeHyperReason(u),
        cost = b.querySelector('.cost'),
        tiny = b.querySelector('.tiny');
      if (cost) cost.textContent = status(u, 'traitSeal') ? '***' : 'W WorB *';
      if (tiny) tiny.textContent = `${reason ? '160D 강화' : '100D'} · 시침 ${timeNormDeg(u.timeHourDeg)}° / 분침 ${timeNormDeg(u.timeMinuteDeg)}°`;
    }
    if (skillDefHasEffect(sk, "timeRecall")) {
      const tiny = b.querySelector('.tiny');
      if (tiny) tiny.textContent = u.usedOnce?.[sk.id] ? '전투 1회 사용 완료' : '대상의 2턴 전 자기 차례 시작 HP·상태이상 복구';
    }
  }
}
export function timeSuppressedUidSet(g) {
  const domain = g ? timeCurrentSuppressionDomain(g) : null;
  return new Set([...(domain?.suppressedUids || [])].map(String));
}
/* 카드에 붙는 운명의 시계 상태 클래스. 카드 HTML을 만들 때와 렌더 뒤 동기화(소환수 카드 등)가 이 한 함수만 쓴다.
   진영·턴·타깃 상태와 무관하게 판정 영역(timeCurrentSuppressionDomain)이 정한 대로만 붙는다. */
export function timeClockCardState(g, unit, domain = g ? timeCurrentSuppressionDomain(g) : null) {
  const uid = unit?.uid;
  const suppressed = !!domain && uid != null && domain.suppresses(uid);
  const isClock = !!unit && cardHasCapability(unit, "timeControl");
  const stopped = isClock && !!timeClockStopReason(g, unit);
  return {
    "clock-trait-suppressed": suppressed,
    "clock-stopped-owner": stopped,
    "clock-owner-active": !!domain && uid != null && domain.owns(uid) && !suppressed,
    "clock-owner-cancelled": !!g && isClock && timeClockAlignmentsCancel(g) && timeIsAligned(unit) && !stopped
  };
}
/* 막 정지된 카드에만 채도가 낮아지는 전환을 보여 주기 위한 기록. 카드는 렌더마다 새로 만들어지므로
   정지가 시작된 시각을 유닛별로 기억해 두고, 전환 시간 안이면 지난 시간만큼 앞당겨 이어서 재생한다. */
const TIME_CLOCK_ENTER_MS = 260;
const timeClockSuppressedSince = new Map();
export function timeClockCardHTMLState(g, unit) {
  const state = timeClockCardState(g, unit);
  const key = String(unit.uid);
  let style = "";
  const classes = Object.keys(state).filter(name => state[name]);
  if (state["clock-trait-suppressed"]) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!timeClockSuppressedSince.has(key)) timeClockSuppressedSince.set(key, now);
    const elapsed = now - timeClockSuppressedSince.get(key);
    if (elapsed < TIME_CLOCK_ENTER_MS) {
      classes.push("clock-sat-enter");
      style = `animation-delay:-${Math.round(elapsed)}ms`;
    }
  } else timeClockSuppressedSince.delete(key);
  return {
    className: classes.join(" "),
    style
  };
}
export function timeSyncSuppressionVisuals(g = typeof state_ui_battle_state.game !== "undefined" ? state_ui_battle_state.game : null) {
  const domain = g ? timeCurrentSuppressionDomain(g) : null;
  const uids = timeSuppressedUidSet(g);
  document.querySelectorAll('.arena .battle-unit-card[data-zone="field"],.arena .summon-card').forEach(el => {
    const uid = el.dataset.uid || el.dataset.entityId;
    const unit = g && uid != null ? findUnit(g, uid) : null;
    const state = timeClockCardState(g, unit || {
      uid
    }, domain);
    for (const [name, on] of Object.entries(state)) el.classList.toggle(name, on);
  });
  return uids;
}
export function timeColorForTeam(g, t) {
  if (g?.bossRaid && (t === "A" || t === "__bossRed")) return "#ff4058";
  return t === localTeamFor(g) ? "#ffd558" : "#58bfff";
}
export function timeThemeForTeam(g, t) {
  if (g?.bossRaid && (t === "A" || t === "__bossRed")) return "red";
  return t === localTeamFor(g) ? "gold" : "blue";
}
export function timeClockFaceNode(theme, beforeHour, beforeMinute) {
  const face = document.createElement('div');
  face.className = `time-clock-face ${theme}`;
  face.innerHTML = '<span class="time-clock-tick t0"></span><span class="time-clock-tick t1"></span><span class="time-clock-tick t2"></span><span class="time-clock-tick t3"></span><span class="time-clock-hand hour"></span><span class="time-clock-hand minute"></span><span class="time-clock-pin"></span><span class="time-clock-word">Time</span>';
  const h = face.querySelector('.hour'),
    m = face.querySelector('.minute');
  h.style.transform = `translateX(-50%) rotate(${beforeHour}deg)`;
  m.style.transform = `translateX(-50%) rotate(${beforeMinute}deg)`;
  return face;
}
export function timeAnimateHand(el, from, to, duration, extraTurns = 0) {
  const delta = ((to - from) % 360 + 360) % 360;
  const destination = from + delta + Math.max(0, Number(extraTurns) || 0) * 360;
  return el.animate([{
    transform: `translateX(-50%) rotate(${from}deg)`
  }, {
    transform: `translateX(-50%) rotate(${destination}deg)`
  }], {
    duration,
    easing: 'cubic-bezier(.12,.82,.14,1)',
    fill: 'forwards'
  }).finished.catch(() => {});
}
export function timeJitterHand(el, base, duration = 720) {
  return el.animate([{
    transform: `translateX(-50%) rotate(${base}deg)`
  }, {
    transform: `translateX(-50%) rotate(${base - 18}deg)`
  }, {
    transform: `translateX(-50%) rotate(${base + 16}deg)`
  }, {
    transform: `translateX(-50%) rotate(${base - 10}deg)`
  }, {
    transform: `translateX(-50%) rotate(${base + 8}deg)`
  }, {
    transform: `translateX(-50%) rotate(${base}deg)`
  }], {
    duration,
    easing: 'cubic-bezier(.16,.68,.2,1)',
    fill: 'forwards'
  }).finished.catch(() => {});
}
export function timeTrackVisualTimers(fn) {
  return TimerManager.captureTimeouts(fn);
}
export function timeNextFrame() {
  return new Promise(r => TimerManager.requestAnimationFrame(() => TimerManager.requestAnimationFrame(r)));
}
export async function timeWaitNamedAnimation(node, name, fallbackMs = 1000) {
  await timeNextFrame();
  const list = (node?.getAnimations?.({
    subtree: true
  }) || []).filter(a => !name || a.animationName === name);
  if (list.length) {
    await Promise.allSettled(list.map(a => a.finished.catch(() => {})));
    return;
  }
  await new Promise(r => TimerManager.setTimeout(r, fallbackMs));
}
export async function timePlayHyperVisual(v) {
  const arena = document.querySelector('.arena'),
    fromEl = state_presentation_coordinates.battleEntityElement(v.uid),
    toEl = state_presentation_coordinates.battleEntityElement(v.targetUid);
  if (!arena || !fromEl || !toEl) return;
  const from = state_presentation_coordinates.VfxCoordinateOwner.point(arena, fromEl),
    to = state_presentation_coordinates.VfxCoordinateOwner.point(arena, toEl),
    color = timeColorForTeam(state_ui_battle_state.game, v.team);
  if (!v.enhanced) {
    const beam = document.createElement('div');
    beam.className = 'time-hyper-beam';
    beam.style.setProperty('--from-x', `${from.x}px`);
    beam.style.setProperty('--from-y', `${from.y}px`);
    beam.style.setProperty('--beam-length', `${Math.hypot(to.x - from.x, to.y - from.y)}px`);
    beam.style.setProperty('--beam-angle', `${Math.atan2(to.y - from.y, to.x - from.x)}rad`);
    beam.style.setProperty('--time-color', color);
    arena.appendChild(beam);
    const impact = document.createElement('div');
    impact.className = 'time-hyper-impact';
    impact.style.setProperty('--time-color', color);
    systems.AnimationEngine.mountViewportFx(impact, arena, to, {
      ttlMs: 2200,
      reason: 'time-hyper-impact'
    });
    await Promise.allSettled([...beam.getAnimations(), ...impact.getAnimations()].map(a => a.finished.catch(() => {})));
    beam.remove();
    systems.AnimationEngine.unmountViewportFx(impact);
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'time-hyper-clock';
  wrap.style.setProperty('--time-color', color);
  const face = timeClockFaceNode(timeThemeForTeam(state_ui_battle_state.game, v.team), 25, 300);
  wrap.appendChild(face);
  systems.AnimationEngine.mountViewportFx(wrap, arena, to, {
    ttlMs: 6800,
    reason: 'time-hyper-clock'
  });
  await timeWaitNamedAnimation(wrap, 'timeHyperClockAppear', 720);
  await Promise.allSettled([timeAnimateHand(face.querySelector('.hour'), 25, 180, 2050, 10), timeAnimateHand(face.querySelector('.minute'), 300, 360, 2050, 15)]);
  wrap.classList.add('aligned');
  await timeWaitNamedAnimation(wrap, 'timeHyperClockAlign', 1080);
  wrap.classList.add('explode');
  await timeWaitNamedAnimation(wrap, 'timeHyperClockBlast', 1240);
  systems.AnimationEngine.unmountViewportFx(wrap);
}
export function timePlayRecallVisual(v) {
  const arena = document.querySelector('.arena'),
    el = state_presentation_coordinates.battleEntityElement(v.targetUid);
  if (!arena || !el) return Promise.resolve();
  const node = document.createElement('div');
  node.className = 'time-recall-fx';
  node.style.setProperty('--time-color', timeColorForTeam(state_ui_battle_state.game, v.team));
  systems.AnimationEngine.mountViewportFx(node, arena, state_presentation_coordinates.VfxCoordinateOwner.point(arena, el), {
    ttlMs: 2200,
    reason: 'time-recall'
  });
  return Promise.allSettled(node.getAnimations().map(a => a.finished.catch(() => {}))).then(() => systems.AnimationEngine.unmountViewportFx(node));
}


export function listClockSkillActions(g, t, s) {
  let actions = [];
  const u = unitAt(g, t, s);
  if (!u || u.dead) return actions;
  if (!cardHasCapability(u, "timeControl") || u.scheduledAction || status(u, "freeze") || status(u, "skillSeal")) return actions;
  if (!u.skillSeals?.[skillIdByEffect(u, "timeRecall")] && !u.usedOnce?.[skillIdByEffect(u, "timeRecall")] && canPayAction(g, t, u, "**")) {
    for (const team of [t, other(t)]) for (let i = 0; i < 2; i++) {
      const target = unitAt(g, team, i);
      if (target && !target.dead) actions.push({
        type: "skill",
        skill: skillIdByEffectGlobal("timeRecall"),
        target: {
          team,
          slot: i,
          uid: target.uid
        },
        label: `타임리콜 → ${target.name}`
      });
    }
  }
  const hcCost = status(u, "traitSeal") ? "***" : "WWorB*";
  if (!u.skillSeals?.[skillIdByEffect(u, "hyperClock")] && canPayAction(g, t, u, hcCost)) {
    const reason = timeHyperReason(u);
    for (const target of enemyTargets(g, t)) actions.push({
      type: "skill",
      skill: skillIdByEffectGlobal("hyperClock"),
      target,
      costOverride: hcCost,
      displayCost: hcCost,
      timeHyperReason: reason,
      label: `하이퍼클락 ${reason ? "160D" : "100D"}`
    });
  }
  return actions;
}
export { timePlayClockRotationOverlay } from "../presentation/clock-mirror.js";
export function applyClockEffect(g, actor, target, e, skill, ctx = {}) {
  if (e.type === "timeRecall") return timeApplyRecall(g, actor, target, skill, ctx);
  const reason = ctx.action?.timeHyperReason || actor._timeHyperReason || timeHyperReason(actor);
  const raw = reason ? 160 : 100;
  const guarded = !!(g.bossRaid && actor.bossRed && g.bossRaid.hyperGuard > 0);
  const amount = guarded ? Math.max(0, raw - 60) : raw;
  if (guarded) {
    g.bossRaid.hyperGuard--;
    log(g, "레이드 보상 · 시간 방벽: 하이퍼클락 " + raw + "D → " + amount + "D.", "turn");
  } else if (reason === "traitSeal") log(g, actor.name + ": 특성봉인으로 하이퍼클락이 *** 160D 강화됨. 적 특성은 정상 작동.", "turn");else if (reason === "clockAlignment") log(g, actor.name + ": 운명의 시계 정렬로 하이퍼클락이 160D 강화됨. 이번 공격 처리 동안 시계 주인 외 특성 정지.", "turn");
  const dealt = dealDamage(g, actor, target, {
    amount
  }, skill, ctx.sim);
  if (g === state_ui_battle_state.game && !ctx.sim) state_ui_battle_state.visualEvents.push({
    type: "hyperClockFx",
    uid: actor.uid,
    targetUid: target?.uid || null,
    team: g.bossRaid && actor.bossRed ? "__bossRed" : timeTeamOf(g, actor),
    ...(g.bossRaid && actor.bossRed ? {
      bossRed: true
    } : {}),
    enhanced: !!reason,
    reason,
    amount: dealt,
    rawAmount: raw
  });
  return dealt;
}
export function listMemoryActions(g, t, s) {
  let actions = [],
    actor = unitAt(g, t, s);
  if (!actor || actor.dead || !firstSkillByTag(actor, "copy") || actor.memoryUsed || actor.scheduledAction || actor.skillSeals?.[skillIdByTag(actor, "copy")] || status(actor, "freeze") || status(actor, "skillSeal")) return actions;
  for (const option of memoryOptions(g, t, actor)) {
    if (!copiedSkillAllowed(actor, option.skill)) continue;
    for (const cost of option.costVariants || [option.cost]) {
      const plan = findPaymentPlan(g, t, actor, cost);
      if (!plan) continue;
      const targets = dmTargetRefs(g, t, s, actor, option.skill);
      for (const target of targets) {
        const targetKey = target ? `${target.team}:${target.slot}:${target.uid || "slot"}` : "none";
        const actionId = `memory:${dmBattleInstanceId(g)}:${g.turnSerial}:${actor.uid}:${option.unit.uid}:${option.skill.id}:${cost}:${targetKey}`;
        actions.push({
          ...dmMemoryAction(g, t, s, actor, option, cost, target, actionId),
          paymentPlan: {
            ...plan
          }
        });
      }
    }
  }
  return actions;
}
