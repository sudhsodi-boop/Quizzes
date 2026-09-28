# Quizzes v0.7 — display and instant-feedback update

**Prepared and tested locally. Not yet uploaded to GitHub or deployed to Northflank.**

This update is based on your repository’s main commit `902dd074180ad16b1a23b725087f4660fbc60d55`. The existing app files matched the local starting source. Your successful database/TLS fix is preserved; `database-config.js` is not changed by the update patch.

## What changes

### Live quizzes
- Larger, more readable desktop workspace fonts and controls.
- A full-width question screen for the host, without the player-score sidebar or a host leaderboard. Joined and answered counts, timer, question/media/options and host controls remain visible.
- **Show player leaderboard** replaces the question on participant devices. It does not display a leaderboard on the host’s screen. Hide it to return players to the question; starting the next question also restores their question screen. The question timer continues if you display the leaderboard during a timed question.
- Automatic round-end leaderboards follow the same player-only behavior. At the end, players receive final results; the host receives a saved-session confirmation and can review Reports outside the live screen.
- Viewport-aware sizing for the question, answer tiles and image, with an optional **Full screen** button.

### Self-paced quizzes — for every host, existing and new links
- Submitting an answer immediately reveals the correct answer(s), the submitted answer, points earned and the running total. Skipping also reveals feedback and earns zero points.
- The participant presses **Next question** after reading feedback. Submitted answers still cannot be changed.
- After the last answer, **See my results & leaderboard** shows the score and a leaderboard of everyone who has **completed that same published quiz so far**. Unfinished attempts are excluded. Equal scores share a rank: 1, 1, 3.
- Nicknames and scores are visible to other finishers. Other participants’ answers, browser tokens, email addresses and account information are not included.
- Open standings refresh approximately every 30 seconds while the page is visible; **Refresh results** refreshes manually. Closing makes the completed-attempt leaderboard final.
- Finishers can review their own answers immediately. Reloading during feedback resumes the next unanswered question (or the results if complete); submitted progress remains saved.
- No answers for unsubmitted questions are revealed while the quiz is open. Existing closed-quiz answer review remains available to participants with an attempt.
- This is a global change: previously submitted answers and existing completed attempts also become eligible for immediate review/results. It is not limited to newly published quizzes.

## 1. Before uploading

1. Finish all active live games. A deployment restarts the server and loses live rooms.
2. Tell friends not to start a live game or edit quizzes during the update. Existing self-paced links and submitted attempts remain stored, but avoid submissions during the brief deployment interruption.
3. Download a private backup from Settings and keep it safely. Each host’s UI backup covers only their workspace; an operator CLI backup covers the full installation. Do not upload backups to GitHub.
4. Do not delete or recreate Northflank, Supabase, the database or the media bucket. No paid upgrade is needed or authorized.

## 2. Upload the changed files to GitHub

1. Download **Quizzes-v0.7-update.zip** and extract it on your computer.
2. Open **https://github.com/sudhsodi-boop/Quizzes**, branch **main**.
3. At the repository root (where `server.js` and `package.json` are), choose **Add file → Upload files**.
4. Upload these **eight files together** from the extracted folder:

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

   They replace the files with the same names. **Do not upload the ZIP itself or place these files inside a new subfolder.** Frontend and backend changes must be installed together.

5. You may also upload `README.md`, `APPLY-v0.7-update.md` and `RELEASE-v0.7.md` as documentation. The patch’s `tests/` directory contains updated tests; developers can merge those into the existing `tests/` directory, but they are not required for the running service.
6. Commit to `main` with a message such as **Improve live displays and add instant self-paced feedback**.

**Do not replace `database-config.js` with anything from an older v0.6 ZIP or old database patch.** This update patch deliberately does not contain that file. The separate full `Quizzes-deployment.zip` includes the current tested TLS fix if a complete source package is needed later.

If main has been changed again since the base commit above, review those changes before replacing files so they are not lost.

## 3. Build and deploy on Northflank

1. Open the existing **Quizzes** service in your Northflank project.
2. Because continuous deployment is off, trigger a **new build of the latest main commit**, then deploy the newly built image. Use the dashboard’s equivalent Build/Deploy action. Restarting an old image alone will not install this update.
3. Check that the build references your new commit and finishes successfully.
4. Keep all existing database, media, password and CA environment variables unchanged. Keep diagnostics disabled, **one instance**, the existing free resource allocation, and HTTP readiness on **port 4173**, path **`/healthz`**. Do not enable autoscaling.
5. After deployment, open:

   **https://p01--quizzes--6nvwfw9l9k8v.code.run/healthz**

   Expected: `{"ok":true}`. This verifies basic service readiness, not all quiz behavior.
6. Open the app and hard-refresh the host tab (**Ctrl+Shift+R** on Windows/Linux, **Cmd+Shift+R** on Mac). Reload participant tabs before starting a new event.

## 4. Quick acceptance check

### Live
- Sign in and confirm existing quizzes, reports, media and accounts are still present.
- Host a short practice quiz and join on a phone. Confirm the host sees joined and answered counts, but no participant score sidebar.
- Try a question with an image and six options. On a typical PC at 100% browser zoom, the whole question and options should fit. Try **Full screen** if desired.
- Toggle **Show player leaderboard**. The phone must show the leaderboard without the previous question, image, answer buttons or answer status. The host must still show the question, without rankings.
- Hide the leaderboard and submit an answer. Confirm counts update; test automatic round-end standings and a next-round transition.
- Minimize/return and reconnect once. Test custom soundtrack and question audio, then finish and check the saved report.

### Self-paced
- Publish a short quiz, or use a suitable existing open practice publication.
- Use different browsers/devices for two test participants. Submit a correct, wrong, multiple-answer and skipped answer as appropriate. Feedback must appear immediately, with **Next question** before moving on.
- Finish participant A; check their score and leaderboard. Leave participant B unfinished: B must not appear in that leaderboard yet.
- Finish B; refresh A’s results and confirm both appear in score order. Equal scores should share a rank.
- Reload and verify saved progress/results. Check the soundtrack continues between unfinished questions and stops on completion/closure.

## Readability limits

The layout was checked in Chromium at host viewport sizes **1280×720, 1366×768, 1920×1080 and 1024×768**, and player sizes **390×844, 768×1024 and 1366×768**, including an image and six options.

No app can display arbitrary amounts of text in every screen size at a large readable font without scrolling. Very long questions/options, very small windows, large accessibility zoom or long leaderboards retain a scrolling fallback rather than clipping essential content. Full screen depends on browser support. Real Safari/iPhone/Firefox checks and hosted capacity testing are still needed.

## Recovery

No database schema change is made. If the updated app misbehaves, pause new games, use GitHub’s normal revert of this update commit (retaining the already-working TLS fix), then build/deploy that reverted source. Do not restore an old database merely to reverse this display update; that could remove newer submissions. Reverting also restores the old delayed self-paced feedback behavior.

Keep continuous deployment off after this update. Continue using the existing free service and Supabase configuration.
