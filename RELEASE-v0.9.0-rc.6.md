# Quizzes 0.9.0-rc.6 — verification record

**October 22, 2026 · Test candidate · Not deployed by assistant**

## Included change: a buzzer round for live quiz nights

A new, **optional** question type — **Buzzer · music identification** — joins the existing four (multiple choice, multiple correct answers, true/false, fill in the blank). It is built for the antakshari-style round: the host plays a clip over the hall speakers, players buzz in from their phones, and the host scores the answers by hand.

**Nothing about the existing four types changes.** No scoring formula, timer, announcement, screen or stored quiz is altered. A quiz without a buzzer question behaves exactly as it did in rc.5.

### How it works

| Stage | What happens |
|---|---|
| Editing | Choose **Buzzer · music identification** as the answer type, attach the music clip, and type the expected answer (one spelling per line). The time field becomes the **scoring window**: earlier buzzers earn more. |
| Host starts the question | There is **no countdown**. The host screen shows the clip's play control and a ranked queue; the projector shows *Listen, then press BUZZ on your phone.* The host plays the clip over the hall speakers — phones stay silent, so the music is broadcast exactly as your existing soundtrack policy already requires. |
| Players buzz | Every player may buzz once. The phone shows *Buzzed in #2 · waiting for the host.* The order is set by the time the server receives each buzz, fastest first. |
| Host awards | The host asks the first name in the queue and taps **Correct** or **Wrong**. A wrong answer moves down the queue to the next player. **Close buzzing** stops new buzzes; **Reveal answer** ends the round. |
| Scoring | The first correct buzzer earns `points × (1 − 0.5 × elapsed ÷ window)`, never below 100. A buzzer at the very start of a 30-second window scores full points; one at the end scores half. Nobody else scores. |
| Projector | Shows the ranked queue live — position, name, and reaction time in seconds — with wrong answers struck through. |

### In assigned (self-paced) quizzes

A buzzer question has no host, so in a published assignment it is shown and graded as a **type-the-answer** question against the same expected-answer list, with the same immediate feedback and leaderboard as any fill-in-the-blank question. The host's expected answer is never shown before submission.

### Effect on quizzes that are already assigned or running

**None.**

- Existing questions keep their type. Buzzer is only ever created by choosing it in the editor.
- Published assignments are stored as immutable snapshots; nothing is rewritten or revalidated by this update.
- Attempts in progress are untouched.
- As with any deploy, a **live hosted room in progress** does not survive the restart. Finish a live game before deploying.

## Executed verification

| Check | Result |
|---|---|
| Node 22 application suite (incl. 11 buzzer socket subtests) | **76 passed, 0 failed** |
| TLS/CA regression suite | **5 passed, 0 failed** |
| Chromium end-to-end workflow | **1 passed**, about 1.4 minutes |

The buzzer is now proven twice:

- **Headless sockets** (`tests/buzzer.test.js`, 11 subtests) — buzz order, one buzz per player, non-host verdicts rejected, wrong answer keeps the queue open, correct answer ends the round and scores only the winner, buzzing closes, and points stay within 100–1000.
- **A real browser** (new `tests/buzzer-browser.js`, inside the Chromium suite) — three Playwright phone contexts join a live game, all three buzz, the host sees the ranked queue, marks the fastest wrong and the second-fastest correct, and the reveal shows the expected answer. The run logs `buzzer: host awarded the second-fastest buzzer`.
- **Assigned quizzes** (new `tests/buzzer-assigned.test.js`) — a buzzer question published as a self-paced quiz is served as a typed answer and graded against the expected-answer list.

Two real defects were found and fixed while writing that last test: the published-question builder and the answer recorder both assumed every non-`text` question has answer choices. Studio draft validation, rehearsal warnings and rehearsal play were corrected the same way.

## Files changed

`server.js`, `quiz-rules.js`, `app.js`, `index.html`, `display.js`, `styles.css`, `workspace-features.js`, `studio-server.js`, `rehearsal.js`, `extensions.js`, `index.html`/`display.html`/`rehearsal.html` (asset version strings), `package.json`, plus the two new test files and this document.

Everything from rc.4 and rc.5 — coalesced roster broadcasts, upload-time image optimisation, the larger shared-NAT connection budget, jittered reconnect backoff, the soundtrack size warning, the tunable host-reconnect grace period and the removed participant disclaimer — is included in this package.
