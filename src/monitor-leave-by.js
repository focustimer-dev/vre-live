(function (g) {
  "use strict";
  // Forecast a leave time from a confirmed commute. No polling, alarms or background work.
  const EAST = "America/New_York";
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: EAST, year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = ms => Object.fromEntries(fmt.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  // Convert an Eastern wall clock to an epoch even when the Android/device timezone differs.
  // Commute trains don't depart in the ambiguous fall-back 01:00 hour.
  function easternMinute(now, minute) {
    const p = parts(now), wall = Date.UTC(+p.year, +p.month - 1, +p.day, 0, minute);
    let guess = wall + 5 * 3600000;
    for (let i = 0; i < 4; i++) {
      const s = parts(guess);
      const read = Date.UTC(+s.year, +s.month - 1, +s.day, +s.hour, +s.minute);
      guess += wall - read;
    }
    return guess;
  }
  const finite = x => typeof x === "number" && Number.isFinite(x);
  function calculate(profile, trainNumber, core, liveByTrip, history, now) {
    if (!profile || !core || !finite(now) || !core.isServiceDay(new Date(now)))
      return { state: "no-service" };
    const trip = core.SCHEDULE.trips.find(t => String(t.num) === String(trainNumber)
      && t.stops.findIndex(s => s[0] === profile.from) >= 0
      && t.stops.findIndex(s => s[0] === profile.to) > t.stops.findIndex(s => s[0] === profile.from));
    if (!trip || !profile.preferredTrains?.includes(String(trainNumber)))
      return { state: "invalid-train" };
    const key = core.serviceDateKey(now);
    if (core.SCHEDULE.reducedService.includes(key) && !core.SCHEDULE.sTrains.has(trip.num))
      return { state: "no-service" };
    const boardingIndex = trip.stops.findIndex(s => s[0] === profile.from);
    const scheduled = easternMinute(now, trip.stops[boardingIndex][1]);
    const travel = Number(profile.travelMinutes), platform = Number(profile.platformMinutes),
      buffer = Number(profile.bufferMinutes);
    if (![travel, platform, buffer].every(n => Number.isInteger(n) && n >= 0) ||
        travel + platform <= 0)
      return { state: "needs-travel-time", scheduled };
    const lead = travel + platform + buffer;
    const live = liveByTrip?.[trip.trip] || null;
    const fresh = live && !live.ghost && !live.signalLost && finite(live.ts) &&
      live.ts <= now + 60000 && now - live.ts <= 5 * 60000;
    const liveStop = fresh ? live.stops?.find(s => s.code === profile.from) : null;
    const latestEta = finite(liveStop?.time) ? liveStop.time : null;
    const nextIndex = fresh ? live.stops?.findIndex(s => s.code === live.nextStop) : -1;
    const boardLiveIndex = fresh ? live.stops?.findIndex(s => s.code === profile.from) : -1;
    const passed = fresh && nextIndex > boardLiveIndex && boardLiveIndex >= 0;
    const positive = latestEta == null ? 0 : Math.max(0, latestEta - scheduled);
    const recent = (Array.isArray(history?.[trip.trip]) ? history[trip.trip] : [])
      .filter(s => Array.isArray(s) && finite(s[0]) && finite(s[1])
        && s[0] <= now + 60000 && now - s[0] <= 12 * 60000)
      .sort((a, b) => a[0] - b[0]);
    const last = recent.at(-1), prior = recent.slice(0,-1).reverse().find(s =>
      last && last[0] - s[0] >= 60000 && last[0] - s[0] <= 10 * 60000);
    const deviation = finite(live?.schedDev) ? live.schedDev / 60000 : NaN;
    // Avoid later departure advice from a single/deteriorating/stale GTFS fix.
    const stableDelay = positive >= 2 * 60000 && positive <= 30 * 60000 &&
      prior && last && last[1] >= 2 && prior[1] >= 2 &&
      Math.abs(last[1] - prior[1]) <= 1 &&
      last[1] >= prior[1] - 0.25 &&
      finite(deviation) && Math.abs(last[1] - deviation) <= 1.5 &&
      Math.abs(positive / 60000 - deviation) <= 2 &&
      now - last[0] <= 4 * 60000;
    let departure = scheduled, confidence = "schedule";
    if (fresh && latestEta != null && latestEta < scheduled) {
      departure = latestEta;
      confidence = "earlier-live";
    } else if (fresh && stableDelay) {
      // Maximum later leave shift is 10 min, even for larger predicted delays.
      departure += Math.min(positive, 10 * 60000);
      confidence = "stable-delay";
    } else if (fresh && positive > 0) confidence = "delay-unconfirmed";
    const leaveBy = departure - lead * 60000;
    const remaining = Math.ceil((leaveBy - now) / 60000);
    return { state: passed || now > departure + 60000 ? "departed"
      : remaining <= 0 ? "leave-now" : "upcoming",
      confidence, train: String(trip.num), boarding: profile.from, scheduled,
      predicted: latestEta, departure, leaveBy, remaining, leadMinutes: lead,
      liveFresh: !!fresh };
  }
  g.VRELeaveBy = Object.freeze({ calculate, easternMinute });
})(typeof window !== "undefined" ? window : globalThis);
