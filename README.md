# Quizzes · v0.3

A responsive, single-organization live quiz app for a nonprofit. No subscriptions, billing or participant payments.

**Deployment status:** prepared for a free testing deployment, not yet deployed in the user's accounts. Temporary Cloudflare tunnels have been retired. Start with **[DEPLOY.md](DEPLOY.md)** for GitHub, Render and Supabase account/setup instructions. Do not send passwords or API keys in chat.

## Implemented

- Host login with scrypt password hashes, HttpOnly/SameSite cookies, password changes and session revocation. Production session cookies use Secure.
- First production host created from environment secrets entered directly in the hosting dashboard; public registration is disabled in production. Bootstrap never overwrites an existing host.
- One-time recovery-code download and forgotten-password reset, with code rotation, atomic single-use consumption and session revocation. This does not send email. Owner-assisted recovery is available through a private terminal command.
- Quiz creation/editing/deletion, single/multiple rounds, move-question-up control, configurable timers and points.
- Multiple-choice, true/false and typed fill-in-the-blank answers; normalization ignores case, compatibility differences and extra whitespace. Add spelling alternatives explicitly.
- Question images/audio and optional lobby music. PNG, JPEG, GIF, WebP, MP3, WAV, OGG; 10 MB per file. Playback requires a user action and is not synchronized across devices.
- Separate host/player connections, code/nickname joining, server timers, duplicate/stale/late-answer rejection, speed scoring, answer reveal and leaderboards. Correct answers and new scores are withheld until results.
- 100-player limit per room, in-tab reconnect support, score retention after disconnect, actual-data dashboard, persistent completed reports and CSV scoreboards.
- SQLite/local media for a local installation **or PostgreSQL/private Supabase media for cloud hosting**. Render startup refuses missing external-storage configuration.
- Private ZIP backup download with password confirmation; includes saved accounts, quizzes, reports, media and recovery-code hashes, but not login sessions, hosting keys or live rooms.
- Restore command for a fresh destination; refuses to overwrite existing accounts or reports.

## Local setup

Use Node.js 22 (Node.js 20.19+ also supported).

```sh
npm ci
npm run create-admin
npm start
```

Open `http://localhost:4173`. Participants use `/join`; phones on your network need your computer's LAN address, not localhost. Native build tools may be needed for `better-sqlite3` if no prebuilt binary is available.

The admin command asks for a password privately in an interactive terminal. No default password exists. Additional trusted host accounts share the same organization's entire workspace; this is not a multi-tenant service and does not implement differentiated roles.

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
| `DATA_DIR`               | Local SQLite/media directory, default `./data`                                                     |
| `ALLOW_SETUP`            | `true` enables development-only first registration                                                 |

`.env.example` lists names only. The application reads process environment variables; it does not automatically load `.env` files. Configure secrets through your hosting dashboard or a private terminal, not source control. Use Supabase's Session pooler connection string; certificate verification is on by default.

PostgreSQL tables are in `quizzes_private`, not the public API schema. Do not expose that schema in Supabase. A dedicated private media bucket is created/checked at startup. The server's media endpoint intentionally allows viewing by unguessable link without an account so participants can see quiz media; do not upload confidential content.

## Backups, restore and recovery

Use Settings to download an account recovery code and a private ZIP backup. Confirm your current password in the app. Store both securely outside the hosting provider.

CLI equivalents, with the database/media environment configured on your own computer:

```sh
npm run backup -- /private/path/quizzes-backup.zip
npm run restore -- /private/path/extracted-backup
npm run reset-admin
```

For restore, first extract a trusted ZIP and stop application writes. Target a fresh database/bucket with no accounts or reports; omit initial-admin bootstrap variables. Existing data is deliberately not overwritten. A backup contains historical password/recovery hashes and participant records, so it is sensitive and should not be committed to GitHub. Restoring it also restores that historical account state. Login sessions and live games are not included.

Pause editing/uploads while backing up for application-level consistency. Large collections should use the CLI rather than a browser Blob download. Keep backups off-site and rehearse restoration. Automated backup scheduling is not configured; providers' free quotas also limit backup storage/bandwidth.

## Tests

```sh
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

The suite starts isolated servers and temporary local databases. Integration tests use port 4181; production-bootstrap checks use 4183; Chromium uses 4182. `unzip` is used to verify test archives.

Validated locally:

- Host auth, protected API/static file restrictions and first-account setup lockout.
- Production bootstrap, Secure cookie attributes and refusal to deploy ephemeral Render storage.
- Multimedia quiz creation and saved rounds; answer validation, scoring, reconnects and timer expiry.
- 100 concurrent simulated player connections, with a 101st rejected.
- Saved accounts/quizzes/media/reports across an application restart.
- Recovery-code rotation, concurrent reuse rejection, password reset and old-session revocation.
- Backup ZIP contents and successful restore into a fresh SQLite database, with overwrite attempts rejected.
- A separate mobile-sized Chromium participant completes a multimedia quiz; host/player reload recovery, audio playback, CSV export, backup/recovery downloads and forgotten-password reset through the UI.

The integration suite was also run against a real **local PostgreSQL 17** server and a **local Supabase Storage HTTP contract fixture**. This verifies the PostgreSQL adapter and storage request flow, not the actual hosted services. Hosted Supabase TLS, Render deployment, real-network capacity and other browser engines remain to be tested after account setup.

To repeat PostgreSQL/remote-media contract tests, supply a dedicated empty database whose name starts with `quizzes_test`:

```sh
TEST_DATABASE_URL=postgresql://user@127.0.0.1:55432/quizzes_test \
TEST_REMOTE_MEDIA=true npm test
```

Tests use only `TEST_DATABASE_URL`, not your production `DATABASE_URL`. The test-only TLS bypass applies only with `NODE_ENV=test`; never use it for a hosted deployment. Recreate the test database before rerunning.

## Operational boundaries

- One server instance; active rooms remain in memory. They do not survive a crash/restart. Graceful shutdown attempts to save interrupted reports. Deploy between games.
- Saved quizzes/reports/media survive restarts only with a durable local volume or configured cloud storage.
- Disconnecting a participant does not free their nickname/player slot during the game; in-tab reconnect restores their score.
- Login/upload/message limits and basic media signature validation are implemented, not a complete security audit or antivirus scan.
- Removed attachments remain stored until manually cleaned up. There are no automated retention/deletion tools yet.
- No email-based reset, host invitations/permission levels, synchronized media, dedicated event-sound configuration, native mobile apps, full accessibility audit or managed monitoring/backup scheduling yet.

The Docker/Compose alternative is retained for a server with a persistent local volume, but has not been built or deployed here. It is not the selected free Render/Supabase route.
