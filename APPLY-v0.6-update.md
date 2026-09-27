# Quizzes v0.6 — admin oversight, removable results, extensions and music

This is a complete source update, including the earlier v0.5 improvements. It is locally tested and **not yet deployed to your live site**. No paid service or new hosting account is required.

## Update your existing site

1. **Finish live games and download a backup** from Settings before updating. Keep it privately outside GitHub. Avoid editing/uploading while backing up or deploying.
2. Download and extract **Quizzes-v0.6-update.zip**.
3. In your existing GitHub repository, **sudhsodi-boop/Quizzes**, choose **Add file → Upload files**. Upload the complete extracted source, replacing the matching files, and commit together. Keep `package.json`, `server.js` and the other source files at the repository root. Do not upload only the ZIP or mix old/new source files.
4. In **Render → your existing service → Environment**, add:

   **`SITE_ADMIN_EMAIL` = your existing main Quizzes login email**

   Use the email of the account you already sign into Quizzes with—not necessarily your Render or Supabase account email. Enter it directly in Render. It is not a password. Do not send passwords or keys in chat.
5. Keep your working `DATABASE_URL`, optional `DATABASE_PASSWORD`, `DATABASE_CA_CERT`, Supabase URL/key/bucket and all other hosting settings unchanged. Do not delete the database or uploaded media.
6. Choose **Manual Deploy → Deploy latest commit**. Wait for **Live**, then refresh the same HTTPS site and sign in again.
7. Confirm that your existing quizzes/results are present and **Settings → Admin oversight** appears in your main account. It must not appear in your friend's account.

If `SITE_ADMIN_EMAIL` is absent or does not match a host account, no account receives the oversight role. Ordinary friend signup, profile data and invitations cannot grant that role. Use an existing account's exact email; surrounding spaces/capitalization are normalized.

### If you have not installed v0.5 yet

The earlier ownership migration is included. One existing host automatically keeps the legacy quizzes/media/reports. If several hosts existed in the old shared-workspace app, also set **`WORKSPACE_OWNER_EMAIL`** to the existing account that should own the old shared content. This is a one-time ownership choice, distinct from `SITE_ADMIN_EMAIL`, which controls ongoing read-only oversight. An ambiguous migration stops with `WORKSPACE_OWNER_REQUIRED` rather than guessing or deleting content.

## 1. View friends' workspaces as the site administrator

Open **Settings → Admin oversight → Choose workspace**.

Your designated main account can read:
- Saved quizzes, rounds, questions, correct answers and linked media.
- Completed live reports and leaderboards.
- Self-paced publication progress/results and results CSV, including provisional results while open.

Friends still cannot view one another's workspaces. Your normal library and in-app backup remain scoped to your own account. Oversight does **not** grant editing, hosting, deadline changes or deletion of a friend's content. It does not reveal passwords, recovery codes, private backup files, unsaved editor changes or a live recording of their screen. Refresh/reselect a workspace to see new saved work.

The invitation page, signed-in workspace notice and Settings explain that the designated site administrator can view quizzes/results. Inform existing friends about this access change before using it.

## 2. Remove past results when you want

- **Reports → open a report → Delete report** removes that saved live report after confirmation.
- **Reports → Delete all saved reports** clears the saved live reports in your own workspace after confirmation.
- **My quizzes → Published quizzes → Delete results** removes a **closed** publication and all its participant attempts. Its old link then stops showing the quiz/results. An open publication must first be closed before deletion is permitted.

These actions do not delete your saved source quiz or uploaded media. They do not delete friends' reports, already downloaded CSVs, backup files or copies someone has retained. Live-game results already displayed on a participant's device cannot be remotely erased. Dashboard totals reflect the reports that remain saved.

Deletion is permanent in the current database; there is no Undo button. Export anything you need before confirming. Recovery from a private backup is a separate fresh-destination restore operation, not a one-click undo.

## 3. Extend a self-paced quiz beyond 24 hours

In **My quizzes → Published quizzes**, click **Extend time** on an open publication.

Choose a later date/time and press **Save new deadline**. The form uses your device's local time zone and initially suggests one additional day. You may select another later time, up to one year ahead of the current server time. You can extend again while it remains open.

- The same participant link and submitted progress are retained.
- One-attempt-per-browser behavior is unchanged; extension does not grant another attempt.
- Participant scores and correct answers remain hidden until the new closing deadline.
- Open participant pages check metadata about every 30 seconds while visible, and when returning to the tab. Deadline updates do not clear their current, unsubmitted selection or typed answer. Server-side checks always enforce the actual deadline.
- **Closed quizzes cannot be extended or reopened**, because participants may already have seen the answers. Publish a new event if you need another session.
- Extend before the deadline; a free-hosting delay or network outage does not automatically prolong it.

The participant cookie remains lightweight browser identification, not verified person-level enforcement. Clearing cookies, private browsing or another browser/device can bypass the limit.

## 4. Hear linked music during self-paced play

1. Edit the source quiz and upload/select its background soundtrack using the existing music field.
2. Save, then publish it. The published snapshot includes that soundtrack.
3. Participants' **Start my attempt** gesture tries to enable playback. If blocked, they can tap **Enable sound** on the quiz page.

The linked track loops across questions without restarting on each submission, at the app's default background volume. Question audio remains manually playable and temporarily lowers the background music so it can be heard. Music stops when the attempt is finished or the page learns that the quiz is closed. Signed media access is renewed when needed.

A published event is still a fixed snapshot: adding/changing the source quiz's soundtrack afterward does not change an already published event. Republish to use the changed soundtrack. No linked soundtrack means no added self-paced background track. Live-game host-only music controls remain unchanged; self-paced devices do not form a synchronized live broadcast.

Browser/operating-system sound rules, device mute and volume cannot be overridden. Use audio you have permission to share. Custom audio downloads use your shared free-tier storage/bandwidth; compact files are preferable for many participants.

## Quick check after deployment

- Main account: see Admin oversight and read a friend's saved quiz/results.
- Friend account in another browser: no Admin oversight and no access to another friend's content.
- Delete a test report and refresh; check that the source quiz remains.
- Publish a short quiz with music, begin on a separate phone/browser, and extend it while open. Confirm the later deadline appears and the current answer is preserved.
- Finish the attempt, confirm the music stops and answers remain hidden, then close the publication as host and refresh results.
- Try a closed publication: no Extend time action; Delete results requires confirmation.

**Keep the Free plans and existing configuration.** All accounts share installation/provider quotas. No paid provisioning, provider login or remote deployment was performed for this update. Do not use pre-v0.5 code against a database containing separate friend workspaces; those older versions lack workspace isolation.
