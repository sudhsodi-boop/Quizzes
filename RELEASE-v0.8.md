# Quizzes v0.8.0

## Delivered

- Centered, single-step code/nickname join screen with original Quizzes styling.
- Three-column authoring studio: round/question thumbnails, editable media/question/answer canvas, property panel. Direct correct-answer circles, add/remove answer tiles, duplicate/move-up actions, existing bulk round moves and reviewed imports retained.
- Compact live-host toolbar, prominent question/media, countdown and answer-count indicators, full-width answer tiles. Existing shared host/player standings and final host winners retained.
- Gujarati Noto Sans font embedded in CSS under SIL OFL 1.1; accompanying `FONT-LICENSE.txt`. CSP permits embedded fonts; scripts remain same-origin only. No external fonts or libraries needed by browsers.
- Assignment dialog with local closing date/time, optional per-question timers and stable per-attempt answer shuffling.
- Server-enforced deadlines survive reload/restart. Late/expired answers earn zero. Timer starts for the first question at join and for later questions on explicit Next; no timer is running during feedback.
- Shuffled displayed indices are validated and mapped to canonical answer indices before single/boolean/multiple-answer grading. Text answers and partial-credit rules are unchanged.
- Immediate feedback and completed-only rankings preserved. Older publications default to untimed/unshuffled. No table migration, credential change, paid provisioning or replica change.
- No image reveal. No Kahoot logos/assets, subscription UI, avatar feature or nickname generator.

## Verification

Local Node 22.23.3:
- SQLite Node suite: **41/41 passed**.
- PostgreSQL 17 Node suite: **41/41 passed**, including mock remote media contract testing. No production database credentials used.
- TLS tests: **5/5 passed**. `database-config.js` is unchanged from the verified Northflank repair.
- Chromium end-to-end scenario: **1/1 passed**. Includes host/code/join/score/leaderboard and media/audio flows; editor imports, tile edits, correct-key removal/reselection, duplicate/reorder/delete/navigation, mobile layout, Gujarati font loading; host/player standings equality/reconnection; self-paced deadline/timer/shuffle controls, stable order after reload, correct remapped scoring, feedback pause, actual timeout, final score/rank; existing oversight, isolation and deletion behavior.
- Backend assignment cases cover deadline/flag validation, shuffle persistence after server restart, single/multi/text/boolean grading, wrong-selection penalties, invalid indices/duplicates, late submissions, GET-time expiry, no question exposed before timed Next, concurrent/idempotent Next, no timer reset, restart persistence, completed rankings and export of timing/shuffle state in private backups.
- Existing live viewport checks passed at 1280×720, 1366×768, 1920×1080, 1024×768 host sizes, and 390×844, 768×1024, 1366×768 player sizes. Long-content overflow fallback retained.
- Visually inspected join, studio, assignment and host screenshots; studio was additionally checked at 1440×960 and 390×844.
- `npm audit --omit=dev`: **0 vulnerabilities reported** during verification.

No authenticated hosted acceptance test, real Safari/Firefox/iPhone testing, live Northflank capacity test, Docker build or independent security audit is claimed. Changes have not been pushed or deployed by the assistant.

## Packaging and compatibility

Use `APPLY-v0.8-update.md`. Eight runtime files must be uploaded together. The small update archive preserves the already-working TLS module by excluding it; the full deployment archive contains the complete latest code including the TLS fix.

Reference public main commit before this work: `317388e`. The local starting app also includes the shared host leaderboard follow-up.

Existing free resource allocation and external Supabase storage are unchanged. Live rooms still reside in one process; deployments/restarts lose them. Do not use multiple replicas without a shared-state redesign. Existing self-paced browser-cookie identity limitations and provider quotas remain.

Do not roll back to pre-v0.8 behavior with active timed/shuffled assignments: older code ignores their policy. Close those assignments first and preserve their stored data.
