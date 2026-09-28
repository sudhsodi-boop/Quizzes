# Quizzes · v0.8

A responsive live and self-paced quiz app for nonprofit use, with invitation-based separate host workspaces and a designated site administrator’s read-only oversight. No subscriptions, billing or participant payments.

**Deployment status:** the existing Northflank/Supabase installation is running with the verified TLS configuration fix. This v0.8 update is locally tested, not yet deployed. Follow **[APPLY-v0.8-update.md](APPLY-v0.8-update.md)**. Keep the same free service, external database, private media and environment variables. Never send passwords or API keys in chat.

## v0.8 Studio and assignments

- Original Quizzes join screen; code and nickname remain in one step.
- Question thumbnails, editable colored answer tiles with correct-answer circles, large media preview, property controls, duplication and round organization. Quiz settings remain accessible in the top toolbar. No image reveal.
- Presentation-style live host screen with larger media, countdown/answer indicators and compact controls. Both host and players see requested/round-end leaderboards, and the host sees final winners.
- Assign a saved quiz with a chosen closing date/time (default 24 hours), optional per-question timer and optional stable per-attempt answer shuffle. Existing publications remain untimed/unshuffled. Options are fixed at publication.
- Timers are server-enforced, survive reload/restart, and continue while a tab is closed. Late answers earn zero. The next timer starts only on Next, not while feedback is showing. Expiry resolves on a request; no cron is needed. Self-paced points have no speed bonus.
- Shuffled displayed indices are mapped back before grading. Immediate feedback and completed-only participant leaderboards remain enabled.
- Embedded, OFL-licensed Gujarati typography. The browser requires no font CDN. See FONT-LICENSE.txt.

## Implemented

- Host login with scrypt password hashes, HttpOnly/SameSite cookies, password changes and session revocation. Production session cookies use Secure.
- First production host created from environment secrets entered directly in the hosting dashboard; public registration is disabled in production. Bootstrap never overwrites an existing host.
- One-time recovery-code download and forgotten-password reset, with code rotation, atomic single-use consumption and session revocation. This does not send email. Owner-assisted recovery is available through a private terminal command.
- Quiz creation/editing/deletion, optional round names, individual/bulk moves between rounds, configurable timers and points. Last-question notices, next-round title screens, automatic cumulative round-end leaderboards and host-triggered leaderboard display.
- Single-answer choice, multiple-correct-answer questions with partial credit/wrong-selection penalty, true/false and typed fill-in-the-blank answers; normalization ignores case, compatibility differences and extra whitespace. Add spelling alternatives explicitly.
- Original classic game-show theme: purple geometric backgrounds, shape-coded colorful answer tiles, animated countdown emphasis, answer highlights and a final podium. Reduced-motion support. Original Quizzes branding, not a pixel-for-pixel Kahoot copy.
- Original procedural background music by default on host and player screens, across lobby, questions and results; countdown/reveal/finish effects. Only the host controls broadcast play/pause and volume; participants have no independent soundtrack controls. Host/Join gestures enable audio; browsers may require another Enable sound tap after a reload. Sound is generated locally and is not sample-synchronized between devices.
- Question images/audio and optional custom background soundtrack. PNG, JPEG, GIF, WebP, MP3, WAV, OGG; 10 MB per file. Custom music replaces the default and is available on player devices too. Question audio plays manually and ducks the background while playing.
- Structured-question import with bold, colored/highlighted, checkmarked and multi-answer recognition from text PDFs (up to 50 pages), DOCX, UTF-8 TXT, or pasted text. Review-required draft with source comparison and missing/conflicting answer warnings. No external AI or document retention. Maximum 5 MB, 200,000 extracted characters, 200 questions and 20 rounds. Scans/OCR, embedded-media extraction and generating new questions from prose are not included. Use explicit numbering/option labels; see [Quiz-import-example.txt](Quiz-import-example.txt).
- Separate host/player connections, code/nickname joining, server timers, duplicate/stale/late-answer rejection, speed scoring, answer reveal and leaderboards. Correct answers and new scores are withheld until results.
- 100-player limit per room, in-tab reconnect support, score retention after disconnect, actual-data dashboard, persistent completed reports and CSV scoreboards.
- SQLite/local media for a local installation **or PostgreSQL/private Supabase media for cloud hosting**. Render startup refuses missing external-storage configuration.
- Private, workspace-scoped ZIP backup download with password confirmation; includes the signed-in host account, quizzes, reports, media, recovery-code hashes, publications and submitted attempts, but not other hosts, invitation links, login sessions, hosting keys or live rooms. The operator CLI backup is installation-wide.
- Restore command for a fresh destination; supports v1/v2 backups and refuses to overwrite existing accounts or reports.
- Publish an immutable quiz snapshot with a chosen closing time (default 24 hours), up to 100 browser attempts; nickname entry, saved submitted progress, provisional/final host results and CSV export. Participants see correct answers and points immediately after each submitted or skipped question, then press Next. Unsubmitted solutions remain private while the quiz is open. After completing, they see nicknames/scores of completed attempts only; equal scores share a competition rank (1, 1, 3). This applies to existing and new publications for all hosts. Deadlines are request-enforced, not dependent on background jobs.
- One-use friend invitations expire in 24 hours. Friends create separate logins and empty workspaces. Friends cannot view each other’s work; the designated site administrator can view saved quizzes/media/reports and publication results. This access is disclosed in signup and workspace notices. No public signup, account fees, shared editing rights or automatic quiz copying.
- Optional SITE_ADMIN_EMAIL grants read-only installation oversight to one existing main account. It does not grant mutation of friends’ content, password/recovery access or cross-workspace backups.
- Confirmed deletion of an individual saved live report, all own saved live reports, or a closed publication with its attempts. Source quizzes/media and old backups are kept.
- Open self-paced publications can be extended to a later deadline (up to one year from now), preserving the link/progress. Closed publications cannot reopen.
- Linked self-paced background soundtracks loop through questions, with a browser enable-sound gesture, manual question audio ducking and signed-source renewal. No linked track means no added self-paced background music.

## Current behavior and scoring

See **[APPLY-v0.8-update.md](APPLY-v0.8-update.md)** for the feature walkthrough, safe update steps and post-deployment checks. Multi-answer credit is `max(0, correct-selected/correct-total − wrong-selected/wrong-total)`; the wrong term is zero if there are no incorrect options. Multiply by live speed-adjusted points or self-paced fixed points. A correct selection plus an incorrect selection can cancel out; points never go negative. Round leaderboards are cumulative. Document formatting is a review hint, not guaranteed answer truth: all-option styling and conflicting keys stay unresolved. Scans, flattened/unusual PDF highlighting, every Word numbering/style convention and partial emphasis are not guaranteed.

## Database authentication troubleshooting

If a reset password still produces `DB_AUTH_FAILED`, the app now supports an optional **`DATABASE_PASSWORD`** environment variable. Enter the actual database password privately in Render, without URL encoding. This overrides the password in `DATABASE_URL` while retaining that URL's host, username, port and database. Do not create this optional variable with an empty value. TLS verification remains enabled, and recognizable Supabase database/media project identities are checked. See [APPLY-database-connection-fix.md](APPLY-database-connection-fix.md) for patch and deployment instructions.

## Local setup

Use Node.js 22 (Node.js 20.19+ also supported).

```sh
npm ci
npm run create-admin
npm start
```

Open `http://localhost:4173`. Participants use `/join`; phones on your network need your computer's LAN address, not localhost. Native build tools may be needed for `better-sqlite3` if no prebuilt binary is available.

The admin command asks for a password privately in an interactive terminal. No default password exists. Additional accounts have isolated app workspaces. Invite friends from Settings rather than sharing a password. All accounts share installation resources and provider quotas; infrastructure operators still have privileged access. Legacy single-host content is assigned automatically. If several hosts existed before v0.5, set WORKSPACE_OWNER_EMAIL explicitly before upgrading; the app refuses to guess who owns legacy shared content.

For a private development preview only:

```sh
ALLOW_SETUP=true npm start
```

This permits the first host to register in the browser, then locks setup. It is always disabled in production. Never share an unclaimed development preview publicly. Use the **Quizzes Live App** server preview in Arena, not the static HTML file viewer; open it in its own tab if embedded cookies are blocked.

## Cloud testing deployment

See [DEPLOY.md](DEPLOY.md). The included `render.yaml` specifies one Free Node web service with managed HTTPS, external PostgreSQL and external media. It creates no paid disk or database and disables automatic deploys. The actual `.onrender.com` URL is issued only after successful deployment in your Render account.

Choose Free accounts, stay within limits, and do not authorize upgrades or payment methods without approval. Free hosting can sleep, pause or hit quotas. It is not an always-on guarantee for a 100-person production event.

### Configuration

| Variable                 | Purpose                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `PORT`                   | Server port; default 4173, assigned by Render in cloud                                             |
| `NODE_ENV`               | Use `production` for a real host; disables web setup and makes cookies Secure                      |
| `DATABASE_URL`           | External PostgreSQL connection; absence selects local SQLite, except Render requires it            |
| `DATABASE_CA_CERT`       | Optional Supabase CA PEM, added to trusted roots; TLS verification is never disabled in production |
| `SUPABASE_URL`           | Supabase project URL for media                                                                     |
| `SUPABASE_SERVICE_KEY`   | Server-only secret or legacy service-role key; never put in browser code                           |
| `SUPABASE_MEDIA_BUCKET`  | Private bucket name; defaults to `quizzes-media`                                                   |
| `INITIAL_ADMIN_EMAIL`    | First-host email for bootstrap in a fresh deployment                                               |
| `INITIAL_ADMIN_PASSWORD` | First-host password, 12–128 characters; remove after first login                                   |
| `ORGANIZATION_NAME`      | First-host organization name                                                                       |
| `TRUST_PROXY`            | Set `1` only behind a trusted proxy; uses forwarded scheme and nearest forwarded client address    |
| `SITE_ADMIN_EMAIL` | Existing main host email authorized for read-only oversight; absent means no site-admin role |
| `WORKSPACE_OWNER_EMAIL` | One-time legacy ownership choice when upgrading an installation with several existing hosts |
| `DATABASE_PASSWORD` | Optional raw database password override; never set this variable empty |
| `DATA_DIR`               | Local SQLite/media directory, default `./data`                                                     |
| `ALLOW_SETUP`            | `true` enables development-only first registration                                                 |

`.env.example` lists names only. The application reads process environment variables; it does not automatically load `.env` files. Configure secrets through your hosting dashboard or a private terminal, not source control. Use Supabase's Session pooler connection string; certificate verification is on by default.

PostgreSQL tables are in `quizzes_private`, not the public API schema. Do not expose that schema in Supabase. A dedicated private media bucket is created/checked at startup. Media access requires the owning host session, the designated site-admin session, or a short-lived signed grant provided for live/published quiz participation. Media responses use private, no-store caching. A participant can still save/share content already shown to them; do not publish confidential content. Reconnect/refresh renews grants, and a failed custom soundtrack retries a fresh grant with default-music fallback.

## Backups, restore and recovery

Use Settings to download an account recovery code and a private ZIP backup. Confirm your current password in the app. Store both securely outside the hosting provider.

CLI equivalents, with the database/media environment configured on your own computer:

```sh
npm run backup -- /private/path/quizzes-backup.zip
npm run restore -- /private/path/extracted-backup
npm run reset-admin
```

For restore, first extract a trusted ZIP and stop application writes. Target a fresh database/bucket with no accounts or reports; omit initial-admin bootstrap variables. Existing data is deliberately not overwritten. A backup contains historical password/recovery hashes and participant records, so it is sensitive and should not be committed to GitHub. Restoring it also restores that historical account state. Login sessions and live games are not included. In-app v0.5 exports are single-workspace backups; use the privileged CLI for a whole-installation backup. Submitted self-paced attempts are included. Do not restore a workspace backup into an already populated multi-workspace installation. Legacy v1 backups are assigned to a single selected owner on restore.

Pause editing/uploads while backing up for application-level consistency. Large collections should use the CLI rather than a browser Blob download. Keep backups off-site and rehearse restoration. Automated backup scheduling is not configured; providers' free quotas also limit backup storage/bandwidth.

## Tests

For v0.8 verification and boundaries, see [RELEASE-v0.8.md](RELEASE-v0.8.md).

```sh
npm test
node --test tests/tls-ca.test.js
npx playwright install --with-deps chromium
npm run test:browser
```

The suite starts isolated servers and temporary local databases. Integration tests use port 4181; production-bootstrap checks use 4183; Chromium uses 4182; workspace tests use 4187. `unzip` is used to verify test archives.

Validated locally:

- Host auth, protected API/static file restrictions and first-account setup lockout.
- Production bootstrap, Secure cookie attributes and refusal to deploy ephemeral Render storage.
- Multimedia quiz creation and saved rounds; answer validation, scoring, reconnects and timer expiry.
- 100 concurrent simulated player connections, with a 101st rejected.
- Saved accounts/quizzes/media/reports across an application restart.
- Recovery-code rotation, concurrent reuse rejection, password reset and old-session revocation.
- Backup ZIP contents and successful restore into a fresh SQLite database, with overwrite attempts rejected.
- A separate mobile-sized Chromium participant completes a multimedia quiz; host/player reload recovery, broadcast audio controls and signed-track renewal, CSV export, backup/recovery downloads and forgotten-password reset through the UI.
- Multi-answer editor/selection, bulk round assignment, next-round titles, auto/manual leaderboards, 24-hour publication/guest completion/close/results and friend signup/isolation through the UI.
- DOCX/PDF bold, color/highlight, checkmark and inherited Word styles, including a short digit-only bold answer; explicit multiple answer keys and ambiguous all-bold options.
- Private workspace API/socket/media/backup boundaries, invitation expiry/replay, duplicate submission races, saved async progress across restart, deadline enforcement and post-close disclosure.
- Legacy ownership migration fails closed on ambiguous multi-host databases; original quiz content is preserved and v1 backups restore into an owned workspace.

The integration suite was also run against a real **local PostgreSQL 17** server and a **local Supabase Storage HTTP contract fixture**. This verifies the PostgreSQL adapter and storage request flow, not the actual hosted services. Hosted Supabase TLS, Render deployment, real-network capacity and other browser engines remain to be tested after account setup.

To repeat PostgreSQL/remote-media contract tests, supply a dedicated empty database whose name starts with `quizzes_test`:

```sh
TEST_DATABASE_URL=postgresql://user@127.0.0.1:55432/quizzes_test \
TEST_REMOTE_MEDIA=true npm test
```

Tests use only `TEST_DATABASE_URL`, not your production `DATABASE_URL`. The test-only TLS bypass applies only with `NODE_ENV=test`; never use it for a hosted deployment. Recreate the test database before rerunning. To test the new workspace flows against PostgreSQL too, provide a **different** fresh database via `WORKSPACE_TEST_DATABASE_URL=postgresql://user@127.0.0.1:55432/quizzes_test_workspaces`. Never use a real deployment database for tests.

## Operational boundaries

- One server instance; active rooms remain in memory. They do not survive a crash/restart. Graceful shutdown attempts to save interrupted reports. Deploy between games.
- Saved quizzes/reports/media survive restarts only with a durable local volume or configured cloud storage.
- Disconnecting a participant does not free their nickname/player slot during the game; in-tab reconnect restores their score.
- Login/upload/message limits and basic media signature validation are implemented, not a complete security audit or antivirus scan.
- Removed attachments remain stored until manually cleaned up. Manual report/closed-publication deletion is available; automated retention/media cleanup is not. Deletion does not erase downloaded copies or earlier backups.
- No email-based reset, co-host editing permission levels within a workspace, sample-synchronized media, dedicated event-sound configuration, native mobile apps, full accessibility audit or managed monitoring/backup scheduling yet.
- Browser-level attempt prevention can be bypassed by clearing cookies, private browsing or another browser/device. This is not identity verification or a proctored-exam system.
- Self-paced windows close at the chosen publication deadline (default 24 hours after publication, not after joining); the owner may extend them while still open. An extension does not reset a running per-question timer. Only submitted answers persist. Partial attempts count in final results. Free-hosting downtime does not extend deadlines.
- Private workspaces share free-tier quotas; inviting a friend does not create an additional free server/database allocation.
- Never roll back to v0.4 or earlier against a database containing private friend workspaces: those versions do not enforce isolation. See the update guide before any rollback.

The Docker/Compose alternative is retained for a server with a persistent local volume, but has not been built or deployed here. It is not the selected free Render/Supabase route.
