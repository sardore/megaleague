# State authority matrix

| Fact | Canonical owner | Allowed readers | Forbidden writers |
|---|---|---|---|
| session ID/generation/token | `OnlineRuntime` | transport, lobby, admission, projection | DOM, combat engine, retry callbacks |
| committed match ID | `OnlineRuntime` commit | game snapshot, protocol envelopes, admission | room UI, reconnect timers, action engine |
| runtime lifecycle phase | `OnlineRuntime.StateMachine` | projection, transport, input eligibility | modal handlers, combat projection |
| lobby deck and ready | `LobbyEngine` | lobby packet encoder and projection | DOM, transport binding, battle engine |
| battle turn/actor | canonical game transaction/`TurnEngine` | admission validation and immutable views | DOM, guest input, reconnect owner |
| local command pending | `OnlineActionAdmissionOwner` | input eligibility and action view | `p2p`, game summon queue, DOM |
| action ID | admission owner for command; transaction owner after admission | protocol, audit, snapshot publication | UI renderers and retry timers |
| canonical game mutation | `ActionTransactionManager` transaction executing admitted combat action | serializers and view owners | guest request path, projection, transport callbacks from stale epoch |
| turn serial | `TurnEngine` inside canonical transaction | admission, snapshot, projection | retry/reconnect/UI |
| host authoritative revision | `sendAuthoritativeOnlineState` publication owner | snapshot encoder, diagnostics, reliable delivery owner | combat sublayers, projection, transport availability/connection flags |
| guest admitted revision | authoritative envelope admission | immutable view/projection/input | DOM, retry task, host command handler |
| transport binding | `OnlineRuntime.TransportOwner` | protocol send/control paths | game engine and DOM |
| reconnect state | `OnlineRuntime` state machine/restore transaction | input availability/projection | action engine, visibility UI handlers |
| result | canonical terminal game commit | lifecycle/result projection | transport/retry/modal close |
| DOM action panel | `ActionPanelConvergenceOwner` under projection | user input only | combat/session/transport mutation during render |
| shared modal ownership | active surface owner marker | close dispatcher | generic modal close assuming online teardown |
| async lifetime | active `SessionScope` | owning session component | global fallback timers for session work |
