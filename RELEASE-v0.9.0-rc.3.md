# Quizzes 0.9.0-rc.3 — verification record

**September 28, 2026 · Test candidate · Not deployed by assistant**

## Included changes

- Retains the requested last-question and next-round announcement flow from rc.2, including host/projector/participant synchronization and isolated rehearsal.
- Replaces summary-only/read-only admin oversight with an explicit **Open full Studio · view & edit** action for existing saved quizzes. It uses the normal editor, with correct-answer controls, media, notes, rounds, undo/redo, private recovery and Preview & test.
- Adds narrowly scoped administrator GET/PUT/media-upload routes under the target workspace and quiz. Normal ownership routes are not globally bypassed. The administrator role is verified on every request; the path’s owner/quiz relation is verified; saved content and uploads retain the friend’s ownership.
- Requires `If-Match` for oversight saves, with the existing SQL document comparison for overlapping writes. Adds a truthful latest-admin-edit stamp from the authenticated account. Existing owner saves preserve that stamp.
- Admin draft recovery stays scoped to the administrator while referenced quiz/media ownership is checked against the target workspace. Other friends cannot read it or forge the oversight context.
- Adds full-Studio workspace warnings, explicit Save confirmation, return navigation, owner-visible latest-admin-edit information, updated privacy disclosures and existing live leaderboard CSV export in oversight.
- No cross-workspace deletion, quiz creation/copy, impersonated hosting, publication mutation, credentials/recovery access or reading another host’s unsaved drafts was enabled. Saved content is not a live screen recording.
- Overview images are lazy-loaded and audio waits for playback rather than preloading metadata for every collapsed preview.

## Executed verification

| Check | Result |
|---|---|
| Node 22 application suite | **59 passed, 0 failed** |
| TLS/CA regression suite | **5 passed, 0 failed** |
| Expanded Chromium workflow on rc.3 | **1 passed**, about 80 seconds |
| Local PostgreSQL 17: workspace and Professional Studio suites | **23 passed, 0 failed** |
| Production dependency audit | **0 reported vulnerabilities** at execution |

New assertions cover administrator-only access, exact owner/quiz matching, required revisions, stale administrator and owner saves, friend-owned uploads, truthful edit attribution, owner-visible changes, immutable publication content, admin-private recovery and continued blocking of deletion/publication mutation/normal-route cross-workspace writes.

The browser test opens a real full-Studio editor through oversight, edits a question/note, uploads an attachment, verifies no official changes before Save, recovers the admin draft after reload, saves to the friend’s original, verifies the friend can fetch the attachment and see the administrator stamp, and confirms the quiz did not move into the administrator’s library. Existing round announcements, projector/rehearsal, desktop/phone and self-paced workflows also pass. The admin Studio screenshot was inspected.

A first browser-test attempt used the intentionally hidden editor-mode sidebar to leave the editor. The test was corrected to use the visible Back to library control; the full rerun passed. The application was not changed to expose that sidebar for the test.

PostgreSQL tests used fresh dedicated local databases with the test-only non-TLS setting. No production database or credentials were accessed. Production strict TLS was regression-tested separately. Working `database-config.js` remains byte-identical:

`ddee8cdda3f94e3a87b7cddeb793c11ff53712de112bf849b4d654403c6f1495`

## Limits and release status

**Participant-image release gate remains HOLD.** Actual Northflank/Supabase original images, real participant phones, roughly 100 hosted devices, physical sound synchronization and provider deployment are not certified by these tests. No authenticated deployment, paid provisioning, Docker build or production database access was performed.

Admin oversight recovery documents may reference a different owner’s content. A single-workspace backup does not include that other workspace’s quiz/media/account; a full-installation CLI backup is needed to preserve every cross-workspace reference together. The UI records the latest admin edit only, not a full change-history log.

No schema/backup-format change from rc.2 was needed. The default phone question layout, scoring, immediate actual-question timer start, host-only soundtrack control, immutable assignments and friend isolation remain. The announcement is the requested presentation step, not an image-readiness barrier.

This record describes rc.3. Older rc.1/rc.2 documentation is historical where it says oversight is read-only. Use `APPLY-v0.9.0-rc.3.md` for the current permission boundaries and deployment instructions.
