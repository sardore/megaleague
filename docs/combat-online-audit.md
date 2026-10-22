# Combat and online presentation audit

Baseline: `08b8b0287303c3dcbeb382667119d88f99f15444`.

## Confirmed defects and corrections

| Area | Reproduced problem | Correction |
| --- | --- | --- |
| Combat context | Damage prediction used the displayed battle's clock suppression instead of its supplied battle. Two battles sharing unit IDs could produce different results for identical input. | Pass the battle through stat, evasion, protection and mitigation calculations. |
| Stat contributions | Stored defense, fragment defense, aroma penalties and Time Protect were evaluated separately; the defense display omitted continuous contributions. | One `combatStats` calculation serves damage and the display. Ignore-stat rules remove changes before applying the defense cap. |
| Attack prediction | `ignoreAttackMod` affected applied damage but not prediction. | Apply this flag in the shared raw-damage calculation. |
| Damage mitigation | Predictions omitted Horizintal's team guard, Angel's eclipse immunity and Aquamarine's full-HP reduction. | Prediction and applied damage use the same mitigation functions. |
| Reliable delivery | Snapshot retries explicitly replaced skill visuals with an empty array. A newer empty snapshot could also supersede an undelivered animation. | Keep unacknowledged visual batches across snapshots and retries. Acknowledge visual identities separately from state revisions. |
| Snapshot fast paths | Same-state, duplicate-revision and local-input-preservation branches skipped incoming visuals. Input preservation could also leave the game's network revision behind the acknowledged revision. | Deliver unseen batches on every admitted snapshot path and update revision metadata without replacing an open local decision. |
| Command resolution | A rejected guest command remained pending when its resolution arrived at an already applied revision. | Settle matching-revision action resolutions and refresh input; older snapshots cannot supersede the current pending command. |
| Clock barrier | Local rendering consumed skill/clock effects before the final authoritative publication. | Publish effects while the clock barrier is pending, preserving the action's single canonical revision. |
| Clock authority | A guest's presentation callback could execute a pending authoritative turn advance. | Guests cannot advance the authoritative clock turn; animation completion handles restored battle objects safely. |
| Coordinates | Remote VFX reused sender pixel coordinates despite opposite perspectives and different viewports. | Tag local coordinate snapshots; capture incoming events against the receiving layout before restoring potentially removed targets. |
| Terminal effects | Replay scheduled only for `IN_BATTLE` could be canceled by the terminal transition; host terminal projection did not drain queued effects. | Dispatch admitted effects directly and drain terminal effects; reliable retries live for the session. |
| Multi-hit effects | Serialization silently truncated every batch after 72 events. | Preserve the entire action batch. |

## Wayli and Timeora

An active Wayli ignores Time Protect's defense increase. A clock alignment suppresses Wayli's trait under the existing clock rules, so ignore-stat behavior stops during that suppression. The older pre-modular implementation also guarded Time Protect with `!statIgnored`; this report alone does not establish that the rule changed during the refactor. The confirmed context and display defects above are fixed without introducing a Wayli-versus-Timeora exception.

## Validation

- `node tools/check-combat-online.js`: real Chromium checks for stat context, all 54 cards (162 reciprocal stat checks), prediction versus damage, display values, visual retries, duplicate state, preserved input, terminal delivery, local coordinates and clock authority.
- `npm test`: session lifetime and visual delivery journal tests, including an overtaking snapshot and distinct visual publications at one revision.
- `node tools/check-runtime.js` with `MEGA_RELAY_SOURCE`: mobile browser tests against the actual relay, including a new two-way skill-render test using different viewport sizes. Existing tests cover action authority, lifecycle suspension, reconnects, scheduled actions, terminal state and a second match.
- Build, static module validation and whitespace checks.

These checks exercise shared combat and online presentation paths. They do not establish that every skill interaction or physical-device/network combination is defect-free.
