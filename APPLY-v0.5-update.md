# Quizzes v0.5 — update your working site

This is a **source-code update**, not a new hosting setup. Your existing Render/Supabase service, HTTPS address and login can stay in place. The update has been tested locally; it has **not** been deployed to your accounts.

## 1. Back up first

1. Finish all live games. Do not edit quizzes or upload media during the update.
2. On your current site, open **Settings → Download backup ZIP** and confirm your host password privately in the app.
3. Keep that ZIP somewhere private, outside GitHub and the hosting services. Check that it opens and contains `database.json` and your uploaded media.
4. Keep your account recovery code somewhere safe too. Never send passwords, database connection strings or service keys in chat.

## 2. Upload the complete update

1. Download and extract **Quizzes-v0.5-update.zip**.
2. Open your existing GitHub repository: **sudhsodi-boop/Quizzes**.
3. Choose **Add file → Upload files** and upload the extracted source files and folders at the repository root, replacing the existing source. Commit them together, for example: `Quizzes v0.5: rounds, published quizzes and private workspaces`.
4. Do **not** upload the ZIP itself as the app. `package.json`, `server.js`, `app.js` and `render.yaml` must still be directly at the repository root, not inside another folder.
5. Upload the **whole package**, not just `app.js` or `index.html`. The new backend files `quiz-rules.js`, `workspace-features.js`, `document-format.js` and browser file `extensions.js` are required. `package.json` and `package-lock.json` must both be updated.

The package contains **no real database, uploaded user media, credentials, `.env`, recovery files or private backups**. Do not delete or replace your actual data directory, Supabase tables or media bucket.

## 3. Keep the working configuration

- Keep your existing `DATABASE_URL`, optional `DATABASE_PASSWORD`, `DATABASE_CA_CERT`, Supabase URL/key/bucket and HTTPS/proxy settings exactly as they are.
- Do not reset any passwords or create a second Supabase project for this update.
- **One existing host account:** legacy quizzes, reports and media are assigned to that account automatically. No new environment setting is needed.
- **Several existing host accounts:** before deployment, add `WORKSPACE_OWNER_EMAIL` in Render with the email of the existing host who should own the previously shared quizzes/reports/media. This is an ownership decision, not a new password. Other existing accounts become separate, initially empty workspaces. Startup refuses to choose an arbitrary owner if the setting is missing or does not match an account; the diagnostic is `WORKSPACE_OWNER_REQUIRED`.
- Ownership is assigned once. Changing that environment setting later does not transfer content between accounts.

## 4. Deploy

1. Open your existing Render web service.
2. Choose **Manual Deploy → Deploy latest commit**. Restarting alone does not fetch the new GitHub code.
3. Wait for the deployment to show **Live**. Free hosting may take time to build or wake up.
4. Open the same HTTPS site and refresh fully. On a computer, use Ctrl+Shift+R / Cmd+Shift+R if old controls remain.
5. Sign in with your existing account. Confirm your saved quizzes, media and reports are still present before inviting friends.

Do not select a paid plan, paid database, disk or upgrade. No new paid service is required by this release. Private app workspaces still share the same server, database, storage and free-tier quotas.

## 5. Try the new features

| Feature | Where to use it |
| --- | --- |
| Host-controlled music on all devices | Host a live game. Use **Pause/Play music for everyone** and the host volume slider. Participants only get an **Enable sound** action when their browser requires it. |
| Optional round names | Edit a quiz and name a round `Easy`, `Medium`, etc., or leave the name blank. The game shows `Round 1: Easy` or simply `Round 1`. |
| Move questions between rounds | Use a question's round selector, or select several questions and use **Move selected** with an existing/new round. Works with imported drafts too. |
| Multiple correct answers | Choose **Multiple answers**, check all correct options and save. Players select options and submit once. |
| Styled document import | Use **Import questions**. Word/text PDF bold, colored/highlighted answers and checkmarks can be detected. Choose the marking style if needed; review every inferred or ambiguous answer. |
| Round-end leaderboard | The cumulative leaderboard appears automatically after the last question of each round. The host can show/hide it at other times. |
| Clear next-round screen | After a round, use **Next round**, then **Start this round** when everyone is ready. The question timer starts only then. |
| 24-hour independent play | In **My quizzes**, click **Publish 24h**, then copy the publication link. Participants enter a nickname and work through the questions independently. |
| Published results | In **My quizzes → Published for 24 hours**, use **View results** and **Download results CSV**. Results are provisional while open and final after closing. **Close now** closes early. |
| Friend's private login | In **Settings → Invite a friend**, create and privately share the one-use link. It expires after 24 hours. Your friend chooses their own email/password and gets an empty private workspace. |

## Important behavior

- **Music:** the host controls the app's shared soundtrack settings. Browsers can still require a participant's tap to enable audio, and nobody can override a device's physical volume/mute or browser policy. Default music is generated locally, not sample-synchronized; custom tracks are not precisely synchronized either. Question audio has its own manual playback controls and ducks background music.
- **Partial credit:** `max(0, correct selected / correct total − incorrect selected / incorrect total)`. The incorrect term is zero if there are no incorrect options. With two correct choices out of four, one correct choice earns 50%; both correct earn 100%; one correct plus one incorrect earns 0%. This fraction multiplies the live speed-adjusted points or the self-paced fixed points. Scores never become negative.
- **24 hours means the publication's window**, not 24 hours from each person's start. Everyone has the same displayed closing deadline. Submitted answers save as you go and cannot be changed. Unsubmitted choices on the current screen are not saved. Incomplete attempts are included in final results with their submitted points.
- Scores and solutions are withheld from participants until the publication closes; afterward each participant sees only their own attempt/results in the same browser. There is no public self-paced leaderboard or participant account requirement.
- One attempt is enforced by a browser cookie **per published event**. Clearing cookies, using private browsing, another browser or another device can bypass it. It is not verified one-person-one-attempt enforcement.
- Deadlines are enforced on every request. No paid scheduler or background job is needed, even if free hosting sleeps. A sleeping/unavailable server still has to wake before anyone can load the page or submit. The deadline is not extended for downtime.
- Publishing creates a fixed snapshot. Later edits to the saved quiz do not change the published event; publish a new event if needed. Each event supports up to 100 browser attempts. Hosts can create up to 20 publications and 5 invitations per day.
- Friends do not automatically receive your quizzes, uploaded media, reports, results or backup. This is not a shared co-host workspace or automatic quiz-copy feature. App privacy does not isolate data from the installation's server/database operator.
- In-app backups now contain **only the signed-in host's workspace**, including its published attempts. The private operator CLI backup covers the full installation. Store both types securely; see README for restore instructions.

## Quick acceptance check after deployment

1. Open one host computer and one separate phone/browser; host a short two-round quiz.
2. Check that host play/pause/volume reaches the participant after sound is enabled.
3. Check a multi-answer submission, round-end leaderboard and next-round title.
4. Publish a short quiz, complete it from a guest browser, confirm results stay hidden there, then close it as host and refresh the participant's results.
5. Redeem a friend invitation in a separate browser and confirm the friend's library is empty and your content remains private.
6. Download a fresh v0.5 workspace backup after checking everything.

## If something goes wrong

Keep your existing data and hosting variables intact. Use Render's log diagnostic code; do not share secret values. `WORKSPACE_OWNER_REQUIRED` means the legacy multi-host ownership choice described above is needed. Database/TLS/media diagnostic guidance remains in README and DEPLOY.md.

**Do not roll back to v0.4 or earlier against a database containing private friend workspaces.** Older versions do not enforce workspace isolation. Restore the pre-upgrade backup into a separate fresh destination if rollback is genuinely necessary; do not mix old/new source files or overwrite the working database casually.

Live games remain memory-only and cannot survive a deploy/restart. Saved quizzes, completed reports and self-paced submitted progress are persistent when the existing PostgreSQL/Supabase configuration is working.
