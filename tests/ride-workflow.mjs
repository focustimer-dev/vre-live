import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, runInNewContext } from "node:vm";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const page = read("src/index.html");
const app = page.match(/<script id="vre-app">([\s\S]*?)<\/script>/)?.[1];
const core = page.match(/<script id="vre-core">([\s\S]*?)<\/script>/)?.[1];
assert.ok(app && core);
assert.doesNotThrow(() => new Script(app), "app script parses with waiting flow");
const VRECore = runInNewContext(core + "\n;globalThis").VRECore;
const first = app.indexOf("  function waitingArrival(");
const last = app.indexOf("  function WaitingCard(", first);
assert.ok(first >= 0 && last > first, "pure waiting estimator found");
const estimate = runInNewContext(app.slice(first, last) + "\n;waitingArrival", { VRECore });

const now = Date.UTC(2026, 10, 16, 23, 1);
const station = "10";
const wait = { trip: "311", num: "311", dest: station, started: now,
  scheduled: now + 8 * 60000 };
const full = { ghost: false, signalLost: false, ts: now, nextStop: station,
  status: "In Transit", stops: [{code: "09", time: now - 5 * 60000},
    {code: station, time: now + 6 * 60000}, {code: "11", time: now + 14 * 60000}] };
assert.deepEqual(JSON.parse(JSON.stringify(estimate(wait, null, now))),
  { phase: "approaching", eta: now + 8 * 60000, minutes: 8, source: "schedule" },
  "with no live feed, use scheduled boarding ETA");
assert.equal(estimate(wait, full, now).minutes, 6, "fresh live ETA takes precedence");
assert.equal(estimate(wait, full, now).source, "live");
assert.equal(estimate(wait, {...full, ts: now - 6 * 60000}, now).minutes, 8,
  "stale GPS must not masquerade as a live forecast");
assert.equal(estimate(wait, {...full, ghost: true}, now).source, "schedule",
  "ghost train produces only scheduled estimate");
assert.equal(estimate(wait, full, now + 10 * 60000).phase, "overdue",
  "an old fresh ETA is not asserted as an arrival");
assert.equal(estimate(wait, null, now + 10 * 60000).phase, "overdue",
  "an expired timetable is clearly unconfirmed, not a negative countdown");
assert.equal(estimate({ ...wait, scheduled: null }, null, now).phase, "unavailable",
  "unknown ETA is reported rather than invented");
assert.equal(estimate(wait, { ...full, nextStop: "11" }, now).phase, "passed",
  "fresh evidence beyond the boarding stop is identified");
assert.equal(estimate(wait, full, now + 7 * 60000).source, "schedule",
  "a feed becomes stale as time passes");
assert.match(app, /function WaitingCard\(/);
assert.match(app, /<\$\{WaitingCard\} waiting=\$\{waitingFor\}/,
  "waiting card, rather than action-only row, renders in main UI");
assert.match(app, /waitingArrival\(waiting, train, now\)/, "waiting card uses estimator");
assert.match(app, /role="timer"/, "countdown is accessible without repeated announcements");
assert.match(app, /Timetable estimate · live arrival unconfirmed/,
  "schedule fallback is labeled, not presented as live certainty");
assert.match(app, /I've boarded · choose destination/, "boarded button signals additional step");
assert.match(app, /const boardingNow = !!boardingStation && !activeTrip/,
  "previous waiting stop is recognized when boarding");
assert.match(app, /You've boarded\. Where will you get off\?/,
  "boarding mode leads to explicit destination choice");
assert.match(app, /Start arrival countdown/,
  "destination confirmation advertises arrival countdown");
assert.match(app, /setWaitingFor\(null\); setMyTrip\(next\)/,
  "destination confirmation clears waiting mode and begins active ride");
assert.match(app, /<\$\{EtaBanner\} train=\$\{myTrain\}/,
  "active ride continues into destination ETA panel");
assert.match(app, /setSelected\(waitingFor\.trip\); setPicking\(true\)/,
  "boarding action opens the correct train");

const rideStart = app.indexOf("  function isCurrentRide(");
const rideEnd = app.indexOf("  const LS_KEY =", rideStart);
assert.ok(rideStart >= 0 && rideEnd > rideStart, "ride validity guard extracted");
const isCurrentRide = runInNewContext(app.slice(rideStart, rideEnd) + "\n;isCurrentRide",
  { VRECore });
const uiClock = Date.UTC(2026, 10, 16, 23, 17, 0);
// Exact regression: Date.now() is sampled for boardedAt after the most recent
// UI timer tick. The old guard rejected this as future and erased the ride.
const recentlyStarted = { tripId: "311", dest: "12", boardedAt: uiClock + 1200 };
assert.equal(isCurrentRide(recentlyStarted, uiClock), true,
  "new ride is not cleared because the last UI tick is 1.2 s old");
assert.equal(isCurrentRide(recentlyStarted, uiClock + 1500), true,
  "new ride remains valid when the next UI timer fires");
assert.equal(isCurrentRide({ ...recentlyStarted, boardedAt: uiClock + 12000 }, uiClock), false,
  "future ride timestamps beyond skew allowance are rejected");
assert.equal(isCurrentRide({ ...recentlyStarted, boardedAt: uiClock - 4 * 3600000 }, uiClock), false,
  "rides older than four hours expire");
assert.equal(isCurrentRide(null, uiClock), false, "absent ride is invalid");
assert.match(app, /if \(myTrip && !isCurrentRide\(myTrip, Date\.now\(\)\)\)/,
  "expiry effect reads actual clock, not the one-second render snapshot");
assert.match(app, /setRideStartError\("That stop is no longer available/,
  "selection failure is visible instead of a silent no-op");
assert.match(app, /setRideStartError\("Couldn't start arrival tracking/,
  "unexpected ride-start failures are reported");
assert.match(app, /role="alert"/, "ride-start error is accessible in destination sheet");

console.log("VRE waiting ETA and boarding transition regressions passed");