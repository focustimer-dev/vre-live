# Plan Train inline and next-commute scheduling

## Clarified interaction
One home-card button **Plan train** opens the existing **More options** panel inline. It is the same control, not a separate journey into the large Today’s Commute planner. The inline blueprint exposes departures, direction switch, and a **travel time (minutes)** input as the final field; initialize to configured Advanced Commute travel time, otherwise **10 min**. Planning does not silently enable notifications.

## Time ordering
- Do not equate “live refresh paused” or zero reporting trains with no timetabled departures.
- Discard elapsed plans and completed/expired train departures.
- Consider saved Advanced Commute preferred trains **chronologically**, respecting profile days, VRE service calendar, reduced service, and Eastern time.
- When the morning leg has ended, show an available return leg or the next scheduled Advanced Commute, including an explicit boarding location and when it runs. When today is exhausted, preview the next service-day commute rather than leaving a stale “To work” card onscreen.
- Explicit ride completion, manual direction flips, and widget routes retain precedence; never infer physical location from the clock or the feed.

## Layout
- Keep the collapsed home card small and map visible.
- Expand inline without a second large page.
- Present travel time as the **last** control; 10-minute fallback must be editable locally.
- Preserve change-stop, live ride, schedule and map behavior.

## QA
Tests for expired planned 7:25 am ride at 9:32 am, future return trip, tomorrow, weekends/holidays, DST, no live feed, missing Advanced travel time, manual route overrides, click-through to native plan, and a collapsed home card with a single button.
