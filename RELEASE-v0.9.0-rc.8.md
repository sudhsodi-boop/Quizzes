# Quizzes 0.9.0-rc.8 — verification record

**October 22, 2026 · Test candidate · Not deployed by assistant**

## Included changes

### 1. Play and Stop buttons for the buzzer clip

The buzzer question now has **▶ Play clip for the room** and **■ Stop clip** side by side.
Stop silences the clip immediately and rewinds it, so you can cut a song short the moment
someone buzzes in and play it again from the start. The Play button reads *▶ Playing…
tap to restart* while the clip runs, and a small line under the buttons reports
*Clip playing over the hall speakers.* / *Clip stopped.* Stop is disabled when nothing is
playing, and both buttons are disabled if the question has no clip. The clip still plays
from the host laptop over the hall speakers; phones stay silent.

### 2. Design D — Game Show Bold on the assigned participant screens (rc.7)

rc.6 added the buzzer round. This candidate adds the second piece you picked: the
**Game Show Bold** look, applied **only** to the screens a participant sees in an
**assigned (self-paced)** quiz — the start screen, a question, the instant feedback after
each answer, and the final leaderboard.

Everything else keeps the classic purple: live join, live question, live results, the
host console, the projector, and the `/invite` workspace sign-up page.

### What the participant sees now

| Element | Design D |
|---|---|
| Background | `linear-gradient(165deg, #ff2e88, #8a2be2 55%, #2b0f5e)` |
| Accent, eyebrows, timer, points, rank badges | `#ffe14d` |
| Answer tiles | translucent, with a 6 px left border cycling gold → green → blue → pink |
| Buttons | gold on deep navy, larger (18 px) |
| Question / headings | white, larger (34 px question, up to 44 px title) |
| Score at the end | gold, up to 68 px |

PC/laptop text is bigger than before; the phone layout and its spacing are unchanged.

### Accessibility

Measured in Chromium at the **lightest** point of the gradient (worst case):

| Text | Contrast |
|---|---|
| Answer tile label on its tile | 5.85:1 |
| Muted/secondary text on the card | 4.81:1 |
| Eyebrow (gold) on the card | 5.38:1 |
| Countdown timer | 8.27:1 |
| Primary button label on the button | 12.10:1 |
| Leaderboard row | 6.00:1 |

All clear the WCAG 2.2 AA minimum of 4.5:1 for body text. The wordmark sits on a dark
pill because bare gold on the pink stop was only 2.7:1.

## Effect on quizzes that are already assigned or running

**None.**

- This is a stylesheet plus one line that adds a `body.assigned-quiz` class on `/play`.
- No quiz, publication, attempt or report is rewritten, re-saved or revalidated.
- Links, codes and closing times keep working.
- As always, a **live hosted room in progress** does not survive a restart. Self-paced
  assignments are unaffected.

## Executed verification

| Check | Result |
|---|---|
| Node 22 application suite (76 subtests, incl. 11 buzzer sockets) | **76 passed, 0 failed** |
| TLS/CA regression suite | **5 passed, 0 failed** |
| Chromium end-to-end workflow (host editor, 3 phones, buzzer round incl. Play/Stop, self-paced) | **1 passed**, about 1.4 minutes |
| Theme and contrast check on the live assigned screens | all ratios ≥ 4.5:1 |

Screenshots of the four screens at phone and desktop size are in `test-artifacts/`
(`design-d-phone-*.png`, `design-d-desktop-*.png`).

## Files changed since rc.7

`index.html` (Stop button and clip note), `app.js` (clip Play/Stop state, pauses and
rewinds when the question ends), `styles.css` (button row and note), the three HTML asset
version strings, `package.json`, plus this document.

## Files changed in rc.7

`styles.css` (one clearly marked, scoped block at the end), `extensions.js` (one line:
adds the `assigned-quiz` class on `/play`), `index.html`, `display.html`, `rehearsal.html`
(asset version strings), `package.json`, plus this document.

Everything from rc.4, rc.5, rc.6 and rc.7 — coalesced roster broadcasts, upload-time image
optimisation, the larger shared-NAT connection budget, jittered reconnect backoff, the
soundtrack size warning, the tunable host-reconnect grace period, the removed participant
disclaimer and the buzzer round — is included in this package.
