# Compact ride card / notification controls

## Intent
Reclaim vertical space for the system map while keeping the active-ride countdown, destination, train, and confidence information prominent. Both Nord Light and Electric Stars must use existing semantic theme tokens.

## Visual layout
1. **ETA card:** Reduce top/bottom padding and inter-element gaps, but do not diminish the countdown's readable size. Keep service line, delay/status, destination, ETA, and stop-progress track.
2. **Bell control:** At rest, show one unframed bell button in a fixed top-left overlay. Tapping it expands *other* ride controls horizontally to the right. Expanding must not alter card dimensions, shift the countdown/progress, or push the map down. The bell's selected state reflects whether arrival alerts are on.
3. **Persistent actives:** An enabled screen-wake or lock-screen option remains visible and highlighted next to the bell when collapsed; inactive extras are hidden until expanded. When expanded, an explicit arrival-alert toggle is accessible, not confused with the bell's expand action. Honor notification permissions and native bridge state.
4. **Bottom-right ride actions:** Replace the full-width **Change stop** and **I'm off the train** buttons with two legible, 44×44 minimum tap targets: a two-arrow reverse/swap symbol for **Change train**, and an exit-person pictogram adapted from the supplied sign for **I'm off the train**. No gear/duplicate **Stop tracking** control.
5. **Preserve change stop:** Tap the destination label to open the existing destination picker. Give it an accessible label and a clear affordance. **Change train must actually offer another train**, not merely change the destination on the current train.
6. **Failure states:** If the train is no longer reporting or its destination stop is unavailable, retain escape and end-ride actions and clear status text.

## Interaction & safety
- No layout reflow on bell expand/collapse; overlay must be above the card but avoid obstructing the main countdown at rest.
- No hidden clickable controls: unmounted inactive options when collapsed. Persistent active options continue to work.
- Tappable areas at least 44px; keyboard focus rings; accessible names and pressed/expanded states; reduced-motion support.
- Preserve current ride, leave-now monitoring, progress/delay confidence, local preference persistence and the existing release-signing pipeline.
- No automatic push/notification enrollment or new background polling.

## QA gates
- No-ride, live, scheduled-only, stale, missing-stop, and non-reporting states.
- Bell collapsed, expanded, alert enabled/disabled, screen wake on/off, lock-screen on/off/blocked.
- Switch-train picker opens the alternative train's destination flow; change-stop still changes current train's destination; exit ends the ride.
- Nord Light and Electric Stars, narrow Android screen and large text, keyboard/Back dismissal.
- Run `npm run check` and Android CI. Sign installable builds only on trusted `main` after review/merge; PR debug signatures cannot upgrade release-signed installations.
