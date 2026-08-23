# Online DOM mutation caller ledger

| Surface | Direct DOM writer(s) | Canonical input | May mutate canonical state? | Decision |
|---|---|---|---|---|
| action title/hint/buttons | `ActionRenderEngine`, `ActionPanelConvergenceOwner`, registered render routes | `ActionPanelViewModelOwner` immutable view | no | one action-panel convergence commit |
| target/payment/gather/summon modal | interaction draft handlers | immutable action draft plus canonical read | no; only final callback submits command | modal close is interaction cancellation only |
| online lobby modal | `LobbyEngine.acquireSurface/project`, `UIControllerRuntime` | `LobbyEngine` canonical view | no | online surface owns modal marker |
| runtime status/room identity | `ProjectionTransaction.projectStatusDom` | runtime immutable snapshot | no | projection transaction only |
| navigation/setup/result | `ProjectionTransaction` | runtime phase + canonical result | no | one phase projection transaction |
| battle board/log | battle renderer invoked by projection/action presentation | canonical game view | no | presentation only |
| input inert/ARIA lock | `InputLockManager` | lock ledger | no | sole input-lock DOM owner |
| battle emote nodes | battle emote presentation owner | admitted emote event | no | exactly-once ID set and session-scoped removal |
| sync/chat controls | chat/snapshot presentation owner | restore coordinator state | no | must not synthesize game/lifecycle state |

Forbidden DOM-to-state reads include button existence, selected CSS classes, modal open state, status text, and rendered actor labels. They may only be used to drive a user interaction in tests, never to decide canonical state.
