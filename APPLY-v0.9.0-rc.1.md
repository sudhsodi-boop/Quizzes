# Quizzes — Professional Hosting & Studio test candidate

**Build: 0.9.0-rc.1 · September 28, 2026**  
**Status: locally tested; NOT deployed by the assistant; participant-image release gate still pending.**

This is a candidate to install and validate, not a claim that the original hosted 5–10-second participant image delay has been resolved. Keep the delivered v0.8.2 packages as your previous version. Question bank, deeper reports and extra game modes are not part of this phase.

## What is included

| Feature | How to use it |
|---|---|
| Separate audience/projector window | Start a saved quiz, then click **Projector ↗**. Move that window to the audience screen and use its **Full screen** button. Keep the host window on your private screen. |
| Private host console | Click **Host console** in the live room. See upcoming question text, your current private note, connection counts, a join QR code and participant image diagnostics. |
| Private question notes | In the Studio question settings, add **Private host notes**, then **Save quiz**. Notes never go into the participant/projector question payload. Your workspace remains subject to the existing disclosed administrator oversight. |
| Real local rehearsal | Choose **Preview & test** in the library or editor. Use the host controls and the simulated phone to practice answers, partial credit, reveal, rounds and rankings. No live room, real attempts or reports are created. |
| Recoverable drafts | Changes are saved to a private server recovery draft after about two seconds without another edit. Look for **Recovery draft saved**. Use **Quizzes → Recover drafts** after reopening the app. |
| Undo/redo | Use the editor toolbar or Ctrl/Cmd+Z; redo with Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y. History is bounded and lasts only for this editor session. |
| Separate official Save | **Save quiz** is still required. Recovery drafts never change saved quizzes, active rooms or immutable published assignments. |

Phones retain the existing participant layout. Questions and timers start immediately. There is **no preparation screen, readiness barrier or image reveal**. Only the host controls the live broadcast soundtrack.

### Important use notes

- Projector is read-only and intentionally silent, preventing a second copy of the soundtrack on the same computer. Question audio remains in the existing host/participant flow; the projector identifies audio questions but does not play another copy.
- Share only the audience/projector window, **not the entire desktop or private host window**. A read-only projector page cannot protect private information shown elsewhere on your physical screen.
- The projector URL contains a room-specific audience token in its fragment. It is not a host credential, but anyone with it can watch the public room while the host session permits it. Do not post it publicly. Up to four projector connections are allowed. Signing out revokes displays attached to that session.
- Projector reconnection restores only public current state. Host sign-in-session replacement requires displays to reconnect; expiry/revocation denies the old session. A stopped/redeployed server loses in-memory live rooms, as before.
- Rehearsal is a **simulation on this computer**, not the actual phone layout or participant-network certification. Its sound button tests a local tone, not the entire room’s audible music. Popups must be allowed for rehearsal/projector.
- Recovery is not an offline cache: loss of the network, failed authentication, conflicts, or closing immediately after editing can prevent the latest changes reaching the server. Wait for the saved confirmation. Existing unsaved-change navigation warnings remain.
- Undo/redo: up to 30 snapshots, approximately 8 MiB of serialized history; it resets when reopening the editor. The latest server recovery draft survives a restart. Maximum 20 private drafts per host, 200 questions/20 rounds per draft and 500,000 JSON characters. Delete old recovery drafts when needed.
- If another tab has changed a draft or saved quiz, stop and recover the newer work, or use **Make a separate copy**. Do not blindly overwrite it. Close/reload all pre-upgrade host tabs before editing; legacy API clients that omit revision preconditions are still accepted for compatibility.

## Install on the existing free Northflank service

No new paid resources, service plans, accounts, domain or environment variables are required. Keep the working Supabase connection, media storage, verified TLS and CA settings unchanged. Never share your credentials.

1. **Finish active games.** A deployment restarts the server and ends in-memory live rooms.
2. Download a private backup from **Settings → Download backup ZIP**. This is the signed-in host’s workspace. Friends should back up their own workspaces; the established CLI backup covers the entire installation. Keep backups private and outside GitHub.
3. Record your currently working GitHub commit/deployment for rollback. Installation of v0.8.1/v0.8.2 was not verified by the assistant.
4. Choose a package:
   - **`Quizzes-v0.9.0-rc.1-update.zip`**: candidate update over the existing v0.8/v0.8.1/v0.8.2 application. Replace/add the included source files, preserving folder paths. Include every new file and the Dockerfile changes.
   - **`Quizzes-v0.9.0-rc.1-deployment.zip`**: complete candidate source for a clean source-tree replacement. This is not a database backup. Preserve your existing private environment and infrastructure configuration.
5. Do **not** commit `.env`, database exports, backups, media credentials, private CA keys or local data. The update intentionally does not replace `database-config.js`.
6. Commit/push the candidate source to your selected GitHub branch. With Northflank continuous deployment disabled, manually build/deploy **that new commit**, using the same free service and existing settings. Merely restarting an old image does not install the update.
7. After the build completes, open:
   `https://p01--quizzes--6nvwfw9l9k8v.code.run/healthz`
   Expected candidate response includes `"ok":true,"version":"0.9.0-rc.1"`.
8. Close old host tabs, reopen and hard-refresh. Sign in and verify your existing quizzes, media, assignments and reports. Existing data is retained; startup adds the private draft table automatically.
9. Test one draft recovery, one isolated rehearsal, a projector window, a live round and one self-paced submission. Check the actual participant phones’ sound activation and text wrapping.
10. Complete **`PARTICIPANT-IMAGE-VALIDATION.md`** using the original images and real devices before treating this candidate as cleared for an event. Report the build, device/browser/network, tested participant count, observed delays and console image counts—never passwords or private keys.

The assistant has no authenticated GitHub/Northflank deployment access and has not pushed, deployed or purchased anything.

## Backups and rollback

- This candidate writes **backup format 3**, including private editor drafts. Its restore script accepts formats 1, 2 and 3; older backups start with no drafts.
- Do not restore a format-3 backup with an older restore script. Restore only into a new empty deployment, as before.
- To roll back application code, finish games, take a candidate-version backup and redeploy the recorded previous v0.8.x commit. Keep the same database/media infrastructure. The extra draft table can remain; do not delete it manually.
- Old application versions cannot display/export the new drafts. Editing/saving with old code can discard new private-note/revision fields. Preserve the candidate backup before rollback if those matter.
- Never roll back to v0.4 or earlier against a database containing separate private friend workspaces.

## Verification records

See **`RELEASE-v0.9.0-rc.1.md`** for executed local tests and limitations. Package-internal `SHA256SUMS.txt` verifies included source files; `Quizzes-v0.9.0-rc.1-SHA256SUMS.txt` verifies the two ZIPs.
