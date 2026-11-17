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
const dark = css.match(/:root, :root\[data-theme="electric-stars"\]\s*\{([\s\S]*?)\n  \}/)?.[1];
const light = css.match(/:root\[data-theme="nord-light"\]\s*\{([\s\S]*?)\n  \}/)?.[1];
assert.ok(dark && light, "both themes must define semantic token overrides");
const tokens = str => Object.fromEntries([...str.matchAll(/--([a-zA-Z0-9-]+):\s*([^;\n]+)\s*;/g)]
  .map(([,name,value]) => [name,value.trim()]));
const a = tokens(dark), b = tokens(light);
const required = [
  "bg","card","card-2","nav","border","border-soft","fg","muted","muted-2",
  "meta-ink","red","blue","green","amber","accent","action-bg","action-fg",
  "action-border","selected-bg","selected-fg","sheet-bg","surface-hover",
  "banner-bg","danger-bg","map-label-major","map-ink","map-highlight","map-stroke",
  "line-F","line-M","line-ink","line-separator","accent-outline","ring","tab-surface","focus","pulse"
];
for (const key of required) {
  assert.ok(a[key] && b[key], "missing token " + key + " from one theme");
}
assert.equal(a.bg.toUpperCase(), "#011629");
assert.equal(a.card.toUpperCase(), "#0C426D");
assert.equal(a["card-2"].toUpperCase(), "#372B68");
assert.equal(a.accent.toUpperCase(), "#3A74DB");
assert.equal(a["accent-outline"].toUpperCase(), "#BE74CD");
assert.equal(a.fg.toUpperCase(), "#F6B8FB");
assert.equal(b.bg.toUpperCase(), "#ECEFF4");
assert.equal(b.fg.toUpperCase(), "#2E3440");

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
    ["action-fg","action-bg"],["selected-fg","selected-bg"]
  ]) {
    const ratio=contrast(palette[fore],palette[back]);
    assert.ok(ratio>=4.5,`${theme} ${fore} on ${back} only ${ratio.toFixed(2)}:1 (requires WCAG AA 4.5)`);
  }
}
assert.ok(contrast(a.accent,a.bg)<4.5, "Cobalt must stay a large-text / graphical accent");
assert.match(css,/\.btn\{[\s\S]*?background:var\(--action-bg\); color:var\(--action-fg\)/);
assert.match(css,/\.sheet\{[\s\S]*?background:var\(--sheet-bg\)/);
assert.match(css,/\.tabs button\.on\{background:var\(--selected-bg\); color:var\(--selected-fg\)/);
assert.match(css,/\.badge\.line-F\{color:var\(--line-F\)/);
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

const assets = read("android-lab/web/build-assets.mjs");
assert.match(assets,/\["vre-theme", "vre-core"/);
assert.match(assets,/id === "vre-theme" \? '<script src="vre-theme\.js"><\/script>'/,
  "Android must package theme bootstrap instead of violating CSP");
assert.match(assets,/if \(\/<script\(\?!/,"inline script CSP gate remains mandatory");
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
