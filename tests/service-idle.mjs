import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const page = read("src/index.html");
const worker = read("src/worker.js");
const android = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/RideMonitor.kt");
const config = read("wrangler.toml");
const build = read("android-lab/web/build-assets.mjs");
const coreSource = page.match(/<script id="vre-core">([\s\S]*?)<\/script>/)?.[1];
assert.ok(coreSource, "embedded VRECore exists");
const { VRECore } = runInNewContext(coreSource + "\n;globalThis");
const midday = date => new Date(date + "T17:00:00Z");

for (const [date, open] of [
  ["2026-11-16", true], ["2026-11-21", false],
  ["2026-11-26", false], ["2026-11-27", false],
  ["2026-06-19", false], ["2027-06-18", false], ["2026-07-03", true],
  ["2026-12-24", true], ["2026-12-25", false],
  ["2026-12-29", true], ["2026-12-30", true],
  ["2026-12-31", true], ["2027-01-01", false],
]) {
  assert.equal(VRECore.isServiceDay(midday(date)), open, "service day: " + date);
}
assert.equal(VRECore.SCHEDULE.reducedService.includes("20261224"), true);
assert.equal(VRECore.SCHEDULE.sTrains.has("302"), true);
assert.equal(VRECore.SCHEDULE.sTrains.has("300"), false);

const sliceBetween = (text, start, end) => {
  const i = text.indexOf(start);
  assert.ok(i >= 0, "missing " + start);
  const j = text.indexOf(end, i + start.length);
  assert.ok(j > i, "missing " + end);
  return text.slice(i, j);
};
const browserWindow = runInNewContext(
  sliceBetween(page, "  const serviceClock =", "  const REFRESH_MS") +
  "\n;automaticServiceWindow", { VRECore }
);
const cronWindow = runInNewContext(
  sliceBetween(worker, "function backgroundServiceWindow(now) {",
    "\n__name(backgroundServiceWindow") + "\n;backgroundServiceWindow",
  { VRECore }
);
const currentRide = runInNewContext(
  sliceBetween(page, "  function isCurrentRide(ride,", "  const LS_KEY") +
  "\n;isCurrentRide", { VRECore }
);
const when = iso => Date.parse(iso);
for (const iso of [
  "2026-11-16T08:00:00Z", // 3 AM Eastern: no trains
  "2026-11-21T13:00:00Z", // Saturday
  "2026-11-26T13:00:00Z", // Thanksgiving
  "2026-11-27T13:00:00Z", // day after Thanksgiving
  "2026-12-25T13:00:00Z", // Christmas
  "2026-12-24T18:00:00Z", // S schedule midday gap, 1 PM Eastern
]) {
  assert.equal(browserWindow(when(iso), true), false, "browser idle " + iso);
  assert.equal(cronWindow(when(iso)), false, "server idle " + iso);
}
for (const iso of [
  "2026-11-16T11:00:00Z", // regular service, 6 AM Eastern
  "2026-12-24T11:00:00Z", // reduced S schedule, 6 AM Eastern
  "2026-12-24T23:00:00Z", // reduced S schedule, 6 PM Eastern
]) {
  assert.equal(browserWindow(when(iso), true), true, "browser service " + iso);
  assert.equal(cronWindow(when(iso)), true, "server service " + iso);
}

// DST boundary regression: the same 6 AM Eastern clock time maps to different
// UTC instants before/after the March and November transitions.
for (const [iso, expected] of [
  ["2027-03-12T11:00:00Z", true], // 6 AM EST before spring forward
  ["2027-03-14T10:00:00Z", false], // 6 AM EDT on transition Sunday
  ["2027-03-15T10:00:00Z", true], // 6 AM EDT after spring forward
  ["2027-11-05T10:00:00Z", true], // 6 AM EDT before fall back
  ["2027-11-07T11:00:00Z", false], // 6 AM EST on transition Sunday
  ["2027-11-08T11:00:00Z", true], // 6 AM EST after fall back
  ["2027-03-15T07:00:00Z", false], // 3 AM EDT, still off hours
  ["2027-11-08T08:00:00Z", false], // 3 AM EST, still off hours
]) {
  assert.equal(browserWindow(when(iso)), expected, "browser DST " + iso);
  assert.equal(cronWindow(when(iso)), expected, "server DST " + iso);
}

const noon = when("2026-11-16T17:00:00Z");
assert.equal(currentRide({boardedAt: noon - 60000}, noon), true);
assert.equal(currentRide({boardedAt: noon - 5 * 3600000}, noon), false);
assert.equal(currentRide({boardedAt: noon + 60000}, noon), false);
assert.equal(currentRide(null, noon), false);
const midnightCross = when("2026-11-17T05:15:00Z"); // 12:15 AM Eastern
assert.equal(currentRide({boardedAt: when("2026-11-17T04:50:00Z")}, midnightCross), false);

const scheduled = sliceBetween(worker, "async function runAlertCron(env) {", "\n__name(runAlertCron");
const guard = scheduled.indexOf("if (!backgroundServiceWindow(now)) return;");
const kvRead = scheduled.indexOf("const rides = await loadRides(env);");
const empty = scheduled.indexOf("if (!ids.length)");
const outbound = scheduled.indexOf('feedBytes("VehiclePositionFeed")');
assert.ok(guard >= 0 && guard < kvRead, "service window checked before KV");
assert.ok(kvRead < empty && empty < outbound, "stale/empty rides checked before outbound feed");
assert.match(worker, /if \(!backgroundServiceWindow\(Date\.now\(\)\)\)\s*return new Response\(null, \{ status: 204/);
assert.match(worker, /const started = Number\(ride && ride.created\)/);
assert.match(worker, /if \(!ids.length\) \{\s*if \(dirty\) await saveRides/);
assert.match(page, /if \(!automaticServiceWindow\(Date\.now\(\), activeRide\)\) return/);
assert.match(page, /return isCurrentRide\(saved\)/);
assert.match(android, /if \(started\.toLocalDate\(\) != now\.toLocalDate\(\) \|\| noService \|\| !inServiceWindow\)/);
assert.ok(android.indexOf("if (started.toLocalDate()") <
  android.indexOf("val connection = URL("), "Android skips network when idle");
assert.match(build, /reducedService: VRECore\.SCHEDULE\.reducedService/);
assert.match(build, /sTrains: \[\.\.\.VRECore\.SCHEDULE\.sTrains\]/);
assert.ok(config.includes('MON-FRI') && config.includes('TUE-SAT'), "weekday cron");
assert.ok(!config.includes('crons = ["* * * * *"]'), "no round-the-clock cron");

console.log("VRE idle-network guards and service calendar passed");
