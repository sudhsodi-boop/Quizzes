# Quizzes — round announcements and full admin Studio

**Build: 0.9.0-rc.3 · Locally tested candidate · Not deployed by the assistant**

## 1. Round announcements

The previously confirmed announcements remain included:

1. Before the last question of a round, everyone sees **“Last question of Round 1”**, with your round name if supplied.
2. The host clicks **Start last question**. The question and full timer begin together.
3. Show the answer/results and the round-end leaderboard.
4. The host clicks **Next round**; everyone sees **“Round 2.”**
5. Click **Start this round** to proceed.

These are prominent in-app announcement screens on host, projector and participants—not extra browser windows. A one-question round gets the last-question notice too. The final round ends in final results without a fictitious next round. Rehearsal uses the same flow. No upcoming question or image is revealed during an announcement, and Start never waits for image-loading diagnostics.

## 2. Main-admin oversight now opens the full Studio

Go to:

**Settings → Admin oversight → Choose workspace → Open full Studio · view & edit**

You get the same question editor used for your own quizzes:

- Every saved question and round, with question navigation/thumbnails.
- All answer choices, correct-answer circles, typed-answer keys and partial-credit question settings.
- Images/audio, soundtrack, time limits, points and private speaker notes.
- Add, remove, duplicate, reorder and edit questions/rounds inside that saved quiz.
- Preview & test, undo/redo and recoverable drafts.
- **Save quiz** updates the selected friend’s original saved quiz after an explicit confirmation.

A highlighted banner always identifies whose workspace you are editing. **Back to admin oversight** returns to that workspace’s overview. The quiz remains owned by the friend and does not appear as a duplicate in your own library. New attachments uploaded from this editor belong to the friend’s workspace, even before the quiz is saved; they are attached to the official quiz only after Save.

The friend’s saved quiz records the latest administrator-save email and time, visible when opening the editor. This is a latest-edit stamp, **not a complete audit-history system**. In-progress rooms and already-published assignments keep their existing immutable snapshots.

### Permission boundaries

| Main administrator action | Available? |
|---|---|
| Open all saved quiz content in full Studio | Yes |
| Edit/save an existing friend’s quiz | Yes, with confirmation and revision conflict protection |
| Upload quiz media/soundtrack to that workspace | Yes |
| View available live/self-paced results | Yes |
| Download the existing live leaderboard CSV | Yes |
| Delete a friend’s entire quiz, report or publication | No |
| Host as the friend, create quizzes in their workspace, or copy across workspaces | No |
| Change/close/extend their self-paced publications | No |
| See passwords, recovery codes, private backup contents or their unsaved drafts | No |
| Watch their physical screen or browser activity | No |

Removing a question or round **inside a quiz you are editing** is allowed; deleting the entire friend-owned quiz/report is not. Friends still cannot view or edit each other’s content. Signup and workspace privacy notices now disclose the designated main administrator’s saved-quiz editing access. This explicitly replaces the former read-only oversight policy; older release guides describe their older builds.

### Drafts, conflicts and backups

- Your unsaved admin edits are recovery drafts in **your administrator account**, not the friend’s draft list. Recover them from **My quizzes → Recover drafts**; they are labeled with the target workspace.
- Official Save is still required. A newer owner/admin Save causes a conflict rather than a silent overwrite. Oversight Save requires a revision precondition. Close/reload old host tabs, since legacy normal-workspace clients without revision preconditions are still accepted for compatibility.
- Cross-workspace “Make a separate copy” is disabled in oversight mode. If a conflict occurs, retain the recovery draft, reopen the current original and reconcile changes deliberately.
- Individual in-app backups remain workspace-scoped. The friend’s backup includes their saved quiz/media. The administrator’s backup can contain their private oversight recovery draft text, but **does not include that other owner’s quiz/media/account**. Use the full-installation CLI backup if you need to preserve all cross-workspace references together. Keep every backup private.
- Backup format remains 3; no new schema migration beyond the earlier candidate is required.

## Install on the existing free service

The candidate is **not yet on your live website**. To see the changes there, deploy this build:

1. Finish active live games and download private backups. Record the currently working commit for rollback.
2. Use **`Quizzes-v0.9.0-rc.3-update.zip`** over your existing v0.8/v0.8.1/v0.8.2 or rc.1/rc.2 source tree. Replace/add all included files with folder paths intact. Alternatively, `Quizzes-v0.9.0-rc.3-deployment.zip` contains the complete candidate source.
3. Keep your current private environment, Supabase/media configuration, verified TLS/CA and free Northflank service. Do not commit credentials, local data or backups. The update does not replace `database-config.js`.
4. Push the source commit to GitHub, then manually build/deploy **that new commit** on Northflank. Restarting an old image is not an update.
5. Check `/healthz`; it should include `"ok":true,"version":"0.9.0-rc.3"`.
6. Close old tabs and hard-refresh host and participant pages. Sign into the designated main account. The existing `SITE_ADMIN_EMAIL` setting identifies that account; friends cannot grant themselves the role. If it is already configured for your oversight panel, no new setting is needed.
7. Test a two-round quiz, then open a friend’s test quiz through admin oversight and verify full Studio, a deliberate Save, friend ownership and correct attachment playback.
8. Complete **`PARTICIPANT-IMAGE-VALIDATION.md`** with the original problematic images and real participant phones. That release gate is still pending.

No paid resource or authenticated deployment was performed by the assistant. See `RELEASE-v0.9.0-rc.3.md` for local checks. Previous packages are preserved. To roll back, back up first and redeploy the recorded previous commit; older builds do not support these oversight edits and can discard latest-admin-edit metadata when saving.
