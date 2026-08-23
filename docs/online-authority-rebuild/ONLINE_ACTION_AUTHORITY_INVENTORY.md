# Online action authority inventory

Baseline: game `8e2b812969dc2bf647d6990f9c93d6be665b6ec7`; relay `e6b97f0e63298d0766fc179bcfe76e80c2df44eb` (`cp32-online-relay-v1`).

## Root-cause evidence

The committed `CP32_FIRST_ACTION_REJECT_DIAGNOSTIC.json` is a **HARNESS FAILURE**, not evidence of a rejected transaction. Its click opened Timeora's mandatory gather decision modal, but the probe never selected `timeGatherKeep` or `timeGatherReroll`. The recorded audit is empty, `pendingTransaction` is null, and `turnSerial` is unchanged because `execute()` and `ActionTransactionManager.begin()` were never reached.

The primary **PRODUCTION RUNTIME FAILURE** is a script-scope ownership break. `execute()` was declared in the main script and attempted `typeof actionTransactionExecuteStage === "function"`. `actionTransactionExecuteStage` was declared only inside the later `coreArchitectureR48` IIFE and was never exported. The lookup was therefore always undefined in the browser, so every live action bypassed `ActionTransactionManager.begin`, transaction audit, duplicate admission, rollback, input-lock ownership, and canonical commit. The permanently empty audit in the first-action evidence is the expected observable result of this call graph.

The source audit nevertheless proves a **PRODUCTION RUNTIME AUTHORITY FAILURE**. A standard guest action enters `execute()`, then `EnergyCanonicalizationEngine.execute()`, then the Timeora and combat support layers. Only inside `executeSupportLayer()` is it converted into an `actionRequest`. `EnergyCanonicalizationEngine` treats the successful request enqueue as successful action execution and can append/normalize Timeora energy locally before any host commit. The guest therefore has a canonical game writer before admission. Manual summon submission has the same defect: it writes `q.submitState` and `q.submittedAction` before host admission.

The rebuild exposes the actual executor as `CanonicalActionTransactionOwner.execute`, makes `execute()` enter `OnlineActionAdmissionOwner` unconditionally, and removes the inaccessible name lookup rather than adding another fallback.

## Baseline owners and capabilities

| Owner/function | Reads | Writes | May reject | May retry | May mutate game | May mutate DOM | Cleanup owner | Consolidation decision |
|---|---|---|---|---|---|---|---|---|
| `playerGather` and choice modal handlers | actor, capability, energy | pending UI choice | yes, by abandoning choice | no | no until choice commit | yes | modal owner | retain as input drafting only |
| `execute` pipeline composer | action and engine globals | none directly | propagates | no | invokes mutators | no | caller transaction | admission must become its outermost live stage |
| `executeSupportLayer` | role, `applyingRemoteAction`, pending command, combat state | pending command and combat state | yes | starts retry indirectly | yes | calls action projection indirectly | mixed | remove all network admission; keep canonical combat validation only |
| `timeExecuteLayerBody` | role, `applyingRemoteAction`, Timeora state | Timeora canonical state | yes | no | yes | no | action transaction | remove duplicate network classification |
| `EnergyCanonicalizationEngine.execute` | Timeora energy/action/result | energy store normalization | yes | no | yes | no | action transaction | run only after admission |
| `classifyR48Execution` / `isBossGuestRequestOnlyExecution` | role, side, boss ownership | none | controls transaction bypass | no | controls writer access | no | none | delete; classification belongs to admission owner |
| `actionTransactionExecuteStage` | execution classification and game state | pending transaction, event log, game state | yes | no | yes; rollback restores snapshot | locks only through lock owner | `ActionTransactionManager` + `InputLockManager` | rename to canonical transaction executor and remove network knowledge |
| `ActionTransactionManager` | battle/action identity | `pendingTransaction`, `pendingAction`, phase, committed/failed sets | duplicate reject | no | yes; rollback restores snapshot | no | `clearBattle` | retain as only canonical combat transaction owner |
| `InputLockManager` | action/session/revision, legacy clock flags | lock map, inert/ARIA, busy via clock | blocks input | no | no | yes | `releaseBattle` and session cleanup | retain lock ownership; pending comes from admission view only |
| pending command helpers (`begin`, `send`, `reconcile`, `stop`, `suspend`) | role/transport/revision/turn | global pending, retry timer, `p2p.pendingActionId`, `busy` | duplicate pending reject | yes | no, except indirect render | calls action projection | split globals + `SessionScope` fallback | replace with one session-scoped `OnlineActionAdmissionOwner` |
| `handleOnlineActionRequest` | match, role, expected turn/team/slot | `p2p.applyingRemoteAction`, command cache, game via execute | yes | receives duplicates | yes | indirectly | host result cache not session scoped | move into admission owner receive path |
| `sendAuthoritativeOnlineState` | host game and visual queue | `onlineAuthoritativeRevision`, game revision, reliable packet | yes if not connected/host | reliable state owner retries | revision only | no | online session cleanup | retain as sole host revision/publication owner |
| `applyAuthoritativeOnlineState` | envelope, role, match/revision | guest game snapshot, applied revision, pending settlement | yes stale/mismatch | state probe elsewhere | yes, snapshot replacement only | requests projection | `SessionScope` | retain as sole remote snapshot admission owner; pending settlement delegated to admission owner |
| `submitManualSummonAction` | queue, role, revision | guest queue submission state and host game | yes | starts command retry | yes | requests action projection | mixed | route request/authority through admission owner; guest queue becomes immutable view |
| `afterAction` / `sendAuthoritativeOnlineState` | committed action result and visuals | revision/publication | no after commit | reliable publication | revision | render/projection request | session | publication occurs once after successful canonical transaction |
| `ActionPanelViewModelOwner` | canonical game + eligibility view | immutable view only | no | no | no | no | none | retain |
| `ActionPanelConvergenceOwner` | immutable action view | DOM only | stale/signature drop | queued render only | no | yes | projection epoch/session | retain as sole action-panel DOM projection owner |

## Required single path

`UI draft -> OnlineActionAdmissionOwner.submit -> (guest: pending command only | host/local: canonical transaction) -> executeCanonicalActionTransaction -> game mutation -> turnSerial -> host revision/publication -> remote envelope admission -> ProjectionTransaction -> ActionPanelConvergenceOwner`

No energy, Timeora, summon, combat, transaction, or projection layer may independently classify a live action as host/guest/request/remote.
