import { systems } from "../runtime/systems.js";
export function initializeAppPlatform() {
  (() => {
    "use strict";

    const records = [];
    const record = (error, site = "legacy") => {
      const entry = {
        site: String(site || "legacy"),
        name: String(error?.name || "Error"),
        message: String(error?.message || error || "unknown error"),
        stack: String(error?.stack || ""),
        createdAt: Date.now()
      };
      records.push(entry);
      if (records.length > 500) records.splice(0, records.length - 500);
      if (systems.DEBUG_RECOVERED_ERRORS) console.warn("[RecoveredError]", entry);
      return entry;
    };
    Object.defineProperty(systems, "__megaRecoveredErrors", {
      value: records,
      configurable: false,
      writable: false
    });
    Object.defineProperty(systems, "__megaRecordRecoveredError", {
      value: record,
      configurable: false,
      writable: false
    });
  })();
  (() => {
    "use strict";

    if (systems.TimerManager) return;
    const native = Object.freeze({
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: window.setInterval.bind(window),
      clearInterval: window.clearInterval.bind(window),
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      cancelAnimationFrame: window.cancelAnimationFrame.bind(window)
    });
    const timers = new Map();
    let activeCapture = null;
    const scopeFor = () => systems.GameState?.battleId || systems.game?.battleId || "ui";
    const closedOnlineScope = () => {
      const runtime = systems.OnlineRuntime,
        kind = runtime?.debug?.().kind || null;
      return !!runtime && !!kind && kind !== "spectator" && runtime.sessionScope?.closed === true;
    };
    const fail = (kind, error) => {
      console.error(`[TimerManager:${kind}]`, error);
      queueMicrotask(() => {
        throw error;
      });
    };
    const settleCapture = capture => {
      if (capture?.closed && capture.pending === 0 && !capture.settled) {
        capture.settled = true;
        capture.resolve();
      }
    };
    const finishCapturedTimer = meta => {
      const capture = meta?.capture;
      if (!capture || meta.captureSettled) return;
      meta.captureSettled = true;
      capture.pending = Math.max(0, capture.pending - 1);
      settleCapture(capture);
    };
    const record = (id, kind, options = {}, capture = activeCapture) => {
      const meta = {
        id,
        kind,
        scope: options.scope || scopeFor(),
        reason: options.reason || kind,
        createdAt: Date.now(),
        capture: null,
        captureSettled: false,
        sessionScope: null
      };
      if (capture && kind === "timeout") {
        meta.capture = capture;
        capture.pending++;
      }
      timers.set(id, meta);
      const runtime = systems.OnlineRuntime,
        sessionScope = runtime?.sessionScope,
        runtimeKind = runtime?.debug?.().kind || null;
      if (!options.sessionManaged && runtimeKind !== "spectator" && sessionScope?.adoptTimer?.(id, kind, meta.reason, options.phase)) {
        meta.sessionScope = sessionScope;
      }
      return id;
    };
    const runWithCapture = (capture, fn, args) => {
      const prev = activeCapture;
      activeCapture = capture;
      try {
        return fn(...args);
      } finally {
        activeCapture = prev;
      }
    };
    const timeout = (fn, delay = 0, options = {}) => {
      if (typeof fn !== "function") return native.setTimeout(fn, delay);
      if (!options.sessionManaged && closedOnlineScope()) return 0;
      const capture = activeCapture;
      let id = 0;
      id = native.setTimeout((...args) => {
        const meta = timers.get(id);
        timers.delete(id);
        meta?.sessionScope?.releaseAdoptedTimer?.(id);
        try {
          return capture ? runWithCapture(capture, fn, args) : fn(...args);
        } catch (error) {
          fail("timeout", error);
        } finally {
          finishCapturedTimer(meta);
        }
      }, Math.max(0, Number(delay) || 0));
      return record(id, "timeout", options, capture);
    };
    const interval = (fn, delay = 0, options = {}) => {
      if (typeof fn !== "function") return native.setInterval(fn, delay);
      if (!options.sessionManaged && closedOnlineScope()) return 0;
      const id = native.setInterval((...args) => {
        try {
          fn(...args);
        } catch (error) {
          fail("interval", error);
        }
      }, Math.max(1, Number(delay) || 1));
      return record(id, "interval", options, null);
    };
    const frame = (fn, options = {}) => {
      if (!options.sessionManaged && closedOnlineScope()) return 0;
      let id = 0;
      id = native.requestAnimationFrame(ts => {
        const meta = timers.get(id);
        timers.delete(id);
        meta?.sessionScope?.releaseAdoptedTimer?.(id);
        try {
          fn(ts);
        } catch (error) {
          fail("animation-frame", error);
        }
      });
      return record(id, "animation-frame", options, null);
    };
    const clear = id => {
      const meta = timers.get(id);
      timers.delete(id);
      meta?.sessionScope?.releaseAdoptedTimer?.(id);
      if (meta?.kind === "interval") native.clearInterval(id);else if (meta?.kind === "animation-frame") native.cancelAnimationFrame(id);else {
        native.clearTimeout(id);
        native.clearInterval(id);
        native.cancelAnimationFrame(id);
      }
      finishCapturedTimer(meta);
    };
    const clearScope = scope => {
      for (const [id, meta] of [...timers]) if (meta.scope === scope) clear(id);
    };
    const captureTimeouts = fn => {
      const capture = {
        pending: 0,
        closed: false,
        settled: false,
        resolve: null
      };
      const done = new Promise(resolve => capture.resolve = resolve);
      const prev = activeCapture;
      activeCapture = capture;
      let result;
      try {
        result = fn();
      } finally {
        activeCapture = prev;
        capture.closed = true;
        settleCapture(capture);
      }
      return {
        result,
        done
      };
    };
    const stats = () => {
      const byKind = {},
        byScope = {};
      for (const meta of timers.values()) {
        byKind[meta.kind] = (byKind[meta.kind] || 0) + 1;
        byScope[meta.scope] = (byScope[meta.scope] || 0) + 1;
      }
      return {
        total: timers.size,
        byKind,
        byScope,
        entries: [...timers.values()].map(({
          capture,
          ...x
        }) => ({
          ...x,
          captured: !!capture
        }))
      };
    };
    systems.TimerManager = Object.freeze({
      setTimeout: timeout,
      setInterval: interval,
      requestAnimationFrame: frame,
      clear,
      clearScope,
      clearAll() {
        for (const id of [...timers.keys()]) clear(id);
      },
      captureTimeouts,
      stats,
      native
    });
  })();
}
