import { sessionRuntime } from "./session-model.js";
import { state_online_commands } from "./commands.js";
import { state_online_start } from "./start.js";
import { state_ui_deck } from "../ui/deck.js";
import { onlineRulesPayload, state_online_connection } from "./connection.js";
import { systems } from "../runtime/systems.js";
export function snapshot() {
  const session = sessionRuntime.activeSession;
  return session ? {
    version: sessionRuntime.VERSION,
    state: session.machine.state,
    generation: session.generation,
    kind: session.kind,
    mode: session.mode,
    role: session.role || null,
    playerId: sessionRuntime.playerId,
    roomCode: session.roomCode || null,
    queueEntryId: session.queueEntryId || null,
    matchId: session.matchId || null,
    sessionToken: session.sessionToken || null,
    committed: session.committed,
    transport: session.transport?.debug() || null,
    scope: session?.scope?.debug?.() || null,
    routesReady: !!session?.routesReady,
    projection: sessionRuntime.ProjectionTransaction.debug(),
    restore: sessionRuntime.RestoreTransaction.debug(),
    actionAdmission: state_online_commands.OnlineActionAdmissionOwner.debug(),
    startTrace: typeof state_online_start.onlineStartTrace !== "undefined" ? state_online_start.onlineStartTrace.slice(-160) : [],
    counters: {
      ...sessionRuntime.counters
    },
    lastError: session.lastError
  } : {
    version: sessionRuntime.VERSION,
    state: "IDLE",
    generation: 0,
    playerId: sessionRuntime.playerId,
    counters: {
      ...sessionRuntime.counters
    }
  };
}
export function initializeOnlineSessionDebug() {
  sessionRuntime.modeAdapters.set("PVP", Object.freeze({
    commit(session, _packet, connection) {
      state_ui_deck.p2p.peer = {
        id: sessionRuntime.playerId,
        open: true,
        disconnected: false,
        destroyed: false,
        reconnect: () => sessionRuntime.LifecycleCoordinator.foreground("peer-facade-reconnect"),
        destroy() {
          this.destroyed = true;
          this.open = false;
        }
      };
      state_ui_deck.p2p.conn = connection;
      state_ui_deck.p2p.connected = true;
      state_ui_deck.p2p.role = session.role;
      state_ui_deck.p2p.playerId = sessionRuntime.playerId;
      state_ui_deck.p2p.remotePlayerId = session.remotePlayerId;
      state_ui_deck.p2p.remotePeerId = session.remotePlayerId;
      state_ui_deck.p2p.roomCode = session.kind === "matchmaking" ? "자동 매칭" : session.roomCode;
      state_ui_deck.p2p.queueEntryId = session.queueEntryId || null;
      state_ui_deck.p2p.matchId = session.matchId;
      state_ui_deck.p2p.sessionMode = session.kind === "matchmaking" ? "matchmaking" : "roomCode";
      state_ui_deck.p2p.matchType = state_ui_deck.p2p.sessionMode;
      state_ui_deck.p2p.rules = state_ui_deck.p2p.rules || onlineRulesPayload();
      state_ui_deck.p2p.battleStarted = false;
      state_online_connection.OnlineConnectionEngine.bind(connection, {
        phase: "session",
        owner: "online-runtime-pvp",
        role: session.role,
        source: "native-relay"
      });
    },
    resume(session, _packet, connection) {
      state_ui_deck.p2p.connected = true;
      state_ui_deck.p2p.connectionInterrupted = false;
      if (typeof state_online_connection.OnlineConnectionEngine.resume === "function") state_online_connection.OnlineConnectionEngine.resume(connection, {
        owner: "online-runtime-pvp-resume",
        role: session.role
      });else connection?._emit?.("open");
    }
  }));
  sessionRuntime.modeAdapters.set("BOSS_COOP", Object.freeze({
    commit(session, _packet, connection) {
      const committed = systems.__redTimeoraBossRaid?.runtimeCommit?.({
        remotePlayerId: session.remotePlayerId,
        role: session.role,
        matchId: session.matchId
      }, connection);
      if (!committed) throw new Error("BOSS_MODE_ADAPTER_COMMIT_FAILED");
    },
    resume(session, _packet, connection) {
      state_ui_deck.p2p.connected = true;
      state_ui_deck.p2p.connectionInterrupted = false;
      if (typeof state_online_connection.OnlineConnectionEngine.resume === "function") state_online_connection.OnlineConnectionEngine.resume(connection, {
        owner: "online-runtime-boss-resume",
        role: session.role
      });
    }
  }));
}
