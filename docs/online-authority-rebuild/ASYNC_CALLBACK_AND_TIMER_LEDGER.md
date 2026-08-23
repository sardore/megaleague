# Async callback and timer ledger

| Resource | Created by | Required scope | Cancellation/invalidation path | Baseline finding |
|---|---|---|---|---|
| pending action resend interval | `OnlineActionAdmissionOwner` | SESSION | admission owner close/settle -> `SessionScope.cancel` | consolidated; no global fallback |
| pending action state probe | `OnlineActionAdmissionOwner` | SESSION | admission owner close/suspend | consolidated; no global fallback |
| authoritative reliable-state resend | P2P reliability route | SESSION | connection/session cleanup | must retain only latest committed revision |
| reconnect open timeout/retry | `TransportOwner` | SESSION | binding retirement/`SessionScope.close` | owned by transport state machine |
| heartbeat/watchdog | `TransportOwner` | SESSION/binding | binding retirement and scope close | owned by binding record |
| restore timeout/probe | `RestoreTransaction`/transport candidate | SESSION | restore completion, binding retirement, scope close | scope identity validated |
| lobby/start publication retries | lobby/start transaction owners | LOBBY | transaction completion/phase transition/scope close | retain only transaction-owned retry |
| start coin presentation removal | start presentation owner | SESSION | timer completion or session application release | crosses LOBBY -> IN_BATTLE intentionally; must not be cancelled as a LOBBY-only resource |
| online automatic action delay | `scheduleAICore` | IN_BATTLE | automatic owner cancel/phase transition/scope close | scope-only while online |
| scheduled action execution delay | combat scheduling | IN_BATTLE | battle/scope cancellation | callback must validate battle/session/action identity |
| battle emote ACK retry | battle emote reliability owner | SESSION | ACK/reset/scope close | scope-only while online |
| battle emote display removal | battle emote presentation owner | IN_BATTLE | timer completion or reliability reset removes the node | `TimerManager` timer is adopted by the active scope; reset removes nodes synchronously |
| online boss intro timers/listeners/promise | boss intro presentation owner | IN_BATTLE | tracked promise cancellation invokes the intro's single `finish` cleanup | listener removal, node removal, timer cancellation and promise settlement share one cleanup function |
| authoritative VFX replay RAF | authoritative state admission | IN_BATTLE | phase transition/scope close | scope-owned and identity guarded |
| animation/VFX promises | animation owners | IN_BATTLE | animation settle + scope phase close; application release clears viewport FX | continuation validates battle/epoch and no presentation node survives cleanup |
| projection request/queued convergence | `ProjectionTransaction`/action convergence | projection epoch | commit-time identity/revision check; queue discard on phase close | projection transaction already drops stale epoch |
| websocket open/data/close/error | connection binding registry/transport | SESSION/binding | detach binding, retire socket, scope close | four callbacks tracked by binding owner |
| window/document visibility/page lifecycle | `LifecycleCoordinator` | SESSION | `SessionScope.listen`/close | lifecycle event requests restore; never mutates game/UI directly |
| chat sync button reset | chat presentation | SESSION/UI | chat reset/session close | global timer should be registered in session scope when online |

Cancellation order is normative: invalidate old scope -> cancel resources/promises -> discard projection work -> release input locks -> detach transport callbacks -> clear battle/application references -> issue a new generation.
