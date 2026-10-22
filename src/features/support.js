import { executeCoreBase } from '../engine/execution.js';
import { activeEterna, eternaLocksTeam } from "../app/controls.js";
import { state_catalog_cards } from "../catalog/cards.js";
import { other, unitAt } from "../engine/actions.js";
import { findPaymentPlan } from "../engine/energy.js";
import { actionSkillHasEffect, actionSkillHasTag, card, cardHasCapability, firstSkillByEffect, firstSkillByTag, skillHasTag } from "../engine/entities.js";
import { dmBattleInstanceId, dmDebug, dmIsDragonCard, dmNewActionId, state_features_dragon_memory } from "./dragon-memory.js";
import { copiedSkillAllowed, syncAromaCombatFlags } from "./elixian.js";
import { foxPlanColors, foxSingleCost } from "./foxious.js";
import { executeGenociderDisplosion, reactiveEnergyAmount, reactiveEnergyRule, reconcileAllReactiveEnergyUnits, state_features_genocider } from "./genocider.js";
import { countCompleteW, executeCustomGather, summonLimitReached } from "./summons.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
export function executeCharacterAction(g, t, s, a, opt = {}) {
  const actor = unitAt(g, t, s);
  if (g?.bossRaid && a?.type === "bossPassEmpty") return systems.__redTimeoraBossRaid?.passEmpty?.(g, t, s);
  const previousReactive = state_features_genocider.reactiveEnergyCurrentGame;
  state_features_genocider.reactiveEnergyCurrentGame = g;
  if (a?.type === "skill" && actionSkillHasEffect(a, "genociderSlashClaw") && reactiveEnergyRule(actor)) actor._genociderSlashSnapshot = reactiveEnergyAmount(actor);
  try {
    if (a?.type === "skill" && actionSkillHasEffect(a, "genociderDisplosion")) return executeGenociderDisplosion(g, t, s, a, opt);
    let dmActive = false,
      dmActionId = null,
      dmPreviousContext = null;
    if (a?.type === "skill" && actionSkillHasTag(a, "copy") && a.copySkill) {
      dmActionId = String(a.actionId || dmNewActionId(g, actor));
      if (state_features_dragon_memory.dmExecutingActionIds.has(dmActionId)) {
        dmDebug("duplicate-action-blocked", {
          actionId: dmActionId
        });
        return false;
      }
      const source = (g.teams[t]?.bench || []).find(x => x?.uid === a.copySourceUid && !x.dead),
        sourceCard = source && card(source),
        copiedSkill = sourceCard?.skills.find(sk => sk.id === a.copySkill);
      if (!actor || actor.dead || !firstSkillByTag(actor, "copy") || !source || !dmIsDragonCard(sourceCard) || !copiedSkill) return false;
      if (a.copyTargetType !== "enemySlot" && !["field"].includes(a.copyTargetType)) {
        const target = a.target && unitAt(g, a.target.team, a.target.slot);
        if (!target || target.dead || a.target.uid && target.uid !== a.target.uid) return false;
      }
      const plan = a.paymentPlan;
      if (!plan || !findPaymentPlan(g, t, actor, a.costOverride || "", a.actor || null, c => Math.abs(c.R - plan.R) < .001 && Math.abs(c.W - plan.W) < .001 && Math.abs(c.B - plan.B) < .001)) return false;
      state_features_dragon_memory.dmExecutingActionIds.add(dmActionId);
      dmPreviousContext = state_features_dragon_memory.dmCurrentActionContext;
      dmActive = true;
      state_features_dragon_memory.dmCurrentActionContext = {
        actionId: dmActionId,
        battleInstanceId: dmBattleInstanceId(g),
        sourceEntityId: actor.uid,
        casterEntityId: actor.uid,
        copySourceEntityId: source.uid,
        copySkillId: copiedSkill.id,
        targetEntityId: a.target?.uid || null,
        targetSlot: a.target ? `${a.target.team}:${a.target.slot}` : null,
        selectedEnergy: {
          ...plan
        },
        appliedCost: a.costOverride,
        copied: true
      };
      dmDebug("action-start", state_features_dragon_memory.dmCurrentActionContext);
      a = {
        ...a,
        actionId: dmActionId
      };
    }
    try {
      syncAromaCombatFlags(g);
      let copiedBase = null,
        copiedSaved = null;
      if (a?.type === "skill" && a.copySkill && actionSkillHasTag(a, "copy")) {
        copiedBase = actor && card(actor).skills.find(x => x.id === a.skill);
        const source = state_catalog_cards.CARDS.find(c => c.id === a.copyCard),
          copied = source?.skills.find(x => x.id === a.copySkill);
        if (!actor || !copiedBase || !copied || !copiedSkillAllowed(actor, copied)) return false;
        copiedSaved = {
          target: copiedBase.target,
          effects: copiedBase.effects,
          tags: copiedBase.tags,
          nonAttack: copiedBase.nonAttack
        };
        copiedBase.target = copied.target;
        copiedBase.effects = copied.effects;
        copiedBase.tags = copied.tags;
        copiedBase.nonAttack = copied.nonAttack;
      }
      try {
        if (a?.type === "skill" && actionSkillHasEffect(a, "foxStrike")) {
          if (!actor || !firstSkillByEffect(actor, "foxStrike")) return false;
          const single = foxSingleCost(actor);
          if (a.strikeMode === "single") {
            if (a.costOverride !== single) return false;
            if (!actor.strikeSingleColor && a.paymentPlan) {
              const allowed = foxPlanColors(a.paymentPlan);
              if (!allowed.includes(a.strikeBaseColor)) {
                if (allowed.length === 1) a.strikeBaseColor = allowed[0];else return false;
              }
            }
          } else if (a.strikeMode === "double") {
            if (a.costOverride !== "**") return false;
          } else return false;
        }
        if (a?.type === "gather" && actor && (cardHasCapability(actor, "jungleMud") || cardHasCapability(actor, "alternatingCharge"))) return executeCustomGather(g, t, s, actor, a);
        if (a?.type === "skill" && actor) {
          if (skillHasTag(actor, a.skill, "summon") && summonLimitReached(g, t, actor)) return false;
          if (actionSkillHasEffect(a, "circuitVoltageBurst") && countCompleteW(actor) < 1) return false;
          if (actionSkillHasEffect(a, "abyssVortex") && (!Array.isArray(a.vortexTargets) || a.vortexTargets.length !== 2 || a.vortexTargets[0] === a.vortexTargets[1])) return false;
        }
        if (a?.type === "switch" && eternaLocksTeam(g, t)) {
          const et = activeEterna(g, other(t));
          log(g, `${actor?.name || "캐릭터"}: ${et?.name || "이터너"}의 특성으로 교체할 수 없습니다.`);
          return false;
        }
        if (a?.type === "skill" && actor) {
          if (actionSkillHasEffect(a, "abyssCannon")) {
            const n = Number(a.baseCostCount);
            if (!Number.isInteger(n) || n < 0 || n > 4) return false;
            a.costOverride = "*".repeat(n);
          }
          if (actionSkillHasEffect(a, "abyssVortex") && !Array.isArray(a.vortexSwaps)) a.vortexSwaps = [];
        }
        const result = executeCoreBase(g, t, s, a, opt);
        if (dmActive) dmDebug("action-result", {
          actionId: dmActionId,
          result,
          effects: state_ui_battle_state.visualEvents.filter(v => v.actionId === dmActionId)
        });
        return result;
      } finally {
        if (copiedBase && copiedSaved) {
          copiedBase.target = copiedSaved.target;
          copiedBase.effects = copiedSaved.effects;
          copiedBase.tags = copiedSaved.tags;
          if (copiedSaved.nonAttack === undefined) delete copiedBase.nonAttack;else copiedBase.nonAttack = copiedSaved.nonAttack;
          syncAromaCombatFlags(g);
        }
      }
    } finally {
      if (dmActive) {
        state_features_dragon_memory.dmExecutingActionIds.delete(dmActionId);
        state_features_dragon_memory.dmCurrentActionContext = dmPreviousContext;
        if (state_features_dragon_memory.dmPendingFlow?.actionId === dmActionId) state_features_dragon_memory.dmPendingFlow = null;
      } else syncAromaCombatFlags(g);
    }
  } finally {
    if (reactiveEnergyRule(actor)) delete actor._genociderSlashSnapshot;
    reconcileAllReactiveEnergyUnits(g, true, "행동 처리");
    state_features_genocider.reactiveEnergyCurrentGame = previousReactive;
  }
}
