import { TimerManager } from "../runtime/timers.js";
import { resetOnlineStartTransactionState, state_online_start } from "./start.js";
import { resetBattleEmoteReliability } from "./emotes.js";
import { state_online_commands } from "./commands.js";
import { state_online_connection, onlineRulesPayload, lockOnlineSettings } from "./connection.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { state_runtime_presentation } from "../runtime/presentation.js";
import { systems } from "../runtime/systems.js";
import { state_runtime_input } from "../runtime/input.js";
import { state_runtime_transactions } from "../runtime/transactions.js";
import { state_ui_deck } from "../ui/deck.js";
import { state_ui_action_panel } from "../ui/action-panel.js";
import { sessionRuntime } from "./session-model.js";
import { freshSession } from "./commit.js";
import { TransportAdapter } from "./socket.js";
import { state_online_lobby } from "./lobby.js";
import { state_online_sync } from "./sync.js";
import { state_online_transport } from "./transport.js";
import { snapshot } from "./session-debug.js";
export function releaseOnlineApplicationState(reason = "online-session-release") {
  if (typeof resetOnlineStartTransactionState === "function") resetOnlineStartTransactionState(reason);
  if (typeof resetBattleEmoteReliability === "function") resetBattleEmoteReliability(reason);
  document.querySelector(".online-coin-overlay")?.remove();
  document.querySelector(".online-disconnect-overlay")?.remove();
  state_online_commands.onlineAuthoritativeRevision = 0;
  state_online_connection.onlineVisualPacketSerial = 0;
  state_online_start.onlineCoinShownScopes.clear();
  const priorGame = state_ui_battle_state.game;
  if (priorGame && (priorGame.mode === "online" || priorGame.bossRaid?.online || priorGame.spectator)) {
    try {
      state_runtime_presentation.AnimationEngine?.settleInterrupted?.(`session-release:${reason}`, priorGame.battleId || null);
      state_runtime_presentation.AnimationEngine?.clearViewportFx?.();
    } catch (error) {
      systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.newSession.AnimationEngine");
    }
    try {
      if (priorGame.battleId) TimerManager?.clearScope?.(priorGame.battleId);
    } catch (error) {
      systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.newSession.TimerManager");
    }
    try {
      if (priorGame.battleId) state_runtime_input.InputLockManager?.releaseBattle?.(priorGame.battleId);
    } catch (error) {
      systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.newSession.InputLockManager");
    }
    try {
      if (priorGame.battleId) state_runtime_transactions.ActionTransactionManager?.clearBattle?.(priorGame.battleId);
    } catch (error) {
      systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.newSession.ActionTransactionManager");
    }
    state_ui_battle_state.game = null;
  }
  state_ui_battle_state.busy = false;
  state_ui_battle_state.onlineAutoCommandOwner = null;
  state_ui_battle_state.onlineAutoCommandActive = false;
  state_ui_battle_state.pendingSkill = null;
  state_ui_battle_state.lastLog = 0;
  state_ui_battle_state.visualEvents = [];
  state_ui_battle_state.visualHoldMs = 0;
  state_ui_battle_state.lastBattleConfig = null;
  state_ui_deck.onlineSide = "P";
  const logNode = document.getElementById("log");
  if (logNode) logNode.innerHTML = "";
  state_ui_action_panel.ActionPanelConvergenceOwner?.reset?.(`session-boundary:${reason}`);
  return true;
}
export function beginSession({
  kind,
  mode,
  roomCode = "",
  explicitRoomMutation = "",
  context = {}
}) {
  const spectatorSidecar = kind === "spectator" && mode === "SPECTATOR";
  if (sessionRuntime.activeSession) sessionRuntime.CleanupCoordinator.close("new-session", {
    notify: !["CLOSED", "FAILED", "IDLE"].includes(sessionRuntime.activeSession.machine.state),
    keepUi: true,
    releaseActive: true
  });
  const checked = sessionRuntime.validateEndpoint(sessionRuntime.configuredEndpoint || sessionRuntime.readEndpoint());
  const session = freshSession({
    kind,
    mode,
    roomCode,
    context
  });
  if (roomCode) {
    if (!explicitRoomMutation) throw new Error("ROOM_CODE_MUTATION_REQUIRES_EXPLICIT_COMMAND");
    sessionRuntime.counters.roomCodeMutationCount++;
  }
  sessionRuntime.activeSession = session;
  session.machine.transition("STARTING", kind);
  if (!checked.ok) {
    session.lastError = sessionRuntime.recordError(checked.code, checked.detail);
    session.machine.transition("FAILED", checked.code);
    sessionRuntime.projectStatus();
    return false;
  }
  sessionRuntime.configuredEndpoint = checked.endpoint;
  session.transport = new TransportAdapter(session, checked.endpoint);
  if (state_ui_deck.p2p && mode !== "SPECTATOR") {
    const sessionLeague = mode === "PVP" ? state_ui_deck.LeagueFormatOwner.normalizeLeague(context?.league || state_ui_deck.leagueSelection) : state_ui_deck.LeagueFormatOwner.normalizeLeague(state_ui_deck.leagueSelection);
    const sessionComposition = sessionLeague === "comprehensive" ? state_ui_deck.LeagueFormatOwner.normalizeComposition(context?.composition || state_ui_deck.comprehensiveComposition) : null;
    state_ui_deck.p2p.playerId = sessionRuntime.playerId;
    state_ui_deck.p2p.roomCode = roomCode;
    state_ui_deck.p2p.queueEntryId = session.queueEntryId || null;
    state_ui_deck.p2p.matchId = null;
    state_ui_deck.p2p.role = null;
    state_ui_deck.p2p.connected = false;
    state_ui_deck.p2p.remoteDeck = null;
    state_ui_deck.p2p.remotePlusStar = null;
    state_ui_deck.p2p.sessionMode = kind === "matchmaking" ? "matchmaking" : "roomCode";
    state_ui_deck.p2p.matchType = state_ui_deck.p2p.sessionMode;
    state_ui_deck.p2p.localComposition = sessionComposition;
    state_ui_deck.p2p.remoteComposition = null;
    state_ui_deck.p2p.rules = mode === "PVP" ? onlineRulesPayload(sessionLeague, sessionComposition || state_ui_deck.comprehensiveComposition) : onlineRulesPayload();
    state_ui_deck.p2p.battleStarted = false;
    state_online_lobby.LobbyEngine.beginFreshDraft(`generation:${session.generation}:${kind}`);
  }
  if (mode !== "SPECTATOR") lockOnlineSettings(true, state_ui_deck.p2p?.rules || onlineRulesPayload());
  session.transport.connect("session-start");
  sessionRuntime.projectStatus();
  return true;
}
export function failWithoutSession(code, detail) {
  sessionRuntime.recordError(code, detail);
  const status = document.getElementById("p2pStatus");
  if (status) status.textContent = `온라인 연결 실패 · ${code}`;
  return false;
}
export function failSession(code, detail, {
  terminal = false
} = {}) {
  const session = sessionRuntime.activeSession;
  if (!session) return failWithoutSession(code, detail);
  session.lastError = sessionRuntime.recordError(code, detail, {
    generation: session.generation,
    state: session.machine.state
  });
  if (session.machine.state !== "FAILED") {
    try {
      session.machine.transition("FAILED", code);
    } catch {
      session.machine.state = "FAILED";
      sessionRuntime.projectStatus();
    }
  }
  if (terminal) {
    session.transport?.close(false, code);
    session.connection?._closeFromRuntime(code);
  }
  sessionRuntime.projectStatus();
  return false;
}
export function initializeOnlineCleanup() {
  sessionRuntime.CleanupCoordinator = Object.freeze({
    close(reason = "online-close", options = {}) {
      const session = sessionRuntime.activeSession;
      if (!session || sessionRuntime.runtimeClosing) return false;
      sessionRuntime.runtimeClosing = true;
      try {
        session.scope?.invalidate?.(`cleanup:${reason}`);
        sessionRuntime.RestoreTransaction.cancel(session, `cleanup:${reason}`);
        session.routesReady = false;
        if (!["CLOSED", "FAILED", "ENDING"].includes(session.machine.state)) {
          if (sessionRuntime.ALLOWED[session.machine.state]?.has("ENDING")) session.machine.transition("ENDING", reason);else if (sessionRuntime.ALLOWED[session.machine.state]?.has("CLOSED")) session.machine.transition("CLOSED", reason);
        }
        try {
          state_online_commands.OnlineActionAdmissionOwner.closeSession(options);
        } catch (error) {
          systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.cleanup.action-admission");
        }
        try {
          systems.OnlineReliableStateEngine?.closeSession?.(options);
        } catch (error) {
          systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.cleanup.reliable-state");
        }
        try {
          systems.__megaOnlineBattleChat?.closeSession?.({
            clearChat: options.clearChat === true,
            resetUnread: options.clearChat === true
          });
        } catch (error) {
          systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.cleanup.chat");
        }
        try {
          resetBattleEmoteReliability?.(`cleanup:${reason}`);
        } catch (error) {
          systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.cleanup.emote");
        }
        try {
          state_online_sync.SyncEngine?.reset?.(reason);
        } catch (error) {
          systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.cleanup.sync");
        }
        try {
          state_online_lobby.LobbyEngine?.reset?.(options);
        } catch (error) {
          systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.cleanup.lobby");
        }
        try {
          state_online_transport.OnlineTransportEngine?.closeSession?.(options);
        } catch (error) {
          systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.cleanup.legacy-timer-drain");
        }
        session.scope?.close?.(`cleanup:${reason}`);
        if (session.kind !== "spectator") releaseOnlineApplicationState(`cleanup:${reason}`);
        state_online_connection.OnlineConnectionEngine.closeSession({
          closeConnection: false
        });
        session.transport?.close(options.notify !== false, reason);
        session.connection?._closeFromRuntime(reason);
        session.readyOfferIds.clear();
        session.pendingOffer = null;
        if (state_ui_deck.p2p && session.kind !== "spectator") {
          state_ui_deck.p2p.connected = false;
          state_ui_deck.p2p.connectionInterrupted = false;
          state_ui_deck.p2p.reconnecting = false;
          state_ui_deck.p2p.battleStarted = false;
          state_ui_deck.p2p.conn = null;
          state_ui_deck.p2p.peer = null;
          state_ui_deck.p2p.role = null;
          state_ui_deck.p2p.matchId = null;
          state_ui_deck.p2p.roomCode = null;
          state_ui_deck.p2p.queueEntryId = null;
          state_ui_deck.p2p.remoteDeck = null;
          state_ui_deck.p2p.remotePlusStar = null;
          state_ui_deck.p2p.remoteComposition = null;
          state_ui_deck.p2p.guestStartAwaitingHostCommit = null;
        }
        if (session.machine.state !== "CLOSED") {
          if (session.machine.state === "FAILED") session.machine.transition("CLOSED", reason);else if (session.machine.state === "ENDING") session.machine.transition("CLOSED", reason);
        }
        if (options.releaseActive !== false) {
          sessionRuntime.activeSession = null;
          lockOnlineSettings(false);
        }
        if (!options.keepUi) sessionRuntime.projectStatusDom();
        return true;
      } finally {
        sessionRuntime.runtimeClosing = false;
      }
    },
    debug() {
      return {
        runtimeClosing: sessionRuntime.runtimeClosing,
        active: snapshot(),
        timerCount: sessionRuntime.activeSession?.transport?.debug().timerCount || 0,
        listenerCount: sessionRuntime.activeSession?.transport?.debug().listenerCount || 0
      };
    }
  });
}
