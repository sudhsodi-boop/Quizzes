# Quizzes — live round announcements

**Build: 0.9.0-rc.2 · Test candidate · Not deployed by the assistant**

This update adds the announcements you requested. It includes the Professional Hosting & Studio work from rc.1.

## Live flow

1. Play the round normally.
2. When the host advances to the round’s last question, a prominent announcement appears: **“Last question of Round 1”** (including your custom round name, if any).
3. Click **Start last question**. The question and its timer start together immediately.
4. Reveal the answer and show the existing round-end leaderboard.
5. Click **Next round**. Everyone sees the **Round 2** announcement.
6. Click **Start this round** to proceed.

The same flow repeats for subsequent rounds. A one-question round also gets a last-question announcement before its sole question. After the final round, finish with the final leaderboard—there is no nonexistent next-round announcement.

These are large **in-app announcement screens**, not additional browser windows. They appear on the host, projector and participant screens. They reveal no upcoming question, answers or image, and recover correctly after reconnect/reload. The host chooses when to continue; there is no automatic countdown or image-readiness wait during an announcement. Rehearsal follows the same sequence.

## Install on your existing service

Use **`Quizzes-v0.9.0-rc.2-update.zip`** for the existing v0.8/v0.8.1/v0.8.2 or v0.9.0-rc.1 source tree. This cumulative update includes the required Professional Studio/projector files as well as these announcements. Alternatively, use **`Quizzes-v0.9.0-rc.2-deployment.zip`** for the complete source.

1. Finish active live games and download a private backup. A deployment restarts the server and loses in-memory live rooms.
2. Record the currently working commit/deployment for rollback.
3. Replace/add **all** included files, preserving their folder paths. Keep your existing private database, media, environment and strict TLS/CA settings. Do not commit credentials or backups.
4. Commit/push the updated source, then manually build/deploy that new commit on the existing free Northflank service. A restart of an old image does not install the update.
5. Check `/healthz`: it should include `"ok":true,"version":"0.9.0-rc.2"`.
6. Close old host and participant tabs; reopen/hard-refresh. Run a short two-round quiz with at least two questions in Round 1 to verify the last-question notice, leaderboard and Round 2 announcement. Also try one-question rounds.

No new environment variables, paid resources, database schema change beyond rc.1, or TLS changes are required. The working `database-config.js` is not replaced by the update package.

For the inherited draft, projector, backup format-3 and rollback details, see **`APPLY-v0.9.0-rc.1.md`**; substitute the rc.2 package/build where applicable. The previous ZIPs remain unchanged.

## Release gate still pending

This update is locally tested, not deployed or certified on real participant devices. Complete **`PARTICIPANT-IMAGE-VALIDATION.md`** with the original images and real phones before event use. The new announcements are the requested presentation flow—not a workaround that waits for images. Once the actual question is started, its timer starts immediately as before.

See **`RELEASE-v0.9.0-rc.2.md`** for the current verification record.
