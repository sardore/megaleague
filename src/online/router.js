import { sessionRuntime } from "./session-model.js";
import { stalePacket, receiveMatchOffer, clearMatchReadyCommitWatchdog } from "./matching.js";
import { commitSession } from "./commit.js";
import { state_ui_deck } from "../ui/deck.js";
import { systems } from "../runtime/systems.js";
import { failSession } from "./cleanup.js";
export function initializeOnlineRouter() {
  sessionRuntime.MessageRouter = Object.freeze({
    receive(packet, binding = null, bypassAdmission = false) {
      const session = sessionRuntime.activeSession;
      if (!session || packet?.protocol !== sessionRuntime.PROTOCOL) return false;
      const admission = session.transport?.admit?.(packet, binding, bypassAdmission) || "ACCEPT";
      if (admission === "DROP") return false;
      if (admission === "BUFFER") return true;
      session.transport?.markHealthy?.(binding, `packet:${packet.type}`);
      const routePacket = (item, sourceBinding = binding, bypass = false) => sessionRuntime.MessageRouter.receive(item, sourceBinding, bypass);
      switch (packet.type) {
        case "relay.ready":
          if (session.kind === "spectator" && !session.sessionToken) {
            session.transport.promoteInitial(binding, "spectator-relay-ready");
            if (session.machine.state === "SIGNALING") session.machine.transition("LOBBY", "spectator-relay-ready");
            sessionRuntime.SpectatorCoordinator.replayIntent();
            return true;
          }
          return session.transport.beginRelayReady(binding, packet);
        case "room.hosting":
          if (packet.roomCode !== session.roomCode || session.kind !== "room.create") return stalePacket("ROOM_HOSTING_IDENTITY_MISMATCH");
          session.machine.transition("HOSTING", packet.reclaimed ? "same-code-reclaimed" : "room-hosting");
          return true;
        case "room.waiting":
          if (packet.roomCode !== session.roomCode || session.kind !== "room.join") return stalePacket("ROOM_WAITING_IDENTITY_MISMATCH");
          session.machine.transition("JOINING", "room-waiting");
          return true;
        case "match.queued":
          if (packet.queueEntryId !== session.queueEntryId || session.kind !== "matchmaking") return stalePacket("QUEUE_ENTRY_MISMATCH");
          if (session.machine.state === "RECONNECTING" || session.machine.state === "SIGNALING") session.machine.transition("MATCHMAKING", "queue-resumed");else if (session.machine.state !== "MATCHMAKING") session.machine.transition("MATCHMAKING", "queue-entered");
          return true;
        case "match.offer":
          return receiveMatchOffer(session, packet);
        case "match.offer-cancelled":
          if (packet.matchId !== session.pendingOffer?.matchId) return stalePacket("STALE_OFFER_CANCEL");
          clearMatchReadyCommitWatchdog(session);
          session.pendingOffer = null;
          session.readyOfferIds.clear();
          if (session.machine.state === "HANDSHAKING") session.machine.transition("MATCHMAKING", "offer-cancelled");
          return true;
        case "match.ready-ack":
          return true;
        case "session.commit":
          return commitSession(session, packet, binding, routePacket);
        case "session.peer-disconnected":
          if (["ENDING", "CLOSED", "FAILED"].includes(session.machine.state)) {
            sessionRuntime.counters.staleCallbackDropCount++;
            session.transport?.trace?.("terminal-peer-disconnected-dropped", binding, {
              state: session.machine.state,
              packetGeneration: Number(packet.sessionGeneration || 0)
            });
            return true;
          }
          session.resumeState = ["IN_BATTLE", "LOBBY"].includes(session.machine.state) ? session.machine.state : session.resumeState;
          sessionRuntime.RestoreTransaction.begin(session, binding, "remote-peer-disconnected");
          if (session.machine.state !== "RECONNECTING") session.machine.transition("RECONNECTING", "remote-peer-disconnected");
          session.routesReady = false;
          if (state_ui_deck.p2p) {
            state_ui_deck.p2p.connected = false;
            state_ui_deck.p2p.connectionInterrupted = true;
          }
          return true;
        case "session.peer-reconnected":
          {
            if (state_ui_deck.p2p) {
              state_ui_deck.p2p.connected = true;
              state_ui_deck.p2p.connectionInterrupted = false;
            }
            const localBindingReady = !!binding && !binding.retired && binding.state === "READY" && binding.socket?.readyState === WebSocket.OPEN;
            const remoteRestorePending = session.machine.state === "RECONNECTING" || !!session.scope?.transactions?.get?.("restore");
            session.transport?.trace?.("remote-peer-reconnected", binding, {
              localBindingReady,
              remoteRestorePending,
              sessionState: session.machine.state,
              resumeState: session.resumeState
            });
            if (localBindingReady) {
              if (remoteRestorePending) sessionRuntime.RestoreTransaction.transportReady(session, binding, {
                phase: session.resumeState || (state_ui_deck.p2p?.battleStarted ? "IN_BATTLE" : "LOBBY"),
                reason: "remote-peer-reconnected"
              });
              return true;
            }
            return sessionRuntime.LifecycleCoordinator.requestAuthoritativeResync("remote-peer-reconnected");
          }
        case "session.health":
          return true;
        case "session.restore-snapshot":
          return session.transport.storeRestoreSnapshot(binding, packet);
        case "session.restore-complete":
          session.transport.completeRestore(binding, packet, routePacket).catch(error => {
            systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.restore.complete");
            session.transport.isolate(binding, "restore-exception");
          });
          return true;
        case "relay.message":
          if (packet.sessionToken !== session.sessionToken || packet.matchId !== session.matchId) return stalePacket("STALE_RELAY_MESSAGE");
          if (Number(packet.relaySequence || 0) <= Number(session.transport.lastReceivedRelaySequence || 0)) {
            sessionRuntime.counters.duplicateCommitDropCount++;
            return true;
          }
          if (!session.routesReady && !bypassAdmission) {
            const allowed = new Set(["lobbyMutationR2", "lobbyEnvelopeR2", "lobbyStateRequestR2", "rules", "bossLobbyState", "state", "authoritativeState", "stateRequest", "syncProbe", "commandAck", "start", "startAckR1", "startRequestR1", "startCommittedR1", "startCommittedAckR1", "startAbortR1", "emote", "emoteAckR1"]);
            if (!allowed.has(String(packet.payload?.type || ""))) {
              sessionRuntime.counters.staleCallbackDropCount++;
              session.scope?.record?.("application-route-closed-drop", {
                payloadType: packet.payload?.type || null,
                relaySequence: Number(packet.relaySequence || 0)
              });
              return true;
            }
          }
          session.transport.lastReceivedRelaySequence = Math.max(Number(session.transport.lastReceivedRelaySequence || 0), Number(packet.relaySequence || 0));
          session.lastRemotePayloadAt = Date.now();
          session.connection?._receive(packet.payload);
          return true;
        case "relay.ack":
          session.transport.lastAckSequence = Math.max(session.transport.lastAckSequence, Number(packet.relaySequence || 0));
          return true;
        case "heartbeat.ack":
          session.lastHeartbeatAckAt = Date.now();
          return binding ? session.transport.acknowledgeHeartbeat(binding, packet) : true;
        case "session.ended":
          if (["ENDING", "CLOSED", "FAILED"].includes(session.machine.state)) {
            sessionRuntime.counters.staleCallbackDropCount++;
            session.transport?.trace?.("terminal-session-ended-dropped", binding, {
              state: session.machine.state,
              reason: packet.reason || null,
              packetMatchId: packet.matchId || null
            });
            return true;
          }
          failSession("REMOTE_SESSION_ENDED", packet.reason || "remote ended the session", {
            terminal: true
          });
          return true;
        case "session.left":
          return true;
        case "session.failed":
          if (["ENDING", "CLOSED", "FAILED"].includes(session.machine.state)) {
            sessionRuntime.counters.staleCallbackDropCount++;
            session.transport?.trace?.("terminal-session-failed-dropped", binding, {
              state: session.machine.state,
              code: packet.code || null
            });
            return true;
          }
          failSession(packet.code || "RELAY_FAILURE", packet.detail || "", {
            terminal: true
          });
          return true;
        case "spectator.event":
          sessionRuntime.SpectatorCoordinator.receive(packet);
          return true;
        default:
          sessionRuntime.recordError("UNKNOWN_RELAY_PACKET", packet.type || "unknown");
          return false;
      }
    }
  });
}
