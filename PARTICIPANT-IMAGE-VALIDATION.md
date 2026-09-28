# Participant-image release gate — pending

**Candidate: 0.9.0-rc.1**  
**Current decision: HOLD. No real hosted participant-device results have been supplied.**

The original symptom was that participants saw images **5–10 seconds after the host**. Local cache tests, a fast host image, a successful rehearsal, or the new diagnostic counter do not prove that symptom is fixed.

## Keep the agreed game behavior

Questions and timers must start immediately. Do not introduce a “Preparing question…” stage, wait for ready counts, alter scores, or hide the delay by granting extra time during this test. The diagnostics are observational only.

## 1. Confirm the actual build

- Install the candidate on the existing free service, outside an active event, with a private backup taken first.
- `/healthz` must show `"version":"0.9.0-rc.1"` and `"ok":true`.
- Reopen/hard-refresh host and participant pages. An old tab may still run old JavaScript.
- Record the build and date/time in `Participant-image-checks.csv`.

## 2. Use the original problem images and real devices

Create a short test quiz using the same uploaded images that previously arrived late. Include a typical image and the largest/problematic one; include an image as the first question and another later in the quiz. Do not replace everything with tiny synthetic images.

Use, where available:

- An actual iPhone/iPad with Safari.
- An actual Android phone with Chrome.
- A laptop/desktop participant.
- Both the normal venue Wi-Fi and a separate cellular connection.

Begin with a few devices to isolate failures, then repeat with a representative audience/load. Record the **actual concurrent participant count**. A successful test on two phones is not certification of roughly 100 participants on the free 0.1-CPU/256-MB host. A local simulated 100-request burst is not an event-size hosted-device test either.

## 3. Observe visibility, not just downloads

For each tested question/device:

1. Have everyone join normally and activate browser audio as prompted.
2. Start the question normally, with no special waiting before Start.
3. Measure when the participant question appears and when its image is actually visible/readable. Also compare the participant image appearance with the host question/image change. A side-by-side video of the test screens is useful; use test nicknames and avoid capturing private notes or unrelated personal information.
4. In **Host console → Participant image check**, record ready/failed/over-3-seconds/reported counts before advancing. Counts reset for the next question and are not permanently stored as an analytics report.
5. Check that the question timer started immediately, answering worked, and the image fit without an unexpected scroll on the phone.
6. Repeat the quiz. Record first run versus repeat run; do not assume either is a truly cold storage request, since the host already warms upcoming images.
7. Repeat with the separate network and representative audience/load. Note server restarts, poor signal, very large files, and any failed media.

The counter measures **client-reported load/decode elapsed time**, starting when that participant renders the question. It is not trusted scoring data, a clock-synchronized host-to-phone measurement, proof of screen visibility, or a readiness barrier. “Unreported” may mean loading, disconnected, old client code or a failed diagnostic. Do not treat it as success.

## 4. Decision

Suggested practical target, not a guarantee: images should appear with or shortly after the participant question on healthy normal connections, with no recurrence of the original 5–10-second lag. Aim for roughly one second or less for typical images; investigate any report over three seconds or failed image.

**Keep the gate on HOLD if:**

- The original 5–10-second symptom can still be reproduced on a normal tested device/network.
- Images fail, appear unreadably late, or require changing the agreed immediate-timer behavior.
- The actual problematic images, relevant devices, or deployed build have not been checked.
- The only evidence is a host screenshot, local rehearsal, synthetic cache benchmark or diagnostic counters without visual confirmation.

**Ready for review only when:** the original images have been visually tested on real hosted participant devices, repeat/first-run behavior is acceptable, timing/scoring remain correct, and the recorded sample/load and any exceptions are explicit. Event capacity beyond that tested sample remains unverified. The owner should approve the observed result before this candidate is promoted to a normal release.

## What to report back

Build number; question number/image identifier; image size if known; device and browser; Wi-Fi/cellular; concurrent participant count; first/repeat run; observed question-to-image delay and host-to-phone difference; console counts; whether the timer began immediately; and any error. Do not send passwords, private keys, secret environment variables or private backup ZIPs.

## Results

| Check | Current status |
|---|---|
| Candidate deployed to the owner’s Northflank service | Not performed by assistant |
| Original images tested on real participant phones | Pending |
| Visual delay compared with host | Pending |
| Venue/network coverage | Pending |
| Representative hosted audience/load | Pending |
| Owner acceptance | Pending |
| Release gate | **HOLD** |
