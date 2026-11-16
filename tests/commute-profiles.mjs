import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext, Script } from "node:vm";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const page = read("src/index.html");
const builder = read("android-lab/web/build-assets.mjs");
const script = id => {
  const hit = page.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'));
  assert.ok(hit, "missing inline runtime script " + id);
  return hit[1];
};
const appScript = script("vre-app");
assert.doesNotThrow(() => new Script(appScript), "App JavaScript parses");
assert.match(appScript, /function PreferencesPanel\(/, "Preferences panel exists");
assert.match(appScript, /<\$\{PreferencesPanel\}/, "Preferences panel is routed");
assert.match(appScript, /tab === "preferences"/, "Preferences is a distinct tab");
assert.match(appScript, /setPreferencesSection\("commute"\); setTab\("preferences"\)/,
  "Commute gear goes to simple preferences");
assert.match(appScript, /<\$\{CommuteCard\}/, "existing live timetable remains");
assert.match(appScript, /onFlip=\$\{\(\) => setFlipDir\(!showReturn\)\}/,
  "manual timetable direction flip remains");
assert.equal((appScript.match(/<\$\{RouteSetup\}/g) || []).length, 1,
  "basic route editor exists only within Preferences");
assert.equal((appScript.match(/<\$\{CommuteProfiles\}/g) || []).length, 1,
  "advanced commute editor exists only within Preferences");
assert.match(appScript, /No alerts are enabled here/, "basic commute does not promise alerts");
assert.match(appScript, /do not enable notifications or background monitoring yet/,
  "advanced commute does not promise live alerts");
const coreContext = runInNewContext(script("vre-core") + "\n;globalThis");
const prefContext = runInNewContext(script("vre-commutes") + "\n;globalThis");
const core = coreContext.VRECore, prefs = prefContext.VRECommutes;
assert.ok(core && prefs);
assert.ok(page.includes("function CommuteProfiles("), "editor is in app");
assert.ok(page.includes("VRECommutes.load(localStorage, VRECore)"), "profiles are loaded");
assert.ok(page.includes("VRECommutes.save(localStorage, next, VRECore)"), "profiles are persisted");
assert.ok(builder.includes('["vre-core", "vre-commutes", "vre-app"]'), "Android packages profile logic");
assert.ok(builder.includes('defer src="vre-commutes.js"'), "Android loads profiles before app");
assert.ok(!/\bfetch\s*\(|\bscheduled\s*\(|serviceWorker|navigator\./.test(script("vre-commutes")),
  "preference model never polls or creates alarms");
const memory = (initial = {}) => {
  const m = new Map(Object.entries(initial)), writes = [];
  return { writes, getItem: key => m.has(key) ? m.get(key) : null,
    setItem: (key, value) => { writes.push(key); m.set(key, value); },
    raw: key => m.get(key) };
};
const empty = memory();
const emptyLoaded = prefs.load(empty, core);
assert.equal(emptyLoaded.profiles.length, 0);
assert.equal(empty.writes.length, 0, "opening app without a commute does not write");
const route = '{"a":"06","b":"03"}'; // Lorton → Crystal City
const store = memory({ "vre-live-route": route });
const original = store.raw("vre-live-route");
const converted = prefs.load(store, core);
assert.equal(converted.profiles.length, 2, "both directions are migrated");
assert.equal(converted.profiles[0].from, "06");
assert.equal(converted.profiles[0].to, "03");
assert.equal(converted.profiles[1].from, "03");
assert.equal(converted.profiles[1].to, "06");
assert.deepEqual(Array.from(converted.profiles[0].preferredTrains), [],
  "legacy route does not silently opt into a train");
assert.equal(store.raw("vre-live-route"), original, "old app route untouched");
assert.equal(store.writes.length, 1, "migration writes only its own key");
assert.equal(store.writes[0], prefs.KEY);
assert.equal(prefs.load(store, core).profiles.length, 2, "migration is idempotent");
assert.equal(store.writes.length, 1, "repeat load does not rewrite");
const morning = prefs.choices(core, "06", "03");
const evening = prefs.choices(core, "03", "06");
assert.ok(morning.length > 0 && evening.length > 0);
assert.ok(morning.some(t => t.num === "310" && t.departureMinutes === 445),
  "train 310 departs Lorton at 7:25 AM");
assert.equal(prefs.choices(core, "06", "06").length, 0);
assert.equal(prefs.choices(core, "12", "03").some(t => t.line === "F"), false);
const withSelection = prefs.upsert(converted, {
  ...converted.profiles[0], preferredTrains: ["310", "310", "9999"],
  mode: "drive", travelMinutes: 15, platformMinutes: 2, bufferMinutes: 8,
  days: [5, 1, 1, 3], checkIn: "06:45"
}, core);
assert.ok(withSelection);
assert.deepEqual(Array.from(withSelection.profiles[0].preferredTrains), ["310"]);
assert.deepEqual(Array.from(withSelection.profiles[0].days), [1, 3, 5]);
assert.equal(withSelection.profiles[0].travelMinutes, 15);
assert.equal(withSelection.profiles[0].platformMinutes, 2);
assert.equal(withSelection.profiles[0].bufferMinutes, 8);
assert.equal(prefs.save(store, withSelection, core), true);
assert.equal(prefs.load(store, core).profiles[0].preferredTrains[0], "310");
assert.equal(store.raw("vre-live-route"), original, "new preferences don't overwrite legacy route");
const plusOne = prefs.upsert(withSelection, {
  ...prefs.blank("03", "06"), id: "custom-office",
  name: "Leaving office", preferredTrains: evening.slice(0, 3).map(t => t.num),
  mode: "walk", travelMinutes: 12, platformMinutes: 0, bufferMinutes: 5, checkIn: "14:45"
}, core);
assert.equal(plusOne.profiles.length, 3, "supports any number of routines");
const removed = prefs.remove(plusOne, "custom-office", core);
assert.equal(removed.profiles.length, 2);
assert.equal(plusOne.profiles.length, 3, "remove is immutable");
assert.equal(prefs.upsert(plusOne, { ...plusOne.profiles[0], from: "nope" }, core), null);
const invalid = prefs.normalizeRecord({ version: 1, profiles: [
  { id: "malformed", from: "03", to: "03", preferredTrains: ["310"] },
  { ...plusOne.profiles[0], travelMinutes: 9999, checkIn: "25:99", days: [8, 1] },
  { ...plusOne.profiles[0], id: plusOne.profiles[0].id }
] }, core);
assert.equal(invalid.profiles.length, 1);
assert.equal(invalid.profiles[0].travelMinutes, 0);
assert.equal(invalid.profiles[0].checkIn, "06:45");
assert.deepEqual(Array.from(invalid.profiles[0].days), [1]);
const newer = memory({ [prefs.KEY]: '{"version":2,"profiles":[{"id":"future"}]}' });
const future = prefs.load(newer, core);
assert.equal(future.unsupportedVersion, true);
assert.equal(prefs.save(newer, future, core), false);
assert.equal(newer.writes.length, 0, "older clients must not overwrite newer schemas");
const corrupt = prefs.load(memory({ [prefs.KEY]: "not-json" }), core);
assert.equal(corrupt.storageError, true);
console.log("VRE offline commute profiles, migration, and Android packaging checks passed");
