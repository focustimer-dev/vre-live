import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, runInNewContext } from "node:vm";

const page = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const section = id => page.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'))?.[1];
const coreSource = section("vre-core");
const commuteSource = section("vre-commutes");
const app = section("vre-app");
const css = page.match(/<style>([\s\S]*?)<\/style>/)?.[1];
assert.ok(coreSource && commuteSource && app && css);
assert.doesNotThrow(() => new Script(app), "app script parses");
const core = runInNewContext(coreSource + "\n;globalThis").VRECore;
const commute = runInNewContext(commuteSource + "\n;globalThis").VRECommutes;
assert.equal(typeof commute.homeLeg, "function");

const route = { a: "06", b: "03" }; // Lorton -> Crystal City
const morning = Date.parse("2026-11-17T13:35:00Z"); // 08:35 EST
const afternoon = Date.parse("2026-11-17T20:00:00Z"); // 15:00 EST
const julyMorning = Date.parse("2026-07-13T15:00:00Z"); // 11:00 EDT
const available = {
  "06>03": [{ num: "310" }],
  "03>06": [{ num: "303" }]
};
const makeCore = data => ({
  STATIONS: core.STATIONS,
  serviceDateKey: core.serviceDateKey,
  isServiceDay: core.isServiceDay,
  nextDepartures(from, to, now, liveByTrip, count) {
    assert.equal(count, 1, "no network or bulk work: only probe next departure");
    return (data[from + ">" + to] || []).slice(0, count);
  }
});
const both = makeCore(available);
const onlyReturn = makeCore({ "03>06": available["03>06"] });
const neither = makeCore({});
const resolve = (at, nativeRide = null, manual = null, mock = both, current = route) =>
  commute.homeLeg(current, manual, nativeRide, at, mock, {});

assert.equal(resolve(morning).returning, false, "before noon prefer outbound if available");
assert.equal(resolve(morning).reason, "clock");
assert.equal(resolve(morning, null, null, onlyReturn).returning, true,
  "after outbound is exhausted, surface available opposite-direction departures");
assert.equal(resolve(morning, null, null, onlyReturn).reason, "return-preview");
assert.equal(resolve(morning, null, null, onlyReturn).from, "03",
  "return leg explicitly departs Crystal City, not the home station");
assert.equal(resolve(morning, null, null, neither).returning, false,
  "when neither leg has trains, keep the expected direction and compact empty state");
assert.equal(resolve(afternoon).returning, true, "afternoon uses return leg in Eastern time");
assert.equal(resolve(julyMorning).returning, false, "daylight saving time is handled in Eastern time");

const ride = (dest, t = morning - 60000) => ({
  t, dest, from: null, manuallyEnded: true, train: "310"
});
assert.equal(resolve(morning, ride("03")).reason, "finished-outbound",
  "explicit off-train completion at saved work destination selects return leg");
assert.equal(resolve(morning, ride("03")).returning, true);
assert.equal(resolve(afternoon, ride("06", afternoon - 60000)).returning, false,
  "completed ride ending at saved home avoids showing a fictional ongoing return trip");
assert.equal(resolve(afternoon, ride("06", afternoon - 60000)).reason, "finished-return");
assert.equal(resolve(morning, ride("05"), null, both).returning, false,
  "unrelated destination does not claim user reached the work station");
assert.equal(resolve(morning, ride("03", morning - 86400000), null, both).reason, "clock",
  "yesterday's ride cannot change today's direction");
assert.equal(resolve(morning, ride("03", morning + 600000), null, both).reason, "clock",
  "future-dated rides cannot change direction");
assert.equal(resolve(morning, { ...ride("03"), manuallyEnded: false }, null, both).reason, "clock");
assert.equal(resolve(morning, ride("03"), false, both).returning, false,
  "manual direction always overrides completed-ride state");
assert.equal(resolve(morning, null, false, onlyReturn).returning, false,
  "manual outbound cannot silently auto-switch when no outbound trains remain");
assert.equal(resolve(morning, null, true, both).returning, true,
  "manual return explicitly selects the return leg");
assert.equal(resolve(Date.parse("2026-11-21T13:35:00Z"), null, null, onlyReturn).returning, false,
  "no opposite-leg preview on no-service weekend");
assert.equal(resolve(morning, null, null, both, { a: "03", b: "03" }), null,
  "invalid equal station route cannot choose a leg");

assert.match(app, /const \[lastCompletedRide, setLastCompletedRide\] = useState\(/,
  "restores most recent manually finished ride");
assert.match(app, /setLastCompletedRide\(rec\)/,
  "off-train action updates home leg immediately");
assert.match(app, /homeRoute = route \|\| \(primaryPlan/,
  "Basic Commute remains default; explicit Advanced plan is fallback when Basic is absent");
assert.match(app, /from=\$\{primaryPlan\?\.profile\.from \|\| homeLeg\.from\}/,
  "Advanced planned route wins over Basic Commute for departure options");
assert.match(app, /to=\$\{primaryPlan\?\.profile\.to \|\| homeLeg\.to\}/);
assert.match(app, /defaultDest=\$\{primaryPlan\?\.profile\.to \|\| homeLeg\?\.to \|\| null\}/,
  "destination picker uses the same selected route as the home card");
assert.match(app, /RETURN FROM " \+ STATIONS\[fromStation\]\.name/,
  "return leg states its departure station, never claims current location");
assert.match(app, /className=\$\{"card commute-focus" \+ \(noDepartures \? " no-departures" : ""\)\}/,
  "empty state activates compact layout");
assert.match(css, /\.commute-focus\.no-departures \.commute-focus-headline\.empty\{[^}]*padding:0;/s,
  "empty commute headline does not inherit 34px generic empty padding");
assert.match(css, /\.ride-control\.on\{color:var\(--green\);background:transparent\}/,
  "active bell no longer paints a filled background");
assert.match(css, /\.ride-notifications\.expanded\{[^}]*background:transparent;/,
  "expanding controls does not box in the bell");
assert.match(app, /<\$\{BellIcon\} size=\$\{16\} \/>/,
  "bell glyph is smaller while touch target remains 44px");
assert.match(css, /\.ride-control\{[^}]*min-width:44px;min-height:44px;/s,
  "bell retains the 44px invisible hit target");
assert.match(css, /\.ride-stop-target\{display:inline-flex;align-items:center;/,
  "destination name and chevron are an indivisible line unit");
assert.match(app, /<span className="ride-stop-target">[\s\S]*?<strong>\$\{stop\.name\}<\/strong><\$\{Chevron\} \/>/,
  "chevron is grouped with the destination and cannot orphan");
console.log("VRE return-leg direction, profile precedence, bell and compact-empty regressions passed");
