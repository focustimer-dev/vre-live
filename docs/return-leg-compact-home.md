# Ride completion, return-leg selection, and compact home card

## User-visible issues
- Electric Stars active bell has an unwanted shaded square. Keep a **color-only** active state, with an invisible 44×44 tap target and smaller glyph. Expanded tools may use a surface, but collapsed bell never has a box.
- Destination change affordance (chevron) wraps into an isolated second line. Keep it attached to its destination name, and separate arrival time/train data into a predictable line.
- Empty home card is too tall. Remove inherited empty padding and unnecessary primary action when nothing is available, so the map starts higher.
- Empty direction currently uses device-local noon rather than actual completed rides. Show the return leg when the selected commute's destination is the recently completed ride's explicitly chosen destination; the user can always override direction.
- When the outward leg is exhausted and the opposite leg has future departures, preview the opposite leg with the **departure station explicitly labelled**. Don't imply location is being tracked.
- Basic Commute supplies default stations; an explicitly planned Advanced Commute takes precedence and supplies the departure rows as well as the headline. Never combine a planned route header with a different basic route's options.

## Constraints
No change to notification permission defaults, background polling, signing keys, package identity, or GTFS schedule interpretation. Never infer physical location from train activity or exit tap alone. Manual swap and widget route choices take priority. Respect VRE Eastern time and date, including overnight rollover. Preserve direct train selection, destination editing, and existing ride history.

## Acceptance checks
Both themes, narrow mobile, long stop names, active-bell state with options collapsed/expanded. Morning with outbound trains, after outbound exhausted, after ride ending at saved destination, off-route ride completion, manual swap, advanced planned commute on a different route, no-service day, both legs exhausted and next-day stale logs. Home card should not grow or claim current location when no direction evidence exists.
