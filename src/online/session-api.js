import { sessionRuntime } from "./session-model.js";
import { TransportAdapter } from "./socket.js";
import { setEndpoint } from "./session-config.js";
import { snapshot } from "./session-debug.js";
import { state_runtime_config } from "../runtime/config.js";
import { state_online_lobby } from "./lobby.js";
import { activateOnlineApplicationRoutes } from "./matching.js";
import { systems } from "../runtime/systems.js";
import { clearLocalAutoTurnTimer, state_ui_battle_state } from "../ui/battle-state.js";
import { state_runtime_presentation } from "../runtime/presentation.js";
import { state_runtime_input } from "../runtime/input.js";
export function initializeOnlineSessionApi() {
  sessionRuntime.api = Object.freeze({
    VERSION: sessionRuntime.VERSION,
    PROTOCOL: sessionRuntime.PROTOCOL,
    states: sessionRuntime.STATES,
    SessionStateMachine: sessionRuntime.SessionStateMachineOwner,
    TransportAdapter,
    RoomCoordinator: sessionRuntime.RoomCoordinator,
    MatchmakingCoordinator: sessionRuntime.MatchmakingCoordinator,
    MessageRouter: sessionRuntime.MessageRouter,
    AuthorityCoordinator: sessionRuntime.AuthorityCoordinator,
    SnapshotSyncCoordinator: sessionRuntime.SnapshotSyncCoordinator,
    ChatCoordinator: sessionRuntime.ChatCoordinator,
    LifecycleCoordinator: sessionRuntime.LifecycleCoordinator,
    CleanupCoordinator: sessionRuntime.CleanupCoordinator,
    SpectatorCoordinator: sessionRuntime.SpectatorCoordinator,
    room: sessionRuntime.RoomCoordinator,
    matchmaking: sessionRuntime.MatchmakingCoordinator,
    lifecycle: sessionRuntime.LifecycleCoordinator,
    cleanup: sessionRuntime.CleanupCoordinator,
    ui: sessionRuntime.UIControllerRuntime,
    setEndpoint,
    endpoint: () => sessionRuntime.configuredEndpoint,
    endpointSource: () => sessionRuntime.configuredEndpointSource,
    productionEndpoint: sessionRuntime.PRODUCTION_RELAY_ENDPOINT,
    spectator: sessionRuntime.SpectatorCoordinator,
    close: (reason, options) => sessionRuntime.CleanupCoordinator.close(reason, options),
    debug: snapshot,
    identity() {
      const s = sessionRuntime.activeSession;
      return Object.freeze({
        generation: Number(s?.generation || 0),
        sessionToken: String(s?.sessionToken || ""),
        roomCode: s?.roomCode || null,
        lobbyId: s?.roomCode || null,
        matchId: s?.matchId || null,
        battleId: state_runtime_config.currentGame()?.battleId || null,
        phase: s?.scope?.phase || (s ? sessionRuntime.phaseForState(s.machine?.state) : "IDLE"),
        projectionEpoch: Number(s?.scope?.projectionEpoch || 0),
        bindingGeneration: Number(s?.transport?.activeBinding?.serial || s?.transport?.candidateBinding?.serial || 0),
        routesReady: !!s?.routesReady
      });
    },
    sendControl(payload) {
      try {
        return sessionRuntime.activeSession?.transport?.sendControlPayload?.(payload) || false;
      } catch (error) {
        sessionRuntime.recordError(error?.code || "CONTROL_SEND_FAILED", error?.message || error);
        return false;
      }
    },
    restore: Object.freeze({
      authoritativeApplied: detail => sessionRuntime.RestoreTransaction.authoritativeApplied(detail),
      pending: () => !!sessionRuntime.activeSession?.scope?.transactions?.has?.("restore"),
      debug: () => sessionRuntime.RestoreTransaction.debug()
    }),
    projection: sessionRuntime.ProjectionTransaction,
    sessionScope: Object.freeze({
      requestAnimationFrame: (fn, label, options) => sessionRuntime.activeSession?.scope?.requestAnimationFrame?.(fn, label, options || {
        phase: sessionRuntime.activeSession?.scope?.phase
      }),
      setTimeout: (fn, delay, label, options) => sessionRuntime.activeSession?.scope?.setTimeout?.(fn, delay, label, options),
      setInterval: (fn, delay, label, options) => sessionRuntime.activeSession?.scope?.setInterval?.(fn, delay, label, options),
      cancel: key => sessionRuntime.activeSession?.scope?.cancelResource?.(key) || false,
      track: (promise, label, options) => sessionRuntime.activeSession?.scope?.track?.(promise, label, options),
      adoptTimer: (id, kind, label, phase) => sessionRuntime.activeSession?.scope?.adoptTimer?.(id, kind, label, phase) || false,
      releaseAdoptedTimer: id => sessionRuntime.activeSession?.scope?.releaseAdoptedTimer?.(id) || false,
      get closed() {
        return !sessionRuntime.activeSession?.scope || sessionRuntime.activeSession.scope.invalidated || sessionRuntime.activeSession.scope.closed;
      },
      debug: () => sessionRuntime.activeSession?.scope?.debug?.() || null
    }),
    abortBattleStart(reason = "battle-start-aborted") {
      const s = sessionRuntime.activeSession;
      if (!s || !["STARTING_BATTLE", "IN_BATTLE"].includes(s.machine.state)) return false;
      s.routesReady = false;
      s.resumeState = "LOBBY";
      if (s.mode === "PVP") state_online_lobby.LobbyEngine.setStartTransaction(null);
      s.machine.transition("LOBBY", reason);
      const projected = sessionRuntime.ProjectionTransaction.request(`battle-start-aborted:${reason}`, {
        phase: "LOBBY",
        canonicalRevision: s.mode === "PVP" ? Number(state_online_lobby.LobbyEngine.debug().revision || 0) : Number(s.scope?.projectionEpoch || 0)
      });
      s.routesReady = !!projected?.committed;
      if (s.routesReady) activateOnlineApplicationRoutes(s, "LOBBY", reason);
      return projected;
    },
    markBattleStarting() {
      const s = sessionRuntime.activeSession;
      if (s?.machine.state === "LOBBY") {
        s.routesReady = false;
        s.machine.transition("STARTING_BATTLE", "application-start");
      }
    },
    markBattleStarted(detail = {}) {
      const s = sessionRuntime.activeSession;
      if (s && ["LOBBY", "STARTING_BATTLE"].includes(s.machine.state)) {
        if (s.machine.state === "LOBBY") s.machine.transition("STARTING_BATTLE", "application-start");
        s.machine.transition("IN_BATTLE", "application-started");
      }
      if (s?.machine.state === "IN_BATTLE") {
        s.resumeState = "IN_BATTLE";
        const projected = sessionRuntime.ProjectionTransaction.request("battle-started", {
          phase: "IN_BATTLE",
          canonicalRevision: Number(detail?.canonicalRevision ?? state_runtime_config.currentGame()?.networkRevision ?? 0)
        });
        s.routesReady = !!projected?.committed;
        if (s.routesReady) activateOnlineApplicationRoutes(s, "IN_BATTLE", detail?.source || "battle-started");
        const identity = Object.freeze({
          reason: "online-battle-initialization-commit",
          source: String(detail?.source || "local-start-lifecycle"),
          sessionGeneration: Number(s.generation || 0),
          matchId: s.matchId || state_runtime_config.currentGame()?.matchId || null,
          battleId: state_runtime_config.currentGame()?.battleId || null,
          routesReady: !!s.routesReady
        });
        s.scope?.setTimeout?.(() => systems.LifecycleManager?.continuity?.authoritativeSettled?.(identity), 0, "battle-start-authoritative-settled", {
          phase: "IN_BATTLE"
        });
        return projected;
      }
      return false;
    },
    markBattleEnded(detail = {}) {
      const s = sessionRuntime.activeSession,
        g = state_runtime_config.currentGame(),
        state = s?.machine?.state;
      if (!s || !g?.winner) return false;
      if (state === "ENDING") return true;
      if (!["IN_BATTLE", "RECONNECTING"].includes(state)) return false;
      const reason = String(detail.source || "battle-ended");
      s.routesReady = false;
      sessionRuntime.RestoreTransaction.cancel(s, reason);
      s.machine.transition("ENDING", reason, {
        project: false
      });
      clearLocalAutoTurnTimer(reason);
      state_ui_battle_state.localBackgroundAutoTurnOwner = null;
      state_ui_battle_state.localBattleBackgrounded = false;
      state_ui_battle_state.busy = false;
      state_ui_battle_state.pendingSkill = null;
      if (typeof state_runtime_presentation.AnimationEngine !== "undefined") state_runtime_presentation.AnimationEngine.clearViewportFx();
      if (g.battleId) {
        state_runtime_config.TimerManager.clearScope(g.battleId);
        state_runtime_input.InputLockManager.releaseBattle(g.battleId);
      }
      if (detail.project === false) return true;
      return sessionRuntime.ProjectionTransaction.request(reason, {
        phase: "TERMINAL",
        canonicalRevision: Number(detail.canonicalRevision ?? g.networkRevision ?? 0)
      });
    },
    returnToSetup(reason = "result-to-setup") {
      return sessionRuntime.returnOnlineRuntimeToSetup(reason);
    }
  });
  systems.OnlineRuntime = sessionRuntime.api;
}
