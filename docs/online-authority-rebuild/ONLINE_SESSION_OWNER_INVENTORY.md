# Online session owner inventory

## Lifecycle failure evidence

Exact-relay Chromium evidence exposed a production cross-phase resource bug after the first consolidation pass: `showOnlineCoinToss` created its removal timer through the ambient `TimerManager` while the session scope was still in LOBBY. Automatic adoption correctly cancelled that LOBBY timer on the IN_BATTLE transition, but the presentation node itself had no cancellation cleanup and remained above the action panel indefinitely. The start presentation now explicitly owns a SESSION-scoped removal timer because its defined lifetime crosses LOBBY -> IN_BATTLE, and application release removes the node synchronously if the session ends first.

Exact-relay run #54 exposed the inverse transport/lifecycle coupling at host publication. A buffered guest command was admitted while host restore had not yet promoted the transport binding; its transaction committed, but the transport-derived `p2p.connected` flag was still false. Buffered host-authority commands are now replayed only after promotion and restore projection readiness. Canonical revision ownership is independently protected from socket availability: the host publication owner advances and stores its reliable snapshot once; the transport owner may only report/send/retry delivery of that immutable revision.

Exact-relay run #56 exposed a missing lifecycle admission after an otherwise correct terminal commit. Host and guest both held the same winner/revision, but both action completion paths requested the active-battle projector; that projector rejected the terminal state and no caller entered `OnlineRuntime.markBattleEnded`. Terminal facts are now admitted only at the two authority boundaries: host after terminal publication and guest after an authoritative snapshot is accepted. Both delegate to `markBattleEnded`, which accepts `IN_BATTLE` or `RECONNECTING`, cancels an open restore transaction, performs one state-machine transition without implicit projection, cancels battle-phase resources, and commits one TERMINAL projection. Result presentation is consequently a projection only; it cannot transition the runtime or create canonical terminal state.

| Fact/domain | Baseline owner(s) | Writers | Conflict/gap | Canonical owner after rebuild |
|---|---|---|---|---|
| session identity/generation/token | `OnlineRuntime` active session | runtime session factory/cleanup | none found | `OnlineRuntime` |
| match identity | `OnlineRuntime`, `p2p.matchId`, `game.matchId`, room code fallbacks | commit, start and snapshot paths | fallback identity can mask missing commit | runtime committed match identity; game stores snapshot identity only |
| runtime phase | `OnlineRuntime.StateMachine` plus `p2p.battleStarted` and game phase | runtime, start handlers, authoritative recovery | legacy flags participate in input decisions | runtime state machine; battle phase remains game fact |
| lobby deck/ready | `LobbyEngine` plus legacy `p2p` fields and DOM | lobby mutations and packet handlers | derived UI and legacy transport fields overlap | `LobbyEngine` immutable canonical view |
| battle turn/actor | game order/turn plus derived `StateFactory` fields | `TurnEngine`/canonical action | none permitted outside action/turn transaction | canonical game transaction |
| pending local command | global `onlinePendingCommand` plus `p2p.pendingActionId` plus summon `q.submitState` | multiple action paths | three writers for one fact | `OnlineActionAdmissionOwner` session state |
| authoritative revision | global `onlineAuthoritativeRevision`, game revision, `p2p.lastAuthoritativeRevision` | publication and remote apply | values are role-specific but are read as fallbacks | host publication revision / guest admitted revision, exposed in one immutable admission view |
| transport binding/reconnect | `OnlineRuntime.TransportOwner` and legacy p2p flags | runtime and connection adapters | input view still reads both | `OnlineRuntime.TransportOwner` view |
| result state | canonical `game.winner` plus runtime ENDING/TERMINAL | combat transaction, host publication, remote snapshot admission, lifecycle | run #56 had no caller from terminal commit to lifecycle | canonical transaction winner -> host publication/remote admission -> `OnlineRuntime.markBattleEnded` -> one TERMINAL projection |
| projection | `ProjectionTransaction`, lobby projection, action convergence | multiple domain projectors | allowed only beneath one transaction | `ProjectionTransaction` delegates phase-specific DOM projection |
| cleanup scope | `SessionScope`, `CleanupCoordinator`, battle clear helpers | runtime cleanup | several online timers retain global fallback | `SessionScope.close` followed by explicit battle/application release in `CleanupCoordinator` |
| modal ownership | global modal close and `UIControllerRuntime.closeOwnedModal` | battle and online lobby surfaces | ownership is encoded by `online-room-r22` | canonical surface ownership marker; battle modal close never tears down runtime |

The relay remains transport-only. It neither validates combat commands nor mutates game/session state.
