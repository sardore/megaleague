import { TimerManager } from "../runtime/timers.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_online_sync = {
  NetworkEngine: undefined,
  SyncEngine: undefined
};
import { state_online_commands } from "./commands.js";
import { state_online_connection } from "./connection.js";
import { sanitizeOnlineRoomSelection } from "./lobby.js";
import { state_online_session } from "./session.js";
import { state_runtime_config } from "../runtime/config.js";
import { state_runtime_input } from "../runtime/input.js";
import { state_runtime_presentation } from "../runtime/presentation.js";
import { state_runtime_snapshots } from "../runtime/snapshots.js";
import { state_runtime_state } from "../runtime/state.js";
import { systems } from "../runtime/systems.js";
import { state_runtime_transactions } from "../runtime/transactions.js";
import { state_ui_deck } from "../ui/deck.js";
import { render } from "../ui/payment.js";
export function initializeOnlineSync() {
  state_online_sync.NetworkEngine = (() => {
    let sequence = 0;
    const seen = new Map();
    const roomId = () => (typeof state_ui_deck.p2p !== "undefined" ? state_ui_deck.p2p.matchId || state_ui_deck.p2p.roomCode || state_ui_deck.p2p.queueEntryId : null) || state_runtime_config.currentGame()?.matchId || null;
    const senderId = () => typeof state_ui_deck.p2p !== "undefined" ? state_ui_deck.p2p.playerId || state_ui_deck.p2p.peer?.id || null : null;
    const senderRole = () => typeof state_ui_deck.p2p !== "undefined" ? state_ui_deck.p2p.role || "local" : "local";
    const revision = () => Math.max(Number(state_runtime_config.currentGame()?.networkRevision) || 0, Number(typeof state_online_commands.onlineAuthoritativeRevision !== "undefined" ? state_online_commands.onlineAuthoritativeRevision : 0) || 0);
    const envelope = message => {
      if (!message || typeof message !== "object") return message;
      if (message.protocolVersion === state_runtime_config.PROTOCOL_VERSION && message.messageType) return message;
      const packet = {
        ...message,
        protocolVersion: state_runtime_config.PROTOCOL_VERSION,
        roomId: roomId(),
        battleId: state_runtime_config.currentGame()?.battleId || state_runtime_config.currentGame()?.matchId || null,
        senderId: senderId(),
        senderRole: senderRole(),
        sequence: ++sequence,
        revision: revision(),
        messageType: message.type || message.messageType || "unknown",
        payload: message.payload ?? {},
        createdAt: state_runtime_config.now()
      };
      packet.checksum = state_runtime_config.hashText(state_runtime_config.stableText({
        protocolVersion: packet.protocolVersion,
        roomId: packet.roomId,
        battleId: packet.battleId,
        senderId: packet.senderId,
        sequence: packet.sequence,
        revision: packet.revision,
        messageType: packet.messageType,
        payload: packet.payload,
        actionId: packet.actionId,
        turnSerial: packet.turnSerial,
        state: packet.state
      }));
      return packet;
    };
    const verify = packet => {
      if (!packet || packet.protocolVersion !== state_runtime_config.PROTOCOL_VERSION) return {
        ok: true,
        legacy: true
      };
      const expected = state_runtime_config.hashText(state_runtime_config.stableText({
        protocolVersion: packet.protocolVersion,
        roomId: packet.roomId,
        battleId: packet.battleId,
        senderId: packet.senderId,
        sequence: packet.sequence,
        revision: packet.revision,
        messageType: packet.messageType,
        payload: packet.payload,
        actionId: packet.actionId,
        turnSerial: packet.turnSerial,
        state: packet.state
      }));
      return {
        ok: packet.checksum === expected,
        expected,
        actual: packet.checksum
      };
    };
    const accept = packet => {
      const checked = verify(packet);
      if (!checked.ok) return false;
      if (checked.legacy) return true;
      const key = `${packet.roomId || "room"}:${packet.senderId || "sender"}`;
      const state = seen.get(key) || {
        sequence: 0,
        revision: 0,
        ids: new Set()
      };
      const packetId = `${packet.sequence}:${packet.checksum}`;
      if (state.ids.has(packetId)) return false;
      const incomingSequence = Number(packet.sequence) || 0,
        incomingRevision = Number(packet.revision) || 0;
      const isSnapshot = packet.messageType === "state-snapshot" || packet.type === "authoritativeState";
      if (incomingSequence < state.sequence && (!isSnapshot || incomingRevision <= state.revision)) return false;
      if (isSnapshot && incomingRevision < state.revision) return false;
      state.sequence = Math.max(state.sequence, incomingSequence);
      state.revision = Math.max(state.revision, incomingRevision);
      state.ids.add(packetId);
      if (state.ids.size > 512) state.ids = new Set([...state.ids].slice(-256));
      seen.set(key, state);
      return true;
    };
    const send = message => {
      try {
        if (typeof state_ui_deck.p2p === "undefined" || !state_ui_deck.p2p?.conn?.open) return false;
        const packet = envelope(message);
        return state_ui_deck.p2p.conn.send(packet) !== false;
      } catch (error) {
        systems.__megaRecordRecoveredError?.(error, "NetworkEngine.send");
        return false;
      }
    };
    // Obsolete PeerJS fixed-slot R47 owner removed; canonical matchmaking is the relay facade below.
    const matchmaking = Object.freeze({
      build: state_online_session.OnlineRuntime.VERSION,
      protocol: state_online_session.OnlineRuntime.PROTOCOL,
      compat: "cp32-online-runtime-rebase-r1",
      slotCount: 0,
      slotId: () => null,
      start: () => {
        try {
          sanitizeOnlineRoomSelection(state_ui_deck.leagueSelection);
        } catch (error) {
          systems.__megaRecordRecoveredError?.(error, "NetworkEngine.matchmaking.prepare");
        }
        return state_online_session.OnlineRuntime.matchmaking.start("PVP");
      },
      wake: reason => state_online_session.OnlineRuntime.matchmaking.wake(reason || "network-engine-wake"),
      cancel: () => state_online_session.OnlineRuntime.matchmaking.cancel(),
      reconnect: () => state_online_session.OnlineRuntime.matchmaking.reconnect(),
      dispose: () => true,
      debug: () => state_online_session.OnlineRuntime.debug(),
      commitPacket: offer => ({
        ...offer,
        type: "match.ready",
        protocol: state_online_session.OnlineRuntime.PROTOCOL
      })
    });
    const reset = () => {
      sequence = 0;
      seen.clear();
    };
    let closing = false;
    let lastClose = null;
    const normalizeCloseOptions = options => {
      const value = options === true ? {
        clearChat: true
      } : options || {};
      return Object.freeze({
        reason: String(value.reason || "online-close"),
        clearChat: value.clearChat === true,
        returnToLobby: value.returnToLobby === true,
        preserveBattleResult: value.preserveBattleResult === true,
        closeConnection: value.closeConnection !== false
      });
    };
    const closeOnline = options => {
      const normalized = normalizeCloseOptions(options);
      if (closing) return lastClose || {
        ok: true,
        repeated: true,
        options: normalized
      };
      closing = true;
      const g = state_runtime_config.currentGame();
      const battleId = g?.battleId || null;
      const errors = [];
      const run = (owner, fn) => {
        try {
          return fn();
        } catch (error) {
          errors.push({
            owner,
            message: error?.message || String(error)
          });
          systems.__megaRecordRecoveredError?.(error, `NetworkEngine.closeOnline.${owner}`);
          return null;
        }
      };
      try {
        run("spectator", () => state_runtime_presentation.SpectatorEngine.closeSession({
          preserveBattleResult: normalized.preserveBattleResult
        }));
        run("boss", () => systems.__redTimeoraBossRaid?.closeSession?.(normalized));
        run("matchmaking", () => matchmaking.dispose());
        run("runtime", () => state_online_session.OnlineRuntime.cleanup.close(normalized.reason, {
          notify: normalized.closeConnection,
          clearChat: normalized.clearChat
        }));
        run("packet-state", reset);
        run("clock-visual", () => systems.timeClockVisualSaturation?.reset?.());
        run("viewport-fx", () => state_runtime_presentation.AnimationEngine.clearViewportFx());
        if (battleId) {
          run("battle-timers", () => TimerManager.clearScope(battleId));
          run("battle-locks", () => state_runtime_input.InputLockManager.releaseBattle(battleId));
          run("battle-transaction", () => state_runtime_transactions.ActionTransactionManager.clearBattle(battleId));
        }
        run("legacy-lock-reconcile", () => state_runtime_input.InputLockManager.reconcileLegacyClock("online-close"));
        const modal = document.getElementById("modal");
        if (modal) {
          modal.classList.remove("online-room-r22", "online-room-closing");
          modal.style.pointerEvents = "";
          modal.removeAttribute("aria-busy");
        }
        if (normalized.returnToLobby) run("return-lobby", () => state_online_session.OnlineRuntime.ui.showEntry({
          source: "NETWORK_CLOSE_RETURN"
        }));else run("render", () => {
          if (state_runtime_config.currentGame() && normalized.preserveBattleResult) render();
        });
        lastClose = {
          ok: errors.length === 0,
          repeated: false,
          options: normalized,
          errors,
          battleId,
          timers: TimerManager.stats(),
          locks: state_runtime_input.InputLockManager.snapshot(),
          chat: state_runtime_presentation.ChatEngine.debug(),
          matchmaking: matchmaking.debug()
        };
        return lastClose;
      } finally {
        closing = false;
      }
    };
    const debug = () => ({
      sequence,
      seen: seen.size,
      closing,
      lastClose,
      matchmaking: matchmaking.debug()
    });
    return Object.freeze({
      envelope,
      verify,
      accept,
      send,
      matchmaking,
      closeOnline,
      nextSequence: () => sequence + 1,
      reset,
      debug,
      connection: state_online_connection.OnlineConnectionEngine
    });
  })();
  state_online_sync.SyncEngine = (() => {
    const VERSION = "mega-sync-engine-preventive-r2";
    const PACKETS = Object.freeze({
      REQUEST: "REQUEST_AUTHORITATIVE_RESYNC",
      KICK: "REQUEST_AUTHORITATIVE_RESYNC",
      ACK: "AUTHORITATIVE_RESYNC_ACK",
      APPLIED: "AUTHORITATIVE_RESYNC_APPLIED"
    });
    let activeSync = null,
      resetButtonTimer = 0;
    const button = () => document.getElementById("onlineBattleSyncBtn");
    const setState = (state = "idle", label = "동기화") => {
      const current = button();
      if (!current) return false;
      TimerManager.clear(resetButtonTimer);
      resetButtonTimer = 0;
      current.dataset.state = state;
      current.textContent = label;
      current.title = state === "syncing" ? "공통 온라인 복구 coordinator에 authoritative resync를 요청하는 중" : "공통 온라인 복구 coordinator에 authoritative resync 요청";
      if (state === "ok" || state === "error") resetButtonTimer = TimerManager.setTimeout(() => {
        const live = button();
        if (live) {
          live.dataset.state = "idle";
          live.textContent = "동기화";
        }
      }, state === "ok" ? 1500 : 2200, {
        reason: "sync-button-ui-reset"
      });
      return true;
    };
    const ensureButton = () => {
      const panel = document.getElementById("onlineChatPanel"),
        head = panel?.querySelector(".online-chat-head");
      if (!head) return false;
      let group = head.querySelector(".online-chat-head-actions");
      if (!group) {
        group = document.createElement("div");
        group.className = "online-chat-head-actions";
        const close = head.querySelector("#onlineChatClose");
        if (close) group.appendChild(close);
        head.appendChild(group);
      }
      let current = group.querySelector("#onlineBattleSyncBtn");
      if (!current) {
        current = document.createElement("button");
        current.id = "onlineBattleSyncBtn";
        current.type = "button";
        current.dataset.state = "idle";
        current.textContent = "동기화";
        current.title = "공통 온라인 복구 coordinator에 authoritative resync 요청";
        current.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          request("manual-button");
        });
        group.insertBefore(current, group.firstChild);
      }
      return true;
    };
    const ui = Object.freeze({
      button,
      setState,
      ensureButton
    });
    const request = (reason = "manual") => {
      ui.ensureButton();
      if (!state_runtime_config.currentGame()) {
        ui.setState("error", "전투 없음");
        return false;
      }
      const id = `resync-${Date.now().toString(36)}`;
      activeSync = {
        id,
        reason,
        startedAt: Date.now(),
        completed: false,
        beforeRevision: Number(state_runtime_config.currentGame()?.networkRevision || 0)
      };
      ui.setState("syncing", "동기화 중");
      const accepted = state_online_session.OnlineRuntime.lifecycle.requestAuthoritativeResync(`REQUEST_AUTHORITATIVE_RESYNC:${reason}`);
      if (!accepted) {
        activeSync.completed = true;
        ui.setState("error", "복구 대기");
        return false;
      }
      return true;
    };
    const complete = (ok, detail = "") => {
      if (!activeSync || activeSync.completed) return false;
      activeSync.completed = true;
      activeSync.completedAt = Date.now();
      activeSync.detail = detail;
      ui.setState(ok ? "ok" : "error", ok ? "동기화 완료" : "복구 대기");
      return true;
    };
    const handlePacket = msg => {
      if (!msg || typeof msg !== "object") return false;
      if (msg.type === "megaManualSyncRequestR20" || msg.type === "megaManualSyncKickR20" || msg.type === PACKETS.REQUEST) {
        state_online_session.OnlineRuntime.lifecycle.requestAuthoritativeResync("REQUEST_AUTHORITATIVE_RESYNC:remote-compatible");
        return true;
      }
      if (["authoritativeState", "state", "start"].includes(msg.type) && activeSync && !activeSync.completed) {
        complete(true, "authoritative-projection-applied");
        return true;
      }
      return false;
    };
    const onConnectionOpen = () => {
      if (activeSync && !activeSync.completed) state_online_session.OnlineRuntime.lifecycle.requestAuthoritativeResync("REQUEST_AUTHORITATIVE_RESYNC:binding-ready");
    };
    const onConnectionClose = () => true;
    const applySnapshot = (raw, rules) => {
      const g = state_runtime_snapshots.OnlineSnapshotEngine.restoreState(raw, {
        source: "sync-engine",
        rules
      });
      state_runtime_state.StateValidator.validate(g);
      return g;
    };
    const reset = reason => {
      activeSync = null;
      TimerManager.clear(resetButtonTimer);
      resetButtonTimer = 0;
      const current = button();
      if (current) {
        current.dataset.state = "idle";
        current.textContent = "동기화";
      }
      return reason || "reset";
    };
    const debug = () => ({
      version: VERSION,
      role: state_ui_deck.p2p?.role || null,
      active: activeSync ? {
        ...activeSync
      } : null,
      requestAuthority: "OnlineRuntime.lifecycle.requestAuthoritativeResync",
      directSocketCreate: false,
      directSnapshotApply: false,
      directActionRender: false
    });
    return Object.freeze({
      VERSION,
      PACKETS,
      applySnapshot,
      acceptPacket: state_online_sync.NetworkEngine.accept,
      checksum: object => state_runtime_config.hashText(state_runtime_config.stableText(object)),
      request,
      handlePacket,
      onConnectionOpen,
      onConnectionClose,
      reset,
      debug,
      ui
    });
  })();
}
