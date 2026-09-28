# Quizzes v0.8.1 — larger PC text and prepared host images

**Prepared and tested locally; not pushed to GitHub or deployed by the assistant.** Your deployed v0.8 files were checked against the public repository and matched. This is a focused improvement, not a stale-deployment repair.

## What changes

- **Larger live PC text.** Question text starts at 48px (56px on wide screens); answers start at 32px (34px on wide screens). Screen fitting reduces image space first, then modestly reduces text if necessary. At desktop widths of at least 1000 CSS pixels, it never goes below 36px questions / 28px answers. Long questions or high browser zoom can still require scrolling rather than hiding text.
- **Phone player layout and text-fitting behavior stay the same.** No new participant image prefetching or soundtrack controls.
- **Host image preparation.** The first question's image loads in the lobby. While a question is running, the host prepares the immediately following question's image, if it has one. A ready image is reused, not downloaded again when that question starts. No image-reveal effect.
- A small **First image ready / Next image ready** indicator appears near the host's sound controls. It shows loading or unavailable states too. Slow loads offer Retry after 15 seconds; failed loads offer Retry immediately. Retry renews the authorized image URLs.
- The first image may still take time when initially opening a room. Starting before it is ready, rapidly advancing, very large images, reloading the page, or a slow connection can still cause a wait. **Timers are unchanged and do not pause for image loading.** For the first question, wait for “First image ready” before pressing Start where practical.
- Preparation uses only the running room's saved snapshot, not subsequent library edits. At most two distinct images are held in the host browser. Old entries are discarded as the game advances and cleared on end/sign-out/new launch. Images remain private; no future images are sent to participants, no bucket becomes public, and no server image cache is added.

## Install on your existing Northflank service

1. Finish active live games. Take a private backup and choose a quiet period for the deployment. Restarting the service loses active in-memory rooms; quizzes and submitted assignment progress remain in your existing database.
2. Download **Quizzes-v0.8.1-update.zip** and extract it on your computer.
3. In your GitHub Quizzes repository, use **Add file → Upload files**. Replace these **five runtime/manifest files together at the repository root**:
   - `app.js`
   - `styles.css`
   - `server.js`
   - `package.json`
   - `package-lock.json`
4. Commit the upload. The ZIP also contains the updated guides, browser test and browser-test runner; keep those at their matching paths if maintaining the test suite. Do not nest the runtime files inside another folder or upload only the ZIP itself.
5. In the existing Northflank combined service, build the **new GitHub commit**, then deploy that new build. A restart of the previous image does not install the patch. Automatic deployment was previously disabled, so use the build/deploy actions when required.
6. Keep all existing environment variables, Supabase settings, private bucket and CA certificate. **Do not replace `database-config.js` or change TLS settings. No paid resource, new account, database migration or hosting upgrade is needed.**
7. After deployment is healthy, refresh the host page. If an old tab remains open, use Ctrl+Shift+R on Windows/Linux or Cmd+Shift+R on macOS; participants should refresh before joining a new game.

`Quizzes-deployment.zip` is the refreshed full-source alternative, not an additional patch you must apply. Never replace the server's data directory or commit private backups/secrets.

## Quick acceptance check

1. On the PC used for hosting, launch a quiz with images on two consecutive questions. In the lobby, wait for **First image ready**.
2. Start the first question. Its image should already be prepared. Check that the larger question and answers are readable at your normal screen size. Full screen remains available.
3. During that question, watch for **Next image ready**. Reveal the answer and continue. The prepared next image should appear without another host download.
4. Join from your phone. Confirm its familiar question/answer layout, submission, sound and results still work. Future images must not appear on the phone before their questions.
5. Check host/player leaderboards and the host final rankings. Try a self-paced assignment to confirm feedback and Next still work.

For very large photographs, consider using a sensibly sized JPG/WebP rather than the original camera file, while keeping diagram labels legible. Existing uploads are not recompressed or modified by this update.

## Test scope

See [RELEASE-v0.8.1.md](RELEASE-v0.8.1.md). Local tests passed, including delayed/failed downloads, retries, image DOM reuse, no future-image grants on player messages, snapshot edits, reconnects and six-option desktop layouts. These are not measurements of your real Northflank/Supabase connection or a guarantee of instant downloads. Please check with your actual quiz images before the next event.
