# Secure device pairing for the VRE Live preview monitor

**Status:** Backend-only PR stacked on PR #20. The deployed Cloudflare preview Worker remains unchanged until explicit rollout and validation. No Firebase device has yet been enrolled.

## One-time code

The preview Worker receives a **24–96 character random code** only as its Cloudflare **encrypted secret** `PAIRING_CODE`. The code must never appear in GitHub, a distributable Android binary, telemetry or a public URL.

The signed Android app will ask the user to enter this code once, after explicitly enabling global notifications and selecting device pairing. The native client then enables FCM registration, obtains the token, and calls:

`POST /v1/devices/pair` with `{"pairingCode":"...","fcmToken":"..."}`.

When the code matches, the Durable Object atomically records its digest as consumed, stores a per-device Firebase registration token, and returns a random device identity plus a 256-bit bearer credential. The full bearer credential is returned **once** and must be stored encrypted by Android Keystore. Later device actions are authorized using `Authorization: Bearer <deviceId>.<deviceAccessToken>`. Merely knowing a device ID, train number, or profile ID cannot authorize a watch.

On Google account, phone, or app migration, rotate `PAIRING_CODE` in Cloudflare and enter a fresh value. Old code hashes are retained in bounded replay history to prevent reuse, even across rotations. Never put a per-user long-lived shared password in the app.

## Authenticated endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/v1/devices/pair` | Exchange a one-time code plus Firebase token for device credential |
| POST | `/v1/devices/token` | Rotate Firebase token (requires device credential) |
| POST | `/v1/devices/revoke` | Delete device credential and cancel its active watches |
| POST | `/v1/watches` | Create/refresh one confirmed watch, never trust client-supplied owner or Firebase token |
| DELETE | `/v1/watches` | Cancel one watch for the authorized device |
| POST | `/v1/watches/cancel-all` | Cancel all watches belonging to the authorized device |
| POST | `/v1/watches/status` | Return only that device's active watch metadata; excludes Firebase token |

The server accepts a maximum of six watches per paired device. The Cloudflare alarm remains absent with no confirmed watches, and no call starts GTFS polling just by enrolling a device.

The pairing endpoint requires a configured FCM sender, caps failed attempts, and rejects reused codes. It stores token digests and active watches in SQLite-backed Durable Object storage. The previous server-to-server master bearer has been removed from the public watch endpoints. Updating or revoking a Firebase registration token requires the paired-device credential.

## Privacy and mobile integration still required

This PR does **not** make pairing available to users yet. It must be combined with an Android UI and native implementation that:

- Presents a native pair-code entry inside **Check-ins & Alerts**, without logging or persisting the pairing code
- Only starts Firebase token registration after an explicit pairing action and global notification permission
- Uses Android Keystore to encrypt the returned device bearer token at rest; disables Android backup of keys
- Validates push payloads against local **global Notifications + leave-now opt-in**, selected train, service date and persisted watch ID before showing a notification
- Adds a locally scheduled conservative fallback leave alert if appropriate, without enabling idle GTFS polling
- Cancels server watches and notifications on skip trip/day, train switch, global opt-out and unpair; stores local revocation as pending on network failure and retries safely
- Handles token rotation without allowing an unauthenticated client to mutate another device
- Uses an HTTPS endpoint hardcoded specifically to the isolated preview Worker; never uses the production Worker until explicitly approved
- Does **not** send any commute profile or private location data except the minimal station codes, train number, schedule and approach minutes needed by the monitor

The real on-device pairing, cancellation, and cloud push tests remain required before merging/deploying anything to production. Secret values should be added directly through Cloudflare, *not* through GitHub, pasted into chat or uploaded with the client files.
