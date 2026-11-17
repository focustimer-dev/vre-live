import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const project = read("android-lab/build.gradle");
const module = read("android-lab/app/build.gradle");
const manifest = read("android-lab/app/src/main/AndroidManifest.xml");
const receiver = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/CommuteFirebaseMessagingService.kt");
const config = JSON.parse(read("android-lab/app/google-services.json"));

assert.equal(config.project_info.project_id, "vre-live");
assert.equal(config.client.length, 1);
assert.equal(config.client[0].client_info.android_client_info.package_name,
  "work.samelling.vrelive.lab", "Firebase client matches the exact signed Android Lab app package");
assert.ok(config.client[0].client_info.mobilesdk_app_id);
assert.ok(config.client[0].api_key[0].current_key);
assert.ok(!JSON.stringify(config).includes("private_key"),
  "client config must not contain Firebase service-account secrets");

assert.match(project, /id 'com\.google\.gms\.google-services' version '4\.6\.0' apply false/);
assert.match(module, /id 'com\.google\.gms\.google-services'/);
assert.match(module, /firebase-bom:35\.2\.0/);
assert.match(module, /implementation 'com\.google\.firebase:firebase-messaging'/);
assert.doesNotMatch(module, /implementation 'com\.google\.firebase:firebase-analytics'/,
  "push messaging does not require Analytics");

assert.match(manifest, /android:name="firebase_messaging_auto_init_enabled" android:value="false"/,
  "registration must not start without explicit consent");
assert.match(manifest, /android:name="firebase_analytics_collection_enabled" android:value="false"/);
assert.match(manifest, /<service android:name="\.CommuteFirebaseMessagingService"\s+android:exported="false"/);
assert.match(manifest, /com\.google\.firebase\.MESSAGING_EVENT/);

assert.match(receiver, /class CommuteFirebaseMessagingService : FirebaseMessagingService\(\)/);
assert.match(receiver, /override fun onNewToken\(token: String\)/);
assert.match(receiver, /override fun onMessageReceived\(message: RemoteMessage\)/);
assert.match(receiver, /if \(message\.data\["kind"\] != "leave_now"\) return/);
assert.match(receiver, /CommutePushClient\.displayIfAllowed\(this, message\.data\)/);
assert.match(receiver, /CommutePushClient\.onTokenRotated\(this, token\)/);
const push = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/CommutePushClient.kt");
const main = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/MainActivity.kt");
assert.match(push, /AndroidKeyStore/);
assert.match(push, /AES\/GCM\/NoPadding/);
assert.match(push, /fun pair\(context: Context, code: String/);
assert.match(push, /if \(!CommuteCheckIns\.enabled\(context\)\)/);
assert.match(push, /if \(!paired\(context\) \|\| !allowed\(context\)\) return/);
assert.match(push, /CommuteCheckIns\.confirmedPlan\(context, w\.optString\("profileId"\)\)/);
assert.match(push, /if \(w\.optBoolean\("shown"\)\) return/);
assert.match(push, /fun cancelAll\(context: Context\)/);
assert.match(push, /fun disconnect\(context: Context\)/);
assert.match(main, /VrePushPair/);
assert.match(main, /CommutePushClient\.watchSelected\(this,profileId\)/);
assert.match(main, /CommutePushClient\.cancelAll\(this\)/);
assert.doesNotMatch(push, /MONITOR_GATEWAY_TOKEN|FCM_SERVICE_ACCOUNT_JSON|PAIRING_CODE/,
  "mobile client must not include a shared server or FCM admin secret");

console.log("Firebase Android client configuration and default-off messaging guard verified");
