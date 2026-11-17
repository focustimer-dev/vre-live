# C2a: One notification policy (Android Lab preview)

This change consolidates opt-in controls and prepares the eventual event-driven departure reminder. It does not launch the Cloudflare active-commute alarm service.

## Preferences

- **Commute**: existing standard round-trip and next-departure behavior.
- **Advanced Commute**: station pairs, preferred trains, travel/platform minutes, safety margins, and weekdays. Check-in toggles and fixed check-in clock fields are no longer displayed per profile.
- **Check-ins & Alerts**: one **Notifications** master, separate **Ask if I'm taking the train** and **Arrival alerts when riding** controls, a lead-time selector, and **Sound**/**Vibration** switches for commute check-ins.
- **Leave-now notifications** are disabled, labeled unavailable until the event-driven monitor is implemented.
- A ride's bell remains visible, defaults on only for newly started rides when master Notifications and Arrival Alerts are enabled, and can be overridden for that particular ride. Master Off always wins.

## Migration and consent

- The original version-one commute profiles remain intact, including `checkIn` and `checkInEnabled`, to support compatibility and rollback. Those fields are no longer editable through the routine screen.
- A new version-one global record `vre-live-alerts-v1` stores `enabled`, `checkIns`, `arrival`, `leadMinutes`, `sound`, `vibration`, `scopeIds`, and `legacyTimes`.
- The first launch **without** the global record reads any explicitly opted-in v1 profiles. If none were opted in, Notifications remain Off. If some were opted in, **only those profile IDs** retain their check-in schedule and **original clock times**; other profiles are not silently enabled. Migrated arrival alerts default Off.
- Users can explicitly select **Use automatic check-in timing for all commutes**, or turn check-ins on from Off, to opt in to all saved commutes. The original per-profile timestamps remain stored for rollback.
- A stored unknown global version is left untouched, and the UI shows a warning rather than overwriting it.
- Sound and vibration default Off. User-controlled Android channel settings take precedence.

## Device-only scheduling

For the new smart schedule, the bundled timetable's earliest preferred departure for each commute's service day determines the initial check-in. Check-in = earliest preferred departure − travel − platform − safety buffer − chosen lead time. No GTFS polling is needed for this calculation.

Example Monday:
- Train 310 Lorton 7:25 AM, 15+2+8 minutes to reach the platform, 15-minute lead => ask at 6:45 AM.
- Train 303 Crystal City 3:15 PM, 12+1+5 minutes to reach the platform, 15-minute lead => ask at 2:42 PM.

Only days/trains valid in the locally bundled VRE calendar are included; weekends, holidays and reduced-service exclusions are respected. Prompts within 15 minutes of one another are grouped into a single check-in. A day-level skip cancels the afternoon too; swiping a notification never starts monitoring.

Old enabled check-ins keep their original configured times and profiles until the user deliberately adopts smart scheduling. This avoids a surprise scheduling change on upgrade.

## Notification delivery

- Android creates four stable notification channels for commute check-ins: sound/vibration, sound/no-vibration, silent/vibration, silent/no-vibration. Channel settings cannot be overwritten after users change them in Android settings.
- Master Off cancels scheduled check-ins, reminders, lock-screen notifications and the active ride-monitoring service, but **does not delete the user's selected train, timetable or ride tracking state**.
- Native authorization gates apply again at delivery and ride-monitor poll time. A stale or denied Android notification permission cannot be treated as consent.
- Existing WebView notification behavior and Android foreground monitoring remain unchanged except for the global master gate and initial ride-bell default.

## Still pending

- Cloudflare Durable Object on-demand watcher and native background departure/leave-now push alerts.
- Multi-device accounts/sync.
- On-device validation of OS notification channels, permission decisions, background delivery, dismissal recovery, and multiple overlapping commute windows.
- Regression check that changing sound/vibration in Android channel settings behaves as explained.

## Release criteria

This is a draft PR. Validate `npm run check`, Android debug build, stored-preference migration, default bell state and end-to-end notification behavior before merging. The Cloudflare Worker and production client remain unchanged until explicitly deployed.
