// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_ui_targeting = {
  TargetSelectionApplication: undefined
};
import { state_runtime_input } from "../runtime/input.js";
import { unitAt } from "../engine/actions.js";
import { actionSkillHasTag } from "../engine/entities.js";
import { state_features_dragon_memory } from "../features/dragon-memory.js";
import { manualSummonSurfaceContext } from "../online/emotes.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "./battle-state.js";
import { dispatchPlayerSkill, render } from "./payment.js";
export function initializeUiTargeting() {
  state_ui_targeting.TargetSelectionApplication = (() => {
    const snapshot = () => Object.freeze({
      pending: !!state_ui_battle_state.pendingSkill,
      actionCount: Array.isArray(state_ui_battle_state.pendingSkill?.actions) ? state_ui_battle_state.pendingSkill.actions.length : 0,
      targetCount: Array.isArray(state_ui_battle_state.pendingSkill?.targets) ? state_ui_battle_state.pendingSkill.targets.length : 0,
      slotTarget: !!state_ui_battle_state.pendingSkill?.slotTarget,
      dragonMemory: !!state_ui_battle_state.pendingSkill?.actions?.some?.(action => actionSkillHasTag(action, "copy")),
      phase: state_ui_battle_state.game?.phase || null
    });
    const begin = ({
      actions,
      targets,
      slotTarget = false,
      reason = "target-selection"
    }) => {
      if (!Array.isArray(actions) || !actions.length) return false;
      /* 고를 대상이 하나(또는 없음)면 선택 화면을 열지 않고 바로 진행한다. 대상 선택은 이 한 곳에서만 판단한다. */
      const seen = new Set(),
        unique = (Array.isArray(targets) ? targets : []).filter(target => {
          if (!target) return false;
          const key = `${target.team}:${target.slot}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      if (unique.length <= 1) {
        state_ui_battle_state.pendingSkill = {
          actions,
          targets: unique,
          slotTarget: !!slotTarget
        };
        if (unique.length === 1) choose(unique[0]);else {
          clearPending({
            reason: "no-target-selection",
            restoreActionPhase: false,
            releaseTargetLock: true
          });
          if (state_features_dragon_memory.dmPendingFlow) state_features_dragon_memory.dmPendingFlow.stage = "payment";
          dispatchPlayerSkill(actions);
        }
        return Object.freeze({
          ok: true,
          reason: unique.length ? "auto-single-target" : "auto-no-target",
          ...snapshot()
        });
      }
      state_ui_battle_state.pendingSkill = {
        actions,
        targets: unique,
        slotTarget: !!slotTarget
      };
      render();
      return Object.freeze({
        ok: true,
        reason,
        ...snapshot()
      });
    };
    const clearPending = ({
      reason = "target-selection-clear",
      restoreActionPhase = false,
      releaseTargetLock = true
    } = {}) => {
      const g = state_ui_battle_state.game;
      const wasTargeting = !!state_ui_battle_state.pendingSkill || !!g?.pendingTargetSelection || String(g?.phase || "") === "WAITING_FOR_TARGET";
      state_ui_battle_state.pendingSkill = null;
      if (g?.pendingTargetSelection != null) g.pendingTargetSelection = null;
      if (restoreActionPhase && wasTargeting && g && !g.ended && !g.winner) g.phase = "WAITING_FOR_ACTION";
      if (releaseTargetLock && wasTargeting && typeof state_runtime_input.InputLockManager !== "undefined") state_runtime_input.InputLockManager.unlock("target-selection");
      return Object.freeze({
        ok: true,
        reason,
        wasTargeting,
        phase: g?.phase || null
      });
    };
    const cancel = (reason = "cancel-target-selection", options = {}) => {
      const dragonMemory = options.dragonMemory === true;
      const result = clearPending({
        reason,
        restoreActionPhase: true,
        releaseTargetLock: true
      });
      if (dragonMemory && typeof state_features_dragon_memory.dmPendingFlow !== "undefined") state_features_dragon_memory.dmPendingFlow = null;
      if (options.releaseBusy === true && typeof state_ui_battle_state.busy !== "undefined") state_ui_battle_state.busy = false;
      if (options.closeModal === true) document.querySelector("#modal")?.classList.remove("open");
      if (options.project !== false && state_ui_battle_state.game) render();
      return result;
    };
    const choose = targetRef => {
      if (!state_ui_battle_state.pendingSkill?.actions?.length || !targetRef) return false;
      const matches = state_ui_battle_state.pendingSkill.actions.filter(action => action?.target?.team === targetRef.team && action?.target?.slot === targetRef.slot);
      if (!matches.length) return false;
      if (matches.some(action => actionSkillHasTag(action, "copy"))) {
        const live = matches.filter(action => {
          if (action?.target?.uid != null && targetRef.uid != null && action.target.uid !== targetRef.uid) return false;
          if (action.copyTargetType === "enemySlot") return true;
          const unit = unitAt(state_ui_battle_state.game, action.target.team, action.target.slot);
          return !!unit && !unit.dead && unit.uid === action.target.uid;
        });
        if (!live.length) {
          cancel("dragon-memory-target-stale", {
            dragonMemory: true,
            releaseBusy: true,
            closeModal: true
          });
          return false;
        }
        clearPending({
          reason: "dragon-memory-target-selected",
          restoreActionPhase: false,
          releaseTargetLock: true
        });
        if (typeof state_features_dragon_memory.dmPendingFlow !== "undefined" && state_features_dragon_memory.dmPendingFlow) state_features_dragon_memory.dmPendingFlow.stage = "payment";
        dispatchPlayerSkill(live);
        return true;
      }
      clearPending({
        reason: "target-selected",
        restoreActionPhase: false,
        releaseTargetLock: true
      });
      dispatchPlayerSkill(matches);
      return true;
    };
    return Object.freeze({
      begin,
      choose,
      cancel,
      clearPending,
      snapshot
    });
  })();
}
export function chooseOrExecute(candidates, slotTarget = false) {
  let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn];
  if (!candidates.some(x => x.target?.team !== t)) {
    dispatchPlayerSkill(candidates);
  } else {
    state_ui_targeting.TargetSelectionApplication.begin({
      actions: candidates,
      targets: candidates.map(x => x.target),
      slotTarget,
      reason: "skill-target-selection"
    });
  }
}
export function actionPanelSurfaceContext(g) {
  const manual = typeof manualSummonSurfaceContext === "function" ? manualSummonSurfaceContext(g) : null;
  if (manual) return manual;
  return Object.freeze({
    kind: g?.bossRaid ? "boss-raid" : "base",
    eligibilityContext: null,
    manualSummon: null,
    boss: g?.bossRaid ? Object.freeze({
      online: !!g.bossRaid.online,
      localControl: !g?.bossRaid || !!systems.__redTimeoraBossRaid?.localControlsCurrent(g)
    }) : null
  });
}
