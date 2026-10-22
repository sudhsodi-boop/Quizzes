# Quizzes 0.9.0-rc.5 — verification record

**October 12, 2026 · Test candidate · Not deployed by assistant**

## Included change

- Removes the pre-attempt disclosure paragraph from the **participant** view of a published (self-paced) quiz. The line removed is the one shown directly under the nickname form on the *Play at your own pace* screen:

  > One attempt per browser, using a cookie. Clearing cookies or using another browser can bypass this limit; it does not verify identity. Correct answers and points appear immediately after each submission. Your nickname and score appear to other finishers on the leaderboard.

- The rest of that screen is unchanged: the heading, the question/round count, the timer explanation when a per-question countdown is enabled, the nickname field and the **Start my attempt** button all remain.
- **No behaviour changed.** The rule described by that paragraph is still enforced exactly as before: one attempt per browser, tracked by a private cookie, with immediate feedback after each submission and a leaderboard of finishers. Only the printed notice was removed.
- The matching sentence on the **host** side — *Settings → Published quizzes → “Participants play independently. One attempt per browser; correct answers appear after each submission, with a leaderboard after finishing.”* — was left in place, because the request was specifically about the participant screen. It can be removed on request.

## Effect on quizzes that are already assigned

**None.** This is a presentation change in one client-side file.

- Published assignments are stored as immutable snapshots in the database. Nothing about them is rewritten, re-saved or revalidated by this update.
- Attempts already in progress are stored per browser in the `attempts` table and are untouched. Someone part-way through a quiz keeps their answers, their place and their remaining time.
- Assignment links, codes and closing times all keep working exactly as before.
- The only thing that does not survive any deploy is a **live hosted room in progress**, because active rooms live in the server's memory. Self-paced assignments are not affected by that.

## Executed verification

| Check | Result |
|---|---|
| Node 22 application suite | **64 passed, 0 failed** |
| TLS/CA regression suite | **5 passed, 0 failed** |
| Chromium end-to-end workflow (incl. the self-paced assignment flow) | **1 passed**, about 1.4 minutes |

No test referenced the removed text. The self-paced join and completion flow is exercised by the end-to-end suite, which passes with the paragraph gone.

## Files changed

`extensions.js`, `index.html`, `display.html`, `rehearsal.html` (asset version strings), `package.json`, plus this document.

Everything from rc.4 — coalesced roster broadcasts, upload-time image optimisation, the larger shared-NAT connection budget, jittered reconnect backoff, the soundtrack size warning and the tunable host-reconnect grace period — is included in this package.
