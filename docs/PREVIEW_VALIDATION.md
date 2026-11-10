# Cloudflare preview validation — 2026-11-10

Preview Worker: `vre-live-lab-preview`

URL: https://vre-live-lab-preview.samelling.workers.dev/

## Verified
- Preview Worker was successfully uploaded using recovered GitHub modules.
- Four deployed modules exactly match the repository content byte-for-byte in text.
- Worker subdomain is enabled.
- Cloudflare Browser Rendering successfully loaded the password-protected login screen.
- Preview uses a **separate APP_PASSWORD secret**.
- Preview has **no cron schedule**, RIDES KV namespace, VAPID private key, or other production bindings.
- The original `vre-live` production deployment was not updated.

## Not yet verified
- Login through an actual browser with the preview password.
- Authenticated Map, Schedule and Board rendering.
- Live feed fetches and train positioning on a day when trains report.
- Full Android build and handset smoke test.

## Safety notes

The preview is not a public demo. Its password is **not** in GitHub. Use only development data in the preview: it intentionally has no backend storage for ride push-subscriptions. The `wrangler.preview.toml` file is documentation of the preview boundary; publishing must remain an explicit user-approved action, with per-environment credential review.
