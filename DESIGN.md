# VRE Live visual system

This document records the two shipped UI themes. The web source of truth is `src/index.html`; Android's `values/colors.xml` mirrors the corresponding native widget and error-screen roles. This specification describes presentation only: transit data, schedules, commute behavior, alerts, package identity, and signing are not theme-dependent.

## Electric Stars · Night Signal (replaces original visual treatment)

**Identity:** A sophisticated night-service transit instrument with restrained 1980s electronic glamour. It should feel fast to read in a real commute, never like a glowing dashboard demonstration.

**Palette ingredients (preserved):** Midnight Abyss `#011629`; Petrol Navy `#0C426D`; Velvet Plum `#372B68`; Electric Cobalt `#3A74DB`; Orchid Mesh `#BE74CD`; Neon Lilac `#F6B8FB`.

**New necessary neutral:** `#E4EAF2` ordinary foreground; `#F3F5FA` display numbers; `#B8C9DC` secondary information. Small orchid metadata uses a readable `#D4A0DF` variant, because raw Orchid Mesh does not meet the body-text contrast target on every Petrol Navy surface.

**Roles and hierarchy:**
- **Canvas** Midnight Abyss. No persistent intense outer glow or textured wallpaper.
- **Flat map surface** `#102D49` over the background, with minimal/no perimeter border. The line colors `#FF9BA7` and `#A6CBFF` supply map color and state.
- **Featured commute** the single restrained `#0C2742 → #102D49` gradient. Bright display time; lilac next-train identity; quiet route information. Other cards are flat.
- **Navigation** deep navy; Velvet Plum only for selected states with an Orchid underline, not an all-purple navigation slab.
- **Primary action** Neon Lilac with Midnight Abyss ink. In an expanded planner, the Plan train disclosure recedes; Confirm train becomes the one saturated action.
- **Accent** Cobalt for graphical signals, progress, and large treatments, not small text. Orchid Mesh is decoration or emphasis, while readable orchid `#D4A0DF` is used for small metadata.
- **Secondary controls** neutral text and subdued outlines, not neon frames. Focus remains clearly visible in lilac, selected train markers retain their individual state, and 44px+ touch targets are preserved.
- **Motion** existing live train movement and arrival transitions; no gratuitous card entrance animations. Respect reduced-motion settings.
- **Native parity** Electric Stars widget backgrounds and native error display foregrounds must match the newly neutral web surfaces.

### Composition rules

On mobile the selected commute is the single featured surface. Keep navigation chrome compact so the transit map becomes visible quickly. The map provides the visual energy, not card borders. When the planner is expanded, retain one path: choose train → set travel time → Confirm train → optional time-space chart. Do not use a background glow, border, and shadow on the same surface.

## Nord Light

**Unchanged** by Night Signal: Snow Storm `#ECEFF4` canvas, `#FFFFFF` cards, Polar Night `#2E3440` primary ink, and existing Frost accents. Preserve its existing typography, selections, widgets, contrast, and navigation rules.

## Verification

Run `npm run check` and Android CI. `tests/themes.mjs` validates token roles, contrast, native parity, map and navigation hierarchy, and Nord Light invariants. Test both themes across Map, Schedule, Board, preferences, the plan-train expansion, active rides, empty states and widgets. A pull-request debug APK cannot update an already release-signed Lab installation; main-branch signing is the upgrade path.
