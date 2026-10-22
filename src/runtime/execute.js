// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_runtime_execute = {
  CanonicalActionTransactionOwner: undefined
};
import { unitAt } from "../engine/actions.js";
import { runCanonicalBattleAction } from "../engine/execution.js";
import { ensureScheduledActionIdentity, scheduledExecutionId } from "../engine/effects.js";
import { state_runtime_config } from "./config.js";
import { state_runtime_entities } from "./entities.js";
import { state_runtime_input } from "./input.js";
import { state_runtime_state } from "./state.js";
import { state_runtime_transactions } from "./transactions.js";
export
// This executor receives only actions already admitted as authoritative.
function executeCanonicalActionTransaction(g, t, s, action, opt = {}, perform = runCanonicalBattleAction) {
  const live = !opt?.sim && g && (g === state_runtime_config.currentGame() || opt?.r48Live === true);
  if (!live) return perform(g, t, s, action, opt);
  state_runtime_state.StateFactory.decorate(g);
  if (g.ended || g.winner) return false;
  if (action && typeof action === "object") action = {
    ...action,
    actionId: action.actionId || state_runtime_config.IdFactory.transaction(g.battleId)
  };
  if (action && (action.type === "scheduled" || action.type === "sequence")) {
    const scheduled = ensureScheduledActionIdentity(g, unitAt(g, t, s));
    if (scheduled) {
      action.scheduledActionId ||= scheduled.scheduledActionId;
      action.sourceInstanceId ||= scheduled.sourceInstanceId;
      action.actionId ||= scheduledExecutionId(g, scheduled);
    }
  }
  const tx = state_runtime_transactions.ActionTransactionManager.begin(g, t, s, action);
  if (tx.duplicate) return false;
  const lock = state_runtime_input.InputLockManager.lock("action-transaction", tx.transactionId);
  try {
    state_runtime_transactions.ActionFaultInjector.hit("validation-after");
    state_runtime_transactions.ActionFaultInjector.hit("draft-after");
    if (action?.type === "skill") {
      state_runtime_transactions.ActionFaultInjector.hit("payment-before");
      state_runtime_entities.BattleEventEngine.emit(g, "SKILL_SELECTED", {
        teamId: t,
        sourceEntityId: g.activeEntityId,
        payload: {
          skillId: action.skill,
          copySkillId: action.copySkill || null
        }
      });
      if (action.target) state_runtime_entities.BattleEventEngine.emit(g, "TARGET_SELECTED", {
        teamId: action.target.team,
        targetSlotId: state_runtime_config.IdFactory.slot(action.target.team, "field", action.target.slot),
        recipientEntityId: action.target.uid || null,
        payload: {
          target: action.target
        }
      });
      state_runtime_entities.BattleEventEngine.emit(g, "PAYMENT_STARTED", {
        teamId: t,
        sourceEntityId: g.activeEntityId,
        payload: {
          skillId: action.skill,
          paymentPlan: action.paymentPlan || null
        }
      });
    }
    const result = perform(g, t, s, action, opt);
    if (!result) {
      state_runtime_transactions.ActionTransactionManager.rollback(g, tx, "action-rejected");
      return false;
    }
    const deaths = state_runtime_transactions.DeathEngine.reconcile(g);
    state_runtime_state.StateFactory.updateActive(g);
    state_runtime_transactions.ActionFaultInjector.hit("event-publication-before");
    const commitEvent = state_runtime_entities.BattleEventEngine.emit(g, "ACTION_EXECUTED", {
      teamId: t,
      sourceEntityId: tx.sourceEntityId,
      payload: {
        actionId: tx.actionId,
        actionType: action?.type,
        deaths
      }
    });
    state_runtime_transactions.diffUnits(tx.snapshot, g, commitEvent?.eventId || null, tx.eventSequenceAtStart);
    state_runtime_transactions.ActionFaultInjector.hit("remote-ack-before");
    state_runtime_transactions.ActionTransactionManager.commit(g, tx);
    state_runtime_state.StateValidator.validate(g);
    return true;
  } catch (error) {
    const isGradeValidation = error?.code === "INVALID_CARD_GRADE";
    if (!isGradeValidation) console.error("[R48 ActionEngine] execution failed", {
      battleId: g?.battleId,
      team: t,
      slot: s,
      action,
      error
    });
    const sourceEntityId = tx.snapshot?.activeEntityId || g.activeEntityId || null;
    state_runtime_transactions.ActionTransactionManager.rollback(g, tx, "exception", error);
    if (isGradeValidation) {
      state_runtime_entities.BattleEventEngine.emit(g, "GRADE_VALIDATION_FAILED", {
        teamId: t,
        sourceEntityId,
        recipientEntityId: action?.target?.uid || null,
        payload: {
          ...(error.gradeValidationDetail || {}),
          message: String(error.message || error)
        }
      });
    }
    throw error;
  } finally {
    state_runtime_input.InputLockManager.unlock(lock);
  }
}
export function initializeRuntimeExecute() {
  state_runtime_execute.CanonicalActionTransactionOwner = Object.freeze({
    execute: executeCanonicalActionTransaction
  });
}
