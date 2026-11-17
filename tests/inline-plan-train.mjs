import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, runInNewContext } from "node:vm";

const page = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const script = id => page.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'))?.[1];
const coreSource = script("vre-core");
const commutesSource = script("vre-commutes");
const leaveSource = script("vre-leave-by");
const app = script("vre-app");
const css = page.match(/<style>([\s\S]*?)<\/style>/)?.[1];
assert.ok(coreSource && commutesSource && leaveSource && app && css);
for (const source of [coreSource, commutesSource, leaveSource, app])
  assert.doesNotThrow(() => new Script(source), "inline JavaScript remains syntactically valid");
const core = runInNewContext(coreSource + "\n;globalThis").VRECore;
const commutes = runInNewContext(commutesSource + "\n;globalThis").VRECommutes;
const leaveBy = runInNewContext(leaveSource + "\n;globalThis").VRELeaveBy;
const profile = (id, name, from, to, trains, travelMinutes = 0, days = [1,2,3,4,5]) => ({
  id, name, from, to, preferredTrains: trains, travelMinutes,
  platformMinutes: 0, bufferMinutes: 5, days
});
const toWork = profile("work", "To work", "06", "03", ["310"], 0);
const fromWork = profile("home", "From work", "03", "06", ["303"], 15);
const pair = [toWork, fromWork];
const at = iso => Date.parse(iso);
const find = (time, profiles = pair, day = null) =>
  commutes.nextScheduled(profiles, day, at(time), core, leaveBy);
const early = find("2026-11-17T11:00:00Z"); // 06:00 EST
assert.equal(early.profile.id, "work", "early morning picks upcoming outbound train");
assert.equal(early.train, "310");
assert.equal(early.today, true);
assert.equal(early.dep, at("2026-11-17T12:25:00Z"), "Lorton 7:25 AM EST");

const noLiveTrain = find("2026-11-17T14:32:00Z"); // 09:32 EST
assert.equal(noLiveTrain.profile.id, "home", "expired morning plan advances to return profile");
assert.equal(noLiveTrain.train, "303", "afternoon train comes from saved preferred trains");
assert.equal(noLiveTrain.today, true);
assert.equal(noLiveTrain.dep, at("2026-11-17T20:15:00Z"),
  "return leg departs Crystal City at 3:15 PM EST");
const tomorrow = find("2026-11-18T01:30:00Z"); // Tue 20:30 EST
assert.equal(tomorrow.profile.id, "work", "past today's service previews next eligible commute");
assert.equal(tomorrow.today, false);
assert.equal(tomorrow.dayOffset, 1);
assert.equal(tomorrow.dep, at("2026-11-18T12:25:00Z"), "future Eastern wall time remains correct");

const weekend = find("2026-11-21T14:32:00Z"); // Saturday
assert.equal(weekend.today, false);
assert.equal(weekend.date, "20261123", "weekend previews Monday, not phantom service");

const skipped = find("2026-11-17T11:00:00Z", pair,
  { date: "20261117", skippedDay: true });
assert.equal(skipped.date, "20261118", "explicit skip day hides every today candidate");
const skipOne = find("2026-11-17T11:00:00Z", pair,
  { date: "20261117", skippedTrips: { work: true } });
assert.equal(skipOne.profile.id, "home", "skipping an outbound trip retains return choice");
const holiday = find("2026-11-26T14:32:00Z");
assert.equal(holiday.date, "20261130",
  "Thanksgiving plus Friday closure leads to next weekday service");
const summer = find("2026-07-14T11:00:00Z");
assert.equal(summer.dep, at("2026-07-14T11:25:00Z"),
  "DST uses the actual Eastern UTC offset rather than device timezone");
assert.equal(find("2026-11-17T14:32:00Z", []), null,
  "without Advanced routines there is no fabricated profile");
assert.equal(find("2026-11-17T14:32:00Z",
  [profile("invalid", "Missing route", "06", "03", [], 0)]), null,
  "unconfigured preferred trains must not create a phantom plan");

assert.match(app, /function CommuteCard\(/);
const card = app.slice(app.indexOf("  function CommuteCard("),
  app.indexOf("  \/\* ---------------- departure board", app.indexOf("  function CommuteCard(")));
assert.match(card, /aria-expanded=\$\{showDetails\} aria-controls="inline-commute-blueprint"/,
  "one collapsed control expands the inline blueprint");
assert.match(card, /Plan train <\$\{Chevron\} open=\$\{showDetails\} \/>/,
  "the primary button is labeled Plan train");
assert.doesNotMatch(card, /More options|Fewer options|onChangePlan|onOtherPlans/,
  "no duplicate more-options or secondary full-page planner button");
assert.match(card, /setSelectedTrain\(r.num\)/, "train selection is separate from confirmation");
assert.match(card, /disabled=\$\{!selectedRow \|\| !minutesValid\} onClick=\$\{confirm\}>Confirm train/,
  "confirmation is explicit and requires a selected train");
assert.match(card, /const n = travelOverride \?\? candidateProfile\?\.travelMinutes/,
  "Advanced travel minutes win over fallback");
assert.match(card, /Number.isInteger\(n\) && n > 0 \? n : 10/,
  "unspecified travel defaults to 10, not zero");
assert.match(card, /id="commute-plan-minutes"/, "travel time is an editable numeric field");
assert.ok(card.indexOf('id="commute-plan-minutes"') >
  card.indexOf('className="commute-extra-label"'),
  "travel time appears after train and other options");
const travelIndex = card.indexOf('className="commute-plan-travel"');
const confirmIndex = card.indexOf('>Confirm train</button>');
const chartIndex = card.indexOf('Time-space chart');
assert.ok(travelIndex > 0 && travelIndex < confirmIndex && confirmIndex < chartIndex,
  "time to station is above Confirm train, and optional time-space chart is the last action");
assert.match(card, /className="commute-plan-travel-stepper"/,
  "travel-time control is one compact stepper, not a floating browser form field");
assert.match(card, /aria-label="Decrease travel time by one minute"/);
assert.match(card, /aria-label="Increase travel time by one minute"/);
assert.match(card, /onClick=\$\{\(\) => adjustMinutes\(-1\)\}/);
assert.match(card, /onClick=\$\{\(\) => adjustMinutes\(1\)\}/);
assert.match(card, /const minutesValid = \/\^\\d\{1,3\}\$\//,
  "editable field rejects empty or malformed numeric drafts");
assert.match(card, /enteredMinutes >= 1 && enteredMinutes <= 180/,
  "travel time has a bounded valid range");
assert.match(card, /aria-invalid=\$\{!minutesValid\}/,
  "screen readers know when manual travel-time input is invalid");
assert.match(card, /onBlur=\$\{restoreMinutes\}/,
  "invalid partial typing restores the last valid value on blur");
assert.match(card, /setMinutesDraft\(String\(normalized\)\)/,
  "saved Advanced travel time and 10-minute fallback sync into the displayed control");
assert.match(card, /setMinutesDraft\(String\(next\)\)/,
  "stepper updates editable text and confirmed numeric state together");
assert.match(card, /disabled=\$\{!selectedRow \|\| !minutesValid\}/,
  "invalid minute values prevent confirmation");
assert.match(card, /aria-expanded=\$\{showMarey\}/,
  "time-space chart disclosure remains keyboard- and touch-accessible");
assert.match(css, /\.commute-plan-step\{[^}]*width:48px;height:48px;/s,
  "each minus/plus stepper button has a 48px minimum Android hit area");
assert.match(css, /\.commute-plan-travel-value input:focus-visible\{outline:2px solid var\(--focus\)/,
  "numeric input has a visible theme-aware keyboard focus ring");
assert.doesNotMatch(css, /\.commute-plan-travel-input\{/,
  "the obsolete unthemed-looking number box styles are removed");
assert.match(card, /\.filter\(\(\) => !nextAdvanced \|\| nextAdvanced.today \|\| !!planned\)/,
  "tomorrow's saved trains must not be planned as if today were service day");
assert.match(app, /nextScheduled\(\s*commutes.profiles, commuteDay, now, VRECore, VRELeaveBy\)/,
  "next scheduled Advanced commute does not require the live feed to be reporting");
assert.match(app, /const featuredAdvanced = !primaryPlan && !manualRoute/,
  "manual route decisions and confirmed plans override automatic suggestions");
assert.match(app, /nativeCommute\(\{ type: "plan", profileId: choice.profile.id, train: choice.train \}\)/,
  "Advanced selected trains still go through the native confirmation bridge");
assert.match(app, /lsSet\("vre-live-inline-plan-v1", record\)/,
  "Basic Commute has a local explicit-plan fallback instead of a no-op");
assert.match(app, /const travel = overrides\[p.id\] \?\? p.travelMinutes/,
  "planned Advanced travel fallback is resolved when calculating leave-by time");
assert.match(css, /\.commute-plan-confirm\{min-height:44px/,
  "confirm control remains reachable with a proper tap target");
console.log("VRE inline Plan train and chronological Advanced Commute regressions passed");