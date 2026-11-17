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
const {webcrypto}=await import("node:crypto");
globalThis.crypto ||= webcrypto;
const pair=await crypto.subtle.generateKey(
  {name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},
  true,["sign","verify"]);
const der=await crypto.subtle.exportKey("pkcs8",pair.privateKey);
const account={
  project_id:"vre-live-test",client_email:"test@vre-live-test.iam.gserviceaccount.com",
  private_key:"-----BEGIN PRIVATE KEY-----\n"+Buffer.from(der).toString("base64")+"\n-----END PRIVATE KEY-----"
};
const env={
  FCM_SERVICE_ACCOUNT_JSON:JSON.stringify(account),
  PAIRING_CODE:"test-pairing-code-1234567890"
};
const store=new Map();
let alarmAt=null,deleted=0;
const storage={
  async get(k){return structuredClone(store.get(k));},
  async put(k,v){store.set(k,structuredClone(v));},
  async delete(k){store.delete(k);},
  async setAlarm(at){alarmAt=at;},
  async deleteAlarm(){alarmAt=null;deleted++;},
  async transaction(fn){return fn(this);}
};
const coord=new CommuteMonitorCoordinator({storage},env);
env.COMMUTE_MONITOR={
  idFromName(name){assert.equal(name,"shared-active-commutes");return name;},
  get(){return {fetch:req=>coord.fetch(req)};}
};
const oldNow=Date.now,oldFetch=globalThis.fetch;
let feedRequests=0, oauthCalls=0, fcmCalls=0;
const request=async (path,body,auth="",method="POST")=> {
  const {default:gateway}=await import("../src/commute-monitor-worker.js");
  return gateway.fetch(new Request("https://preview.example"+path,{
    method,headers:{"content-type":"application/json",...(auth?{authorization:"Bearer "+auth}:{})},
    body:JSON.stringify(body)
  }),env);
};
const pairCode=async (code,fcmToken=input().fcmToken)=>
  request("/v1/devices/pair",{pairingCode:code,fcmToken});
const code1="test-pairing-code-1234567890";
try{
  Date.now=()=>when("2026-11-16T11:25:00Z");
  assert.equal((await request("/v1/watches",input())).status,401,
    "unpaired device cannot create a monitoring session");
  assert.equal((await pairCode("incorrect-test-pairing-code-12345")).status,401,
    "incorrect one-time secret cannot pair");
  const first=await pairCode(code1);
  assert.equal(first.status,201);
  const firstIdentity=await first.json();
  assert.match(firstIdentity.deviceId,/^device_[a-f0-9]{32}$/);
  assert.match(firstIdentity.accessToken,/^[A-Za-z0-9_-]{43}$/);
  const firstAuth=firstIdentity.deviceId+"."+firstIdentity.accessToken;
  assert.equal((await pairCode(code1)).status,409,
    "the same one-time code must never issue a second credential");
  assert.equal((await request("/v1/watches/status",{},firstIdentity.deviceId+".bad")).status,401,
    "a device ID alone cannot authorize monitoring");
  assert.equal((await request("/v1/watches",input())).status,401,
    "known owner IDs in a JSON body do not grant access");

  const firstWatch=await request("/v1/watches",input(),firstAuth);
  assert.equal(firstWatch.status,201);
  assert.equal(alarmAt,when("2026-11-16T11:45:00Z"),
    "early confirmation schedules only the future leave-time monitoring window");
  const duplicate=await request("/v1/watches",input(),firstAuth);
  assert.equal(duplicate.status,200);
  assert.equal(Object.keys(await coord.load()).length,1,"retries do not duplicate watches");
  let stored=Object.values(await coord.load())[0];
  assert.equal(stored.ownerId,firstIdentity.deviceId,
    "owner is always derived from verified device identity");
  assert.equal(stored.fcmToken,input().fcmToken,
    "server uses paired FCM token instead of request-supplied token");
  const changed={...input(),fcmToken:"not-an-authenticated-token"};
  assert.equal((await request("/v1/watches",changed,firstAuth)).status,200,
    "client cannot forge FCM target by changing payload field");
  assert.equal(Object.values(await coord.load())[0].fcmToken,input().fcmToken);
  const status=await request("/v1/watches/status",{},firstAuth);
  const listing=await status.json();
  assert.equal(listing.watches.length,1);
  assert.ok(!JSON.stringify(listing).includes("fcm-"),"status excludes FCM tokens");
  const rotatedToken="fcm-"+"B".repeat(100);
  assert.equal((await request("/v1/devices/token",{fcmToken:rotatedToken},firstAuth)).status,200);
  assert.equal(Object.values(await coord.load())[0].fcmToken,rotatedToken,
    "token rotation updates watches that are still active");
  // A second unique pairing code is required to pair a second device.
  env.PAIRING_CODE="second-pairing-code-123456789";
  const second=await pairCode(env.PAIRING_CODE);
  assert.equal(second.status,201);
  const secondIdentity=await second.json();
  const secondAuth=secondIdentity.deviceId+"."+secondIdentity.accessToken;
  assert.equal((await request("/v1/watches",input("spoofed_owner_id","watch_abcdefghij"),
    secondAuth)).status,201);
  assert.equal(Object.keys(await coord.load()).length,2);
  globalThis.fetch=async (url,opts)=>{
    const address=String(url);
    if(address.startsWith("https://gtfs.vre.org/")){
      feedRequests++;
      return new Response(new Uint8Array([0,0]),{status:200});
    }
    if(address==="https://oauth2.googleapis.com/token"){
      oauthCalls++;
      return Response.json({access_token:"mock-fcm-access",expires_in:3600});
    }
    if(address.startsWith("https://fcm.googleapis.com/v1/projects/")){
      fcmCalls++;
      const envelope=JSON.parse(opts.body);
      assert.equal(envelope.message.data.kind,"leave_now");
      assert.equal(envelope.message.notification,undefined,
        "only Android may display a consent-checked data-only notification");
      assert.equal(opts.headers.authorization,"Bearer mock-fcm-access");
      return Response.json({name:"projects/vre-live-test/messages/123"});
    }
    throw Error("Unexpected outbound call: "+address);
  };
  await coord.alarm();
  assert.equal(feedRequests,0,"no upstream request before the monitoring window");
  Date.now=()=>when("2026-11-16T11:45:00Z");
  await coord.alarm();
  assert.equal(feedRequests,2,"all active riders share exactly two GTFS feed requests");
  Date.now=()=>when("2026-11-16T12:00:00Z");
  await coord.alarm();
  assert.equal(feedRequests,4,"one pair of GTFS requests per shared monitoring tick");
  assert.equal(oauthCalls,1,"one Google OAuth access token reused for two devices");
  assert.equal(fcmCalls,2,"two authorized devices receive one leave-now push each");
  assert.equal(Object.keys(await coord.load()).length,0);
  assert.equal(alarmAt,null,"delivered final watch clears all monitoring alarms");
  assert.equal((await request("/v1/watches",input(),firstAuth)).status,200);
  assert.equal(Object.keys(await coord.load()).length,0,
    "replayed subscription cannot resurrect a delivered watch");
  await coord.alarm();
  assert.equal(feedRequests,4,"no feed request with zero active watches");
  assert.equal(fcmCalls,2,"no duplicate post-delivery notification");

  assert.equal((await request("/v1/devices/revoke",{},firstAuth)).status,200);
  assert.equal((await request("/v1/watches/status",{},firstAuth)).status,401,
    "revoked device credentials cannot regain access");
  assert.equal((await request("/v1/watches/status",{},secondAuth)).status,200,
    "revoking one device does not revoke another");
  const total=feedRequests;
  await request("/v1/devices/revoke",{},secondAuth);
  await coord.alarm();
  assert.equal(feedRequests,total);
  assert.equal(alarmAt,null);
  assert.ok(deleted>0);

  const {default:gateway}=await import("../src/commute-monitor-worker.js");
  assert.equal((await gateway.fetch(new Request("https://preview.example/v1/devices/pair",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({pairingCode:code1,fcmToken:rotatedToken})
  }),{})).status,503,"unconfigured Firebase fails closed");
} finally {Date.now=oldNow;globalThis.fetch=oldFetch;}
console.log("Secure one-time device pairing, owner isolation, shared feeds, push and revoke passed");
