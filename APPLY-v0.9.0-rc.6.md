# Quizzes — buzzer round (rc.6)

**Build: 0.9.0-rc.6 · Locally tested candidate · Not deployed by the assistant**

This adds one **optional** question type for live quiz nights. It does **not** change any existing game rule, screen layout, scoring formula, round announcement, self-paced behaviour or admin permission, and it requires no new environment variable, no database migration, no paid resource and no change to your TLS/database configuration.

## What you get

A **Buzzer · music identification** question, for the round where you play a song over the hall speakers and the first hand up wins the right to answer.

- The host plays the clip from the host laptop, over the hall speakers. Phones stay silent — the same rule as your existing soundtrack policy.
- Players press **BUZZ** on their phones. Names appear on the host screen **fastest first**.
- The host asks the first name and taps **Correct** or **Wrong**. Wrong moves down the queue to the next player.
- Earlier buzzers score more: `points × (1 − 0.5 × seconds elapsed ÷ scoring window)`, never below 100.
- The projector shows the live queue with each player's reaction time.

## How to build one

1. Open the quiz → **Answer type → Buzzer · music identification**.
2. Attach the music clip (MP3/WAV/OGG, up to 10 MB) exactly as you attach an image today.
3. Type the **expected answer**, one spelling per line. Only the host sees it.
4. Set **Scoring window · seconds** — this is not a countdown, it is the window the speed bonus is measured against. 30 seconds works well for a clip.
5. Save the quiz. In the Studio rail the question is labelled **Buzzer**.

On the night: start the question, press play on the host screen, watch the queue fill, and award in order. **Close buzzing** when you want no more buzzes; **Reveal answer** ends the round.

## Good to know

- A buzzer question has **no countdown**, so nothing on screen is racing a timer. Questions and timers in the rest of the quiz start immediately, exactly as before.
- In an **assigned (self-paced)** quiz there is no host, so a buzzer question appears as a normal **type-the-answer** question graded against the same expected-answer list.
- **Rehearsal** shows the clip and an answer box, so you can check the clip plays and the spelling matches.

## Install

1. **Back up first.** Settings → Private backup, or `npm run backup`. Store the file privately.
2. Update your source from `Quizzes-v0.9.0-rc.6-update.zip` (changed files) or `Quizzes-v0.9.0-rc.6-deployment.zip` (complete package), exactly as with the previous candidates. Do **not** overwrite or rename `database-config.js`.
3. Redeploy on Northflank. Keep **automatic deploys off** before an event.
4. Verify: `https://<your-service>/healthz` must return `{"ok":true,"version":"0.9.0-rc.6"}`.
5. Add one buzzer question to a copy of the real quiz and run it with 3–5 phones in the room. On event day, play the clip from the host laptop through the hall speakers.

## Before you deploy

Finish any **live** game first: an active room lives in the server's memory and does not survive a restart. Self-paced assignments are unaffected.
