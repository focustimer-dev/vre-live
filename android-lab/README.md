# VRE Live Android Lab

The APK packages the VRE Live interface and its JavaScript dependencies. The separate Cloudflare preview handles password authentication and live train feeds.

## Scope

- Application ID: `work.samelling.vrelive.lab`, version 0.1.5, Android API 26+.
- Kotlin Activity and WebViewAssetLoader serve the packaged UI under a reserved path on the preview origin. The existing HttpOnly preview cookie authenticates the same-origin feed requests.
- Only packaged assets and the HTTPS preview login and train feed routes are allowed in the WebView. Third-party cookies, file/content access, and cleartext traffic are disabled.
- Android Back and retry on main-frame network errors.
- Arrival chimes are off for new rides until the rider opts in. Android can post one foreground arrival notification after opt-in. The departures widget uses the bundled timetable and Android’s periodic refresh.
- Requires internet access and the **separate preview password**, distributed out of source control.

## CI

The GitHub Actions workflow builds a **debug** APK on pull requests. On changes merged into `main`, or a manual workflow dispatch from `main`, it builds a **release** APK and signs it using the separate VRE Live certificate. The workflow never deploys the Cloudflare Worker.

- PR artifact: `vre-live-lab-debug-apk` (temporary debug-signed test build).
- Main/dispatch artifact: `vre-live-lab-0.1.5-signed-release-apk` (release-signed, verified; 14-day GitHub artifact retention).
- GitHub Actions repository secrets: `VRE_RELEASE_KEYSTORE_BASE64` contains the Base64-encoded PKCS12 keystore; `VRE_RELEASE_KEYSTORE_PASSWORD` contains its password.
- The signing alias `vre-live-release` and pinned certificate SHA-256 fingerprint are not secrets. CI checks the resulting APK against the pinned fingerprint.
- The secrets are available **only to the main-branch release job**, never to pull-request jobs. Keep signing material backed up outside GitHub.

Release APKs use package `work.samelling.vrelive.lab`, distinct from Go, Hipster, Go!. **You must uninstall the older CI debug-signed VRE Lab APK before installing the release-signed APK** (Android does not allow updating an installed app with a different signing certificate). Once you install the release-signed version, preserve this signing key and increment `versionCode` for subsequent updates.

Build locally with JDK 17, Android SDK 36, Gradle 8.11.1, and Node.js 20+ with npm. Gradle generates the Android assets from the shared `src/index.html` and the locked dependencies in `web/`:

```sh
gradle -p android-lab :app:assembleDebug --no-daemon
```

## Phone smoke checks

1. Install VRE Live Lab; verify it is separate from the installed PWA.
2. Open its preview login and enter the preview password.
3. Check Map, Schedule, Board, train selection and refresh.
   Long-press the launcher icon for **Departures**, then select a station and use **Pin this station to Home**. Reopen the pinned station after closing the app.
4. Check Android Back, app switching, reopening and cookie persistence.
5. Start a new ride and verify that Arrival alerts starts off.
6. Turn on airplane mode, then reconnect and Retry.
7. Add the VRE Departures widget from the launcher and select a station.
8. Verify Android asks for notification permission only after opting in on a ride.

## Next

Verify the signed build on a physical phone with Play Protect enabled. Review per-device authentication before wider distribution.
