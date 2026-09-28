# Quizzes v0.8.1 — release notes

Prepared 28 September 2026. Locally tested; not pushed or deployed by the assistant.

## Focused changes

- Larger live desktop typography at viewport widths >=1000 CSS pixels: question defaults 48px/56px and answers 32px/34px. Fit image/gap space before reducing text. Readability floors are 36px/28px on desktop; oversized content remains scrollable. Compact redundant desktop player spacing to retain normal viewport fit. Existing phone text-fitting branch and phone CSS rules are unchanged.
- First host image prepared in the lobby; immediately next question's image prepared while the current question is running. Browser Image objects are decoded and reattached instead of re-requesting private no-store media.
- New host-only `host_images` WebSocket message and authorized `refresh_images` action. Payloads come from the immutable running-room snapshot. Current/next window only, maximum two distinct cached images; shared images deduplicate. No future image grants in player sync or broadcasts. No solutions added to the protocol.
- Host readiness status, visible loading/error feedback, slow-load retry after 15 seconds and renewed grants on retry. Image readiness never changes server timers/scoring. Already-open memory survives an ordinary socket reconnect; a full page reload necessarily downloads images again.
- Cache entries disposed when no longer needed, at game end, on new launch and on sign-out. No server media caching, public bucket, authorization relaxation, database schema change, dependency change, or paid resource.
- Browser-test runner now treats abnormal termination as failure rather than a successful zero status.

## Final local verification

Node.js 22, isolated SQLite test databases and headless Chromium:

| Check | Result |
| --- | --- |
| Existing API/engine/workspace/import/deployment/migration tests | 41 passed, 0 failed |
| Strict-TLS configuration tests | 5 passed, 0 failed |
| Expanded end-to-end Chromium scenario | 1 passed, 59.8 seconds |
| Production dependency audit | 0 vulnerabilities reported |
| Formatting check on changed JS/CSS/manifests | Passed |

The expanded browser scenario includes:
- First-image lobby preparation; zero additional host image requests at Start for a ready image.
- Deliberately delayed next image, the 15-second slow indicator/retry affordance, and eventual successful preparation.
- Exact same Image DOM object reused on the following question, with no second host download.
- Simulated next-image failure and successful retry; simulated current-image failure after reload and visible Retry image recovery.
- Updating the saved library quiz during play does not change the room's next image.
- Player wire messages never receive future-image paths or `host_images`; player `refresh_images` attempts are rejected.
- Bounded cache, old-entry eviction, identical-image deduplication, round-break readiness, host reload and end cleanup.
- Six-option image questions fit host viewports 1280×720, 1366×768, 1920×1080 and 1024×768; desktop question/answer fonts meet 36px/28px minimums.
- Player phone 390×844, tablet 768×1024 and desktop 1366×768 fit checks; desktop player font minimums checked. Long/high-zoom content remains accessible through scrolling.
- Existing studio/editor, Gujarati rendering, media/audio, host-controlled music, shared leaderboards/final rankings, oversight/deletion, and timed/shuffled self-paced submission/feedback/reload flows still pass in the same scenario.

The working `database-config.js` is unchanged: SHA256 `ddee8cdda3f94e3a87b7cddeb793c11ff53712de112bf849b4d654403c6f1495`. Media-store and workspace persistence code are unchanged. PostgreSQL was tested for v0.8; it was **not rerun for this display/protocol patch**. No authenticated live-site acceptance, real-user-image timing benchmark, Safari/Firefox test, 24-hour soak or hosted 100-device capacity test was performed for v0.8.1. Local emulation is not equivalent to physical-device acceptance.

## Installation

Use [APPLY-v0.8.1-update.md](APPLY-v0.8.1-update.md). Replace the five named runtime/manifest files together, build the new commit and deploy on the same free Northflank service. Leave environment variables, TLS/CA, private media and database untouched.

- `Quizzes-v0.8.1-update.zip`: focused patch for the deployed v0.8 installation, updated docs and browser regression test/runner.
- `Quizzes-deployment.zip`: refreshed full source, including previous v0.8 studio/assignment functionality and the unchanged working TLS configuration.
- Both archives include `SHA256SUMS.txt`; `Quizzes-v0.8.1-SHA256SUMS.txt` contains archive checksums.
- `Quizzes-v0.8.1-desktop.png` and `Quizzes-v0.8.1-phone.png`: screenshots from the local browser regression, not the deployed site.

The previously delivered v0.8 ZIP remains historical. Use the v0.8.1 update for this complaint; do not mix app/server files across versions.
