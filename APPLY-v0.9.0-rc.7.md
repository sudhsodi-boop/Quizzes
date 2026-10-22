# Quizzes — Design D, game-show participant screens (rc.7)

**Build: 0.9.0-rc.7 · Locally tested candidate · Not deployed by the assistant**

This gives the **assigned (self-paced) participant screens** the **Game Show Bold** look you
picked. If you already uploaded rc.6, this is a small add-on: two changed files.

Nothing changes for you as host. The buzzer round from rc.6 is included unchanged.

## What changed

- Participants playing an **assigned** quiz now see a pink→purple→navy game-show
  gradient, gold accents, colour-keyed answer tiles and bigger buttons.
- Text is larger on laptops and desktops (question 34 px, buttons 18 px, final score
  up to 68 px). **The phone layout is unchanged.**
- Live games, the host console, the projector and the invite page keep the classic purple.
- All body text was measured above the 4.5:1 contrast minimum.

## Install (you already have rc.6)

1. **Back up first.** Settings → Download a private backup → confirm your password.
2. Open your GitHub **Quizzes** repository.
3. Upload these files from **`Quizzes-v0.9.0-rc.7-update.zip`** into the repository root,
   replacing the existing versions:
   - `styles.css`
   - `extensions.js`
   - `index.html`, `display.html`, `rehearsal.html` (version strings)
   - `package.json`
   (The update zip contains more files; they are the same ones you already uploaded for
   rc.6, so re-uploading them is harmless. **Skip `database-config.js` — it is not in this
   zip, and must never be replaced.**)
4. Commit, then in Render/Northflank: **Manual Deploy → Deploy latest commit**.
5. Check `https://<your-service>/healthz` returns `{"ok":true,"version":"0.9.0-rc.7"}`.
6. Open one of your assigned quiz links on your phone and on a laptop. You should see the
   game-show look on the start screen, the question, the answer feedback and the leaderboard.

**Starting fresh instead?** Use `Quizzes-v0.9.0-rc.7-deployment.zip` (complete package) and
skip `database-config.js` when uploading.

## Before you deploy

Finish any **live** game first: an active room lives in the server's memory and does not
survive a restart. Self-paced assignments are unaffected.
