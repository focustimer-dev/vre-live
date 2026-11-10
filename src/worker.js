var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
import HTML from "./index.html";
import SW_JS from "./sw.txt";
import ICON_SVG from "./icon.svg";

// manifest.json
var manifest_default = {
  name: "VRE Live",
  short_name: "VRE",
  description: "Live Virginia Railway Express train tracker: real-time map, schedule, and arrival alerts.",
  id: "./",
  start_url: "./?source=pwa",
  scope: "./",
  display: "standalone",
  display_override: ["standalone", "minimal-ui"],
  orientation: "portrait",
  background_color: "#09090b",
  theme_color: "#09090b",
  icons: [
    { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }
  ]
};

// core.js
(function(g) {
  "use strict";
  function varint(b, st) {
    let x = 0n, s = 0n;
    for (; ; ) {
      const byte = b[st.p++];
      x |= BigInt(byte & 127) << s;
      if (!(byte & 128)) break;
      s += 7n;
    }
    return x;
  }
  __name(varint, "varint");
  const TD = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
  function decodeStr(u8) {
    if (TD) return TD.decode(u8);
    let s = "";
    for (const c of u8) s += String.fromCharCode(c);
    return s;
  }
  __name(decodeStr, "decodeStr");
  function parse(b, schema) {
    const st = { p: 0 }, out = {};
    while (st.p < b.length) {
      const key = Number(varint(b, st)), f = key >> 3, wt = key & 7;
      let raw;
      if (wt === 0) raw = varint(b, st);
      else if (wt === 1) {
        raw = b.subarray(st.p, st.p + 8);
        st.p += 8;
      } else if (wt === 2) {
        const n = Number(varint(b, st));
        raw = b.subarray(st.p, st.p + n);
        st.p += n;
      } else if (wt === 5) {
        raw = b.subarray(st.p, st.p + 4);
        st.p += 4;
      } else break;
      const fs = schema[f];
      if (!fs) continue;
      const [name, type, sub, rep] = fs;
      let v;
      if (type === "str") v = decodeStr(raw);
      else if (type === "uint") v = Number(raw);
      else if (type === "int") v = Number(BigInt.asIntN(64, raw));
      else if (type === "float") v = new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true);
      else if (type === "msg") v = parse(raw, sub);
      if (rep) (out[name] || (out[name] = [])).push(v);
      else out[name] = v;
    }
    return out;
  }
  __name(parse, "parse");
  const S_POS = { 1: ["lat", "float"], 2: ["lon", "float"], 3: ["bearing", "float"], 5: ["speed", "float"] };
  const S_VD = { 1: ["id", "str"], 2: ["label", "str"] };
  const S_TDSC = { 1: ["tripId", "str"], 3: ["serviceDate", "str"], 5: ["routeId", "str"], 6: ["dir", "uint"] };
  const S_STE = { 1: ["delay", "int"], 2: ["time", "uint"] };
  const S_STU = { 1: ["seq", "uint"], 2: ["arrival", "msg", S_STE], 3: ["departure", "msg", S_STE], 4: ["stopId", "str"] };
  const S_TU = { 1: ["trip", "msg", S_TDSC], 2: ["stops", "msg", S_STU, true], 3: ["vehicle", "msg", S_VD], 4: ["ts", "uint"] };
  const S_VP = { 1: ["trip", "msg", S_TDSC], 2: ["pos", "msg", S_POS], 3: ["curSeq", "uint"], 4: ["status", "uint"], 5: ["ts", "uint"], 7: ["stopId", "str"], 8: ["vehicle", "msg", S_VD] };
  const S_TRNSL = { 1: ["text", "str"], 2: ["lang", "str"] };
  const S_TSTR = { 1: ["tr", "msg", S_TRNSL, true] };
  const S_RANGE = { 1: ["start", "uint"], 2: ["end", "uint"] };
  const S_ESEL = { 1: ["agency", "str"], 2: ["routeId", "str"], 5: ["stopId", "str"] };
  const S_ALERT = {
    1: ["period", "msg", S_RANGE, true],
    5: ["entities", "msg", S_ESEL, true],
    6: ["cause", "uint"],
    7: ["effect", "uint"],
    10: ["header", "msg", S_TSTR],
    11: ["desc", "msg", S_TSTR]
  };
  const S_ENT = { 1: ["id", "str"], 3: ["tripUpdate", "msg", S_TU], 4: ["vehicle", "msg", S_VP], 5: ["alert", "msg", S_ALERT] };
  const S_FEED = { 1: ["header", "msg", { 1: ["version", "str"], 3: ["ts", "uint"] }], 2: ["entity", "msg", S_ENT, true] };
  function parseFeed(u8) {
    return parse(u8, S_FEED);
  }
  __name(parseFeed, "parseFeed");
  const EFFECTS = {
    1: "No service",
    2: "Reduced service",
    3: "Significant delays",
    4: "Detour",
    5: "Additional service",
    6: "Modified service",
    7: "Alert",
    8: "Alert",
    9: "Stop moved"
  };
  const firstText = /* @__PURE__ */ __name((ts) => (ts && ts.tr && ts.tr.length ? ts.tr[0].text : "") || "", "firstText");
  function parseAlerts(u8, nowMs) {
    const feed2 = parseFeed(u8), out = [];
    for (const e of feed2.entity || []) {
      if (!e.alert) continue;
      const a = e.alert;
      const active = !(a.period || []).length || (a.period || []).some((p) => (!p.start || p.start * 1e3 <= nowMs) && (!p.end || p.end * 1e3 >= nowMs));
      if (!active) continue;
      out.push({
        header: firstText(a.header),
        desc: firstText(a.desc),
        effect: EFFECTS[a.effect] || "Alert",
        routes: [...new Set((a.entities || []).map((s) => s.routeId).filter(Boolean))]
      });
    }
    return out;
  }
  __name(parseAlerts, "parseAlerts");
  const KX = Math.cos(38.6 * Math.PI / 180) * 111, KY = 111;
  const geo = /* @__PURE__ */ __name((lat, lon) => [(lon + 77.6) * KX, (38.95 - lat) * KY], "geo");
  const STATIONS = {
    "01": { name: "Union Station", lat: 38.89955, lon: -77.00472, x: 170, y: 40 },
    "02": { name: "L'Enfant", lat: 38.88559, lon: -77.0212, x: 170, y: 90 },
    "03": { name: "Crystal City", lat: 38.85972, lon: -77.04827, x: 170, y: 140 },
    "04": { name: "Alexandria", lat: 38.80618, lon: -77.06249, x: 170, y: 190 },
    "05": { name: "Franconia / Springfield", lat: 38.76615, lon: -77.16812, x: 208, y: 244 },
    "06": { name: "Lorton", lat: 38.71567, lon: -77.21387, x: 222, y: 296 },
    "07": { name: "Woodbridge", lat: 38.65935, lon: -77.248, x: 232, y: 348 },
    "08": { name: "Rippon", lat: 38.61237, lon: -77.25349, x: 239, y: 400 },
    "09": { name: "Quantico", lat: 38.52169, lon: -77.29323, x: 244, y: 452 },
    "0A": { name: "Brooke", lat: 38.38725, lon: -77.38128, x: 248, y: 504 },
    "0B": { name: "Leeland Road", lat: 38.34707, lon: -77.43782, x: 251, y: 552 },
    "0C": { name: "Fredericksburg", lat: 38.29825, lon: -77.45683, x: 253, y: 600 },
    "SP": { name: "Spotsylvania", lat: 38.22099, lon: -77.44081, x: 254, y: 648 },
    "0D": { name: "Backlick Road", lat: 38.79699, lon: -77.18407, x: 128, y: 244 },
    "0E": { name: "Rolling Road", lat: 38.79465, lon: -77.25847, x: 112, y: 294 },
    "0F": { name: "Burke Centre", lat: 38.79743, lon: -77.29874, x: 102, y: 344 },
    "10": { name: "Manassas Park", lat: 38.76596, lon: -77.4403, x: 96, y: 394 },
    "11": { name: "Manassas", lat: 38.75022, lon: -77.4725, x: 92, y: 444 },
    "12": { name: "Broad Run", lat: 38.72967, lon: -77.52548, x: 90, y: 494 }
  };
  const LINE_F = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "0A", "0B", "0C", "SP"];
  const LINE_M = ["01", "02", "03", "04", "0D", "0E", "0F", "10", "11", "12"];
  (/* @__PURE__ */ __name((function layoutStationY() {
    const TOP = 40, BOTTOM = 648, MIN_GAP = 24;
    const seg = /* @__PURE__ */ __name((a, b) => {
      const [ax, ay] = geo(STATIONS[a].lat, STATIONS[a].lon);
      const [bx, by] = geo(STATIONS[b].lat, STATIONS[b].lon);
      return Math.hypot(bx - ax, by - ay);
    }, "seg");
    const cumOf = /* @__PURE__ */ __name((codes) => {
      const cum = [0];
      for (let i = 1; i < codes.length; i++) cum.push(cum[i - 1] + seg(codes[i - 1], codes[i]));
      return cum;
    }, "cumOf");
    const cumF = cumOf(LINE_F), cumM = cumOf(LINE_M);
    const k = (BOTTOM - TOP) / cumF[cumF.length - 1];
    const place = /* @__PURE__ */ __name((codes, cum, startIdx, prevY) => {
      for (let i = startIdx; i < codes.length; i++) {
        let y = TOP + cum[i] * k;
        if (y < prevY + MIN_GAP) y = prevY + MIN_GAP;
        STATIONS[codes[i]].y = Math.round(y * 10) / 10;
        prevY = STATIONS[codes[i]].y;
      }
    }, "place");
    place(LINE_F, cumF, 0, -Infinity);
    place(LINE_M, cumM, 4, STATIONS["04"].y);
  }), "layoutStationY"))();
  const CHILD2PARENT = {
    "61B844E260F84E6491D36828C23BF315": "01",
    "9C3AF7FD9F3843009D8FA87B696ACD1C": "01",
    "C845754982F24984973E6058D0E71E36": "01",
    "3C34A3D06AB2428FA788DF48D0E1B2EB": "01",
    "BE7E92139CCE44D0B490765E8234AF12": "01",
    "C021E5A6B55443808121B5A69912A97B": "01",
    "4018AAE5BB1149EE86028B65709402D7": "01",
    "C9C9EEB6CE1A46C3BD0901F3F225933E": "01",
    "C6034C15ACE1455F9E34995B6B30B6C5": "02",
    "BDF2C51AB16C4FF8A80F7D9566B983E2": "02",
    "BC30329248DF4E6E8A114C0822124408": "02",
    "4D1AD5D9903F4836984FF58680D1E950": "03",
    "96903F54359A47858D9D2F20F7AC4142": "03",
    "8E0AECA660E44BA39BDF374FF1D09F96": "03",
    "1E66EEF0911344ACB3B67E230A99DB81": "04",
    "60ADB9309B084464BBCC2C1ABCD908E8": "04",
    "26C502B2E36D484DA6376618E6600DAF": "04",
    "B0B4F69638D547C988E9A71DB08D3BBC": "05",
    "97C6F255492446709194E799A5740CF5": "05",
    "86470B019FB24F4E9102A97F07848105": "06",
    "D683386639434BF7BBC2D41403B3001D": "06",
    "7113724B905946399163A4CB5AAB66A1": "07",
    "16A7F4BA1723417DA6545F754F79F729": "07",
    "BD92F07447C74C9DA620D889725EF244": "08",
    "0F47F802F2004EF384F10B91F1615E35": "08",
    "9B185FE9D08F4766A8CC6B76F2679FC0": "09",
    "34EA179D31FE4CA5A9A5A42D9CCE8156": "09",
    "63707409C20540DBACC2808A7306AE61": "09",
    "5E1E78E6CA654F5AA0E2FE485DA71495": "0A",
    "27D4B760CFDB475FAE6E66C760D64442": "0A",
    "E67A53B0B9AB4E619C21D7C16C034501": "0B",
    "3DF85DC91869485ABF7092EDF02ACB01": "0B",
    "62E201E23B5148898D8B3B73B9395B4B": "0C",
    "4B775E26C3324833BF59FB8A7ADE413D": "0C",
    "888D000A2C144719ADBAD01EBDE23428": "SP",
    "078CADB54DE04AA996C133AEDEE8BB5F": "SP",
    "F94650F367DD4D28AB4648C95746AFA6": "0D",
    "F97647CBCBB9473BA0AA6A1F3690AC40": "0D",
    "7E1B4F506A5B47B7A2C858934721BE5A": "0E",
    "6D12B7A7A44D4306AEC820AE68D7D775": "0E",
    "9500D42D80744F9499D42D654CA522E6": "0F",
    "AB34353A4B534F0A947855570C20511D": "0F",
    "A0F9D1776F1A485A9E1A06A3C1261782": "10",
    "1D840A897ECF4C77BA7E9886A0AC589F": "10",
    "64C983C0E74E491488B298F46879C65A": "11",
    "09598BFBF81A44E595DA4F1E71BFD7E1": "11",
    "5BDF306E0863449AA3D02CF2C406BD05": "12",
    "1555D7C62D784D6B9F2AD871999E0098": "12"
  };
  function resolveStop(id) {
    if (!id) return null;
    const up = id.toUpperCase();
    if (CHILD2PARENT[up]) return CHILD2PARENT[up];
    if (id.toLowerCase() === "dc8e2e569500000066c00b02130a0000") return "SP";
    const m = up.match(/^0{30}([0-9A-F]{2})$/);
    if (m && STATIONS[m[1]]) return m[1];
    return null;
  }
  __name(resolveStop, "resolveStop");
  const _lineCache = {};
  function lineData(routeId) {
    const key = routeId === "4" ? "M" : "F";
    if (_lineCache[key]) return _lineCache[key];
    const codes = key === "M" ? LINE_M : LINE_F;
    const pts = codes.map((c) => geo(STATIONS[c].lat, STATIONS[c].lon));
    const cum = [0];
    for (let i = 1; i < pts.length; i++)
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const dist = {};
    codes.forEach((c, i) => {
      dist[c] = cum[i];
    });
    return _lineCache[key] = { codes, pts, cum, dist };
  }
  __name(lineData, "lineData");
  function locate(routeId, lat, lon) {
    const { codes, pts, cum } = lineData(routeId);
    const [px, py] = geo(lat, lon);
    let best = { d: Infinity, i: 0, t: 0 };
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      if (d < best.d) best = { d, i, t };
    }
    const A = STATIONS[codes[best.i]], B = STATIONS[codes[best.i + 1]];
    return {
      x: A.x + (B.x - A.x) * best.t,
      y: A.y + (B.y - A.y) * best.t,
      dist: cum[best.i] + best.t * (cum[best.i + 1] - cum[best.i])
    };
  }
  __name(locate, "locate");
  function projectXY(routeId, lat, lon) {
    const { x, y } = locate(routeId, lat, lon);
    return { x, y };
  }
  __name(projectXY, "projectXY");
  function estimateDelay(routeId, lat, lon, tsMs, stops) {
    if (!tsMs || !stops || stops.length < 2) return null;
    const { dist } = locate(routeId, lat, lon);
    const D = lineData(routeId).dist;
    const ds = stops.map((s) => D[s.code]);
    let expected = null;
    for (let k = 0; k < stops.length - 1; k++) {
      const a = ds[k], b = ds[k + 1];
      if (a === b || a == null || b == null) continue;
      const f = (dist - a) / (b - a);
      if (f >= 0 && f <= 1) {
        expected = stops[k].time + f * (stops[k + 1].time - stops[k].time);
        break;
      }
    }
    if (expected == null) {
      if (Math.abs(dist - ds[0]) <= Math.abs(dist - ds[ds.length - 1])) expected = stops[0].time;
      else return { dev: 0, expected: stops[stops.length - 1].time };
    }
    const dev = Math.max(0, Math.min(tsMs - expected, 4 * 3600 * 1e3));
    return { dev, expected };
  }
  __name(estimateDelay, "estimateDelay");
  const STATUS = ["Approaching", "Stopped at", "En route to"];
  function assemble(vehBytes, tuBytes) {
    const vf = parseFeed(vehBytes), tf = parseFeed(tuBytes);
    const updates = {};
    for (const e of tf.entity || []) {
      if (!e.tripUpdate) continue;
      const tu = e.tripUpdate;
      const stops = (tu.stops || []).map((s) => {
        const code = resolveStop(s.stopId);
        const ev = s.arrival && s.arrival.time ? s.arrival : s.departure;
        return {
          code,
          seq: s.seq || 0,
          name: code ? STATIONS[code].name : s.stopId,
          time: ev && ev.time ? ev.time * 1e3 : null,
          delay: ev && typeof ev.delay === "number" ? ev.delay : null
        };
      }).filter((s) => s.code && s.time);
      updates[tu.trip && tu.trip.tripId] = stops;
    }
    const trains = [];
    for (const e of vf.entity || []) {
      if (!e.vehicle || !e.vehicle.pos) continue;
      const v = e.vehicle, tripId = v.trip && v.trip.tripId;
      const routeId = v.trip && v.trip.routeId || "2";
      const stops = updates[tripId] || [];
      const schedDir = v.trip && v.trip.dir != null ? v.trip.dir : DIR_BY_TRIP[tripId];
      const ts = v.ts ? v.ts * 1e3 : null;
      let adjStops = stops, schedDev = 0;
      const est = stops.length >= 2 ? estimateDelay(routeId, v.pos.lat, v.pos.lon, ts || Date.now(), stops) : null;
      if (est && est.dev > 3e4) {
        schedDev = est.dev;
        adjStops = stops.map((s) => s.time >= est.expected - 6e4 ? { ...s, sched: s.time, time: s.time + est.dev, delay: (s.delay || 0) + Math.round(est.dev / 1e3) } : s);
      }
      trains.push({
        num: e.id,
        serviceDate: v.trip && v.trip.serviceDate, routeKnown: !!(v.trip && v.trip.routeId),
        tripId,
        routeId,
        dir: schedDir !== void 0 ? schedDir : parseInt(e.id, 10) % 2 === 0 ? 1 : 0,
        // 1 = toward DC
        line: routeId === "4" ? "M" : "F",
        lineName: routeId === "4" ? "Manassas Line" : "Fredericksburg Line",
        label: v.vehicle && v.vehicle.label || "",
        lat: v.pos.lat,
        lon: v.pos.lon,
        bearing: v.pos.bearing || 0,
        speedMs: v.pos.speed != null ? v.pos.speed : null,
        mph: v.pos.speed != null ? Math.round(v.pos.speed * 2.23694) : null,
        status: typeof v.status === "number" ? STATUS[v.status] : null,
        nextStop: resolveStop(v.stopId),
        ts,
        stops: adjStops,
        schedDev,
        headsign: adjStops.length ? adjStops[adjStops.length - 1].name : null,
        ...projectXY(routeId, v.pos.lat, v.pos.lon)
      });
    }
    trains.sort((a, b) => a.num.localeCompare(b.num));
    return { trains: reconcileTrains(trains), feedTs: vf.header && vf.header.ts ? vf.header.ts * 1e3 : null };
  }
  __name(assemble, "assemble");
  const SCHEDULE = { "trips": [{ "num": "300", "trip": "300-Regular", "line": "F", "dir": 1, "head": "Union Station", "stops": [["SP", 292], ["0C", 303], ["0B", 310], ["0A", 316], ["07", 338], ["04", 361], ["03", 374], ["02", 382], ["01", 390]] }, { "num": "322", "trip": "322-Regular", "line": "M", "dir": 1, "head": "Union Station", "stops": [["12", 301], ["11", 309], ["10", 315], ["0F", 329], ["0E", 334], ["0D", 342], ["04", 355], ["03", 364], ["02", 372], ["01", 380]] }, { "num": "302", "trip": "302-Regular", "line": "F", "dir": 1, "head": "Union Station", "stops": [["SP", 306], ["0C", 317], ["0B", 324], ["0A", 330], ["09", 342], ["08", 351], ["07", 358], ["06", 365], ["05", 373], ["04", 385], ["03", 394], ["02", 402], ["01", 410]] }, { "num": "304", "trip": "304-Regular", "line": "F", "dir": 1, "head": "Union Station", "stops": [["SP", 321], ["0C", 332], ["0B", 339], ["0A", 345], ["09", 357], ["08", 366], ["07", 373], ["06", 380], ["05", 388], ["04", 400], ["03", 409], ["02", 417], ["01", 425]] }, { "num": "324", "trip": "324-Regular", "line": "M", "dir": 1, "head": "Union Station", "stops": [["12", 321], ["11", 329], ["10", 335], ["0F", 349], ["0E", 354], ["0D", 362], ["04", 375], ["03", 384], ["02", 392], ["01", 400]] }, { "num": "306", "trip": "306-Regular", "line": "F", "dir": 1, "head": "Union Station", "stops": [["SP", 341], ["0C", 352], ["0B", 359], ["0A", 365], ["09", 377], ["08", 386], ["07", 393], ["06", 400], ["05", 408], ["04", 420], ["03", 429], ["02", 437], ["01", 445]] }, { "num": "326", "trip": "326-Regular", "line": "M", "dir": 1, "head": "Union Station", "stops": [["12", 356], ["11", 364], ["10", 370], ["0F", 384], ["0E", 389], ["0D", 397], ["04", 410], ["03", 419], ["02", 427], ["01", 435]] }, { "num": "308", "trip": "308-Regular", "line": "F", "dir": 1, "head": "Union Station", "stops": [["SP", 361], ["0C", 372], ["0B", 379], ["0A", 385], ["09", 397], ["08", 406], ["07", 413], ["06", 420], ["05", 428], ["04", 440], ["03", 449], ["02", 457], ["01", 465]] }, { "num": "328", "trip": "328-Regular", "line": "M", "dir": 1, "head": "Union Station", "stops": [["12", 376], ["11", 384], ["10", 390], ["0F", 404], ["0E", 409], ["0D", 417], ["04", 430], ["03", 439], ["02", 447], ["01", 455]] }, { "num": "310", "trip": "310-Regular", "line": "F", "dir": 1, "head": "Union Station", "stops": [["SP", 386], ["0C", 397], ["0B", 404], ["0A", 410], ["09", 422], ["08", 431], ["07", 438], ["06", 445], ["05", 453], ["04", 465], ["03", 474], ["02", 482], ["01", 490]] }, { "num": "321", "trip": "321-Regular", "line": "M", "dir": 0, "head": "Broad Run", "stops": [["01", 395], ["04", 412], ["11", 457], ["12", 467]] }, { "num": "330", "trip": "330-Regular", "line": "M", "dir": 1, "head": "Union Station", "stops": [["12", 401], ["11", 409], ["10", 415], ["0F", 429], ["0E", 434], ["0D", 442], ["04", 455], ["03", 464], ["02", 472], ["01", 480]] }, { "num": "312", "trip": "312-Regular", "line": "F", "dir": 1, "head": "Alexandria", "stops": [["SP", 426], ["0C", 437], ["0B", 444], ["0A", 450], ["09", 462], ["08", 471], ["07", 478], ["06", 485], ["05", 493], ["04", 505]] }, { "num": "332", "trip": "332-Regular", "line": "M", "dir": 1, "head": "Alexandria", "stops": [["12", 441], ["11", 449], ["10", 455], ["0F", 469], ["0E", 474], ["0D", 482], ["04", 495]] }, { "num": "314", "trip": "314-Regular", "line": "F", "dir": 1, "head": "Alexandria", "stops": [["SP", 466], ["0C", 477], ["0B", 484], ["0A", 490], ["09", 502], ["08", 511], ["07", 518], ["06", 525], ["05", 533], ["04", 545]] }, { "num": "334", "trip": "334-Regular", "line": "M", "dir": 1, "head": "Alexandria", "stops": [["12", 481], ["11", 489], ["10", 495], ["0F", 509], ["0E", 514], ["0D", 522], ["04", 535]] }, { "num": "325", "trip": "325-Regular", "line": "M", "dir": 0, "head": "Broad Run", "stops": [["01", 810], ["02", 818], ["03", 825], ["04", 833], ["0D", 844], ["0E", 852], ["0F", 858], ["10", 872], ["11", 879], ["12", 889]] }, { "num": "301", "trip": "301-Regular", "line": "F", "dir": 0, "head": "Spotsylvania", "stops": [["04", 838], ["05", 849], ["06", 856], ["07", 864], ["08", 870], ["09", 882], ["0A", 901], ["0B", 910], ["0C", 918], ["SP", 931]] }, { "num": "303", "trip": "303-Regular", "line": "F", "dir": 0, "head": "Spotsylvania", "stops": [["01", 900], ["02", 908], ["03", 915], ["04", 923], ["05", 934], ["06", 941], ["07", 949], ["08", 955], ["09", 967], ["0A", 986], ["0B", 995], ["0C", 1003], ["SP", 1016]] }, { "num": "327", "trip": "327-Regular", "line": "M", "dir": 0, "head": "Broad Run", "stops": [["01", 920], ["02", 928], ["03", 935], ["04", 943], ["0D", 954], ["0E", 962], ["0F", 968], ["10", 982], ["11", 989], ["12", 999]] }, { "num": "336", "trip": "336-Regular", "line": "M", "dir": 1, "head": "Union Station", "stops": [["12", 928], ["11", 936], ["10", 942], ["0F", 956], ["04", 982], ["01", 1007]] }, { "num": "305", "trip": "305-Regular", "line": "F", "dir": 0, "head": "Spotsylvania", "stops": [["04", 953], ["05", 964], ["06", 971], ["07", 979], ["08", 985], ["09", 997], ["0A", 1016], ["0B", 1025], ["0C", 1033], ["SP", 1046]] }, { "num": "307", "trip": "307-Regular", "line": "F", "dir": 0, "head": "Spotsylvania", "stops": [["01", 960], ["02", 968], ["03", 975], ["04", 983], ["05", 994], ["06", 1001], ["07", 1009], ["08", 1015], ["09", 1027], ["0A", 1046], ["0B", 1055], ["0C", 1063], ["SP", 1076]] }, { "num": "329", "trip": "329-Regular", "line": "M", "dir": 0, "head": "Broad Run", "stops": [["01", 970], ["02", 978], ["03", 985], ["04", 993], ["0D", 1004], ["0E", 1012], ["0F", 1018], ["10", 1032], ["11", 1039], ["12", 1049]] }, { "num": "309", "trip": "309-Regular", "line": "F", "dir": 0, "head": "Spotsylvania", "stops": [["01", 1e3], ["02", 1008], ["03", 1015], ["04", 1023], ["05", 1034], ["06", 1041], ["07", 1049], ["08", 1055], ["09", 1067], ["0A", 1086], ["0B", 1095], ["0C", 1103], ["SP", 1116]] }, { "num": "331", "trip": "331-Regular", "line": "M", "dir": 0, "head": "Broad Run", "stops": [["01", 1030], ["02", 1038], ["03", 1045], ["04", 1053], ["0D", 1064], ["0E", 1072], ["0F", 1078], ["10", 1092], ["11", 1099], ["12", 1109]] }, { "num": "333", "trip": "333-Regular", "line": "M", "dir": 0, "head": "Broad Run", "stops": [["01", 1050], ["02", 1058], ["03", 1065], ["04", 1073], ["0D", 1084], ["0E", 1092], ["0F", 1098], ["10", 1112], ["11", 1119], ["12", 1129]] }, { "num": "311", "trip": "311-Regular", "line": "F", "dir": 0, "head": "Spotsylvania", "stops": [["04", 1063], ["05", 1074], ["06", 1081], ["07", 1089], ["08", 1095], ["09", 1107], ["0A", 1126], ["0B", 1135], ["0C", 1143], ["SP", 1156]] }, { "num": "335", "trip": "335-Regular", "line": "M", "dir": 0, "head": "Broad Run", "stops": [["01", 1080], ["02", 1088], ["03", 1095], ["04", 1103], ["0D", 1114], ["0E", 1122], ["0F", 1128], ["10", 1142], ["11", 1149], ["12", 1159]] }, { "num": "313", "trip": "313-Regular", "line": "F", "dir": 0, "head": "Spotsylvania", "stops": [["01", 1090], ["02", 1098], ["03", 1105], ["04", 1113], ["05", 1124], ["06", 1131], ["07", 1139], ["08", 1145], ["09", 1155], ["0A", 1169], ["0B", 1178], ["0C", 1186], ["SP", 1197]] }, { "num": "315", "trip": "315-Regular", "line": "F", "dir": 0, "head": "Spotsylvania", "stops": [["01", 1130], ["02", 1138], ["03", 1145], ["04", 1153], ["05", 1164], ["06", 1171], ["07", 1179], ["08", 1185], ["09", 1195], ["0A", 1209], ["0B", 1218], ["0C", 1226], ["SP", 1237]] }, { "num": "337", "trip": "337-Regular", "line": "M", "dir": 0, "head": "Broad Run", "stops": [["01", 1140], ["02", 1148], ["03", 1155], ["04", 1163], ["0D", 1174], ["0E", 1182], ["0F", 1188], ["10", 1202], ["11", 1209], ["12", 1219]] }], "noService": ["20260907", "20261012"] };
  const DIR_BY_TRIP = Object.fromEntries(SCHEDULE.trips.map((t) => [t.trip, t.dir]));
  function isServiceDay(d) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return false;
    const ymd = String(d.getFullYear() * 1e4 + (d.getMonth() + 1) * 100 + d.getDate());
    return !SCHEDULE.noService.includes(ymd);
  }
  __name(isServiceDay, "isServiceDay");
  function scheduleRows(now, liveByTrip) {
    const d = new Date(now);
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const service = isServiceDay(d);
    return SCHEDULE.trips.map((t) => {
      const first = midnight + t.stops[0][1] * 6e4;
      const last = midnight + t.stops[t.stops.length - 1][1] * 6e4;
      const live = liveByTrip && liveByTrip[t.trip] || null;
      let status;
      if (live) status = "live";
      else if (!service) status = "none";
      else if (now > last + 20 * 6e4) status = "done";
      else if (now < first) status = "soon";
      else status = "quiet";
      return { ...t, first, last, live, status };
    }).sort((a, b) => a.first - b.first);
  }
  __name(scheduleRows, "scheduleRows");
  function distToXY(routeId, dist) {
    const { codes, cum } = lineData(routeId);
    const d = Math.max(0, Math.min(dist, cum[cum.length - 1]));
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < d) i++;
    const t = (d - cum[i]) / (cum[i + 1] - cum[i] || 1);
    const A = STATIONS[codes[i]], B = STATIONS[codes[i + 1]];
    return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
  }
  __name(distToXY, "distToXY");
  function schedStopsMs(trip, nowMs) {
    const d = new Date(nowMs);
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return trip.stops.map(([code, min]) => ({
      code,
      name: STATIONS[code].name,
      time: midnight + min * 6e4,
      delay: null
    }));
  }
  __name(schedStopsMs, "schedStopsMs");
  function schedPositionNow(trip, nowMs) {
    const stops = schedStopsMs(trip, nowMs);
    if (nowMs < stops[0].time || nowMs > stops[stops.length - 1].time) return null;
    const routeId = trip.line === "M" ? "4" : "2";
    const D = lineData(routeId).dist;
    for (let k = 0; k < stops.length - 1; k++) {
      if (nowMs > stops[k + 1].time) continue;
      const f = (nowMs - stops[k].time) / (stops[k + 1].time - stops[k].time || 1);
      const dist = D[stops[k].code] + f * (D[stops[k + 1].code] - D[stops[k].code]);
      return distToXY(routeId, dist);
    }
    return null;
  }
  __name(schedPositionNow, "schedPositionNow");
  function nextDepartures(fromCode, toCode, nowMs, liveByTrip, count = 3) {
    if (!isServiceDay(new Date(nowMs))) return [];
    const out = [];
    for (const t of SCHEDULE.trips) {
      const iA = t.stops.findIndex((s) => s[0] === fromCode);
      const iB = t.stops.findIndex((s) => s[0] === toCode);
      if (iA < 0 || iB < 0 || iA >= iB) continue;
      const stops = schedStopsMs(t, nowMs);
      const live = liveByTrip && liveByTrip[t.trip];
      let dep = stops[iA].time, arr = stops[iB].time, dev = 0;
      if (live) {
        const lDep = live.stops.find((s) => s.code === fromCode);
        const lArr = live.stops.find((s) => s.code === toCode);
        if (lDep) dep = lDep.time;
        if (lArr) arr = lArr.time;
        dev = live.schedDev || 0;
        if (!lDep && dev) dep += dev;
        if (!lArr && dev) arr += dev;
      }
      if (dep < nowMs - 6e4) continue;
      out.push({ num: t.num, trip: t.trip, line: t.line, head: t.head, dep, arr, dev, live: !!live, ts: live ? live.ts : null });
    }
    out.sort((a, b) => a.dep - b.dep);
    return out.slice(0, count);
  }
  __name(nextDepartures, "nextDepartures");
  function driftPosition(train, nowMs) {
    if (!train.ts || train.speedMs == null || train.speedMs < 2) return null;
    const elapsed = Math.min(nowMs - train.ts, 10 * 6e4);
    if (elapsed < 15e3) return null;
    const { dist } = locate(train.routeId, train.lat, train.lon);
    const D = lineData(train.routeId).dist;
    let km = train.speedMs * elapsed / 1e6;
    const nextCode = train.nextStop || ((train.stops || []).find((s) => s.time > train.ts) || {}).code;
    if (nextCode && D[nextCode] != null) km = Math.min(km, Math.abs(D[nextCode] - dist));
    else km = Math.min(km, 3);
    const target = train.dir === 1 ? dist - km : dist + km;
    return { ...distToXY(train.routeId, target), drifted: km > 0.05 };
  }
  __name(driftPosition, "driftPosition");
  function stationBoard(code, nowMs, liveByTrip, count = 8) {
    if (!isServiceDay(new Date(nowMs))) return [];
    const out = [];
    for (const t of SCHEDULE.trips) {
      const idx = t.stops.findIndex((s) => s[0] === code);
      if (idx < 0) continue;
      const stops = schedStopsMs(t, nowMs);
      const live = liveByTrip && liveByTrip[t.trip];
      let time = stops[idx].time;
      const dev = live ? live.schedDev || 0 : 0;
      if (live) {
        const ls = live.stops.find((s) => s.code === code);
        time = ls ? ls.time : time + dev;
      }
      if (time < nowMs - 6e4) continue;
      out.push({
        num: t.num,
        trip: t.trip,
        line: t.line,
        head: t.head,
        dir: t.dir,
        time,
        dev,
        live: !!live,
        ts: live ? live.ts : null,
        terminus: idx === t.stops.length - 1
      });
    }
    out.sort((a, b) => a.time - b.time);
    return out.slice(0, count);
  }
  __name(stationBoard, "stationBoard");
    // Match feed variants to one scheduled service, shared by UI and alert worker.
  function serviceDateKey(ms) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(ms));
    const get = type => parts.find(p => p.type === type).value;
    return get("year") + get("month") + get("day");
  }
  function reconcileTrains(trains, nowMs = Date.now()) {
    const today = serviceDateKey(nowMs);
    const out = [];
    for (const train of trains) {
      const sourceTripId = train.sourceTripId || train.tripId;
      const current = (!train.serviceDate || train.serviceDate === today)
        && (!train.ts || serviceDateKey(train.ts) === today);
      const compatible = t => t.line === train.line && t.dir === train.dir;
      let scheduled = current && SCHEDULE.trips.find(t => t.trip === sourceTripId && compatible(t));
      if (!scheduled && current && train.routeKnown !== false && (train.serviceDate || train.ts)) {
        const candidates = SCHEDULE.trips.filter(t => String(t.num) === String(train.num) && compatible(t));
        if (candidates.length === 1) scheduled = candidates[0];
      }
      const matched = scheduled ? { ...train, sourceTripId, tripId: scheduled.trip } : train;
      const prior = scheduled && out.findIndex(t => t.tripId === matched.tripId);
      if (scheduled && prior >= 0) {
        if ((matched.ts || 0) > (out[prior].ts || 0)) out[prior] = matched;
      } else out.push(matched);
    }
    return out;
  }
  function liveTrainIndex(trains) {
    const index = Object.create(null);
    for (const train of trains) {
      if (train.tripId) index[train.tripId] = train;
      if (train.sourceTripId) index[train.sourceTripId] = train;
    }
    return index;
  }

  function rideStatus(train, dest, now) {
    const stop = train && (train.stops || []).find(s => s.code === dest);
    if (!stop) return { phase: "unavailable", fresh: false, stop: null };
    const left = stop.time - now;
    const fresh = !train.ghost && !train.signalLost && !!train.ts
      && now - train.ts <= 5 * 60000 && now - train.ts >= -60000;
    if (train.ghost) return { phase: left < -90000 ? "scheduledPast" : left <= 70000 ? "scheduledDue" : "scheduled", fresh: false, stop, left };
    if (!fresh) return { phase: "uncertain", fresh: false, stop, left };
    const destIndex = train.stops.findIndex(s => s.code === dest);
    const nextIndex = train.stops.findIndex(s => s.code === train.nextStop);
    if (nextIndex > destIndex) return { phase: "passed", fresh, stop, left };
    const station = STATIONS[dest];
    const km = station && Number.isFinite(train.lat) && Number.isFinite(train.lon)
      ? Math.hypot((train.lat - station.lat) * 111, (train.lon - station.lon) * 86.8) : Infinity;
    if (train.nextStop === dest && train.status === "Stopped at" && km < 0.5)
      return { phase: "atStop", fresh, stop, left };
    return { phase: left < -90000 ? "waiting" : left <= 70000 ? "due" : "enroute", fresh, stop, left };
  }
  function remainingStops(train, now) {
    const state = rideStatus(train, (train.stops[0] || {}).code, now);
    const index = state.fresh ? train.stops.findIndex(s => s.code === train.nextStop) : -1;
    return index >= 0 ? train.stops.slice(index) : train.stops.filter(s => s.time > now - 60000);
  }

  g.VRECore = { rideStatus, remainingStops, reconcileTrains, liveTrainIndex, serviceDateKey,
    parseFeed,
    parseAlerts,
    assemble,
    resolveStop,
    projectXY,
    estimateDelay,
    distToXY,
    schedStopsMs,
    schedPositionNow,
    nextDepartures,
    stationBoard,
    driftPosition,
    STATIONS,
    LINE_F,
    LINE_M,
    SCHEDULE,
    isServiceDay,
    scheduleRows
  };
})(typeof window !== "undefined" ? window : globalThis);

// worker.js
var UPSTREAM = "https://gtfs.vre.org/containercdngtfsupload/";
var FEEDS = /* @__PURE__ */ new Set(["TripUpdateFeed", "VehiclePositionFeed", "AlertFeed"]);
var HISTORY_FEEDS = /* @__PURE__ */ new Set(["TripUpdateFeed", "VehiclePositionFeed"]);
var HISTORY_MAX = 30;
var FRESH_MS = 65e3;
var STALE_MS = 15 * 6e4;
var COOKIE = "vre_auth";
var mem = {};
var history = {};
function toB64(buf) {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 16384)
    s += String.fromCharCode(...u8.subarray(i, i + 16384));
  return btoa(s);
}
__name(toB64, "toB64");
async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256hex, "sha256hex");
var authToken = /* @__PURE__ */ __name((env) => sha256hex("vre-live-auth-v1:" + env.APP_PASSWORD), "authToken");
function cookies(req) {
  const out = {};
  for (const part of (req.headers.get("Cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
__name(cookies, "cookies");
var LOGIN_CSS = `
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#fafafa;
    font-family:-apple-system,"Segoe UI",Inter,Roboto,system-ui,sans-serif}
  form{width:min(320px,86vw);background:linear-gradient(180deg,#17171b,#101013);border:1px solid #26262b;
    border-radius:16px;padding:26px 24px;text-align:center}
  h1{font-size:18px;margin:0 0 4px;letter-spacing:-.02em}h1 span{margin-right:8px}
  p{color:#a1a1aa;font-size:13px;margin:0 0 18px}
  input{width:100%;box-sizing:border-box;background:#09090b;border:1px solid #26262b;border-radius:11px;
    color:#fafafa;font:inherit;padding:11px 13px;margin-bottom:10px;outline:none}
  input:focus{border-color:#52525b}
  button{width:100%;border:0;border-radius:11px;background:#fafafa;color:#0a0a0a;font:inherit;
    font-weight:600;padding:11px;cursor:pointer}
  .err{color:#fca5a5;font-size:13px;margin:10px 0 0}`;
function loginPage(err, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#09090b">
<title>VRE Live</title><style>${LOGIN_CSS}</style></head><body>
<form method="POST" action="/login">
  <h1><span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="vertical-align:-4px" aria-hidden="true">
    <rect x="5" y="2.2" width="14" height="16" rx="3.6" fill="#fafafa"/>
    <rect x="7.6" y="5.2" width="8.8" height="4.6" rx="1.3" fill="#09090b"/>
    <circle cx="9.1" cy="14.4" r="1.35" fill="#09090b"/><circle cx="14.9" cy="14.4" r="1.35" fill="#09090b"/>
    <path d="M8.3 18.8L6.2 22M15.7 18.8L17.8 22" stroke="#fafafa" stroke-width="1.8" stroke-linecap="round"/>
  </svg></span>VRE Live</h1>
  <p>Enter the password to continue</p>
  <input type="password" name="password" autofocus required autocomplete="current-password" aria-label="Password">
  <button type="submit">Unlock</button>
  ${err ? `<div class="err">${err}</div>` : ""}
</form></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}
__name(loginPage, "loginPage");
async function feedBytes(name) {
  const now = Date.now();
  const hit = mem[name];
  if (hit && now - hit.t < FRESH_MS) return hit.buf;
  try {
    const up = await fetch(UPSTREAM + name, {
      headers: { "User-Agent": "VRELive-worker/1.0 (personal tracker)" }
    });
    if (!up.ok) throw new Error("upstream " + up.status);
    const buf = await up.arrayBuffer();
    mem[name] = { t: now, buf };
    if (HISTORY_FEEDS.has(name)) {
      const h = history[name] || (history[name] = []);
      h.push({ t: now, b64: toB64(buf) });
      if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
    }
    return buf;
  } catch (e) {
    if (hit && now - hit.t < STALE_MS) {
      e.staleBuf = hit.buf;
      throw e;
    }
    throw e;
  }
}
__name(feedBytes, "feedBytes");
async function feed(name) {
  try {
    return ok(await feedBytes(name));
  } catch (e) {
    if (e.staleBuf) return ok(e.staleBuf, true);
    return new Response("upstream unavailable", { status: 502 });
  }
}
__name(feed, "feed");
function ok(buf, stale = false) {
  const h = { "content-type": "application/octet-stream", "cache-control": "no-store" };
  if (stale) h["x-vre-stale"] = "1";
  return new Response(buf, { headers: h });
}
__name(ok, "ok");
var RIDES_KEY = "rides";
var RIDE_TTL_MS = 6 * 36e5;
var b64url = /* @__PURE__ */ __name((u8) => btoa(String.fromCharCode(...new Uint8Array(u8))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "b64url");
var strB64url = /* @__PURE__ */ __name((s) => b64url(new TextEncoder().encode(s)), "strB64url");
var endpointId = /* @__PURE__ */ __name((ep) => sha256hex("ep:" + ep), "endpointId");
async function vapidAuthHeader(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const header = strB64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = strB64url(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1e3) + 12 * 3600,
    sub: "mailto:vre-live@example.com"
  }));
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(env.VAPID_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `vapid t=${header}.${payload}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}
__name(vapidAuthHeader, "vapidAuthHeader");
async function sendPush(sub, env) {
  try {
    const r = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthHeader(sub.endpoint, env),
        TTL: "300",
        Urgency: "high"
      }
    });
    return r.status === 404 || r.status === 410;
  } catch (_) {
    return false;
  }
}
__name(sendPush, "sendPush");
var loadRides = /* @__PURE__ */ __name(async (env) => await env.RIDES.get(RIDES_KEY, "json") || {}, "loadRides");
var saveRides = /* @__PURE__ */ __name((env, rides) => env.RIDES.put(RIDES_KEY, JSON.stringify(rides), { expirationTtl: 86400 }), "saveRides");
async function runAlertCron(env) {
  if (!env.RIDES || !env.VAPID_PRIVATE_KEY) return;
  const rides = await loadRides(env);
  const ids = Object.keys(rides);
  if (!ids.length) return;
  const now = Date.now();
  let trains = null;
  try {
    const [veh, tu] = await Promise.all([feedBytes("VehiclePositionFeed"), feedBytes("TripUpdateFeed")]);
    trains = globalThis.VRECore.assemble(new Uint8Array(veh), new Uint8Array(tu)).trains;
  } catch (_) {
  }
  const byTrip = trains ? globalThis.VRECore.liveTrainIndex(trains) : null;
  let dirty = false;
  for (const id of ids) {
    const ride = rides[id];
    if (now - ride.created > RIDE_TTL_MS || ride.n0At && now - ride.n0At > 10 * 6e4) {
      delete rides[id];
      dirty = true;
      continue;
    }
    if (!byTrip) continue;
    const train = byTrip[ride.tripId];
    if (!train) {
      if (now - (ride.lastSeen || ride.created) > 30 * 6e4) {
        delete rides[id];
        dirty = true;
      }
      continue;
    }
    ride.lastSeen = now;
    dirty = true;
    const stop = train.stops.find((s) => s.code === ride.dest);
    if (!stop) continue;
    const state = globalThis.VRECore.rideStatus(train, ride.dest, now);
    if (!state.fresh || !["enroute", "due", "atStop"].includes(state.phase)) continue;
    const left = stop.time - now;
    const clock = new Date(stop.time).toLocaleTimeString(
      "en-US",
      { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }
    );
    if (!ride.n5 && state.phase !== "atStop" && left <= ride.lead && left > 7e4) {
      ride.n5 = true;
      ride.msg = {
        title: `${Math.max(1, Math.round(left / 6e4))} minutes to ${ride.destName}`,
        body: `Train ${train.num} \xB7 arriving ~${clock}`,
        at: now
      };
      if (await sendPush(ride.sub, env)) delete rides[id];
    } else if (!ride.n0 && (left <= 7e4 || state.phase === "atStop")) {
      ride.n0 = true;
      ride.n0At = now;
      ride.msg = {
        title: state.phase === "atStop" ? `Stopped at ${ride.destName}` : `Due at ${ride.destName}`,
        body: `Train ${train.num} \xB7 time to gather your things`,
        at: now
      };
      if (await sendPush(ride.sub, env)) delete rides[id];
    }
  }
  if (dirty) await saveRides(env, rides);
}
__name(runAlertCron, "runAlertCron");
var worker_default = {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    if (path === "/manifest.json")
      return new Response(JSON.stringify(manifest_default), {
        headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" }
      });
    if (path === "/icon.svg")
      return new Response(ICON_SVG, {
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" }
      });
    if (!env.APP_PASSWORD)
      return loginPage("Server not configured: set the APP_PASSWORD secret.", 500);
    if (req.method === "POST" && path === "/login") {
      const pw = String((await req.formData()).get("password") || "");
      const good = await sha256hex(pw) === await sha256hex(env.APP_PASSWORD);
      if (!good) {
        await new Promise((r) => setTimeout(r, 800));
        return loginPage("Wrong password.", 401);
      }
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/",
          "Set-Cookie": `${COOKIE}=${await authToken(env)}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`
        }
      });
    }
    if (path === "/logout")
      return new Response(null, {
        status: 303,
        headers: { Location: "/", "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` }
      });
    if (cookies(req)[COOKIE] !== await authToken(env)) return loginPage(null, 401);
    if (path === "/" || path === "/index.html")
      return new Response(HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
      });
    if (path === "/sw.js")
      return new Response(SW_JS, {
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }
      });
    if (path === "/feed/history")
      return new Response(JSON.stringify(history), {
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    if (path.startsWith("/feed/")) {
      const name = path.slice("/feed/".length);
      if (!FEEDS.has(name)) return new Response("not found", { status: 404 });
      return feed(name);
    }
    if (path.startsWith("/push/")) {
      const json = /* @__PURE__ */ __name((obj, status = 200) => new Response(
        JSON.stringify(obj),
        { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }
      ), "json");
      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.RIDES)
        return json({ error: "push not configured (KV binding or VAPID keys missing)" }, 501);
      if (path === "/push/key") return json({ key: env.VAPID_PUBLIC_KEY });
      if (req.method === "POST" && path === "/push/subscribe") {
        const b = await req.json();
        if (!b.sub || !b.sub.endpoint || !b.tripId || !b.dest) return json({ error: "bad request" }, 400);
        const rides = await loadRides(env);
        rides[await endpointId(b.sub.endpoint)] = {
          sub: b.sub,
          tripId: b.tripId,
          dest: b.dest,
          destName: b.destName || b.dest,
          lead: Math.min(10 * 6e4, b.lead || 5 * 6e4),
          created: Date.now(),
          n5: false,
          n0: false
        };
        await saveRides(env, rides);
        return json({ ok: true });
      }
      if (req.method === "POST" && path === "/push/unsubscribe") {
        const b = await req.json();
        if (!b.endpoint) return json({ error: "bad request" }, 400);
        const rides = await loadRides(env);
        delete rides[await endpointId(b.endpoint)];
        await saveRides(env, rides);
        return json({ ok: true });
      }
      if (path === "/push/msg") {
        const ep = new URL(req.url).searchParams.get("e") || "";
        let endpoint = "";
        try {
          endpoint = atob(ep);
        } catch (_) {
        }
        const rides = await loadRides(env);
        const ride = rides[await endpointId(endpoint)];
        return json(ride && ride.msg ? ride.msg : { title: "VRE Live", body: "Open for your train's status" });
      }
      if (req.method === "POST" && path === "/push/test") {
        const b = await req.json();
        const rides = await loadRides(env);
        const ride = rides[await endpointId(b.endpoint || "")];
        if (!ride) return json({ error: "no active ride for that subscription" }, 404);
        ride.msg = { title: "Test alert", body: "Background push is working", at: Date.now() };
        await saveRides(env, rides);
        const gone = await sendPush(ride.sub, env);
        return json({ ok: !gone, gone });
      }
      return new Response("not found", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runAlertCron(env));
  }
};
export {
  worker_default as default
};
