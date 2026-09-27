# Quizzes: separate the database password from the connection URL

The deployment's `DB_AUTH_FAILED` message means PostgreSQL rejected the credentials supplied by the app. It does not prove which saved value is wrong. The later Render "No open ports detected" message is a consequence: the app does not start listening until initialization succeeds. Do not change the port or disable TLS to work around this.

This update provides a more direct configuration path: set **DATABASE_PASSWORD** privately in Render. The password is passed to the PostgreSQL client exactly as entered—without URL encoding, decoding, trimming, interpolation, or logging. The existing DATABASE_URL supplies the host, username, port and database name; its embedded password is ignored when DATABASE_PASSWORD is set. Query-string parameters cannot silently override the chosen credentials or TLS settings.

The update also checks that recognizable Supabase database endpoints and the media project URL identify the same project. It does not reset passwords, delete data or establish that your current password is valid. Hosted authentication still needs to be checked after deployment.

## Step 1 — update the code

1. Extract `Quizzes-db-connection-fix.zip` on your computer.
2. Open the GitHub **Quizzes** repository, on the branch connected to Render.
3. Use **Add file → Upload files** to upload these files into the repository root, replacing existing versions:
   - `database-config.js` — new, required file
   - `storage.js`
   - `startup-diagnostics.js`
   - `Dockerfile`
4. Commit the changes. Do not upload just the ZIP or put the code inside a new enclosing folder. You can also upload this instruction file; it is not required at runtime.

No dependency installation changes or package.json edits are required for this patch. I cannot commit to your GitHub repository or change your Render environment from this workspace.

## Step 2 — add ONE environment variable in Render

Open **Render → Quizzes web service → Environment → Edit/Add environment variable**.

- **Key:** `DATABASE_PASSWORD`
- **Value:** the current Supabase **database** password you set during the reset, copied directly from your password manager.

Use the actual password, not its URL-encoded version, not the whole connection string, not the Quizzes host-login password, and not the Supabase account password or API key. Do not add surrounding quotes or placeholder brackets. If the actual password contains `%40`, the app now treats those three characters literally; do not replace them unless that was an encoding you added to a different actual password.

Keep DATABASE_URL, DATABASE_CA_CERT, SUPABASE_URL, SUPABASE_SERVICE_KEY and the initial-host settings in place. Do not remove the certificate. DATABASE_PASSWORD takes precedence over only the password part of DATABASE_URL.

Save the environment setting. Then select **Manual Deploy → Deploy latest commit**. Automatic deployment is off in the supplied blueprint, so a GitHub commit alone is not enough. A restart of an older build will not apply this patch.

## Step 3 — check the safe mode confirmation

The new code prints:

```text
Database credential mode: separate DATABASE_PASSWORD; URL password is ignored.
```

If you see `Database credential mode: DATABASE_URL password.`, the separate variable was not supplied to that running service. If neither line appears, check that Render built the new GitHub commit and the correct branch.

Then look for:

```text
Startup check passed [DATABASE_SCHEMA]
```

If there is still an error, share only the credential-mode line and the `Startup check failed` line. Both contain fixed diagnostic text rather than secret values.

- `CONFIG_DATABASE_PROJECT_MISMATCH`: the database URI's username/project or host identifies a different Supabase project from the media project. Recopy the **Session pooler** host and username from that project's **Connect** dialog. Do not switch to a publishable key or another password.
- `CONFIG_DATABASE_PASSWORD_MISSING`: DATABASE_PASSWORD is present but empty, or the Supabase database username/password is absent.
- `DB_AUTH_FAILED` with **separate** mode confirmed: the literal password/username/endpoint combination is still rejected by PostgreSQL. The next step is to compare the Session pooler's non-secret host/port/username with the intended project and, if they match, investigate provider authentication/reset state. Repeating URL encoding will not help in this mode.

Never paste a password, secret key or complete connection URI into chat. The hostname, port and username alone are not database passwords, but avoid sharing screenshots of environment values.

## Verification performed here

Local tests check the exact password delivered to the actual node-postgres client for reserved characters, percent sequences, Unicode, spaces, stale embedded URL credentials, and conflicting URL query parameters. Project-mismatch checks and the existing application integration tests also pass. No connection to your database was attempted, because no credentials were requested or provided. This is a tested configuration change, not a claim that the hosted authentication failure is already resolved.
