import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const gradle = file("android-lab/app/build.gradle");
const workflow = file(".github/workflows/android-lab.yml");
const manifest = file("android-lab/app/src/main/AndroidManifest.xml");
const guide = file("docs/ANDROID_UPDATES.md");

// No permissions or user data resets are required to upgrade the same package.
assert.match(gradle, /applicationId 'work\.samelling\.vrelive\.lab'/);
assert.match(manifest, /android:allowBackup="false"/,
  "communicate that uninstalling currently loses local data");
assert.match(gradle, /100000 \+ project\.property\('vreLabRunNumber'\)\.toString\(\)\.toInteger\(\)/,
  "Lab signed build code increases with GitHub workflow runs");
assert.match(gradle, /versionName project\.hasProperty\('vreLabRunNumber'\)/,
  "signed QA version name includes an identifying run number");
assert.match(workflow, /:app:assembleRelease -PvreLabRunNumber=\$\{\{ github\.run_number \}\}/,
  "release build passes run number to Gradle");
assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/,
  "release secrets are available only from main, not from PR code");
assert.match(workflow, /if: github\.event_name == 'pull_request'/,
  "untrusted PR builds stay isolated as debug builds");
assert.match(workflow, /secrets\.VRE_RELEASE_KEYSTORE_BASE64/);
assert.match(workflow, /secrets\.VRE_RELEASE_KEYSTORE_PASSWORD/);
assert.match(workflow, /expected="7AF80EB4C104DF1FD4079D50B8C535DE6A67DD3DEDB1B557BE18E74D6D0D7E93"/,
  "release certificate fingerprint remains pinned");
assert.match(workflow, /"\$tools\/apksigner" verify --verbose --print-certs "\$signed"/,
  "release signature verified");
assert.match(workflow, /"\$tools\/aapt" dump badging "\$signed"/,
  "verify version and identity from the final signed APK");
assert.match(workflow, /expected_code="\$\(\(100000 \+ GITHUB_RUN_NUMBER\)\)"/,
  "embedded signed version code is checked against the run number");
assert.match(workflow, /"\$package" != "work\.samelling\.vrelive\.lab"/,
  "package identity changes stop release");
assert.match(workflow, /if \[\[ "\$actual" != "\$expected" \]\]/,
  "certificate changes stop release");
assert.match(workflow, /name: vre-live-lab-signed-\$\{\{ github\.run_number \}\}/,
  "artifact is uniquely identified by release workflow run");
assert.match(workflow, /path: android-lab\/app\/build\/outputs\/apk\/release\/VRE-Live-Lab-signed\.apk/,
  "signed artifact path matches the generated file");
assert.doesNotMatch(workflow, /vre-live-lab-0\.1\.11-signed-release-apk|VRE-Live-Lab-0\.1\.11-signed\.apk/,
  "remove stale release labels from the current build");
assert.match(guide, /one-time uninstall\/reinstall/,
  "disclose signature transition and data loss risk");
assert.match(guide, /Do \*\*not\*\* uninstall/,
  "signed-to-signed upgrades preserve data");
console.log("Signed Android Lab update workflow, versioning, and certificate guards verified");
