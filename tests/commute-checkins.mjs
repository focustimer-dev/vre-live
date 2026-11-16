import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, runInNewContext } from "node:vm";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const source = read("src/index.html");
const app = source.match(/<script id="vre-app">([\s\S]*?)<\/script>/)?.[1];
const core = source.match(/<script id="vre-core">([\s\S]*?)<\/script>/)?.[1];
const commutes = source.match(/<script id="vre-commutes">([\s\S]*?)<\/script>/)?.[1];
assert.ok(app && core && commutes, "all three web scripts embedded");
assert.doesNotThrow(() => new Script(app), "app script parses");
assert.doesNotThrow(() => new Script(commutes), "profile model parses");
const { VRECore } = runInNewContext(core + "\n;globalThis");
const { VRECommutes } = runInNewContext(commutes + "\n;globalThis");

const morning = { id: "m", name: "Morning", from: "06", to: "03",
  preferredTrains: ["310"], days: [1,2,3,4,5], checkIn: "06:45",
  travelMinutes: 15, platformMinutes: 2, bufferMinutes: 8, mode: "drive" };
const normal = VRECommutes.normalizeProfile(morning, VRECore);
assert.equal(normal.checkInEnabled, false, "opt-in defaults off");
const enabled = VRECommutes.normalizeProfile({ ...morning, checkInEnabled: true }, VRECore);
assert.equal(enabled.checkInEnabled, true, "explicit opt-in stored");
assert.equal(VRECommutes.normalizeProfile({ ...morning, checkInEnabled: "true" }, VRECore).checkInEnabled,
  false, "only boolean true opts in");
assert.ok(app.includes('window.VreCommutePrefs?.postMessage'), "native bridge is only used when available");
assert.ok(app.includes('type: "sync", version: 1, profiles: next.profiles, prompt: true'),
  "explicit Save synchronizes with native scheduler");
assert.ok(app.includes('type: "sync", version: 1, profiles: commutes.profiles, prompt: false'),
  "app startup does not request notification permission");
assert.ok(app.includes('Select at least one train before enabling check-ins.'), "opt-in needs selected train");
assert.match(app, /Daily check-in notifications are available in the Android app/, "PWA makes local-only limitation explicit");
assert.ok(app.includes('function TodayCommute('), "manual recovery/choice UI exists");
assert.ok(app.includes('onAction("reactivate", p.id)'), "manual recovery from skip");
assert.ok(app.includes('onAction("skipTrip", selected.id)'), "one-trip skip exists");
assert.ok(app.includes('onAction("skipToday", "")'), "whole-day skip exists");
assert.ok(app.includes('Live leave-time alerts come later'), "does not promise live ETA alerts");

const css = read("android-lab/web/session.css");
const activity = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/MainActivity.kt");
const native = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/CommuteCheckIns.kt");
const manifest = read("android-lab/app/src/main/AndroidManifest.xml");
assert.match(activity, /WindowInsets\.CONSUMED/, "native root consumes insets exactly once");
assert.match(css, /html body \{ padding-top: 0; padding-bottom: 0; \}/,
  "Android WebView does not add second safe-area padding");
assert.match(css, /\.lab-session\[hidden\] \{ display: none !important/,
  "hidden login/session panel never occupies top space");
assert.match(activity, /VreCommutePrefs/, "native bridge installed");
assert.match(activity, /CommuteCheckIns\.reschedule\(this\)/, "native alarms reconcile on app open");
assert.match(activity, /requestPermissions\(arrayOf\(Manifest.permission.POST_NOTIFICATIONS\), 43\)/,
  "notifications permission requested only on explicit save");
assert.match(native, /if \(!p\.optBoolean\("checkInEnabled"\)/, "unsaved/disabled routines cannot schedule");
assert.match(native, /if \(!notificationsAllowed\(context\)\) return/, "permission gate before scheduling");
assert.match(native, /if \(!notIn\(data\.optJSONArray\("noService"\), key\)\) return false/,
  "calendar excludes no-service days");
assert.match(native, /if \(date\.dayOfWeek\.value >= 6\) return false/,
  "no weekend notifications");
assert.match(native, /fun skipToday\(context: Context\)/, "whole-day skip action exists");
assert.match(native, /skipped\.put\(id, true\)/,
  "skip-day persists per-profile suppression after manual reactivation");
assert.match(native, /fun reactivate\(context: Context, id: String\)/, "accidental skip can be undone");
assert.match(native, /System\.currentTimeMillis\(\) \+ 10 \* 60000/, "remind-later is local and ten minutes");
assert.match(native, /setAndAllowWhileIdle/, "fallback works without exact-alarm permission");
assert.match(native, /checkSelfPermission\(Manifest.permission.POST_NOTIFICATIONS\)/,
  "notification permission checked");
assert.doesNotMatch(native, /https?:\/\/|HttpURLConnection|URL\(|fetch\(|RideMonitor\(/,
  "local check-in scheduler never fetches VRE data or starts tracking");
assert.match(manifest, /RECEIVE_BOOT_COMPLETED/, "native scheduler can recover after reboot");
assert.match(manifest, /CommuteCheckReceiver/, "broadcast receiver registered");
const gradle = read("android-lab/app/build.gradle");
assert.match(gradle, /: 15/, "PR debug build keeps its distinct baseline version");
assert.match(gradle, /vreLabRunNumber/, "main signed Lab builds use independent monotonically increasing versions");
console.log("VRE Commute Watch B: check-in/insets regression checks passed");
