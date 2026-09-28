# Quizzes v0.8.2 — participant image-delivery patch

Prepared 28 September 2026. Tested locally, not deployed by the assistant.

## Clarification and scope

The reported delay is on **participants' screens after the host can already see the image**. v0.8.1 was host-browser preparation only; it was not a direct participant-delivery fix. This cumulative v0.8.2 patch adds private server-side image reuse and high fetch priority for live images. The user chose to keep questions/timers starting immediately, without a preparation stage; that choice is preserved.

## Implementation

- New internal `private-image-cache.js`: coalesces simultaneous cold requests and leases one buffer to multiple authorized HTTP responses. The host preloads introduced in v0.8.1 can warm the same server copy that participants subsequently use.
- Hard 24 MiB budget for retained/reserved cache payloads, at most 32 retained buffers, at most two concurrent cache fills, maximum 10 MiB per image. In-flight reservations, expired/invalidated buffers still pinned by sending responses, and disconnected-response cleanup are accounted for. LRU eviction and 10-minute expiry; errors are not cached. Uploads invalidate matching entries.
- `media-store.js` uses this optimization only for full GETs of remote images. The route still checks metadata and ownership/session or signed-grant authorization before serving. No public URLs/bucket, browser caching, auth bypass or new future-question data for players.
- Known-length bodies are read into one pre-sized buffer with length checks. Unknown/encoded/oversized objects, insufficient cache capacity and range/audio requests use the existing streaming path. A first cold image still needs to arrive from storage; this is not a guarantee of immediate rendering.
- `app.js` marks non-editor images eager/high priority. No layout or scoring change. `server.js` and `styles.css` are byte-identical to the delivered v0.8.1 versions. Larger PC text and the existing phone layout are retained.
- Dockerfile includes the new helper. No new dependencies, database schema or environment variables. Existing TLS module remains SHA256 `ddee8cdda3f94e3a87b7cddeb793c11ff53712de112bf849b4d654403c6f1495`.

## Local verification

Node.js 22, isolated local SQLite databases, a simulated authenticated Supabase Storage API, and headless Chromium:

| Check | Result |
| --- | --- |
| Full API/engine/workspace/import/deployment/migration/cache/media suite | 49 passed, 0 failed |
| Strict-TLS configuration suite | 5 passed, 0 failed |
| Comprehensive browser scenario (includes PC fonts, phone, host preload and assignments) | 1 passed, 59.0 seconds |
| Additional remote-storage integration/cache/delivery run | 18 passed, 0 failed |
| Production dependency audit | 0 vulnerabilities reported |

### Relevant delivery assertions

- 100 simultaneous authorized **cold** image requests → exactly **one** storage object GET.
- A host-warmed image followed by 100 participant requests → **zero additional** storage object GETs.
- Warm-cache requests without a valid session/grant and expired/invalid grants → 404. Helper source is not served by the static-file route.
- Participant receives `question_started` with an already-running deadline: no readiness handshake/wait added.
- Unknown-length fallback delivers the original bytes. Range requests preserve byte content, 206 and 416 behavior. Audio remains uncached and seekable.
- Shared origin failure does not poison the cache; a later request recovers. One participant abort does not cancel another participant's shared fetch.
- Unit tests verify exact buffer reuse, bounded reservations/retained bytes, pinned-response accounting, entry and concurrency limits, LRU/TTL cleanup, invalidation during a fetch/send, idempotent release, failure cleanup and retry.
- Existing browser scenario continues to verify actual host Image DOM reuse, current/next readiness, private future-image messages, slow/failure/retry UI, snapshot isolation, reload/round transitions, Gujarati rendering, shared leaderboards, host-controlled sound and timed/shuffled assignment flows. It also checks eager/high-priority participant image attributes.

These are local correctness/contract tests, **not** live Supabase/Northflank latency measurements or a 100-device hosted capacity test. The new 100-request test is not 100 physical browsers. No authenticated deployed acceptance test, PostgreSQL rerun, Safari/Firefox test, Docker build or long-running memory soak was performed for this patch. The 24 MiB cache-payload bound does not bound total process/network/upload memory.

## Delivery

- `Quizzes-v0.8.2-update.zip`: cumulative patch applicable to v0.8 or v0.8.1, with all eight runtime/build/manifest files, tests and guides.
- `Quizzes-deployment.zip`: refreshed full source.
- Both contain per-file `SHA256SUMS.txt`; archive checksums are in `Quizzes-v0.8.2-SHA256SUMS.txt`.
- Follow [APPLY-v0.8.2-update.md](APPLY-v0.8.2-update.md), deploy between games and verify the actual delayed participant images afterward. Do not treat v0.8.1 alone as this fix.
