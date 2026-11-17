# VRE Live · Adaptive map and widget design

Chosen concepts from the three-direction visual study:
- **A. Follow Lens:** The default on-screen map during an explicitly confirmed ride. Compact 300-ish px viewport; current train, next stops, and destination. No huge floating train-number billboard. Next-stop footer remains actionable.
- **B. Branch Atlas:** The default map before boarding and the system overview while riding. Compact ~425 px schematic of both Fredericksburg and Manassas routes. Show major station labels; smaller stops remain dots, train markers remain selectable with source/confidence semantics. No route/time changes.
- **C. Journey Ribbon:** The native Android **route widget only**, automatically replacing its ordinary departures panel after an explicitly confirmed onboard ride. Shows the train, destination, next stop, confidence, and a progress indicator only when the feed is fresh. Reverts to ordinary next departures on ride completion or expiration. Waiting at the station does NOT activate it. Station-only widgets remain station-only.

Preserve Nord Light/Electric Stars tokens and signed package identity. Native widgets must obey Android RemoteViews limits. Never substitute schedule-only movement for verified live progress, claim the handset location, enable background polling, or infer boarding. Do not break map accessibility, ride status, change train, or widget click-through.

Quality gates: Android CI, source interaction/semantic tests, manually inspect both themes, narrow screens, active ride without GPS, many train markers, weekend/empty state and compact widget dimensions. The same reviewed UI pass also replaces the colliding inline alert foldout with a portalled, anchored popover and a non-blocking state-confirmation snackbar; uses a train-to-train transfer symbol instead of reverse-direction arrows; and removes redundant selected-tab underlines. All new controls keep at least 44px touch targets, visible focus, and no hero-card reflow.
