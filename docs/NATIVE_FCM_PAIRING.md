# Native FCM pairing — Android Lab (draft)

This PR is stacked on PR #21 (Firebase Android client), which is stacked on PR #19 (global notification settings). It integrates with the server-side **PR #22**, stacked on PR #20. No production code or Cloudflare deployment is performed by this Android change.

## Setup

1. An administrator creates a fresh random one-time code (at least 24 characters) and installs it as an **encrypted Cloudflare Worker secret** named `PAIRING_CODE` on the isolated `vre-live-commute-monitor-preview` Worker. Never embed this value into Android source, GitHub, screenshots, or a link.
2. A user explicitly enables Notifications in Preferences → Check-ins & Alerts and grants Android notification permission.
3. The user taps **Pair this phone** and pastes the one-time code. The Android SDK requests an FCM registration token only at this point, and calls `POST /v1/devices/pair` over HTTPS.
4. The backend atomically consumes the code and returns a device-specific identity and access token. Android encrypts the credential with an **Android Keystore AES-GCM key**. The app's manifest prohibits backup.
5. The user then enables **Leave-now notifications** in the same settings area. Only explicitly selected trains may generate watch subscriptions, and these watch calls happen on the native background executor.
6. The Android `FirebaseMessagingService` receives data-only pushes but displays them **only** when the master and category settings, OS permission, current day, local selected train and locally registered watch ID match.
7. Skipping a train/day or turning off leave-now cancels server watches. Turning off global Notifications also revokes device access and Firebase enrollment. Offline cancellation and revocation are recorded locally and retried on the next app launch.

## Non-goals / still unverified

- No train polling from Android is introduced by these changes; GTFS polling remains exclusively inside the backend when a confirmed watch is active.
- No guarantee of zero duplicate notifications if the OS or network replays events unexpectedly; both backend delivery tombstones and the local displayed-watch flag reduce duplication.
- The Android app is not paired automatically. `firebase_messaging_auto_init_enabled` stays false until the user chooses Pair.
- No production Worker changes, no global pairing code in the APK, no Firebase administrator credential in client assets.
- A valid server-side `PAIRING_CODE`, an updated preview backend from PR #22, and a signed Android QA APK are required for the first actual test. This PR alone doesn't demonstrate live FCM delivery.
- The app only shows server monitoring if the device has a compatible signed build; do not install a PR debug build over an existing signed Lab APK, as that would require uninstalling and lose local commute data.
- Do not merge or deploy before the native Android build, UI, consent, account pairing, train switch and real push tests pass.

**Known limitations for device QA:** watch registrations are only attempted within the backend's supported activation window. A user confirming many hours in advance may need later local alarm-based enrollment; the current server deliberately refuses such an early watch instead of starting premature polling. Test status/diagnostics before enabling broadly.
