import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const page = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const app = page.match(/<script id="vre-app">([\s\S]*?)<\/script>/)?.[1];
const css = page.match(/<style>([\s\S]*?)<\/style>/)?.[1];
assert.ok(app && css, "ride UI and styles must be present");
assert.doesNotThrow(() => new Script(app), "ride JavaScript parses");

const eta = app.slice(app.indexOf("  function EtaBanner("), app.indexOf("  function SwitchTrainSheet("));
const picker = app.slice(app.indexOf("  function SwitchTrainSheet("), app.indexOf("  /* ---------------- bottom sheet:"));
assert.ok(eta.length > 2000 && picker.length > 700, "both ride controls and picker are present");

assert.match(css, /\.ride-notifications\{position:absolute;/, "bell controls overlay, never reflow the card");
assert.match(css, /\.ride-eta\{position:relative;/, "overlay is anchored to the ETA card");
assert.match(css, /\.ride-control\{[^}]*min-width:44px;min-height:44px;/s,
  "micro controls keep minimum touch target");
assert.match(css, /\.ride-notifications \.icon-btn\{[^}]*border:0;/s,
  "native lock control is unframed in this area");
assert.match(css, /\.ride-quick-actions\{[^}]*justify-content:flex-end;/s,
  "reverse and exit icons are at the bottom right");
assert.match(css, /\.ride-eta \.eta-big\{[^}]*clamp\(34px,11vw,50px\)/,
  "countdown retains a legible type size");
assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);

assert.match(eta, /aria-expanded=\$\{showTools\} onClick=\$\{\(\) => setShowTools\(!showTools\)\}/,
  "bell toggles expansion, not notification enrollment");
assert.match(eta, /\$\{showTools && html`[\s\S]*?aria-pressed=\$\{notify\} onClick=\$\{onNotify\}/,
  "arrival alerts remain an explicit secondary toggle");
assert.match(eta, /\$\{canWake && \(showTools \|\| wake\) && html`/,
  "screen-wake option remains visible when active");
assert.match(eta, /\$\{\(showTools \|\| lockActive\) && lockButton\}/,
  "lock-screen option remains visible when active");
assert.match(eta, /className="ride-stop-button" onClick=\$\{onChange\}/,
  "destination tap still opens change-stop flow");
assert.doesNotMatch(eta, /Trip options|Stop tracking|showSet/,
  "duplicate gear/stop-tracking controls removed");
assert.match(app, /aria-label="Change train" title="Change train"/,
  "reverse icon is labeled for accessibility");
assert.match(app, /aria-label="I'm off the train" title="I'm off the train"/,
  "exit pictogram is labeled");
assert.match(app, /onClick=\$\{\(\) => onLeave\(true\)\}/,
  "end ride still invokes existing completed-ride workflow");

assert.match(picker, /aria-modal="true"/, "train picker is a modal");
assert.match(picker, /r\.trip !== currentTrain\?\.tripId && r\.num !== currentTrain\?\.num/,
  "current train is excluded from alternatives");
assert.match(picker, /onClick=\$\{\(\) => onPick\(r\.trip\)\}/,
  "alternative train choice opens existing destination flow");
assert.match(app, /setSwitchTrainOpen\(false\); setSelected\(tripId\); setPicking\(false\);/,
  "new train selection hands off to the existing train sheet");
assert.match(app, /onChange=\$\{\(\) => \{ if \(myTrain\)/,
  "change-stop path remains separate from change-train path");
assert.match(app, /setSummary\(rec\); setMyTrip\(null\); setSelected\(null\); setPicking\(false\); setSwitchTrainOpen\(false\);/,
  "no stale switch picker after finishing a ride");
console.log("VRE compact ride controls: static interaction and layout contracts passed");
