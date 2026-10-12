# Quizzes — event-capacity hardening (rc.4)

**Build: 0.9.0-rc.4 · Locally tested candidate · Not deployed by the assistant**

This is a **capacity and stability** release for a big event with up to 100 participants. It does **not** change any game rule, screen layout, scoring formula, round announcement, self-paced behaviour or admin permission.
It also does **not** require any new environment variable, database migration, paid resource or change to your existing TLS/database configuration.

Read [`EVENT-READINESS.md`](EVENT-READINESS.md) for the full list of what can still break and the day-of playbook.

## What changed

1. **Roster broadcasts are coalesced.** Previously every answer, join and leave sent the full player list to every device. With 100 players that was roughly 100 messages of ~10 KB fanned out to ~101 sockets — about 100 MB of egress per question. It is now capped at about two updates per 700 ms. Measured locally: **25 answers → 1 broadcast** (was 25). Scoring, timers, results and leaderboards are untouched; every phase broadcast still carries a fresh roster.
2. **Question images are optimised at upload.** Raster images (JPEG/PNG/WebP) larger than 400 KB are re-encoded in the browser to at most 1600 px on the long edge, WebP ≈ 0.82 (JPEG fallback). An 8 MB camera photo typically becomes 200–400 KB. GIF and SVG are left alone, and the original is kept whenever re-encoding would not save anything. A toast reports the before/after size.
3. **Larger connection budget for shared venue NAT.** An entire room usually appears to the server as one public address. The budget went from 400 to **1200 connections/minute** per address, and is tunable with `CONNECTS_PER_MINUTE` (minimum 50).
4. **Jittered reconnect backoff.** Dropped phones previously all retried at exactly 2.000 s, so a room-wide Wi-Fi blip produced a synchronised stampede. Reconnects now spread from 0.8 s to 15 s with 0–0.9 s of random jitter per device.
5. **Soundtrack size warning.** Audio over 3 MB now warns that every phone downloads the file. No hard limit, so existing files keep working.
6. **Tunable host-disconnect grace.** `HOST_RECONNECT_MINUTES` (1–60) controls how long a room waits for a returning host before it is closed and reported. The default is unchanged at **5 minutes**. Setting `20` gives more slack on event day.

## Important: re-upload your images once

Image optimisation happens **at upload time**. Images already in your library are still the original large files. After deploying rc.4, open the quiz in the editor, **re-attach each question image** and **Save quiz**. That is what actually shrinks the bytes your 100 phones download.

## Install

1. **Back up first.** In-app: **Settings → Private backup**. Or CLI: `npm run backup`. Store the file privately.
2. Update your source from `Quizzes-v0.9.0-rc.4-update.zip` (changed files) or `Quizzes-v0.9.0-rc.4-deployment.zip` (complete package), exactly as with the previous candidates. Do **not** overwrite or rename `database-config.js`.
3. Redeploy on Northflank. **Turn off automatic deploys before the event** so a stray commit cannot restart the service mid-game.
4. Verify: `https://<your-service>/healthz` must return `{"ok":true,"version":"0.9.0-rc.4"}`.
5. Re-attach images, check the soundtrack warning, run `/rehearsal` with the real quiz.
6. Test with 3–5 real phones **on the venue's Wi-Fi**, with your real images. This is the only check that closes the participant-image gate.

## Optional environment variables

| Variable | Default | Notes |
|---|---|---|
| `CONNECTS_PER_MINUTE` | `1200` | Per public address. Minimum 50. Only raise it if a venue NAT is unusually busy. |
| `HOST_RECONNECT_MINUTES` | `5` | 1–60. Longer grace for a host laptop that sleeps or walks off stage. |

Neither is required. Leave both unset unless you have a specific reason.

## What is still not fixed

- **An active room still does not survive a process restart.** Rooms live in one process's memory. See §5 of `EVENT-READINESS.md`.
- **The participant-image release gate remains HOLD** until you validate on the live site with real phones. rc.4 removes the most likely cause; only your own device test can confirm it.
- **`npm audit` reports 3 moderate advisories**, all transitive under the Word-import library, fixable only by a breaking downgrade. See §2 of `EVENT-READINESS.md`.

## Files changed in this build

`server.js`, `app.js`, `index.html`, `display.html`, `rehearsal.html` (asset version strings), `package.json`, `package-lock.json`, `tests/capacity.test.js` (new), plus this document, `EVENT-READINESS.md` and `RELEASE-v0.9.0-rc.4.md`.
