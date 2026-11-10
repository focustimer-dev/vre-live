import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const output = process.argv[2];
await mkdir(output, { recursive: true });
const source = await readFile(new URL("../../src/index.html", import.meta.url), "utf8");
let page = source;

function replace(pattern, replacement) {
  if (!page.includes(pattern)) throw new Error("Missing Android asset source marker: " + pattern);
  page = page.replace(pattern, () => replacement);
}

replace('<meta charset="utf-8">', `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'">`);
replace('<link rel="manifest" href="manifest.json">', "");
replace('<link rel="apple-touch-icon" href="icon.svg">', '<link rel="stylesheet" href="session.css">');

for (const [pkg, file, url] of [
  ["react", "umd/react.production.min.js", "react@18.3.1/umd/react.production.min.js"],
  ["react-dom", "umd/react-dom.production.min.js", "react-dom@18.3.1/umd/react-dom.production.min.js"],
  ["htm", "dist/htm.umd.js", "htm@3.1.1/dist/htm.umd.js"],
]) {
  const name = file.split("/").at(-1);
  replace(`<script crossorigin src="https://unpkg.com/${url}"></script>`, `<script defer src="${name}"></script>`);
  await copyFile(new URL(`node_modules/${pkg}/${file}`, import.meta.url), join(output, name));
  await copyFile(new URL(`node_modules/${pkg}/LICENSE`, import.meta.url), join(output, `${pkg}-LICENSE.txt`));
}

for (const id of ["vre-core", "vre-app"]) {
  const block = page.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`));
  if (!block) throw new Error("Missing inline script: " + id);
  let code = block[1];
  if (id === "vre-app") {
    code = code.replace(/^  .*navigator\.serviceWorker\.register.*\n/m, "");
    const feeds = code.replace('fetch("feed/history",', 'window.vreFeed("/feed/history",')
      .replace('for (const u of [`feed/${name}`, name])', 'for (const u of [`/feed/${name}`])')
      .replace('fetch(`${u}?t=${Date.now()}`,', 'window.vreFeed(`${u}?t=${Date.now()}`,');
    if ((feeds.match(/window\.vreFeed\(/g) || []).length !== 2 || feeds.includes("serviceWorker.register")) {
      throw new Error("Android feed or service worker wiring no longer matches the source");
    }
    code = feeds;
  }
  await writeFile(join(output, id + ".js"), code);
  replace(block[0], id === "vre-core" ? '<script defer src="vre-core.js"></script>\n<script defer src="session.js"></script>' : "");
}

replace('<div id="root"></div>', `<main id="session" class="lab-session">
  <h1>VRE Live Lab</h1>
  <p id="session-status" role="status">Connecting to the VRE preview…</p>
  <form id="session-login" hidden>
    <label for="session-password">Preview password</label>
    <input id="session-password" type="password" autocomplete="current-password" required>
    <button type="submit">Unlock</button>
  </form>
  <button id="session-retry" type="button" hidden>Retry</button>
</main>
<div id="root"></div>`);

if (/<script(?![^>]*\bsrc="[^":/]+")[^>]*>/i.test(page)) {
  throw new Error("Android HTML must use packaged scripts only");
}
await writeFile(join(output, "index.html"), page);
for (const name of ["session.js", "session.css"]) {
  await copyFile(new URL(name, import.meta.url), join(output, name));
}
