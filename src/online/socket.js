import { state_runtime_config } from "../runtime/config.js";
import { state_ui_action_panel } from "../ui/action-panel.js";
import { sessionRuntime } from "./session-model.js";
import { resetPrecommitOfferForReconnect } from "./matching.js";
import { state_ui_deck } from "../ui/deck.js";
import { dispatchIntent, restoreCommittedSession } from "./commit.js";
import { systems } from "../runtime/systems.js";
import { state_online_lobby } from "./lobby.js";
import { failSession } from "./cleanup.js";
export class TransportAdapter {
  constructor(session, endpoint) {
    this.session = session;
    this.endpoint = endpoint;
    this.socket = null;
    this.socketSerial = 0;
    this.intentional = false;
    this.ready = false;
    this.connecting = false;
    this.reconnectAttempt = 0;
    this.maxReconnectAttempts = 20;
    this.timers = new Set();
    this.heartbeatTimer = 0;
    this.retryTimer = 0;
    this.openTimer = 0;
    this.listenerCount = 0;
    this.outboundSequence = 0;
    this.lastAckSequence = 0;
    this.lastReceivedRelaySequence = 0;
    this.activeBinding = null;
    this.candidateBinding = null;
    this.bindings = new Map();
    this.bindingTrace = [];
    this.recoveryTrace = [];
    this.staleDropTrace = [];
    this.recoverySamples = [];
  }
  trace(stage, binding = null, detail = {}) {
    const entry = {
      stage: String(stage),
      at: Date.now(),
      bindingId: binding?.id || null,
      bindingState: binding?.state || null,
      socketSerial: Number(binding?.serial || this.socketSerial || 0),
      sessionGeneration: this.session.generation,
      sessionState: this.session.machine.state,
      revision: Number(state_runtime_config.currentGame()?.networkRevision || 0),
      renderedRevision: Number(state_ui_action_panel.ActionRenderEngine?.snapshot?.()?.lastRender?.networkRevision || 0),
      ...detail
    };
    this.bindingTrace.push(entry);
    if (this.bindingTrace.length > 640) this.bindingTrace.splice(0, this.bindingTrace.length - 400);
    if (/degrad|retir|reconnect|socket-open|restore|promot|ready/.test(stage)) {
      this.recoveryTrace.push(entry);
      if (this.recoveryTrace.length > 480) this.recoveryTrace.splice(0, this.recoveryTrace.length - 320);
    }
    return entry;
  }
  transition(binding, state, detail = {}) {
    if (!binding || binding.state === state) return false;
    const prior = binding.state;
    binding.state = state;
    binding.changedAt = Date.now();
    this.trace(`binding:${prior}->${state}`, binding, detail);
    return true;
  }
  makeBinding(socket, serial, reason) {
    const binding = {
      id: `binding:${this.session.generation}:${serial}`,
      serial,
      socket,
      state: "CONNECTING",
      reason: String(reason || "connect"),
      createdAt: Date.now(),
      changedAt: Date.now(),
      serverConnectionId: null,
      restoreRequestId: null,
      restoreRequestAttempt: 0,
      restoreRequestRetryTimerId: 0,
      restoreCommit: null,
      restoreBuffer: [],
      sequenceFloor: Number(this.lastReceivedRelaySequence || 0),
      timers: new Set(),
      retired: false,
      retiredAt: 0,
      retireReason: "",
      lastInboundAt: 0,
      lastOutboundAt: 0,
      serverHeartbeatMs: 10000,
      reconnectGraceMs: 180000,
      heartbeatSentAt: 0,
      heartbeatAckAt: 0,
      heartbeatOutstandingAt: 0,
      heartbeatDeadlineTimerId: 0,
      suspectAt: 0,
      degradedAt: 0,
      promotedAt: 0,
      restoreTimeoutId: 0
    };
    this.bindings.set(binding.id, binding);
    this.trace("binding-created", binding, {
      reason
    });
    return binding;
  }
  current(binding, {
    allowCandidate = true
  } = {}) {
    const ok = !!binding && !binding.retired && sessionRuntime.activeSession === this.session && !this.intentional && this.session.generation === sessionRuntime.generationSerial && (binding === this.activeBinding || allowCandidate && binding === this.candidateBinding);
    if (!ok) {
      sessionRuntime.counters.staleCallbackDropCount++;
      sessionRuntime.counters.retiredBindingMessageDropCount++;
      this.staleDropTrace.push({
        at: Date.now(),
        bindingId: binding?.id || null,
        state: binding?.state || null,
        activeBindingId: this.activeBinding?.id || null,
        candidateBindingId: this.candidateBinding?.id || null
      });
      if (this.staleDropTrace.length > 320) this.staleDropTrace.splice(0, this.staleDropTrace.length - 200);
    }
    return ok;
  }
  setTimer(handler, delay, binding = null, label = "timer") {
    const id = this.session.scope.setTimeout(() => {
      this.timers.delete(id);
      binding?.timers?.delete(id);
      handler();
    }, delay, `transport:${label}`, {
      phase: "SESSION"
    });
    this.timers.add(id);
    binding?.timers?.add(id);
    return id;
  }
  clearTimer(id, binding = null) {
    if (!id) return false;
    this.session.scope.cancelResource(id);
    this.timers.delete(id);
    binding?.timers?.delete(id);
    return true;
  }
  clearHeartbeatDeadline(binding, echo = 0) {
    if (!binding) return false;
    const outstanding = Number(binding.heartbeatOutstandingAt || 0);
    if (echo && outstanding && Number(echo) !== outstanding) return false;
    const had = !!binding.heartbeatDeadlineTimerId || !!outstanding;
    this.clearTimer(binding.heartbeatDeadlineTimerId, binding);
    binding.heartbeatDeadlineTimerId = 0;
    binding.heartbeatOutstandingAt = 0;
    return had;
  }
  pauseHeartbeat(binding = this.activeBinding, reason = "paused") {
    if (this.heartbeatTimer) this.session.scope.cancelResource(this.heartbeatTimer);
    this.heartbeatTimer = 0;
    this.clearHeartbeatDeadline(binding);
    if (binding) this.trace("heartbeat-paused", binding, {
      reason
    });
    return true;
  }
  clearBindingTimers(binding) {
    for (const id of binding?.timers || []) this.clearTimer(id, binding);
    binding?.timers?.clear?.();
    if (binding) {
      binding.heartbeatDeadlineTimerId = 0;
      binding.heartbeatOutstandingAt = 0;
    }
  }
  clearTimers() {
    for (const id of [...this.timers]) this.session.scope.cancelResource(id);
    this.timers.clear();
    if (this.heartbeatTimer) this.session.scope.cancelResource(this.heartbeatTimer);
    this.heartbeatTimer = 0;
    this.retryTimer = this.openTimer = 0;
    for (const b of this.bindings.values()) b.timers?.clear?.();
  }
  sendOn(binding, packet) {
    if (!binding?.socket || binding.socket.readyState !== WebSocket.OPEN || binding.retired) {
      return false;
    }
    try {
      binding.lastOutboundAt = Date.now();
      const wire = JSON.stringify({
        protocol: sessionRuntime.PROTOCOL,
        playerId: sessionRuntime.playerId,
        sessionGeneration: this.session.generation,
        clientBindingId: binding.id,
        ...packet
      });
      binding.socket.send(wire);
      return true;
    } catch (error) {
      this.trace("socket-send-failed", binding, {
        type: String(packet?.type || "unknown"),
        message: error?.message || String(error)
      });
      return false;
    }
  }
  system(packet) {
    const binding = this.activeBinding?.state === "READY" ? this.activeBinding : this.candidateBinding;
    return this.sendOn(binding, packet);
  }
  retire(binding, reason = "retired", code = 4001) {
    if (!binding || binding.retired) return false;
    if (this.activeBinding === binding) this.pauseHeartbeat(binding, `retire:${reason}`);
    binding.retired = true;
    binding.retiredAt = Date.now();
    binding.retireReason = String(reason);
    this.transition(binding, "RETIRED", {
      reason
    });
    this.clearBindingTimers(binding);
    const socket = binding.socket;
    binding.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try {
        if (socket.readyState < 2) socket.close(code, reason.slice(0, 120));
      } catch {}
    }
    if (this.activeBinding === binding) this.activeBinding = null;
    if (this.candidateBinding === binding) this.candidateBinding = null;
    if (this.socket === socket) this.socket = null;
    this.bindings.delete(binding.id);
    this.listenerCount = this.activeBinding || this.candidateBinding ? 4 : 0;
    return true;
  }
  isolate(binding, reason = "degraded") {
    if (!binding || binding.retired) return false;
    if (["ENDING", "CLOSED", "FAILED"].includes(this.session.machine.state)) {
      this.trace("terminal-isolation-suppressed", binding, {
        reason,
        state: this.session.machine.state
      });
      this.retire(binding, `terminal:${reason}`, 1000);
      return false;
    }
    if (!this.session.committed) resetPrecommitOfferForReconnect(this.session, reason);
    binding.degradedAt = Date.now();
    this.transition(binding, "DEGRADED", {
      reason
    });
    this.trace("degradation-detected", binding, {
      reason
    });
    this.ready = false;
    this.connecting = false;
    this.session.routesReady = false;
    if (state_ui_deck.p2p) {
      state_ui_deck.p2p.connected = false;
      state_ui_deck.p2p.reconnecting = true;
      state_ui_deck.p2p.connectionInterrupted = true;
    }
    if (this.session.connection) this.session.connection._setOpen(false, false);
    this.session.resumeState = ["LOBBY", "IN_BATTLE"].includes(this.session.machine.state) ? this.session.machine.state : this.session.resumeState;
    if (this.session.machine.state !== "RECONNECTING") try {
      this.session.machine.transition("RECONNECTING", reason);
    } catch {}
    if (state_runtime_config.currentGame()) state_ui_action_panel.ActionPanelConvergenceOwner?.request?.(`transport-isolated:${reason}`, {
      force: false,
      networkRevision: Number(state_runtime_config.currentGame()?.networkRevision || 0)
    });
    this.retire(binding, `degraded:${reason}`, 4002);
    this.trace("old-binding-retired", binding, {
      reason
    });
    return this.scheduleReconnect(reason);
  }
  markSuspect(binding, reason = "health-suspect") {
    if (["ENDING", "CLOSED", "FAILED"].includes(this.session.machine.state)) {
      this.trace("terminal-suspect-suppressed", binding, {
        reason,
        state: this.session.machine.state
      });
      return false;
    }
    if (!this.current(binding) || binding.state !== "READY") return false;
    if (!binding.suspectAt) {
      binding.suspectAt = Date.now();
      this.transition(binding, "SUSPECT", {
        reason
      });
      this.trace("binding-suspect", binding, {
        reason
      });
    }
    this.ready = false;
    this.session.routesReady = false;
    this.pauseHeartbeat(binding, `suspect:${reason}`);
    if (this.session.connection) this.session.connection._setOpen(false, false);
    if (state_ui_deck.p2p) {
      state_ui_deck.p2p.connected = false;
      state_ui_deck.p2p.reconnecting = true;
      state_ui_deck.p2p.connectionInterrupted = true;
    }
    if (state_runtime_config.currentGame()) state_ui_action_panel.ActionPanelConvergenceOwner?.request?.(`transport-suspect:${reason}`, {
      force: false,
      networkRevision: Number(state_runtime_config.currentGame()?.networkRevision || 0)
    });
    return this.beginRestore(binding, `suspect:${reason}`);
  }
  markHealthy(binding, reason = "inbound") {
    if (!binding || binding.retired) return false;
    binding.lastInboundAt = Date.now();
    this.trace("binding-inbound", binding, {
      reason
    });
    return true;
  }
  connect(reason = "start") {
    if (this.intentional) return false;
    if (["ENDING", "CLOSED", "FAILED"].includes(this.session.machine.state)) {
      this.trace("terminal-connect-suppressed", null, {
        reason,
        state: this.session.machine.state
      });
      return false;
    }
    if (this.candidateBinding && !this.candidateBinding.retired) {
      sessionRuntime.counters.duplicateSocketCount++;
      sessionRuntime.counters.duplicateReconnectLoopCount++;
      this.trace("duplicate-connect-suppressed", this.candidateBinding, {
        reason
      });
      return false;
    }
    if (this.connecting) {
      sessionRuntime.counters.duplicateReconnectLoopCount++;
      return false;
    }
    if (this.activeBinding && !this.activeBinding.retired) this.retire(this.activeBinding, `superseded:${reason}`, 4001);
    this.connecting = true;
    this.ready = false;
    const serial = ++this.socketSerial;
    const reconnecting = this.reconnectAttempt > 0 || !!this.session.sessionToken;
    if (reconnecting && this.session.machine.state !== "RECONNECTING") {
      this.session.resumeState = ["LOBBY", "IN_BATTLE"].includes(this.session.machine.state) ? this.session.machine.state : this.session.resumeState;
      sessionRuntime.RestoreTransaction.begin(this.session, null, reason);
      this.session.machine.transition("RECONNECTING", reason);
    } else if (!reconnecting && this.session.machine.state === "STARTING") this.session.machine.transition("SIGNALING", reason);
    let socket;
    try {
      socket = new WebSocket(this.endpoint);
    } catch (error) {
      this.connecting = false;
      this.fail("SIGNALING_CREATE_FAILED", error?.message || error);
      return false;
    }
    const binding = this.makeBinding(socket, serial, reason);
    this.candidateBinding = binding;
    this.socket = socket;
    this.listenerCount = 4;
    this.openTimer = this.setTimer(() => {
      if (!this.current(binding) || socket.readyState === WebSocket.OPEN) return;
      this.trace("socket-open-timeout", binding);
      this.isolate(binding, "open-timeout");
    }, sessionRuntime.RELAY_OPEN_TIMEOUT_MS, binding, "open-timeout");
    socket.onopen = () => {
      if (!this.current(binding)) {
        try {
          socket.close(4001, "stale");
        } catch {}
        return;
      }
      this.connecting = false;
      this.clearTimer(this.openTimer, binding);
      this.openTimer = 0;
      this.transition(binding, "OPEN", {
        reason
      });
      this.trace("socket-open", binding);
      this.sendOn(binding, {
        type: "relay.hello",
        runtimeVersion: sessionRuntime.VERSION
      });
    };
    socket.onmessage = event => {
      if (!this.current(binding)) return;
      binding.lastInboundAt = Date.now();
      let packet;
      try {
        packet = JSON.parse(event.data);
      } catch (error) {
        sessionRuntime.recordError("INVALID_RELAY_JSON", error?.message || error);
        return;
      }
      sessionRuntime.MessageRouter.receive(packet, binding);
    };
    socket.onerror = () => {
      if (!this.current(binding)) return;
      sessionRuntime.recordError("SIGNALING_NETWORK", "relay WebSocket network error", {
        attempt: this.reconnectAttempt,
        bindingId: binding.id
      });
      if (binding.state === "READY") this.markSuspect(binding, "socket-error");
    };
    socket.onclose = event => {
      if (!this.current(binding)) return;
      this.connecting = false;
      this.ready = false;
      this.clearTimer(this.openTimer, binding);
      this.openTimer = 0;
      this.listenerCount = 0;
      if (this.session.connection) this.session.connection._setOpen(false, false);
      if (state_ui_deck.p2p) state_ui_deck.p2p.connected = false;
      if (!this.intentional) this.isolate(binding, `socket-close-${event.code}`);
    };
    return true;
  }
  startHeartbeat(binding = this.activeBinding) {
    this.pauseHeartbeat(binding, "heartbeat-restart");
    if (!binding || binding.state !== "READY") return false;
    const serverHeartbeatMs = Math.max(4000, Math.min(30000, Number(binding.serverHeartbeatMs || 10000))),
      periodMs = Math.max(3000, Math.round(serverHeartbeatMs * .6)),
      deadlineMs = Math.max(5000, Math.round(serverHeartbeatMs * .9));
    if (document.visibilityState === "hidden") {
      this.trace("heartbeat-deferred-hidden", binding, {
        serverHeartbeatMs,
        periodMs,
        deadlineMs
      });
      return true;
    }
    const tick = () => {
      if (!this.current(binding) || binding.state !== "READY") return;
      if (document.visibilityState === "hidden") {
        this.pauseHeartbeat(binding, "document-hidden");
        return;
      }
      if (binding.heartbeatOutstandingAt) return;
      const sentAt = Date.now();
      binding.heartbeatSentAt = sentAt;
      const sent = this.sendOn(binding, {
        type: "heartbeat",
        at: sentAt
      });
      if (!sent) {
        this.markSuspect(binding, "heartbeat-send-failed");
        return;
      }
      binding.heartbeatOutstandingAt = sentAt;
      binding.heartbeatDeadlineTimerId = this.setTimer(() => {
        binding.heartbeatDeadlineTimerId = 0;
        if (this.current(binding, {
          allowCandidate: false
        }) && binding.state === "READY" && binding.heartbeatOutstandingAt === sentAt) this.markSuspect(binding, "heartbeat-unacknowledged");
      }, deadlineMs, binding, "heartbeat-deadline");
    };
    tick();
    if (!this.current(binding, {
      allowCandidate: false
    }) || binding.state !== "READY") return false;
    this.heartbeatTimer = this.session.scope.setInterval(tick, periodMs, "transport-heartbeat", {
      phase: "SESSION"
    });
    this.trace("heartbeat-started", binding, {
      serverHeartbeatMs,
      periodMs,
      deadlineMs
    });
    return true;
  }
  scheduleReconnect(reason) {
    if (this.intentional) return false;
    if (["ENDING", "CLOSED", "FAILED"].includes(this.session.machine.state)) {
      this.trace("terminal-reconnect-suppressed", null, {
        reason,
        state: this.session.machine.state
      });
      return false;
    }
    if (this.retryTimer) {
      sessionRuntime.counters.duplicateReconnectLoopCount++;
      this.trace("duplicate-reconnect-suppressed", null, {
        reason
      });
      return false;
    }
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.fail("RECONNECT_EXHAUSTED", `bounded reconnect exhausted after ${this.reconnectAttempt} attempts`);
      return false;
    }
    this.reconnectAttempt++;
    sessionRuntime.counters.reconnectCount++;
    if (this.session.machine.state !== "RECONNECTING") {
      this.session.resumeState = ["LOBBY", "IN_BATTLE"].includes(this.session.machine.state) ? this.session.machine.state : this.session.resumeState;
      this.session.machine.transition("RECONNECTING", reason);
    }
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const base = 350,
      jitter = bytes[0] % 251,
      delay = Math.min(8000, base * 2 ** Math.min(5, this.reconnectAttempt - 1)) + jitter;
    this.trace("reconnect-scheduled", null, {
      reason,
      attempt: this.reconnectAttempt,
      delay
    });
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = 0;
      this.connect(`retry-${this.reconnectAttempt}`);
    }, delay, null, "reconnect");
    return true;
  }
  reconnectNow(reason = "manual-health") {
    if (this.intentional) return false;
    if (["ENDING", "CLOSED", "FAILED"].includes(this.session.machine.state)) {
      this.trace("terminal-reconnect-now-suppressed", null, {
        reason,
        state: this.session.machine.state
      });
      return false;
    }
    this.clearTimer(this.retryTimer);
    this.retryTimer = 0;
    const binding = this.activeBinding;
    if (binding?.state === "READY") {
      this.markSuspect(binding, reason);
      return this.isolate(binding, reason);
    }
    if (this.candidateBinding && !this.candidateBinding.retired) {
      sessionRuntime.counters.duplicateReconnectLoopCount++;
      return false;
    }
    return this.connect(reason);
  }
  sendRestoreRequest(binding, reason = "authoritative-restore") {
    const currentBinding = this.current(binding),
      stateOk = binding?.state === "RESTORING",
      requestOk = !!binding?.restoreRequestId,
      commitPending = !binding?.restoreCommit;
    this.trace("restore-request-dispatch-check", binding, {
      reason,
      currentBinding,
      stateOk,
      requestOk,
      commitPending,
      activeSessionMatch: sessionRuntime.activeSession === this.session,
      generationMatch: this.session.generation === sessionRuntime.generationSerial,
      candidateMatch: binding === this.candidateBinding
    });
    if (!currentBinding || !stateOk || !requestOk || !commitPending) return false;
    binding.restoreRequestAttempt = Number(binding.restoreRequestAttempt || 0) + 1;
    let sent = false,
      sendError = null;
    try {
      sent = this.sendOn(binding, {
        type: "session.resume",
        sessionToken: this.session.sessionToken,
        lastRelaySequence: binding.sequenceFloor,
        restoreRequestId: binding.restoreRequestId,
        expectedMatchId: this.session.matchId || null,
        expectedRoomCode: this.session.roomCode || null
      });
    } catch (error) {
      sendError = String(error?.message || error);
      sessionRuntime.recordError("RESTORE_REQUEST_SEND_EXCEPTION", sendError, {
        bindingId: binding.id,
        attempt: binding.restoreRequestAttempt
      });
    }
    this.trace("restore-request-sent", binding, {
      reason,
      restoreRequestId: binding.restoreRequestId,
      attempt: binding.restoreRequestAttempt,
      sent,
      sendError
    });
    this.clearTimer(binding.restoreRequestRetryTimerId, binding);
    binding.restoreRequestRetryTimerId = 0;
    if (binding.restoreRequestAttempt < 4) {
      const delay = [0, 650, 1400, 2600][binding.restoreRequestAttempt] || 2600;
      binding.restoreRequestRetryTimerId = this.setTimer(() => {
        binding.restoreRequestRetryTimerId = 0;
        if (this.current(binding) && binding.state === "RESTORING" && !binding.restoreCommit) this.sendRestoreRequest(binding, reason);
      }, delay, binding, "restore-request-retry");
    } else if (!sent && !binding.restoreCommit) {
      return this.isolate(binding, `restore-send-failed:${reason}`);
    }
    return sent;
  }
  beginRestore(binding, reason = "authoritative-restore") {
    if (["ENDING", "CLOSED", "FAILED"].includes(this.session.machine.state)) {
      this.trace("terminal-restore-suppressed", binding, {
        reason,
        state: this.session.machine.state
      });
      return false;
    }
    if (!this.current(binding) || !this.session.sessionToken) return false;
    if (binding.state === "RESTORING" && binding.restoreRequestId) return true;
    this.pauseHeartbeat(binding, `restore:${reason}`);
    if (this.activeBinding === binding) this.activeBinding = null;
    this.candidateBinding = binding;
    this.ready = false;
    this.connecting = false;
    this.session.routesReady = false;
    if (this.session.connection) this.session.connection._setOpen(false, false);
    if (state_ui_deck.p2p) {
      state_ui_deck.p2p.connected = false;
      state_ui_deck.p2p.reconnecting = true;
      state_ui_deck.p2p.connectionInterrupted = true;
    }
    this.session.resumeState = ["LOBBY", "IN_BATTLE"].includes(this.session.machine.state) ? this.session.machine.state : this.session.resumeState;
    sessionRuntime.RestoreTransaction.begin(this.session, binding, reason);
    if (this.session.machine.state !== "RECONNECTING") try {
      this.session.machine.transition("RECONNECTING", reason);
    } catch {}
    binding.restoreRequestId = sessionRuntime.randomToken("restore");
    binding.restoreRequestAttempt = 0;
    this.clearTimer(binding.restoreRequestRetryTimerId, binding);
    binding.restoreRequestRetryTimerId = 0;
    binding.sequenceFloor = Number(this.lastReceivedRelaySequence || 0);
    binding.restoreBuffer = [];
    binding.restoreCommit = null;
    binding.restoreSnapshot = null;
    this.transition(binding, "RESTORING", {
      reason,
      restoreRequestId: binding.restoreRequestId,
      sequenceFloor: binding.sequenceFloor
    });
    this.trace("restore-request", binding, {
      reason,
      restoreRequestId: binding.restoreRequestId,
      sequenceFloor: binding.sequenceFloor
    });
    this.clearTimer(binding.restoreTimeoutId, binding);
    binding.restoreTimeoutId = this.setTimer(() => {
      if (this.current(binding) && binding.state === "RESTORING") this.isolate(binding, `restore-timeout:${reason}`);
    }, 7000, binding, "restore-timeout");
    const sent = this.sendRestoreRequest(binding, reason);
    if (state_runtime_config.currentGame()) state_ui_action_panel.ActionPanelConvergenceOwner?.suspend?.(`restore-lock:${reason}`);
    return sent;
  }
  acknowledgeHeartbeat(binding, packet = {}) {
    if (!binding || binding.retired || !this.current(binding)) return false;
    const echo = Number(packet.echo || 0);
    binding.heartbeatAckAt = Date.now();
    this.markHealthy(binding, "heartbeat-ack");
    this.clearHeartbeatDeadline(binding, echo);
    return true;
  }
  requestAuthoritativeResync(reason = "REQUEST_AUTHORITATIVE_RESYNC") {
    if (!this.session.committed || !this.session.sessionToken) {
      this.trace("authoritative-resync-precommit-suppressed", this.activeBinding || this.candidateBinding, {
        reason
      });
      return false;
    }
    if (this.activeBinding?.state === "READY" && this.activeBinding.socket?.readyState === WebSocket.OPEN) return this.beginRestore(this.activeBinding, `authoritative-resume:${reason}`);
    if (this.candidateBinding?.state === "RESTORING") return true;
    const binding = this.activeBinding || this.candidateBinding;
    sessionRuntime.RestoreTransaction.begin(this.session, binding, reason);
    this.trace("authoritative-resync-requested", binding, {
      reason
    });
    if (binding && ["READY", "SUSPECT", "RESTORING"].includes(binding.state)) return this.beginRestore(binding, `resync:${reason}`);
    return this.reconnectNow(`resync:${reason}`);
  }
  beginRelayReady(binding, packet) {
    if (binding !== this.candidateBinding || binding.retired) return false;
    binding.serverConnectionId = packet.connectionId || null;
    binding.serverHeartbeatMs = Math.max(4000, Math.min(30000, Number(packet.heartbeatMs || 10000)));
    binding.reconnectGraceMs = Math.max(10000, Number(packet.reconnectGraceMs || 180000));
    this.trace("relay-ready", binding, {
      serverConnectionId: binding.serverConnectionId,
      serverHeartbeatMs: binding.serverHeartbeatMs,
      reconnectGraceMs: binding.reconnectGraceMs
    });
    if (this.session.sessionToken) return this.beginRestore(binding, "relay-ready-resume");
    this.transition(binding, "SIGNALING_READY");
    this.ready = true;
    this.reconnectAttempt = 0;
    this.session.resolveRelayReady?.(true);
    this.session.resolveRelayReady = null;
    return dispatchIntent(this.session);
  }
  admit(packet, binding, bypass = false) {
    if (bypass) return "ACCEPT";
    if (!this.current(binding)) return "DROP";
    const system = new Set(["relay.ready", "session.commit", "session.restore-snapshot", "session.restore-complete", "session.failed", "heartbeat.ack", "session.health", "relay.ack", "session.ended", "session.left"]);
    if (binding === this.candidateBinding && binding.state === "RESTORING" && !system.has(packet.type)) {
      binding.restoreBuffer.push(packet);
      this.trace("restore-buffered", binding, {
        type: packet.type,
        relaySequence: Number(packet.relaySequence || 0)
      });
      return "BUFFER";
    }
    if (binding === this.activeBinding && binding.state !== "READY" && binding.state !== "SUSPECT" && !system.has(packet.type)) return "DROP";
    return "ACCEPT";
  }
  storeResumeCommit(binding, packet, routePacket) {
    if (binding !== this.candidateBinding || binding.state !== "RESTORING") return false;
    if (packet.restoreRequestId && packet.restoreRequestId !== binding.restoreRequestId) return false;
    const identityOk = String(packet.sessionToken || "") === String(this.session.sessionToken || "") && String(packet.matchId || "") === String(this.session.matchId || "") && String(packet.role || this.session.role || "") === String(this.session.role || "") && (!this.session.roomCode || !packet.roomCode || String(packet.roomCode) === String(this.session.roomCode));
    if (!identityOk) {
      sessionRuntime.counters.restorePromotionFailureCount++;
      this.trace("restore-failed", binding, {
        reason: "resume-commit-identity-mismatch"
      });
      return this.isolate(binding, "resume-commit-identity-mismatch");
    }
    const normalized = {
      ...packet,
      restoreRequestId: packet.restoreRequestId || binding.restoreRequestId,
      latestRelaySequence: Number(packet.latestRelaySequence || this.lastReceivedRelaySequence || 0),
      latestAuthoritativeRevision: Number(packet.latestAuthoritativeRevision || 0)
    };
    binding.restoreCommit = normalized;
    this.clearTimer(binding.restoreRequestRetryTimerId, binding);
    binding.restoreRequestRetryTimerId = 0;
    this.trace("restore-ack", binding, {
      restoreRequestId: normalized.restoreRequestId,
      relayOmittedRestoreRequestId: !packet.restoreRequestId,
      attempts: Number(binding.restoreRequestAttempt || 0)
    });
    Promise.resolve().then(() => this.completeRestore(binding, {
      ...normalized,
      compatibilityCompletion: "RESUMED_SESSION_COMMIT"
    }, routePacket)).catch(error => {
      systems.__megaRecordRecoveredError?.(error, "OnlineRuntime.restore.resumeCommitCompatibility");
      this.isolate(binding, "restore-resume-commit-exception");
    });
    return true;
  }
  storeRestoreSnapshot(binding, packet) {
    if (binding !== this.candidateBinding || binding.state !== "RESTORING") return false;
    binding.restoreSnapshot = packet;
    this.trace("restore-snapshot-received", binding, {
      relaySequence: Number(packet.packet?.relaySequence || 0)
    });
    return true;
  }
  async stateSha256(text) {
    const bytes = new TextEncoder().encode(String(text || "")),
      digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  async completeRestore(binding, packet, routePacket) {
    if (binding === this.activeBinding && binding.state === "READY" && binding.lastCompletedRestoreRequestId && String(packet.restoreRequestId || "") === String(binding.lastCompletedRestoreRequestId)) {
      this.trace("restore-complete-duplicate", binding, {
        restoreRequestId: packet.restoreRequestId || null
      });
      return true;
    }
    if (binding !== this.candidateBinding || binding.state !== "RESTORING" || binding.retired) return false;
    const commit = binding.restoreCommit;
    if (!commit || String(packet.restoreRequestId || "") !== String(binding.restoreRequestId || "")) {
      sessionRuntime.counters.restorePromotionFailureCount++;
      this.trace("restore-failed", binding, {
        reason: "missing-or-mismatched-ack"
      });
      return this.isolate(binding, "restore-ack-mismatch");
    }
    const identityOk = String(packet.sessionToken || "") === String(this.session.sessionToken || "") && String(packet.matchId || "") === String(this.session.matchId || "") && String(packet.role || "") === String(this.session.role || commit.role || "") && (!this.session.roomCode || String(packet.roomCode || "") === String(this.session.roomCode));
    if (!identityOk) {
      sessionRuntime.counters.restorePromotionFailureCount++;
      this.trace("restore-failed", binding, {
        reason: "identity-mismatch"
      });
      return this.isolate(binding, "restore-identity-mismatch");
    }
    const snapshotPacket = binding.restoreSnapshot?.packet || packet.latestAuthoritativePacket || null;
    if (snapshotPacket?.payload?.state && packet.latestAuthoritativeStateChecksum) {
      const got = await this.stateSha256(snapshotPacket.payload.state);
      if (got !== packet.latestAuthoritativeStateChecksum) {
        sessionRuntime.counters.restorePromotionFailureCount++;
        this.trace("restore-failed", binding, {
          reason: "digest-mismatch",
          expected: packet.latestAuthoritativeStateChecksum,
          actual: got
        });
        return this.isolate(binding, "restore-digest-mismatch");
      }
      this.trace("digest-matched", binding, {
        checksum: got
      });
    }
    const normalizeRestoreEnvelope = item => {
      const routed = item?.type === "session.restore-snapshot" ? item.packet : item;
      if (!routed) return null;
      if (routed.type === "relay.message" && routed.protocol !== sessionRuntime.PROTOCOL) return {
        ...routed,
        protocol: sessionRuntime.PROTOCOL
      };
      return routed;
    };
    const buffered = [...binding.restoreBuffer];
    if (snapshotPacket) buffered.push(snapshotPacket);
    const unique = new Map();
    for (const item of buffered) {
      const routed = normalizeRestoreEnvelope(item);
      if (!routed) continue;
      const key = `${routed.type}:${Number(routed.relaySequence || 0)}:${routed.payload?.type || ""}`;
      const prior = unique.get(key);
      if (!prior || prior.protocol !== sessionRuntime.PROTOCOL || routed.protocol === sessionRuntime.PROTOCOL) unique.set(key, routed);
    }
    const ordered = [...unique.values()].sort((a, b) => Number(a.relaySequence || 0) - Number(b.relaySequence || 0));
    // A restored host is the canonical mutation owner. Its queued peer commands must not be
    // admitted until the binding is promoted and authoritative publication is available.
    // Guests may apply the host's immutable state tail before promotion so revision validation
    // can complete; they never execute canonical peer commands from that tail.
    const deferAuthorityCommands = this.session.role === "host";
    if (!deferAuthorityCommands) for (const routed of ordered) routePacket(routed, binding, true);
    const localRevision = Math.max(Number(state_runtime_config.currentGame()?.networkRevision || 0), Number(state_ui_deck.p2p?.lastAuthoritativeRevision || 0), Number(state_online_lobby.LobbyEngine.debug().revision || 0));
    if (Number(packet.latestAuthoritativeRevision || 0) > localRevision) {
      sessionRuntime.counters.restorePromotionFailureCount++;
      this.trace("restore-failed", binding, {
        reason: "revision-not-reached",
        expected: Number(packet.latestAuthoritativeRevision || 0),
        actual: localRevision
      });
      return this.isolate(binding, "restore-revision-not-reached");
    }
    this.trace("canonical-revision-reached", binding, {
      revision: localRevision
    });
    binding.lastCompletedRestoreRequestId = binding.restoreRequestId;
    this.promote(binding, "restore-complete", packet);
    restoreCommittedSession(this.session, commit, {
      deferPromotion: true
    });
    const projected = sessionRuntime.RestoreTransaction.transportReady(this.session, binding, {
      canonicalRevision: localRevision,
      latestRelaySequence: Number(packet.latestRelaySequence || 0)
    });
    if (deferAuthorityCommands && this.session.routesReady) for (const routed of ordered) routePacket(routed, binding, true);
    binding.restoreBuffer = [];
    this.lastReceivedRelaySequence = Math.max(this.lastReceivedRelaySequence, Number(packet.latestRelaySequence || 0));
    const finalRevision = Math.max(Number(state_runtime_config.currentGame()?.networkRevision || 0), Number(state_ui_deck.p2p?.lastAuthoritativeRevision || 0), localRevision);
    this.trace("event-tail-completed", binding, {
      replayed: ordered.length,
      deferredUntilAuthorityReady: deferAuthorityCommands,
      latestRelaySequence: Number(packet.latestRelaySequence || 0),
      finalRevision
    });
    this.trace("ready-presentation-converged", binding, {
      coherent: projected !== false,
      awaitingAuthoritative: projected === false,
      canonicalRevision: finalRevision,
      projectionEpoch: Number(this.session.scope?.projectionEpoch || 0)
    });
    return projected !== false || this.session.scope?.transactions?.has?.("restore");
  }
  promote(binding, reason = "ready", packet = {}) {
    if (!binding || binding.retired || binding !== this.candidateBinding) return false;
    if (this.activeBinding && this.activeBinding !== binding) this.retire(this.activeBinding, "promotion-replaced", 4001);
    this.clearTimer(binding.restoreTimeoutId, binding);
    binding.restoreTimeoutId = 0;
    this.activeBinding = binding;
    this.candidateBinding = null;
    this.socket = binding.socket;
    binding.promotedAt = Date.now();
    binding.suspectAt = 0;
    this.transition(binding, "READY", {
      reason
    });
    this.ready = true;
    this.connecting = false;
    this.reconnectAttempt = 0;
    this.listenerCount = 4;
    if (this.session.connection) this.session.connection._setOpen(true, false);
    if (state_ui_deck.p2p) {
      state_ui_deck.p2p.connected = true;
      state_ui_deck.p2p.reconnecting = false;
      state_ui_deck.p2p.connectionInterrupted = false;
    }
    this.startHeartbeat(binding);
    this.trace("ready-promoted", binding, {
      reason,
      latestRelaySequence: Number(packet.latestRelaySequence || this.lastReceivedRelaySequence || 0)
    });
    const start = this.recoveryTrace.findLast?.(entry => entry.stage === "degradation-detected" || entry.stage === "reconnect-scheduled");
    if (start) {
      const duration = Date.now() - start.at;
      this.recoverySamples.push({
        reason,
        duration,
        startedAt: start.at,
        readyAt: Date.now()
      });
      if (this.recoverySamples.length > 100) this.recoverySamples.shift();
    }
    return true;
  }
  promoteInitial(binding, reason = "initial-commit") {
    if (binding !== this.candidateBinding) return false;
    this.promote(binding, reason, {});
    this.session.resolveRelayReady?.(true);
    this.session.resolveRelayReady = null;
    return true;
  }
  sendControlPayload(payload) {
    if (!this.ready || this.activeBinding?.state !== "READY" || !this.session.sessionToken) throw Object.assign(new Error("relay control channel unavailable"), {
      code: "SESSION_CONTROL_NOT_READY"
    });
    const clientMessageId = `${this.session.generation}:control:${++this.outboundSequence}`;
    return this.sendOn(this.activeBinding, {
      type: "relay.message",
      sessionToken: this.session.sessionToken,
      matchId: this.session.matchId,
      clientMessageId,
      payload
    });
  }
  sendPayload(payload) {
    if (!this.ready || this.activeBinding?.state !== "READY" || !this.session.sessionToken || !this.session.routesReady) throw Object.assign(new Error("relay session unavailable"), {
      code: "SESSION_NOT_READY"
    });
    const clientMessageId = `${this.session.generation}:${++this.outboundSequence}`;
    return this.sendOn(this.activeBinding, {
      type: "relay.message",
      sessionToken: this.session.sessionToken,
      matchId: this.session.matchId,
      clientMessageId,
      payload
    });
  }
  fail(code, detail) {
    failSession(code, detail);
  }
  close(notify = true, reason = "closed") {
    if (this.intentional) return false;
    this.intentional = true;
    if (notify && this.ready) this.system({
      type: "session.leave",
      sessionToken: this.session.sessionToken || null,
      reason
    });
    this.clearTimers();
    this.ready = false;
    this.connecting = false;
    this.listenerCount = 0;
    for (const binding of [...this.bindings.values()]) this.retire(binding, reason, 1000);
    this.activeBinding = this.candidateBinding = null;
    this.socket = null;
    this.socketSerial++;
    return true;
  }
  debug() {
    const active = this.activeBinding,
      candidate = this.candidateBinding;
    return {
      type: "native-websocket-relay",
      endpoint: this.endpoint,
      signalingState: (active?.socket || candidate?.socket)?.readyState ?? WebSocket.CLOSED,
      dataConnectionState: this.session.connection?.open ? "open" : "closed",
      reconnectAttempt: this.reconnectAttempt,
      timerCount: this.timers.size + (this.heartbeatTimer ? 1 : 0),
      listenerCount: this.listenerCount,
      ready: this.ready,
      intentional: this.intentional,
      outboundSequence: this.outboundSequence,
      lastAckSequence: this.lastAckSequence,
      lastReceivedRelaySequence: this.lastReceivedRelaySequence,
      activeBindingId: active?.id || null,
      activeBindingState: active?.state || null,
      candidateBindingId: candidate?.id || null,
      candidateBindingState: candidate?.state || null,
      activeBindingCount: active && !active.retired ? 1 : 0,
      bindingCount: this.bindings.size,
      duplicateSocketCount: sessionRuntime.counters.duplicateSocketCount,
      duplicateReconnectLoopCount: sessionRuntime.counters.duplicateReconnectLoopCount,
      retiredBindingMessageDropCount: sessionRuntime.counters.retiredBindingMessageDropCount,
      bindingTrace: this.bindingTrace.slice(-120),
      recoveryTrace: this.recoveryTrace.slice(-120),
      staleDropTrace: this.staleDropTrace.slice(-80),
      recoverySamples: this.recoverySamples.slice(-40)
    };
  }
}
