import { sessionRuntime } from "./session-model.js";
export class SessionStateMachine {
  constructor(generation) {
    this.generation = generation;
    this.state = "IDLE";
    this.changedAt = Date.now();
  }
  transition(next, reason = "", options = {}) {
    if (!sessionRuntime.STATES.includes(next)) throw new Error(`UNKNOWN_ONLINE_STATE:${next}`);
    const spectatorSidecar = sessionRuntime.activeSession?.kind === "spectator";
    if (next === this.state) {
      if (!spectatorSidecar && options.project !== false) sessionRuntime.ProjectionTransaction.request(`state-stable:${next}`, {
        phase: sessionRuntime.phaseForState(next)
      });
      return this.state;
    }
    if (!sessionRuntime.ALLOWED[this.state]?.has(next)) throw new Error(`INVALID_ONLINE_TRANSITION:${this.state}->${next}`);
    const prior = this.state;
    this.state = next;
    this.changedAt = Date.now();
    sessionRuntime.transitionTrace.push({
      generation: this.generation,
      from: prior,
      to: next,
      reason: sessionRuntime.clean(reason, 200),
      at: this.changedAt
    });
    if (sessionRuntime.transitionTrace.length > 240) sessionRuntime.transitionTrace.splice(0, sessionRuntime.transitionTrace.length - 160);
    // A standalone spectator relay is transport-only. Never let it own app navigation/projection.
    if (spectatorSidecar) {
      sessionRuntime.activeSession?.scope?.record?.("spectator-sidecar-state", {
        from: prior,
        to: next,
        reason: sessionRuntime.clean(reason, 200)
      });
      return next;
    }
    const phase = sessionRuntime.phaseForState(next);
    sessionRuntime.activeSession?.scope?.transitionPhase?.(phase, `state:${prior}->${next}:${reason}`);
    if (options.project !== false) sessionRuntime.ProjectionTransaction.request(`state:${prior}->${next}`, {
      phase
    });
    return next;
  }
}
export function projectBattlePacket(session, payload) {
  if (!session || !payload || typeof payload !== "object") return;
  if (["start"].includes(payload.type) && ["LOBBY", "STARTING_BATTLE"].includes(session.machine.state)) {
    if (session.machine.state === "LOBBY") session.machine.transition("STARTING_BATTLE", `packet:${payload.type}`);
    session.machine.transition("IN_BATTLE", `packet:${payload.type}`);
    session.resumeState = "IN_BATTLE";
  }
  if (["onlineResult", "surrender"].includes(payload.type) && session.machine.state === "IN_BATTLE") session.machine.transition("ENDING", `packet:${payload.type}`);
}
