// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_runtime_transactions = {
  ACTION_FAULT_PHASES: undefined,
  ActionFaultInjector: undefined,
  PresentationFailureChannel: undefined,
  TransactionAuditChannel: undefined,
  ActionTransactionManager: undefined,
  diffUnits: undefined,
  DeathEngine: undefined,
  TurnEngine: undefined
};
import { unitAt } from "../engine/actions.js";
import { checkDeath, emitDamageAppliedEvent, teamOf } from "../engine/combat.js";
import { aliveUnits } from "../engine/energy.js";
import { state_engine_entities } from "../engine/entities.js";
import { checkWinner, endTurn } from "../engine/execution.js";
import { state_runtime_config } from "./config.js";
import { state_runtime_entities } from "./entities.js";
import { state_runtime_input } from "./input.js";
import { state_runtime_snapshots } from "./snapshots.js";
import { state_runtime_state } from "./state.js";
import { systems } from "./systems.js";
export function initializeRuntimeTransactions() {
  state_runtime_transactions.ACTION_FAULT_PHASES = Object.freeze(["validation-after", "draft-after", "payment-before", "payment-after", "energy-proposal-before", "energy-proposal-after", "rng-before", "rng-after", "damage-before", "first-hit-after", "next-hit-before", "damage-after", "healing-before", "healing-after", "status-before", "status-after", "schedule-before", "schedule-after", "death-before", "death-after", "replacement-pending-after", "victory-before", "victory-after", "terminal-pending-after", "terminal-commit-before", "event-publication-before", "remote-ack-before", "render-before", "vfx-before", "audio-before"]);
  state_runtime_transactions.ActionFaultInjector = (() => {
    let armed = null,
      hits = [];
    return Object.freeze({
      phases: () => [...state_runtime_transactions.ACTION_FAULT_PHASES],
      arm: phase => {
        if (!state_runtime_transactions.ACTION_FAULT_PHASES.includes(phase)) throw new Error(`unknown fault phase ${phase}`);
        armed = phase;
        hits = [];
      },
      clear: () => {
        armed = null;
        hits = [];
      },
      hit(phase) {
        hits.push(phase);
        if (armed === phase) {
          armed = null;
          const error = new Error(`CP32_FAULT:${phase}`);
          error.code = "CP32_FAULT_INJECTED";
          error.phase = phase;
          throw error;
        }
      },
      debug: () => ({
        armed,
        hits: [...hits]
      })
    });
  })();
  Object.defineProperty(systems, "ActionFaultInjector", {
    value: state_runtime_transactions.ActionFaultInjector,
    writable: false,
    configurable: false
  });
  state_runtime_transactions.PresentationFailureChannel = (() => {
    const events = [];
    const emit = record => {
      const frozen = Object.freeze({
        presentationSequence: events.length + 1,
        timestamp: Date.now(),
        ...record
      });
      events.push(frozen);
      if (events.length > 512) events.splice(0, events.length - 512);
      return frozen;
    };
    const snapshot = () => events.map(x => ({
      ...x
    }));
    const clear = () => {
      events.length = 0;
    };
    return Object.freeze({
      emit,
      snapshot,
      clear
    });
  })();
  Object.defineProperty(systems, "PresentationFailureChannel", {
    value: state_runtime_transactions.PresentationFailureChannel,
    writable: false,
    configurable: false
  });
  state_runtime_transactions.TransactionAuditChannel = (() => {
    const events = [];
    const emit = record => {
      const frozen = Object.freeze({
        auditSequence: events.length + 1,
        timestamp: Date.now(),
        ...record
      });
      events.push(frozen);
      if (events.length > 2048) events.splice(0, events.length - 2048);
      return frozen;
    };
    const snapshot = () => events.map(x => ({
      ...x
    }));
    const forAction = actionId => events.filter(x => x.actionId === actionId).map(x => ({
      ...x
    }));
    const clear = () => {
      events.length = 0;
    };
    return Object.freeze({
      emit,
      snapshot,
      forAction,
      clear
    });
  })();
  Object.defineProperty(systems, "TransactionAuditChannel", {
    value: state_runtime_transactions.TransactionAuditChannel,
    writable: false,
    configurable: false
  });
  state_runtime_transactions.ActionTransactionManager = (() => {
    const committed = new Map(),
      failed = new Map();
    const begin = (g, t, s, action) => {
      state_runtime_state.StateFactory.decorate(g);
      const actionId = action?.actionId || state_runtime_config.IdFactory.transaction(g.battleId);
      const seen = committed.get(g.battleId) || new Set();
      committed.set(g.battleId, seen);
      const rejected = failed.get(g.battleId) || new Set();
      failed.set(g.battleId, rejected);
      if (seen.has(actionId) || rejected.has(actionId)) return {
        duplicate: true,
        actionId,
        terminalStatus: seen.has(actionId) ? "committed" : "failed"
      };
      const transaction = {
        transactionId: state_runtime_config.IdFactory.transaction(g.battleId),
        actionId,
        teamId: t,
        slot: s,
        sourceEntityId: action?.sourceInstanceId || g.activeEntityId || null,
        action,
        startedAt: state_runtime_config.now(),
        turnSerialAtStart: Number(g.turnSerial || 0),
        revisionAtStart: Number(g.networkRevision || 0),
        phaseAtStart: g.phase || null,
        eventSequenceAtStart: Number(g.eventSequence || 0),
        snapshot: state_runtime_snapshots.snapshotState(g)
      };
      g.pendingTransaction = transaction;
      g.pendingAction = action;
      g.phase = "EXECUTING_ACTION";
      state_runtime_transactions.TransactionAuditChannel.emit({
        type: "ACTION_TRANSACTION_BEGAN",
        battleId: g.battleId,
        teamId: t,
        transactionId: transaction.transactionId,
        actionId,
        actionType: action?.type || null,
        action: action ? JSON.parse(JSON.stringify(action)) : null,
        turnSerialBefore: transaction.turnSerialAtStart,
        revisionBefore: transaction.revisionAtStart,
        phaseBefore: transaction.phaseAtStart
      });
      state_runtime_entities.BattleEventEngine.emit(g, "ACTION_TRANSACTION_STARTED", {
        teamId: t,
        sourceEntityId: transaction.sourceEntityId,
        payload: {
          transactionId: transaction.transactionId,
          actionId,
          actionType: action?.type
        }
      });
      return transaction;
    };
    const commit = (g, tx) => {
      const seen = committed.get(g.battleId) || new Set();
      seen.add(tx.actionId);
      committed.set(g.battleId, seen);
      g.pendingTransaction = null;
      g.pendingAction = null;
      g.pendingTargetSelection = null;
      g.pendingPayment = null;
      g.phase = g.winner ? "BATTLE_ENDED" : "WAITING_FOR_ACTION";
      state_runtime_entities.BattleEventEngine.emit(g, "ACTION_TRANSACTION_COMMITTED", {
        teamId: tx.teamId,
        payload: {
          transactionId: tx.transactionId,
          actionId: tx.actionId,
          durationMs: state_runtime_config.now() - tx.startedAt
        }
      });
      if (g.winner) {
        state_runtime_state.StateFactory.updateActive(g);
        const terminalEventPublished = Array.isArray(g.eventLog) && g.eventLog.some(event => event?.type === "BATTLE_ENDED");
        if (!terminalEventPublished) state_runtime_entities.BattleEventEngine.emit(g, "BATTLE_ENDED", {
          teamId: g.winner,
          payload: {
            winner: g.winner,
            actionId: tx.actionId
          }
        });
      }
      state_runtime_transactions.TransactionAuditChannel.emit({
        type: "ACTION_TRANSACTION_COMMITTED",
        battleId: g.battleId,
        teamId: tx.teamId,
        transactionId: tx.transactionId,
        actionId: tx.actionId,
        actionType: tx.action?.type || null,
        durationMs: state_runtime_config.now() - tx.startedAt,
        turnSerialBefore: tx.turnSerialAtStart,
        turnSerialAfter: Number(g.turnSerial || 0),
        revisionBefore: tx.revisionAtStart,
        phaseAfter: g.phase || null
      });
    };
    const rollback = (g, tx, reason, error = null) => {
      state_runtime_snapshots.restoreState(g, tx.snapshot);
      state_runtime_input.InputLockManager.unlock("payment");
      state_runtime_input.InputLockManager.unlock("target-selection");
      state_runtime_input.InputLockManager.unlock("action-transaction");
      /* 예약 행동의 실행 ID는 예약ID+턴 번호로 정해지는 결정적 값이라, 롤백된 시도를 영구 거부하면 같은 차례를 다시 실행할 수 없다.
         이중 적용은 committed 집합과 g.consumedScheduledActionIds가 이미 막으므로 실패 목록에는 클라이언트가 만든 ID만 넣는다. */
      if (!tx.action?.scheduledActionId) {
        const rejected = failed.get(g.battleId) || new Set();
        rejected.add(tx.actionId);
        failed.set(g.battleId, rejected);
      }
      const rollbackEvent = state_runtime_transactions.TransactionAuditChannel.emit({
        type: "ACTION_TRANSACTION_ROLLED_BACK",
        battleId: g.battleId,
        teamId: tx.teamId,
        transactionId: tx.transactionId,
        actionId: tx.actionId,
        reason,
        error: error ? String(error) : null
      });
      state_runtime_transactions.TransactionAuditChannel.emit({
        type: reason === "action-rejected" ? "ACTION_COMMAND_REJECTED" : "ACTION_COMMAND_FAILED",
        battleId: g.battleId,
        teamId: tx.teamId,
        transactionId: tx.transactionId,
        actionId: tx.actionId,
        reason,
        error: error ? String(error) : null
      });
      return rollbackEvent;
    };
    const clearBattle = id => {
      committed.delete(id);
      failed.delete(id);
      const g = state_runtime_config.currentGame();
      if (g?.battleId === id) {
        g.pendingTransaction = null;
        g.pendingAction = null;
        g.pendingTargetSelection = null;
        g.pendingPayment = null;
        g.pendingAnimation = null;
        if (!g.winner) g.phase = "WAITING_FOR_ACTION";
      }
      return true;
    };
    return Object.freeze({
      begin,
      commit,
      rollback,
      clearBattle
    });
  })();
  state_runtime_transactions.diffUnits = (before, g, causedByEventId = null, eventSequenceAtStart = 0) => {
    state_runtime_entities.EntityRegistry.sync(g);
    const previous = new Map();
    try {
      const raw = JSON.parse(before.raw);
      for (const team of ["P", "A"]) for (const zone of ["field", "bench", "graveyard", "summons"]) for (const unit of raw.teams?.[team]?.[zone] || []) if (unit) previous.set(unit.entityId || unit.uid, unit);
    } catch (error) {
      console.error("[R48] diff snapshot parse failed", error);
    }
    for (const unit of Object.values(g.entities || {})) {
      const id = unit.entityId || unit.uid,
        old = previous.get(id);
      if (!old) continue;
      const common = {
        recipientEntityId: id,
        teamId: typeof teamOf === "function" ? teamOf(g, unit) : null,
        causedByEventId
      };
      const hasDetailedDamage = (g.eventLog || []).some(ev => Number(ev.sequence || 0) > Number(eventSequenceAtStart || 0) && ev.type === "DAMAGE_APPLIED" && ev.recipientEntityId === id && ev.payload?.detailed === true);
      const hasDetailedHeal = (g.eventLog || []).some(ev => Number(ev.sequence || 0) > Number(eventSequenceAtStart || 0) && ["HEAL_APPLIED", "HEALING_APPLIED"].includes(ev.type) && ev.recipientEntityId === id && ev.payload?.detailed === true);
      if (Number(unit.hp) !== Number(old.hp) && !(unit.hp < old.hp && hasDetailedDamage || unit.hp > old.hp && hasDetailedHeal)) {
        if (unit.hp < old.hp) emitDamageAppliedEvent(g, null, unit, {
          damageType: "stateDiff",
          before: {
            hp: old.hp,
            shield: old.shield
          },
          after: {
            hp: unit.hp,
            shield: unit.shield
          },
          amount: Math.abs(unit.hp - old.hp),
          actionId: g?.pendingTransaction?.actionId || null
        });else if (g?.pendingTransaction && g.phase === "EXECUTING_ACTION") state_engine_entities.GenericBattleStatisticsOwner.recordHealing(g, {
          source: null,
          target: unit,
          requestedAmount: Math.abs(unit.hp - old.hp),
          actualAppliedAmount: Math.abs(unit.hp - old.hp),
          reason: "action-state-diff",
          effectId: "actionStateDiff",
          actionId: g.pendingTransaction.actionId || null,
          transactionId: g.pendingTransaction.transactionId || null
        });
      }
      if (Number(unit.shield) !== Number(old.shield)) state_runtime_entities.BattleEventEngine.emit(g, "SHIELD_CHANGED", {
        ...common,
        payload: {
          before: old.shield,
          after: unit.shield
        }
      });
      const oldStatus = state_runtime_config.stableText(old.statuses || {}),
        newStatus = state_runtime_config.stableText(unit.statuses || {});
      if (oldStatus !== newStatus) state_runtime_entities.BattleEventEngine.emit(g, "STATUS_CHANGED", {
        ...common,
        payload: {
          before: old.statuses || {},
          after: unit.statuses || {}
        }
      });
      const oldEnergy = (old.energy || []).map(e => ({
          energyId: e.energyId,
          c: e.c,
          a: e.a
        })),
        newEnergy = state_runtime_entities.EnergyEngine.snapshot(unit);
      if (state_runtime_config.stableText(oldEnergy) !== state_runtime_config.stableText(newEnergy)) state_runtime_entities.BattleEventEngine.emit(g, "ENERGY_CHANGED", {
        ...common,
        payload: {
          before: oldEnergy,
          after: newEnergy
        }
      });
      if (!old.dead && unit.dead) state_runtime_entities.BattleEventEngine.emit(g, "ENTITY_DIED", {
        ...common,
        payload: {
          cardId: unit.card
        }
      });
    }
  };
  state_runtime_transactions.DeathEngine = Object.freeze({
    reconcile(g) {
      state_runtime_state.StateFactory.decorate(g);
      const deaths = [];
      for (const unit of Object.values(g.entities || {})) if (Number(unit.hp) <= 0 && !unit.dead && typeof checkDeath === "function") {
        checkDeath(g, unit, null);
        deaths.push(unit.entityId || unit.uid);
      }
      state_runtime_entities.EntityRegistry.sync(g);
      return deaths;
    },
    alive: (g, team) => typeof aliveUnits === "function" ? aliveUnits(g.teams[team]) : []
  });
  state_runtime_transactions.TurnEngine = (() => {
    const hasLiveReplacement = (g, team) => !!g?.teams?.[team]?.bench?.some(unit => unit && !unit.dead);
    const currentOrderEntryCanResolve = g => {
      const [team, slot] = g?.order?.[g?.turn] || [];
      if (team == null || slot == null) return false;
      const unit = typeof unitAt === "function" ? unitAt(g, team, slot) : null;
      return !!(unit && !unit.dead) || hasLiveReplacement(g, team);
    };
    const normalizeDeadEmptyOrderEntries = g => {
      const skipped = [];
      const orderLength = Math.max(0, Number(g?.order?.length || 0));
      if (!orderLength || g?.winner || g?.ended) return skipped;
      for (let inspected = 0; inspected < orderLength && !currentOrderEntryCanResolve(g); inspected++) {
        const [team, slot] = g.order[g.turn] || [];
        const unit = team != null && slot != null && typeof unitAt === "function" ? unitAt(g, team, slot) : null;
        skipped.push(Object.freeze({
          teamId: team ?? null,
          slot: slot ?? null,
          entityId: unit?.entityId || unit?.uid || null,
          turnSerial: Number(g.turnSerial || 0)
        }));
        state_runtime_entities.BattleEventEngine.emit(g, "EMPTY_SLOT_TURN_SKIPPED", {
          teamId: team ?? null,
          sourceEntityId: unit?.entityId || unit?.uid || null,
          payload: {
            slot: slot ?? null,
            turnSerial: Number(g.turnSerial || 0),
            reason: "DEAD_OR_EMPTY_WITHOUT_LIVE_REPLACEMENT"
          }
        });
        g.turn = (Number(g.turn || 0) + 1) % orderLength;
        g.turnSerial = Number(g.turnSerial || 0) + 1;
        g.preparedKey = null;
        g.dualActorController = null;
        if (g.turn === 0) g.round = Math.max(1, Number(g.round || 1)) + 1;
        if (typeof checkWinner === "function") checkWinner(g);
        if (g.winner || g.ended) break;
      }
      return skipped;
    };
    return Object.freeze({
      end: (...args) => endTurn(...args),
      current: g => g?.order?.[g.turn] || null,
      phase: g => g?.phase || "IDLE",
      normalizeDeadEmptyOrderEntries,
      currentOrderEntryCanResolve
    });
  })();
}
