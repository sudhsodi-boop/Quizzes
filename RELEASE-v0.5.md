# Quizzes v0.5.0 — release verification

Prepared September 27, 2026. This package updates the existing Quizzes application; it has not been pushed to GitHub or deployed to Render/Supabase by the assistant.

## Included

- Host-only broadcast soundtrack play/pause/volume, browser sound-enablement handling and failed custom-track grant renewal.
- Optional round names, individual/bulk question moves, last-question notices and host-paced next-round title screens.
- Cumulative round-end leaderboards and manual host display/hide controls.
- Word/text-PDF formatting hints, checkmarks and explicit multiple answer keys, with mandatory draft review and ambiguity warnings.
- Multiple-answer editing/play with bounded partial credit and incorrect-selection penalties.
- Persistent 24-hour self-paced publications, browser-level attempt restriction, independent progress, post-close participant solutions and host results/CSV.
- Single-use friend invitations and private per-host content, media, reports, publications and in-app backups.
- Non-destructive legacy ownership migration and v1/v2 backup restore support.

## Verification performed

| Check | Result |
| --- | --- |
| Fresh dependency install on Node 22.23.3 | Passed |
| npm audit with the release lockfile | 0 reported vulnerabilities |
| Full SQLite/local-media suite | 37 tests passed |
| Full suite with local PostgreSQL 17 and a local Supabase Storage contract fixture | 37 tests passed |
| Expanded Chromium host + mobile participant + friend workspace scenario | 1 comprehensive scenario passed |
| Simulated live-room load | 100 connected participants; 101st rejected |
| Migration/restore | Legacy sole-owner assignment, ambiguous multi-host refusal, explicit owner selection, repeat-run stability, v1 restoration and v2 backup/restore checked |
| Self-paced durability | Restart resume, duplicate-submission race, browser attempt reuse, deadline rejection, incomplete attempts and post-close disclosure checked |
| Privacy boundaries | Cross-host quiz edits/deletion, media access, live creation, results/publications and scoped backup contents checked |
| Browser feature flow | Multiple-correct editor, bulk move, custom round titles, manual/automatic leaderboard, invitation signup, self-paced completion and final result checked |
| Import formatting | Direct/inherited Word styles, bold short answer, color/highlight/checkmarks, multiple keys, all-bold ambiguity and PDF highlight annotation checked |
| Existing user data | Original data directory and working hosting credentials/configuration were not changed |

The expiration tests move deadlines in disposable test databases; they do not wait 24 real-world hours. The custom-music renewal test simulates an audio error and verifies a fresh usable signed source. No passwords or real provider secrets are included in these test artifacts or the source archive.

## Not claimed

- No remote GitHub/Render deployment or authenticated access to the user's provider accounts.
- No new real-device 100-person event, Safari/Firefox/mobile speaker verification or hosted TLS/media qualification for this update.
- No sample document from the user was available. Arbitrary document layout, unusual/flattened styling and OCR are not guaranteed.
- No independent security/accessibility audit, production availability guarantee or Docker image build.
- No verified person-level attempt restriction or protection against an installation operator accessing its database.
- No sample-synchronized audio, automatic quiz copying between workspaces, managed backup schedule or paid hosting provisioned.

## Update safely

Follow **APPLY-v0.5-update.md**. Back up first, finish live games, upload the complete source and use Render's **Manual Deploy → Deploy latest commit**. Keep existing database/media passwords, CA and settings. Do not roll back to pre-v0.5 code against a database containing private friend workspaces.
