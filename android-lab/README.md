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

A GitHub Actions workflow assembles a **debug** APK on PRs that change this project. It never deploys Workers. Download the `vre-live-lab-debug-apk` artifact from a successful Actions run.

Debug APKs use ephemeral CI debug signing. Do not assume a fresh CI artifact upgrades an older installation. Establish a stable, dedicated VRE signing key before distributing release APKs. Do not reuse the Go, Hipster, Go! signer.

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
