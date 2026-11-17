import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {CommuteMonitorCoordinator,validatedWatch,forecastWatch} from "../src/commute-monitor-worker.js";
const read = p => readFileSync(new URL("../"+p,import.meta.url),"utf8");
const html=read("src/index.html");
const embedded=id=>html.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)<\\/script>'))?.[1].trim()+"\n";
assert.equal(read("src/monitor-core.js"),embedded("vre-core"),
  "monitor's service calendar, trains and GTFS parser match the client byte-for-byte");
assert.equal(read("src/monitor-leave-by.js"),embedded("vre-leave-by"),
  "server and client use identical safety rules for delay-dependent leave times");
const config=read("wrangler.commute-preview.toml");
const production=read("wrangler.toml");
assert.match(config,/name = "vre-live-commute-monitor-preview"/);
assert.match(config,/new_sqlite_classes = \["CommuteMonitorCoordinator"\]/);
assert.doesNotMatch(config,/\bcrons\s*=/,"DO coordinator has zero cron wakeups");
assert.match(production,/name = "vre-live"/, "production worker remains independent");
const when=x=>Date.parse(x);
const monday=when("2026-11-16T11:45:00Z"); // 6:45 EST for 7:25 train
const input=(ownerId="owner_0123456789",watchId="watch_0123456789")=>({
  ownerId,watchId,trainNumber:"310",from:"06",to:"03",
  travelMinutes:15,platformMinutes:2,bufferMinutes:8,
  fcmToken:"fcm-"+ "A".repeat(100)
});
const w=validatedWatch(input(),monday);
assert.equal(w.scheduled,when("2026-11-16T12:25:00Z"),"train 310 departs 7:25 EST");
assert.equal(w.startsAt,monday,"monitor activates after the morning check-in, not during idle hours");
assert.equal(w.expires,when("2026-11-16T12:40:00Z"));
assert.equal(w.leadMs,25*60000);
assert.equal(forecastWatch(w,monday,{},{}).leaveBy,when("2026-11-16T12:00:00Z"),
  "the server's scheduled leave-by time matches the Android app");
assert.equal(forecastWatch(w,when("2026-11-16T12:00:00Z"),{},{}).state,"leave-now");
const pre=validatedWatch(input(),when("2026-11-16T11:25:00Z"));
assert.equal(pre.startsAt,when("2026-11-16T11:45:00Z"),"early confirmations do not poll before monitoring window");
for(const bad of [
  [{...input(),trainNumber:"999"},monday],
  [{...input(),from:"99"},monday],
  [{...input(),bufferMinutes:200},monday],
  [{...input(),travelMinutes:0,platformMinutes:0},monday],
  [{...input(),fcmToken:"short"},monday],
  [input(),when("2026-11-26T11:45:00Z")], // Thanksgiving
  [input(),when("2026-11-21T11:45:00Z")], // Saturday
  [input(),when("2026-11-16T07:20:00Z")], // over 4 hours before departure
]) assert.throws(()=>validatedWatch(...bad));
const store=new Map();
let alarmAt=null,deleted=0;
const storage={
  async get(k){return store.get(k);},
  async put(k,v){store.set(k,structuredClone(v));},
  async delete(k){store.delete(k);},
  async setAlarm(at){alarmAt=at;},
  async deleteAlarm(){alarmAt=null;deleted++;}
};
const coord=new CommuteMonitorCoordinator({storage},{});
const oldNow=Date.now,oldFetch=globalThis.fetch;
let feedRequests=0;
const invoke=async (path,body)=>coord.fetch(new Request("https://coordinator.internal/"+path,{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)
}));
try {
  Date.now=()=>when("2026-11-16T11:25:00Z");
  const first=await invoke("subscribe",input());
  assert.equal(first.status,201);
  assert.equal(alarmAt,when("2026-11-16T11:45:00Z"),"future activation sets a single delayed alarm");
  assert.equal((await invoke("subscribe",input())).status,200,"repeat activation is idempotent");
  assert.equal(Object.keys(await coord.load()).length,1);
  const second=await invoke("subscribe",input("owner_abcdefghij","watch_abcdefghij"));
  assert.equal(second.status,201);
  assert.equal(Object.keys(await coord.load()).length,2,"multiple commuters share one object");
  globalThis.fetch=async url=>{
    feedRequests++;
    if(!String(url).startsWith("https://gtfs.vre.org/")) throw Error("bad upstream");
    return new Response(new Uint8Array([0,0]),{status:200});
  };
  await coord.alarm();
  assert.equal(feedRequests,0,"no VRE request before the monitoring window");
  Date.now=()=>monday;
  await coord.alarm();
  assert.equal(feedRequests,2,"two shared GTFS feeds fetched only once for two active riders");
  const status=await invoke("status",{ownerId:"owner_0123456789"});
  const listing=await status.json();
  assert.equal(listing.watches.length,1,"owner sees only its own watches");
  assert.ok(!JSON.stringify(listing).includes("fcm-"),"FCM device token is never exposed by status");
  const cancel=await invoke("cancel",{ownerId:"owner_0123456789",watchId:"watch_0123456789"});
  assert.equal(cancel.status,200);
  assert.equal(Object.keys(await coord.load()).length,1);
  assert.ok(alarmAt!=null,"alarm remains while another watch is active");
  await invoke("cancel-owner",{ownerId:"owner_abcdefghij"});
  assert.equal(Object.keys(await coord.load()).length,0);
  assert.equal(alarmAt,null,"last cancel deletes alarm entirely");
  const total=feedRequests;
  await coord.alarm();
  assert.equal(feedRequests,total,"zero upstream requests when idle");
  assert.ok(deleted>0);

  // Preview public gateway must refuse registration without secrets and
  // never expose a potentially reusable client-side credential.
  const {default:gateway}=await import("../src/commute-monitor-worker.js");
  assert.equal((await gateway.fetch(new Request("https://preview.example/v1/watches",{
    method:"POST",headers:{"authorization":"Bearer wrong","content-type":"application/json"},
    body:JSON.stringify(input())
  }),{})).status,503,"unset gateway secret fails closed");
  const token="x".repeat(64);
  assert.equal((await gateway.fetch(new Request("https://preview.example/v1/watches",{
    method:"POST",headers:{"authorization":"Bearer WRONG","content-type":"application/json"},
    body:JSON.stringify(input())
  }),{MONITOR_GATEWAY_TOKEN:token})).status,401);
  assert.equal((await gateway.fetch(new Request("https://preview.example/v1/watches",{
    method:"POST",headers:{"authorization":"Bearer "+token,"content-type":"application/json"},
    body:JSON.stringify(input())
  }),{MONITOR_GATEWAY_TOKEN:token})).status,503,
  "must not activate monitoring without configured FCM delivery");
  // Full mocked delivery: two riders share one GTFS fetch, two FCM messages,
  // one OAuth token exchange, then the coordinator becomes completely idle.
  const {webcrypto}=await import("node:crypto");
  globalThis.crypto ||= webcrypto;
  const pair=await crypto.subtle.generateKey(
    {name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},
    true,["sign","verify"]);
  const der=await crypto.subtle.exportKey("pkcs8",pair.privateKey);
  const account={project_id:"vre-live-test",client_email:"test@vre-live-test.iam.gserviceaccount.com",
    private_key:"-----BEGIN PRIVATE KEY-----\n"+Buffer.from(der).toString("base64")+"\n-----END PRIVATE KEY-----"};
  const env={FCM_SERVICE_ACCOUNT_JSON:JSON.stringify(account)};
  const liveState=new Map();
  let liveAlarm=null,oauthCalls=0,fcmCalls=0,sharedFeedCalls=0;
  const coordinator=new CommuteMonitorCoordinator({storage:{
    async get(k){return liveState.get(k);},
    async put(k,v){liveState.set(k,structuredClone(v));},
    async delete(k){liveState.delete(k);},
    async setAlarm(t){liveAlarm=t;},
    async deleteAlarm(){liveAlarm=null;}
  }},env);
  const addWatch=(ownerId,watchId)=>coordinator.fetch(new Request(
    "https://coordinator.internal/subscribe",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify(input(ownerId,watchId))}));
  Date.now=()=>monday;
  assert.equal((await addWatch("owner_0123456789","watch_0123456789")).status,201);
  assert.equal((await addWatch("owner_abcdefghij","watch_abcdefghij")).status,201);
  Date.now=()=>when("2026-11-16T12:00:00Z"); // 7 AM: scheduled departure minus 25m approach
  globalThis.fetch=async (url,init)=>{
    const address=String(url);
    if(address.startsWith("https://gtfs.vre.org/")){
      sharedFeedCalls++;
      return new Response(new Uint8Array([0,0]),{status:200});
    }
    if(address==="https://oauth2.googleapis.com/token"){
      oauthCalls++;
      assert.match(String(init.body),/grant_type=/,"FCM uses Google OAuth JWT exchange");
      return Response.json({access_token:"mock-short-lived-token",expires_in:3600});
    }
    if(address.startsWith("https://fcm.googleapis.com/v1/projects/")){
      fcmCalls++;
      assert.equal(init.headers.authorization,"Bearer mock-short-lived-token");
      const envelope=JSON.parse(init.body);
      assert.equal(envelope.message.data.kind,"leave_now");
      assert.equal(envelope.message.notification.title,"Leave now for train 310");
      assert.equal(envelope.message.android.notification.channel_id,"commute_leave_now_v1");
      return Response.json({name:"projects/vre-live-test/messages/123"});
    }
    throw new Error("Unexpected outbound request "+address);
  };
  await coordinator.alarm();
  assert.equal(sharedFeedCalls,2,"a tick shared between two riders fetches only two GTFS feeds");
  assert.equal(oauthCalls,1,"one short-lived Google access token is reused for riders");
  assert.equal(fcmCalls,2,"each opted-in device gets one leave-now notification");
  assert.equal(Object.keys(await coordinator.load()).length,0,"delivered watches are removed");
  assert.equal(liveAlarm,null,"successful final delivery deletes the coordinator alarm");
  Date.now=()=>when("2026-11-16T12:01:00Z");
  assert.equal((await addWatch("owner_0123456789","watch_0123456789")).status,200,
    "replayed registration does not resurrect a delivered watch");
  assert.equal(Object.keys(await coordinator.load()).length,0,
    "success tombstone blocks duplicate leave-now alert after network retries");
  await coordinator.alarm();
  assert.equal(sharedFeedCalls,2,"no next-minute polling after all deliveries");
  assert.equal(fcmCalls,2,"alarm retries cannot redeliver an already removed watch");

} finally {Date.now=oldNow;globalThis.fetch=oldFetch;}
console.log("Event-driven monitor: schedule, shared feed, idle/cancel, auth and source parity passed");
