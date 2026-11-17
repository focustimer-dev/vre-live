import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext, Script } from "node:vm";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const page = read("src/index.html");
const script = id => {
  const match = page.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'));
  assert.ok(match, "missing " + id);
  return match[1];
};
const VRECore = runInNewContext(script("vre-core") + "\n;globalThis").VRECore;
const { VRELeaveBy } = runInNewContext(script("vre-leave-by") + "\n;globalThis");
const app = script("vre-app"), build = read("android-lab/web/build-assets.mjs");
assert.doesNotThrow(() => new Script(app));
assert.doesNotThrow(() => new Script(script("vre-leave-by")));
assert.match(build, /"vre-core", "vre-commutes", "vre-alerts", "vre-leave-by", "vre-app"/,
  "Android packages both global alert settings and departure calculator");
assert.match(build, /defer src="vre-leave-by.js"/, "Android loads the calculator before app");
assert.doesNotMatch(script("vre-leave-by"),
  /fetch\(|postMessage\(|AlarmManager|serviceWorker|setInterval\(|setTimeout\(/,
  "the forecast is pure: no polling, notifications or background work");

const time = iso => Date.parse(iso);
const now = time("2026-11-16T11:45:00Z"); // Mon 6:45 AM EST
const profile = { id: "am", name: "Morning", from: "06", to: "03",
  preferredTrains: ["310"], travelMinutes: 15, platformMinutes: 2,
  bufferMinutes: 8, mode: "drive", checkIn: "06:45", days: [1,2,3,4,5] };
const train = VRECore.SCHEDULE.trips.find(t => t.num === "310"
  && t.stops.some(s => s[0] === profile.from));
assert.ok(train, "test route exists in the published timetable");
const plan = (p = profile, chosen = "310", feed = {}, history = {}, at = now) =>
  VRELeaveBy.calculate(p, chosen, VRECore, feed, history, at);
const scheduled = time("2026-11-16T12:25:00Z");
const base = plan();
assert.equal(base.state, "upcoming");
assert.equal(base.scheduled, scheduled, "train 310 departs Lorton 7:25 EST");
assert.equal(base.leaveBy, time("2026-11-16T12:00:00Z"), "7:00 AM after 25 minute lead");
assert.equal(base.remaining, 15);
assert.equal(base.confidence, "schedule");
assert.equal(base.leadMinutes, 25);

const feed = {
  [train.trip]: {
    tripId: train.trip, num: "310", ghost: false, signalLost: false,
    ts: now - 30000, schedDev: 6 * 60000,
    nextStop: profile.from,
    stops: [{code:profile.from, time:scheduled + 6 * 60000},
      {code:profile.to, time:time("2026-11-16T13:00:00Z")}]
  }
};
const history = { [train.trip]: [[now - 4 * 60000,6],[now - 1 * 60000,6]] };
const confirmed = plan(profile,"310",feed,history);
assert.equal(confirmed.confidence, "stable-delay");
assert.equal(confirmed.leaveBy, time("2026-11-16T12:06:00Z"), "stable +6m delay moves leave by 6m");
const single = plan(profile,"310",feed,{[train.trip]: [[now-30000,6]]});
assert.equal(single.confidence,"delay-unconfirmed");
assert.equal(single.leaveBy,base.leaveBy,"one delayed observation never moves leave later");
const recovery = plan(profile,"310",feed,{
  [train.trip]: [[now-4*60000,6],[now-60000,4]]
});
assert.equal(recovery.leaveBy,base.leaveBy,"recovering delay keeps original departure");
const staleFeed = plan(profile,"310",{[train.trip]:{...feed[train.trip],ts:now-7*60000}},history);
assert.equal(staleFeed.leaveBy,base.leaveBy, "stale GTFS never moves leave later");
const tooLong = plan(profile,"310",{[train.trip]: {
  ...feed[train.trip],schedDev:26*60000,
  stops:[{code:profile.from,time:scheduled+26*60000}]
}},{[train.trip]:[[now-4*60000,26],[now-60000,26]]});
assert.equal(tooLong.leaveBy,base.leaveBy+10*60000,"cap later leave shift at ten minutes");
const early = plan(profile,"310",{[train.trip]:{
  ...feed[train.trip], schedDev:0,
  stops:[{code:profile.from,time:scheduled-2*60000}]
}},{});
assert.equal(early.leaveBy,base.leaveBy-2*60000,"earlier departure moves leave forward");
assert.equal(early.confidence,"earlier-live");
const passed = plan(profile,"310",{[train.trip]:{
  ...feed[train.trip], nextStop:profile.to
}},history);
assert.equal(passed.state,"departed","train past boarding stop is not still catchable");
assert.equal(plan({...profile,travelMinutes:0,platformMinutes:0,bufferMinutes:0}).state,
  "needs-travel-time","no misleading prediction before travel time is set");
assert.equal(plan({...profile,travelMinutes:0,platformMinutes:0,bufferMinutes:5}).state,
  "needs-travel-time","default safety buffer without travel time is not a configured commute");
assert.equal(plan(profile,"9999").state,"invalid-train");
assert.equal(plan(profile,"310",{}, {}, time("2026-11-15T11:45:00Z")).state,
  "no-service","weekends do not show a leave countdown");
assert.equal(plan(profile,"310",{}, {}, time("2026-11-26T11:45:00Z")).state,
  "no-service","published no-service holiday respected");
// DST independent of the timezone on the user's Android device.
assert.equal(VRELeaveBy.easternMinute(now, 7*60+25), scheduled);
assert.equal(VRELeaveBy.easternMinute(time("2026-07-13T10:45:00Z"),7*60+25),
  time("2026-07-13T11:25:00Z"), "July EDT is UTC-4");
assert.equal(VRELeaveBy.easternMinute(time("2026-03-09T10:45:00Z"),7*60+25),
  time("2026-03-09T11:25:00Z"), "March after spring DST change is UTC-4");
assert.equal(VRELeaveBy.easternMinute(time("2026-11-02T11:45:00Z"),7*60+25),
  time("2026-11-02T12:25:00Z"), "November after fall DST change is UTC-5");

assert.match(app,/function DailyTravelControl\(/,"one-day adjustment control exists");
assert.match(app,/vre-leave-day-overrides-v1/,"one-day override uses a separate storage record");
assert.match(app,/travelOverrides\?\.date === todayKey/,"yesterday's overrides never apply today");
assert.match(app,/travelMinutes: overrides\[p\.id\] \?\? p\.travelMinutes/,
  "the countdown accepts today's travel time without mutating the saved profile");
assert.match(app,/travelMinutes: overrides\[selected\.id\] \?\? selected\.travelMinutes/,
  "alternate train previews honor today's travel override");
assert.match(app,/overrides=\$\{todayTravel\} onTravelChange=\$\{saveTravelOverride\}/,
  "daily overrides are passed from app state");
const adjusted = plan({...profile,travelMinutes:20});
assert.equal(adjusted.leaveBy,base.leaveBy-5*60000,
  "five additional minutes to reach the station moves leave-by earlier");
assert.equal(profile.travelMinutes,15, "original saved travel time was not changed");
assert.match(app,/function LeaveByCard\(/,"UI component uses calculator");
assert.match(app,/\}, planned\[p\.id\], VRECore, liveByTrip, samples, now\)/,
  "saved native plan determines the visible leave-by time");
assert.match(app,/now=\$\{now\} liveByTrip=\$\{liveByTrip\} samples=\$\{devlog\}/,
  "live feed and delay history reach UI while app is visible");
assert.match(app,/todayState = day\?\.date === dateKey \? day : null/,
  "yesterday's native plan doesn't appear on a new service day");
assert.match(app,/Automatic leave-time notifications are coming later/,
  "no claim that background alerts already operate");

assert.match(app, /if \(selectedId === null\) return null;/,
  "the multi-profile planner only appears after an explicit user action");
assert.match(app, /aria-label=\$\{planned \? "Upcoming planned commute" : "Next departure"\}/,
  "focused card distinguishes planned commute from timetable departures");
assert.match(app, /function primaryPlannedCommute\(/,
  "primary commute is selected without displaying the full profile list");
assert.match(app, /planned=\$\{primaryPlan\}/,
  "the focused card receives the selected planned commute");
assert.match(app, /aria-expanded=\$\{showDetails\} onClick=\$\{\(\) => setShowDetails\(!showDetails\)\}/,
  "secondary actions require explicit More options expansion");
assert.match(app, /visibleRows\.map\(r => html`[\s\S]*?onClick=\$\{\(\) => onPickLive\(r\.trip\)\}/,
  "expanded departure rows remain selectable");
assert.match(app, /onPlan=\$\{commutes\.profiles\.some\(p => p\.preferredTrains\.length > 0\)/,
  "profiles expose on-demand train planning from the standard timetable");
assert.match(app, /onClick=\$\{onPlan\}>Plan train<\/button>/,
  "existing next-train card has a Plan train entry");
assert.match(app, /onClick=\$\{\(\) => onSelect\(""\)\}/,
  "Back returns to saved commute profiles");
assert.match(app, /onClick=\$\{\(\) => onSelect\(null\)\}>Done/,
  "manual planner can be dismissed without choosing a train");
assert.match(app, /setPlanProfile\(""\)/,
  "manual entry opens the profile list");
assert.match(app, /No departures remaining today\./,
  "exhausted timetable retains a truthful, compact no-departures state");
assert.match(app, /No VRE service today\./,
  "original timetable retains no-service state");
const nextCard = app.indexOf('!myTrip && tab !== "preferences" && planProfile === null && html');
const openedPlanner = app.indexOf('planProfile !== null && todayCard');
assert.ok(nextCard >= 0 && openedPlanner >= 0 && openedPlanner < nextCard,
  "the focused departure card is default and planner is shown on explicit request");
assert.equal((app.match(/TodayCommute\} profiles=/g) || []).length, 1,
  "planner component is instantiated only once");

console.log("VRE leave-by calculations, confidence, DST and Android packaging passed");
