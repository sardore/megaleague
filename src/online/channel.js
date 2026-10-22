import { systems } from "../runtime/systems.js";
import { projectBattlePacket } from "./session-machine.js";
import { sessionRuntime } from "./session-model.js";
export class RelayDataConnection {
  constructor(runtimeSession) {
    this.session = runtimeSession;
    this.peer = runtimeSession.remotePlayerId || "relay-peer";
    this.metadata = {
      kind: "cp32-relay",
      mode: runtimeSession.mode,
      matchId: runtimeSession.matchId
    };
    this.open = false;
    this._closed = false;
    this._listeners = new Map(["open", "data", "close", "error"].map(name => [name, new Set()]));
  }
  on(type, handler) {
    if (typeof handler === "function") (this._listeners.get(type) || this._listeners.set(type, new Set()).get(type)).add(handler);
    return this;
  }
  off(type, handler) {
    this._listeners.get(type)?.delete(handler);
    return this;
  }
  removeListener(type, handler) {
    return this.off(type, handler);
  }
  _emit(type, payload) {
    for (const handler of [...(this._listeners.get(type) || [])]) try {
      handler(payload);
    } catch (error) {
      systems.__megaRecordRecoveredError?.(error, `OnlineRuntime.connection.${type}`);
    }
  }
  _setOpen(open, emit = true) {
    if (this._closed) return false;
    const changed = this.open !== !!open;
    this.open = !!open;
    if (changed && this.open && emit) this._emit("open");
    return changed;
  }
  _receive(payload) {
    const restoring = this.session?.transport?.candidateBinding?.state === "RESTORING";
    if (!this._closed && (this.open || restoring)) {
      if (!["start", "onlineResult", "surrender"].includes(payload?.type)) projectBattlePacket(this.session, payload);
      this._emit("data", payload);
    }
  }
  _closeFromRuntime(reason = "closed") {
    if (this._closed) return false;
    this._closed = true;
    this.open = false;
    this._emit("close", reason);
    return true;
  }
  send(payload) {
    if (this._closed || !this.open) throw Object.assign(new Error("relay connection is not open"), {
      type: "network",
      code: "CONNECTION_NOT_OPEN"
    });
    if (!["start", "onlineResult", "surrender"].includes(payload?.type)) projectBattlePacket(this.session, payload);
    return this.session.transport.sendPayload(payload);
  }
  close() {
    if (this._closed) return false;
    if (sessionRuntime.runtimeClosing) return this._closeFromRuntime("runtime-close");
    return sessionRuntime.CleanupCoordinator.close("connection-close", {
      notify: true
    });
  }
}
