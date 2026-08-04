/* Open World Maps — application logic */
(function(){
'use strict';

var D      = window.OW_DATA;
var STATES = D.STATES;
var MILE   = 1609.344;
var STORE  = 'openworld.v2';

/* ═══════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════ */
var DEFAULTS = {
  revealRadiusM : 150,    // fog cleared as you travel
  arrivalRadiusM: 4000,   // how close counts as arriving at a city
  shiftThreshold: 0.70,   // recenter when you pass this much of the view
  maxAccuracyM  : 150,
  style         : 'parchment',
  sim           : false,
  sound         : true,
  zoom          : null,
  simLat        : null,
  simLng        : null
};

var STYLES = {
  parchment:{ url:'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
              attr:'&copy; OpenStreetMap &copy; CARTO', sub:'abcd', max:20, filter:'aged' },
  ink:      { url:'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
              attr:'&copy; OpenStreetMap &copy; CARTO', sub:'abcd', max:20, filter:'ink' },
  wild:     { url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
              attr:'&copy; OpenTopoMap (CC-BY-SA)', sub:'abc', max:17, filter:'aged' },
  night:    { url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
              attr:'&copy; OpenStreetMap &copy; CARTO', sub:'abcd', max:20, filter:'' },
  realm:    { url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
              attr:'Imagery &copy; Esri', max:19, filter:'' }
};

var MIN_ZOOM = 3;      // the whole United States
var MAX_ZOOM = 21;     // roughly 100 feet across
var CELL_M   = 40;     // trail de-dupe + charted-area grid
var MAX_TRAIL= 9000;
var GRID      = 36;    // region resolution per state (36 x 36 cells)

/* ═══════════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════════ */
var cfg = Object.assign({}, DEFAULTS);
var pois = [], reveals = [], trailCells = new Set(), areaCells = new Set();
var setupDone = false;

var map, tiles, fogCanvas, fctx, maskCanvas, mctx, cloudCanvas, cctx;
var noise = [], maskDirty = true, rafId = null, lastFrame = 0;
var youMarker, accCircle, poiLayer = {};
var pos = null, anchor = null, watchId = null;
var simPos = null, simVec = {x:0,y:0}, simSprint = false, simTimer = null;
var placeMode = false, saveTimer = null, wakeLock = null;
var audio = null;
var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

var $ = function(id){ return document.getElementById(id); };

/* ═══════════════════════════════════════════════════════════════
   DATA / PERSISTENCE
   ═══════════════════════════════════════════════════════════════ */
function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function uid(){ return 'u-' + Math.random().toString(36).slice(2,9); }

function defaultPois(){
  return D.CITIES.map(function(c){
    return { id:'d-'+c.s+'-'+slug(c.n), name:c.n, state:c.s, lat:c.lat, lng:c.lng, found:false };
  });
}

function load(){
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch(e){}
  var saved = (raw && Array.isArray(raw.pois)) ? raw.pois : [];
  var byId = {}; saved.forEach(function(p){ byId[p.id] = p; });

  pois = defaultPois().map(function(p){
    var s = byId[p.id];
    if (s){ p.found = !!s.found; delete byId[p.id]; }
    return p;
  });
  // keep anything the traveller added themselves
  Object.keys(byId).forEach(function(k){ if (k.charAt(0) === 'u') pois.push(byId[k]); });

  if (raw){
    cfg       = Object.assign({}, DEFAULTS, raw.cfg || {});
    reveals   = Array.isArray(raw.reveals) ? raw.reveals : [];
    setupDone = !!raw.setupDone;
  }
  rebuildCells();
}

function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function(){
    try {
      localStorage.setItem(STORE, JSON.stringify({
        cfg: cfg, setupDone: setupDone,
        pois: pois.map(function(p){
          return p.id.charAt(0) === 'u'
            ? p
            : { id:p.id, found:p.found };
        }),
        reveals: reveals
      }));
    } catch(e){ toast('The journal is full — some ground may not be remembered.'); }
  }, 700);
}

function cellKey(lat,lng){
  var a = CELL_M/111320, b = CELL_M/(111320*Math.max(0.15, Math.cos(lat*Math.PI/180)));
  return Math.round(lat/a) + ':' + Math.round(lng/b);
}
function stampArea(lat,lng,r){
  var a = CELL_M/111320, b = CELL_M/(111320*Math.max(0.15, Math.cos(lat*Math.PI/180)));
  var n = Math.min(40, Math.ceil(r/CELL_M)), cy = Math.round(lat/a), cx = Math.round(lng/b);
  for (var dy=-n; dy<=n; dy++) for (var dx=-n; dx<=n; dx++)
    if (dx*dx+dy*dy <= n*n) areaCells.add((cy+dy)+':'+(cx+dx));
}
function areaOfRegion(rg){
  // sum of run areas, in square metres
  var total = 0;
  for (var i=0;i<rg.runs.length;i++){
    var run = rg.runs[i];
    var h = rg.h * 111320;
    var w = (run[2]-run[1] + rg.w) * 111320 * Math.cos(run[0]*Math.PI/180);
    total += h*w;
  }
  return total;
}
function rebuildCells(){
  trailCells = new Set(); areaCells = new Set();
  for (var i=0;i<reveals.length;i++){
    var r = reveals[i];
    if (r.t === 't'){ trailCells.add(cellKey(r.lat,r.lng)); stampArea(r.lat,r.lng,r.r); }
    else if (r.t === 'c') stampArea(r.lat,r.lng,r.r);
  }
}
function chartedSqMi(){
  var m2 = areaCells.size * CELL_M * CELL_M;
  for (var i=0;i<reveals.length;i++) if (reveals[i].t === 'r') m2 += areaOfRegion(reveals[i]);
  return m2 / 2589988.11;
}

/* ═══════════════════════════════════════════════════════════════
   REGIONS — a discovery claims the nearest slice of its state
   ═══════════════════════════════════════════════════════════════ */
function stateOf(lat,lng){
  for (var k in STATES){
    var b = STATES[k].bbox;
    if (lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3]) return k;
  }
  return null;
}
function flatDist(aLat,aLng,bLat,bLng){
  var k = Math.cos((aLat+bLat)*0.5*Math.PI/180);
  var dy = aLat-bLat, dx = (aLng-bLng)*k;
  return dy*dy + dx*dx;
}
function inShape(code,lat,lng){
  var shapes = window.OW_STATE_SHAPES;
  if (!shapes || !shapes[code]) return true;              // box only
  var rings = shapes[code], hit = false;
  for (var r=0;r<rings.length;r++){
    var ring = rings[r];
    for (var i=0,j=ring.length-1;i<ring.length;j=i++){
      var xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
      if (((yi>lat)!==(yj>lat)) && (lng < (xj-xi)*(lat-yi)/(yj-yi)+xi)) hit = !hit;
    }
  }
  return hit;
}

function buildRegion(poi){
  var st = STATES[poi.state];
  if (!st) return null;
  var b = st.bbox, s = b[0], w = b[1], n = b[2], e = b[3];
  var stepLat = (n-s)/GRID, stepLng = (e-w)/GRID;
  var peers = pois.filter(function(p){ return p.state === poi.state; });
  var runs = [], minLat = 99, maxLat = -99, minLng = 999, maxLng = -999;

  for (var i=0;i<GRID;i++){
    var lat = s + (i+0.5)*stepLat, start = null, prevLng = null;
    for (var j=0;j<GRID;j++){
      var lng = w + (j+0.5)*stepLng;
      var mine = false;
      if (inShape(poi.state, lat, lng)){
        var best = null, bestD = Infinity;
        for (var k=0;k<peers.length;k++){
          var d = flatDist(lat,lng,peers[k].lat,peers[k].lng);
          if (d < bestD){ bestD = d; best = peers[k]; }
        }
        mine = best && best.id === poi.id;
      }
      if (mine && start === null) start = lng;
      if (!mine && start !== null){ runs.push([r4(lat),r4(start),r4(prevLng)]); start = null; }
      if (mine) prevLng = lng;
      if (mine && j === GRID-1){ runs.push([r4(lat),r4(start),r4(lng)]); start = null; }
    }
  }
  if (!runs.length) return null;
  runs.forEach(function(r){
    minLat = Math.min(minLat,r[0]); maxLat = Math.max(maxLat,r[0]);
    minLng = Math.min(minLng,r[1]); maxLng = Math.max(maxLng,r[2]);
  });
  var far = Math.max(
    L.latLng(poi.lat,poi.lng).distanceTo(L.latLng(minLat,minLng)),
    L.latLng(poi.lat,poi.lng).distanceTo(L.latLng(maxLat,maxLng)));
  return { t:'r', id:poi.id, h:stepLat, w:stepLng, runs:runs, cx:poi.lat, cy:poi.lng,
           bb:[minLat-stepLat, minLng-stepLng, maxLat+stepLat, maxLng+stepLng], rmax:far*1.15 };
}
function r4(v){ return Math.round(v*10000)/10000; }

/* ═══════════════════════════════════════════════════════════════
   FOG — animated cloud layers, carved by a cached mask
   ═══════════════════════════════════════════════════════════════ */
function makeNoise(size, baseFreq, octaves, floor, gain){
  var c = document.createElement('canvas'); c.width = c.height = size;
  var x = c.getContext('2d'), img = x.createImageData(size,size), d = img.data;
  var lat = [], f = baseFreq, o, i;
  for (o=0;o<octaves;o++){
    var g = new Float32Array(f*f);
    for (i=0;i<f*f;i++) g[i] = Math.random();
    lat.push({ n:f, g:g }); f *= 2;
  }
  function sm(t){ return t*t*(3-2*t); }
  for (var y=0;y<size;y++) for (var xx=0;xx<size;xx++){
    var v = 0, amp = 1, tot = 0;
    for (o=0;o<lat.length;o++){
      var n = lat[o].n, g2 = lat[o].g;
      var fx = xx/size*n, fy = y/size*n;
      var x0 = Math.floor(fx)%n, y0 = Math.floor(fy)%n, x1 = (x0+1)%n, y1 = (y0+1)%n;
      var tx = sm(fx-Math.floor(fx)), ty = sm(fy-Math.floor(fy));
      var a = g2[y0*n+x0], b = g2[y0*n+x1], cc = g2[y1*n+x0], dd = g2[y1*n+x1];
      v += amp * ((a+(b-a)*tx) + ((cc+(dd-cc)*tx) - (a+(b-a)*tx))*ty);
      tot += amp; amp *= 0.55;
    }
    v /= tot;
    var idx = (y*size+xx)*4;
    d[idx] = 216; d[idx+1] = 219; d[idx+2] = 227;
    d[idx+3] = Math.max(0, Math.min(255, (v-floor)*gain));
  }
  x.putImageData(img,0,0);
  return c;
}

function initFog(){
  map.createPane('fog');
  var pane = map.getPane('fog');
  pane.style.zIndex = 450; pane.style.pointerEvents = 'none';

  fogCanvas = document.createElement('canvas');
  fogCanvas.style.position = 'absolute'; fogCanvas.style.pointerEvents = 'none';
  pane.appendChild(fogCanvas);
  fctx = fogCanvas.getContext('2d');

  maskCanvas = document.createElement('canvas');  mctx = maskCanvas.getContext('2d');
  cloudCanvas = document.createElement('canvas'); cctx = cloudCanvas.getContext('2d');

  noise = [
    { img:makeNoise(256, 4, 4, 0.34, 300), scale:2.6, vx: 0.0042, vy:-0.0016, alpha:0.40 },
    { img:makeNoise(256, 6, 4, 0.40, 340), scale:1.5, vx:-0.0068, vy: 0.0027, alpha:0.34 },
    { img:makeNoise(256, 3, 3, 0.30, 260), scale:4.2, vx: 0.0019, vy: 0.0011, alpha:0.30 }
  ].map(function(l){ l.pat = cctx.createPattern(l.img,'repeat'); return l; });

  map.on('move zoom viewreset resize moveend zoomend', function(){ maskDirty = true; });
  startLoop();
}

function mpp(lat, z){ return 156543.03392 * Math.cos(lat*Math.PI/180) / Math.pow(2, z); }

function sizeCanvases(){
  var s = map.getSize(), dpr = Math.min(window.devicePixelRatio||1, 2);
  var W = Math.round(s.x*dpr), H = Math.round(s.y*dpr);
  if (fogCanvas.width !== W || fogCanvas.height !== H){
    fogCanvas.width = maskCanvas.width = W;
    fogCanvas.height = maskCanvas.height = H;
    fogCanvas.style.width = s.x+'px'; fogCanvas.style.height = s.y+'px';
    cloudCanvas.width = Math.max(2, Math.round(s.x*0.5));
    cloudCanvas.height = Math.max(2, Math.round(s.y*0.5));
    maskDirty = true;
  }
  return { s:s, dpr:dpr };
}

function buildMask(now, dpr, size){
  mctx.setTransform(dpr,0,0,dpr,0,0);
  mctx.clearRect(0,0,size.x,size.y);
  mctx.fillStyle = '#fff';

  var z = map.getZoom(), m = mpp(map.getCenter().lat, z);
  var b = map.getBounds().pad(0.55);
  var animating = false;

  for (var i=0;i<reveals.length;i++){
    var rv = reveals[i];

    if (rv.t === 'r'){
      if (rv.bb[2] < b.getSouth() || rv.bb[0] > b.getNorth() ||
          rv.bb[3] < b.getWest()  || rv.bb[1] > b.getEast()) continue;
      var clipped = false;
      if (rv.born){
        var t = (now - rv.born)/1800;
        if (t < 1){
          animating = true; clipped = true;
          var p0 = map.latLngToContainerPoint([rv.cx, rv.cy]);
          var rad = (rv.rmax * (1-Math.pow(1-t,2.4))) / m;
          mctx.save(); mctx.beginPath(); mctx.arc(p0.x,p0.y,Math.max(1,rad),0,6.2832); mctx.clip();
        } else delete rv.born;
      }
      var feather = Math.max(6, Math.min(48, (rv.h*111320/m) * 0.9));
      mctx.shadowColor = 'rgba(255,255,255,1)';
      mctx.shadowBlur  = feather;
      for (var k=0;k<rv.runs.length;k++){
        var run = rv.runs[k];
        var nw = map.latLngToContainerPoint([run[0]+rv.h/2, run[1]-rv.w/2]);
        var se = map.latLngToContainerPoint([run[0]-rv.h/2, run[2]+rv.w/2]);
        mctx.fillRect(nw.x, nw.y, Math.max(1,se.x-nw.x), Math.max(1,se.y-nw.y));
      }
      mctx.shadowBlur = 0;
      if (clipped) mctx.restore();
      continue;
    }

    if (rv.lat < b.getSouth() || rv.lat > b.getNorth() ||
        rv.lng < b.getWest()  || rv.lng > b.getEast()) continue;
    var rr = rv.r;
    if (rv.born){
      var tt = (now - rv.born)/1200;
      if (tt < 1){ rr = rv.r*(1-Math.pow(1-tt,3)); animating = true; } else delete rv.born;
    }
    var p = map.latLngToContainerPoint([rv.lat, rv.lng]);
    var px = rr/m;
    if (px < 0.7) continue;
    var g = mctx.createRadialGradient(p.x,p.y,px*0.5, p.x,p.y,px);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.6,'rgba(255,255,255,0.94)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    mctx.fillStyle = g;
    mctx.beginPath(); mctx.arc(p.x,p.y,px,0,6.2832); mctx.fill();
    mctx.fillStyle = '#fff';
  }
  maskDirty = animating;   // keep rebuilding while something is opening
}

function renderFog(now){
  if (!map || !fctx) return;
  var m = sizeCanvases(), size = m.s, dpr = m.dpr;
  L.DomUtil.setPosition(fogCanvas, map.containerPointToLayerPoint([0,0]));

  // 1. drifting cloud bed (half resolution — it is soft anyway)
  var cw = cloudCanvas.width, ch = cloudCanvas.height;
  cctx.setTransform(1,0,0,1,0,0);
  cctx.globalAlpha = 1;
  cctx.fillStyle = '#141720';
  cctx.fillRect(0,0,cw,ch);
  var drift = reduceMotion ? 0 : now;
  for (var i=0;i<noise.length;i++){
    var l = noise[i];
    var ox = (drift*l.vx) % (256*l.scale), oy = (drift*l.vy) % (256*l.scale);
    cctx.save();
    cctx.translate(ox, oy);
    cctx.scale(l.scale*0.5, l.scale*0.5);
    cctx.globalAlpha = l.alpha + (reduceMotion ? 0 : Math.sin(now/5200 + i)*0.05);
    cctx.fillStyle = l.pat;
    cctx.fillRect(-ox/(l.scale*0.5) - 300, -oy/(l.scale*0.5) - 300,
                  cw/(l.scale*0.5) + 600, ch/(l.scale*0.5) + 600);
    cctx.restore();
  }

  // 2. paint it across the viewport
  fctx.setTransform(1,0,0,1,0,0);
  fctx.globalCompositeOperation = 'source-over';
  fctx.globalAlpha = 1;
  fctx.clearRect(0,0,fogCanvas.width,fogCanvas.height);
  fctx.imageSmoothingEnabled = true;
  fctx.drawImage(cloudCanvas, 0, 0, fogCanvas.width, fogCanvas.height);

  // 3. carve out everything charted
  if (maskDirty) buildMask(now, dpr, size);
  fctx.globalCompositeOperation = 'destination-out';
  fctx.drawImage(maskCanvas, 0, 0);
  fctx.globalCompositeOperation = 'source-over';
}

function startLoop(){
  if (rafId) return;
  var step = function(now){
    rafId = requestAnimationFrame(step);
    if (now - lastFrame < (reduceMotion ? 200 : 33)) return;
    lastFrame = now;
    renderFog(now);
  };
  rafId = requestAnimationFrame(step);
}
function stopLoop(){ if (rafId){ cancelAnimationFrame(rafId); rafId = null; } }

/* ═══════════════════════════════════════════════════════════════
   REVEALING
   ═══════════════════════════════════════════════════════════════ */
function revealTrail(lat,lng){
  var k = cellKey(lat,lng);
  if (trailCells.has(k)) return;
  trailCells.add(k);
  reveals.push({ t:'t', lat:r4(lat), lng:r4(lng), r:cfg.revealRadiusM });
  var trail = 0;
  for (var i=reveals.length-1;i>=0 && trail<=MAX_TRAIL;i--) if (reveals[i].t==='t') trail++;
  if (trail > MAX_TRAIL){
    for (var j=0;j<reveals.length;j++) if (reveals[j].t==='t'){ reveals.splice(j,1); break; }
  }
  stampArea(lat,lng,cfg.revealRadiusM);
  maskDirty = true; save(); paintStats();
}

function revealPoi(poi, animate){
  var rg = buildRegion(poi);
  if (rg){
    reveals = reveals.filter(function(r){ return !(r.t === 'r' && r.id === poi.id); });
    if (animate) rg.born = performance.now();
    reveals.push(rg);
  } else {
    var c = { t:'c', lat:poi.lat, lng:poi.lng, r:25000 };
    if (animate) c.born = performance.now();
    reveals.push(c);
    stampArea(poi.lat, poi.lng, 25000);
  }
  maskDirty = true;
}

/* ═══════════════════════════════════════════════════════════════
   AUDIO — wind clearing, then a triumphant sting
   ═══════════════════════════════════════════════════════════════ */
function ensureAudio(){
  if (!audio){
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

function playDiscovery(){
  if (!cfg.sound) return;
  var ac = ensureAudio(); if (!ac) return;
  var t0 = ac.currentTime + 0.02;
  var out = ac.createGain(); out.gain.value = 0.9; out.connect(ac.destination);

  // --- wind: filtered noise sweeping open, then away ---
  var len = Math.floor(ac.sampleRate * 2.6);
  var buf = ac.createBuffer(1, len, ac.sampleRate), ch = buf.getChannelData(0);
  var last = 0;
  for (var i=0;i<len;i++){
    var white = Math.random()*2-1;
    last = 0.86*last + 0.14*white;      // brown-ish, softer than white
    ch[i] = last*1.6;
  }
  var src = ac.createBufferSource(); src.buffer = buf;
  var bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(320, t0);
  bp.frequency.exponentialRampToValueAtTime(2400, t0+0.9);
  bp.frequency.exponentialRampToValueAtTime(420, t0+2.4);
  var wg = ac.createGain();
  wg.gain.setValueAtTime(0.0001, t0);
  wg.gain.exponentialRampToValueAtTime(0.5, t0+0.5);
  wg.gain.exponentialRampToValueAtTime(0.0001, t0+2.5);
  src.connect(bp); bp.connect(wg); wg.connect(out);
  src.start(t0); src.stop(t0+2.6);

  // --- low swell under it ---
  var sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = 55;
  var sg = ac.createGain();
  sg.gain.setValueAtTime(0.0001, t0+0.5);
  sg.gain.exponentialRampToValueAtTime(0.34, t0+0.72);
  sg.gain.exponentialRampToValueAtTime(0.0001, t0+2.1);
  sub.connect(sg); sg.connect(out); sub.start(t0+0.5); sub.stop(t0+2.2);

  // --- the sting: an open fifth blooming into a major chord ---
  var delay = ac.createDelay(1.0); delay.delayTime.value = 0.28;
  var fb = ac.createGain(); fb.gain.value = 0.26;
  var wet = ac.createGain(); wet.gain.value = 0.34;
  delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(out);

  var notes = [
    { f:220.00, at:0.62 },   // A3
    { f:329.63, at:0.62 },   // E4
    { f:440.00, at:0.80 },   // A4
    { f:554.37, at:0.94 },   // C#5
    { f:659.25, at:1.06 }    // E5
  ];
  notes.forEach(function(n){
    var when = t0 + n.at;
    var o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = n.f;
    var o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = n.f*1.005;
    var lp = ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, when);
    lp.frequency.exponentialRampToValueAtTime(4200, when+0.16);
    lp.frequency.exponentialRampToValueAtTime(1100, when+1.5);
    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.16, when+0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, when+1.7);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out); g.connect(delay);
    o.start(when); o2.start(when); o.stop(when+1.8); o2.stop(when+1.8);
  });

  // --- bell shimmer on top ---
  var bell = ac.createOscillator(); bell.type = 'sine'; bell.frequency.value = 1760;
  var bg = ac.createGain();
  bg.gain.setValueAtTime(0.0001, t0+0.66);
  bg.gain.exponentialRampToValueAtTime(0.10, t0+0.70);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0+2.2);
  bell.connect(bg); bg.connect(out); bg.connect(delay);
  bell.start(t0+0.66); bell.stop(t0+2.3);
}

/* ═══════════════════════════════════════════════════════════════
   MAP
   ═══════════════════════════════════════════════════════════════ */
function buildMap(){
  map = L.map('map', {
    zoomControl:false, attributionControl:true,
    dragging:false, touchZoom:false, scrollWheelZoom:false, doubleClickZoom:false,
    boxZoom:false, keyboard:false, zoomSnap:0, zoomDelta:0,
    minZoom:MIN_ZOOM, maxZoom:MAX_ZOOM,
    center:[39.5,-98.35], zoom:cfg.zoom || 4
  });
  map.attributionControl.setPrefix('');
  setTiles(cfg.style);
  initFog();

  map.on('zoomend', function(){
    cfg.zoom = map.getZoom(); save();
    $('f-zoom').value = map.getZoom(); paintScale();
  });
  map.on('move', paintScale);
  map.on('click', function(e){
    if (!placeMode) return;
    setPlaceMode(false);
    addPoi(e.latlng.lat, e.latlng.lng);
  });
  window.addEventListener('resize', function(){ maskDirty = true; });
  window.addEventListener('orientationchange', function(){ setTimeout(function(){ maskDirty = true; }, 350); });
}

function setTiles(key){
  var s = STYLES[key] || STYLES.parchment;
  if (tiles) map.removeLayer(tiles);
  tiles = L.tileLayer(s.url, {
    attribution:s.attr, subdomains:s.sub||'abc',
    maxZoom:MAX_ZOOM, maxNativeZoom:s.max, detectRetina:true, crossOrigin:true, keepBuffer:2
  }).addTo(map);
  var c = map.getContainer();
  c.classList.remove('tint-aged','tint-ink');
  if (s.filter === 'aged') c.classList.add('tint-aged');
  if (s.filter === 'ink')  c.classList.add('tint-ink');
}

function viewHalfMeters(){
  var s = map.getSize();
  return Math.min(s.x,s.y)/2 * mpp(map.getCenter().lat, map.getZoom());
}
function paintScale(){
  var s = map.getSize();
  var across = Math.min(s.x,s.y) * mpp(map.getCenter().lat, map.getZoom());
  var ft = across*3.28084, txt;
  if (ft < 1200) txt = Math.round(ft/10)*10 + ' ft';
  else if (across < 16093) txt = (across/MILE).toFixed(1) + ' mi';
  else txt = Math.round(across/MILE) + ' mi';
  $('scale-val').textContent = txt;
}

function setZoom(z){
  z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  map.setZoom(z, { animate:false });
  cfg.zoom = z; save(); paintScale(); maskDirty = true;
}

function shiftWindow(lat,lng){
  var p = L.latLng(lat,lng);
  if (!anchor || p.distanceTo(anchor) > viewHalfMeters()*cfg.shiftThreshold){
    anchor = p;
    map.panTo(p, { animate:true, duration:0.9, easeLinearity:0.4 });
  }
}
function recenter(){
  if (!pos) return;
  anchor = L.latLng(pos.lat,pos.lng);
  map.setView(anchor, map.getZoom(), { animate:true, duration:0.6 });
  maskDirty = true;
}

/* ═══════════════════════════════════════════════════════════════
   POSITION
   ═══════════════════════════════════════════════════════════════ */
function onPosition(lat,lng,acc){
  var first = !pos;
  pos = { lat:lat, lng:lng, acc:acc };

  if (first){
    anchor = L.latLng(lat,lng);
    map.setView(anchor, cfg.zoom || 13, { animate:false });
    $('f-zoom').value = map.getZoom(); paintScale();
    hideGate();
  }
  if (!youMarker){
    youMarker = L.marker([lat,lng], {
      icon:L.divIcon({ className:'', html:'<div class="you"><b></b><i></i></div>',
                       iconSize:[28,28], iconAnchor:[14,14] }),
      interactive:false, keyboard:false, zIndexOffset:1000
    }).addTo(map);
    accCircle = L.circle([lat,lng], { radius:acc||0, pane:'markerPane', interactive:false,
      color:'#d9b45c', weight:1, opacity:.28, fillColor:'#d9b45c', fillOpacity:.05 }).addTo(map);
  } else {
    youMarker.setLatLng([lat,lng]);
    accCircle.setLatLng([lat,lng]).setRadius(acc||0);
  }

  revealTrail(lat,lng);
  checkArrivals(lat,lng);
  shiftWindow(lat,lng);
  paintStats();
}

/* ═══════════════════════════════════════════════════════════════
   POINTS OF INTEREST
   ═══════════════════════════════════════════════════════════════ */
function checkArrivals(lat,lng){
  var here = L.latLng(lat,lng);
  for (var i=0;i<pois.length;i++){
    var p = pois[i];
    if (p.found) continue;
    if (here.distanceTo(L.latLng(p.lat,p.lng)) <= cfg.arrivalRadiusM) discover(p);
  }
}
function discover(p){
  p.found = true;
  revealPoi(p, true);
  drawPoiMarker(p, true);
  announce(p);
  playDiscovery();
  if (navigator.vibrate) navigator.vibrate([20,70,34]);
  save(); paintStats(); paintList();
}

function drawPoiMarker(p, isNew){
  if (poiLayer[p.id]){ map.removeLayer(poiLayer[p.id]); delete poiLayer[p.id]; }
  if (!p.found) return;
  var html = '<div class="poi'+(isNew?' new':'')+'">'+
    '<svg width="26" height="30" viewBox="0 0 24 28">'+
    '<path d="M12 27C12 27 3.6 17.2 3.6 10.8A8.4 8.4 0 1 1 20.4 10.8C20.4 17.2 12 27 12 27Z" '+
      'fill="rgba(14,11,7,.9)" stroke="#d9b45c" stroke-width="1.2"/>'+
    '<path d="M12 5.6l1.7 3.9 4.2.4-3.2 2.8 1 4.1L12 14.6l-3.7 2.2 1-4.1-3.2-2.8 4.2-.4z" fill="#d9b45c"/>'+
    '</svg></div>';
  poiLayer[p.id] = L.marker([p.lat,p.lng], {
    icon:L.divIcon({ className:'', html:html, iconSize:[26,30], iconAnchor:[13,27] })
  }).addTo(map).bindTooltip(p.name, { direction:'top', offset:[0,-24], className:'poi-tip' });
}
function refreshPoiMarkers(){
  Object.keys(poiLayer).forEach(function(id){ map.removeLayer(poiLayer[id]); });
  poiLayer = {};
  pois.forEach(function(p){ drawPoiMarker(p,false); });
}

function addPoi(lat,lng,name){
  var n = name || ask('Name this place', 'Waypoint ' + (pois.length+1));
  if (n === null) return null;
  var p = { id:uid(), name:(n||'Unnamed').trim(), state:stateOf(lat,lng), lat:lat, lng:lng, found:false };
  pois.push(p); save(); paintList(); paintStats();
  toast('Added to the map: ' + p.name);
  if (pos) checkArrivals(pos.lat,pos.lng);
  return p;
}
function ask(m,d){ try { return window.prompt(m,d); } catch(e){ return d; } }

/* ═══════════════════════════════════════════════════════════════
   UI
   ═══════════════════════════════════════════════════════════════ */
function toast(msg){
  var t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(function(){ t.classList.remove('show'); }, 2800);
}
function announce(p){
  var b = $('banner');
  $('banner-name').textContent = p.name;
  $('banner-sub').textContent = p.state && STATES[p.state] ? STATES[p.state].name : 'the wilds';
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function setPlaceMode(on){
  placeMode = on;
  $('b-drop').classList.toggle('on', on);
  if (on) toast('Touch the map to mark a place.');
}
function hideGate(){
  var g = $('gate');
  g.classList.add('gone');
  setTimeout(function(){ g.style.display = 'none'; }, 600);
}

function paintStats(){
  var mi2 = chartedSqMi();
  $('s-area').innerHTML = (mi2 < 10 ? mi2.toFixed(2) : Math.round(mi2).toLocaleString()) +
    ' <small>mi²</small>';
  var found = pois.filter(function(p){ return p.found; }).length;
  $('s-poi').textContent = found + ' / ' + pois.length;
  $('s-acc').innerHTML = pos ? ('±'+Math.round(pos.acc)+' <small>m</small>') : '—';
}

function groupByState(list){
  var g = {};
  list.forEach(function(p){
    var k = p.state || 'ZZ';
    (g[k] = g[k] || []).push(p);
  });
  return g;
}

function paintList(){
  var q = ($('poi-search').value || '').toLowerCase();
  var el = $('poi-list');
  var list = pois.filter(function(p){
    if (!q) return true;
    var st = p.state && STATES[p.state] ? STATES[p.state].name.toLowerCase() : '';
    return p.name.toLowerCase().indexOf(q) >= 0 || st.indexOf(q) >= 0;
  });
  var g = groupByState(list);
  var keys = Object.keys(g).sort(function(a,b){
    var an = STATES[a] ? STATES[a].name : 'Elsewhere', bn = STATES[b] ? STATES[b].name : 'Elsewhere';
    return an < bn ? -1 : 1;
  });
  el.innerHTML = '';
  if (!keys.length){ el.innerHTML = '<div class="empty"><b>Nothing by that name</b>Try another place or state.</div>'; return; }

  keys.forEach(function(k){
    var h = document.createElement('div'); h.className = 'state-head';
    var found = g[k].filter(function(p){ return p.found; }).length;
    h.innerHTML = '<span>'+(STATES[k] ? STATES[k].name : 'Elsewhere')+'</span><em>'+found+'/'+g[k].length+'</em>';
    el.appendChild(h);
    g[k].forEach(function(p){
      var row = document.createElement('div');
      row.className = 'poi-row' + (p.found ? ' found' : '');
      row.innerHTML = '<span class="dot"></span><div class="meta"><div class="n"></div><div class="s"></div></div>';
      row.querySelector('.n').textContent = p.name;
      var d = pos ? L.latLng(p.lat,p.lng).distanceTo(L.latLng(pos.lat,pos.lng))/MILE : null;
      row.querySelector('.s').textContent = p.found
        ? 'Charted'
        : (d === null ? 'Unseen' : 'Unseen · ' + (d<1 ? '<1' : Math.round(d).toLocaleString()) + ' mi off');
      var act = document.createElement('button');
      if (cfg.sim){
        act.textContent = 'Travel';
        act.onclick = function(){ travelTo(p); };
      } else {
        act.textContent = 'Show';
        act.onclick = function(){ openSheet(false); map.setView([p.lat,p.lng], map.getZoom(), {animate:true}); anchor = L.latLng(p.lat,p.lng); maskDirty = true; };
      }
      row.appendChild(act);
      if (p.id.charAt(0) === 'u'){
        var del = document.createElement('button'); del.textContent = '✕'; del.className = 'x';
        del.onclick = function(){
          pois = pois.filter(function(x){ return x.id !== p.id; });
          reveals = reveals.filter(function(r){ return r.id !== p.id; });
          if (poiLayer[p.id]){ map.removeLayer(poiLayer[p.id]); delete poiLayer[p.id]; }
          maskDirty = true; save(); paintList(); paintStats();
        };
        row.appendChild(del);
      }
      el.appendChild(row);
    });
  });
}

function travelTo(p){
  simPos = { lat:p.lat, lng:p.lng };
  cfg.simLat = p.lat; cfg.simLng = p.lng;
  onPosition(p.lat, p.lng, 5);
  recenter(); openSheet(false);
}

function openSheet(open){
  $('sheet').classList.toggle('show', open);
  $('scrim').classList.toggle('show', open);
  if (open) paintList();
}

function paintSettings(){
  $('f-trail').value = cfg.revealRadiusM;
  $('l-trail').textContent = cfg.revealRadiusM + ' m';
  $('f-arrive').value = cfg.arrivalRadiusM;
  $('l-arrive').textContent = (cfg.arrivalRadiusM/MILE).toFixed(1) + ' mi';
  $('f-shift').value = cfg.shiftThreshold;
  $('l-shift').textContent = Math.round(cfg.shiftThreshold*100) + '%';
  $('f-style').value = cfg.style;
  $('f-sim').checked = !!cfg.sim;
  $('f-sound').checked = !!cfg.sound;
  $('pad').classList.toggle('show', !!cfg.sim);
}

/* ═══════════════════════════════════════════════════════════════
   SETUP — the first conversation
   ═══════════════════════════════════════════════════════════════ */
var visited = {}, added = [];

function openSetup(){
  $('setup').style.display = 'flex';
  paintSetupList();
  showStep(1);
}
function showStep(n){
  $('step1').style.display = n === 1 ? 'flex' : 'none';
  $('step2').style.display = n === 2 ? 'flex' : 'none';
}
function paintSetupList(){
  var q = ($('setup-search').value || '').toLowerCase();
  var el = $('setup-list'); el.innerHTML = '';
  var g = groupByState(pois.filter(function(p){
    if (!q) return true;
    var st = p.state && STATES[p.state] ? STATES[p.state].name.toLowerCase() : '';
    return p.name.toLowerCase().indexOf(q) >= 0 || st.indexOf(q) >= 0;
  }));
  Object.keys(g).sort(function(a,b){
    return (STATES[a]?STATES[a].name:'zz') < (STATES[b]?STATES[b].name:'zz') ? -1 : 1;
  }).forEach(function(k){
    var h = document.createElement('div'); h.className = 'state-head';
    h.innerHTML = '<span>'+(STATES[k]?STATES[k].name:'Elsewhere')+'</span>';
    el.appendChild(h);
    g[k].forEach(function(p){
      var row = document.createElement('button');
      row.className = 'check' + (visited[p.id] ? ' on' : '');
      row.innerHTML = '<span class="box"></span><span class="nm"></span>';
      row.querySelector('.nm').textContent = p.name;
      row.onclick = function(){
        visited[p.id] = !visited[p.id];
        row.classList.toggle('on', !!visited[p.id]);
        countVisited();
      };
      el.appendChild(row);
    });
  });
  countVisited();
}
function countVisited(){
  var n = Object.keys(visited).filter(function(k){ return visited[k]; }).length;
  $('setup-count').textContent = n === 0 ? 'Nothing yet' :
    n + (n === 1 ? ' place seen' : ' places seen');
}

function searchPlace(){
  var q = ($('add-search').value || '').trim();
  if (!q) return;
  var box = $('add-results');
  box.innerHTML = '<div class="hint">Searching the maps…</div>';
  fetch('https://nominatim.openstreetmap.org/search?format=json&limit=6&q=' + encodeURIComponent(q))
    .then(function(r){ return r.json(); })
    .then(function(list){
      if (!list.length){ box.innerHTML = '<div class="hint">No such place found. You can enter coordinates instead.</div>'; return; }
      box.innerHTML = '';
      list.forEach(function(r){
        var b = document.createElement('button'); b.className = 'result';
        b.textContent = r.display_name;
        b.onclick = function(){
          var name = r.display_name.split(',')[0];
          var lat = parseFloat(r.lat), lng = parseFloat(r.lon);
          added.push({ id:uid(), name:name, state:stateOf(lat,lng), lat:lat, lng:lng, found:false });
          $('add-search').value = ''; box.innerHTML = '';
          paintAdded();
        };
        box.appendChild(b);
      });
    })
    .catch(function(){
      box.innerHTML = '<div class="hint">The map service did not answer. Try coordinates instead.</div>';
    });
}
function paintAdded(){
  var el = $('added-list'); el.innerHTML = '';
  if (!added.length){ el.innerHTML = '<div class="hint">Nothing added yet — this is optional.</div>'; return; }
  added.forEach(function(p,i){
    var row = document.createElement('div'); row.className = 'poi-row';
    row.innerHTML = '<span class="dot"></span><div class="meta"><div class="n"></div><div class="s"></div></div>';
    row.querySelector('.n').textContent = p.name;
    row.querySelector('.s').textContent = p.state && STATES[p.state] ? STATES[p.state].name : 'Beyond the states';
    var x = document.createElement('button'); x.textContent = '✕'; x.className = 'x';
    x.onclick = function(){ added.splice(i,1); paintAdded(); };
    row.appendChild(x); el.appendChild(row);
  });
}

function finishSetup(){
  added.forEach(function(p){ pois.push(p); });
  added = [];
  var any = false;
  pois.forEach(function(p){
    if (visited[p.id]){ p.found = true; revealPoi(p, false); any = true; }
  });
  setupDone = true; save();
  refreshPoiMarkers(); paintStats(); paintList();
  $('setup').style.display = 'none';
  maskDirty = true;
  if (any) toast('Your travels are on the map.');
  beginTracking();
}

/* ═══════════════════════════════════════════════════════════════
   TRACKING
   ═══════════════════════════════════════════════════════════════ */
function keepAwake(){
  try { if ('wakeLock' in navigator && !wakeLock)
    navigator.wakeLock.request('screen').then(function(l){ wakeLock = l; }).catch(function(){});
  } catch(e){}
}
document.addEventListener('visibilitychange', function(){
  if (document.visibilityState === 'visible'){ wakeLock = null; keepAwake(); maskDirty = true; startLoop(); }
  else stopLoop();
});

function beginTracking(){
  keepAwake();
  if (cfg.sim){ startSim(); return; }
  if (!('geolocation' in navigator)){
    $('g-err').textContent = 'This browser cannot find you. Use the map without GPS instead.';
    return;
  }
  $('g-err').textContent = 'Searching for you…';
  navigator.geolocation.getCurrentPosition(function(p){
    $('g-err').textContent = '';
    onPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
    watchId = navigator.geolocation.watchPosition(function(q){
      if (q.coords.accuracy <= cfg.maxAccuracyM || !pos)
        onPosition(q.coords.latitude, q.coords.longitude, q.coords.accuracy);
      else { pos.acc = q.coords.accuracy; paintStats(); }
    }, function(){}, { enableHighAccuracy:true, maximumAge:3000, timeout:25000 });
  }, function(err){
    $('g-err').textContent = err.code === 1
      ? 'Location is blocked. Allow it in Settings → Safari → Location, or explore without GPS.'
      : 'No fix yet — open sky helps. You can also explore without GPS.';
  }, { enableHighAccuracy:true, timeout:25000, maximumAge:0 });
}

function startSim(lat,lng){
  cfg.sim = true; save(); paintSettings(); keepAwake();
  if (watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; }
  simPos = {
    lat: lat != null ? lat : (cfg.simLat != null ? cfg.simLat : 34.8526),
    lng: lng != null ? lng : (cfg.simLng != null ? cfg.simLng : -82.3940)
  };
  onPosition(simPos.lat, simPos.lng, 5);
  if (simTimer) clearInterval(simTimer);
  simTimer = setInterval(function(){
    if (!simVec.x && !simVec.y) return;
    var perSec = viewHalfMeters()/7 * (simSprint ? 4 : 1);
    var step = perSec/8;
    simPos.lat += (simVec.y*step)/111320;
    simPos.lng += (simVec.x*step)/(111320*Math.cos(simPos.lat*Math.PI/180));
    cfg.simLat = simPos.lat; cfg.simLng = simPos.lng;
    onPosition(simPos.lat, simPos.lng, 5);
  }, 125);
}
function stopSim(){
  cfg.sim = false; save(); paintSettings();
  if (simTimer){ clearInterval(simTimer); simTimer = null; }
  simVec = {x:0,y:0};
  beginTracking();
}

/* ═══════════════════════════════════════════════════════════════
   WIRING
   ═══════════════════════════════════════════════════════════════ */
function wire(){
  $('g-start').onclick = function(){
    ensureAudio();
    if (!setupDone) { hideGate(); openSetup(); }
    else { hideGate(); beginTracking(); }
  };
  $('g-sim').onclick = function(){
    ensureAudio(); cfg.sim = true;
    if (!setupDone){ hideGate(); openSetup(); }
    else { hideGate(); startSim(); }
  };

  // setup wizard
  $('setup-search').oninput = paintSetupList;
  $('s1-next').onclick = function(){ showStep(2); paintAdded(); };
  $('s1-none').onclick = function(){ visited = {}; paintSetupList(); showStep(2); paintAdded(); };
  $('add-go').onclick = searchPlace;
  $('add-search').onkeydown = function(e){ if (e.key === 'Enter'){ e.preventDefault(); searchPlace(); } };
  $('add-coord').onclick = function(){
    var s = ask('Enter latitude, longitude', '');
    if (!s) return;
    var parts = s.split(/[, ]+/).map(parseFloat);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])){ toast('Those coordinates did not read.'); return; }
    var n = ask('Name this place', 'New waypoint');
    added.push({ id:uid(), name:n||'New waypoint', state:stateOf(parts[0],parts[1]),
                 lat:parts[0], lng:parts[1], found:false });
    paintAdded();
  };
  $('s2-done').onclick = finishSetup;

  // HUD
  $('b-center').onclick = recenter;
  $('b-sheet').onclick  = function(){ openSheet(true); };
  $('b-drop').onclick   = function(){ setPlaceMode(!placeMode); };
  $('scrim').onclick    = function(){ openSheet(false); };
  $('poi-search').oninput = paintList;

  // zoom rail
  $('f-zoom').oninput = function(){ setZoom(parseFloat(this.value)); };
  $('z-in').onclick   = function(){ var v = map.getZoom()+1; $('f-zoom').value = v; setZoom(v); };
  $('z-out').onclick  = function(){ var v = map.getZoom()-1; $('f-zoom').value = v; setZoom(v); };

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function(t){
    t.onclick = function(){
      document.querySelectorAll('.tab').forEach(function(x){ x.classList.remove('on'); });
      document.querySelectorAll('.pane').forEach(function(x){ x.classList.remove('on'); });
      t.classList.add('on'); $(t.dataset.pane).classList.add('on');
      if (t.dataset.pane === 'p-set') paintSettings();
    };
  });

  $('a-add-here').onclick = function(){
    if (!pos){ toast('Waiting to find you.'); return; }
    addPoi(pos.lat, pos.lng);
  };
  $('a-add-coord').onclick = function(){
    var s = ask('Enter latitude, longitude', pos ? pos.lat.toFixed(5)+', '+pos.lng.toFixed(5) : '');
    if (!s) return;
    var parts = s.split(/[, ]+/).map(parseFloat);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])){ toast('Those coordinates did not read.'); return; }
    addPoi(parts[0], parts[1]);
  };

  $('f-trail').oninput  = function(){ cfg.revealRadiusM = +this.value; $('l-trail').textContent = this.value+' m'; };
  $('f-trail').onchange = save;
  $('f-arrive').oninput = function(){ cfg.arrivalRadiusM = +this.value; $('l-arrive').textContent = (this.value/MILE).toFixed(1)+' mi'; };
  $('f-arrive').onchange= function(){ save(); if (pos) checkArrivals(pos.lat,pos.lng); };
  $('f-shift').oninput  = function(){ cfg.shiftThreshold = +this.value; $('l-shift').textContent = Math.round(this.value*100)+'%'; };
  $('f-shift').onchange = save;
  $('f-style').onchange = function(){ cfg.style = this.value; save(); setTiles(cfg.style); maskDirty = true; };
  $('f-sound').onchange = function(){ cfg.sound = this.checked; save(); if (this.checked){ ensureAudio(); playDiscovery(); } };
  $('f-sim').onchange   = function(){ if (this.checked) startSim(pos?pos.lat:undefined, pos?pos.lng:undefined); else stopSim(); paintList(); };

  $('a-export').onclick = function(){
    var blob = new Blob([localStorage.getItem(STORE)||'{}'], {type:'application/json'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'openworld-journal.json'; a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  };
  $('a-import').onclick = function(){
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = function(){
      var f = inp.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function(){
        try { JSON.parse(fr.result); localStorage.setItem(STORE, fr.result); location.reload(); }
        catch(e){ toast('That file is not a journal.'); }
      };
      fr.readAsText(f);
    };
    inp.click();
  };
  $('a-redo').onclick = function(){
    visited = {}; pois.forEach(function(p){ if (p.found) visited[p.id] = true; });
    openSheet(false); openSetup();
  };
  $('a-reset').onclick = function(){
    if (!confirm('Let the fog return? Every charted mile is forgotten.')) return;
    reveals = []; trailCells = new Set(); areaCells = new Set();
    pois.forEach(function(p){ p.found = false; });
    refreshPoiMarkers(); maskDirty = true; save(); paintStats(); paintList();
    toast('The world is dark again.');
  };

  // d-pad + keys
  var dirs = { n:{x:0,y:1}, s:{x:0,y:-1}, e:{x:1,y:0}, w:{x:-1,y:0}, stop:{x:0,y:0} };
  Array.prototype.forEach.call(document.querySelectorAll('#pad button'), function(b){
    b.onclick = function(){ simVec = Object.assign({}, dirs[b.dataset.dir]); };
  });
  var keymap = { ArrowUp:'n', ArrowDown:'s', ArrowLeft:'w', ArrowRight:'e',
                 w:'n', s:'s', a:'w', d:'e', W:'n', S:'s', A:'w', D:'e' };
  window.addEventListener('keydown', function(e){
    if (e.key === 'Shift') simSprint = true;
    if (!cfg.sim || !keymap[e.key]) return;
    e.preventDefault(); simVec = Object.assign({}, dirs[keymap[e.key]]);
  });
  window.addEventListener('keyup', function(e){
    if (e.key === 'Shift') simSprint = false;
    if (cfg.sim && keymap[e.key]) simVec = {x:0,y:0};
  });
  document.addEventListener('gesturestart', function(e){ e.preventDefault(); });
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════ */
load();
buildMap();
wire();
refreshPoiMarkers();
paintStats();
paintSettings();
$('f-zoom').value = map.getZoom();
paintScale();

if ('serviceWorker' in navigator && location.protocol === 'https:'){
  window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
}
})();
