# VRE Live Android Lab — initial direction

Keep the existing Cloudflare Worker as the authoritative GTFS-RT feed proxy and commute backend. Build a **separate** Android app and package identity, using a local WebView plus a tightly scoped native Kotlin bridge, similar in principle to the **current** Go, Hipster, Go! Android Lab (not its old TWA wrapper).

## Initial features (after source recovery)

1. Package and display the existing map, schedule and station board on Android, with correct Back handling and screen insets.
2. Authenticate securely; never embed the Cloudflare APP_PASSWORD or VAPID private key in APK/source. Review safer per-device auth before broad distribution.
3. Enable train selection and commute state to persist through process restarts.
4. Add native notification handling with Android runtime permission and a user-controlled active-commute flow. Avoid always-on GPS/background polling by default.
5. Test arrival alerts under screen-off, Doze, network loss, stale feed, and train cancellation scenarios.
6. Consider a home-screen train/ETA widget only once native notification and ETA integrity are validated.

## Isolation

- Android experiment has its own application ID, assets, signing key and CI.
- Existing PWA remains online; the Android project does not automatically deploy it.
- Source control comes first; no Android build, signing, deployment, or notification-service setup has been performed as part of this import.
