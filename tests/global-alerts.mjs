import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext, Script } from "node:vm";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const source = read("src/index.html");
const script = id => {
  const m = source.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'));
  assert.ok(m, "missing " + id);
  return m[1];
};
const pref = runInNewContext(script("vre-alerts") + "\n;globalThis").VREAlerts;
assert.ok(pref);
assert.doesNotThrow(() => new Script(script("vre-app")));
const store = (initial={}) => {
  const kv = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem:k=>kv.has(k)?kv.get(k):null,
    setItem:(k,v)=>{ writes.push(k); kv.set(k,v); },
    raw:k=>kv.get(k)
  };
};
const legacy = [
  {id:"morning",from:"06",to:"03",checkInEnabled:true,checkIn:"06:45"},
  {id:"afternoon",from:"03",to:"06",checkInEnabled:false,checkIn:"14:45"}
];
const s = store();
const migrated = pref.load(s, legacy);
assert.equal(migrated.enabled,true,"explicit old consent survives migration");
assert.equal(migrated.checkIns,true,"migrated check-ins remain enabled");
assert.equal(migrated.arrival,false,"migration never silently enables ride notifications");
assert.equal(migrated.legacyTimes,true,"legacy timing is preserved until user changes it");
assert.deepEqual(Array.from(migrated.scopeIds),["morning"],
  "previously disabled afternoon commute is not silently opted in");
assert.equal(s.writes.length,0,"passive migration never touches local storage");
const switched = pref.useSmartSchedule(migrated);
assert.equal(switched.legacyTimes,false,"user can explicitly switch to train-derived schedule");
assert.equal(switched.scopeIds,null,"explicit switch covers all saved commutes");
assert.equal(switched.leadMinutes,15);
assert.equal(pref.save(s,switched),true);
assert.equal(s.writes.length,1);
assert.equal(pref.load(s,legacy).legacyTimes,false);
const empty = pref.load(store(),[]);
assert.equal(empty.enabled,false,"new installs default off");
assert.equal(empty.checkIns,false);
assert.equal(empty.arrival,true,"global opt-in will default new rides to arrival bell on");
assert.equal(empty.sound,false,"commute sound is opt-in");
assert.equal(empty.vibration,false,"commute vibration is opt-in");
assert.equal(pref.normalize({...empty,leadMinutes:250}).leadMinutes,15);
assert.equal(pref.normalize({...empty,leadMinutes:5}).leadMinutes,5);
assert.equal(pref.normalize({...empty,leadMinutes:90}).leadMinutes,90);
assert.equal(pref.normalize({...empty,leaveNow:true}).leaveNow,false,
  "unimplemented background leave notification cannot be enabled");
const future = store({[pref.KEY]:JSON.stringify({version:2,enabled:true})});
const unknown = pref.load(future,legacy);
assert.equal(unknown.unsupportedVersion,true);
assert.equal(pref.save(future,unknown),false);
assert.equal(future.writes.length,0,"future schema remains untouched");
const editor = script("vre-app");
assert.match(editor,/function GlobalAlertSettings\(/);
assert.match(editor,/Check-ins & Alerts/);
assert.match(editor,/onSaveAlerts=\$\{saveAlertPrefs\}/);
assert.match(editor,/alerts: alertPrefs, prompt: false/,
  "editing profile never requests notification permission");
assert.match(editor,/type: "sync", version: 1, profiles: commutes.profiles,[\s\S]*?alerts: clean, prompt: clean.enabled/,
  "global settings are persisted to Android");
assert.match(editor,/Arrival alerts when riding/);
assert.match(editor,/autoArmRequested: !!\(androidRideAlert && alertPrefs\.enabled/,
  "new Android rides inherit global arrival setting");
assert.match(editor,/if \(!alertPrefs\.enabled\) \{/,
  "ride bell respects global master switch");
assert.doesNotMatch(editor,/draft\.checkInEnabled|change\("checkInEnabled"|field\("Check-in time \(Eastern\)"/,
  "per-commute check-in controls were removed");
const build = read("android-lab/web/build-assets.mjs");
assert.match(build,/"vre-core", "vre-commutes", "vre-alerts", "vre-leave-by", "vre-app"/);
assert.match(build,/defer src="vre-alerts.js"/);
const native = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/CommuteCheckIns.kt");
const main = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/MainActivity.kt");
const ride = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/RideMonitor.kt");
assert.match(native,/private const val ALERTS = "alerts"/);
assert.match(native,/fun enabled\(context: Context\): Boolean/);
assert.match(native,/fun arrivalEnabled\(context: Context\): Boolean/);
assert.match(native,/if \(!notificationsAllowed\(context\) \|\| !checkInsEnabled\(context\)\) return/);
assert.match(native,/private fun checkInAt\(/);
assert.match(native,/optInt\("leadMinutes", 15\)/);
assert.match(native,/date\.atStartOfDay\(zone\)\.plusMinutes/,
  "check-ins are based on eastern service day and station travel + buffer");
assert.match(native,/if \(legacy\)/,
  "old opt-ins retain original absolute check-in times");
assert.match(native,/group\.forEach \{ prompted\.put\(it, true\) \}/,
  "coincident commute windows do not create duplicate prompts");
assert.match(native,/commute_checkins_v2_/,
  "immutable sound/vibration combinations use independent notification channels");
assert.match(native,/if \(!sound\) setSound\(null, null\)/);
assert.match(native,/enableVibration\(vibration\)/);
assert.match(main,/if \(!CommuteCheckIns\.enabled\(this\)\)/,
  "native ride notification and lock-screen controls respect master off");
assert.match(main,/stopService\(Intent\(this, RideMonitor::class\.java\)\)/,
  "disabling notifications ends live native alert monitoring");
assert.match(ride,/if \(!CommuteCheckIns\.enabled\(this\)\) \{ stopSelf\(\); return \}/,
  "native monitor fails closed if global consent removed");
assert.doesNotMatch(native,/https?:\/\/|HttpURLConnection|URL\(|fetch\(|RideMonitor\(/,
  "local check-in scheduler never polls the GTFS feed");
console.log("Global alerts, migration, native gating, and scheduling static checks passed");
