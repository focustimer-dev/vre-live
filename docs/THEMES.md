# VRE Live — Theme system

Two native and web themes share **semantic color tokens**, not per-component hardcoded hex values. The local `vre-live-theme-v1` setting persists each selection. Electric Stars is the default for new installs (dark-first), and Nord Light is selectable at **Preferences → Appearance**.

## Electric Stars

| Role | Color | Usage |
|---|---|---|
| `--bg` | Midnight Abyss `#011629` | ~60% viewport backdrop |
| `--card` | Petrol Navy `#0C426D` | primary elevated cards |
| `--card-2`, `--nav` | Velvet Plum `#372B68` | card gradients and navigation (~30% combined) |
| `--accent` | Electric Cobalt `#3A74DB` | focus-adjacent graphics, progress and borders |
| `--accent-outline`, `--meta-on-bg` | Orchid Mesh `#BE74CD` | CTA outlines, subtle metadata on the Abyss background |
| `--fg`, `--action-bg` | Neon Lilac `#F6B8FB` | main readable text and primary CTA background |
| `--action-fg` | Midnight Abyss `#011629` | small body/button text inside Lilac buttons |

**Important contrast decision:** Cobalt on Abyss is **4.09:1**, below the **4.5:1** AA threshold for ordinary text. It is therefore never used for small body copy. Lilac on Petrol cards is **6.53:1**, Lilac on Plum is **7.71:1**, and Lilac on Abyss is **11.47:1**. Orchid on Petrol is **3.26:1**, so Orchid is used for decorative outlines (non-text UI) on cards and for metadata only against Midnight Abyss, where it clears 4.5:1. The normal card labels use Lilac instead.

## Nord Light

Nord's Snow Storm background `#ECEFF4`, white cards `#FFFFFF`, Frost accent `#365F90`, Polar Night text `#2E3440`, raised panels `#E5E9F0`, and navigation `#D8DEE9`. State colors have their own semantic token values, preserving line identities and clear warning/arrival status across both themes.

## Token vocabulary

The root theme establishes `--bg`, `--card`, `--card-2`, `--nav`, `--fg`, `--muted`, `--meta-ink`, `--meta-on-bg`, `--border`, `--border-soft`, `--selected-bg`, `--selected-fg`, `--action-bg`, `--action-fg`, `--action-border`, `--accent`, `--accent-outline`, `--focus`, `--sheet-bg`, `--surface-hover`, `--line-separator`, `--map-ink`, `--map-highlight`, `--line-F`, `--line-M`, status colors, and accessible highlight/badge backgrounds.

**Do not** add one-off hex values to components or train SVG markup. Update both theme blocks if adding a new semantic role. Keep metadata outside cards and inside elevated cards on separate tokens due to their different contrast requirements.

## Android parity

- `src/index.html`: two theme blocks, appearance picker, localStorage persistence, map colors and early bootstrap
- `android-lab/web/build-assets.mjs`: extracts the synchronous `vre-theme.js` bootstrap before the existing deferred React modules. It does **not** weaken the CSP or re-enable inline scripts in the packaged APK.
- `VreTheme.kt`: validates the theme ID and persists the native mirror, recoloring system bars, fallback screen, native dialogs and widgets. The WebMessageListener accepts messages only from the existing first-party WebView origin and main frame.
- Android `colors.xml`, `styles.xml`, and Nord variants of home-screen widget layouts: theme-native styling without painting a white widget on a dark system or vice versa.
- No new background polling or Firebase/commute code path is created by changing themes.

## QA / release gates

1. `npm run check` including `tests/themes.mjs`: color token parity, automatic/default storage, AA contrast for normal text on backgrounds/cards, map tokenization and WebView CSP
2. GitHub Android debug APK build: Kotlin resources, NativeTheme integration, asset bundling, widget variants
3. Manual QA on Android and web: change theme across Map, Schedule, Board, Preferences, selected train sheet, daily check-in screen, offline fallback and both widget sizes; kill and reopen the app and verify persistence
4. Check status/navigation bar light icons in Electric Stars and dark icons in Nord Light; revisit native dialogs after switching themes
5. Confirm alert/push enrollment, commute profile data and signing key are unchanged; **do not merge until CI is green**.

The theme scope is deliberately limited to UI; it does not deploy to Cloudflare or alter production transit monitoring.
