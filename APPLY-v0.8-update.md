# Quizzes v0.8 — Studio, presentation and assignment update

**Prepared and tested locally. Not yet pushed to GitHub or deployed to Northflank.**

This update incorporates the previous hosting repair and the shared host/player leaderboard update. Use this complete v0.8 update instead of mixing files from older ZIPs.

## What is included

### Join screen
- Original Quizzes branding on a full-screen purple background with a centered form.
- Game code and nickname remain together in one step, as requested.

### Question editor
- Question thumbnails and round navigation on the left.
- An editable question, large media preview and colored answer tiles in the center.
- Question type, time limit, points and round assignment on the right.
- Click the circle on an answer tile to mark it correct. Multiple-answer questions allow multiple correct circles.
- Add/remove answer options, duplicate questions and move a question up. Select thumbnails and open **Organize rounds** to move several questions together.
- **Quiz settings** in the top toolbar opens the title, description and soundtrack controls. Save remains explicit; unsaved edits are not automatically stored on the server.
- Existing document imports still require review. **Answer key & bulk editing** provides the multiline answer tools in the properties panel.
- Responsive stacked editing layout on small screens. Editing long content can scroll; the top Save toolbar stays available.
- Gujarati font support is embedded in the stylesheet, with its SIL Open Font License included. No external font/CDN request is required.
- **No image-reveal effect**, as requested.

### Live hosting
- Compact top toolbar with the game code and participant/answer activity.
- A prominent question, larger centered media, circular countdown and answer count, and large colored answer tiles.
- Existing timer/scoring/music controls remain. Both host and participants see the leaderboard when requested, and the host sees final winners for announcing names.
- The tested game-code generation repair is included.
- Typical question layouts fit the tested desktop viewports. Extremely long text, high zoom or small screens can still scroll rather than clip essential content.

### Self-paced assignments
Choose **Assign quiz** on a saved quiz to configure:
1. **Complete before:** a local date/time, defaulting to approximately 24 hours ahead. Maximum one year ahead.
2. **Question timer:** optional, OFF by default. Uses each question's saved 5–120 second time limit.
3. **Shuffle answer order:** optional, OFF by default. Randomized separately for each browser attempt, stable across reloads and server restarts.

Immediate feedback, saved progress and the final completed-participant leaderboard remain enabled.

**Timer rules:**
- Starting the attempt starts the first question's timer on the server.
- Leaving, refreshing or closing the tab does not reset/pause an active timer.
- Expired questions earn zero and reveal feedback. Expiry is enforced on the next request; this does not require background cron jobs.
- No next-question timer runs while feedback is displayed. **Next question** starts the next timer.
- Reloading a timed feedback screen preserves that waiting step.
- Server time is authoritative. Network outages can prevent an answer from arriving in time; the quiz's closing time still overrides further submissions.
- Self-paced points remain fixed, without a speed bonus. A closing-time extension does not reset a running question timer.

**Existing published links remain untimed and unshuffled.** To use these new options, create a new assignment. The saved source quiz, existing links and submitted attempts are not replaced. Assigned question snapshots and options are immutable; open deadlines can still be extended, but closed assignments cannot reopen.

## Before updating

1. Finish active live games and choose a quiet period. Restarting the service loses active in-memory rooms.
2. Ask participants and friend hosts not to submit/edit during deployment. Existing self-paced submitted progress remains in the database.
3. Keep a private backup. A host's UI backup covers their own workspace; the privileged CLI backup covers the full installation. Never commit a backup to GitHub.
4. Do not delete/recreate Northflank, Supabase or the storage bucket. No paid resource or environment-variable change is needed.

## Upload the EIGHT runtime files together

1. Download **Quizzes-v0.8-update.zip** and extract it on your computer.
2. Open https://github.com/sudhsodi-boop/Quizzes, branch **main**, at the repository root.
3. Choose **Add file → Upload files**. Upload all eight files below from the new ZIP in one commit:

   ```text
   app.js
   extensions.js
   index.html
   styles.css
   workspace-features.js
   server.js
   package.json
   package-lock.json
   ```

   **Do not omit app.js or styles.css.** Mismatching an old script and a new layout caused the earlier hosting failure. Do not upload the ZIP itself or place these files in a subfolder.

4. You may also upload the included README, DEPLOY, release/update guide and font license as documentation. Updated files inside `tests/` and `playwright.config.js` are for developers running the tests; they do not need to be uploaded to run the service.
5. Commit with a message such as **Add Quizzes Studio and advanced assignment settings**.
6. In the existing Northflank service, build that newest commit and deploy the newly built image. Continuous deployment is off. Restarting an old image does not install the update.
7. Retain the existing free allocation, one instance, HTTP port 4173 and `/healthz` readiness. Leave all database/media credentials and CA settings unchanged. Keep diagnostics disabled.
8. Check https://p01--quizzes--6nvwfw9l9k8v.code.run/healthz for `{"ok":true}`.
9. Hard-refresh host and participant tabs: **Ctrl+Shift+R** on Windows/Linux or **Cmd+Shift+R** on Mac. Asset URLs also carry a v0.8 cache version.

The patch does **not** replace `database-config.js`; the known-working strict TLS fix stays intact. The separately refreshed full `Quizzes-deployment.zip` includes the current complete source and that TLS fix.

## Acceptance rehearsal

- Confirm existing accounts, quizzes, media, reports and publications are present.
- Edit a copy of a quiz: navigate thumbnails, change a tile, mark the correct circle, duplicate/reorder, save and reopen. Test Gujarati content if used.
- Host a small practice game. Confirm code/link generation, guest joining, images/audio, answer counts, music, timer, shared leaderboards and final saved report.
- Create an untimed assignment and confirm the old feedback/leaderboard flow still works.
- Create a short timed, shuffled practice assignment. Choose an answer by its text, verify the correct result, and reload to confirm order/progress persistence.
- While feedback is showing, confirm no next countdown runs. Press Next, let that timer expire, and verify zero points and feedback. Finish and view the leaderboard.
- Check two actual participant devices before a larger event. Local tests do not establish 100-player capacity on the free 256 MB service.

## Compatibility and recovery

No database table/schema migration is required. Options, deadlines and shuffle seeds are stored in existing publication/attempt JSON and included in backups. No existing saved quiz or attempt is deleted by this update.

Do not install a pre-v0.8 frontend/backend while timed or shuffled assignments are active: old code does not enforce the new assignment policy. If rollback is necessary, first close those assignments and pause games, then deploy a known-good prior source while retaining the TLS fix. Do not restore an old database merely to reverse a UI change; that could delete newer submissions.

This release is not a complete Kahoot clone: it keeps Quizzes branding, does not include image reveal, paid-plan banners, avatar/character selection or a nickname generator.
