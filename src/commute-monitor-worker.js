import "./monitor-core.js";
import "./monitor-leave-by.js";
import { configured as fcmConfigured, sendLeaveNow } from "./monitor-fcm.js";

// Independent Cloudflare Worker: NO cron triggers, NO dependency on the production Worker.
const CORE = globalThis.VRECore;
const LEAVE = globalThis.VRELeaveBy;
const FEED_BASE = "https://gtfs.vre.org/containercdngtfsupload/";
const MAX_WATCHES = 1000;
const MAX_PER_OWNER = 6;
const MAX_PAYLOAD = 8192;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const DATE = /^\d{8}$/;
const SAFE_ID = /^[a-zA-Z0-9_-]{12,72}$/;
const STATION = /^[0-9]{2}$/;
const TRAIN = /^[0-9]{3,4}$/;
const fail = (message, status) => respond({error:message},status);
const respond = (value, status = 200) => new Response(JSON.stringify(value),{
  status, headers:{"content-type":"application/json","cache-control":"no-store"}
});
function secureMatch(a,b) {
  if (typeof a!=="string"||typeof b!=="string") return false;
  const aBytes=new TextEncoder().encode(a),bBytes=new TextEncoder().encode(b);
  let difference=aBytes.length^bBytes.length;
  for (let i=0;i<Math.max(aBytes.length,bBytes.length);i++)
    difference|=(aBytes[i]||0)^(bBytes[i]||0);
  return difference===0;
}
const isServiceDay = now => CORE.isServiceDay(new Date(now));
const liveIndex = trains => CORE.liveTrainIndex(trains);
const stepMs = remaining => remaining>45*60000 ? 5*60000
  : remaining>15*60000 ? 2*60000
    : remaining>5*60000 ? 60000 : 30000;
/** Server-side schedule checks; never trust a client-supplied departure timestamp. */
export function validatedWatch(input, now = Date.now()) {
  if (!input || typeof input!=="object" || Array.isArray(input)) throw new Error("bad watch");
  const {ownerId,watchId,trainNumber,from,to,fcmToken}=input;
  if (!SAFE_ID.test(ownerId||"")||!SAFE_ID.test(watchId||"")||
      !TRAIN.test(trainNumber||"")||!STATION.test(from||"")||!STATION.test(to||"")||
      typeof fcmToken!=="string"||fcmToken.length<40||fcmToken.length>4096) throw new Error("invalid fields");
  if (!Number.isFinite(now)||!isServiceDay(now)) throw new Error("no train service");
  const lead = [input.travelMinutes,input.platformMinutes,input.bufferMinutes];
  if (!lead.every(x=>Number.isInteger(x)&&x>=0&&x<=180)||
      input.platformMinutes>60||input.bufferMinutes>60||
      input.travelMinutes+input.platformMinutes<=0 ||
      lead.reduce((a,b)=>a+b,0)>240) throw new Error("invalid approach time");
  const serviceDate=CORE.serviceDateKey(now);
  const reduced=CORE.SCHEDULE.reducedService.includes(serviceDate);
  const trip=CORE.SCHEDULE.trips.find(t=>String(t.num)===trainNumber &&
    (!reduced||CORE.SCHEDULE.sTrains.has(t.num)) &&
    t.stops.findIndex(s=>s[0]===from)>=0 &&
    t.stops.findIndex(s=>s[0]===to)>t.stops.findIndex(s=>s[0]===from));
  if (!trip) throw new Error("train does not serve chosen route today");
  const at=trip.stops.find(s=>s[0]===from)[1];
  const scheduled=LEAVE.easternMinute(now,at);
  if (now>scheduled+60000 || scheduled-now>4*3600000)
    throw new Error("train is outside activation window");
  const leadMs=lead.reduce((a,b)=>a+b,0)*60000;
  const plannedLeave=scheduled-leadMs;
  const startsAt=Math.max(now,plannedLeave-15*60000);
  const expires=Math.min(scheduled+15*60000,now+5*3600000);
  if (expires<=startsAt) throw new Error("watch expired");
  return {
    ownerId,watchId,trainNumber,tripId:trip.trip,from,to,
    boardingName:CORE.STATIONS[from]?.name||from,serviceDate,
    fcmToken,scheduled,startsAt,expires,leadMs,
    travelMinutes:lead[0],platformMinutes:lead[1],bufferMinutes:lead[2],
    attempts:0,nextRetry:0,created:now
  };
}
export function forecastWatch(watch, now, byTrip, history) {
  const profile={
    from:watch.from,to:watch.to,preferredTrains:[watch.trainNumber],
    travelMinutes:watch.travelMinutes,
    platformMinutes:watch.platformMinutes,bufferMinutes:watch.bufferMinutes
  };
  return LEAVE.calculate(profile,watch.trainNumber,CORE,byTrip,history,now);
}
function nextWake(watches, now) {
  const times=[];
  for (const w of Object.values(watches)) {
    if (w.expires<=now) continue;
    if (w.startsAt>now) times.push(w.startsAt);
    else if(w.nextRetry>now) {
      times.push(w.nextRetry);
    } else {
      const leave=w.scheduled-w.leadMs;
      times.push(now+stepMs(leave-now));
    }
  }
  return times.length?Math.max(now+1000,Math.min(...times)):null;
}
async function fetchFeed(name) {
  const response=await fetch(FEED_BASE+name,{
    method:"GET",headers:{"user-agent":"VRELive-commute-monitor/preview"},
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok) throw new Error("VRE upstream unavailable");
  const len=Number(response.headers.get("content-length"));
  if(Number.isFinite(len)&&len>MAX_FEED_BYTES) throw new Error("oversized VRE feed");
  const buf=await response.arrayBuffer();
  if(buf.byteLength>MAX_FEED_BYTES) throw new Error("oversized VRE feed");
  return new Uint8Array(buf);
}
async function readBody(req) {
  if(Number(req.headers.get("content-length"))>MAX_PAYLOAD) throw new Error("body too large");
  const text=await req.text();
  if(text.length>MAX_PAYLOAD) throw new Error("body too large");
  return JSON.parse(text);
}
export class CommuteMonitorCoordinator {
  constructor(ctx,env) { this.ctx=ctx;this.env=env; }
  async load() {return await this.ctx.storage.get("watches")||{};}
  async save(watches) {
    if(Object.keys(watches).length) await this.ctx.storage.put("watches",watches);
    else await this.ctx.storage.delete("watches");
    const at=nextWake(watches,Date.now());
    if(at!==null) await this.ctx.storage.setAlarm(at);
    else await this.ctx.storage.deleteAlarm();
  }
  async fetch(req) {
    const action=new URL(req.url).pathname;
    const now=Date.now();
    let body;
    try {body=await readBody(req);} catch{return fail("invalid JSON",400);}
    const ownerId=body?.ownerId,watchId=body?.watchId;
    if(!SAFE_ID.test(ownerId||"")) return fail("invalid owner",400);
    const watches=await this.load();
    if(action==="/subscribe"){
      let watch;
      try {watch=validatedWatch(body,now);}catch(e){return fail(e.message,422);}
      const key=ownerId+":"+watchId;
      const delivered=await this.ctx.storage.get("delivered")||{};
      if(delivered[key]&&delivered[key]>now)
        return respond({ok:true,alreadyDelivered:true,watchId});
      const existing=watches[key];
      if(existing){
        if(existing.tripId!==watch.tripId||existing.from!==watch.from||
           existing.to!==watch.to) return fail("watch ID already in use",409);
        // Mobile FCM tokens rotate. Updating the token or a one-day travel
        // adjustment must not require a second subscription or extra polling.
        watches[key]={...watch,created:existing.created,
          attempts:existing.attempts,nextRetry:existing.nextRetry};
        await this.save(watches);
        return respond({ok:true,alreadyActive:true,watchId,expires:watch.expires});
      }
      if(Object.keys(watches).length>=MAX_WATCHES) return fail("monitor capacity reached",429);
      if(Object.values(watches).filter(w=>w.ownerId===ownerId).length>=MAX_PER_OWNER)
        return fail("device watch limit reached",429);
      watches[key]=watch;
      await this.save(watches);
      return respond({ok:true,watchId,startsAt:watch.startsAt,expires:watch.expires},201);
    }
    if(action==="/cancel"){
      if(!SAFE_ID.test(watchId||"")) return fail("invalid watch ID",400);
      delete watches[ownerId+":"+watchId];
      await this.save(watches);
      return respond({ok:true});
    }
    if(action==="/cancel-owner"){
      for(const [key,watch] of Object.entries(watches))
        if(watch.ownerId===ownerId) delete watches[key];
      await this.save(watches);
      return respond({ok:true});
    }
    if(action==="/status"){
      return respond({watches:Object.values(watches)
        .filter(w=>w.ownerId===ownerId).map(w=>({watchId:w.watchId,trainNumber:w.trainNumber,
          from:w.from,to:w.to,startsAt:w.startsAt,expires:w.expires}))});
    }
    return fail("not found",404);
  }
  async alarm() {
    const now=Date.now();
    const watches=await this.load();
    let changed=false;
    for(const [key,w] of Object.entries(watches)){
      if(w.expires<=now||w.serviceDate!==CORE.serviceDateKey(now)||
         !isServiceDay(now)||w.attempts>=3 && w.nextRetry<=now){
        delete watches[key];changed=true;
      }
    }
    const active=Object.values(watches).filter(w=>w.startsAt<=now &&
      w.expires>now && w.nextRetry<=now);
    if(!active.length){
      await this.save(watches);return;
    }
    // One coordinator, two shared upstream requests for all active commuters.
    let byTrip={};
    try{
      const [vehicle,updates]=await Promise.all([
        fetchFeed("VehiclePositionFeed"),fetchFeed("TripUpdateFeed")
      ]);
      byTrip=liveIndex(CORE.assemble(vehicle,updates).trains);
    }catch{
      // The schedule stays authoritative when a live feed cannot be fetched.
      byTrip={};
    }
    const history=await this.ctx.storage.get("deviations")||{};
    const delivered=await this.ctx.storage.get("delivered")||{};
    for(const [key,until] of Object.entries(delivered))
      if(until<=now) delete delivered[key];
    for(const w of active){
      const train=byTrip[w.tripId];
      const deviation=train?.schedDev;
      if(train&&!train.ghost&&!train.signalLost&&Number.isFinite(deviation)&&
         Number.isFinite(train.ts)&&now-train.ts<=5*60000&&now-train.ts>=-60000){
        const snapshots=(history[w.tripId]||[]).filter(([at])=>now-at<=12*60000);
        if(!snapshots.length||now-snapshots[snapshots.length-1][0]>=60000){
          snapshots.push([now,deviation/60000]);
        }
        history[w.tripId]=snapshots.slice(-12);
      }
      const forecast=forecastWatch(w,now,byTrip,history);
      const key=w.ownerId+":"+w.watchId;
      if(forecast.state==="departed"||forecast.state==="no-service"||
         forecast.state==="invalid-train"){
        delete watches[key];changed=true;continue;
      }
      if(forecast.state!=="leave-now") continue;
      // FCM uses a stable message ID/collapse key. DO alarms are at-least-once,
      // so exactly-once device delivery cannot be guaranteed.
      const outcome=await sendLeaveNow(this.env,w,forecast);
      if(outcome.ok||outcome.invalid){
        if(outcome.ok) delivered[key]=w.scheduled+45*60000;
        delete watches[key];
      }else{
        watches[key]={...w,attempts:w.attempts+1,nextRetry:now+60000};
      }
      changed=true;
    }
    for(const id of Object.keys(history)){
      if(!Object.values(watches).some(w=>w.tripId===id)) delete history[id];
    }
    await this.ctx.storage.put("deviations",history);
    await this.ctx.storage.put("delivered",delivered);
    await this.save(watches);
  }
}
// This preview-only gateway must never have its token hard-coded into Android.
export default {
  async fetch(req,env) {
    const path=new URL(req.url).pathname;
    if(req.method==="GET"&&path==="/health")
      return respond({service:"commute-monitor",enabled:fcmConfigured(env),version:1});
    const secret=env.MONITOR_GATEWAY_TOKEN;
    if(typeof secret!=="string"||secret.length<32) return fail("gateway not configured",503);
    const given=req.headers.get("authorization")?.replace(/^Bearer /i,"");
    if(!secureMatch(given,secret)) return fail("unauthorized",401);
    const paths={
      "POST /v1/watches":"/subscribe",
      "DELETE /v1/watches":"/cancel",
      "POST /v1/watches/cancel-all":"/cancel-owner",
      "POST /v1/watches/status":"/status"
    };
    const internal=paths[req.method+" "+path];
    if(!internal)return fail("not found",404);
    if(internal==="/subscribe"&&!fcmConfigured(env))return fail("FCM delivery not configured",503);
    if(!env.COMMUTE_MONITOR)return fail("Durable Object not configured",503);
    const stub=env.COMMUTE_MONITOR.get(
      env.COMMUTE_MONITOR.idFromName("shared-active-commutes"));
    return stub.fetch(new Request("https://coordinator.internal"+internal,{
      method:"POST",headers:{"content-type":"application/json"},
      body:await req.text()
    }));
  }
};
