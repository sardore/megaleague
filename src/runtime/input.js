// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_runtime_input = {
  InputLockManager: undefined
};
import { state_features_timeora } from "../features/timeora.js";
import { state_online_commands } from "../online/commands.js";
import { state_runtime_config } from "./config.js";
import { systems } from "./systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_deck } from "../ui/deck.js";
import { state_ui_setup } from "../ui/setup.js";
export function initializeRuntimeInput() {
  state_runtime_input.InputLockManager = (() => {
    const locks = new Map();
    let clockToken = null;
    const roots = () => [document.querySelector(".app"), document.getElementById("modal")].filter(Boolean);
    const applyDomLock = on => {
      document.body.classList.toggle("time-input-locked", !!on);
      for (const root of roots()) {
        try {
          root.inert = !!on;
        } catch (error) {
          systems.__megaRecordRecoveredError(error, "InputLockManager.applyDomLock");
        }
        root.setAttribute("aria-hidden", on ? "true" : "false");
      }
    };
    const updateDataset = () => {
      if (locks.size) document.documentElement.dataset.inputLocked = "true";else delete document.documentElement.dataset.inputLocked;
    };
    const lock = (reason, owner = "runtime", options = {}) => {
      const normalized = String(reason || "unknown");
      const token = state_runtime_config.IdFactory.lock(normalized);
      const runtime = systems.OnlineRuntime?.debug?.() || {};
      const createdAt = state_runtime_config.now();
      locks.set(token, {
        token,
        reason: normalized,
        owner,
        createdAt,
        battleId: options.battleId ?? state_runtime_config.currentGame()?.battleId ?? null,
        sessionGeneration: Number(options.sessionGeneration ?? runtime.generation ?? 0),
        revision: Number(options.revision ?? state_runtime_config.currentGame()?.networkRevision ?? 0),
        timeoutAt: Number(options.timeoutMs) > 0 ? createdAt + Number(options.timeoutMs) : null,
        cleanupPath: String(options.cleanupPath || "owner-finally-or-battle-cleanup")
      });
      updateDataset();
      state_runtime_config.EventBus.emit({
        type: "INPUT_LOCKED",
        token,
        reason: normalized,
        owner,
        createdAt: state_runtime_config.now()
      });
      return token;
    };
    const unlock = tokenOrReason => {
      let count = 0;
      if (locks.has(tokenOrReason)) {
        if (tokenOrReason === clockToken) clockToken = null;
        locks.delete(tokenOrReason);
        count = 1;
      } else {
        for (const [token, entry] of [...locks]) if (entry.reason === tokenOrReason) {
          if (token === clockToken) clockToken = null;
          locks.delete(token);
          count++;
        }
      }
      updateDataset();
      if (count) state_runtime_config.EventBus.emit({
        type: "INPUT_UNLOCKED",
        tokenOrReason,
        count,
        createdAt: state_runtime_config.now()
      });
      return count;
    };
    const releaseClockOwner = () => {
      if (clockToken && locks.has(clockToken)) locks.delete(clockToken);
      clockToken = null;
      for (const [token, entry] of [...locks]) if (entry.reason === "clock-animation" && entry.owner === "timeSetInputLock") locks.delete(token);
      updateDataset();
    };
    const setClockLock = (on, options = {}) => {
      const holdBusy = options.holdBusy !== false;
      if (on) {
        if (!clockToken || !locks.has(clockToken)) clockToken = lock("clock-animation", options.owner || "timeSetInputLock");
        state_features_timeora.timeInputLocked = true;
        applyDomLock(true);
        if (holdBusy && typeof state_ui_battle_state.busy !== "undefined") {
          if (!state_ui_battle_state.busy) state_features_timeora.timeInputLockBusyOwned = true;
          state_ui_battle_state.busy = true;
        }
      } else {
        state_features_timeora.timeInputLocked = false;
        applyDomLock(false);
        releaseClockOwner();
        if (state_features_timeora.timeInputLockBusyOwned) {
          state_features_timeora.timeInputLockBusyOwned = false;
          if (!state_online_commands.OnlineActionAdmissionOwner.hasPending()) state_ui_battle_state.busy = false;
        }
      }
      return state_features_timeora.timeInputLocked;
    };
    const clockVisualPresent = () => !!document.querySelector(".time-clock-action-overlay,.time-hyper-clock,.time-recall-fx,.time-clock-cinematic,.time-skill-fx");
    const reconcileLegacyClock = (reason = "reconcile") => {
      const declared = !!state_features_timeora.timeInputLocked || document.body.classList.contains("time-input-locked");
      const legitimate = !!state_runtime_config.currentGame()?.pendingClockTurnAdvance || clockVisualPresent();
      if (declared && !legitimate) {
        setClockLock(false, {
          holdBusy: false,
          owner: `reconcile:${reason}`
        });
        return {
          changed: true,
          reason,
          state: "released-stale-clock"
        };
      }
      if (declared && legitimate && (!clockToken || !locks.has(clockToken))) {
        setClockLock(true, {
          holdBusy: false,
          owner: "timeSetInputLock"
        });
        return {
          changed: true,
          reason,
          state: "adopted-clock"
        };
      }
      if (!declared && clockToken) {
        releaseClockOwner();
        return {
          changed: true,
          reason,
          state: "released-orphan-token"
        };
      }
      applyDomLock(declared);
      return {
        changed: false,
        reason,
        state: declared ? "locked" : "unlocked"
      };
    };
    const releaseBattle = battleId => {
      for (const [token, entry] of [...locks]) if (entry.battleId === battleId) {
        if (token === clockToken) clockToken = null;
        locks.delete(token);
      }
      updateDataset();
      if (!clockToken && state_features_timeora.timeInputLocked && state_runtime_config.currentGame()?.battleId === battleId) {
        state_features_timeora.timeInputLocked = false;
        applyDomLock(false);
        state_features_timeora.timeInputLockBusyOwned = false;
      }
    };
    const reasons = () => [...new Set([...locks.values()].map(x => x.reason))];
    const snapshot = () => [...locks.values()].map(x => ({
      ...x
    }));
    const clockState = () => ({
      token: clockToken,
      locked: !!state_features_timeora.timeInputLocked || document.body.classList.contains("time-input-locked"),
      visual: clockVisualPresent(),
      pending: !!state_runtime_config.currentGame()?.pendingClockTurnAdvance
    });
    state_ui_setup.LocalInputEligibility.bindProviders({
      locks: snapshot,
      clock: clockState,
      online: g => {
        const runtime = systems.OnlineRuntime?.debug?.() || {};
        return {
          role: state_ui_deck.p2p?.role || null,
          connected: !!state_ui_deck.p2p?.connected && !!state_ui_deck.p2p?.conn?.open,
          battleStarted: (!!state_ui_deck.p2p?.battleStarted || !!g?.battleStarted) && !(state_ui_deck.p2p?.role === "host" && (state_ui_deck.p2p?.onlineStartPending || state_ui_deck.p2p?.startCommitPacket) && !state_ui_deck.p2p?.startCommitAck) && !(state_ui_deck.p2p?.role === "guest" && state_ui_deck.p2p?.guestStartAwaitingHostCommit),
          reconnecting: !!state_ui_deck.p2p?.reconnecting || !!state_ui_deck.p2p?.connectionInterrupted || runtime.state === "RECONNECTING" || !!runtime.generation && runtime.committed && !runtime.routesReady,
          pendingActionId: state_online_commands.OnlineActionAdmissionOwner.pendingActionId(),
          authoritativeRevision: Number(state_ui_deck.p2p?.lastAuthoritativeRevision || (typeof state_online_commands.onlineAuthoritativeRevision !== "undefined" ? state_online_commands.onlineAuthoritativeRevision : 0) || 0),
          busy: !!state_ui_battle_state.busy,
          runtime
        };
      },
      bossControls: g => !g?.bossRaid || !!systems.__redTimeoraBossRaid?.localControlsCurrent(g)
    });
    const canHumanInput = g => state_ui_setup.LocalInputEligibility.canAct(g);
    return Object.freeze({
      lock,
      unlock,
      releaseBattle,
      setClockLock,
      reconcileLegacyClock,
      hasLocks: () => locks.size > 0,
      count: () => locks.size,
      reasons,
      snapshot,
      canHumanInput,
      evaluate: g => state_ui_setup.LocalInputEligibility.evaluate(g),
      clockState
    });
  })();
}
