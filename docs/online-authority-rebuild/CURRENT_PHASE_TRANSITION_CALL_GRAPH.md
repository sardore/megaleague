# Current phase transition call graph

`OnlineRuntime.StateMachine` is the only runtime lifecycle writer.

```mermaid
stateDiagram-v2
  [*] --> IDLE
  IDLE --> STARTING: session factory
  STARTING --> SIGNALING: relay connect
  SIGNALING --> HOSTING: room hosted
  SIGNALING --> JOINING: room join intent
  SIGNALING --> MATCHMAKING: queue intent
  HOSTING --> HANDSHAKING: peer offer
  JOINING --> HANDSHAKING: peer offer
  MATCHMAKING --> HANDSHAKING: match offer
  HANDSHAKING --> LOBBY: session commit
  LOBBY --> STARTING_BATTLE: start transaction
  STARTING_BATTLE --> IN_BATTLE: start commit/authoritative state
  IN_BATTLE --> ENDING: terminal commit or leave
  RECONNECTING --> ENDING: admitted terminal snapshot
  ENDING --> CLOSED: cleanup complete
  CLOSED --> IDLE: detached setup projection
  LOBBY --> RECONNECTING: binding degradation
  IN_BATTLE --> RECONNECTING: binding degradation
  RECONNECTING --> LOBBY: authoritative lobby restore
  RECONNECTING --> IN_BATTLE: authoritative battle restore
```

Failure edges from active states enter `FAILED`, then cleanup enters `CLOSED`/`IDLE`. `ProjectionTransaction` maps stable runtime state to ENTRY, LOBBY, IN_BATTLE, TERMINAL, or SETUP. `SessionScope.transitionPhase` first cancels prior-phase resources and advances the projection epoch. Visibility changes only ask transport/restore owners to converge; they do not directly transition battle state or render buttons.

Result-to-setup order: canonical winner commit -> host terminal publication -> runtime `ENDING`/TERMINAL projection -> `CleanupCoordinator.close` -> scope close and battle/application releases -> detached SETUP projection -> IDLE.
