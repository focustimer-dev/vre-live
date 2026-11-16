# Stable Android Lab updates

VRE Live Lab has two build channels with different signing identities.

| Channel | Source | Signing | Intended use |
| --- | --- | --- | --- |
| Temporary debug APK | Pull request CI | Ephemeral CI debug certificate | Isolated code review; not a durable install |
| Signed Lab APK | `main` push or manual GitHub Actions dispatch | Fixed Lab release key from GitHub Secrets | User-facing testing and updates that retain saved preferences |

## Install and upgrade policy

1. **For everyday Lab testing, install only signed APKs from main.** They keep the package ID `work.samelling.vrelive.lab` and are signed with the certificate fingerprint already required by CI.
2. The signed release job derives `versionCode = 100000 + github.run_number`, which increases with each new run of the same workflow. The human-readable `versionName` includes the run number.
3. To update an existing **signed** Lab app, install a newer **signed** Lab APK over the existing installation. Do **not** uninstall. The stable signing identity and increasing versionCode allow Android to retain the app's existing local data, including commute profiles, check-in preferences and ride history.
4. **First-time move from a debug APK to a signed APK:** Android will normally reject an in-place update because the certificates differ. This may require a one-time uninstall/reinstall; **uninstalling clears app data** (this app has `android:allowBackup="false"`). Record any important commute settings first. Do not claim a lossless migration or silently uninstall.
5. Do not distribute or install new PR **debug** artifacts as the normal upgrade path after moving to signed builds. Test a PR debug APK on a separate install/emulator if needed.

## Trust and safety requirements

- Signing secrets are used **only on main**; never in the pull-request job.
- The workflow verifies `apksigner` signature validity, the pinned SHA-256 certificate fingerprint, package ID and the dynamically assigned versionCode **before** uploading the artifact.
- Signed outputs are named `vre-live-lab-signed-<workflow run number>`; inside the ZIP the APK is `VRE-Live-Lab-signed.apk`. The filename is stable; the version embedded in the package is what controls upgrade ordering.
- If signing secrets are missing or the certificate changes, CI must fail closed, not upload an untrusted or differently signed file.
- The signed Lab APK remains **separate from public production deployment**. Signing and publishing a Lab build doesn't deploy Cloudflare Worker changes.

## Distribution

For the user's phone, retrieve the latest completed **main** run's `vre-live-lab-signed-<run number>` artifact. Prefer sharing the actual signed APK directly as a conversation attachment rather than sending users through GitHub's Actions pages. The connector's artifact archive can be downloaded, unzipped, and the signed APK supplied; verify the version and certificate if possible. Do not construct fictitious direct URLs.

## Verification scenarios

- Signed V1 -> signed V2 with higher versionCode: installs without uninstalling and retains commute preferences.
- Debug -> signed: may require a one-time uninstall due to differing certificates, communicated before install.
- Signed -> debug: must never be recommended as the update channel.
- Certificate mismatch, package ID mismatch, or versionCode mismatch: fail CI before upload.
- No new signing secrets available to PR code.
- Successful signed build does not trigger a production Worker deploy.

## Implementation status

This update-path PR is **not** merged or deployed until reviewed and validated. Signed main-channel CI already existed; this change makes its versioning automatic, fixes stale artifact naming and explicitly checks package identity and embedded versionCode.
