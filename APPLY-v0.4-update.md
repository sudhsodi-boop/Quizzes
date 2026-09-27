# Quizzes v0.4 — classic game-show look, document import and default music

This update is for your **existing working GitHub → Render → Supabase installation**. It keeps Quizzes branding, your nonprofit-only purpose and the existing host login, quiz types, rounds, scoring, reports, recovery and backups. No paid service or new account is needed.

## Before updating

- Finish any live game first. Deploying restarts the server; in-progress rooms are held in memory.
- In Quizzes **Settings**, download a private backup ZIP and keep it somewhere safe. It contains sensitive account and quiz data; do not upload it to GitHub or send it in chat.
- **Do not change or reset your Render environment variables, database, certificates, bucket or passwords.** No database schema change is needed for this update.

## Install on your existing website

1. Download and extract **Quizzes-classic-update.zip**.
2. Open **github.com/sudhsodi-boop/Quizzes**, on the branch your Render service deploys.
3. Choose **Add file → Upload files**. Upload the extracted contents into the repository root, replacing existing files. Keep the `tests` directory and its subdirectories in their existing relative locations.
4. Upload **both `package.json` and `package-lock.json`**. They add the document-reading dependencies. The new runtime files `quiz-import.js`, `quiz-import-worker.js` and `quiz-sound.js` must also be present at the root, beside `server.js`.
5. Commit the changes. Do not upload only the ZIP, and do not put all the files inside an extra enclosing folder.
6. In Render, choose **Manual Deploy → Deploy latest commit**. A restart alone does not install the new code. The deployment runs the existing `npm ci --omit=dev` build command.
7. After deployment succeeds, reload your website. You should see **Import questions** on the dashboard and My quizzes page. The startup package version is now `quizzes-live@0.4.0`.

The update bundle also includes the previous safe database/host-setup helpers to keep the installation consistent. An existing host account is not overwritten. Your saved quizzes and uploaded media remain in Supabase.

## What changed

### Classic game-show appearance

- Purple geometric backgrounds with gentle motion.
- Red, blue, yellow and green answer tiles with distinct shapes, plus two additional colors for questions with five or six choices.
- More prominent game code, question display and countdown; the last five seconds get visual emphasis.
- Correct-answer highlighting after reveal and an animated final podium.
- Responsive host/player layouts and reduced-motion support.

These are original Quizzes designs and sounds. This is not a pixel-for-pixel Kahoot copy or a claim to include every Kahoot feature.

### Import existing questions from documents

Select **Import questions**, then upload a **text PDF, Word `.docx`, UTF-8 `.txt`**, or paste your questions. The app extracts a draft with rounds, question text, answer choices and recognized correct answers. It does not save automatically: compare the extracted source, correct any problems, tick the review acknowledgement and select **Save quiz**.

Start with the included **Quiz-import-example.txt**. It demonstrates numbered questions, A)–D) options, `Answer: B`, true/false and typed answers. A final `Answer key:` section is also supported when question numbers are unique.

Important limits:

- 5 MB per file; text PDFs up to 50 pages; at most 200,000 extracted characters, 200 questions and 20 rounds.
- Explicit question numbers and A)–F) option labels work best. Automatic Word list numbering, complex tables, columns or unusual formatting may not extract correctly; use the source comparison or paste explicitly numbered text.
- Missing, conflicting or ambiguous answer keys are left for you to select. The app does not invent an answer. Review every question even when its answer was recognized.
- This is extraction of existing questions, not AI generation of new questions from general articles.
- Scanned pages/photos need OCR first; old `.doc` files and embedded images/audio are not imported. You can still attach question images/audio manually in the existing editor.
- Documents are processed on your own Quizzes server, without an external AI/document service. Uploads are not retained as files. Only the quiz you choose to save is stored.
- Processing is limited to one document at a time, with a timeout and size/memory safeguards. For a live event, prepare/import your quiz beforehand.

### Automatic background music on host and player devices

If no custom soundtrack is uploaded, an original procedural soundtrack plays during the lobby, questions and results. The final five seconds have countdown sounds; reveals and the final podium have short effects. Music stops after the finish celebration or when you leave/disconnect.

- **Host game** and **Join game** actions attempt to enable sound. Browsers require a user gesture; after a reload or on a restrictive browser, tap **Enable sound** once.
- Each device has its own **Mute sound** and **Volume** controls. Preferences are saved on that device. Muting the host does not mute all participants.
- Custom music, if uploaded, replaces the default on both host and player devices, and continues across questions. Its playback controls remain available.
- Question audio remains manually playable; background audio is lowered while it plays.
- Music is generated or played locally on each device. It is not a broadcast of the host's speakers and is not sample-synchronized between devices. In a shared room, participants can mute their devices to avoid overlapping playback.
- Background-tab and mobile operating-system restrictions may suspend audio. This never changes server scoring/timing.

## Quick online test after deployment

1. Import `Quiz-import-example.txt`; verify four questions in two rounds and the indicated correct answers. Review and save.
2. Host it without uploading music. Check that the default soundtrack starts and the sound controls work.
3. Open the join link on a second device, join with a nickname and confirm that device can hear sound too. Tap Enable sound if prompted.
4. Answer a question, reveal answers, advance and finish. Check scores, the podium and sound stopping after the celebration.
5. Confirm your previously saved quizzes and media are still available.

## Verification performed before delivery

- Local automated suite: **26 passing tests**, including real DOCX/text-PDF extraction, missing/conflicting answers, malformed/oversized input, authentication, persistence, recovery/backups and 100 simulated participants.
- A separate clean install using **Node.js 22.23.3** and `npm ci --omit=dev` also passed all **26 tests**, matching the Node version previously reported by the deployment.
- Chromium end-to-end host/mobile-player scenario passed: document upload/paste → explicit review → save → default music generated on both screens → independent mute → answer/reveal → final podium. The existing custom music/media/reconnect/recovery/backup flow also passed.
- Production dependency audit: **0 reported vulnerabilities** at packaging time.

The new version has not yet been deployed or tested in your Render account. Local tests do not establish hosted 100-player capacity or real-device audio compatibility. Free-host sleep, pause and quota limits still apply; no paid upgrades have been made. Docker was updated but not built during this update.
