# Quizzes 0.9.0-rc.4 — verification record

**October 9, 2026 · Test candidate · Not deployed by assistant**

## Included changes

- Coalesces room roster broadcasts (`participants_updated`) to roughly two per 700 ms using a leading-edge plus trailing-edge throttle. Every phase broadcast (`question_started`, `question_ended`, `round_intro`, `last_question_intro`, `game_ended`, `joined`, `sync`) is unchanged and still carries a fresh roster. The pending timer is cleared when a game ends and when the room expires, so no timer outlives its room.
- Adds client-side image optimisation before upload: raster JPEG/PNG/WebP above 400 KB are re-encoded to at most 1600 px on the long edge (WebP ≈ 0.82, JPEG fallback with a white matte, `createImageBitmap` with an `<img>` fallback). GIF, SVG and any non-raster type are untouched. The original is kept whenever re-encoding does not reduce the size, and the uploaded filename extension follows the encoded type.
- Warns when a soundtrack upload exceeds 3 MB, because every participant device downloads it. No hard limit was added, so existing media still uploads.
- Keeps the optimisation result visible: `uploadQuestion` appends the before/after size to its "Media attached" toast, because the upload toast is immediately replaced by it.
- Raises the per-peer WebSocket connection budget from 400 to 1200 per minute, configurable with `CONNECTS_PER_MINUTE` (clamped to 50–10000), because a venue NAT presents a whole room as one address.
- Replaces the fixed 2 s reconnect with jittered exponential backoff (0.8 s doubling to a 15 s cap, plus 0–0.9 s random jitter), so a room-wide network blip no longer produces a synchronised stampede.
- Makes the host-disconnect grace period configurable with `HOST_RECONNECT_MINUTES` (clamped to 1–60). The default is unchanged at 5 minutes; the end-of-game reason string now reports the configured value.
- No game rule, scoring formula, timer behaviour, round announcement, self-paced policy, admin oversight permission, phone layout, join flow or soundtrack-control rule was changed. No schema, backup-format or environment-variable change is required.

## Executed verification

| Check | Result |
|---|---|
| Node 22 application suite, now including `tests/capacity.test.js` | **64 passed, 0 failed** (59 before this build, plus 5 new) |
| TLS/CA regression suite | **5 passed, 0 failed** |
| Chromium end-to-end workflow (host editor + separate mobile player, saved multimedia quiz) | **1 passed**, about 1.4 minutes |
| Production dependency audit | **3 moderate**, transitive, only fixable by a breaking downgrade |

The new capacity suite asserts that:

- 25 participants join one room without nickname clashes and each receives a resume token.
- 25 answers from a full room produce **at most 8** roster broadcasts (measured: **1**), while still sending at least one.
- A 6.18 MB photo uploads as **13 KB** of WebP, and the size saving is reported on the visible toast.
- An oversized soundtrack (3.4 MB WAV) raises the "Every phone downloads this" warning.
- The coalesced roster still **converges**: the observer eventually receives an update in which every participant is marked answered. This is the assertion that would catch a throttle that silently dropped the final state.
- Scoring is unchanged: after reveal, the leaderboard contains all 25 players and every correct answer still scores at least 500 points.
- The connection budget is enforced (rejections observed) and never exceeds the configured ceiling, and the shipped default leaves room for a whole room behind one NAT.

Local PostgreSQL workspace/professional suites were not re-run for this build; no database-facing code changed. Working `database-config.js` remains byte-identical:

`ddee8cdda3f94e3a87b7cddeb793c11ff53712de112bf849b4d654403c6f1495`

## Defect found and fixed during this work

The first implementation of the throttle referenced its own `entry` variable inside the timer callback while it was still `undefined`, which threw inside a timer and killed the server process. It was caught by the new capacity test hanging rather than passing, and fixed by allocating the entry before scheduling the timer. The passing suite above is the post-fix run.

## Limits and release status

**Participant-image release gate remains HOLD.** Actual hosted original images, real participant phones, roughly 100 hosted devices, venue Wi-Fi, physical sound synchronisation and provider deployment are not certified by these tests. rc.4 reduces the most likely cause of the late-image symptom — original-size photos saturating a shared free container — but does not by itself close the gate.

**An active room still does not survive a process restart.** Rooms are held in one process's memory; a provider restart or an accidental deploy ends the room. Automatic deploys should be disabled before an event. Persisting room state so a host can resume after a restart is the remaining piece of work, and is deliberately not included here.

Dependency advisories: `sprintf-js` (DoS via unbounded precision) reaches the tree through `mammoth` → `argparse`. The only offered remedy is installing `mammoth@0.3.29`, a breaking downgrade, so it was not applied. `mammoth` runs as a library on documents an authenticated host uploads, and the vulnerable path is CLI argument formatting, which this app does not call.

This record describes rc.4. Older rc.1–rc.3 documentation remains accurate for their own builds.
