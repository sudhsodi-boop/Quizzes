# Quizzes v0.6.0 — release notes

Prepared September 27, 2026. Complete source update; not deployed to the user's live service by the assistant.

## New in this release

- Read-only site-admin workspace review, authorized on the server using SITE_ADMIN_EMAIL. Quizzes/correct answers/media, completed live reports, and self-paced results are visible. Peer accounts remain isolated; the main account's normal library and backup remain owner-scoped. Visible access notices are included.
- Confirmed single/all own live-report deletion, and deletion of closed own publications plus all their attempts. Saved source quizzes/media and earlier backups are retained.
- Atomic owner-only deadline extensions while publications are open. The same link, browser attempts and submitted progress survive extension/restart. Closed quizzes cannot reopen. Concurrent close/extend operations cannot revive a closed publication.
- Linked background audio for self-paced quizzes, browser sound activation, continuous playback across questions, question-audio ducking, failed/expiring signed-source renewal and stop on completion/known closure.
- Non-destructive visible-page metadata refresh for extensions/early closure; in-progress selections/typed answers are preserved and stale poll responses cannot overwrite a newly submitted question.

## Verification

- Full test suite: 39 passing tests with SQLite/local media.
- Full suite with local PostgreSQL 17 and a local Supabase Storage contract fixture: 39 passing tests.
- Expanded Chromium desktop-host/mobile-participant/friend scenario: passing, including administrator-only controls, privacy notice, report/publication deletion, extension without losing a selection, linked soundtrack playback/renewal, and all earlier live/import/recovery flows.
- Clean Node 22.23.3 dependency install passed; the full SQLite and PostgreSQL suites each passed 39 tests, and the expanded browser scenario passed. npm audit reported 0 vulnerabilities. Release executable/test inputs are compared with this verified clean copy.

Tests use disposable local data. Original user data and provider credentials are not altered. Expiration/concurrency checks manipulate test deadlines rather than waiting a real day; audio tests verify playback state with a generated audio fixture, not physical speakers. Oversight is not a live screen/activity recording. It does not grant account impersonation or modification of friends' content.

The implementation does not erase participants' downloaded/displayed copies or past backups. Browser-level attempt prevention remains bypassable by clearing cookies or using another browser/device. Private app workspaces share infrastructure quotas. No new paid service is required or provisioned.

No new hosted Render/Supabase/TLS qualification, physical 100-person event, Safari/Firefox test, Docker image build or independent security audit is claimed. Follow APPLY-v0.6-update.md and test on the real site/devices before your next event.
