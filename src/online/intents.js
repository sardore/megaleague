import { sessionRuntime } from "./session-model.js";
import { beginSession, failWithoutSession } from "./cleanup.js";
import { state_ui_deck } from "../ui/deck.js";
import { systems } from "../runtime/systems.js";
import { snapshot } from "./session-debug.js";
import { state_runtime_config } from "../runtime/config.js";
import { sendAuthoritativeOnlineState } from "./snapshots.js";
import { state_online_commands, onlineCurrentMatchId } from "./commands.js";
import { state_runtime_presentation } from "../runtime/presentation.js";
export function initializeOnlineIntents() {
  sessionRuntime.SessionStateMachineOwner = Object.freeze({
    states: sessionRuntime.STATES,
    allowed: sessionRuntime.ALLOWED
  });
  sessionRuntime.RoomCoordinator = Object.freeze({
    create({
      regenerate = false
    } = {}) {
      const code = sessionRuntime.makeStableRoomCode();
      return beginSession({
        kind: "room.create",
        mode: "PVP",
        roomCode: code,
        explicitRoomMutation: regenerate ? "explicit-regenerate" : "explicit-create",
        context: {
          league: state_ui_deck.leagueSelection,
          composition: state_ui_deck.leagueSelection === "comprehensive" ? state_ui_deck.comprehensiveComposition : null
        }
      });
    },
    join(code) {
      const normalized = sessionRuntime.clean(code, 12).toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(normalized)) return failWithoutSession("INVALID_ROOM_CODE", "6자리 방 코드를 정확히 입력하세요.");
      return beginSession({
        kind: "room.join",
        mode: "PVP",
        roomCode: normalized,
        explicitRoomMutation: "explicit-join",
        context: {
          league: state_ui_deck.leagueSelection,
          composition: state_ui_deck.leagueSelection === "comprehensive" ? state_ui_deck.comprehensiveComposition : null
        }
      });
    },
    regenerate() {
      if (sessionRuntime.activeSession?.kind !== "room.create") return failWithoutSession("ROOM_REGENERATE_NOT_HOST", "방 host만 새 코드를 만들 수 있습니다.");
      return this.create({
        regenerate: true
      });
    },
    inviteUrl() {
      if (!sessionRuntime.activeSession?.roomCode || !/^https?:$/.test(location.protocol)) return "";
      const url = new URL(location.href);
      url.searchParams.set("room", sessionRuntime.activeSession.roomCode);
      if (sessionRuntime.configuredEndpoint && sessionRuntime.configuredEndpoint !== sessionRuntime.PRODUCTION_RELAY_ENDPOINT) url.searchParams.set("relay", sessionRuntime.configuredEndpoint);else url.searchParams.delete("relay");
      url.hash = "";
      return url.href;
    }
  });
  sessionRuntime.MatchmakingCoordinator = Object.freeze({
    start(mode = "PVP", context = {}) {
      const normalized = mode === "BOSS_COOP" ? "BOSS_COOP" : "PVP";
      if (sessionRuntime.activeSession?.kind === "matchmaking" && sessionRuntime.activeSession.mode === normalized && !sessionRuntime.activeSession.committed && !['CLOSED', 'FAILED', 'ENDING'].includes(sessionRuntime.activeSession.machine.state)) {
        sessionRuntime.activeSession.scope?.record?.("duplicate-matchmaking-touch-suppressed", {
          state: sessionRuntime.activeSession.machine.state,
          queueEntryId: sessionRuntime.activeSession.queueEntryId
        });
        sessionRuntime.projectStatus();
        return true;
      }
      if (sessionRuntime.activeSession && !['CLOSED', 'FAILED', 'IDLE'].includes(sessionRuntime.activeSession.machine.state)) return false;
      return beginSession({
        kind: "matchmaking",
        mode: normalized,
        context
      });
    },
    cancel() {
      if (sessionRuntime.activeSession?.kind !== "matchmaking" || sessionRuntime.activeSession.committed) return false;
      const cancelledMode = sessionRuntime.activeSession.mode;
      sessionRuntime.activeSession.transport?.system({
        type: "match.cancel",
        queueEntryId: sessionRuntime.activeSession.queueEntryId,
        mode: cancelledMode
      });
      sessionRuntime.CleanupCoordinator.close("matchmaking-cancel", {
        notify: false
      });
      if (cancelledMode === "BOSS_COOP") systems.__redTimeoraBossRaid?.openMenu?.();else sessionRuntime.UIControllerRuntime.showEntry();
      return true;
    },
    wake(reason = "wake") {
      return sessionRuntime.LifecycleCoordinator.foreground(reason);
    },
    reconnect() {
      return sessionRuntime.activeSession?.transport?.reconnectNow("explicit-reconnect") || false;
    },
    debug() {
      return snapshot();
    }
  });
  sessionRuntime.AuthorityCoordinator = Object.freeze({
    model: "host-authoritative",
    send(message) {
      return sessionRuntime.activeSession?.connection?.send(message) || false;
    },
    applicationOwner: "persistent relay session owner"
  });
  sessionRuntime.SnapshotSyncCoordinator = Object.freeze({
    request(reason = "runtime-resume") {
      if (!sessionRuntime.activeSession?.connection?.open) return false;
      const g = state_runtime_config.currentGame(),
        bossOnline = !!g?.bossRaid?.online;
      try {
        if (state_ui_deck.p2p?.role === "host" && (g?.mode === "online" || bossOnline)) return !!sendAuthoritativeOnlineState([], null, true);
        const request = {
          type: "stateRequest",
          protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
          mode: bossOnline ? "BOSS_COOP" : "PVP",
          matchId: onlineCurrentMatchId(),
          actionId: state_online_commands.OnlineActionAdmissionOwner.pendingActionId(),
          knownTurnSerial: Number(g?.turnSerial ?? -1),
          knownRevision: Number(state_ui_deck.p2p?.lastAuthoritativeRevision || g?.networkRevision || 0),
          resumeReason: String(reason)
        };
        return !!sessionRuntime.activeSession?.transport?.sendControlPayload?.(request);
      } catch {
        return false;
      }
    },
    applicationOwner: "OnlineActionAdmissionOwner"
  });
  sessionRuntime.ChatCoordinator = Object.freeze({
    applicationOwner: "ChatEngine",
    send(text) {
      return state_runtime_presentation.ChatEngine.send(text);
    }
  });
}
