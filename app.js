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
  pathOpacity   : 0.4,    // faint red trail; 0 hides it
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
var MASK_SCALE= 0.22;  // masks drawn small, then upscaled — this is what softens every edge
var LORE_FULL = 5.6;   // below this zoom the realm is fully illustrated
var LORE_GONE = 8.2;   // above this it is a plain modern map

/* ═══════════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════════ */
var cfg = Object.assign({}, DEFAULTS);
var pois = [], reveals = [], trailCells = new Set(), areaCells = new Set();
var setupDone = false;

var map, tiles, fogCanvas, fctx, maskCanvas, mctx, cloudCanvas, cctx, landCanvas, lctx;
var noise = [], maskDirty = true, landDirty = true, rafId = null, lastFrame = 0;
var canBlur = false;
var youMarker, accCircle, poiLayer = {}, loreLayer = null, pathLines = [];
var path = [];                    // array of segments, each an array of [lat,lng]
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
    path      = Array.isArray(raw.path) ? raw.path : [];
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
        reveals: reveals,
        path: path
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
  landCanvas = document.createElement('canvas');  lctx = landCanvas.getContext('2d');
  try { fctx.filter = 'blur(2px)'; canBlur = fctx.filter !== 'none'; fctx.filter = 'none'; }
  catch(e){ canBlur = false; }

  noise = [
    { img:makeNoise(256, 4, 4, 0.34, 300), scale:2.6, vx: 0.0042, vy:-0.0016, alpha:0.40 },
    { img:makeNoise(256, 6, 4, 0.40, 340), scale:1.5, vx:-0.0068, vy: 0.0027, alpha:0.34 },
    { img:makeNoise(256, 3, 3, 0.30, 260), scale:4.2, vx: 0.0019, vy: 0.0011, alpha:0.30 }
  ].map(function(l){ l.pat = cctx.createPattern(l.img,'repeat'); return l; });

  map.on('move zoom viewreset resize moveend zoomend', function(){ maskDirty = true; landDirty = true; });
  startLoop();
}

function mpp(lat, z){ return 156543.03392 * Math.cos(lat*Math.PI/180) / Math.pow(2, z); }

function sizeCanvases(){
  var s = map.getSize(), dpr = Math.min(window.devicePixelRatio||1, 2);
  var W = Math.round(s.x*dpr), H = Math.round(s.y*dpr);
  if (fogCanvas.width !== W || fogCanvas.height !== H){
    fogCanvas.width = W; fogCanvas.height = H;
    fogCanvas.style.width = s.x+'px'; fogCanvas.style.height = s.y+'px';
    cloudCanvas.width  = Math.max(2, Math.round(s.x*0.5));
    cloudCanvas.height = Math.max(2, Math.round(s.y*0.5));
    maskCanvas.width  = landCanvas.width  = Math.max(2, Math.round(s.x*MASK_SCALE));
    maskCanvas.height = landCanvas.height = Math.max(2, Math.round(s.y*MASK_SCALE));
    maskDirty = landDirty = true;
  }
  return { s:s, dpr:dpr };
}

function softRect(ctx,x,y,w,h,r){
  r = Math.max(0, Math.min(r, Math.min(w,h)/2));
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x,y,w,h,r);
  else {
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  }
  ctx.fill();
}

/* The realm boundary — fog never spills onto the oceans or the
   neighbouring kingdoms. */
function buildLand(){
  lctx.setTransform(MASK_SCALE,0,0,MASK_SCALE,0,0);
  lctx.clearRect(0,0,landCanvas.width/MASK_SCALE, landCanvas.height/MASK_SCALE);
  lctx.fillStyle = '#fff';
  var rings = D.OUTLINE || [];
  for (var r=0;r<rings.length;r++){
    var ring = rings[r];
    lctx.beginPath();
    for (var i=0;i<ring.length;i++){
      var p = map.latLngToContainerPoint([ring[i][1], ring[i][0]]);
      if (i === 0) lctx.moveTo(p.x,p.y); else lctx.lineTo(p.x,p.y);
    }
    lctx.closePath(); lctx.fill();
  }
  landDirty = false;
}

function buildMask(now, dpr, size){
  mctx.setTransform(MASK_SCALE,0,0,MASK_SCALE,0,0);
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
      var cellPx = (rv.h*111320)/m;
      var grow = cellPx*0.55;                       // overlap neighbours so runs melt together
      mctx.shadowColor = 'rgba(255,255,255,1)';
      mctx.shadowBlur  = Math.max(3, Math.min(40, cellPx*0.7));
      for (var k=0;k<rv.runs.length;k++){
        var run = rv.runs[k];
        var nw = map.latLngToContainerPoint([run[0]+rv.h/2, run[1]-rv.w/2]);
        var se = map.latLngToContainerPoint([run[0]-rv.h/2, run[2]+rv.w/2]);
        var x = nw.x-grow, y = nw.y-grow;
        var w = Math.max(1,se.x-nw.x)+grow*2, h = Math.max(1,se.y-nw.y)+grow*2;
        softRect(mctx, x, y, w, h, Math.min(w,h)*0.5);
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
    if (px < 0.4) continue;
    var g = mctx.createRadialGradient(p.x,p.y,px*0.35, p.x,p.y,px*1.15);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.55,'rgba(255,255,255,0.9)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    mctx.fillStyle = g;
    mctx.beginPath(); mctx.arc(p.x,p.y,px*1.15,0,6.2832); mctx.fill();
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
  fctx.filter = 'none';
  fctx.clearRect(0,0,fogCanvas.width,fogCanvas.height);
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = 'high';
  fctx.drawImage(cloudCanvas, 0, 0, fogCanvas.width, fogCanvas.height);

  // 3. keep the fog on land only — the seas and the neighbouring realms stay clear
  if (clipToLand()){
    if (landDirty) buildLand();
    fctx.globalCompositeOperation = 'destination-in';
    if (canBlur) fctx.filter = 'blur(' + Math.round(fogCanvas.width*0.006) + 'px)';
    fctx.drawImage(landCanvas, 0, 0, fogCanvas.width, fogCanvas.height);
    fctx.filter = 'none';
  }

  // 4. carve out everything charted
  if (maskDirty) buildMask(now, dpr, size);
  fctx.globalCompositeOperation = 'destination-out';
  if (canBlur) fctx.filter = 'blur(' + Math.round(fogCanvas.width*0.008) + 'px)';
  fctx.drawImage(maskCanvas, 0, 0, fogCanvas.width, fogCanvas.height);
  fctx.filter = 'none';
  fctx.globalCompositeOperation = 'source-over';
}

/* Clipping is right at home over America. Elsewhere in the world there is
   no outline to clip to, so once you are travelling locally we let the fog
   cover everything again. */
function clipToLand(){
  if (map.getZoom() < 9) return true;
  var c = map.getCenter();
  return !!stateOf(c.lat, c.lng) || pointInOutline(c.lat, c.lng);
}
function pointInOutline(lat,lng){
  var rings = D.OUTLINE || [], hit = false;
  for (var r=0;r<rings.length;r++){
    var ring = rings[r];
    for (var i=0,j=ring.length-1;i<ring.length;j=i++){
      var xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
      if (((yi>lat)!==(yj>lat)) && (lng < (xj-xi)*(lat-yi)/(yj-yi)+xi)) hit = !hit;
    }
  }
  return hit;
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
   MARGINALIA — creatures and lettering for the world-scale chart
   ═══════════════════════════════════════════════════════════════ */
var ART = {
  serpent:
    '<svg viewBox="0 0 150 62"><g class="ink">'+
    '<path class="soft" d="M10 50C10 30 20 20 32 20c12 0 22 10 22 30h-10c0-14-5-20-12-20s-12 6-12 20z"/>'+
    '<path class="soft" d="M56 50c0-18 10-28 22-28s22 10 22 28h-10c0-12-5-18-12-18s-12 6-12 18z"/>'+
    '<path class="soft" d="M102 50c0-12 6-20 16-22 10-2 16-8 18-16l10 4c-4 12-14 20-26 22-6 1-8 6-8 12z"/>'+
    '<path class="soft" d="M132 4c10-4 18 2 16 10-2 8-12 10-18 6l-10 4 4-9-6-7z"/>'+
    '<circle cx="138" cy="12" r="2.2" class="fill"/>'+
    '<path class="thin" d="M0 56c14 0 16-4 28-4M44 54c12 0 14 4 26 4M78 56c12 0 14-4 26-4M116 54c12 0 16 4 28 4"/>'+
    '</g></svg>',
  hydra:
    '<svg viewBox="0 0 130 112"><g class="ink">'+
    '<path class="soft" d="M28 100c0-14 16-22 36-22s36 8 36 22z"/>'+
    '<path class="soft" d="M44 84C34 66 30 46 38 32l12 6c-6 14-4 30 6 46z"/>'+
    '<path class="soft" d="M60 80c-2-22-2-42 2-58l12 2c-4 18-4 36-2 56z"/>'+
    '<path class="soft" d="M82 84c10-16 14-34 8-48l-12 4c6 14 4 28-6 42z"/>'+
    '<path class="soft" d="M34 30c-4-12 4-20 14-16l10-4-4 10 6 6H48c-4 6-10 8-14 4z"/>'+
    '<path class="soft" d="M58 20c-2-12 8-18 16-12l10-2-6 9 4 7-12-2c-4 5-10 5-12 0z"/>'+
    '<path class="soft" d="M86 34c-2-12 8-20 16-14l10-2-6 9 4 7-12-2c-4 6-10 6-12 2z"/>'+
    '<circle cx="44" cy="20" r="2" class="fill"/><circle cx="68" cy="12" r="2" class="fill"/>'+
    '<circle cx="96" cy="24" r="2" class="fill"/>'+
    '<path class="thin" d="M2 104c16 0 18-4 30-4M96 100c14 0 16 4 30 4"/>'+
    '</g></svg>',
  kraken:
    '<svg viewBox="0 0 130 100"><g class="ink">'+
    '<path class="soft" d="M65 18c18 0 30 13 30 29 0 12-13 20-30 20S35 59 35 47c0-16 12-29 30-29z"/>'+
    '<circle cx="53" cy="45" r="5.5"/><circle cx="77" cy="45" r="5.5"/>'+
    '<circle cx="53" cy="45" r="2.2" class="fill"/><circle cx="77" cy="45" r="2.2" class="fill"/>'+
    '<path class="soft" d="M40 58c-12 6-18 20-32 22-8 1-8-8 0-10 10-3 18-10 26-20z"/>'+
    '<path class="soft" d="M50 65c-4 13-8 25-20 30l-4-8c8-5 12-15 16-27z"/>'+
    '<path class="soft" d="M80 65c4 13 8 25 20 30l4-8c-8-5-12-15-16-27z"/>'+
    '<path class="soft" d="M90 58c12 6 18 20 32 22 8 1 8-8 0-10-10-3-18-10-26-20z"/>'+
    '<path class="soft" d="M65 67c3 12 2 21-3 30l10-1c3-11 2-19 1-29z"/>'+
    '<path class="thin" d="M0 90c14 0 16-4 28-4M100 86c14 0 16 4 28 4"/>'+
    '</g></svg>',
  yeti:
    '<svg viewBox="0 0 110 116"><g class="ink">'+
    '<path class="soft" d="M55 6c12 0 19 9 17 21 12 4 20 13 24 25l10 14-10 2-4-8c1 14-4 26-12 32l4 18H72l-4-14'+
    'c-4 2-8 3-13 3s-9-1-13-3l-4 14H26l4-18c-8-6-13-18-12-32l-4 8-10-2 10-14c4-12 12-21 24-25C36 15 43 6 55 6z"/>'+
    '<path class="thin" d="M18 44l-7-5M23 34l-5-7M92 44l7-5M87 34l5-7M30 92l-6 6M80 92l6 6M40 62c6 8 24 8 30 0"/>'+
    '<circle cx="46" cy="30" r="2.6" class="fill"/><circle cx="64" cy="30" r="2.6" class="fill"/>'+
    '<path d="M47 42c5 4 11 4 16 0"/>'+
    '</g></svg>',
  dragon:
    '<svg viewBox="0 0 140 96"><g class="ink">'+
    '<path class="soft" d="M66 50c-8-4-14-14-12-24 1-6 6-6 9-2 4 6 5 16 7 22z"/>'+
    '<path class="soft" d="M62 40C46 22 26 12 4 12c12 10 16 20 18 32 12-6 28-4 40 4z"/>'+
    '<path class="soft" d="M78 40c16-18 36-28 58-28-12 10-16 20-18 32-12-6-28-4-40 4z"/>'+
    '<path class="soft" d="M68 50c2 14 8 24 20 30 8 4 16 0 16-6-8 0-16-6-20-16z"/>'+
    '<path class="soft" d="M74 30c8-10 20-8 22 0 2 8-6 12-12 10l-6 8-4-8-8-2z"/>'+
    '<circle cx="86" cy="30" r="2" class="fill"/>'+
    '<path class="thin" d="M100 76c8 2 14 0 18-6"/>'+
    '</g></svg>',
  ship:
    '<svg viewBox="0 0 100 90"><g class="ink">'+
    '<path class="soft" d="M14 66h72l-10 14H24z"/><path d="M50 66V10"/>'+
    '<path class="soft" d="M50 16c14 4 20 10 22 16-8 4-16 4-22 2zM50 40c-14 3-20 8-22 14 8 4 16 4 22 2z"/>'+
    '<path d="M50 10l12 4-12 4z" class="fill"/>'+
    '<path class="thin" d="M2 82c12 0 14-4 24-4M74 78c10 0 12 4 24 4"/>'+
    '</g></svg>',
  whale:
    '<svg viewBox="0 0 120 70"><g class="ink">'+
    '<path class="soft" d="M20 48c8-12 26-18 44-14 12 3 20 9 28 8l14-6-8 14 8 12-16-6c-10 2-18 6-30 6-22 0-36-6-40-14z"/>'+
    '<circle cx="36" cy="44" r="1.8" class="fill"/>'+
    '<path class="thin" d="M40 30c2-8 0-12-4-16M40 30c6-6 8-10 8-16"/>'+
    '<path class="thin" d="M4 62c12 0 14-4 24-4M88 60c10 0 12 4 24 4"/>'+
    '</g></svg>',
  volcano:
    '<svg viewBox="0 0 100 90"><g class="ink">'+
    '<path class="soft" d="M8 82h84L62 30H38z"/><path d="M38 30h24"/>'+
    '<path class="thin" d="M44 26c-2-8 2-14 0-20M56 26c2-8-2-14 0-20M50 22c0-10 0-14 0-18"/>'+
    '<path class="thin" d="M46 42l6 16 8-10 4 22"/>'+
    '</g></svg>',
  peaks:
    '<svg viewBox="0 0 120 60"><g class="ink">'+
    '<path class="soft" d="M4 54l24-38 18 26 14-20 22 32z"/><path class="soft" d="M62 54l20-28 34 28z"/>'+
    '<path class="thin" d="M28 22l6 8-6 6-6-6zM82 30l5 7-5 5-5-5z"/>'+
    '</g></svg>',
  pines:
    '<svg viewBox="0 0 100 60"><g class="ink">'+
    '<path class="soft" d="M20 52H10l10-16 10 16zM20 40h-7l7-12 7 12z"/><path d="M20 52v6"/>'+
    '<path class="soft" d="M50 54H38l12-20 12 20zM50 40h-8l8-14 8 14z"/><path d="M50 54v6"/>'+
    '<path class="soft" d="M80 52H70l10-16 10 16zM80 40h-7l7-12 7 12z"/><path d="M80 52v6"/>'+
    '</g></svg>',
  castle:
    '<svg viewBox="0 0 90 70"><g class="ink">'+
    '<path class="soft" d="M14 62V28h62v34z"/><path d="M14 28v-8h8v6h10v-6h8v6h10v-6h8v6h10v-6h8v8"/>'+
    '<path d="M40 62V46h10v16z"/><path class="thin" d="M24 38h8v8h-8zM58 38h8v8h-8z"/>'+
    '</g></svg>',
  compass:
    '<svg viewBox="0 0 120 120"><g class="ink">'+
    '<circle cx="60" cy="60" r="54"/><circle cx="60" cy="60" r="42" class="thin"/>'+
    '<path d="M60 6l8 46 46 8-46 8-8 46-8-46-46-8 46-8z" class="soft"/>'+
    '<path class="thin" d="M88 32L68 52M32 88l20-20M88 88L68 68M32 32l20 20"/>'+
    '<circle cx="60" cy="60" r="5" class="fill"/>'+
    '</g></svg>'
};


function buildLore(){
  map.createPane('lore');
  var pane = map.getPane('lore');
  pane.style.zIndex = 430;
  pane.style.pointerEvents = 'none';
  pane.style.transition = 'opacity .35s';

  map.createPane('trail');
  map.getPane('trail').style.zIndex = 470;
  map.getPane('trail').style.pointerEvents = 'none';

  loreLayer = L.layerGroup([], { pane:'lore' }).addTo(map);

  (D.LORE || []).forEach(function(m){
    var art = ART[m.kind]; if (!art) return;
    var w = Math.round(m.size*1.25);
    L.marker([m.lat,m.lng], {
      pane:'lore', interactive:false, keyboard:false,
      icon:L.divIcon({ className:'', html:'<div class="lore" style="width:'+w+'px;height:'+m.size+'px">'+art+'</div>',
                       iconSize:[w,m.size], iconAnchor:[w/2,m.size/2] })
    }).addTo(loreLayer);
  });

  (D.LABELS || []).forEach(function(t){
    L.marker([t.lat,t.lng], {
      pane:'lore', interactive:false, keyboard:false,
      icon:L.divIcon({ className:'',
        html:'<div class="lore-label" style="font-size:'+t.size+'px;transform:rotate('+(t.rot||0)+'deg)">'+
             t.text+'</div>', iconSize:[0,0], iconAnchor:[0,0] })
    }).addTo(loreLayer);
  });
}

/* ═══════════════════════════════════════════════════════════════
   TRAVEL PATH
   ═══════════════════════════════════════════════════════════════ */
function notePath(lat,lng){
  var seg = path[path.length-1];
  if (seg && seg.length){
    var last = seg[seg.length-1];
    var d = L.latLng(last[0],last[1]).distanceTo(L.latLng(lat,lng));
    if (d < 12) return;                       // standing still
    if (d > 25000) seg = null;                // a jump, not a journey — start a new line
  }
  if (!seg){ seg = []; path.push(seg); }
  seg.push([r4(lat), r4(lng)]);
  if (seg.length > 4000) seg.splice(0, seg.length-4000);
  drawPath();
  save();
}
function newPathSegment(){ if (path.length && path[path.length-1].length) path.push([]); }

function drawPath(){
  pathLines.forEach(function(l){ map.removeLayer(l); });
  pathLines = [];
  if (!cfg.pathOpacity) return;
  path.forEach(function(seg){
    if (seg.length < 2) return;
    pathLines.push(L.polyline(seg, {
      pane:'trail', color:'#c0442c', weight:2, opacity:cfg.pathOpacity,
      dashArray:'2 7', lineCap:'round', interactive:false, smoothFactor:1.4
    }).addTo(map));
  });
}

/* ═══════════════════════════════════════════════════════════════
   MAP
   ═══════════════════════════════════════════════════════════════ */
function buildMap(){
  map = L.map('map', {
    zoomControl:false, attributionControl:true,
    dragging:false, keyboard:false, boxZoom:false,
    touchZoom:true, scrollWheelZoom:true, doubleClickZoom:true, bounceAtZoomLimits:true,
    zoomSnap:0, zoomDelta:0.6, wheelPxPerZoomLevel:90,
    minZoom:MIN_ZOOM, maxZoom:MAX_ZOOM,
    center:[39.5,-98.35], zoom:cfg.zoom || 4
  });
  map.attributionControl.setPrefix('');
  setTiles(cfg.style);
  buildLore();
  initFog();

  map.on('zoom', function(){ applyEra(map.getZoom()); paintScale(); });
  map.on('zoomend', function(){ cfg.zoom = map.getZoom(); save(); applyEra(map.getZoom()); paintScale(); });
  map.on('move', paintScale);
  map.on('click', function(e){
    if (!placeMode) return;
    setPlaceMode(false);
    addPoi(e.latlng.lat, e.latlng.lng);
  });
  window.addEventListener('resize', function(){ maskDirty = landDirty = true; });
  window.addEventListener('orientationchange', function(){
    setTimeout(function(){ maskDirty = landDirty = true; }, 350);
  });
}

/* Far out, the world is drawn as a chart of the realms. Close in, it is
   the plain modern map of wherever you are standing. */
function applyEra(z){
  var t = Math.max(0, Math.min(1, (z - LORE_FULL) / (LORE_GONE - LORE_FULL))); // 0 = myth, 1 = real
  var pane = map.getPane('tilePane');
  var s = STYLES[cfg.style] || STYLES.parchment;
  if (s.filter === 'aged'){
    pane.style.filter = 'sepia(' + (0.82 - 0.72*t).toFixed(2) + ') ' +
                        'saturate(' + (0.62 + 0.42*t).toFixed(2) + ') ' +
                        'contrast(' + (1.16 - 0.12*t).toFixed(2) + ') ' +
                        'brightness(' + (0.90 + 0.08*t).toFixed(2) + ') ' +
                        'hue-rotate(' + Math.round(-12 + 12*t) + 'deg)';
  } else if (s.filter === 'ink'){
    pane.style.filter = 'sepia(' + (0.9 - 0.6*t).toFixed(2) + ') saturate(.6) contrast(1.2) brightness(.9)';
  } else pane.style.filter = '';

  var lore = map.getPane('lore');
  if (lore){
    lore.style.opacity = (1 - t).toFixed(2);
    lore.style.display = t >= 1 ? 'none' : '';
  }
  document.body.classList.toggle('era-myth', t < 0.5);
}

function setTiles(key){
  var s = STYLES[key] || STYLES.parchment;
  if (tiles) map.removeLayer(tiles);
  tiles = L.tileLayer(s.url, {
    attribution:s.attr, subdomains:s.sub||'abc',
    maxZoom:MAX_ZOOM, maxNativeZoom:s.max, detectRetina:true, crossOrigin:true, keepBuffer:2
  }).addTo(map);
  applyEra(map.getZoom());
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
    applyEra(map.getZoom()); paintScale();
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
  notePath(lat,lng);
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
  newPathSegment();
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
  $('f-path').value = cfg.pathOpacity;
  $('l-path').textContent = cfg.pathOpacity ? Math.round(cfg.pathOpacity*100)+'%' : 'Hidden';
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
  $('f-path').oninput = function(){
    cfg.pathOpacity = +this.value;
    $('l-path').textContent = this.value === '0' ? 'Hidden' : Math.round(this.value*100)+'%';
    drawPath();
  };
  $('f-path').onchange = save;
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
    path = []; drawPath();
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
drawPath();
applyEra(map.getZoom());
paintScale();

if ('serviceWorker' in navigator && location.protocol === 'https:'){
  window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
}
})();
