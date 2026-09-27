# Quizzes: diagnose the Render startup failure safely

The `WEB_CONCURRENCY=1` message is informational. The old generic startup message hid the failure from one of the app's initialization steps; it did not identify the cause.

This update adds credential-safe, per-component diagnostics and validates common configuration mistakes. It also handles concurrent creation of the same private media bucket without treating a verified duplicate as a fatal error. It does not delete data, reset passwords, weaken database TLS verification, or create paid services.

**The actual failure in your hosted deployment is not known yet.** Local tests passed, but this workspace cannot edit your GitHub repository or redeploy your Render service directly.

## Apply the patch

1. Download `Quizzes-startup-fix.zip` and extract it on your computer.
2. Open your GitHub **Quizzes** repository, on the branch Render deploys.
3. Choose **Add file → Upload files** and upload these files into the repository root, replacing the existing versions where present:
   - `server.js`
   - `storage.js`
   - `media-store.js`
   - `startup-diagnostics.js` — this is a new, required file
   - `Dockerfile` — updated so Docker deployments also include the new file
4. Commit the changes. Do not upload only the ZIP, put the files inside an extra folder, or edit your passwords/keys into source code. No dependency or environment changes are required just to install these diagnostics.
5. In Render, open the **web service**, then choose **Manual Deploy → Deploy latest commit**. Restarting the existing service alone will not pick up a new GitHub commit. The provided blueprint disables automatic deployment.
6. Open the logs for the new deployment.

The patch prints lines like:

```text
Quizzes startup diagnostics v1 (credential values are never logged)
Startup check passed [DATABASE_SCHEMA]
Startup check failed [MEDIA_BUCKET_LOOKUP] [MEDIA_HTTP_401]: ...
```

Those are examples, not a diagnosis of your current deployment. Configuration failures can print a `Startup check failed` line before the version marker. If you still see only the original generic message, check that Render deployed the new commit from the correct branch and that the files replaced the root versions.

Send back only the new **`Startup check failed [...] [...]`** line(s). Those diagnostic lines deliberately contain only fixed explanations, known codes and stage names—not environment-variable values, raw provider responses or stack traces. Do not send environment screenshots, full connection strings, database passwords or secret keys.

## Private checklist in the provider dashboards

- Supabase project is running, not paused.
- `DATABASE_URL` is the project's plain **Session pooler** URI, normally using port 5432. Replace `[YOUR-PASSWORD]` with the Supabase database password and URL-encode the password portion where required. No Markdown, extra `http://`, quotes or line breaks.
- `SUPABASE_URL` is the HTTPS Project URL, not the dashboard URL.
- `SUPABASE_SERVICE_KEY` is the `sb_secret_` server key from that same project—not the publishable key. The legacy `service_role` form is also supported. Remove surrounding quotes/whitespace.
- For a fresh workspace, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` and `ORGANIZATION_NAME` are all set. The host password must be 12–128 characters and is separate from the Supabase database password.
- `SUPABASE_MEDIA_BUCKET` is `quizzes-media`, unless you intentionally chose another valid private bucket.

## Common safe codes

| Code                                         | Next action                                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_DATABASE_PLACEHOLDER`                | Replace the password placeholder privately in Render.                                                                                                                             |
| `DB_AUTH_FAILED`                             | Check the Supabase database password, password URL encoding and pooler username.                                                                                                  |
| `DB_POOLER_IDENTITY`                         | Recopy the Session pooler URI from this exact project's Connect dialog.                                                                                                           |
| `DB_AUTH_THROTTLED`                          | Correct the credentials, allow the pooler's cooldown to pass, then redeploy.                                                                                                      |
| `TLS_UNTRUSTED`                              | If the stage is database-related, obtain the provider's database CA certificate and put its complete PEM contents in `DATABASE_CA_CERT`. Do not disable certificate verification. |
| `CONFIG_DATABASE_CA` / `TLS_CA_FORMAT`       | Use the complete PEM contents, including BEGIN/END CERTIFICATE lines—not a filename or URL.                                                                                       |
| `MEDIA_HTTP_401` / `MEDIA_HTTP_403`          | Check the server secret, project URL and that they belong to the same Supabase project.                                                                                           |
| `MEDIA_BUCKET_PUBLIC`                        | Make the dedicated app bucket private or configure a new private bucket.                                                                                                          |
| `HOST_SETUP_CONFIG`                          | Correct the initial host email/password/organization variables.                                                                                                                   |
| `DEPLOYMENT_FILE_MISSING` at `DATABASE_SEED` | Commit `seed-quiz.json` in the repository root.                                                                                                                                   |
| `CONNECTION_UNAVAILABLE`                     | Check project pause status, endpoint/port and database network restrictions.                                                                                                      |
| `UNKNOWN`                                    | Share the safe stage/code; do not guess, recreate your database or disable SSL.                                                                                                   |

The regular integration tests and added diagnostic tests passed locally, including simulated media authentication failures, code classification, prevention of secret leakage, production bootstrap and the existing 100-simulated-player flow. Actual hosted TLS and provider access must still be verified after your redeploy.
