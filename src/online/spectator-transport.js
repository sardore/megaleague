import { sessionRuntime } from "./session-model.js";
import { beginSession } from "./cleanup.js";
import { systems } from "../runtime/systems.js";
export function initializeOnlineSpectatorTransport() {
  sessionRuntime.SpectatorCoordinator = (() => {
    const callbacks = new Map(["announce", "watch", "snapshot", "leave", "chat"].map(name => [name, null]));
    let lastBrowsePacket = null;
    const actionForName = name => /Ann/i.test(name) ? "announce" : /Req/i.test(name) ? "watch" : /Snap/i.test(name) ? "snapshot" : /Leave/i.test(name) ? "leave" : /Chat/i.test(name) ? "chat" : sessionRuntime.clean(name, 40).toLowerCase();
    const send = (action, data = {}, options = {}) => {
      const session = sessionRuntime.activeSession;
      if (!session?.transport?.ready) return false;
      const normalized = action === "watch" && data?.type === "browse" ? "browse" : action === "watch" ? "watch" : action;
      if (normalized === "browse") lastBrowsePacket = {
        data: {
          ...data
        },
        options: {
          ...options
        }
      };
      return session.transport.system({
        type: "spectator.action",
        action: normalized,
        matchId: sessionRuntime.clean(data?.matchId || session.matchId, 180) || null,
        targetId: sessionRuntime.clean(options?.target, 180) || null,
        payload: data && typeof data === "object" ? data : {}
      });
    };
    const makeAction = name => {
      const action = actionForName(name);
      const handle = {
        send: (data, options) => send(action, data, options)
      };
      Object.defineProperty(handle, "onMessage", {
        get: () => callbacks.get(action),
        set: handler => callbacks.set(action, typeof handler === "function" ? handler : null),
        enumerable: true
      });
      return handle;
    };
    const facade = Object.freeze({
      name: "Relay",
      get selfId() {
        return sessionRuntime.playerId;
      },
      room: Object.freeze({
        makeAction,
        leave: () => close()
      }),
      announce: makeAction("spAnn18"),
      request: makeAction("spReq18"),
      snapshot: makeAction("spSnap18"),
      leave: makeAction("spLeave18"),
      chat: makeAction("spChat20")
    });
    async function ensureHub() {
      if (!sessionRuntime.activeSession || ["IDLE", "CLOSED", "FAILED"].includes(sessionRuntime.activeSession.machine.state)) {
        const started = beginSession({
          kind: "spectator",
          mode: "SPECTATOR",
          context: {
            spectator: true
          }
        });
        if (!started) return null;
      }
      const session = sessionRuntime.activeSession;
      if (!session.transport?.ready) {
        const ready = await Promise.race([session.relayReadyPromise, new Promise(resolve => systems.TimerManager.setTimeout(() => resolve(false), 10_000))]);
        if (!ready) return null;
      }
      return facade;
    }
    function receive(packet) {
      const action = sessionRuntime.clean(packet?.action, 40);
      const callback = callbacks.get(action);
      if (!callback) return false;
      try {
        callback(packet.payload || {}, {
          peerId: packet.fromId || null
        });
        return true;
      } catch (error) {
        systems.__megaRecordRecoveredError?.(error, `OnlineRuntime.spectator.${action}`);
        return false;
      }
    }
    function replayIntent() {
      if (lastBrowsePacket) send("watch", lastBrowsePacket.data, lastBrowsePacket.options);
      return true;
    }
    function close() {
      lastBrowsePacket = null;
      for (const action of callbacks.keys()) callbacks.set(action, null);
      if (sessionRuntime.activeSession?.kind === "spectator") return sessionRuntime.CleanupCoordinator.close("spectator-close", {
        notify: false
      });
      return true;
    }
    return Object.freeze({
      ensureHub,
      receive,
      replayIntent,
      close,
      send,
      debug: () => ({
        active: !!sessionRuntime.activeSession?.transport?.ready,
        standalone: sessionRuntime.activeSession?.kind === "spectator",
        lastBrowse: !!lastBrowsePacket
      })
    });
  })();
}
