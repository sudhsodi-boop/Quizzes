# Quizzes v0.8.2 — participant image delivery

**Ready and tested locally. Not pushed or deployed by the assistant.**

This update addresses the clarified problem: **the host can already see a question image, but participants wait another 5–10 seconds.** The earlier v0.8.1 patch prepared images in the host browser only. On its own, it did not directly fix participant delivery.

## What this update changes

- Previously, each viewer's image request triggered a separate download from private Supabase storage. Now the app server can reuse one short-lived private image copy across authorized viewers.
- The host's existing image preparation also warms this server copy. Once it is ready, participant requests can use it without another storage download. Simultaneous requests for an uncached image share one download when cache capacity is available.
- Current question images receive high browser fetch priority. **No future images or questions are prefetched to participants.**
- **As you chose, questions and answer timers still start immediately. There is no “Preparing question…” stage and no image-readiness barrier.** Timing and scoring code is unchanged from v0.8.1.
- The larger PC fonts from v0.8.1 are included. The working phone player layout remains unchanged.

This removes a repeated-storage-fetch bottleneck, but does not reduce an image's file size or speed up a participant's Wi-Fi/mobile connection. Cold/expired/evicted copies, very large files, an overloaded free service or database, and slow devices can still cause delays. The original 5–10-second delay has **not** been measured on your authenticated live quiz after this patch; please test your actual images after deployment.

## Safety and resource limits

- Access is checked on **every request**, including cache hits. The bucket stays private. Browser responses still use `Cache-Control: private, no-store`.
- Server cache image payloads are capped at **24 MiB**, including reserved cold-download space and buffers still being sent. At most two cache fills run simultaneously; at most 32 buffers are retained. Individual cached files are limited to the existing 10 MiB upload maximum.
- Idle entries expire after 10 minutes or can be evicted earlier. This is disposable memory, not quiz persistence. A restart empties it without affecting saved quizzes/media.
- If capacity is unavailable or an image cannot be safely buffered with a known size, delivery falls back to normal streaming rather than holding up the quiz. Audio, range/seek requests and backup reads retain their streaming/read behavior.
- The 24 MiB bound is **not** a cap on the whole Node process; sockets, uploads, the database and normal runtime still consume memory. These tests are not proof of 100 physical devices on the free hosting tier.

## Install — use this instead of the previous patch

You can apply this cumulative update over **v0.8 or v0.8.1**. You do not need to install v0.8.1 first.

1. Finish live games and choose a quiet deployment window. Keep a private backup. Restarting loses active in-memory rooms, not the saved database or uploaded media.
2. Download **Quizzes-v0.8.2-update.zip** and extract it.
3. In your existing GitHub Quizzes repository, upload/replace these **eight files at the repository root**, in one commit:
   - `app.js`
   - `styles.css`
   - `server.js`
   - `media-store.js`
   - **`private-image-cache.js` — NEW file; do not omit it**
   - `Dockerfile`
   - `package.json`
   - `package-lock.json`
4. For a complete source update, also keep the ZIP's updated tests, test runner and documentation at their matching paths. The revised `npm test` command includes the two new test files, so include those files if you run tests from your repository/CI.
5. In the existing Northflank service, **build the new commit and deploy the new build**. Restarting the previous image is not an update. Deploy manually if automatic deployment remains disabled.
6. Preserve all current environment variables, Supabase configuration, private bucket, passwords and CA certificate. **No paid resource, new service, dependency, database migration or hosting-variable change is required.** The working `database-config.js` stays untouched.
7. Refresh the host and participant pages before a new game. Use Ctrl+Shift+R / Cmd+Shift+R if an old tab remains open.

`Quizzes-deployment.zip` is the refreshed full-source alternative. Do not upload a ZIP itself as the app source, nest the runtime files inside another folder, or commit backups, private keys or your server's data directory.

## Check the participant problem after deployment

1. Use one of the actual images that previously had the delay, preferably in a quiz with images on consecutive questions.
2. Open a host game and let its **First image ready** indicator appear. Join on at least two separate participant devices.
3. Start the question. Confirm that the timer starts immediately and compare when the image becomes visible on each participant device.
4. Continue to the next image question after **Next image ready** appears on the host. Check the participant image again. Also check a phone on a different connection if practical.
5. Confirm answer submission, music, host/player leaderboards and final results still work.

If a substantial delay remains, note whether it affects every participant or only some, the approximate image file size, participant browser/device, and whether the host showed the image-ready indicator. Share only that non-secret information; do not send account credentials or signed private-media URLs. Those observations distinguish remaining storage/database/service delays from file-size or participant-connection delays.

## Local evidence

In the simulated private-storage test, **100 simultaneous authorized image requests used one upstream storage download**. After host warming, **100 participant requests caused zero additional storage downloads**. Warm images without valid authorization still returned 404. Cache limits, failures, retries, an interrupted client, audio seeking and range requests were tested. See [RELEASE-v0.8.2.md](RELEASE-v0.8.2.md).
