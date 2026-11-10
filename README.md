# VRE Live

Virginia Railway Express live train tracker, restored from the currently deployed Cloudflare Worker into source control on **2026-11-10**.

> **Important:** This is a recovery of the **deployed bundle**, not the original unbundled authoring project. The web interface, GTFS-RT parser, Worker code, PWA service worker, and icon are captured; original build scripts, tests, and source maps were not available from the deployment. No live Cloudflare changes were made during the import.

## What is here

- `src/index.html` — currently deployed mobile interface (React, htm, inlined styles and VRE logic).
- `src/worker.js` — active Worker logic (feed proxy, password gate, web push, cron).
- `src/sw.txt` — PWA service worker body, imported into the Worker as plain text.
- `src/icon.svg` — current app icon.
- `wrangler.toml` — reconstructed deployment settings, KV binding, public VAPID key, cron schedule.
- `docs/DEPLOYED_BASELINE.md` — deployment details, operational risks and reproducibility limits.
- `docs/ANDROID_PLAN.md` — plan for an independent Android Lab without disturbing the PWA.

## Developer workflow

Install Node.js 20+, then `npm install`. Run `npm run check` for dependency-free source integrity checks. `npm run dev` starts local Wrangler (Cloudflare bindings and secrets must be configured appropriately for full behavior).

**Do not run `wrangler deploy` yet.** The config names the existing production Worker, and deployment would replace it. There is no automated deployment workflow.

## Secrets and live data

The repository does **not** contain `APP_PASSWORD` or `VAPID_PRIVATE_KEY`. Those remain Cloudflare secrets and must not be committed. The `RIDES` KV namespace ID and `VAPID_PUBLIC_KEY` are binding metadata, not private credentials. Do not export the KV data (push subscriptions and active ride records) into Git.

## Next step

Confirm the restored snapshot builds and behaves identically in a **separate preview Worker** first. Then extract a maintainable source layout and begin an isolated Android APK project. Neither action is claimed completed by this import.
