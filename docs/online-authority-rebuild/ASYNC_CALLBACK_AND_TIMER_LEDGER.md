# Async callback and timer ledger

| Resource | Created by | Required scope | Cancellation/invalidation path | Baseline finding |
|---|---|---|---|---|
| pending action resend interval | pending command helpers | SESSION | admission owner close/settle -> `SessionScope.cancel` | global timer and `TimerManager` fallback duplicate ownership |
| pending action state probe | `startOnlineStateProbeLoop` | SESSION | session close/suspend | global timer; owner must move into admission owner |
| authoritative reliable-state resend | P2P reliability route | SESSION | connection/session cleanup | must retain only latest committed revision |
| reconnect open timeout/retry | `TransportOwner` | SESSION | binding retirement/`SessionScope.close` | owned by transport state machine |
| heartbeat/watchdog | `TransportOwner` | SESSION/binding | binding retirement and scope close | owned by binding record |
| restore timeout/probe | `RestoreTransaction`/transport candidate | SESSION | restore completion, binding retirement, scope close | scope identity validated |
| lobby/start publication retries | lobby/start transaction owners | LOBBY | transaction completion/phase transition/scope close | retain only transaction-owned retry |
| online automatic action delay | `scheduleAICore` | IN_BATTLE | automatic owner cancel/phase transition/scope close | currently has global timer fallback; remove fallback |
| scheduled action execution delay | combat scheduling | IN_BATTLE | battle/scope cancellation | callback must validate battle/session/action identity |
| battle emote ACK retry | battle emote reliability owner | SESSION | ACK/reset/scope close | currently has global timer fallback; remove fallback |
| battle emote display removal | presentation owner | IN_BATTLE | scope close or node removal | currently global timer; register with session scope for online battle |
| authoritative VFX replay RAF | authoritative state admission | IN_BATTLE | phase transition/scope close | scope-owned and identity guarded |
| animation/VFX promises | animation owners | IN_BATTLE | animation settle + scope phase close | continuation must validate battle/epoch |
| projection request/queued convergence | `ProjectionTransaction`/action convergence | projection epoch | commit-time identity/revision check; queue discard on phase close | projection transaction already drops stale epoch |
| websocket open/data/close/error | connection binding registry/transport | SESSION/binding | detach binding, retire socket, scope close | four callbacks tracked by binding owner |
| window/document visibility/page lifecycle | `LifecycleCoordinator` | SESSION | `SessionScope.listen`/close | lifecycle event requests restore; never mutates game/UI directly |
| chat sync button reset | chat presentation | SESSION/UI | chat reset/session close | global timer should be registered in session scope when online |

Cancellation order is normative: invalidate old scope -> cancel resources/promises -> discard projection work -> release input locks -> detach transport callbacks -> clear battle/application references -> issue a new generation.
