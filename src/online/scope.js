import { TimerManager } from "../runtime/timers.js";
import { sessionRuntime } from "./session-model.js";
import { systems } from "../runtime/systems.js";
export class SessionScope {
  constructor(session) {
    this.session = session;
    this.generation = session.generation;
    this.sessionToken = session.sessionToken || "";
    this.phase = "ENTRY";
    this.projectionEpoch = 1;
    this.invalidated = false;
    this.closed = false;
    this.abortController = new AbortController();
    this.resources = new Map();
    this.promises = new Set();
    this.transactions = new Map();
    this.trace = [];
  }
  capture(label = "callback", phase = this.phase) {
    return Object.freeze({
      generation: this.generation,
      sessionToken: this.session.sessionToken || this.sessionToken || "",
      phase,
      projectionEpoch: this.projectionEpoch,
      label: String(label)
    });
  }
  valid(capture, phase = capture?.phase) {
    const currentToken = String(this.session.sessionToken || this.sessionToken || ""),
      capturedToken = String(capture?.sessionToken || "");
    const tokenOk = capturedToken ? capturedToken === currentToken : !currentToken;
    const phaseOk = !phase || phase === "SESSION" || this.phase === phase;
    const epochOk = phase === "SESSION" || Number(capture?.projectionEpoch || 0) === Number(this.projectionEpoch);
    return !this.invalidated && !this.closed && sessionRuntime.activeSession === this.session && Number(capture?.generation) === Number(this.generation) && tokenOk && phaseOk && epochOk;
  }
  guard(capture, fn) {
    return (...args) => {
      if (!this.valid(capture)) {
        sessionRuntime.counters.staleCallbackDropCount++;
        this.record("stale-callback-dropped", {
          label: capture?.label || null,
          capturedPhase: capture?.phase || null
        });
        return false;
      }
      return fn(...args);
    };
  }
  record(stage, detail = {}) {
    const row = {
      at: Date.now(),
      stage: String(stage),
      generation: this.generation,
      phase: this.phase,
      projectionEpoch: this.projectionEpoch,
      ...detail
    };
    this.trace.push(row);
    if (this.trace.length > 480) this.trace.splice(0, this.trace.length - 320);
    return row;
  }
  setTimeout(fn, delay, label = "session-timeout", options = {}) {
    if (this.invalidated || this.closed) return 0;
    const phase = options.phase || "SESSION",
      capture = this.capture(label, phase);
    let id = 0;
    id = TimerManager.setTimeout(() => {
      this.resources.delete(id);
      this.guard(capture, fn)();
    }, Math.max(0, Number(delay) || 0), {
      scope: `online-session:${this.generation}`,
      reason: label,
      sessionManaged: true,
      phase
    });
    this.resources.set(id, {
      kind: "timeout",
      phase,
      label,
      cancel: () => TimerManager.clear(id)
    });
    return id;
  }
  setInterval(fn, delay, label = "session-interval", options = {}) {
    if (this.invalidated || this.closed) return 0;
    const phase = options.phase || "SESSION",
      capture = this.capture(label, phase);
    const id = TimerManager.setInterval(this.guard(capture, fn), Math.max(16, Number(delay) || 0), {
      scope: `online-session:${this.generation}`,
      reason: label,
      sessionManaged: true,
      phase
    });
    this.resources.set(id, {
      kind: "interval",
      phase,
      label,
      cancel: () => TimerManager.clear(id)
    });
    return id;
  }
  requestAnimationFrame(fn, label = "session-raf", options = {}) {
    if (this.invalidated || this.closed) return 0;
    const phase = options.phase || this.phase,
      capture = this.capture(label, phase);
    const id = TimerManager.requestAnimationFrame(() => {
      this.resources.delete(id);
      this.guard(capture, fn)();
    }, {
      scope: `online-session:${this.generation}`,
      reason: label,
      sessionManaged: true,
      phase
    });
    this.resources.set(id, {
      kind: "raf",
      phase,
      label,
      cancel: () => TimerManager.clear(id)
    });
    return id;
  }
  adoptTimer(id, kind, label = "adopted-timer", phase = this.phase) {
    if (this.invalidated || this.closed || !id || this.resources.has(id)) return false;
    this.resources.set(id, {
      kind: `adopted-${kind}`,
      phase: phase || this.phase,
      label: String(label),
      cancel: () => TimerManager.clear(id)
    });
    return true;
  }
  releaseAdoptedTimer(id) {
    return this.resources.delete(id);
  }
  listen(target, event, fn, options, label = `listener:${event}`) {
    if (!target?.addEventListener) return () => false;
    const capture = this.capture(label, "SESSION"),
      guarded = this.guard(capture, fn);
    target.addEventListener(event, guarded, options);
    const key = {};
    this.resources.set(key, {
      kind: "listener",
      phase: "SESSION",
      label,
      cancel: () => target.removeEventListener(event, guarded, options)
    });
    return () => this.cancelResource(key);
  }
  track(promise, label = "session-promise", options = {}) {
    const phase = options.phase || this.phase,
      capture = this.capture(label, phase),
      record = {
        label,
        phase,
        capture,
        cancel: typeof options.cancel === "function" ? options.cancel : null
      };
    this.promises.add(record);
    return Promise.resolve(promise).then(value => this.valid(capture) ? value : undefined, error => {
      if (this.valid(capture)) throw error;
      return undefined;
    }).finally(() => this.promises.delete(record));
  }
  transaction(kind, data = {}) {
    const id = `${kind}:${this.generation}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      row = {
        id,
        kind,
        state: "OPEN",
        createdAt: Date.now(),
        ...data
      };
    this.transactions.set(kind, row);
    this.record("transaction-open", {
      kind,
      id
    });
    return row;
  }
  completeTransaction(kind, detail = {}) {
    const row = this.transactions.get(kind);
    if (!row) return false;
    Object.assign(row, {
      state: "COMPLETED",
      completedAt: Date.now(),
      ...detail
    });
    this.transactions.delete(kind);
    this.record("transaction-complete", {
      kind,
      id: row.id
    });
    return true;
  }
  cancelResource(key) {
    const row = this.resources.get(key);
    if (!row) return false;
    try {
      row.cancel?.();
    } catch (error) {
      this.record("resource-cancel-failed", {
        kind: row.kind,
        label: row.label,
        error: error?.message || String(error)
      });
      systems.__megaRecordRecoveredError?.(error, `SessionScope.cancelResource:${row.label}`);
    }
    this.resources.delete(key);
    return true;
  }
  cancelPhase(phase, reason = "phase-transition") {
    let count = 0;
    for (const [key, row] of [...this.resources]) if (row.phase === phase) {
      this.cancelResource(key);
      count++;
    }
    for (const row of [...this.promises]) if (row.phase === phase) {
      try {
        row.cancel?.(reason);
      } catch (error) {
        this.record("promise-cancel-failed", {
          label: row.label,
          error: error?.message || String(error)
        });
        systems.__megaRecordRecoveredError?.(error, `SessionScope.cancelPhase:${row.label}`);
      }
      this.promises.delete(row);
      count++;
    }
    this.record("phase-resources-cancelled", {
      phase,
      reason,
      count
    });
    return count;
  }
  transitionPhase(next, reason = "phase-transition") {
    next = String(next || "ENTRY");
    const prior = this.phase;
    if (prior === next) return this.projectionEpoch;
    this.cancelPhase(prior, reason);
    this.phase = next;
    this.projectionEpoch++;
    this.record("phase-transition", {
      from: prior,
      to: next,
      reason
    });
    return this.projectionEpoch;
  }
  invalidate(reason = "scope-invalidate") {
    if (this.invalidated) return false;
    this.invalidated = true;
    this.projectionEpoch++;
    this.record("scope-invalidated", {
      reason
    });
    return true;
  }
  close(reason = "scope-close") {
    if (this.closed) return false;
    this.invalidate(reason);
    this.closed = true;
    for (const key of [...this.resources.keys()]) this.cancelResource(key);
    for (const row of [...this.promises]) {
      try {
        row.cancel?.(reason);
      } catch (error) {
        this.record("promise-close-failed", {
          label: row.label,
          error: error?.message || String(error)
        });
        systems.__megaRecordRecoveredError?.(error, `SessionScope.close:${row.label}`);
      }
    }
    this.promises.clear();
    this.transactions.clear();
    this.abortController.abort(reason);
    this.record("scope-closed", {
      reason
    });
    return true;
  }
  debug() {
    return {
      generation: this.generation,
      phase: this.phase,
      projectionEpoch: this.projectionEpoch,
      invalidated: this.invalidated,
      closed: this.closed,
      resourceCount: this.resources.size,
      promiseCount: this.promises.size,
      transactionCount: this.transactions.size,
      trace: this.trace.slice(-160)
    };
  }
}
