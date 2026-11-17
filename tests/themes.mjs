import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, runInNewContext } from "node:vm";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const html = read("src/index.html");
const script = id => {
  const match = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'));
  assert.ok(match, "theme bootstrap missing from HTML: " + id);
  return match[1];
};
const makeDocument = () => {
  const attributes = {};
  const meta = { value: "", setAttribute(key, value) { if (key === "content") this.value = value; } };
  return {
    attributes, meta,
    documentElement: { setAttribute(key, value) { attributes[key] = value; } },
    querySelector(selector) { assert.equal(selector, 'meta[name="theme-color"]'); return meta; }
  };
};
const makeStorage = selected => {
  const records = new Map(selected === undefined ? [] : [["vre-live-theme-v1", selected]]);
  return { records, getItem: key => records.get(key) ?? null, setItem: (key, val) => records.set(key, val) };
};
for (const [stored, expected] of [
  [undefined, "electric-stars"], ["nord-light", "nord-light"],
  ["electric-stars", "electric-stars"], ["unknown-theme", "electric-stars"]
]) {
  const doc = makeDocument();
  const storage = makeStorage(stored);
  const win = { localStorage: storage };
  runInNewContext(script("vre-theme"), { document: doc, window: win });
  assert.equal(doc.attributes["data-theme"], expected, "theme restored before rendering");
  assert.equal(doc.meta.value, expected === "nord-light" ? "#ECEFF4" : "#011629",
    "browser theme-color must restore before rendering");
  assert.equal(win.VRETheme.initial, expected);
  assert.equal(win.VRETheme.choose("nord-light"), "nord-light");
  assert.equal(storage.records.get("vre-live-theme-v1"), "nord-light");
  assert.equal(doc.meta.value, "#ECEFF4");
  assert.equal(win.VRETheme.choose("electric-stars"), "electric-stars");
  assert.equal(doc.meta.value, "#011629");
}
{
  const doc = makeDocument();
  const win = { localStorage: { getItem() { throw new Error("storage blocked"); }, setItem() { throw new Error("storage blocked"); } } };
  assert.doesNotThrow(() => runInNewContext(script("vre-theme"), { document: doc, window: win }));
  assert.equal(doc.attributes["data-theme"], "electric-stars", "private mode should fail closed");
}

const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
assert.ok(css, "missing app stylesheet");

// A previous release contained a missing } after .ride-status. Modern WebView
// interpreted all subsequent selectors as nested CSS, so static rule-presence
// assertions passed while the travel-time stepper rendered as browser defaults.
// Verify braces AND the intended *cascade scope*, including quoted/commented braces.
{
  let depth = 0, comment = false, quoted = "", escaped = false;
  const targetRules = [
    ".ride-status .badge{",
    ".ride-notifications{",
    ".ride-control{",
    ".commute-plan-travel-stepper{",
    ".commute-plan-step{",
    ".commute-plan-travel-value input{",
    ".commute-plan-confirm{"
  ];
  const positions = new Map(targetRules.map(rule => {
    const at = css.indexOf(rule);
    assert.ok(at >= 0, "missing required CSS rule " + rule);
    return [at, rule];
  }));
  const opened = [];
  for (let i = 0; i < css.length; i++) {
    const char = css[i], next = css[i + 1];
    if (comment) {
      if (char === "*" && next === "/") { comment = false; i++; }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quoted) quoted = "";
      continue;
    }
    if (char === "/" && next === "*") { comment = true; i++; continue; }
    if (char === '"' || char === "'") { quoted = char; continue; }
    if (positions.has(i)) assert.equal(depth, 0,
      positions.get(i) + " must be a top-level rule, not inside another selector");
    if (char === "{") { depth++; opened.push(i); }
    if (char === "}") {
      assert.ok(depth > 0, "unmatched CSS closing brace at " + i);
      depth--;
      opened.pop();
    }
  }
  assert.equal(depth, 0,
    "unclosed CSS block at offset " + opened.at(-1) +
    " can nest later controls and break Android WebView styling");
  assert.equal(quoted, "", "unterminated CSS quote");
  assert.equal(comment, false, "unterminated CSS comment");
  assert.match(css, /\.ride-status\{[^{}]*padding-left:42px\}/,
    "ride-status must close before all subsequent ride and planner rules");
}

const dark = css.match(/:root, :root\[data-theme="electric-stars"\]\s*\{([\s\S]*?)\n  \}/)?.[1];
const light = css.match(/:root\[data-theme="nord-light"\]\s*\{([\s\S]*?)\n  \}/)?.[1];
assert.ok(dark && light, "both themes must define semantic token overrides");
const tokens = str => Object.fromEntries([...str.matchAll(/--([a-zA-Z0-9-]+):\s*([^;\n]+)\s*;/g)]
  .map(([,name,value]) => [name,value.trim()]));
const a = tokens(dark), b = tokens(light);
const required = [
  "bg","card","card-2","nav","border","border-soft","fg","muted","muted-2",
  "meta-ink","meta-on-bg","red","blue","green","amber","accent","action-bg","action-fg",
  "action-border","selected-bg","selected-fg","sheet-bg","surface-hover",
  "banner-bg","danger-bg","map-label-major","map-ink","map-highlight","map-stroke",
  "line-F","line-M","line-ink","line-separator","accent-outline","ring","tab-surface","focus","pulse"
];
for (const key of required) {
  assert.ok(a[key] && b[key], "missing token " + key + " from one theme");
}
assert.equal(a.bg.toUpperCase(), "#011629");
assert.equal(a.card.toUpperCase(), "#102D49");
assert.equal(a["card-2"].toUpperCase(), "#193952");
assert.equal(a.accent.toUpperCase(), "#3A74DB");
assert.equal(a["accent-outline"].toUpperCase(), "#D4A0DF");
assert.equal(a.fg.toUpperCase(), "#E4EAF2");
assert.equal(b.bg.toUpperCase(), "#ECEFF4");
assert.equal(b.fg.toUpperCase(), "#2E3440");

// Electric Stars / Night Signal: original palette is available for specific roles,
// but neutral high-contrast typography replaces the all-lilac foreground.
const nightRoles = {
  "night-midnight": "#011629", "night-petrol": "#0C426D",
  "night-plum": "#372B68", "night-cobalt": "#3A74DB",
  "night-orchid": "#BE74CD", "night-lilac": "#F6B8FB",
  "night-display": "#F3F5FA", "night-ink": "#E4EAF2",
  "night-orchid-readable": "#D4A0DF",
};
for (const [role,hex] of Object.entries(nightRoles)) {
  assert.equal(a[role].toUpperCase(), hex, "Night Signal role " + role + " changed");
}
for (const [token,expected] of Object.entries({
  card:"#102D49", nav:"#0C2742", "tab-surface":"#0C2742",
  "card-elevated":"#0C2742", "selected-bg":"#372B68",
  "selected-fg":"#E4EAF2", "action-bg":"#F6B8FB", "action-fg":"#011629",
  "map-label-major":"#E4EAF2", "map-highlight":"#F6B8FB"
})) assert.equal(a[token].toUpperCase(), expected, "role-specific surface " + token);
for (const [token,expected] of Object.entries({
  card:"#FFFFFF", "card-2":"#E5E9F0", nav:"#D8DEE9",
  accent:"#365F90", "selected-bg":"#2E3440", "selected-fg":"#ECEFF4",
  "action-bg":"#2E3440", "action-fg":"#ECEFF4"
})) assert.equal(b[token].toUpperCase(), expected, "Nord Light must not change: "+token);


function luminance(hex) {
  const cs = hex.slice(1).match(/.{2}/g).map(x => parseInt(x,16) / 255)
    .map(x => x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055,2.4));
  return .2126 * cs[0] + .7152 * cs[1] + .0722 * cs[2];
}
function contrast(x,y) {
  const [bright,dim]=[luminance(x),luminance(y)].sort((u,v)=>v-u);
  return (bright+.05)/(dim+.05);
}
for (const [theme,palette] of [["Electric Stars",a],["Nord Light",b]]) {
  for (const [fore,back] of [
    ["fg","bg"],["fg","card"],["fg","card-2"],
    ["muted","card"],["muted-2","card"],["meta-ink","card"],
    ["action-fg","action-bg"],["selected-fg","selected-bg"],["meta-on-bg","bg"]
  ]) {
    const ratio=contrast(palette[fore],palette[back]);
    assert.ok(ratio>=4.5,`${theme} ${fore} on ${back} only ${ratio.toFixed(2)}:1 (requires WCAG AA 4.5)`);
  }
}
for (const [foreground,background] of [
  ["night-display","card"], ["night-ink","card-elevated"],
  ["night-orchid-readable","card"],["night-lilac","card"],
  ["muted","card-elevated"],["selected-fg","selected-bg"]
]) {
  assert.ok(contrast(a[foreground],a[background]) >= 4.5,
    "Night Signal " + foreground + " must meet AA on " + background);
}
assert.ok(contrast(a.accent,a.bg)<4.5, "Cobalt must stay a large-text / graphical accent");
assert.match(css,/\.btn\{[\s\S]*?background:var\(--action-bg\); color:var\(--action-fg\)/);
assert.match(css,/\.sheet\{[\s\S]*?background:var\(--sheet-bg\)/);
assert.match(css,/\.tabs button\.on\{background:var\(--selected-bg\); color:var\(--selected-fg\)/);
assert.match(css,/\.badge\.line-F\{color:var\(--line-F\)/);

// Night-specific selectors protect Nord, and keep exactly one special featured card.
assert.match(css, /:root\[data-theme="electric-stars"\] \.card\{\s*background:var\(--card\);/,
  "ordinary Night Signal cards must be flat");
assert.match(css, /:root\[data-theme="electric-stars"\] \.commute-focus\{\s*background:linear-gradient\(/,
  "only the featured commute uses a deliberate gradient");
assert.match(css, /:root\[data-theme="electric-stars"\] \.system-map-card\{\s*background:var\(--card\);border:0;/,
  "map is a quiet flat primary surface");
assert.match(css, /:root\[data-theme="electric-stars"\] \.tabs button\.on\{[^}]*var\(--night-plum\)/s,
  "rare plum elevation belongs to selected navigation");
assert.match(css, /:root\[data-theme="electric-stars"\] \.commute-focus-actions \.commute-options\{[^}]*var\(--action-bg\)/s,
  "collapsed Plan train is the sole highlighted action");
assert.match(css, /\.commute-options\[aria-expanded="true"\]\{[^}]*background:var\(--card-2\)/s,
  "expanded Plan train steps back while Confirm train becomes primary");
assert.match(css, /:root\[data-theme="electric-stars"\] \.commute-plan-confirm\{[^}]*var\(--action-bg\)/s,
  "expanded confirmation inherits the lilac primary treatment");
assert.doesNotMatch(css, /:root\[data-theme="electric-stars"\] \.btn\.ghost\{/,
  "a late generic ghost-button override must not turn lilac Plan train text pale");
assert.match(css, /:root\[data-theme="electric-stars"\] \.commute-focus-actions \.commute-options\[aria-expanded="true"\]\{[^}]*color:var\(--fg\)/s,
  "expanded disclosure uses neutral text while Confirm train becomes primary");
assert.match(css, /:root\[data-theme="electric-stars"\] \.sheet\{[^}]*backdrop-filter:none/s,
  "night dialogs are opaque material, not decorative glass");
assert.match(html, /className="card system-map-card"/,
  "system map exposes a specific semantic class for theme-scoped treatment");
const outsidePalettes = css.replace(/:root, :root\[data-theme="electric-stars"\]\s*\{[\s\S]*?\n  \}/, "")
  .replace(/:root\[data-theme="nord-light"\]\s*\{[\s\S]*?\n  \}/, "")
  .replace(/\.theme-swatch\.electric\{[^}]*\}/, "")
  .replace(/\.theme-swatch\.nord\{[^}]*\}/, "");
assert.doesNotMatch(outsidePalettes, /#[0-9a-f]{6}\b/i,
  "UI colors must not escape semantic palettes (except preview swatches)");
const app = script("vre-app");
assert.doesNotThrow(() => new Script(app));
assert.match(app,/function AppearanceSettings\(/);
assert.match(app,/aria-pressed=\$\{theme === choice\.id\}/);
assert.match(app,/theme=\$\{theme\} onThemeChange=\$\{setTheme\}/);
assert.match(app,/window\.VRETheme\?\.choose\(theme\)/);
assert.match(app,/window\.VreTheme\?\.postMessage\(selected\)/);
assert.match(app,/const LINE_COLOR = \{ F: "var\(--line-F\)", M: "var\(--line-M\)" \}/);
assert.doesNotMatch(app,/#[0-9a-f]{6}\b/i, "map, badges and inline styles must be tokenized");

// Both adaptive SVGs must retain shape-based focus and selected states.
assert.doesNotMatch(css, /select:focus-visible,\.train:focus-visible/,
  "train SVG controls must not inherit the browser's box focus ring");
assert.match(css, /\.atlas-train:focus-visible \.atlas-halo/,
  "compact atlas train markers retain circular focus");
assert.match(css, /\.follow-lens svg \[role=button\]:focus-visible/,
  "the active-ride lens retains a visible keyboard focus state");
assert.match(app, /className=\$\{"atlas-train" \+ \(selectedTrain\?" sel":""\)\}/,
  "selected trains stay visibly marked in the branch atlas");
assert.match(app, /onClick=\$\{\(\)=>onPick\(t\.tripId\)\}/,
  "atlas train markers remain selectable");
assert.match(app, /e\.preventDefault\(\);onPick\(t\.tripId\)/,
  "atlas train markers remain keyboard operable");
assert.match(app, /strokeDasharray=\$\{t\.ghost\?"3 3":null\}/,
  "schedule-only train markers stay visibly distinguishable");
const assets = read("android-lab/web/build-assets.mjs");
assert.ok(assets.includes("const bootstrapStart ="), "theme bootstrap must be extracted");
assert.ok(assets.includes('writeFile(join(output, "vre-theme.js"), bootstrapCode)'));
assert.ok(assets.includes('["vre-core", "vre-commutes", "vre-alerts", "vre-leave-by", "vre-app"]'),
  "the established source module order is preserved");
assert.match(assets,/if \(\/<script\(\?!/,"inline script CSP gate remains mandatory");
const nativeColors = read("android-lab/app/src/main/res/values/colors.xml");
for (const [name,hex] of Object.entries({
  vre_electric_bg:"#011629",vre_electric_card:"#102D49",
  vre_electric_nav:"#0C2742",vre_electric_fg:"#E4EAF2",
  vre_electric_muted:"#B8C9DC",vre_electric_cobalt:"#3A74DB",
  vre_electric_line_f:"#FF9BA7",vre_electric_line_m:"#A6CBFF",
  vre_nord_bg:"#ECEFF4",vre_nord_card:"#FFFFFF",
  vre_nord_fg:"#2E3440",vre_nord_nav:"#D8DEE9"
})) {
  assert.ok(nativeColors.includes('<color name="'+name+'">'+hex+'</color>'),
    "native widget and error UI parity for " + name);
}
const native = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/VreTheme.kt");
const main = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/MainActivity.kt");
const widgets = read("android-lab/app/src/main/java/work/samelling/vrelive/lab/DeparturesWidget.kt");
assert.match(native,/AndroidKeyStore|vre_live_native_theme/);
assert.match(native,/fun refreshWidgets\(/);
assert.match(main,/WebViewCompat\.addWebMessageListener\(webView, "VreTheme"/);
assert.match(main,/VreTheme\.apply\(this\)/);
assert.match(widgets,/R\.layout\.route_widget_nord/);
assert.match(widgets,/R\.layout\.departures_widget_nord/);
for(const path of [
  "android-lab/app/src/main/res/values/colors.xml",
  "android-lab/app/src/main/res/layout/route_widget_nord.xml",
  "android-lab/app/src/main/res/layout/departures_widget_nord.xml",
  "android-lab/app/src/main/res/drawable/route_widget_bg_nord.xml"
]) assert.ok(read(path).length>100, "missing native theme resource: "+path);
console.log("Nord Light & Electric Stars: persistence, AA contrasts, web CSP, native widgets and tokenization passed");
