# Quizzes — big-event readiness

**Build:** v0.9.0-rc.4 · **Purpose:** what can still break with ~100 participants, and what to do about it.
Everything below describes **this code running on your current free hosting** (Northflank free sandbox — 0.1 CPU / 256 MB RAM / one replica — plus Supabase free PostgreSQL and private media bucket). Nothing here is a guess about "the cloud"; it is what the code actually does.

---

## 1. Read this first: the honest summary

For 100 participants the app is **structurally capable** — the game logic, scoring, timers and reports are server-authoritative and were exercised with 100 players in tests. The real risks for a live event are **not** the quiz rules. They are:

1. **Bandwidth on a shared free container** (images and soundtrack downloaded by 100 phones at once).
2. **One venue Wi-Fi network** carrying 100 devices.
3. **A container restart during the event**, which still loses an active room.

Risk 1 and 2 are now much smaller than before (see §3). Risk 3 is **not fixed** and cannot be fully fixed on a free single-replica plan. §5 is the plan for it.

---

## 2. Weak points found by reading the code, ranked

| # | Weak point | How bad for 100 players | Status in rc.4 |
|---|---|---|---|
| 1 | **Question images are served at their original size.** One 8 MB phone photo × 100 devices ≈ 800 MB of egress at the exact second a question starts. | **High.** This is the most likely cause of the "images appear 5–10 seconds late" symptom. | **Reduced.** Images are re-encoded in the browser before upload (max edge 1600 px, WebP/JPEG ≈ 0.82). **Measured in the browser test: 6.18 MB → 13 KB.** Real photos typically land at 150–400 KB. GIF/SVG untouched; original kept if re-encoding would not save anything. |
| 2 | **One full roster broadcast per answer.** 100 answers × ~10 KB × 101 sockets ≈ 100 MB of egress per question. | **High.** Saturates the container exactly while answers are arriving. | **Fixed.** Roster updates are coalesced to about 2 per 700 ms. Measured: 25 answers → 1 broadcast (was 25). Scoring, timers and results are unchanged. |
| 3 | **All phones usually share one public IP.** The connection budget was 400/minute for that single address. A Wi-Fi blip that reconnects the room 4–5 times in a minute could lock everyone out with 403 for up to a minute. | **Medium.** Only bites on a flapping network, but then it bites everyone at once. | **Raised.** Default is now 1200/minute (tunable with `CONNECTS_PER_MINUTE`, minimum 50). |
| 4 | **Reconnect storm.** Every dropped phone retried at exactly 2.000 s, so 100 phones hit the server in the same instant. | **Medium.** | **Fixed.** Reconnects now use jittered exponential backoff (0.8 s → 15 s cap, plus 0–0.9 s random jitter). |
| 5 | **Soundtrack size.** Every phone downloads the whole audio file. A 10 MB MP3 × 100 = 1 GB, competing with question images. | **Medium–High** if the file is large. | **Warned.** Uploads over 3 MB now warn: "Every phone downloads this." Verified in the browser test. No hard limit, so existing files still work. **Keep your soundtrack under ~3 MB.** |
| 6 | **A restart/deploy destroys an active room.** Rooms live in one process's memory. Players would have to rejoin a brand-new code and lose their scores. | **High if it happens; unlikely to happen mid-event.** | **Not fixed.** See §5. This is the one remaining "crash in the middle" risk. |
| 7 | **Host laptop disconnect.** If the host drops for more than 5 minutes, the game is automatically ended and the report saved. | **Medium.** A sleeping laptop or a walk to the stage can do it. | **Tunable.** `HOST_RECONNECT_MINUTES` (1–60, default unchanged at 5). Set it to 20 for an event if you want more slack. |
| 8 | **Supabase free project pauses after a week of inactivity.** Then the app cannot start. | **Low** if you use the site in the days before the event. | Not a code issue. Open your quiz and run a rehearsal the day before. |
| 9 | **Venue Wi-Fi itself.** Client isolation, captive portals, or a cheap router can stop 100 phones from ever reaching the page. | **Highest real-world risk**, and no app change can fix it. | See §4. |
| 10 | **100 is a hard cap** (`fail("This game is full (100 players)")`). | Informational. | Unchanged. If 100 real people plus a few extra devices join, the 101st is rejected — that is intentional. |

Also worth knowing:

- **Three rooms maximum per host**, and the host must end one before starting another.
- **Projector limit:** 4 display connections.
- **Nicknames are unique per room.** A duplicate is rejected; a returning phone uses its saved resume token, so it keeps its name and score.
- **Answers are one per player per question** and are locked in; a late answer is rejected by the server, not by the phone's clock.
- **`npm audit` reports 3 moderate advisories**, all transitive under the Word-import library (`mammoth` → `argparse` → `sprintf-js`) and the ZIP/backup path. The only available fix is a *breaking downgrade* of `mammoth`, so it was not applied. `mammoth` is used here as a library on files **you** upload, not on untrusted public input, and the advisory is a denial-of-service in a CLI formatting path this app does not call. Practical risk for your event: negligible. Documented rather than silently ignored.

---

## 3. What rc.4 changes (measured)

| Change | Before | After |
|---|---|---|
| Roster broadcasts for a full room's answers | ~1 per answer (≈100 per question) | ~2 per 700 ms window. **25 answers → 1 broadcast.** |
| Question image over the wire | Original file (up to 10 MB) | 6.18 MB test photo → **13 KB** WebP; real photos typically 150–400 KB, ≤1600 px |
| Reconnect timing after a network blip | All phones at 2.000 s | 0.8 s → 15 s, jittered per device |
| Connection budget per public IP | 400/min | 1200/min (configurable) |
| Host-disconnect grace period | 5 min fixed | 5 min default, `HOST_RECONNECT_MINUTES` up to 60 |

**Not changed:** scoring, timers, question order, round announcements, self-paced rules, the phone layout, the purple single-step join, host-only soundtrack control, admin oversight permissions, or any database/TLS setting. `database-config.js` is still byte-identical (`ddee8cdd…1495`).

New environment variables are **optional** — nothing has to change on Northflank for rc.4 to work.

---

## 4. Day-before checklist (do this, in this order)

1. **Deploy rc.4** using `APPLY-v0.9.0-rc.4.md`. Take a backup first (`npm run backup`, or the in-app private backup).
2. **Confirm the build:** open `https://<your-service>/healthz`. It must return `{"ok":true,"version":"0.9.0-rc.4"}`.
3. **Open the site the day before** so the Supabase project is definitely not paused.
4. **Re-upload your question images through the rc.4 editor.** The compression happens *at upload time*, so images already in your library are still the original large files. Re-attach them once and save.
5. **Check the soundtrack.** If the toast says your audio is over 3 MB, replace it with a shorter/compressed MP3.
6. **Run a rehearsal** (`/rehearsal`) with the real quiz, including the round announcements.
7. **Do a real-device test with at least 3–5 phones on the venue's Wi-Fi**, not your home Wi-Fi. This is the single most useful thing you can do. Use your actual question images.
8. **Charge and silence the host laptop**, disable sleep, keep it plugged in, and preferably use a wired connection or the strongest Wi-Fi you have.
9. **Print the join code as a QR code** (the app generates one) so nobody mistypes it, and put the 6-character code on the screen as text as a fallback.

---

## 5. If something goes wrong during the event

| Symptom | Most likely cause | What to do |
|---|---|---|
| Images slow or missing on phones | 100 devices pulling at once, or weak Wi-Fi | Let the question run; images arrive independently of the timer. The host console shows how many phones have the image. Continue — answers and scoring do not depend on the picture being visible. |
| Players "Disconnected. Reconnecting…" | Venue Wi-Fi | They now reconnect automatically with jitter and **keep their name and score**. Ask people to keep phones awake and on the venue Wi-Fi. |
| Everyone drops at once | Wi-Fi access point or container restart | See below. |
| Host screen disconnects | Host laptop/network | Reopen the host page and sign in; the room waits. You have 5 minutes by default before it is closed and the report is saved. |
| **Container restart mid-event** | Provider restart, or an accidental deploy | **Turn off automatic deploys on Northflank before the event.** If it happens: sign in, launch the same quiz again, and read the new code aloud. Scores from the interrupted room are lost, but a report is saved automatically if the game was ended rather than killed. |
| Someone cannot join: "nickname is taken" | Two people chose the same name | Ask for a different name. A returning phone uses its saved token, so this only affects genuinely new joins. |
| "This game is full" | 100 players already in | End the current game or start a second room with a second code. |

**Restart-survival is the one gap that remains.** Making an active room survive a restart means persisting room state to the database on every answer and rehydrating it when the host reconnects. That is a real feature with real edge cases (deadlines, timers, partial answers, orphaned rooms), and it is the sensible next piece of work if you want that guarantee. Say the word and it becomes the next build.

---

## 6. Test record for rc.4

| Check | Result |
|---|---|
| Node 22 application suite (incl. new capacity suite) | **64 passed, 0 failed** |
| TLS/CA regression suite | **5 passed, 0 failed** |
| Chromium end-to-end workflow (host + mobile player, multimedia quiz, event-capacity checks) | **1 passed** |
| Production dependency audit | **3 moderate**, transitive, only fixable by a breaking downgrade — see §2 |

Local tests are **not** proof of hosted behaviour. The participant-image release gate stays **HOLD** until you run `PARTICIPANT-IMAGE-VALIDATION.md` on the live site with your original images on real phones. rc.4 materially reduces the cause of that symptom, but only your own device test can close the gate.
