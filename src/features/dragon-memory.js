// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_features_dragon_memory = {
  dmActionSerial: undefined,
  dmEffectSerial: undefined,
  dmPendingFlow: undefined,
  dmCurrentActionContext: undefined,
  dmExecutingActionIds: undefined,
  dmShownEffectEventIds: undefined
};
import { unitAt } from "../engine/actions.js";
import { memoryOptions } from "../engine/effects.js";
import { canPayAction, status, transformedSkillReq } from "../engine/energy.js";
import { actionSkillHasTag, cardHasTag, firstSkillByTag, resolveSkillTargets, skillDefHasEffect, skillIdByTag, skillIdByTagGlobal } from "../engine/entities.js";
import { copiedSkillAllowed, openDragonMemoryMenu } from "./elixian.js";
import { normalizeGameNumberText } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { state_ui_action_panel } from "../ui/action-panel.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_deck } from "../ui/deck.js";
import { dispatchPlayerSkill } from "../ui/payment.js";
import { state_ui_targeting } from "../ui/targeting.js";
export function initializeFeaturesDragonMemory() {
  /* 드래곤메모리 실행 경로와 효과 알림 대상 추적 최종 패치 */
  systems.DEBUG_BATTLE_EVENTS = false;
  state_features_dragon_memory.dmActionSerial = 0;
  state_features_dragon_memory.dmEffectSerial = 0;
  state_features_dragon_memory.dmPendingFlow = null;
  state_features_dragon_memory.dmCurrentActionContext = null;
  state_features_dragon_memory.dmExecutingActionIds = new Set();
  state_features_dragon_memory.dmShownEffectEventIds = new Set();
  state_ui_action_panel.ActionRenderEngine.registerDecorator("dragon-memory", 500, ctx => decorateDragonMemoryActions(ctx?.viewModel));

  /* 대상 선택 후에도 반드시 플레이어가 에너지 아이콘을 직접 골라 결제한다. */

  /* 실행 직전 인스턴스·대상·결제·중복 여부를 검증한다. */

  /* 화면에 내부 오류 문자열을 노출하지 않는다. */

  document.querySelector("#closeModal")?.addEventListener("click", () => {
    if (state_features_dragon_memory.dmPendingFlow && !state_features_dragon_memory.dmPendingFlow.executing) {
      state_ui_targeting.TargetSelectionApplication.cancel("dragon-memory-modal-close", {
        dragonMemory: true,
        releaseBusy: false,
        closeModal: false,
        project: true
      });
    }
  });

  /* ================================================================
     제노사이더 17th 4☆ · 엘릭시안 상시 회복증폭 제거 · 온라인 자동 매칭/탈주
     현재 파일의 기존 구조를 유지한 확장 패치
     ================================================================ */
}
export function dmDebug(label, payload = {}) {
  if (!systems.DEBUG_BATTLE_EVENTS) return;
  try {
    console.debug(`[BATTLE:${label}]`, JSON.parse(JSON.stringify(payload)));
  } catch (_) {
    console.debug(`[BATTLE:${label}]`, payload);
  }
}
export function dmBattleInstanceId(g) {
  return String(g?.matchId || g?.token || g?.seed || "battle");
}
export function dmNewActionId(g, actor) {
  state_features_dragon_memory.dmActionSerial += 1;
  return `${dmBattleInstanceId(g)}:dm:${actor?.uid || "actor"}:${g?.turnSerial || 0}:${state_features_dragon_memory.dmActionSerial}`;
}
export function dmEscapeSelector(value) {
  const s = String(value ?? "");
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}
export function dmCleanDisplayText(value) {
  const s = normalizeGameNumberText(value).replace(/\s+/g, " ").trim();
  if (!s || /\b(?:undefined|null|NaN)\b/i.test(s)) return "";
  return s.length > 42 ? `${s.slice(0, 41)}…` : s;
}
export function dmFieldEntity(g, uid) {
  if (!g || !uid) return null;
  for (const t of ["P", "A"]) {
    const slot = (g.teams[t]?.field || []).findIndex(u => u?.uid === uid && !u.dead);
    if (slot >= 0) return {
      team: t,
      slot,
      unit: g.teams[t].field[slot]
    };
  }
  return null;
}

/* 카드 인스턴스 DOM에 고유 entityId와 전용 팝업 레이어를 부여한다. */

/* 이름·슬롯·현재 턴 추측을 완전히 제거한다. */

/* 로그로 수신자를 재추측하지 않고 실제 상태 변경 함수에서 직접 이벤트를 만든다. */

/* 카드 데이터의 dragon 태그만 사용한다. 폭시어스는 기존 드래곤 분류를 데이터에 명시한다. */
export function dmIsDragonCard(c) {
  return !!(c?.isDragon || cardHasTag(c, "dragon"));
}
export function dmMemoryBaseCosts(actor, skill) {
  if (!skill) return [];
  if (skillDefHasEffect(skill, "foxStrike")) return [actor.memoryStrikeSingleColor || "*"];
  const raw = String(skill.cost || "").trim();
  if (/^W\s*or\s*B$/i.test(raw) || raw === "WorB") return ["W", "B"];
  if (/^R\s*or\s*B$/i.test(raw) || raw === "RorB") return ["R", "B"];
  return [raw];
}
export function dmAppendMemoryCost(raw) {
  return String(raw || "");
}
export function dmTargetRefs(g, t, s, actor, skill) {
  return resolveSkillTargets(g, t, s, actor, skill, {
    defaultEnemy: true
  });
}
export function dmMemoryAction(g, t, s, actor, option, cost, target, actionId) {
  return {
    type: "skill",
    skill: skillIdByTagGlobal("copy"),
    copySkill: option.skill.id,
    copyCard: option.card.id,
    copySourceUid: option.unit.uid,
    copyTargetType: option.skill.target,
    costOverride: cost,
    target,
    actionId,
    isCopiedSkill: true,
    battleInstanceId: dmBattleInstanceId(g),
    label: `드래곤메모리: ${option.card.name} · ${option.skill.name}`,
    ...(skillDefHasEffect(option.skill, "foxStrike") ? {
      strikeMode: "single"
    } : {})
  };
}
export function dmCostLabel(g, t, actor, cost) {
  return transformedSkillReq(g, t, actor, cost).tokens.join(" ") || "없음";
}
export function dmLocalTurn(g, t) {
  if (g.mode === "human") return t === "P";
  if (g.mode === "online") return t === state_ui_deck.onlineSide;
  return false;
}
export function dmChooseMemoryOption(option) {
  if (!state_ui_battle_state.game) return;
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    actor = unitAt(state_ui_battle_state.game, t, s);
  if (!actor || actor.memoryUsed || !copiedSkillAllowed(actor, option.skill)) return;
  const variants = (option.costVariants || [option.cost]).filter(cost => canPayAction(state_ui_battle_state.game, t, actor, cost));
  if (!variants.length) return;
  const actionId = dmNewActionId(state_ui_battle_state.game, actor);
  const targets = dmTargetRefs(state_ui_battle_state.game, t, s, actor, option.skill);
  const actions = [];
  for (const cost of variants) for (const target of targets) actions.push(dmMemoryAction(state_ui_battle_state.game, t, s, actor, option, cost, target, actionId));
  if (!actions.length) {
    state_ui_targeting.TargetSelectionApplication.cancel("dragon-memory-actions-empty", {
      dragonMemory: true,
      releaseBusy: true,
      closeModal: true
    });
    return;
  }
  state_features_dragon_memory.dmPendingFlow = {
    actionId,
    actorUid: actor.uid,
    sourceUid: option.unit.uid,
    skillId: option.skill.id,
    stage: "target-or-payment"
  };
  const uniqueTargets = [];
  const seen = new Set();
  for (const a of actions) {
    const key = `${a.target?.team}:${a.target?.slot}:${a.target?.uid || "slot"}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTargets.push(a.target);
    }
  }
  state_ui_battle_state.$("#modal").classList.remove("open");
  state_features_dragon_memory.dmPendingFlow.stage = "target";
  state_ui_targeting.TargetSelectionApplication.begin({
    actions,
    targets: uniqueTargets,
    slotTarget: option.skill.target === "enemySlot",
    reason: "dragon-memory-multicost-target-selection"
  });
}

/* UI에서는 복사 후보 액션을 직접 노출하지 않고 0코스트 진입 버튼 하나만 둔다. */
export function decorateDragonMemoryActions(viewModel = null) {
  if (!state_ui_battle_state.game || !viewModel?.projection?.canAct) return;
  const box = state_ui_battle_state.$("#actionButtons"),
    [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    actor = unitAt(state_ui_battle_state.game, t, s);
  if (!box || !actor) return;
  [...box.querySelectorAll("button")].forEach(button => {
    if ((button.textContent || "").trim().startsWith("드래곤메모리")) button.remove();
  });
  if (state_features_dragon_memory.dmPendingFlow?.stage === "target" && state_ui_battle_state.pendingSkill?.actions?.some(a => actionSkillHasTag(a, "copy"))) {
    box.innerHTML = "";
    const cancel = document.createElement("button");
    cancel.className = "dragon-memory-target-cancel";
    cancel.textContent = "대상 선택 취소";
    cancel.onclick = () => state_ui_targeting.TargetSelectionApplication.cancel("dragon-memory-target-cancel", {
      dragonMemory: true,
      releaseBusy: true,
      closeModal: true
    });
    box.appendChild(cancel);
    return;
  }
  if (!!firstSkillByTag(actor, "copy") && !actor.dead && !actor.skillSeals?.[skillIdByTag(actor, "copy")] && !status(actor, "freeze") && !status(actor, "skillSeal") && dmLocalTurn(state_ui_battle_state.game, t) && memoryOptions(state_ui_battle_state.game, t, actor).length) {
    const button = document.createElement("button");
    button.className = "skillbtn dragon-memory-main-button";
    button.innerHTML = `<b>드래곤메모리</b> <span class="cost">0</span><br><span class="tiny">후열에 있는 드래곤의 기술을 복사한다.</span>`;
    button.onclick = () => {
      if (!state_ui_battle_state.busy && !state_features_dragon_memory.dmPendingFlow) openDragonMemoryMenu();
    };
    box.appendChild(button);
  }
}
