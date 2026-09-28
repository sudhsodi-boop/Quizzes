# Quizzes v0.7.0

## Changes

- Professionalized system-font typography with larger workspace controls and labels.
- Full-width live host question screen; removed score sidebar and all host live/final leaderboard rendering. Joined/answered activity and host controls are retained.
- Player leaderboard is an exclusive screen, including reconnects, automatic round-end display and manual show/hide.
- Adaptive question/option/image sizing, full-screen control, resize/image-load updates, and readable overflow fallback for unusually long content/high zoom. Content is not clipped.
- Immediate correct-answer/points feedback after each self-paced submission or skip, with an explicit Next step.
- Completed-attempt participant rankings after finishing, with nickname/score only, personal row highlighting, shared ranks for ties and periodic/manual refresh.
- All existing/new self-paced publications use the new feedback policy; no per-host toggle and no schema migration.
- Unsubmitted solutions remain withheld while open. Answer immutability, attempt cookie rules, host isolation/oversight, deadline extensions, media access, scoring, deletion, backups and linked audio are retained.
- Database CA/TLS normalization remains unchanged from the successful Northflank fix.

## Verification

Executed locally under Node 22.23.3:

- Node SQLite suite: **40/40 passed**.
- PostgreSQL 17 suite: **40/40 passed**, integration tests with the mock remote media adapter; no hosted Supabase credentials used.
- TLS certificate/configuration tests: **5/5 passed**.
- Chromium end-to-end scenario: **1/1 passed**, covering editing/imports, separate host/player sessions, live transitions and exclusivity, self-paced feedback/results, audio/grant renewal, workspace isolation/admin oversight, deletion, and restart/reconnect flows.
- Six-option/image live questions fit without overflow at host sizes 1280×720, 1366×768, 1920×1080, 1024×768 and player sizes 390×844, 768×1024, 1366×768. Screenshots visually inspected for host and mobile views.
- Long-content/small-window test confirms a scrolling fallback, not clipped text.
- New backend cases cover correct, wrong, text, skipped and partial-credit feedback; withheld upcoming solutions; completed-only ranking; tie ranks; per-viewer identity; no leaked answers/tokens; persistence after restart; and closed results.
- `npm audit --omit=dev`: **0 vulnerabilities reported** at verification time.

No authenticated hosted deployment test, production capacity test, real-device Safari/Firefox test or new security audit is claimed. No repository push, Northflank deployment, provider-setting change or paid resource provisioning was performed.

## Deployment

Use `APPLY-v0.7-update.md`. The small update ZIP changes eight runtime files plus documentation/tests, and excludes `database-config.js` to preserve the working TLS fix. The full `Quizzes-deployment.zip` includes the current TLS fix and the complete current app.

Base public repository: `sudhsodi-boop/Quizzes`, main commit `902dd074180ad16b1a23b725087f4660fbc60d55`.

Only one server replica is supported by the current in-memory live-room design. Deploy between games. Existing external database/media configuration and saved data are retained. Screen-fit tests do not establish 100-player capacity on the 256 MB free host.
