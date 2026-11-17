# VRE Live — Event-driven commute monitor (PR #20)

**State:** Backend implementation, preview-only and not deployed. No Android background push registration yet. Production `vre-live`, production cron, and PR #19 are unchanged.

## Architecture

A standalone Cloudflare Worker `vre-live-commute-monitor-preview` owns a SQLite-backed `CommuteMonitorCoordinator` Durable Object. All confirmed commuters share **one coordinator and one pair of VRE GTFS feed fetches per monitoring tick**, regardless of the number of clients. There is no cron trigger in `wrangler.commute-preview.toml`.

```text
Android local check-in (no network if unanswered)
    ↓ explicit "Yes" / select specific train
Authenticated subscription gateway (NOT connected to Android yet)
    ↓ POST confirmed watch / DELETE on skip/change
Shared Durable Object (one alarm only when watches exist)
    ↓ one VehiclePositionFeed and one TripUpdateFeed fetch per tick
Identical client/server leave-by model + conservative delay evidence
    ↓ when leave-by is due
Firebase Cloud Messaging HTTP v1 → device notification
    ↓
Delete watch and cancel alarm when last watch ends
```

### Activation and idle discipline

- The check-in notification is local to Android. Without an explicit confirmed train, **no subscription is created** and the new monitor's Durable Object has **no alarm**.
- Server validates date, train, station order, weekday/holiday/reduced service, travel time and a maximum four-hour activation window against a byte-for-byte copy of the app's bundled VRE service calendar.
- On confirmation, the watch is stored immediately, but its first alarm does not run until at most **15 minutes before the planned leave-by time**. Early check-ins don't cause premature feed fetches.
- Each watcher can have up to six active plans; the coordinator caps total active plans at 1,000 pending further load testing. Plans expire 15 minutes after scheduled departure and can be canceled immediately, individually or per device.
- Successful deliveries leave a temporary delivered-watch tombstone, so replaying the same owner+watch ID cannot re-register and resend after an uncertain response. Exactly-once delivery still cannot be guaranteed after a platform failure between remote FCM acceptance and the storage commit.
- While active, shared checks run every 5 min when departure is distant, every 2 min within 45 min of leave-by, every 1 min within 15 min, and about every 30 seconds within 5 min. These are adaptive estimates, **not guaranteed fixed delivery intervals**; Durable Object alarms can be delayed by platform maintenance.
- The monitor uses the exact `VRELeaveBy.calculate` source already present in the app. Only two stable delay observations justify recommending a later leave time; single, stale, recovering or unavailable updates keep the safe scheduled time.
- Once the only watch is delivered, canceled, expired or invalid, `deleteAlarm()` is called. No heartbeat, perpetual cron, passive map-open subscription or unconfirmed background polling is added by this module.

### Internal preview API

The gateway is **not a public mobile API**. It accepts server-side requests only with a strong `Authorization: Bearer <MONITOR_GATEWAY_TOKEN>` shared secret. It is intentionally blocked when that secret is missing or too short.

| Method | Endpoint | Action |
| --- | --- | --- |
| GET | `/health` | Public health/configuration readiness (no secrets or tokens) |
| POST | `/v1/watches` | Register a confirmed train with owner, watch ID, train, station pair, approach minutes and FCM registration token |
| DELETE | `/v1/watches` | Cancel one watch (owner+watch ID) |
| POST | `/v1/watches/cancel-all` | Cancel all watches belonging to an owner |
| POST | `/v1/watches/status` | List that owner's active watches without exposing FCM tokens |

The payload fields are `ownerId`, `watchId`, `trainNumber`, `from`, `to`, `travelMinutes`, `platformMinutes`, `bufferMinutes`, and `fcmToken`. Caller-supplied train times are **not trusted**; server derives and validates them. The server-to-server gateway token must **never** be embedded in an Android APK, PWA, GitHub repository or downloadable skill. Account/device authorization and token-issuing gateway remain a required next integration step.

### Firebase delivery

The server-side `src/monitor-fcm.js` implementation creates short-lived OAuth2 access tokens from `FCM_SERVICE_ACCOUNT_JSON` in Cloudflare secrets, sends FCM HTTP v1 notification messages to the device registration token, and uses a stable Android tag/collapse key to reduce duplicates. There is a cap of three retry attempts. Cloudflare alarms can be delivered at least once; **exactly once push delivery is not guaranteed**. Never log private keys or client registration tokens.

**Important blockers:** VRE Live currently has no Firebase Android SDK/token-registration integration, no confirmed Firebase project or service account, and no authenticated mobile session-to-monitor gateway. The monitor rejects new registration with HTTP 503 when FCM credentials aren't configured. It must not be deployed to users until the Android receiver, persistent token rotation, token-to-device authorization, notification channel `commute_leave_now_v1`, consent sync and logout/skip cleanup are implemented and end-to-end tested.

### Preview setup (not performed by this PR)

1. Create or use a dedicated Firebase project configured for the Android Lab package `work.samelling.vrelive.lab`; configure and safely store its Firebase Android client configuration (public identifiers only in the app) and FCM service account (server secret only).
2. Configure Cloudflare preview Worker secrets: `FCM_SERVICE_ACCOUNT_JSON`, `MONITOR_GATEWAY_TOKEN`. The latter must only be available to a trustworthy server-side gateway, never to distributed clients.
3. Provision SQLite-backed Durable Object using `wrangler.commute-preview.toml`. This name is distinct from `vre-live` and carries **no production cron**.
4. Verify preview auth, subscription boundaries, two shared upstream requests for concurrent watches, no feeds with no subscribers, expiry/cancellation, 6/12-minute stable delays, and notification delivery on an actual Android handset.
5. Wire up mobile FCM token registration and an authenticated user/device gateway (not a global secret in the APK), then demonstrate the full opt-in -> leave now -> cleanup flow on a preview deployment.
6. Only after these tests and a user-approved deployment should the existing production cron and legacy push-subscription path be reviewed for removal; retain rollback.

### Security and privacy

- Stored watches contain minimally necessary boarding station, train ID, scheduled time, timers, pseudonymous owner/watch IDs and FCM registration token. Do not submit names, addresses, commute origins beyond VRE station codes or other identifying app data.
- Watch payloads are size-bounded; malformed and out-of-service requests are rejected. The server validates routes against the timetable rather than allowing arbitrary upstream polling.
- Firebase registration tokens and server credentials must not be included in health/status responses, error logs or analytics.
- Token changes and whole-day skips should cancel old watches before registering new ones. On opt-out, cancel by owner even if the app is not actively displaying the commute card.
- This preview's simple shared secret protects only an internal server-to-server gateway. It is **not sufficient multi-user mobile authentication**.
- Cloudflare alarm billing depends on active watches; the two feeds are shared, not fetched per commuter. Actual cost and wakeup counts must be measured in preview.

### Verification and limitations

`npm run check` runs `tests/monitor-coordinator.mjs`, checking exact source parity with the client, 7:25 train 310, safe leave-by, holidays, early confirmation, watch deduplication, zero idle requests, shared fetches, cancellation and fail-closed authorization. It does not substitute for Cloudflare preview deployment, Firebase service account setup or device-level push tests.

**Do not call this feature shipped or claim zero production cron wakeups until the separate production cutover has been explicitly completed.**
