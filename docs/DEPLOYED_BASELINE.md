# Deployed baseline — read-only recovery

- Cloudflare account: user's connected account
- Worker script: `vre-live`
- URL: `https://vre-live.samelling.workers.dev/` (password protected)
- Captured on: 2026-11-10
- Worker version number: 24
- Active version ID: `ed03e164-e08a-4960-984f-78ab81992515`
- Last deployment: 2026-10-20T12:23:31.940751Z
- Compatibility date: `2026-08-01`
- Usage model: standard
- Trigger: `* * * * *` (every minute)
- KV binding: `RIDES` (existing Cloudflare namespace)
- Secret bindings: `APP_PASSWORD`, `VAPID_PRIVATE_KEY` (values deliberately not exported)
- Public text binding: `VAPID_PUBLIC_KEY`
- `workers.dev` subdomain: enabled
- PWA data caching: intentionally disabled in the service worker

## Current behavior

- Virginia Railway Express GTFS real-time Trip Updates, Vehicle Positions, and Alerts via `https://gtfs.vre.org/containercdngtfsupload/`.
- Mobile map, schedule and station board, train selection and commute tracking.
- ETA and delay calculations, proactive web-push arrival alerts, ride history and browser-local preferences.
- Protected web endpoints with an authentication cookie.
- Read-through feed caching in Worker memory and a one-minute cron to check active rides.
- Schedule currently embeds 32 regular train trips and a manually maintained service-exception list.

## Important risks / limitations

1. The recovered files are deployment artifacts. No original modular source or full tests were retrievable. Import adjustments only change 3 hashed module import paths to stable paths.
2. `wrangler.toml` points to **production**. Do not deploy from this repository without first creating and validating a preview and explicitly approving a release.
3. The built-in `SCHEDULE.noService` is a fixed list (currently `20260907`, `20261012`) rather than an automatically updated holiday calendar. Verify calendar correctness against VRE before using it to infer actual operations.
4. Current frontend imports React, ReactDOM and htm over the network. This limits offline behavior and should be evaluated as part of Android packaging.
5. A production Android WebView will need an appropriate native notification approach; existing service-worker web push should not be assumed to transfer unchanged.
6. The API endpoint can fail or return stale data; arrival and positions are best-effort estimates, not guarantees.
7. The deployed browser UI and Cloudflare account were not modified or redeployed as part of this source import.

## Migration acceptance

- Source files recover cleanly and pass `npm run check`.
- Run `wrangler dev` with development-only bindings and manually review protected routes and feed handling.
- Deploy to a distinct preview Worker with independent KV, cron and secrets before considering production parity.
- Use physical Android testing before trusting notifications, background processing or commute ETA.
