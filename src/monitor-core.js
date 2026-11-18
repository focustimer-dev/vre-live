(function (g) {
  "use strict";

  /* ---------- minimal protobuf (GTFS-realtime subset) ---------- */
  function varint(b, st) {
    let x = 0n, s = 0n;
    for (;;) {
      const byte = b[st.p++];
      x |= BigInt(byte & 0x7f) << s;
      if (!(byte & 0x80)) break;
      s += 7n;
    }
    return x;
  }
  const TD = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
  function decodeStr(u8) {
    if (TD) return TD.decode(u8);
    let s = ""; for (const c of u8) s += String.fromCharCode(c); return s; // ids are ASCII
  }
  // schema: fieldNo -> [name, type, subSchema?, repeated?]
  function parse(b, schema) {
    const st = { p: 0 }, out = {};
    while (st.p < b.length) {
      const key = Number(varint(b, st)), f = key >> 3, wt = key & 7;
      let raw;
      if (wt === 0) raw = varint(b, st);
      else if (wt === 1) { raw = b.subarray(st.p, st.p + 8); st.p += 8; }
      else if (wt === 2) { const n = Number(varint(b, st)); raw = b.subarray(st.p, st.p + n); st.p += n; }
      else if (wt === 5) { raw = b.subarray(st.p, st.p + 4); st.p += 4; }
      else break; // unknown wire type: bail safely
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
  const S_POS  = { 1: ["lat", "float"], 2: ["lon", "float"], 3: ["bearing", "float"], 5: ["speed", "float"] };
  const S_VD   = { 1: ["id", "str"], 2: ["label", "str"] };
  const S_TDSC = { 1: ["tripId", "str"], 3: ["serviceDate", "str"], 5: ["routeId", "str"], 6: ["dir", "uint"] };
  const S_STE  = { 1: ["delay", "int"], 2: ["time", "uint"] };
  const S_STU  = { 1: ["seq", "uint"], 2: ["arrival", "msg", S_STE], 3: ["departure", "msg", S_STE], 4: ["stopId", "str"] };
  const S_TU   = { 1: ["trip", "msg", S_TDSC], 2: ["stops", "msg", S_STU, true], 3: ["vehicle", "msg", S_VD], 4: ["ts", "uint"] };
  const S_VP   = { 1: ["trip", "msg", S_TDSC], 2: ["pos", "msg", S_POS], 3: ["curSeq", "uint"], 4: ["status", "uint"], 5: ["ts", "uint"], 7: ["stopId", "str"], 8: ["vehicle", "msg", S_VD] };
  const S_TRNSL = { 1: ["text", "str"], 2: ["lang", "str"] };
  const S_TSTR  = { 1: ["tr", "msg", S_TRNSL, true] };
  const S_RANGE = { 1: ["start", "uint"], 2: ["end", "uint"] };
  const S_ESEL  = { 1: ["agency", "str"], 2: ["routeId", "str"], 5: ["stopId", "str"] };
  const S_ALERT = { 1: ["period", "msg", S_RANGE, true], 5: ["entities", "msg", S_ESEL, true],
    6: ["cause", "uint"], 7: ["effect", "uint"], 10: ["header", "msg", S_TSTR], 11: ["desc", "msg", S_TSTR] };
  const S_ENT  = { 1: ["id", "str"], 3: ["tripUpdate", "msg", S_TU], 4: ["vehicle", "msg", S_VP], 5: ["alert", "msg", S_ALERT] };
  const S_FEED = { 1: ["header", "msg", { 1: ["version", "str"], 3: ["ts", "uint"] }], 2: ["entity", "msg", S_ENT, true] };
  function parseFeed(u8) { return parse(u8, S_FEED); }

  const EFFECTS = { 1: "No service", 2: "Reduced service", 3: "Significant delays", 4: "Detour",
    5: "Additional service", 6: "Modified service", 7: "Alert", 8: "Alert", 9: "Stop moved" };
  const firstText = ts => (ts && ts.tr && ts.tr.length ? ts.tr[0].text : "") || "";
  /** Parse the AlertFeed into [{header, desc, effect, start, end, routes}] active at nowMs. */
  function parseAlerts(u8, nowMs) {
    const feed = parseFeed(u8), out = [];
    for (const e of feed.entity || []) {
      if (!e.alert) continue;
      const a = e.alert;
      const active = !(a.period || []).length || (a.period || []).some(p =>
        (!p.start || p.start * 1000 <= nowMs) && (!p.end || p.end * 1000 >= nowMs));
      if (!active) continue;
      out.push({
        header: firstText(a.header), desc: firstText(a.desc),
        effect: EFFECTS[a.effect] || "Alert",
        routes: [...new Set((a.entities || []).map(s => s.routeId).filter(Boolean))],
      });
    }
    return out;
  }

  /* ---------- VRE station data (from static GTFS google_transit.zip) ---------- */
  const KX = Math.cos(38.6 * Math.PI / 180) * 111, KY = 111; // ~km per degree
  const geo = (lat, lon) => [(lon + 77.6) * KX, (38.95 - lat) * KY];

  // code -> {name, lat, lon, x, y (schematic; y assigned geographically below)}
  const STATIONS = {
    "01": { name: "Union Station",           lat: 38.89955, lon: -77.00472, x: 170, y: 40  },
    "02": { name: "L'Enfant",                lat: 38.88559, lon: -77.02120, x: 170, y: 90  },
    "03": { name: "Crystal City",            lat: 38.85972, lon: -77.04827, x: 170, y: 140 },
    "04": { name: "Alexandria",              lat: 38.80618, lon: -77.06249, x: 170, y: 190 },
    "05": { name: "Franconia / Springfield", lat: 38.76615, lon: -77.16812, x: 208, y: 244 },
    "06": { name: "Lorton",                  lat: 38.71567, lon: -77.21387, x: 222, y: 296 },
    "07": { name: "Woodbridge",              lat: 38.65935, lon: -77.24800, x: 232, y: 348 },
    "08": { name: "Rippon",                  lat: 38.61237, lon: -77.25349, x: 239, y: 400 },
    "09": { name: "Quantico",                lat: 38.52169, lon: -77.29323, x: 244, y: 452 },
    "0A": { name: "Brooke",                  lat: 38.38725, lon: -77.38128, x: 248, y: 504 },
    "0B": { name: "Leeland Road",            lat: 38.34707, lon: -77.43782, x: 251, y: 552 },
    "0C": { name: "Fredericksburg",          lat: 38.29825, lon: -77.45683, x: 253, y: 600 },
    "SP": { name: "Spotsylvania",            lat: 38.22099, lon: -77.44081, x: 254, y: 648 },
    "0D": { name: "Backlick Road",           lat: 38.79699, lon: -77.18407, x: 128, y: 244 },
    "0E": { name: "Rolling Road",            lat: 38.79465, lon: -77.25847, x: 112, y: 294 },
    "0F": { name: "Burke Centre",            lat: 38.79743, lon: -77.29874, x: 102, y: 344 },
    "10": { name: "Manassas Park",           lat: 38.76596, lon: -77.44030, x: 96,  y: 394 },
    "11": { name: "Manassas",                lat: 38.75022, lon: -77.47250, x: 92,  y: 444 },
    "12": { name: "Broad Run",               lat: 38.72967, lon: -77.52548, x: 90,  y: 494 },
  };
  const LINE_F = ["01","02","03","04","05","06","07","08","09","0A","0B","0C","SP"];
  const LINE_M = ["01","02","03","04","0D","0E","0F","10","11","12"];

  // Geographically proportional vertical layout: one px-per-km scale for both
  // lines (so Quantico->Brooke reads as the long haul it is), with a minimum
  // gap so close pairs like Union->L'Enfant can never collide. Same canvas.
  (function layoutStationY() {
    const TOP = 40, BOTTOM = 648, MIN_GAP = 24;
    const seg = (a, b) => {
      const [ax, ay] = geo(STATIONS[a].lat, STATIONS[a].lon);
      const [bx, by] = geo(STATIONS[b].lat, STATIONS[b].lon);
      return Math.hypot(bx - ax, by - ay);
    };
    const cumOf = codes => {
      const cum = [0];
      for (let i = 1; i < codes.length; i++) cum.push(cum[i - 1] + seg(codes[i - 1], codes[i]));
      return cum;
    };
    const cumF = cumOf(LINE_F), cumM = cumOf(LINE_M);
    const k = (BOTTOM - TOP) / cumF[cumF.length - 1]; // Fredericksburg line spans the full canvas
    const place = (codes, cum, startIdx, prevY) => {
      for (let i = startIdx; i < codes.length; i++) {
        let y = TOP + cum[i] * k;
        if (y < prevY + MIN_GAP) y = prevY + MIN_GAP;
        STATIONS[codes[i]].y = Math.round(y * 10) / 10;
        prevY = STATIONS[codes[i]].y;
      }
    };
    place(LINE_F, cumF, 0, -Infinity);
    place(LINE_M, cumM, 4, STATIONS["04"].y); // branch continues from Alexandria
  })();

  // child (platform) stop_id -> parent station code, from stops.txt
  const CHILD2PARENT = {
    "61B844E260F84E6491D36828C23BF315":"01","9C3AF7FD9F3843009D8FA87B696ACD1C":"01",
    "C845754982F24984973E6058D0E71E36":"01","3C34A3D06AB2428FA788DF48D0E1B2EB":"01",
    "BE7E92139CCE44D0B490765E8234AF12":"01","C021E5A6B55443808121B5A69912A97B":"01",
    "4018AAE5BB1149EE86028B65709402D7":"01","C9C9EEB6CE1A46C3BD0901F3F225933E":"01",
    "C6034C15ACE1455F9E34995B6B30B6C5":"02","BDF2C51AB16C4FF8A80F7D9566B983E2":"02",
    "BC30329248DF4E6E8A114C0822124408":"02",
    "4D1AD5D9903F4836984FF58680D1E950":"03","96903F54359A47858D9D2F20F7AC4142":"03",
    "8E0AECA660E44BA39BDF374FF1D09F96":"03",
    "1E66EEF0911344ACB3B67E230A99DB81":"04","60ADB9309B084464BBCC2C1ABCD908E8":"04",
    "26C502B2E36D484DA6376618E6600DAF":"04",
    "B0B4F69638D547C988E9A71DB08D3BBC":"05","97C6F255492446709194E799A5740CF5":"05",
    "86470B019FB24F4E9102A97F07848105":"06","D683386639434BF7BBC2D41403B3001D":"06",
    "7113724B905946399163A4CB5AAB66A1":"07","16A7F4BA1723417DA6545F754F79F729":"07",
    "BD92F07447C74C9DA620D889725EF244":"08","0F47F802F2004EF384F10B91F1615E35":"08",
    "9B185FE9D08F4766A8CC6B76F2679FC0":"09","34EA179D31FE4CA5A9A5A42D9CCE8156":"09",
    "63707409C20540DBACC2808A7306AE61":"09",
    "5E1E78E6CA654F5AA0E2FE485DA71495":"0A","27D4B760CFDB475FAE6E66C760D64442":"0A",
    "E67A53B0B9AB4E619C21D7C16C034501":"0B","3DF85DC91869485ABF7092EDF02ACB01":"0B",
    "62E201E23B5148898D8B3B73B9395B4B":"0C","4B775E26C3324833BF59FB8A7ADE413D":"0C",
    "888D000A2C144719ADBAD01EBDE23428":"SP","078CADB54DE04AA996C133AEDEE8BB5F":"SP",
    "F94650F367DD4D28AB4648C95746AFA6":"0D","F97647CBCBB9473BA0AA6A1F3690AC40":"0D",
    "7E1B4F506A5B47B7A2C858934721BE5A":"0E","6D12B7A7A44D4306AEC820AE68D7D775":"0E",
    "9500D42D80744F9499D42D654CA522E6":"0F","AB34353A4B534F0A947855570C20511D":"0F",
    "A0F9D1776F1A485A9E1A06A3C1261782":"10","1D840A897ECF4C77BA7E9886A0AC589F":"10",
    "64C983C0E74E491488B298F46879C65A":"11","09598BFBF81A44E595DA4F1E71BFD7E1":"11",
    "5BDF306E0863449AA3D02CF2C406BD05":"12","1555D7C62D784D6B9F2AD871999E0098":"12",
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

  /* ---------- geometry: locate a train along its line ---------- */
  const _lineCache = {};
  function lineData(routeId) {
    const key = routeId === "4" ? "M" : "F";
    if (_lineCache[key]) return _lineCache[key];
    const codes = key === "M" ? LINE_M : LINE_F;
    const pts = codes.map(c => geo(STATIONS[c].lat, STATIONS[c].lon));
    const cum = [0];
    for (let i = 1; i < pts.length; i++)
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const dist = {};
    codes.forEach((c, i) => { dist[c] = cum[i]; });
    return (_lineCache[key] = { codes, pts, cum, dist });
  }
  // nearest point on the line: schematic x/y + km travelled from Union Station
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
      dist: cum[best.i] + best.t * (cum[best.i + 1] - cum[best.i]),
    };
  }
  function projectXY(routeId, lat, lon) { const { x, y } = locate(routeId, lat, lon); return { x, y }; }

  /**
   * Position-based delay estimate.
   * VRE's trip updates mirror the printed schedule (delay is always 0), so we
   * measure reality ourselves: interpolate what time the schedule says the
   * train should be at its current track position and compare with the GPS fix
   * timestamp. Negative deviation clamps to 0 (trains hold when running early).
   * stops: trip's stop list in travel order [{code, time(ms)}...].
   * Returns { dev(ms), expected(ms) } or null when it can't be estimated.
   */
  function estimateDelay(routeId, lat, lon, tsMs, stops) {
    if (!tsMs || !stops || stops.length < 2) return null;
    const { dist } = locate(routeId, lat, lon);
    const D = lineData(routeId).dist;
    const ds = stops.map(s => D[s.code]);
    let expected = null;
    for (let k = 0; k < stops.length - 1; k++) {
      const a = ds[k], b = ds[k + 1];
      if (a === b || a == null || b == null) continue;
      const f = (dist - a) / (b - a); // works for both travel directions
      if (f >= 0 && f <= 1) { expected = stops[k].time + f * (stops[k + 1].time - stops[k].time); break; }
    }
    if (expected == null) {
      // off the ends: waiting at the origin, or already past the terminus
      if (Math.abs(dist - ds[0]) <= Math.abs(dist - ds[ds.length - 1])) expected = stops[0].time;
      else return { dev: 0, expected: stops[stops.length - 1].time };
    }
    const dev = Math.max(0, Math.min(tsMs - expected, 4 * 3600 * 1000));
    return { dev, expected };
  }

  /* ---------- assemble both feeds into app-ready train objects ---------- */
  const STATUS = ["Approaching", "Stopped at", "En route to"];
  function assemble(vehBytes, tuBytes) {
    const vf = parseFeed(vehBytes), tf = parseFeed(tuBytes);
    const updates = {};
    for (const e of tf.entity || []) {
      if (!e.tripUpdate) continue;
      const tu = e.tripUpdate;
      const stops = (tu.stops || []).map(s => {
        const code = resolveStop(s.stopId);
        const ev = s.arrival && s.arrival.time ? s.arrival : s.departure;
        return {
          code, seq: s.seq || 0,
          name: code ? STATIONS[code].name : s.stopId,
          time: ev && ev.time ? ev.time * 1000 : null,
          delay: ev && typeof ev.delay === "number" ? ev.delay : null,
        };
      }).filter(s => s.code && s.time);
      updates[tu.trip && tu.trip.tripId] = stops;
    }
    const trains = [];
    for (const e of vf.entity || []) {
      if (!e.vehicle || !e.vehicle.pos) continue;
      const v = e.vehicle, tripId = v.trip && v.trip.tripId;
      const routeId = (v.trip && v.trip.routeId) || "2";
      const stops = updates[tripId] || [];
      const schedDir = v.trip && v.trip.dir != null ? v.trip.dir : DIR_BY_TRIP[tripId];
      const ts = v.ts ? v.ts * 1000 : null;

      // VRE's published predictions are just the schedule, so derive the real
      // delay from the train's position and push remaining ETAs out by it.
      let adjStops = stops, schedDev = 0;
      const est = stops.length >= 2
        ? estimateDelay(routeId, v.pos.lat, v.pos.lon, ts || Date.now(), stops) : null;
      if (est && est.dev > 30000) { // ignore sub-30s GPS noise
        schedDev = est.dev;
        adjStops = stops.map(s => s.time >= est.expected - 60000
          ? { ...s, sched: s.time, time: s.time + est.dev, delay: (s.delay || 0) + Math.round(est.dev / 1000) }
          : s);
      }

      trains.push({
        num: e.id, tripId, routeId,
        serviceDate: v.trip && v.trip.serviceDate, routeKnown: !!(v.trip && v.trip.routeId),
        dir: schedDir !== undefined ? schedDir : (parseInt(e.id, 10) % 2 === 0 ? 1 : 0), // 1 = toward DC
        line: routeId === "4" ? "M" : "F",
        lineName: routeId === "4" ? "Manassas Line" : "Fredericksburg Line",
        label: (v.vehicle && v.vehicle.label) || "",
        lat: v.pos.lat, lon: v.pos.lon,
        bearing: v.pos.bearing || 0,
        speedMs: v.pos.speed != null ? v.pos.speed : null,
        mph: v.pos.speed != null ? Math.round(v.pos.speed * 2.23694) : null,
        status: typeof v.status === "number" ? STATUS[v.status] : null,
        nextStop: resolveStop(v.stopId),
        ts,
        stops: adjStops, schedDev,
        headsign: adjStops.length ? adjStops[adjStops.length - 1].name : null,
        ...projectXY(routeId, v.pos.lat, v.pos.lon),
      });
    }
    trains.sort((a, b) => a.num.localeCompare(b.num));
    return { trains: reconcileTrains(trains), feedTs: (vf.header && vf.header.ts ? vf.header.ts * 1000 : null) };
  }

  /* ---------- embedded weekday timetable (static GTFS, zero network) ---------- */
  /*SCHEDULE-START*/
  // generated by gen_schedule.py from gtfs_static/ (32 trips)
  const SCHEDULE = {"trips":[{"num":"300","trip":"300-Regular","line":"F","dir":1,"head":"Union Station","stops":[["SP",292],["0C",303],["0B",310],["0A",316],["07",338],["04",361],["03",374],["02",382],["01",390]]},{"num":"322","trip":"322-Regular","line":"M","dir":1,"head":"Union Station","stops":[["12",301],["11",309],["10",315],["0F",329],["0E",334],["0D",342],["04",355],["03",364],["02",372],["01",380]]},{"num":"302","trip":"302-Regular","line":"F","dir":1,"head":"Union Station","stops":[["SP",306],["0C",317],["0B",324],["0A",330],["09",342],["08",351],["07",358],["06",365],["05",373],["04",385],["03",394],["02",402],["01",410]]},{"num":"304","trip":"304-Regular","line":"F","dir":1,"head":"Union Station","stops":[["SP",321],["0C",332],["0B",339],["0A",345],["09",357],["08",366],["07",373],["06",380],["05",388],["04",400],["03",409],["02",417],["01",425]]},{"num":"324","trip":"324-Regular","line":"M","dir":1,"head":"Union Station","stops":[["12",321],["11",329],["10",335],["0F",349],["0E",354],["0D",362],["04",375],["03",384],["02",392],["01",400]]},{"num":"306","trip":"306-Regular","line":"F","dir":1,"head":"Union Station","stops":[["SP",341],["0C",352],["0B",359],["0A",365],["09",377],["08",386],["07",393],["06",400],["05",408],["04",420],["03",429],["02",437],["01",445]]},{"num":"326","trip":"326-Regular","line":"M","dir":1,"head":"Union Station","stops":[["12",356],["11",364],["10",370],["0F",384],["0E",389],["0D",397],["04",410],["03",419],["02",427],["01",435]]},{"num":"308","trip":"308-Regular","line":"F","dir":1,"head":"Union Station","stops":[["SP",361],["0C",372],["0B",379],["0A",385],["09",397],["08",406],["07",413],["06",420],["05",428],["04",440],["03",449],["02",457],["01",465]]},{"num":"328","trip":"328-Regular","line":"M","dir":1,"head":"Union Station","stops":[["12",376],["11",384],["10",390],["0F",404],["0E",409],["0D",417],["04",430],["03",439],["02",447],["01",455]]},{"num":"310","trip":"310-Regular","line":"F","dir":1,"head":"Union Station","stops":[["SP",386],["0C",397],["0B",404],["0A",410],["09",422],["08",431],["07",438],["06",445],["05",453],["04",465],["03",474],["02",482],["01",490]]},{"num":"321","trip":"321-Regular","line":"M","dir":0,"head":"Broad Run","stops":[["01",395],["04",412],["11",457],["12",467]]},{"num":"330","trip":"330-Regular","line":"M","dir":1,"head":"Union Station","stops":[["12",401],["11",409],["10",415],["0F",429],["0E",434],["0D",442],["04",455],["03",464],["02",472],["01",480]]},{"num":"312","trip":"312-Regular","line":"F","dir":1,"head":"Alexandria","stops":[["SP",426],["0C",437],["0B",444],["0A",450],["09",462],["08",471],["07",478],["06",485],["05",493],["04",505]]},{"num":"332","trip":"332-Regular","line":"M","dir":1,"head":"Alexandria","stops":[["12",441],["11",449],["10",455],["0F",469],["0E",474],["0D",482],["04",495]]},{"num":"314","trip":"314-Regular","line":"F","dir":1,"head":"Alexandria","stops":[["SP",466],["0C",477],["0B",484],["0A",490],["09",502],["08",511],["07",518],["06",525],["05",533],["04",545]]},{"num":"334","trip":"334-Regular","line":"M","dir":1,"head":"Alexandria","stops":[["12",481],["11",489],["10",495],["0F",509],["0E",514],["0D",522],["04",535]]},{"num":"325","trip":"325-Regular","line":"M","dir":0,"head":"Broad Run","stops":[["01",810],["02",818],["03",825],["04",833],["0D",844],["0E",852],["0F",858],["10",872],["11",879],["12",889]]},{"num":"301","trip":"301-Regular","line":"F","dir":0,"head":"Spotsylvania","stops":[["04",838],["05",849],["06",856],["07",864],["08",870],["09",882],["0A",901],["0B",910],["0C",918],["SP",931]]},{"num":"303","trip":"303-Regular","line":"F","dir":0,"head":"Spotsylvania","stops":[["01",900],["02",908],["03",915],["04",923],["05",934],["06",941],["07",949],["08",955],["09",967],["0A",986],["0B",995],["0C",1003],["SP",1016]]},{"num":"327","trip":"327-Regular","line":"M","dir":0,"head":"Broad Run","stops":[["01",920],["02",928],["03",935],["04",943],["0D",954],["0E",962],["0F",968],["10",982],["11",989],["12",999]]},{"num":"336","trip":"336-Regular","line":"M","dir":1,"head":"Union Station","stops":[["12",928],["11",936],["10",942],["0F",956],["04",982],["01",1007]]},{"num":"305","trip":"305-Regular","line":"F","dir":0,"head":"Spotsylvania","stops":[["04",953],["05",964],["06",971],["07",979],["08",985],["09",997],["0A",1016],["0B",1025],["0C",1033],["SP",1046]]},{"num":"307","trip":"307-Regular","line":"F","dir":0,"head":"Spotsylvania","stops":[["01",960],["02",968],["03",975],["04",983],["05",994],["06",1001],["07",1009],["08",1015],["09",1027],["0A",1046],["0B",1055],["0C",1063],["SP",1076]]},{"num":"329","trip":"329-Regular","line":"M","dir":0,"head":"Broad Run","stops":[["01",970],["02",978],["03",985],["04",993],["0D",1004],["0E",1012],["0F",1018],["10",1032],["11",1039],["12",1049]]},{"num":"309","trip":"309-Regular","line":"F","dir":0,"head":"Spotsylvania","stops":[["01",1000],["02",1008],["03",1015],["04",1023],["05",1034],["06",1041],["07",1049],["08",1055],["09",1067],["0A",1086],["0B",1095],["0C",1103],["SP",1116]]},{"num":"331","trip":"331-Regular","line":"M","dir":0,"head":"Broad Run","stops":[["01",1030],["02",1038],["03",1045],["04",1053],["0D",1064],["0E",1072],["0F",1078],["10",1092],["11",1099],["12",1109]]},{"num":"333","trip":"333-Regular","line":"M","dir":0,"head":"Broad Run","stops":[["01",1050],["02",1058],["03",1065],["04",1073],["0D",1084],["0E",1092],["0F",1098],["10",1112],["11",1119],["12",1129]]},{"num":"311","trip":"311-Regular","line":"F","dir":0,"head":"Spotsylvania","stops":[["04",1063],["05",1074],["06",1081],["07",1089],["08",1095],["09",1107],["0A",1126],["0B",1135],["0C",1143],["SP",1156]]},{"num":"335","trip":"335-Regular","line":"M","dir":0,"head":"Broad Run","stops":[["01",1080],["02",1088],["03",1095],["04",1103],["0D",1114],["0E",1122],["0F",1128],["10",1142],["11",1149],["12",1159]]},{"num":"313","trip":"313-Regular","line":"F","dir":0,"head":"Spotsylvania","stops":[["01",1090],["02",1098],["03",1105],["04",1113],["05",1124],["06",1131],["07",1139],["08",1145],["09",1155],["0A",1169],["0B",1178],["0C",1186],["SP",1197]]},{"num":"315","trip":"315-Regular","line":"F","dir":0,"head":"Spotsylvania","stops":[["01",1130],["02",1138],["03",1145],["04",1153],["05",1164],["06",1171],["07",1179],["08",1185],["09",1195],["0A",1209],["0B",1218],["0C",1226],["SP",1237]]},{"num":"337","trip":"337-Regular","line":"M","dir":0,"head":"Broad Run","stops":[["01",1140],["02",1148],["03",1155],["04",1163],["0D",1174],["0E",1182],["0F",1188],["10",1202],["11",1209],["12",1219]]}],"noService":["20260907","20261012"]};
  /*SCHEDULE-END*/

  // Calendar-driven VRE no-service rules (Eastern dates). Independence Day is
  // intentionally excluded: VRE may run its reduced S schedule that day.
  function vreNoServiceDates(year) {
    const key = (m, d) => String(year) + String(m).padStart(2, "0") + String(d).padStart(2, "0");
    const weekday = (m, d) => new Date(Date.UTC(year, m - 1, d)).getUTCDay();
    const nth = (m, weekdayWanted, n) => 1 + (weekdayWanted - weekday(m, 1) + 7) % 7 + (n - 1) * 7;
    const last = (m, weekdayWanted) => {
      const end = new Date(Date.UTC(year, m, 0)).getUTCDate();
      return end - (weekday(m, end) - weekdayWanted + 7) % 7;
    };
    const observed = (m, d) => {
      const date = new Date(Date.UTC(year, m - 1, d));
      const day = date.getUTCDay();
      if (day === 6) date.setUTCDate(date.getUTCDate() - 1);
      if (day === 0) date.setUTCDate(date.getUTCDate() + 1);
      return date.getUTCFullYear() + String(date.getUTCMonth() + 1).padStart(2, "0") +
        String(date.getUTCDate()).padStart(2, "0");
    };
    const thanks = nth(11, 4, 4);
    return [
      observed(1, 1), key(1, 2), key(1, nth(1, 1, 3)),
      key(2, nth(2, 1, 3)), key(5, last(5, 1)), observed(6, 19),
      key(9, nth(9, 1, 1)),
      key(10, nth(10, 1, 2)), observed(11, 11),
      key(11, thanks), key(11, thanks + 1),
      observed(12, 25), key(12, 26)
    ];
  }
  for (let year = 2026; year <= 2040; year++) SCHEDULE.noService.push(...vreNoServiceDates(year));
  SCHEDULE.noService = [...new Set(SCHEDULE.noService)].sort();
  // Reviewed against https://www.vre.org/schedule/: Christmas Eve is closed; Dec 28–31 use S service.
  SCHEDULE.noService = [...new Set([...SCHEDULE.noService, "20261224"])].sort();
  SCHEDULE.reducedService = ["20260703", "20261228", "20261229", "20261230", "20261231"];
  // S trains from VRE's May 4, 2026 reduced-service timetable.
  SCHEDULE.sTrains = new Set(["302", "306", "310", "314", "301", "305", "309", "313",
    "324", "328", "330", "334", "325", "329", "333", "335"]);


  const DIR_BY_TRIP = Object.fromEntries(SCHEDULE.trips.map(t => [t.trip, t.dir]));

  function isServiceDay(d) {
    const dow = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", weekday: "short"
    }).format(d);
    if (dow === "Sat" || dow === "Sun") return false;
    return !SCHEDULE.noService.includes(serviceDateKey(d.getTime()));
  }

  /**
   * Merge the embedded timetable with live trains for "now".
   * Returns rows sorted by first departure:
   *   {num, trip, line, dir, head, stops:[[code,min]], first, last, live, status}
   * status: live | soon | done | quiet (in service window but not reporting) | none (no service today)
   */
  function scheduleRows(now, liveByTrip) {
    const d = new Date(now);
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const service = isServiceDay(d);
    return SCHEDULE.trips.map(t => {
      const first = midnight + t.stops[0][1] * 60000;
      const last = midnight + t.stops[t.stops.length - 1][1] * 60000;
      const live = (liveByTrip && liveByTrip[t.trip]) || null;
      let status;
      if (live) status = "live";
      else if (!service) status = "none";
      else if (now > last + 20 * 60000) status = "done";
      else if (now < first) status = "soon";
      else status = "quiet";
      return { ...t, first, last, live, status };
    }).sort((a, b) => a.first - b.first);
  }

  /** Convert km-from-Union-Station back to schematic x/y (inverse of locate). */
  function distToXY(routeId, dist) {
    const { codes, cum } = lineData(routeId);
    const d = Math.max(0, Math.min(dist, cum[cum.length - 1]));
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < d) i++;
    const t = (d - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
    const A = STATIONS[codes[i]], B = STATIONS[codes[i + 1]];
    return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
  }

  /** Scheduled stop list of a SCHEDULE trip as ms timestamps for "now"'s date. */
  function schedStopsMs(trip, nowMs) {
    const d = new Date(nowMs);
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return trip.stops.map(([code, min]) => ({
      code, name: STATIONS[code].name, time: midnight + min * 60000, delay: null,
    }));
  }

  /** Where the schedule says a (non-reporting) trip is right now, or null if not underway. */
  function schedPositionNow(trip, nowMs) {
    const stops = schedStopsMs(trip, nowMs);
    if (nowMs < stops[0].time || nowMs > stops[stops.length - 1].time) return null;
    const routeId = trip.line === "M" ? "4" : "2";
    const D = lineData(routeId).dist;
    for (let k = 0; k < stops.length - 1; k++) {
      if (nowMs > stops[k + 1].time) continue;
      const f = (nowMs - stops[k].time) / ((stops[k + 1].time - stops[k].time) || 1);
      const dist = D[stops[k].code] + f * (D[stops[k + 1].code] - D[stops[k].code]);
      return distToXY(routeId, dist);
    }
    return null;
  }

  /**
   * Commute helper: next departures from station A toward station B,
   * blending the embedded timetable with live position-derived delays.
   * Returns up to `count` of {num, trip, line, head, dep, arr, dev, live, missed}.
   */
  function nextDepartures(fromCode, toCode, nowMs, liveByTrip, count = 3) {
    if (!isServiceDay(new Date(nowMs))) return [];
    const reduced = SCHEDULE.reducedService.includes(serviceDateKey(nowMs));
    const out = [];
    for (const t of SCHEDULE.trips) {
      if (reduced && !SCHEDULE.sTrains.has(t.num)) continue;
      const iA = t.stops.findIndex(s => s[0] === fromCode);
      const iB = t.stops.findIndex(s => s[0] === toCode);
      if (iA < 0 || iB < 0 || iA >= iB) continue; // must serve A before B
      const stops = schedStopsMs(t, nowMs);
      const live = liveByTrip && liveByTrip[t.trip];
      let dep = stops[iA].time, arr = stops[iB].time, dev = 0;
      if (live) {
        const lDep = live.stops.find(s => s.code === fromCode);
        const lArr = live.stops.find(s => s.code === toCode);
        if (lDep) dep = lDep.time;
        if (lArr) arr = lArr.time;
        dev = live.schedDev || 0;
        if (!lDep && dev) dep += dev;
        if (!lArr && dev) arr += dev;
      }
      if (dep < nowMs - 60000) continue; // already left A
      out.push({ num: t.num, trip: t.trip, line: t.line, head: t.head, dep, arr, dev, live: !!live, ts: live ? live.ts : null });
    }
    out.sort((a, b) => a.dep - b.dep);
    return out.slice(0, count);
  }

  /**
   * Dead-reckoned marker drift: project a train forward along its line from
   * the last GPS fix at its last known speed. Honest clamps: never past the
   * next stop, at most 10 minutes of extrapolation, nothing for stopped
   * trains (< 2 m/s) or fixes fresher than 15 s. Returns {x, y, drifted}
   * or null when the real fix position should be shown as-is.
   */
  function driftPosition(train, nowMs) {
    if (!train.ts || train.speedMs == null || train.speedMs < 2) return null;
    const elapsed = Math.min(nowMs - train.ts, 10 * 60000);
    if (elapsed < 15000) return null;
    const { dist } = locate(train.routeId, train.lat, train.lon);
    const D = lineData(train.routeId).dist;
    let km = train.speedMs * elapsed / 1e6; // m/s * ms -> km
    const nextCode = train.nextStop
      || ((train.stops || []).find(s => s.time > train.ts) || {}).code;
    if (nextCode && D[nextCode] != null) km = Math.min(km, Math.abs(D[nextCode] - dist));
    else km = Math.min(km, 3); // unknown next stop: modest cap
    const target = train.dir === 1 ? dist - km : dist + km; // dir 1 = toward Union Station
    return { ...distToXY(train.routeId, target), drifted: km > 0.05 };
  }

  /**
   * Departure board: next trains at one station, both directions,
   * blending the timetable with live position-derived delays.
   * Returns up to `count` of {num, trip, line, head, dir, time, dev, live, ts, terminus}.
   */
  function stationBoard(code, nowMs, liveByTrip, count = 8) {
    if (!isServiceDay(new Date(nowMs))) return [];
    const reduced = SCHEDULE.reducedService.includes(serviceDateKey(nowMs));
    const out = [];
    for (const t of SCHEDULE.trips) {
      if (reduced && !SCHEDULE.sTrains.has(t.num)) continue;
      const idx = t.stops.findIndex(s => s[0] === code);
      if (idx < 0) continue;
      const stops = schedStopsMs(t, nowMs);
      const live = liveByTrip && liveByTrip[t.trip];
      let time = stops[idx].time;
      const dev = live ? (live.schedDev || 0) : 0;
      if (live) {
        const ls = live.stops.find(s => s.code === code);
        time = ls ? ls.time : time + dev;
      }
      if (time < nowMs - 60000) continue;
      out.push({
        num: t.num, trip: t.trip, line: t.line, head: t.head, dir: t.dir,
        time, dev, live: !!live, ts: live ? live.ts : null,
        terminus: idx === t.stops.length - 1,
      });
    }
    out.sort((a, b) => a.time - b.time);
    return out.slice(0, count);
  }

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

  g.VRECore = { rideStatus, remainingStops, reconcileTrains, liveTrainIndex, serviceDateKey, parseFeed, parseAlerts, assemble, resolveStop, projectXY, estimateDelay,
    distToXY, schedStopsMs, schedPositionNow, nextDepartures, stationBoard, driftPosition,
    STATIONS, LINE_F, LINE_M, SCHEDULE, isServiceDay, scheduleRows };
})(typeof window !== "undefined" ? window : globalThis);
