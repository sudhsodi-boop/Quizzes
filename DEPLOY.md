# Quizzes — get a stable HTTPS testing address

**Current status:** the existing Northflank/Supabase installation is running v0.8. For the locally tested v0.8.1 patch, use [APPLY-v0.8.1-update.md](APPLY-v0.8.1-update.md). The fresh-install instructions below are historical guidance, not a request to create new services. No paid resources or configuration changes are needed for this patch.

You chose **free tiers / nonprofit credits only**, a **provider-issued HTTPS address**, and **reliable testing essentials before additional features**. No paid resources are authorized.

## 1. Accounts to create now

| Account  | Where                                  | Purpose                                                                   |
| -------- | -------------------------------------- | ------------------------------------------------------------------------- |
| GitHub   | https://github.com/signup              | Store the application source in a private repository                      |
| Render   | https://dashboard.render.com/register  | Run the web app and issue its HTTPS address                               |
| Supabase | https://supabase.com/dashboard/sign-up | Keep quizzes, accounts, reports and uploaded media outside the app server |

Use the **Free** plan. Do not select a paid database, disk, compute upgrade, IPv4 add-on or paid workspace. If a provider asks for a payment method or a paid upgrade, stop and tell me what the screen says without sharing sensitive details. Enable two-factor authentication on these accounts.

**Next reply can simply be: “Accounts ready.”** You may share a repository URL or provider-issued app URL. Never send account passwords, database URLs containing passwords, API keys, recovery codes or unredacted secret screenshots in chat.

## 2. What “free” can and cannot provide

This is a stable _address_ hosted independently of the chat, not an always-on availability guarantee.

- Render Free sleeps after 15 minutes without inbound traffic. A subsequent request normally wakes it in about a minute. It can restart at any time. Local files disappear on restart/redeploy, which is why this app now supports external PostgreSQL and media storage. Free Render Postgres expires after 30 days, so **do not create a Render database for this setup**. [1](https://render.com/docs/free)
- Render provides managed TLS/HTTPS for its `onrender.com` addresses and redirects HTTP to HTTPS. You do not need to buy a domain or manage a certificate. [2](https://render.com/docs/tls)
- Supabase Free currently includes a 500 MB database, 1 GB file storage, and usage/egress limits. Projects may pause after one week of inactivity; you must restore a paused project from its dashboard before an event. [3](https://supabase.com/pricing)
- Supabase recommends off-site exports for Free projects; its managed daily backup feature is on paid plans. Quizzes includes a manual, private ZIP backup and restore command instead. Automatic scheduled backups are **not configured**. [4](https://supabase.com/docs/guides/platform/backups)
- Stay within both providers’ free allowances. Render can charge for some usage overages when a payment method is attached; without one, services/builds can be suspended at limits. Do not enable billing or paid upgrades without explicit approval. [1](https://render.com/docs/free)

A real 100-person event still needs a rehearsal on these actual hosted services. Automated local tests do not establish free-tier production capacity.

## 3. Upload the source to GitHub

Download and extract **Quizzes-deployment.zip** from this workspace. Create a private repository, for example `quizzes`, and upload the extracted files **at the repository root**. Do not upload the ZIP as the only file: Render needs to see `package.json`, `server.js` and `render.yaml` directly.

The provided source package deliberately excludes databases, uploaded user media, backups, recovery files, credentials, `node_modules`, and test artifacts. Do not add those manually. Commit `.env.example` only as a blank template, never a filled `.env` file.

## 4. Create a Supabase Free project

1. Create a new Free project in a region reasonably close to Render's Oregon region.
2. Choose a strong **database password** and store it in your password manager. This is different from the Quizzes host password.
3. Wait for the project to become ready.
4. In **Connect**, choose **Session pooler**, not Transaction pooler. Copy the supplied connection string, replacing the password placeholder and percent-encoding reserved password characters. Copy it directly into Render's `DATABASE_URL` setting—not into chat or GitHub. Session pooling is the appropriate IPv4-compatible connection method for this persistent Node backend. [5](https://supabase.com/docs/guides/database/connecting-to-postgres)
5. Locate your project's URL and a **server-side secret key** (or legacy `service_role` key) in the API settings. These go only into Render's environment settings. Do not use a publishable/anon key as the privileged server key.

On startup, Quizzes creates its tables in the private `quizzes_private` PostgreSQL schema and a private `quizzes-media` bucket. Do not expose the schema through the Supabase Data API, make the bucket public, or put the privileged key in browser code. The app serves media through its own endpoint so participants can access images/audio by their unguessable link.

## 5. Deploy on Render Free

1. Connect Render to GitHub and grant it access to this repository only.
2. Choose **New → Blueprint**, select the repository, and use the included `render.yaml`.
3. Confirm the proposed service is a **Free Node web service**. The blueprint creates no paid disk and no Render database. Stop if the dashboard shows a charge or a different plan.
4. Fill in these settings **inside Render**:

| Variable                 | Value                                                                          |
| ------------------------ | ------------------------------------------------------------------------------ |
| `DATABASE_URL`           | Supabase **Session pooler** connection string containing the database password |
| `SUPABASE_URL`           | Your Supabase project URL                                                      |
| `SUPABASE_SERVICE_KEY`   | Your server-side secret key or legacy `service_role` key                       |
| `ORGANIZATION_NAME`      | Your nonprofit's display name                                                  |
| `INITIAL_ADMIN_EMAIL`    | Email you want to use for the first Quizzes host                               |
| `INITIAL_ADMIN_PASSWORD` | A new, unique 12–128 character Quizzes host password                           |

The blueprint also sets Node.js 22, `NODE_ENV=production`, `TRUST_PROXY=1`, `ALLOW_SETUP=false`, and bucket name `quizzes-media`. It uses `npm ci --omit=dev`, `npm start`, and `/healthz`. It disables automatic deploys to avoid accidentally interrupting games on every code commit.

If you prefer the manual **New → Web Service** flow, choose the same settings and select the Free instance yourself. **Do not choose Static Site**: the app needs a running WebSocket backend.

Database TLS certificate verification stays enabled. If certificate verification requires the project's CA, add `DATABASE_CA_CERT` in Render containing the complete PEM certificate downloaded from your Supabase dashboard. It is combined with the normal trusted roots. Do not disable certificate verification or set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Quizzes deliberately refuses to start on Render when its external database or media settings are missing. This avoids an apparently successful deployment that later loses local data.

## 6. First login and the real URL

After Render reports a successful deployment, use the **actual HTTPS URL shown in its dashboard**. The eventual address will end in `.onrender.com`; no specific address has been reserved or deployed yet.

1. Sign in with the initial host email/password you entered in Render. Public first-account registration is disabled.
2. In Render, remove `INITIAL_ADMIN_PASSWORD` and deploy the configuration change before starting a game. The account is now stored as a password hash in PostgreSQL; startup will not recreate or overwrite it.
3. In **Quizzes → Settings**, download your one-time recovery code. Store it in your password manager. Changing a password, using a code, or generating another code invalidates the previous code.
4. Confirm Settings reports **PostgreSQL** and **private Supabase media**, not local SQLite.
5. Create a quiz, upload an image/audio clip, and save it. Restart/redeploy the service when no game is active and confirm the quiz and media remain.
6. Host a game and open its join link on a separate phone/browser. Complete the quiz and check Reports.
7. Download a backup from Settings and keep it somewhere private outside both services.
8. Share the actual `.onrender.com` URL here so I can check its public health endpoint, page loading and WebSocket connectivity. Do not share the host password.

## 7. Recovery and backup operations

### Forgot the host password

Choose **Host sign in → Forgot password? Use a recovery code**. Supply the email, saved one-time code and a new password directly in the app. All existing host sessions are revoked. Then sign in and download a fresh code.

This is **recovery-code reset, not email reset**; no email service or domain is required. If both password and recovery code are lost, the owner can run `npm run reset-admin` from a private local terminal with the database environment configured. The command prompts for the new password without displaying it. Do not paste those environment secrets into chat.

### Download a backup

Use **Settings → Download backup ZIP**, confirming your current host password. This v0.5 in-app backup covers only the signed-in host's private workspace; the CLI covers the entire installation. Pause editing/uploads during the backup. For large media collections, use the command-line version on your own computer with the same private database/media settings:

```sh
npm ci
npm run backup -- /private/path/quizzes-backup.zip
```

The archive contains `database.json`, uploaded media and a warning note. It contains host password/recovery hashes and participant records: treat it as sensitive. It excludes active games, session cookies and hosting API keys. Browser downloads may become impractical for large collections.

### Restore

Extract a trusted private backup locally. With the app stopped and your environment pointed at a **fresh destination** with no host accounts or reports:

```sh
npm run restore -- /private/path/extracted-backup
```

Do not set initial-admin bootstrap variables before restoring. The restore command refuses to overwrite existing accounts or reports. It can restore a portable backup into either SQLite or PostgreSQL and restore media into local storage or Supabase. It does not restore active rooms or old login sessions. Verify data/media after restoring; failed media restores can leave unused objects in the destination bucket.

If migrating existing preview data, export it first and restore into the fresh Supabase project **before** creating a new host account there.

## Current boundaries

The owner confirmed the existing Northflank/Supabase installation works after the database CA/TLS fix. v0.8 is now deployed. The v0.8.1 patch has been tested locally and has not yet been deployed. See [RELEASE-v0.8.1.md](RELEASE-v0.8.1.md) for the current test results and [APPLY-v0.8.1-update.md](APPLY-v0.8.1-update.md) for updating the existing free Northflank service. Local PostgreSQL/media-contract tests and simulated players are not proof of hosted capacity or real-device acceptance.

Active games still reside in one server's memory and do not survive a crash or restart. A graceful shutdown attempts to save an interrupted report. Keep deployments outside event times and do not run multiple app replicas. Shared-workspace roles, precisely synchronized audio, dedicated event-sound configuration, automated backup scheduling, automated report retention, media cleanup/scanning and full accessibility/security auditing remain future work after the essentials pilot.

## Updating an existing installation

Use [APPLY-v0.8.1-update.md](APPLY-v0.8.1-update.md), not the fresh-account setup above. Preserve working passwords, database/media settings and CA certificate. Several legacy hosts require an explicit WORKSPACE_OWNER_EMAIL choice before migration. Never roll back to pre-v0.5 code against a multi-workspace database.

For read-only administrator oversight, set `SITE_ADMIN_EMAIL` to your existing main Quizzes login email in your hosting dashboard. Do not change working database/media credentials. Friends cannot assign this role through signup or profile data.
