// Cloudflare Workers FCM HTTP v1 adapter. Secrets never appear in logs or client code.
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const tokenCache = new Map();
const encoder = new TextEncoder();
const base64url = bytes => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const bytes = x => encoder.encode(x);
function serviceAccount(env) {
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return null;
  try {
    const key = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
    if (!/^[a-z][a-z0-9-]{3,80}$/.test(key.project_id || "") ||
        typeof key.client_email !== "string" ||
        !key.client_email.endsWith(".gserviceaccount.com") ||
        typeof key.private_key !== "string" || !key.private_key.includes("BEGIN PRIVATE KEY")) return null;
    return key;
  } catch { return null; }
}
export const configured = env => serviceAccount(env) !== null;
function derToBytes(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}
async function accessToken(env, fetcher = fetch, now = Date.now()) {
  const account = serviceAccount(env);
  if (!account) throw new Error("FCM not configured");
  const cached = tokenCache.get(account.client_email);
  if (cached && cached.until > now + 60000) return cached.token;
  const issuedAt = Math.floor(now / 1000);
  const header = base64url(bytes(JSON.stringify({alg:"RS256",typ:"JWT"})));
  const body = base64url(bytes(JSON.stringify({
    iss:account.client_email,scope:SCOPE,aud:"https://oauth2.googleapis.com/token",
    iat:issuedAt,exp:issuedAt+3600
  })));
  const key = await crypto.subtle.importKey("pkcs8",derToBytes(account.private_key),
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,bytes(header+"."+body)));
  const jwt = header+"."+body+"."+base64url(sig);
  const response = await fetcher("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:jwt})
  });
  if (!response.ok) throw new Error("FCM token exchange failed: "+response.status);
  const token = await response.json();
  if (typeof token.access_token !== "string" || !token.access_token) throw new Error("FCM token response missing");
  tokenCache.set(account.client_email,{token:token.access_token,until:now+Math.min(3500,Number(token.expires_in)||3500)*1000});
  return token.access_token;
}
/** Returns {ok,invalid,retry}. Never exposes registration tokens or credentials. */
export async function sendLeaveNow(env, watch, forecast, fetcher = fetch, now = Date.now()) {
  const account = serviceAccount(env);
  if (!account) return {ok:false,invalid:false,retry:true};
  try {
    const token = await accessToken(env, fetcher, now);
    const title = "Leave now for train " + watch.trainNumber;
    const body = "Head to " + watch.boardingName + " · train " + watch.trainNumber +
      " departs about " + new Intl.DateTimeFormat("en-US",{
        timeZone:"America/New_York",hour:"numeric",minute:"2-digit"
      }).format(forecast.departure) + ".";
    const response = await fetcher(
      "https://fcm.googleapis.com/v1/projects/"+encodeURIComponent(account.project_id)+"/messages:send",{
        method:"POST",
        headers:{"authorization":"Bearer "+token,"content-type":"application/json"},
        body:JSON.stringify({message:{
          token:watch.fcmToken,
          // Data-only delivery is intentional: Android's FirebaseMessagingService
          // must check current global consent and trip status before displaying.
          // An OS-rendered notification payload could bypass a recent opt-out.
          data:{kind:"leave_now",title,body,watchId:watch.watchId,
            trainNumber:watch.trainNumber,stationCode:watch.from,
            serviceDate:watch.serviceDate},
          android:{priority:"HIGH",collapse_key:watch.watchId,ttl:"120s"}
        }})
      });
    if (response.ok) return {ok:true,invalid:false,retry:false};
    const invalid = response.status===404 || response.status===410;
    return {ok:false,invalid,retry:!invalid};
  } catch {
    return {ok:false,invalid:false,retry:true};
  }
}
