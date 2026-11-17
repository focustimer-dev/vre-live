# Firebase Cloud Messaging — VRE Live Lab

**Current status:** Android SDK integration and configuration only. Push notifications for departures are **not live**. This branch is stacked on PR #19 (global Check-ins & Alerts), and the server-side prototype is PR #20.

## Registered Firebase Android client

- Firebase project ID: `vre-live`
- Android application ID: `work.samelling.vrelive.lab` (the actual Gradle `applicationId` and signed Lab package)
- Configuration: `android-lab/app/google-services.json`, supplied by the Firebase Console
- Build: Google Services Gradle plugin plus Firebase Android BoM and `firebase-messaging`. Firebase Analytics is not included.
- The Firebase client configuration contains project identifiers and an API key meant for the client application. It is **not** a private Firebase Admin service-account key. Nevertheless, review and apply appropriate Google Cloud API key restrictions.

### Safety gate on this PR

- Manifest explicitly sets `firebase_messaging_auto_init_enabled=false` and `firebase_analytics_collection_enabled=false`. Device registration will not be initiated merely by opening or updating the app.
- `CommuteFirebaseMessagingService` is registered for `com.google.firebase.MESSAGING_EVENT` but **does not upload or persist registration tokens, display leave-now notifications, or initiate network polling**.
- The future data-only `leave_now` receiver must validate current global notification permission, category opt-in, explicitly selected train and locally recorded **authenticated server watch ID** before displaying anything. This local watch registration and Firebase enrollment **are not included yet**, so all pushes are dropped.
- No `FCM_SERVICE_ACCOUNT_JSON`, `MONITOR_GATEWAY_TOKEN`, Google private keys or WebView authentication cookies belong in the APK, GitHub, or Firebase client configuration.
- No Firebase Analytics, performance monitoring, crash reporting or additional data collection is enabled by this change.

## Remaining steps

1. In Firebase Console → Project settings, verify the Android app has the correct package ID. The user-supplied configuration already matches.
2. Firebase Console → Project settings → **Service accounts**: determine whether the Cloud Messaging API (HTTP v1) is enabled and create a dedicated service identity with minimum permissions only when needed. Store the service-account credential through Cloudflare encrypted secrets, **never commit or upload it to GitHub**.
3. Implement an authenticated device enrollment gateway that binds each Firebase registration token to a specific authorized device/watch; **never embed a shared gateway bearer secret in Android**. This is the outstanding integration boundary between PR #19, PR #20 and the app.
4. Only after authenticated enrollment is available, enable explicit device opt-in and FCM registration, handle token rotation/revocation, and sync watch creation/cancellation for changes, skip-day and master Notifications Off.
5. Wire a consent-aware Android `FirebaseMessagingService` for data-only messages. Before displaying a leave-now alert, verify the persisted confirmed train/watch, service date, notification permission and category setting. Support notification sound/vibration as Android channels respecting OS overrides.
6. Preview-test the entire check-in → confirm train → watch → leave-now → cancellation sequence, including app closed, permissions denied, screen-off/Doze, time changes and service holidays. Keep legacy live-train tracking unaffected.
7. Merge approved, tested PRs and produce an official, consistently **signed** Lab APK from `main`; do not install transient PR debug APKs over the signed app.

## Testing

CI runs `tests/firebase-android.mjs`, ensures the Firebase client belongs to the correct app and enforces the default-off registration boundary. The Android build must also pass compilation and asset packaging.

Do not report Firebase notification delivery as successful based only on client registration or compilation.
