# VRE Live — Commute Watch implementation plan

**Status:** Phase A implemented on the feature branch; phases B–E not yet implemented.
**Baseline:** PR #13; production Worker's cron and existing Android ride monitor are intentionally unchanged.

## Product goal

Save commuter routines once, confirm intent daily, and only monitor a train after the commuter explicitly opts in. A passive timetable or map view must not register a background monitoring session.

## Phase A: Offline commute profiles (this PR)

- `VRECommutes` is an offline, versioned data model in `src/index.html`, extracted into `vre-commutes.js` for Android Lab by `android-lab/web/build-assets.mjs`.
- Storage key: `vre-live-commutes-v1`. Data: `{version:1, profiles:[...]}`.
- Each profile: stable ID, name, origin/destination stop codes, multiple preferred train **numbers**, travel mode, minutes to station, minutes from arrival to platform, safety buffer, check-in time (Eastern), and weekdays (0=Sunday through 6=Saturday).
- Train choices come from `VRECore.SCHEDULE.trips`; invalid station pairs, invalid trains, and duplicate choices are rejected or removed at normalization.
- Existing `vre-live-route` is migrated once into two offline routines, one each direction, *without choosing trains, starting polling, guessing travel times, or changing the original route*. Editing the original round-trip card remains independent until the future UI consolidation.
- Unknown future storage versions are never overwritten. Storage failures are reported without implying the save succeeded.
- The profile editor works in PWA and Android Lab; it is **not** a live alert scheduler. No new HTTP requests, alarms, notifications or location access are introduced.
- The bottom **Preferences** tab contains two paths: **Commute** edits the original home/destination round-trip that powers today's automatic timetable and flip control; **Advanced Commute** edits independent preferred-train and timing routines. The existing route card's gear opens Preferences → Commute. No advanced configuration alters current timetable behavior until later phases.

**Gate A:** `npm run check` passes; Android Lab debug build packages and loads `vre-commutes.js`; existing schedule/map/widget and ride-monitor behavior remains unchanged.

## Phase B: Android local daily intent

- Introduce an Android-native notification scheduler with explicit permissions handling and correct local date/time interpretation using `America/New_York`.
- Notifications: **Yes**, **Not sure** (local reminder in 10 minutes), and **Not riding today** (both directions).
- Swiping a notification away must not silently cancel the day; missing response must not cause any server work.
- **Skip this trip** cancels one routine; **Not riding today** cancels the entire day's routines; manual reactivation is always possible.
- Reconcile local notifications after reboot, app updates, clock/time-zone changes, and permission denial; no background VRE fetch just to schedule prompts.
- Gate: test zero network activity while only local check-ins occur.

## Phase C: Predicted departure and active session UI

- Keep **Planning to take train** distinct from **I'm riding this train**.
- Leave-by = predicted platform departure − approach travel − platform access − safety buffer.
- Only shift departure later on fresh, stable, position-backed evidence of delay; never rely on stale ETAs for a delayed leave recommendation.
- Handle recovering delay by bringing the alert forward immediately and issuing an intelligible correction.
- Manual train switching, dismiss/reopen, one-day travel-time adjustment, and fallback when a train is canceled or does not report.
- Gate: deterministic test fixtures for on-time, +6, +12, stale, recovery, holiday and alternate train.

## Phase D: Cloudflare event-driven monitoring

- Add a separately deployed Durable Object alarm queue; store only confirmed active watch sessions.
- Idle = no active watches and **no alarm**. Alarms poll shared VRE GTFS feeds only for sessions inside their monitoring windows.
- Collapse simultaneous riders into shared fetches with bounded cache age. Reduce cadence outside imminent departures.
- Ensure notification deduplication, authorization, subscription ownership, rate limits, expiration and retry safety; consider native FCM separately from Web Push.
- Support multiple train/time windows and users without hardcoding any user's preferred route.
- Gate: simulated concurrent riders, no alarms with zero subscriptions, and independently measured upstream request counts.

## Phase E: Release and migration

- Exercise the entire sequence in Android Lab and a preview Worker, including Doze, screen-off, reboot, changing DST, day rollover, reduced service and missed trains.
- Check-in, opt-in and later departure alarms must work without duplicating existing arrival-monitor notifications.
- Preserve the existing app/widget and server behavior until the preview gates pass.
- Enable the new path behind a flag, verify telemetry, then remove the legacy production cron in an explicitly reviewed deploy; retain a rollback.
- Never migrate other people's commute data or production subscriptions without explicit migration handling.

## First-user validation scenarios

1. Morning Lorton → Crystal City: preferred train 310, 7:25 AM, 15 min drive, 2 min platform, 8 min margin. On-time recommended leave: **7:00 AM**.
2. Confirmed +6 minute delay: recommended leave **7:06 AM** *only when live evidence supports the adjusted departure*.
3. Afternoon Crystal City → Lorton: multiple preferred trains and an editable 12-minute walk, plus an independent safety buffer.
4. Accidental dismissal: reopening the app permits activation; no response never starts polling.
5. Whole-day skip: both commute sessions stop, and only explicit user activation restores one.

## Engineering constraints

The repository was restored from a deployed bundled Worker; `src/index.html` and `src/worker.js` contain duplicated core timetable logic. Phase A deliberately leaves the production Worker alone and introduces a single browser/Android source for **profile data only**. Extracting and reconciling the shared service-calendar/GTFS domain module should be performed as a separately tested follow-up before the Cloudflare alarm cutover, not conflated with preference editing.

This document is the working implementation checklist. Do not represent phases B–E as shipped.
