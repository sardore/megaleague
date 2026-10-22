import { sessionRuntime } from "./session-model.js";
import { stalePacket, clearMatchReadyCommitWatchdog, setMatchIdentity, activateOnlineApplicationRoutes } from "./matching.js";
import { failSession } from "./cleanup.js";
import { RelayDataConnection } from "./channel.js";
import { systems } from "../runtime/systems.js";
import { state_online_lobby } from "./lobby.js";
import { state_ui_deck } from "../ui/deck.js";
import { state_online_commands } from "./commands.js";
import { state_runtime_config } from "../runtime/config.js";
import { SessionStateMachine } from "./session-machine.js";
import { SessionScope } from "./scope.js";
export function commitSession(session, packet, binding = null, routePacket = null) {
  if (sessionRuntime.activeSession !== session) return stalePacket("STALE_SESSION_COMMIT");
  if (session.committed && session.matchId === packet.matchId) {
    if (!packet.resumed) sessionRuntime.counters.duplicateCommitDropCount++;
    if (packet.resumed) return session.transport.storeResumeCommit(binding, packet, routePacket);
    return true;
  }
  if (session.committed) return stalePacket("SPLIT_BRAIN_COMMIT");
  if (packet.mode !== session.mode) return failSession("MODE_MISMATCH", `${packet.mode} != ${session.mode}`);
  if (session.kind === "matchmaking") {
    if (!session.pendingOffer || packet.matchId !== session.pendingOffer.matchId || packet.role !== session.pendingOffer.role || packet.queueEntryId !== session.queueEntryId) return failSession("COMMIT_WITHOUT_READY_OFFER", "match commit did not match the ready offer");
  }
  if (session.kind.startsWith("room.") && packet.roomCode !== session.roomCode) return failSession("ROOM_IDENTITY_MISMATCH", "commit changed room code");
  clearMatchReadyCommitWatchdog(session);
  try {
    setMatchIdentity(session, packet.matchId);
  } catch (error) {
    return failSession(error.message, packet.matchId);
  }
  session.sessionToken = sessionRuntime.clean(packet.sessionToken, 180);
  session.role = packet.role;
  session.remotePlayerId = packet.remotePlayerId;
  session.committed = true;
  session.committedAt = Date.now();
  session.connection ||= new RelayDataConnection(session);
  session.connection.peer = session.remotePlayerId;
  session.connection.metadata = {
    kind: "cp32-relay",
    mode: session.mode,
    matchId: session.matchId,
    roomCode: session.roomCode || null
  };
  session.connection._setOpen(true, false);
  if (session.machine.state !== "HANDSHAKING") session.machine.transition("HANDSHAKING", "session-commit");
  try {
    const adapter = sessionRuntime.modeAdapters.get(session.mode);
    if (!adapter) throw new Error(`MODE_ADAPTER_MISSING:${session.mode}`);
    adapter.commit(session, packet, session.connection);
  } catch (error) {
    systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.commit.modeAdapter");
    return failSession("MODE_ADAPTER_COMMIT_FAILED", error?.message || error);
  }
  if (!session.transport.promoteInitial(binding, "session-commit")) return failSession("BINDING_PROMOTION_FAILED", "session commit arrived on a non-current binding", {
    terminal: true
  });
  session.machine.transition("LOBBY", "commit-complete", {
    project: false
  });
  let projected;
  try {
    projected = sessionRuntime.ProjectionTransaction.request("session-commit", {
      phase: "LOBBY",
      canonicalRevision: Number(state_online_lobby.LobbyEngine.debug().revision || 0)
    });
  } catch (error) {
    systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.commit.projection");
    return failSession("LOBBY_PROJECTION_FAILED", error?.message || error, {
      terminal: true
    });
  }
  session.routesReady = !!projected?.committed;
  if (!session.routesReady) return failSession("LOBBY_PROJECTION_FAILED", projected?.dropReason || "lobby surface unavailable", {
    terminal: true
  });
  activateOnlineApplicationRoutes(session, "LOBBY", "session-commit");
  state_online_lobby.LobbyEngine.onTransportReady("session-commit", {
    project: false
  });
  return true;
}
export function restoreCommittedSession(session, packet, options = {}) {
  session.sessionToken = packet.sessionToken || session.sessionToken;
  session.role = packet.role || session.role;
  session.remotePlayerId = packet.remotePlayerId || session.remotePlayerId;
  session.connection?._setOpen?.(true, false);
  if (state_ui_deck.p2p) {
    state_ui_deck.p2p.connected = true;
    state_ui_deck.p2p.connectionInterrupted = false;
  }
  const adapter = sessionRuntime.modeAdapters.get(session.mode);
  try {
    adapter?.resume?.(session, packet, session.connection);
  } catch (error) {
    systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.resume.modeAdapter");
  }
  state_online_commands.OnlineActionAdmissionOwner.resumeSession("transport-resume");
  if (session.mode === "BOSS_COOP") systems.__redTimeoraBossRaid?.runtimeResume?.("transport-resume");
  if (!options.deferPromotion) sessionRuntime.RestoreTransaction.transportReady(session, session.transport?.activeBinding, {
    canonicalRevision: Number(state_runtime_config.currentGame()?.networkRevision || state_online_lobby.LobbyEngine.debug().revision || 0)
  });
}
export function dispatchIntent(session) {
  if (sessionRuntime.activeSession !== session || !session.transport.ready || session.committed) return false;
  if (session.kind === "room.create") return session.transport.system({
    type: "room.create",
    mode: session.mode,
    roomCode: session.roomCode
  });
  if (session.kind === "room.join") return session.transport.system({
    type: "room.join",
    mode: session.mode,
    roomCode: session.roomCode
  });
  if (session.kind === "matchmaking") {
    const queueLeague = session.mode === "PVP" ? state_ui_deck.LeagueFormatOwner.normalizeLeague(session.context?.league || state_ui_deck.leagueSelection) : null;
    const queueComposition = null;
    const sent = session.transport.system({
      type: "match.enqueue",
      mode: session.mode,
      queueEntryId: session.queueEntryId,
      league: queueLeague,
      composition: queueComposition,
      queueKey: session.mode === "PVP" ? `PVP:${queueLeague}:-` : session.mode
    });
    return sent || failSession("MATCH_ENQUEUE_SEND_FAILED", "relay match.enqueue dispatch failed", {
      terminal: true
    });
  }
  return false;
}
export function freshSession({
  kind,
  mode,
  roomCode = "",
  context = {}
}) {
  const generation = ++sessionRuntime.generationSerial;
  sessionRuntime.counters.sessionGenerationCount++;
  const session = {
    generation,
    kind,
    mode,
    context,
    machine: new SessionStateMachine(generation),
    roomCode,
    queueEntryId: "",
    matchId: "",
    sessionToken: "",
    role: "",
    remotePlayerId: "",
    pendingOffer: null,
    readyOfferIds: new Set(),
    matchCommitWatchdogTimerId: 0,
    committed: false,
    committedAt: 0,
    connection: null,
    transport: null,
    resumeState: "LOBBY",
    lastError: null,
    startedAt: Date.now(),
    hiddenAt: 0,
    lifecycleRestorePending: false,
    lifecycleBackgrounded: false,
    lifecycleEpoch: 0,
    lifecycleRestoredEpoch: 0,
    lifecycleRestoreRequestEpoch: 0,
    lastRemotePayloadAt: 0,
    lastHeartbeatAckAt: 0
  };
  session.scope = new SessionScope(session);
  session.routesReady = false;
  session.startTransaction = null;
  session.relayReadyPromise = new Promise(resolve => {
    session.resolveRelayReady = resolve;
  });
  if (kind === "matchmaking") {
    session.queueEntryId = sessionRuntime.randomToken(mode === "BOSS_COOP" ? "boss-queue" : "queue");
    sessionRuntime.counters.queueEntryMutationCount++;
  }
  return session;
}
