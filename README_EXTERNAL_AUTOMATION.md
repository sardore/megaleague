# CP32 trusted-baseline external automation

Trusted source: `fbbdad911cb6c90a95aaedb9cf66820f41dc2a323e90088a3cb5ee4d407b22a8` (`CP32-ACTIVE-WRAPPER-CUTOVER-R1-20260805T2220KST`), 7,372,055 bytes.

This package never patches the production HTML. It serves the exact candidate bytes over HTTPS, launches two isolated Chromium OS processes with separate user-data directories, uses the public relay, performs actual touch input, and records videos, screenshots, Playwright traces, console/page errors, WebSocket events, diagnostic ZIPs, and a host/guest sequence comparison.

## Repository use

1. Copy this package into the repository root without modifying `trusted/CP32_ACTIVE_WRAPPER_CUTOVER_TRUSTED_BASELINE_20260805T2220KST.html`.
2. Commit the files on a new branch.
3. In GitHub Actions, run **CP32 Trusted Candidate E2E**.
4. Run **CP32 Android Background E2E** separately. Android failure or blocking is not replaced by web success.
5. Deploy the exact trusted HTML only after candidate evidence is reviewed. Then run **CP32 Production Origin E2E**; it fails closed on deployed SHA/build mismatch.

All workflows are manual and never modify or commit the HTML. A first failed attempt remains a failure; there are no retries.

## Evidence

Artifacts are written under `artifacts/preflight`, `candidate_identity`, `host`, `guest`, `pair`, `android`, and `results`. Missing required artifacts cause non-zero workflow exit.

## Dependency note

The assembly sandbox could not resolve the public npm registry. Therefore `package-lock.json` is a checked-in lock skeleton. Each GitHub-hosted run executes `npm install`, records the resolved lock SHA, and uploads it with evidence. Review and commit that resolved lock in the repository before long-term scheduled use.

## Assembly result

GitHub write/workflow access was unavailable in the assembly session, so all three external run counts are 0. This package is pipeline-ready, not player-path-proven.

## One-phone bootstrap packaging contract
This validation payload is installed by `CP32 Bootstrap Install`. The game HTML is never patched by the installer.

Production online URL (exact):
`https://sardore.github.io/megaleague/?relay=wss%3A%2F%2Fcp32-online-relay.onrender.com%2Fonline`

Relay endpoint (exact):
`wss://cp32-online-relay.onrender.com/online`

Candidate URLs are always constructed with `URL`/`URLSearchParams` so the relay query survives additional parameters such as `room`.
Deterministic host/guest player-path gates use the existing room-code UI. Automatic matchmaking is retained as a separate smoke test and must verify that the two automation clients matched each other.
