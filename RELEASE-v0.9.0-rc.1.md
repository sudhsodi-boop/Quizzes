# Quizzes 0.9.0-rc.1 — candidate verification record

**Date: September 28, 2026**  
**Status: locally verified test candidate; production/image release gate NOT cleared.**

## Implemented phase

- A separate read-only audience display: join QR/code, lobby, current question, public results, host-controlled/round-end standings, fullscreen and reconnection. It receives no private notes, next-question text, host token or future image grants.
- A private host console: next-question text/round, current speaker notes, connection counts, join QR and per-question image diagnostics.
- A paired local host/simulated-participant rehearsal using the shared grading rules, including multi-answer partial credit, typed answers, timers, reveal, round transitions, standings, basic text/key preflight and a local sound activation test. No live WebSocket, room, attempt, publication or report writes.
- Authenticated owner-scoped server recovery drafts; bounded session undo/redo; explicit official Save retained. Draft compare-and-swap prevents silent conflicts, including deletion/recreation of the same draft key. Draft writes/deletes serialize per owner on PostgreSQL.
- Official saved quizzes gain `_revision`; current Studio sends `If-Match`. Updates additionally compare the stored document in SQL to reject overlapping write races. **Compatibility limitation:** legacy API clients omitting the precondition are still accepted; close/reload old host tabs before editing.
- Scoped desktop/editor styling, projector/rehearsal layouts and vendored local QR generation. Existing phone participant layout, scoring rules, immutable assignments, immediate question timing and host-only live soundtrack controls remain.
- Backup format 3 adds private editor drafts. Restore accepts formats 1–3, with an empty draft collection for older backups.
- `/healthz` now includes the package version so the installed candidate can be identified without credentials.

## Executed local verification

| Check | Result |
|---|---|
| Node 22 automated application suite | **59 tests passed, 0 failed** |
| Separate TLS/CA suite | **5 passed, 0 failed** |
| Expanded Chromium end-to-end workflow | **1 passed**, approximately 70 seconds |
| PostgreSQL 17 local dedicated test databases: workspace and Professional Studio suites | **23 passed, 0 failed** |
| Clean full-ZIP extraction: dependency install, Node and TLS suites | **59 + 5 passed** |
| Update applied over the delivered v0.8.2 full archive | Byte-identical to candidate source; internal checksums verified |
| Production npm dependency audit | **0 reported vulnerabilities** at execution time |
| Working `database-config.js` | Unchanged SHA-256, below |
| Vendored QR generator | Byte-identical to `qrcode-generator@2.0.4/dist/qrcode.js`; MIT notice included |

The Chromium workflow also retains existing phone/desktop sizing, media, imports, live play, private workspaces and self-paced regression checks. New checks cover undo/redo, private draft recovery after reload, explicit Save cleanup, local rehearsal isolation, partial credit/typed rehearsal answers, projector QR/public-only UI/reload, host notes, and clearing/revocation on sign-out. Screenshots were inspected for the private host, audience projector and rehearsal layouts. Browser automation’s sound test verifies activation/output scheduling, **not that a human heard the sound**.

The new server tests cover owner isolation, malformed draft rejection, stale save/delete conflicts, randomized draft generation revisions, quotas, restart persistence, owner-scoped backup export, format-2/3 restore, stale official Save, projector read-only actions, absence of private/future data, reconnect, four-display capacity, host-session replacement/expiry/sign-out, and current-only image telemetry without delayed timers or changed scoring. Existing legacy restore/migration tests remain in the main suite.

The main suite reruns the v0.8.2 private image relay checks: 100 concurrent authorized cold requests are coalesced, warmed reuse avoids extra mock-origin downloads, and authorization/ranges/recovery are preserved. These tests use controlled local/mock storage—not the owner’s Supabase bucket or physical participant devices.

PostgreSQL tests used fresh, isolated local databases with the test-only non-TLS setting; no production database was accessed. Production strict-TLS behavior was separately regression-tested and the established TLS configuration file was not modified.

## Important limits and remaining verification

- **Actual Northflank/Supabase images and real participant devices have not been measured.** `PARTICIPANT-IMAGE-VALIDATION.md` remains HOLD. There is no deployment or event-readiness certification.
- Local tests do not establish roughly 100 real devices on free 0.1-CPU/256-MB hosting, venue Wi-Fi quality, iOS Safari/Android behavior, screen-reader conformance, long-duration soak behavior or audible synchronization across physical devices.
- The local rehearsal is not pixel-identical to every participant phone. It is a flow/content check, not a network test.
- Image telemetry is untrusted client-reported download/decode elapsed time. It is not screen-visibility proof, persisted analytics, a timing authority or a readiness barrier. Counts reset each question.
- No Docker daemon/build was available in this workspace. The Docker source COPY list is checked against packaged files; the actual provider build/deployment still needs verification.
- Browser recovery/history content is kept in memory, not browser persistent storage. Autosaved recovery is on the private server and needs connectivity. A save failure is shown, not silently treated as success.
- Undo history is deliberately bounded. Uploaded media bytes are not deleted by undo or recovery-draft deletion, consistent with existing media retention behavior.
- Projector authorization depends on the room token and active host sign-in session. Tokens are not public invite codes or host credentials. Same-computer signed-in browser access is not a separate security boundary; keep the host screen private.
- Main-administrator read-only oversight continues to apply to saved workspace content. Friends still cannot access each other’s drafts, quizzes or reports.
- No new paid provisioning, external font/QR CDN, question bank, advanced reports, extra game modes, preparation delay, image reveal or participant soundtrack controls were added.

## Integrity

Working TLS configuration `database-config.js`:

`ddee8cdda3f94e3a87b7cddeb793c11ff53712de112bf849b4d654403c6f1495`

Vendored `qr-code.js`:

`79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c`

New candidate packages use distinct `v0.9.0-rc.1` filenames. The previously delivered `Quizzes-v0.8.2-update.zip` and `Quizzes-deployment.zip` are preserved and are not relabeled as this candidate.

## Run the checks yourself

Use Node 22, then:

```sh
npm ci
npm test
node --test tests/tls-ca.test.js
npx playwright install chromium
npm run test:browser
npm audit --omit=dev
```

Tests create and remove isolated local test data. Optional PostgreSQL tests require **new empty dedicated test databases**, whose database names begin with `quizzes_test`, supplied through `STUDIO_TEST_DATABASE_URL` and `WORKSPACE_TEST_DATABASE_URL`. Never point tests at a production database or share a credential-bearing URL. No production TLS settings should be relaxed to run local tests.
