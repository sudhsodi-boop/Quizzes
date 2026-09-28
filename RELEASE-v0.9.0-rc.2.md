# Quizzes 0.9.0-rc.2 — round announcement candidate

## Change requested and implemented

The owner clarified that they **want** round announcements: a last-question notice before the final question of Round 1, then a Round 2 announcement before its questions.

- Added a server-controlled `last_question_intro` state before the last question of **each** round, including one-question rounds.
- The announcement carries the round label only, not the upcoming question, correct answers or media. Its deadline is null and the question index has not advanced.
- Only the authenticated host can start the question. Question content, scoring window and full timer begin together at that Start, independently of image readiness.
- Retained answer reveal, round-end leaderboard and the host’s **Next round** action. The next-round announcement has a clean presentation card rather than the previous projector join/QR lobby layout.
- Host, participants and the read-only projector show the announcements; reconnect/reload restores the announcement state without revealing the question.
- Rehearsal mirrors the new flow. The last round still ends with final results, without a fictitious next round.
- Announcements are in-app screens, not extra browser pop-up windows. No speech, sound effect or independent participant music control was added.

## Executed checks for this update

- **59 Node application tests passed.** Updated assertions cover the last-question state, null deadline and withheld question, while retaining scoring, timers, workspaces, backup/restore and private image-delivery tests.
- **5 TLS/CA tests passed.** The established database/TLS configuration is byte-for-byte unchanged.
- **Expanded Chromium end-to-end workflow passed** on the rc.2 build (about 80 seconds). It checks the announcement on host, simulated phone and projector; absent image/question before Start; projector reload during the announcement; Round 2 transition; normal answering after Start; rehearsal, image diagnostics, draft recovery, existing desktop/phone layouts and self-paced behavior.
- Browser screenshots of both announcement states were inspected.
- A browser-test helper initially returned before a pending host transition completed. Its original named-button synchronization was restored; the subsequent complete rc.2 browser run passed. Application timing was not slowed to satisfy the test.

The previous rc.1 PostgreSQL verification is recorded separately in `RELEASE-v0.9.0-rc.1.md`; it is **not claimed as a new PostgreSQL run for rc.2**. This update does not change the database schema or draft/storage code. No Docker/provider build, authenticated deployment, actual device image check, physical sound check or event-size load test was performed in this update.

## Preserved behavior and scope

Existing player question layout, server scoring, partial credit, timers, host-only soundtrack controls, private workspaces, immutable self-paced assignments, recovery drafts and explicit Save remain. No question bank, new reporting suite or additional game mode was added.

The owner-requested presentation announcements precede the actual question. They are **not** “Preparing question…” screens, do not wait for image downloads and do not gate Start on telemetry. The actual question and timer still begin immediately together.

## Release status

**Candidate only. Participant-image release gate remains HOLD.** The original images must still be tested on real hosted participant devices. See `PARTICIPANT-IMAGE-VALIDATION.md`. Nothing was deployed or purchased by the assistant.

Working `database-config.js` SHA-256:

`ddee8cdda3f94e3a87b7cddeb793c11ff53712de112bf849b4d654403c6f1495`

The cumulative update and complete source use new rc.2 filenames. Previous rc.1 and v0.8.2 ZIPs are preserved. Each new ZIP includes internal `SHA256SUMS.txt`; the external `Quizzes-v0.9.0-rc.2-SHA256SUMS.txt` verifies the ZIP files themselves.
