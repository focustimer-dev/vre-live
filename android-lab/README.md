# VRE Live Android Lab — first experimental APK

This standalone Android Lab is an **online WebView validation shell** for the separate preview Worker at https://vre-live-lab-preview.samelling.workers.dev/. It is intentionally not the final native implementation. Production VRE Live remains untouched.

## Scope

- Application ID: `work.samelling.vrelive.lab`, version 0.1.0, Android API 26+.
- Kotlin Activity, JavaScript + DOM storage enabled for the existing site; no JS bridge yet.
- First-party HTTPS navigation stays in WebView; third-party cookies disabled; file/content access and cleartext traffic disabled.
- Android Back and retry on main-frame network errors.
- No native notifications, GPS, background jobs, Firebase or production credentials.
- Requires internet access and the **separate preview password**, distributed out of source control.

## CI

The GitHub Actions workflow builds a **debug** APK on pull requests. On changes merged into `main`, or a manual workflow dispatch from `main`, it builds a **release** APK and signs it using the separate VRE Live certificate. The workflow never deploys the Cloudflare Worker.

- PR artifact: `vre-live-lab-debug-apk` (temporary debug-signed test build).
- Main/dispatch artifact: `vre-live-lab-0.1.0-signed-release-apk` (release-signed, verified; 14-day GitHub artifact retention).
- GitHub Actions repository secrets: `VRE_RELEASE_KEYSTORE_BASE64` contains the Base64-encoded PKCS12 keystore; `VRE_RELEASE_KEYSTORE_PASSWORD` contains its password.
- The signing alias `vre-live-release` and pinned certificate SHA-256 fingerprint are not secrets. CI checks the resulting APK against the pinned fingerprint.
- The secrets are available **only to the main-branch release job**, never to pull-request jobs. Keep signing material backed up outside GitHub.

Release APKs use package `work.samelling.vrelive.lab`, distinct from Go, Hipster, Go!. **You must uninstall the older CI debug-signed VRE Lab APK before installing the release-signed APK** (Android does not allow updating an installed app with a different signing certificate). Once you install the release-signed version, preserve this signing key and increment `versionCode` for subsequent updates.

Build locally with JDK 17, Android SDK 36, Gradle 8.11.1:

```sh
gradle -p android-lab :app:assembleDebug --no-daemon
```

## Phone smoke checks

1. Install VRE Live Lab; verify it is separate from the installed PWA.
2. Open its preview login and enter the preview password.
3. Check Map, Schedule, Board, train selection and refresh.
4. Check Android Back, app switching, reopening and cookie persistence.
5. Verify external HTTPS links leave the WebView.
6. Turn on airplane mode, then reconnect and Retry.
7. No native notifications or background tracking should be claimed.

## Next

After source parity passes on a phone, package a local UI with a narrow Kotlin native bridge and secure device authentication. Only then add Android notifications and a home-screen widget.
