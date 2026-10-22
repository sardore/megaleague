import { sessionRuntime } from "./session-model.js";
import { state_ui_deck } from "../ui/deck.js";
import { state_online_lobby } from "./lobby.js";
import { sendAuthoritativeOnlineState } from "./snapshots.js";
import { state_runtime_config } from "../runtime/config.js";
import { requestOnlineStartReplay } from "./start.js";
import { state_online_commands } from "./commands.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { activateOnlineApplicationRoutes } from "./matching.js";
import { scheduleAI } from "../ui/action-choices.js";
export function initializeOnlineRestore() {
  sessionRuntime.RestoreTransaction = (() => {
    const trace = [];
    const begin = (session, binding, reason) => {
      session.routesReady = false;
      const existing = session.scope.transactions.get("restore");
      if (existing) {
        Object.assign(existing, {
          bindingId: binding?.id || existing.bindingId || null,
          reason: String(reason),
          restoreRequestId: binding?.restoreRequestId || existing.restoreRequestId || null
        });
        return existing;
      }
      const row = session.scope.transaction("restore", {
        bindingId: binding?.id || null,
        reason: String(reason),
        phase: session.resumeState || "LOBBY",
        restoreRequestId: binding?.restoreRequestId || null,
        transportReady: false,
        authoritativeApplied: state_ui_deck.p2p?.role === "host",
        authoritativeRevision: 0
      });
      trace.push({
        at: Date.now(),
        stage: "begin",
        ...row
      });
      return row;
    };
    const requestAuthoritativePhaseState = (session, phase, reason) => {
      if (phase === "LOBBY") {
        return state_online_lobby.LobbyEngine.onTransportReady(reason);
      }
      if (phase === "IN_BATTLE") {
        if (state_ui_deck.p2p?.role === "host") {
          try {
            return !!sendAuthoritativeOnlineState([], null, true);
          } catch {
            return false;
          }
        }
        const requested = sessionRuntime.SnapshotSyncCoordinator.request(reason);
        if (!state_runtime_config.currentGame()) requestOnlineStartReplay(reason);
        return requested;
      }
      return false;
    };
    const finish = (session, binding, detail = {}) => {
      if (!session || sessionRuntime.activeSession !== session || session.scope?.closed) return false;
      const tx = session.scope.transactions.get("restore");
      if (!tx) return session.routesReady;
      const phase = detail.phase || session.resumeState || tx.phase || "LOBBY";
      tx.phase = phase;
      tx.transportReady = detail.transportReady !== false;
      if (state_ui_deck.p2p?.role === "guest" && !tx.authoritativeApplied) {
        session.routesReady = false;
        session.scope?.record?.("restore-awaiting-fresh-authoritative-state", {
          bindingId: binding?.id || null,
          phase,
          restoreRequestId: tx.restoreRequestId || null
        });
        requestAuthoritativePhaseState(session, phase, "restore-awaiting-fresh-authoritative-state");
        return false;
      }
      session.scope.transitionPhase(phase, "restore-authoritative-complete");
      session.routesReady = false;
      if (session.machine.state === "RECONNECTING") session.machine.transition(phase, "restore-authoritative-complete", {
        project: false
      });
      const restoredGame = state_runtime_config.currentGame();
      const releaseBusy = !!(restoredGame && !restoredGame.pendingAnimation && !restoredGame.pendingClockTurnAdvance && !state_online_commands.OnlineActionAdmissionOwner.hasPending() && !state_ui_battle_state.pendingSkill);
      if (releaseBusy) state_ui_battle_state.busy = false;
      // Projection is synchronous. Open the final eligibility flags in the same task so the
      // action panel is rendered from the committed state, never from the transient reconnect lock.
      session.routesReady = true;
      if (state_ui_deck.p2p) {
        state_ui_deck.p2p.reconnecting = false;
        state_ui_deck.p2p.connectionInterrupted = false;
      }
      const projected = sessionRuntime.ProjectionTransaction.request("restore-authoritative-apply", {
        phase,
        canonicalRevision: Number(detail.canonicalRevision || tx.authoritativeRevision || 0),
        surfaceIntent: detail.inputPreserved === true || tx.inputPreserved === true ? "PRESERVE_LOCAL_INPUT" : null
      });
      session.routesReady = !!projected?.committed;
      if (!session.routesReady) {
        session.lifecycleRestorePending = true;
        if (state_ui_deck.p2p) {
          state_ui_deck.p2p.reconnecting = true;
          state_ui_deck.p2p.connectionInterrupted = true;
        }
        session.scope?.record?.("restore-projection-failed", {
          phase,
          dropReason: projected?.dropReason || null
        });
        session.scope.completeTransaction("restore", {
          state: "FAILED",
          phase,
          dropReason: projected?.dropReason || "RESTORE_PROJECTION_FAILED"
        });
        if (binding) session.transport?.isolate?.(binding, "restore-projection-failed");else session.transport?.reconnectNow?.("restore-projection-failed");
        return false;
      }
      activateOnlineApplicationRoutes(session, phase, "restore-authoritative-complete");
      session.lifecycleRestorePending = false;
      session.lifecycleRestoredEpoch = Number(session.lifecycleEpoch || 0);
      session.lifecycleRestoreRequestEpoch = 0;
      session.scope.completeTransaction("restore", {
        phase,
        projected: !!projected?.committed,
        authoritativeApplied: true,
        transportReady: true
      });
      trace.push({
        at: Date.now(),
        stage: "complete",
        generation: session.generation,
        bindingId: binding?.id || null,
        phase,
        routesReady: session.routesReady,
        canonicalRevision: Number(detail.canonicalRevision || tx.authoritativeRevision || 0)
      });
      if (session.routesReady && phase === "LOBBY" && state_ui_deck.p2p?.role === "host") state_online_lobby.LobbyEngine.onTransportReady("restore-host-complete");
      if (session.routesReady && phase === "IN_BATTLE") requestAuthoritativePhaseState(session, phase, "restore-peer-complete");
      if (session.routesReady && phase === "IN_BATTLE" && state_ui_deck.p2p?.role === "host" && !state_ui_battle_state.pendingSkill) session.scope?.setTimeout?.(() => scheduleAI(), 0, "restore-reschedule-host-turn", {
        phase: "IN_BATTLE"
      });
      return projected;
    };
    const transportReady = (session, binding, detail = {}) => {
      // A host can already have a provisional game object while the start snapshot is still awaiting guest ACK.
      // Do not promote that half-committed start to IN_BATTLE during reconnect; p2p.battleStarted is the commit gate.
      const phase = session.resumeState === "IN_BATTLE" || !!state_ui_deck.p2p?.battleStarted ? "IN_BATTLE" : "LOBBY";
      session.resumeState = phase;
      const tx = session.scope.transactions.get("restore") || begin(session, binding, "transport-ready-without-open-transaction");
      tx.transportReady = true;
      tx.bindingId = binding?.id || tx.bindingId || null;
      if (state_ui_deck.p2p?.role === "host") tx.authoritativeApplied = true;
      if (state_ui_deck.p2p?.role === "guest" && !tx.authoritativeApplied) {
        session.routesReady = false;
        requestAuthoritativePhaseState(session, phase, "restore-transport-ready-awaiting-authority");
        return false;
      }
      return finish(session, binding, {
        ...detail,
        phase,
        transportReady: true
      });
    };
    const authoritativeApplied = detail => {
      const session = sessionRuntime.activeSession;
      if (!session || session.scope?.closed) return false;
      const tx = session.scope.transactions.get("restore");
      if (!tx) return false;
      tx.authoritativeApplied = true;
      tx.authoritativeRevision = Number(detail?.revision || detail?.canonicalRevision || 0);
      tx.authoritativeKind = String(detail?.kind || detail?.phase || "state");
      tx.inputPreserved = detail?.inputPreserved === true;
      trace.push({
        at: Date.now(),
        stage: "authoritative-applied",
        generation: session.generation,
        phase: detail?.phase || session.resumeState || tx.phase,
        revision: tx.authoritativeRevision
      });
      if (!tx.transportReady) {
        session.scope?.record?.("restore-authority-ready-awaiting-transport", {
          phase: detail?.phase || session.resumeState || tx.phase || "LOBBY",
          revision: tx.authoritativeRevision,
          kind: tx.authoritativeKind
        });
        return true;
      }
      return finish(session, session.transport?.activeBinding, {
        ...detail,
        phase: detail?.phase || session.resumeState || tx.phase || "LOBBY",
        canonicalRevision: tx.authoritativeRevision,
        transportReady: true
      });
    };
    const cancel = (session, reason) => {
      session?.scope?.completeTransaction?.("restore", {
        state: "CANCELLED",
        reason
      });
      session && (session.routesReady = false);
      return true;
    };
    return Object.freeze({
      begin,
      transportReady,
      authoritativeApplied,
      cancel,
      debug: () => trace.slice(-160)
    });
  })();
}
