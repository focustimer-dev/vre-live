import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, runInNewContext } from "node:vm";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const page=read("src/index.html");
const app=page.match(/<script id="vre-app">([\s\S]*?)<\/script>/)?.[1];
const css=page.match(/<style>([\s\S]*?)<\/style>/)?.[1];
assert.ok(app && css);
assert.doesNotThrow(()=>new Script(app), "adaptive map module compiles");
const from=app.indexOf("  function followLensStops(");
const to=app.indexOf("  function FollowLens(",from);
const atlasFrom=app.indexOf("  function atlasY(");
const atlasTo=app.indexOf("  function BranchAtlas(",atlasFrom);
assert.ok(from>=0 && to>from && atlasFrom>to && atlasTo>atlasFrom);
const stops={"01":{name:"Union Station"},"02":{name:"L'Enfant"},"03":{name:"Crystal City"},
  "04":{name:"Alexandria"},"05":{name:"Franconia"},"06":{name:"Lorton"},
  "07":{name:"Woodbridge"},"08":{name:"Rippon"}};
const mockCore={remainingStops:(train,now)=>train.stops.filter(stop=>stop.time>now)};
const view=runInNewContext(app.slice(from,to)+"\n;followLensStops",{STATIONS:stops,VRECore:mockCore});
const now=Date.UTC(2026,10,17,17,0);
const train={stops:Object.keys(stops).map((code,i)=>({code,time:now+(i-2)*60000}))};
const lens=view(train,"08",now);
assert.equal(lens.stops.length,4, "lens shows only four stations");
assert.equal(lens.stops[0].code,"03","lens starts with a previous stop for context");
assert.equal(lens.stops[1].code,"04","the next stop is placed near the focused train");
assert.equal(lens.destination,"08","destination preserved even if outside lens");
assert.equal(view(null,"08",now).stops.length,0,"empty/unavailable positions are safe");
const points=runInNewContext(app.slice(atlasFrom,atlasTo)+"\n;atlasY",{STATIONS:stops});
assert.equal(points(40),30,"northern endpoint");
assert.equal(points(648),395,"southern endpoint");
assert.ok(points(244)<200,"branch atlas compresses the full 700px network into 445px");
assert.match(app,/function FollowLens\(/);
assert.match(app,/function BranchAtlas\(/);
assert.match(app,/viewBox="0 0 390 284"/,"ride lens stays within short bounded viewport");
assert.match(app,/viewBox="0 0 390 445"/,"system atlas fits into a much shorter card");
assert.match(app,/const focused = !!activeTrain && !overview/,
  "an explicitly active ride defaults to Follow Lens");
assert.match(app,/setOverviewTrip\(value \? myTripId : null\)/,
  "the rider can still select a full-system atlas");
assert.match(app,/className=\$\{"atlas-train" \+ \(selectedTrain\?" sel":""\)\}/,
  "atlas displays selected train state");
assert.match(app,/aria-label=\$\{`Train \$\{t.num\},/,
  "train markers remain individually accessible");
assert.match(app,/e.preventDefault\(\);onPick\(t.tripId\)/,
  "train marker keyboard interaction survives");
assert.match(app,/strokeDasharray=\$\{t.ghost\?"3 3":null\}/,
  "timetable-only trains preserve dashed markers");
assert.match(css,/\.lens-svg,\.atlas-svg\{display:block;width:100%;height:auto;/);
assert.match(css,/\.atlas-train:focus-visible \.atlas-halo/);
assert.match(css,/\.journey-views button\{font-size:var\(--fs-2\)/,
  "Follow/System controls remain compact");
const kotlin=read("android-lab/app/src/main/java/work/samelling/vrelive/lab/DeparturesWidget.kt");
assert.match(kotlin,/fun rideRibbon\(cache: JSONObject\): Ribbon\?/);
assert.match(kotlin,/!ride.optBoolean\("boarded"\) \|\| ride.optBoolean\("waiting"\)/,
  "a waiting or unconfirmed rider never receives the journey ribbon");
assert.match(kotlin,/age !in -10000L\.\.28800000L/,
  "expired ride state cannot permanently occupy the widget");
assert.match(kotlin,/freshPosition && ride.has\("progress"\)/,
  "stale GPS cannot produce a fictional progress bar");
assert.match(kotlin,/if \(ribbon != null\) \{/,"widget switches layout when boarded");
assert.match(kotlin,/R.layout.ride_ribbon_widget_nord/);
assert.match(kotlin,/R.layout.ride_ribbon_widget\)/);
assert.match(kotlin,/if \(destination != null\) \{/,
  "station-only widgets remain station-only and do not inherit the ribbon");
assert.match(app,/boarded: true/,"boarding is passed explicitly to native");
assert.match(app,/positionFresh: freshRidePosition/,"native position confidence is explicit");
assert.match(app,/routeProgress = freshRidePosition &&/,"progress requires verified live position");
for(const path of ["ride_ribbon_widget.xml","ride_ribbon_widget_nord.xml"]) {
  const xml=read("android-lab/app/src/main/res/layout/"+path);
  for(const id of ["widget_root","ribbon_title","ribbon_eta","ribbon_detail","ribbon_progress"])
    assert.ok(xml.includes('android:id="@+id/'+id+'"'),path+" missing "+id);
  assert.match(xml,/android:progressTint="@color\//,"theme-aware ribbon progress bar");
  assert.match(xml,/android:height="5dp"|android:layout_height="5dp"/);
}
console.log("VRE Follow Lens / Branch Atlas / confirmed-boarded widget ribbon: PASS");
