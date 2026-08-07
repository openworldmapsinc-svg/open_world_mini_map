/* Open World Maps — application logic */
(function(){
'use strict';

var D      = window.OW_DATA;
var STATES = D.STATES;
var MILE   = 1609.344;
var STORE  = 'openworld.v2';
var BUILD  = 'v23';           // shown in Expedition; bump with sw.js

/* ═══════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════ */
var DEFAULTS = {
  revealRadiusM : 150,    // fog cleared as you travel
  arrivalRadiusM: 4000,   // how close counts as arriving at a city
  shiftThreshold: 0.85,   // recenter when you pass this much of the view
  maxAccuracyM  : 150,
  pathOpacity   : 0.4,    // faint red trail; 0 hides it
  mode          : 'explorer', // 'explorer' (tracked) or 'map' (logged by hand)
  clear         : 'poi',      // 'poi' (cities open ground) or 'state' (whole states)
  style         : 'night',
  sim           : false,
  sound         : true,
  view          : 'world',
  simLat        : null,
  simLng        : null
};

/* ═══════════════════════════════════════════════════════════════
   EVERYTHING THE CARTOGRAPHER SAYS
   Edit freely. Each entry is an array of lines, joined with a space
   and typed out one letter at a time. `btn` is the button label.
   ═══════════════════════════════════════════════════════════════ */
var LINES = {
  greeting:  { say:['Greetings, adventurer.',
                    'Before we begin — how would you like to play?'], btn:'Choose' },
  explore:   { say:['Good. And how do you explore?'], btn:'Choose' },
  seen:      { say:['Now then — what have you seen of this world so far?'], btn:'Show him' },
  never:     { say:['Some ground is not worth the walking.',
                    'Tell me — what will you never see?'], btn:'Strike them out' },
  want:      { say:['And tell me, adventurer —',
                    'what do you still want to see?'], btn:'Tell him' },
  farewell:  { say:['Very good.', 'Good luck out there.'], btn:'Set out' },
  logAsk:    { say:['So — where have your travels taken you since last we spoke?'], btn:'Show him' },
  logDone:   { say:['Very good.'], btn:'Show me' }
};

/* ═══════════════════════════════════════════════════════════════
   SOUND EFFECTS
   Leave a value empty ('') and the sound is synthesized in code, as
   it is now. Put a file path in and that file plays instead.

     SOUNDS.discovery       reaching a city, or a state
     SOUNDS.secret          finding a secret
     SOUNDS.complete        a state fully explored
     SOUNDS.hmm             the Cartographer appears (thinking)
     SOUNDS.clear           the Cartographer appears (throat clear)
     SOUNDS.cackle          his laugh

   Paths are relative to the app, e.g. 'sounds/discovery.mp3'.
   Use .mp3, .m4a or .wav — Safari plays all three. Keep them small;
   they are downloaded once and kept for offline use.
   `volume` is a multiplier applied to every file, 0 to 1.
   ═══════════════════════════════════════════════════════════════ */
var SOUNDS = {
  discovery : '',
  secret    : '',
  complete  : '',
  hmm       : '',
  clear     : '',
  cackle    : '',
  volume    : 0.9
};

/* Words used on the discovery banner. */
var BANNER = {
  poi:      'Discovered',
  secret:   'Secret Discovered',
  state:    'Realm Entered',
  complete: 'Fully Explored',
  completeSub: 'every place taken',
  stateSub:    'the whole state opens',
  wilds:       'the wilds'
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
var GRID      = 36;    // rows/columns used when clearing a whole state
/* How far a discovery clears, by the size of the place. */
var TIER_MILES   = { s:75, m:100, l:125 };
var POI_MILES    = 100; // fallback when a city carries no size
var SECRET_MILES = 50;  // cleared around you when you stumble on a secret
/* Circles are free to run over towns nobody has reached yet — that is how
   you learn a place is there. */
var MASK_SCALE= 0.22;  // masks drawn small, then upscaled — this is what softens every edge
var DILATE_LAND  = 12; // how far the land mask is grown past the coast, in px
var DILATE_STATE = 22; // a cleared state grows further still, so no rim survives
/* Three steps, closest first. Local is where you are standing, region is the
   day's travelling, world is the framed realm. */
var VIEW_ORDER  = ['local','region','world'];
var VIEW_MILES  = { local:0.5, region:35 };
var FOG_BY_VIEW = { local:0.86, region:0.93, world:1 };
var TINT_FULL = 5.6;   // below this zoom the chart is fully aged
var TINT_GONE = 8.2;   // above this the tint is gone


/* ═══════════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════════ */
var cfg = Object.assign({}, DEFAULTS);
var pois = [], reveals = [], trailCells = new Set(), areaCells = new Set();
var setupDone = false, removed = [];

var map, tiles, fogCanvas, fctx, maskCanvas, mctx, cloudCanvas, cctx, landCanvas, lctx, edgeCanvas, ectx;
var noise = [], maskDirty = true, landDirty = true, rafId = null, lastFrame = 0;
var canBlur = false;
var youMarker, accCircle, poiLayer = {}, pathLines = [];
var path = [];                    // array of segments, each an array of [lat,lng]
var pos = null, anchor = null, watchId = null;
var simPos = null, simVec = {x:0,y:0}, simSprint = false, simTimer = null;
var simHalted = false;       // a discovery stops the reins until you take them again
var placeMode = false, saveTimer = null, wakeLock = null;
var view = 'world';          // 'local', 'region' or 'world'
var panned = false;          // the traveller has moved the camera by hand
var ceremony = false;        // a discovery is playing out
var gust = 0, gustAt = 0;    // wind blowing the fog aside
var parX = null, parY = null; // eased parallax reference
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
    return { id:'d-'+c.s+'-'+slug(c.n), name:c.n, state:c.s, size:c.z || 'm',
             lat:c.lat, lng:c.lng, found:false };
  });
}
function defaultSecrets(){
  return (D.SECRETS||[]).map(function(c){
    return { id:'s-'+c.s+'-'+slug(c.n), name:c.n, state:c.s, city:c.city,
             lat:c.lat, lng:c.lng, found:false, secret:true };
  });
}
/* the cities that count — secrets and struck-out places never do */
function openPois(){ return pois.filter(function(p){ return !p.secret; }); }
function stateMode(){ return cfg.clear === 'state'; }
function mapMode(){ return cfg.mode === 'map'; }

/* In State Mode the fifty states stand in for the cities. */
function statePois(){
  return Object.keys(STATES).map(function(k){
    var b = STATES[k].bbox;
    return { id:'st-'+k, name:STATES[k].name, state:k, isState:true,
             lat:(b[0]+b[2])/2, lng:(b[1]+b[3])/2, found:false };
  });
}

function load(){
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch(e){}
  var saved = (raw && Array.isArray(raw.pois)) ? raw.pois : [];
  var byId = {}; saved.forEach(function(p){ byId[p.id] = p; });

  removed = (raw && Array.isArray(raw.removed)) ? raw.removed : [];
  pois = defaultPois().concat(defaultSecrets())
    .filter(function(p){ return removed.indexOf(p.id) < 0; })
    .map(function(p){
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
    reveals.forEach(function(r){ delete r.born; });   // repair older journals
    setupDone = !!raw.setupDone;
  }
  rebuildCells();
}

function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function(){
    try {
      localStorage.setItem(STORE, JSON.stringify({
        cfg: cfg, setupDone: setupDone, removed: removed,
        pois: pois.map(function(p){
          return p.id.charAt(0) === 'u'
            ? p
            : { id:p.id, found:p.found };
        }),
        // `born` is a performance.now() stamp — meaningless in the next
        // session, and poisonous if kept: the clock restarts at zero, the
        // reveal looks like it has not begun, and it is skipped forever.
        reveals: reveals.map(function(r){
          if (r.born == null) return r;
          var c = {}; for (var k in r) if (k !== 'born') c[k] = r[k];
          return c;
        }),
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
  if (r > 1500) return;                 // measured analytically instead
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
var stateAreaCache = {};
function areaOfState(code){
  if (stateAreaCache[code] != null) return stateAreaCache[code];
  var rings = (window.OW_STATE_SHAPES || {})[code], total = 0;
  if (rings){
    for (var r=0;r<rings.length;r++){
      var ring = rings[r], sum = 0;
      for (var i=0,j=ring.length-1;i<ring.length;j=i++){
        var kx = Math.cos((ring[i][1]+ring[j][1])/2*Math.PI/180);
        sum += (ring[j][0]*kx*111320)*(ring[i][1]*111320) -
               (ring[i][0]*kx*111320)*(ring[j][1]*111320);
      }
      total += Math.abs(sum/2);
    }
  } else if (STATES[code]){
    var b = STATES[code].bbox;
    total = (b[2]-b[0])*111320 * (b[3]-b[1])*111320*Math.cos((b[0]+b[2])/2*Math.PI/180);
  }
  stateAreaCache[code] = total;
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
  for (var i=0;i<reveals.length;i++){
    var r = reveals[i];
    if (r.t === 'r') m2 += areaOfRegion(r);
    else if (r.t === 's') m2 += areaOfState(r.code);
    else if (r.t === 'c' && r.r > 1500) m2 += Math.PI*r.r*r.r;
  }
  return m2 / 2589988.11;
}

/* ═══════════════════════════════════════════════════════════════
   REGIONS — a discovery claims the nearest slice of its state
   ═══════════════════════════════════════════════════════════════ */
/* Which state is this point in? Outlines first; where two generalised
   outlines overlap along a border, the one it sits deepest inside wins. */
function stateOf(lat,lng){
  var shapes = window.OW_STATE_SHAPES, hits = [], k;
  if (shapes){
    for (k in shapes) if (inShape(k, lat, lng)) hits.push(k);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1){
      var best = hits[0], deep = -1;
      for (var i=0;i<hits.length;i++){
        var d = edgeDepth(shapes[hits[i]], lat, lng);
        if (d > deep){ deep = d; best = hits[i]; }
      }
      return best;
    }
  }
  for (k in STATES){
    var b = STATES[k].bbox;
    if (lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3]) return k;
  }
  return null;
}

function edgeDepth(rings, lat, lng){
  var best = Infinity, kx = Math.cos(lat*Math.PI/180);
  for (var r=0;r<rings.length;r++){
    var ring = rings[r];
    for (var i=0,j=ring.length-1;i<ring.length;j=i++){
      var ax=(ring[j][0]-lng)*kx, ay=ring[j][1]-lat;
      var bx=(ring[i][0]-lng)*kx, by=ring[i][1]-lat;
      var dx=bx-ax, dy=by-ay, len=dx*dx+dy*dy;
      var t = len ? Math.max(0, Math.min(1, -(ax*dx+ay*dy)/len)) : 0;
      var px=ax+dx*t, py=ay+dy*t;
      best = Math.min(best, px*px+py*py);
    }
  }
  return Math.sqrt(best);
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

/* A state opens along its own border, not a grid of boxes. */
function stateReveal(code){
  var shapes = window.OW_STATE_SHAPES;
  var b = STATES[code] && STATES[code].bbox;
  if (!b) return null;
  var c = L.latLng((b[0]+b[2])/2, (b[1]+b[3])/2);
  return { t:'s', code:code, cx:c.lat, cy:c.lng,
           bb:[b[0]-0.2, b[1]-0.2, b[2]+0.2, b[3]+0.2],
           rmax: c.distanceTo(L.latLng(b[2], b[3]))*1.2,
           poly: !!(shapes && shapes[code]) };
}
function hasStateReveal(code){
  return reveals.some(function(r){ return r.t === 's' && r.code === code; });
}

/* A safety net. If a state is finished but its outline was never cleared —
   an older journal, an interrupted setup, a discovery that landed while the
   app was closing — put it right on the next load rather than leaving the
   traveller staring at fog they have earned. */
function auditStates(){
  var n = 0, sv;
  if (stateMode()){
    for (var i=0;i<pois.length;i++){
      var p = pois[i];
      if (p.found && p.state && !hasStateReveal(p.state)){
        sv = stateReveal(p.state);
        if (sv){ reveals.push(sv); n++; }
      }
    }
  } else {
    for (var code in STATES){
      if (stateComplete(code) && !hasStateReveal(code)){
        sv = stateReveal(code);
        if (sv){ reveals.push(sv); n++; }
      }
    }
  }
  if (n){ maskDirty = true; save(); }
  return n;
}

function stateComplete(code){
  var inState = openPois().filter(function(p){ return p.state === code; });
  return inState.length > 0 && inState.every(function(p){ return p.found; });
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
  edgeCanvas = document.createElement('canvas');  ectx = edgeCanvas.getContext('2d');
  try { fctx.filter = 'blur(2px)'; canBlur = fctx.filter !== 'none'; fctx.filter = 'none'; }
  catch(e){ canBlur = false; }

  noise = [
    // tint      scale  drift (slow)     parallax  alpha  breathe  spin
    { img:makeNoise(256, 3, 3, 0.30, 250), tint:'#080b12', scale:4.6, vx: 0.00030, vy: 0.00016, par:0.020, alpha:0.62, br:0.030, spin: 0.0000012 },
    { img:makeNoise(256, 4, 4, 0.34, 300), tint:'#c3c9da', scale:2.7, vx: 0.00072, vy:-0.00026, par:0.035, alpha:0.34, br:0.045, spin:-0.0000008 },
    { img:makeNoise(256, 6, 4, 0.40, 340), tint:'#dfe4f0', scale:1.5, vx:-0.00115, vy: 0.00042, par:0.055, alpha:0.26, br:0.060, spin: 0.0000016 },
    { img:makeNoise(256, 5, 3, 0.44, 300), tint:'#0a0d15', scale:2.1, vx: 0.00048, vy: 0.00056, par:0.045, alpha:0.30, br:0.050, spin:-0.0000013 }
  ].map(function(l){
    var c = document.createElement('canvas');
    c.width = c.height = l.img.width;
    var x = c.getContext('2d');
    x.drawImage(l.img,0,0);
    x.globalCompositeOperation = 'source-in';   // colour the wisps, keep their shape
    x.fillStyle = l.tint;
    x.fillRect(0,0,c.width,c.height);
    l.pat = cctx.createPattern(c,'repeat');
    return l;
  });

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
    maskCanvas.width  = landCanvas.width  = edgeCanvas.width  = Math.max(2, Math.round(s.x*MASK_SCALE));
    maskCanvas.height = landCanvas.height = edgeCanvas.height = Math.max(2, Math.round(s.y*MASK_SCALE));
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
/* Trace a set of [lng,lat] rings, filling and then stroking so the shape is
   dilated by the current lineWidth. Used for both the land clip and a cleared
   state, so the two are cut from exactly the same geometry. */
function tracePolys(ctx, rings){
  for (var r=0;r<rings.length;r++){
    var ring = rings[r];
    ctx.beginPath();
    for (var i=0;i<ring.length;i++){
      var p = map.latLngToContainerPoint([ring[i][1], ring[i][0]]);
      if (i === 0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/* The realm boundary — fog never spills onto the oceans or the neighbouring
   kingdoms. Built from the state outlines themselves where they exist, so a
   cleared state and the coast it sits on share one shape and no rim survives. */
function buildLand(){
  lctx.setTransform(MASK_SCALE,0,0,MASK_SCALE,0,0);
  lctx.clearRect(0,0,landCanvas.width/MASK_SCALE, landCanvas.height/MASK_SCALE);
  lctx.fillStyle = '#fff';
  lctx.strokeStyle = '#fff';
  lctx.lineWidth = DILATE_LAND;
  lctx.lineJoin = 'round';

  var shapes = window.OW_STATE_SHAPES;
  if (shapes){
    for (var code in shapes) tracePolys(lctx, shapes[code]);
  } else {
    tracePolys(lctx, D.OUTLINE || []);
  }
  landDirty = false;
}

function buildMask(now, dpr, size){
  // a stamp further ahead than any real delay cannot be from this session
  for (var q=0;q<reveals.length;q++)
    if (reveals[q].born != null && reveals[q].born > now + 2000) delete reveals[q].born;

  mctx.setTransform(MASK_SCALE,0,0,MASK_SCALE,0,0);
  mctx.clearRect(0,0,size.x,size.y);
  mctx.fillStyle = '#fff';

  var z = map.getZoom(), m = mpp(map.getCenter().lat, z);
  var b = map.getBounds().pad(0.55);
  var animating = false;

  for (var i=0;i<reveals.length;i++){
    var rv = reveals[i];
    try {

    if (rv.t === 's'){
      if (rv.bb[2] < b.getSouth() || rv.bb[0] > b.getNorth() ||
          rv.bb[3] < b.getWest()  || rv.bb[1] > b.getEast()) continue;
      var rings = (window.OW_STATE_SHAPES || {})[rv.code];
      var box = STATES[rv.code] && STATES[rv.code].bbox;
      var clipS = false;
      if (rv.born){
        var ts = (now - rv.born)/3000;
        if (ts < 0){ animating = true; continue; }
        if (ts < 1){
          animating = true; clipS = true;
          var ps = map.latLngToContainerPoint([rv.cx, rv.cy]);
          var rs = (rv.rmax * (1-Math.pow(1-ts,2.2))) / m;
          ps.x += Math.sin(ts*3.1) * rs * 0.08;
          mctx.save(); mctx.beginPath(); mctx.arc(ps.x,ps.y,Math.max(1,rs),0,6.2832); mctx.clip();
        } else delete rv.born;
      }
      /* No feather here on purpose. A soft edge on each state would only
         half-clear the seam where two of them meet, leaving the ghost of a
         border behind. Solid fills plus a fat stroke union cleanly, and the
         blur on the carve softens the whole thing at the end. */
      mctx.strokeStyle = '#fff';
      mctx.lineWidth = DILATE_STATE;
      mctx.lineJoin = 'round';
      if (rings){
        tracePolys(mctx, rings);
      } else if (box){
        var nw2 = map.latLngToContainerPoint([box[2], box[1]]);
        var se2 = map.latLngToContainerPoint([box[0], box[3]]);
        mctx.beginPath();
        mctx.rect(nw2.x, nw2.y, se2.x-nw2.x, se2.y-nw2.y);
        mctx.fill(); mctx.stroke();
      }
      mctx.lineWidth = 1;
      if (clipS) mctx.restore();
      continue;
    }

    if (rv.t === 'r'){
      if (rv.bb[2] < b.getSouth() || rv.bb[0] > b.getNorth() ||
          rv.bb[3] < b.getWest()  || rv.bb[1] > b.getEast()) continue;
      var clipped = false;
      if (rv.born){
        var t = (now - rv.born)/3000;
        if (t < 0){ animating = true; continue; }
        if (t < 1){
          animating = true; clipped = true;
          var p0 = map.latLngToContainerPoint([rv.cx, rv.cy]);
          // the clearing runs downwind rather than opening as a neat circle
          var ease = 1-Math.pow(1-t,2.2);
          var rad = (rv.rmax * ease) / m;
          p0.x += Math.sin(t*3.1) * rad * 0.10;
          p0.y -= rad * 0.06 * t;
          mctx.save(); mctx.beginPath(); mctx.arc(p0.x,p0.y,Math.max(1,rad),0,6.2832); mctx.clip();
        } else delete rv.born;
      }
      var cellPx = (rv.h*111320)/m;
      // runs overlap enough to melt together, but the cleared shape is kept
      // a touch inside its true edge — the blur on carve spreads it back out
      var grow = cellPx*0.18;
      mctx.shadowColor = 'rgba(255,255,255,1)';
      mctx.shadowBlur  = Math.max(2, Math.min(22, cellPx*0.35));
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
    var rr = rv.r, sway = 0, lift = 0;
    if (rv.born){
      var tt = (now - rv.born)/2400;
      if (tt < 0){ animating = true; continue; }
      if (tt < 1){
        rr = rv.r*(1-Math.pow(1-tt,2.6));
        sway = Math.sin(tt*3.1)*0.08; lift = tt*0.05;
        animating = true;
      } else delete rv.born;
    }
    var p = map.latLngToContainerPoint([rv.lat, rv.lng]);
    var px = rr/m;
    // a walked corridor is a few hundred metres wide — at fifty miles out that
    // is a third of a pixel, so hold it to a visible thread instead
    if (rv.t === 't') px = Math.max(px, 4);
    if (px < 0.4) continue;
    p.x += px*sway; p.y -= px*lift;
    var g = mctx.createRadialGradient(p.x,p.y,px*0.45, p.x,p.y,px*0.94);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.6,'rgba(255,255,255,0.88)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    mctx.fillStyle = g;
    mctx.beginPath(); mctx.arc(p.x,p.y,px*0.94,0,6.2832); mctx.fill();
    mctx.fillStyle = '#fff';

    } catch (err) {
      // one malformed reveal must never stop the rest of the map clearing
      if (!rv._warned){ rv._warned = true; console.warn('Reveal skipped:', err); }
    }
  }
  maskDirty = animating;   // keep rebuilding while something is opening
  buildEdge();
}

/* The band of fog just outside cleared ground. Lighting it makes the fog
   read as a body with thickness rather than a flat sheet. */
function buildEdge(){
  if (!canBlur) return;
  ectx.setTransform(1,0,0,1,0,0);
  ectx.globalCompositeOperation = 'source-over';
  ectx.globalAlpha = 1;
  ectx.clearRect(0,0,edgeCanvas.width,edgeCanvas.height);
  ectx.filter = 'blur(3px)';
  ectx.drawImage(maskCanvas,0,0);
  ectx.filter = 'none';
  ectx.globalCompositeOperation = 'destination-out';
  ectx.drawImage(maskCanvas,0,0);
  ectx.globalCompositeOperation = 'source-over';
}

function renderFog(now){
  if (!map || !fctx) return;
  var m = sizeCanvases(), size = m.s, dpr = m.dpr;
  L.DomUtil.setPosition(fogCanvas, map.containerPointToLayerPoint([0,0]));

  // 1. a living bed of cloud — layers drift, breathe, turn, and lag behind the map
  var cw = cloudCanvas.width, ch = cloudCanvas.height;
  cctx.setTransform(1,0,0,1,0,0);
  cctx.globalAlpha = 1;
  cctx.globalCompositeOperation = 'source-over';
  cctx.fillStyle = '#141720';
  cctx.fillRect(0,0,cw,ch);

  // a discovery sends a gust through the fog
  gust = gustAt ? Math.max(0, 1 - (now - gustAt)/4800) : 0;
  var blow = 1 + Math.pow(gust, 1.4) * 26;
  var drift = reduceMotion ? 0 : now;

  /* Parallax follows where you are in the world, not what zoom you are at —
     otherwise every zoom change would fling the fog across the screen. The
     value is eased toward its target so even a teleport only drifts it. */
  var ref = map.project(map.getCenter(), 8);
  if (parX === null){ parX = ref.x; parY = ref.y; }
  var lerp = Math.min(1, (now - lastFrame + 16) / 900);
  parX += (ref.x - parX) * lerp;
  parY += (ref.y - parY) * lerp;
  var diag = Math.sqrt(cw*cw + ch*ch);

  for (var i=0;i<noise.length;i++){
    var l = noise[i];
    var breathe = reduceMotion ? 1 : 1 + Math.sin(now/16000 + i*1.7)*l.br;
    var sc = l.scale * 0.5 * breathe;
    // the fog hangs above the world: it follows the traveller only partly
    var px = -parX * l.par, py = -parY * l.par;
    var ox = (drift*l.vx*blow + px) % (256*sc);
    var oy = (drift*l.vy*blow + py) % (256*sc);
    cctx.save();
    cctx.translate(cw/2, ch/2);
    if (!reduceMotion) cctx.rotate(Math.sin(now*l.spin)*0.05);
    cctx.translate(-cw/2 + ox, -ch/2 + oy);
    cctx.scale(sc, sc);
    cctx.globalAlpha = Math.max(0, (l.alpha + (reduceMotion ? 0 : Math.sin(now/9000 + i*2.1)*0.04)) * (1 - gust*0.18));
    cctx.fillStyle = l.pat;
    var pad = diag/sc;
    cctx.fillRect(-pad, -pad, pad*3, pad*3);
    cctx.restore();
  }

  // depth: heavier below, light catching the tops
  cctx.globalAlpha = 1;
  var vg = cctx.createLinearGradient(0,0,0,ch);
  vg.addColorStop(0,   'rgba(210,216,232,.10)');
  vg.addColorStop(0.45,'rgba(0,0,0,0)');
  vg.addColorStop(1,   'rgba(6,8,14,.34)');
  cctx.fillStyle = vg;
  cctx.fillRect(0,0,cw,ch);

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
  if (canBlur) fctx.filter = 'blur(' + Math.round(fogCanvas.width*0.005) + 'px)';
  fctx.drawImage(maskCanvas, 0, 0, fogCanvas.width, fogCanvas.height);
  fctx.filter = 'none';

  // 5. light the curling edge so the fog has a body
  if (canBlur){
    fctx.globalCompositeOperation = 'source-atop';
    fctx.globalAlpha = 0.5 + (reduceMotion ? 0 : Math.sin(now/7000)*0.07);
    fctx.drawImage(edgeCanvas, 0, 0, fogCanvas.width, fogCanvas.height);
    fctx.globalAlpha = 1;
  }
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
  if (window.OW_STATE_SHAPES) return !!stateOf(lat,lng);
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
    if (now - lastFrame < (reduceMotion ? 200 : (gust > 0 ? 33 : 45))) return;
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

/* How far this discovery clears. */
function clearingRadius(poi){
  return (poi.secret ? SECRET_MILES : (TIER_MILES[poi.size] || POI_MILES)) * MILE;
}

function revealPoi(poi, animate, atLat, atLng){
  if (animate) gustAt = performance.now();

  if (poi.isState){                       // State Mode: the whole state at once
    if (!hasStateReveal(poi.state)){
      var sv = stateReveal(poi.state);
      if (sv){ if (animate) sv.born = performance.now(); reveals.push(sv); }
    }
    maskDirty = true;
    return;
  }

  var lat = (atLat != null) ? atLat : poi.lat;
  var lng = (atLng != null) ? atLng : poi.lng;
  var r = clearingRadius(poi);

  var c = { t:'c', lat:r4(lat), lng:r4(lng), r:Math.round(r), id:poi.id };
  if (animate) c.born = performance.now();
  reveals.push(c);
  stampArea(lat, lng, r);

  /* The last city in a state throws the whole state open — but that deserves
     its own ceremony, so only queue it here. The reveal itself is held back
     until that ceremony plays, otherwise the state would peel open behind the
     city's announcement and there would be nothing left to celebrate. */
  if (!poi.secret && poi.state && stateComplete(poi.state) && !hasStateReveal(poi.state)){
    if (animate){
      discoveryQueue.push({ complete:true, state:poi.state, name:STATES[poi.state].name });
    } else {
      var sv2 = stateReveal(poi.state);
      if (sv2) reveals.push(sv2);          // silent: setup, or the audit
    }
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
  if (audio.state === 'suspended'){
    audio.resume();
    // Safari wants something actually played inside the gesture
    try {
      var b = audio.createBuffer(1, 1, audio.sampleRate);
      var s = audio.createBufferSource();
      s.buffer = b; s.connect(audio.destination); s.start(0);
    } catch(e){}
  }
  return audio;
}

/* Scheduling against a context that is still waking up silently drops the
   sound — every cue goes through here so it waits for the context first. */
function withAudio(fn){
  var ac = ensureAudio();
  if (!ac) return;
  if (ac.state === 'running'){ fn(ac); return; }
  var done = false;
  var go = function(){ if (done) return; done = true; fn(ac); };
  try {
    ac.resume().then(function(){ setTimeout(go, 30); }).catch(function(){});
  } catch(e){}
  setTimeout(go, 350);                    // fallback if resume never settles
}

/* ── Keeping the page itself from zooming ─────────────────────────
   iOS ignores user-scalable=no, so a stray gesture can still scale and
   pan the visual viewport, leaving the interface shrunken and shifted.
   If that happens, snap it back. */
(function(){
  var vv = window.visualViewport;
  if (!vv) return;
  var meta = document.querySelector('meta[name=viewport]');
  var busy = false;

  function snapBack(){
    if (busy || !meta) return;
    busy = true;
    var base = meta.getAttribute('content');
    meta.setAttribute('content', base + ', minimum-scale=1');
    setTimeout(function(){
      meta.setAttribute('content', base);
      window.scrollTo(0, 0);
      busy = false;
    }, 60);
  }

  var check = function(){
    // height alone changes when the keyboard opens — that is not a zoom
    if (vv.scale > 1.01 || Math.abs(vv.offsetLeft) > 1 || Math.abs(vv.pageLeft) > 1) snapBack();
  };
  vv.addEventListener('resize', check);
  vv.addEventListener('scroll', check);
  window.addEventListener('orientationchange', function(){ setTimeout(check, 400); });
})();

/* One quiet unlock on the first touch anywhere, in case a cue is queued
   before the traveller has pressed anything we listen to. */
(function(){
  var unlock = function(){
    ensureAudio();
    warmSamples();
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('touchend', unlock, true);
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('touchend', unlock, true);
})();

function playDiscovery(secret, complete){
  if (!cfg.sound) return;
  var file = complete ? SOUNDS.complete : (secret ? SOUNDS.secret : SOUNDS.discovery);
  if (!file && complete) file = SOUNDS.discovery;        // no completion file? use the usual one
  if (file && playSample(file)) return;
  withAudio(function(ac){ discoveryOn(ac, secret); });
}
function discoveryOn(ac, secret){
  var t0 = ac.currentTime + 0.02;
  var out = ac.createGain(); out.gain.value = 0.9; out.connect(ac.destination);

  // --- wind: filtered noise sweeping open, then away ---
  var WIND = 5.6;                          // seconds of gust
  var len = Math.floor(ac.sampleRate * WIND);
  var buf = ac.createBuffer(1, len, ac.sampleRate), ch = buf.getChannelData(0);
  var last = 0;
  for (var i=0;i<len;i++){
    var white = Math.random()*2-1;
    last = 0.86*last + 0.14*white;      // brown-ish, softer than white
    ch[i] = last*1.6;
  }
  var src = ac.createBufferSource(); src.buffer = buf;
  var bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(300, t0);
  bp.frequency.exponentialRampToValueAtTime(2400, t0+1.0);
  bp.frequency.exponentialRampToValueAtTime(1500, t0+2.6);
  bp.frequency.exponentialRampToValueAtTime(380, t0+WIND-0.4);
  var wg = ac.createGain();
  wg.gain.setValueAtTime(0.0001, t0);
  wg.gain.exponentialRampToValueAtTime(0.52, t0+0.6);
  wg.gain.exponentialRampToValueAtTime(0.34, t0+2.2);   // holds while the fog moves
  wg.gain.exponentialRampToValueAtTime(0.20, t0+3.8);
  wg.gain.exponentialRampToValueAtTime(0.0001, t0+WIND-0.1);
  src.connect(bp); bp.connect(wg); wg.connect(out);
  src.start(t0); src.stop(t0+WIND);

  // --- low swell under it ---
  var sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = 55;
  var sg = ac.createGain();
  sg.gain.setValueAtTime(0.0001, t0+0.5);
  sg.gain.exponentialRampToValueAtTime(0.34, t0+0.72);
  sg.gain.exponentialRampToValueAtTime(0.0001, t0+3.1);
  sub.connect(sg); sg.connect(out); sub.start(t0+0.5); sub.stop(t0+3.2);

  // --- the sting: an open fifth blooming into a major chord ---
  var delay = ac.createDelay(1.0); delay.delayTime.value = 0.28;
  var fb = ac.createGain(); fb.gain.value = 0.26;
  var wet = ac.createGain(); wet.gain.value = 0.34;
  delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(out);

  var notes = secret ? [
    { f:220.00, at:0.62 },   // A3
    { f:329.63, at:0.62 },   // E4
    { f:440.00, at:0.80 },   // A4
    { f:523.25, at:0.94 },   // C5  — minor third, a colder find
    { f:659.25, at:1.10 }    // E5
  ] : [
    { f:220.00, at:0.62 },
    { f:329.63, at:0.62 },
    { f:440.00, at:0.80 },
    { f:554.37, at:0.94 },
    { f:659.25, at:1.06 }
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
   REALMS — the frame the map sits in
   ═══════════════════════════════════════════════════════════════ */
var REALMS = D.REALMS || {};
var realm = null;

function realmBounds(key){
  var r = REALMS[key]; if (!r) return null;
  return L.latLngBounds(r.bounds[0], r.bounds[1]);
}
function realmOf(lat,lng){
  for (var k in REALMS) if (realmBounds(k).contains([lat,lng])) return k;
  return null;
}

/* Zooming out stops exactly where the realm fills the screen, and the view
   can never wander outside that frame. */
function setRealm(key, move){
  var b = realmBounds(key);
  if (!b){                                   // somewhere beyond the charted realms
    realm = null;
    map.setMaxBounds(null); map.setMinZoom(MIN_ZOOM);
    if ($('f-realm')) $('f-realm').value = '';
    return;
  }
  realm = key;
  map.setMaxBounds(null);
  map.setMinZoom(MIN_ZOOM);
  var fit = map.getBoundsZoom(b, false);     // the zoom at which the realm just fits
  map.setMinZoom(fit);
  map.setMaxBounds(b.pad(0.02));
  if (move){
    map.fitBounds(b, { animate:false });
    anchor = map.getCenter();
  } else if (map.getZoom() < fit){
    map.setZoom(fit, { animate:false });
  }
  if ($('f-realm')) $('f-realm').value = key;
  maskDirty = landDirty = true;
  paintScale();
}
function reframeRealm(){
  if (!realm) return;
  setRealm(realm, false);
  setViewState(view, false);
}

/* ── The two views ───────────────────────────────────────────────
   There is no free zoom. Pinch open for the local view — half a mile
   in every direction around you — and pinch closed for the framed
   world map. Nothing in between. */
function viewZoom(name, lat){
  var s = map.getSize();
  var half = Math.max(80, Math.min(s.x, s.y)/2);
  var target = MILE*(VIEW_MILES[name] || 0.5)/half;          // metres per pixel
  return Math.max(map.getMinZoom(), Math.min(MAX_ZOOM,
    Math.log2(156543.03392*Math.cos(lat*Math.PI/180)/target)));
}

function setViewState(name, animate){
  if (name === 'world'){
    view = 'world'; panned = false; cfg.view = 'world'; save();
    var b = realmBounds(realm || 'us48');
    if (b){
      if (animate) map.flyToBounds(b, { duration:1.1, easeLinearity:.28 });
      else map.fitBounds(b, { animate:false });
      anchor = b.getCenter();
    }
    applyViewState();
    return true;
  }
  if (!pos) return false;
  view = name; panned = false; cfg.view = name; save();
  anchor = L.latLng(pos.lat, pos.lng);
  var z = viewZoom(name, pos.lat);
  if (animate) map.flyTo(anchor, z, { duration:1.0, easeLinearity:.28 });
  else map.setView(anchor, z, { animate:false });
  applyViewState();
  return true;
}

function setLocalView(animate){ return setViewState('local', animate); }
function setWorldView(animate){ return setViewState('world', animate); }

/* Pinching walks one step along the chain rather than jumping to an end. */
function stepView(dir, animate){
  if (mapMode()) return;                // Map Mode never leaves the world view
  var i = VIEW_ORDER.indexOf(view);
  var next = VIEW_ORDER[Math.max(0, Math.min(VIEW_ORDER.length-1, i + dir))];
  if (next === view) return;
  if (!setViewState(next, animate !== false) && next !== 'world')
    toast('Waiting to find you.');
}

function toggleView(){                     // double tap draws you in a step
  if (view === 'local') setWorldView(true);
  else stepView(-1, true);
}

function applyMode(){
  document.body.classList.toggle('mode-map', mapMode());
  document.body.classList.toggle('clear-state', stateMode());
  if (stateMode()){                     // no places to manage: start on Expedition
    var t = document.querySelector('.tab[data-pane="p-set"]');
    if (t && !t.classList.contains('on')) t.click();
  }
  if (mapMode() && cfg.sim){ cfg.sim = false; if (simTimer){ clearInterval(simTimer); simTimer = null; } }
}

function applyViewState(){
  if (fogCanvas) fogCanvas.style.opacity = FOG_BY_VIEW[view] != null ? FOG_BY_VIEW[view] : 1;
  document.body.classList.toggle('view-local', view === 'local');
  document.body.classList.toggle('view-world', view === 'world');
  // the camera is yours to move except when the whole realm is framed
  if (map.dragging){
    if (view === 'world' || mapMode()) map.dragging.disable(); else map.dragging.enable();
  }
  $('b-center').classList.toggle('adrift', panned);
  // at world view the marks lift above the fog so unreached places show through
  var tp = map.getPane('towns');
  if (tp) tp.style.zIndex = (view === 'world') ? 455 : 435;
  maskDirty = landDirty = true;
  paintScale();
}

/* Pinch, wheel and double-tap all just choose between the two views. */
function bindViewGestures(){
  var el = map.getContainer(), start = 0, fired = false;

  /* These are deliberately non-passive: a two-finger gesture on the map must
     belong to us, not to Safari's page zoom. Left to itself iOS scales the
     visual viewport and the whole interface slides sideways. */
  el.addEventListener('touchstart', function(e){
    if (e.touches.length < 2) return;
    e.preventDefault();
    var dx = e.touches[0].clientX - e.touches[1].clientX;
    var dy = e.touches[0].clientY - e.touches[1].clientY;
    start = Math.hypot(dx,dy); fired = false;
  }, { passive:false });

  el.addEventListener('touchmove', function(e){
    if (e.touches.length < 2) return;
    e.preventDefault();
    if (!start || fired) return;
    var dx = e.touches[0].clientX - e.touches[1].clientX;
    var dy = e.touches[0].clientY - e.touches[1].clientY;
    var ratio = Math.hypot(dx,dy)/start;
    if (ratio > 1.22){ fired = true; stepView(-1); }
    else if (ratio < 0.82){ fired = true; stepView(1); }
  }, { passive:false });

  el.addEventListener('touchend', function(e){
    if (e.touches.length >= 1) e.preventDefault();
    start = 0;
  }, { passive:false });

  var wheelLock = 0;
  el.addEventListener('wheel', function(e){
    e.preventDefault();
    var now = Date.now();
    if (now - wheelLock < 900) return;
    wheelLock = now;
    if (e.deltaY < 0) stepView(-1); else stepView(1);
  }, { passive:false });

  var lastTap = 0;
  el.addEventListener('click', function(){
    var now = Date.now();
    if (now - lastTap < 320) toggleView();
    lastTap = now;
  });
}




function buildPanes(){
  // towns sit beneath the fog: you only see one once its ground is clear
  map.createPane('towns');
  map.getPane('towns').style.zIndex = 435;

  map.createPane('trail');
  map.getPane('trail').style.zIndex = 470;
  map.getPane('trail').style.pointerEvents = 'none';
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

/* ── Playing sound files ──────────────────────────────────────────
   Fetched once, decoded, then kept in memory. Falls back to the
   synthesized cue if the file is missing or will not decode. */
var sampleCache = {};

function loadSample(url){
  if (sampleCache[url] !== undefined) return sampleCache[url];
  var ac = ensureAudio();
  if (!ac){ sampleCache[url] = null; return null; }
  sampleCache[url] = fetch(url)
    .then(function(r){ if (!r.ok) throw 0; return r.arrayBuffer(); })
    .then(function(buf){
      return new Promise(function(res, rej){
        ac.decodeAudioData(buf, res, rej);      // callback form, for older Safari
      });
    })
    .catch(function(){ console.warn('Sound not loaded:', url); return null; });
  return sampleCache[url];
}

/* Returns true if a file was played, false to fall through to synthesis. */
function playSample(url, gain){
  if (!url || !cfg.sound) return false;
  withAudio(function(ac){
    Promise.resolve(loadSample(url)).then(function(buf){
      if (!buf) return;
      var src = ac.createBufferSource(); src.buffer = buf;
      var g = ac.createGain();
      g.gain.value = (gain == null ? 1 : gain) * (SOUNDS.volume == null ? 1 : SOUNDS.volume);
      src.connect(g); g.connect(ac.destination);
      src.start();
    });
  });
  return true;
}

/* Pull the files in quietly once audio is unlocked, so the first cue
   is not held up by a download. */
function warmSamples(){
  ['discovery','secret','complete','hmm','clear','cackle'].forEach(function(k){
    if (SOUNDS[k]) loadSample(SOUNDS[k]);
  });
}

/* ── The Cartographer's voice ─────────────────────────────────────
   Short, dry, wordless. Synthesized so there are no audio files to ship. */
function vocalize(kind){
  if (!cfg.sound) return;
  if (SOUNDS[kind] && playSample(SOUNDS[kind])) return;   // your file, if you gave one
  withAudio(function(ac){ vocalizeOn(ac, kind); });
}
function vocalizeOn(ac, kind){
  var t0 = ac.currentTime + 0.03;
  var out = ac.createGain(); out.gain.value = 0.85; out.connect(ac.destination);

  // a throat: a resonant band that everything passes through
  function throat(src, when, dur, f1, f2, level){
    var b1 = ac.createBiquadFilter(); b1.type = 'bandpass'; b1.Q.value = 5.5; b1.frequency.value = f1;
    var b2 = ac.createBiquadFilter(); b2.type = 'bandpass'; b2.Q.value = 7;   b2.frequency.value = f2;
    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + dur*0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(b1); b1.connect(b2); b2.connect(g); g.connect(out);
    return g;
  }
  function noiseSrc(dur){
    var n = Math.floor(ac.sampleRate*dur), buf = ac.createBuffer(1,n,ac.sampleRate), ch = buf.getChannelData(0);
    var last = 0;
    for (var i=0;i<n;i++){ var w = Math.random()*2-1; last = 0.72*last + 0.28*w; ch[i] = last*1.5; }
    var s = ac.createBufferSource(); s.buffer = buf; return s;
  }

  if (kind === 'clear'){                    // ahem
    var s1 = noiseSrc(0.5);
    throat(s1, t0, 0.16, 420, 1250, 0.22);
    s1.start(t0); s1.stop(t0+0.2);
    var o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(104, t0+0.16);
    o.frequency.exponentialRampToValueAtTime(78, t0+0.42);
    throat(o, t0+0.16, 0.3, 520, 1500, 0.2);
    o.start(t0+0.16); o.stop(t0+0.5);

  } else if (kind === 'cackle'){            // heh-heh-heh
    for (var k=0;k<6;k++){
      var when = t0 + k*0.115 + Math.random()*0.02;
      var osc = ac.createOscillator(); osc.type = 'sawtooth';
      var base = 190 - k*9 + (Math.random()*16-8);
      osc.frequency.setValueAtTime(base*1.18, when);
      osc.frequency.exponentialRampToValueAtTime(base, when+0.07);
      throat(osc, when, 0.1, 620 + k*22, 1750 - k*40, 0.16);
      osc.start(when); osc.stop(when+0.12);
      var hs = noiseSrc(0.1);
      throat(hs, when, 0.07, 900, 2100, 0.05);
      hs.start(when); hs.stop(when+0.09);
    }

  } else {                                  // hmm — mouth closed, two slow steps
    var m = ac.createOscillator(); m.type = 'sawtooth';
    m.frequency.setValueAtTime(112, t0);
    m.frequency.linearRampToValueAtTime(103, t0+0.34);
    m.frequency.linearRampToValueAtTime(94, t0+0.78);
    var vib = ac.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5.2;
    var vg = ac.createGain(); vg.gain.value = 2.4;
    vib.connect(vg); vg.connect(m.frequency); vib.start(t0); vib.stop(t0+0.9);
    var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620;
    var g2 = ac.createGain();
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(0.2, t0+0.14);
    g2.gain.setValueAtTime(0.2, t0+0.5);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0+0.9);
    m.connect(lp); lp.connect(g2); g2.connect(out);
    m.start(t0); m.stop(t0+0.95);
  }
}

/* ═══════════════════════════════════════════════════════════════
   MAP
   ═══════════════════════════════════════════════════════════════ */
function buildMap(){
  map = L.map('map', {
    zoomControl:false, attributionControl:true,
    dragging:false, keyboard:false, boxZoom:false,
    touchZoom:false, scrollWheelZoom:false, doubleClickZoom:false, bounceAtZoomLimits:true,
    zoomSnap:0, zoomDelta:0,
    minZoom:MIN_ZOOM, maxZoom:MAX_ZOOM,
    center:[39.5,-98.35], zoom:cfg.zoom || 4
  });
  map.attributionControl.setPrefix('');
  setTiles(cfg.style);
  buildPanes();
  initFog();

  map.on('zoom', function(){ applyEra(map.getZoom()); paintScale(); });
  map.on('zoomend', function(){ cfg.zoom = map.getZoom(); save(); applyEra(map.getZoom()); paintScale(); });
  map.on('move', paintScale);
  map.on('dragstart', function(){ panned = true; $('b-center').classList.add('adrift'); });
  map.on('click', function(e){
    if (!placeMode) return;
    var kind = placeMode;
    setPlaceMode(false);
    addPoi(e.latlng.lat, e.latlng.lng, null, kind === 'secret');
  });
  window.addEventListener('resize', function(){ maskDirty = landDirty = true; reframeRealm(); });
  window.addEventListener('orientationchange', function(){
    setTimeout(function(){ maskDirty = landDirty = true; reframeRealm(); }, 350);
  });
  setRealm('us48', true);
  bindViewGestures();
  applyViewState();
}

/* Far out, the world is drawn as a chart of the realms. Close in, it is
   the plain modern map of wherever you are standing. */
function applyEra(z){
  var t = Math.max(0, Math.min(1, (z - TINT_FULL) / (TINT_GONE - TINT_FULL))); // 0 = myth, 1 = real
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
  var lab = $('scale-view');
  if (lab) lab.textContent = view === 'world' ? 'realm' : view === 'region' ? 'region' : 'local';
}

function shiftWindow(lat,lng){
  if (view === 'world' || ceremony || panned) return;   // hands off while they are looking around
  var p = L.latLng(lat,lng);
  if (!anchor || p.distanceTo(anchor) > viewHalfMeters()*cfg.shiftThreshold){
    anchor = p;
    map.panTo(p, { animate:true, duration:0.9, easeLinearity:0.4 });
  }
}
function recenter(){
  if (!pos) return;
  if (panned){                            // first press brings the camera back
    panned = false;
    $('b-center').classList.remove('adrift');
    anchor = L.latLng(pos.lat, pos.lng);
    map.flyTo(anchor, map.getZoom(), { duration:.7 });
    maskDirty = true;
    return;
  }
  if (view === 'world'){ setViewState('region', true); return; }
  if (view === 'region'){ setLocalView(true); return; }
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
    setRealm(realmOf(lat,lng), false);
    anchor = L.latLng(lat,lng);
    setViewState(VIEW_ORDER.indexOf(cfg.view) >= 0 ? cfg.view : 'local', false);
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

  var here = realmOf(lat,lng);
  if (here !== realm) setRealm(here, false);
  revealTrail(lat,lng);
  notePath(lat,lng);
  checkArrivals(lat,lng);
  shiftWindow(lat,lng);
  paintStats();
  if (discoveryQueue.length) resumeCeremonies();
}

/* ═══════════════════════════════════════════════════════════════
   POINTS OF INTEREST
   ═══════════════════════════════════════════════════════════════ */
function checkArrivals(lat,lng){
  if (stateMode()){                       // setting foot in a state is enough
    var code = stateOf(lat,lng);
    if (!code) return;
    var sp = pois.filter(function(p){ return p.state === code; })[0];
    if (sp && !sp.found) discover(sp, lat, lng);
    return;
  }
  var here = L.latLng(lat,lng);
  for (var i=0;i<pois.length;i++){
    var p = pois[i];
    if (p.found) continue;
    if (here.distanceTo(L.latLng(p.lat,p.lng)) <= cfg.arrivalRadiusM) discover(p, lat, lng);
  }
}

/* Nothing ceremonial happens while the traveller is reading something else. */
function uiBusy(){
  return $('sheet').classList.contains('show') ||
         $('setup').style.display === 'flex' ||
         $('cart').style.display === 'flex' ||
         $('logbook').style.display === 'flex' ||
         !$('gate').classList.contains('gone');
}
var discoveryQueue = [];

function discover(p, atLat, atLng){
  // whatever you were doing, you have arrived — the reins drop
  simVec = {x:0, y:0}; simHalted = true;
  p.found = true;
  p.at = (atLat != null) ? [r4(atLat), r4(atLng)] : null;
  save(); paintStats(); paintList();
  discoveryQueue.push(p);
  if (!ceremony && !uiBusy()) runCeremony();
}
/* Called whenever the traveller comes back to the map. */
function resumeCeremonies(){
  if (!ceremony && discoveryQueue.length && !uiBusy()) runCeremony();
}

/* Pull back to the world map, name the place, let the wind take the fog off
   it, then drop back to where the traveller is standing. */
function runCeremony(){
  var p = discoveryQueue.shift();
  if (!p){ ceremony = false; return; }
  ceremony = true;
  var back = mapMode() ? 'world' : (view === 'world' ? 'region' : view);

  setWorldView(true);                       // 1. pull back

  setTimeout(function(){                    // 2. name it, and start the wind
    announce(p);
    playDiscovery(!!p.secret, !!p.complete);
    if (navigator.vibrate) navigator.vibrate([20,70,34]);
  }, 1150);

  setTimeout(function(){                    // 3. blow the fog off the ground
    gustAt = performance.now();
    if (p.complete){
      if (!hasStateReveal(p.state)){
        var sv = stateReveal(p.state);
        if (sv){ sv.born = performance.now(); reveals.push(sv); maskDirty = true; }
      }
    } else {
      revealPoi(p, true, p.at ? p.at[0] : null, p.at ? p.at[1] : null);
      drawPoiMarker(p, true);
    }
  }, 1750);

  setTimeout(function(){                    // 4. back to the traveller
    if (discoveryQueue.length){ runCeremony(); return; }
    ceremony = false;
    auditStates();
    if (mapMode()) setWorldView(true);
    else if (pos) setViewState(back, true);
  }, 6200);
}

var TOWN_SIZE = { s:[26,24], m:[31,28], l:[38,34] };
var DOT_SIZE  = { s:7, m:9, l:11 };

function townSvg(){
  var c = '#d9b45c', win = '#f0dda4', lit = true;
  return '<svg viewBox="0 0 36 30" fill="none" stroke="'+c+'" stroke-width="1.5" '+
    'stroke-linejoin="round" stroke-linecap="round">'+
    '<path d="M4 26v-9l6-5 6 5v9z" fill="'+(lit?'rgba(20,15,9,.92)':'rgba(14,12,9,.55)')+'"/>'+
    '<path d="M18 26V8h7v18z" fill="'+(lit?'rgba(20,15,9,.92)':'rgba(14,12,9,.55)')+'"/>'+
    '<path d="M25 8V3.5l5 2.2-5 2.2z" fill="'+(lit?c:'none')+'"/>'+
    '<path d="M26 26v-7l4-3 4 3v7z" fill="'+(lit?'rgba(20,15,9,.92)':'rgba(14,12,9,.55)')+'"/>'+
    '<path d="M2 26.6h32"/>'+
    '<rect x="8.6" y="18.5" width="2.8" height="3.4" fill="'+win+'" stroke="none"/>'+
    '<rect x="20.4" y="13" width="2.6" height="3.2" fill="'+win+'" stroke="none"/>'+
    '<rect x="28.6" y="20.5" width="2.4" height="2.8" fill="'+win+'" stroke="none"/>'+
    '</svg>';
}

function secretSvg(){
  return '<svg viewBox="0 0 24 28" fill="none">'+
    '<path d="M12 27C12 27 3.6 17.2 3.6 10.8A8.4 8.4 0 1 1 20.4 10.8C20.4 17.2 12 27 12 27Z" '+
      'fill="rgba(14,11,7,.9)" stroke="#c0442c" stroke-width="1.2"/>'+
    '<path d="M7 18.5v-6.2h10v6.2z" fill="#c0442c"/>'+
    '<path d="M7 12.3v-2h1.7v1.4h1.7v-1.4H12v1.4h1.6v-1.4h1.7v1.4H17v2" fill="none" '+
      'stroke="#c0442c" stroke-width="1.1"/>'+
    '<path d="M11 18.5v-3.2h2v3.2z" fill="rgba(14,11,7,.92)"/></svg>';
}

/* Every town is on the map from the start: a pale unnamed dot until someone
   reaches it, a lit and lettered town once they have. Secrets stay hidden. */
function drawPoiMarker(p, isNew){
  if (poiLayer[p.id]){ map.removeLayer(poiLayer[p.id]); delete poiLayer[p.id]; }
  if (p.isState) return;                  // a whole state marks itself
  if (p.secret && !p.found) return;

  var html, w, h, anchorY;
  if (p.secret){
    w = 26; h = 30; anchorY = 27;
    html = '<div class="poi secret'+(isNew?' new':'')+'">'+secretSvg()+'<i class="pip red"></i></div>';
  } else if (!p.found){
    // unreached: a pale dot and nothing else. You can see something is there.
    var d = DOT_SIZE[p.size] || DOT_SIZE.m;
    w = h = d; anchorY = d/2;
    html = '<div class="dot"></div>';
  } else {
    // reached: a lit town up close, a lit pip when the whole country is in view
    var dim = TOWN_SIZE[p.size] || TOWN_SIZE.m;
    w = dim[0]; h = dim[1]; anchorY = h - 2;
    html = '<div class="town lit'+(isNew?' new':'')+'">'+ townSvg(true) +
             '<span class="nm">'+p.name.replace(/</g,'&lt;')+'</span>'+
             '<i class="pip"></i></div>';
  }
  poiLayer[p.id] = L.marker([p.lat,p.lng], {
    pane: p.secret ? 'markerPane' : 'towns',
    icon:L.divIcon({ className:'', html:html, iconSize:[w,h], iconAnchor:[w/2,anchorY] })
  }).addTo(map).bindTooltip(p.name,
      { direction:'top', offset:[0,-anchorY], className:'poi-tip' });
}

function refreshPoiMarkers(){
  Object.keys(poiLayer).forEach(function(id){ map.removeLayer(poiLayer[id]); });
  poiLayer = {};
  pois.forEach(function(p){ drawPoiMarker(p,false); });
}

function addPoi(lat,lng,name,secret){
  var n = name || ask(secret ? 'Name this secret' : 'Name this place',
                      secret ? 'Secret ' + (pois.filter(function(p){return p.secret;}).length+1)
                             : 'Waypoint ' + (openPois().length+1));
  if (n === null) return null;
  var p = { id:uid(), name:(n||'Unnamed').trim(), state:stateOf(lat,lng), size:'m',
            lat:lat, lng:lng, found:false };
  if (secret){ p.secret = true; p.city = 'a place unmarked'; }
  pois.push(p); drawPoiMarker(p, false); save(); paintList(); paintStats();
  toast(secret ? 'A secret waits there.' : 'Added to the map: ' + p.name);
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
  var place = p.state && STATES[p.state] ? STATES[p.state].name : BANNER.wilds;
  var eyebrow, name, sub;
  if (p.complete){
    eyebrow = BANNER.complete; name = p.name; sub = BANNER.completeSub;
  } else if (p.isState){
    eyebrow = BANNER.state; name = p.name; sub = BANNER.stateSub;
  } else if (p.secret){
    eyebrow = BANNER.secret; name = p.name;
    sub = p.city ? p.city + ', ' + place : place;
  } else {
    eyebrow = BANNER.poi; name = p.name; sub = place;
  }
  $('banner-eyebrow').textContent = eyebrow;
  $('banner-name').textContent = name;
  $('banner-sub').textContent = sub;
  b.classList.toggle('secret', !!p.secret);
  b.classList.toggle('complete', !!p.complete);
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function setPlaceMode(kind){
  placeMode = kind || false;
  $('b-drop').classList.toggle('on', placeMode === 'poi');
  $('b-secret').classList.toggle('on', placeMode === 'secret');
  if (placeMode) toast(placeMode === 'secret'
    ? 'Touch the map to hide a secret.' : 'Touch the map to mark a place.');
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
  var open = openPois();
  $('s-poi').textContent = open.filter(function(p){ return p.found; }).length + ' / ' + open.length;
  $('s-acc').innerHTML = mapMode() ? '<small>logged</small>'
    : (pos ? ('±'+Math.round(pos.acc)+' <small>m</small>') : '—');
  $('s-poi-k').textContent = stateMode() ? 'States' : 'Cities';
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
  var list = openPois().filter(function(p){
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
    if (!stateMode()){
      var h = document.createElement('div'); h.className = 'state-head';
      var found = g[k].filter(function(p){ return p.found; }).length;
      h.innerHTML = '<span>'+(STATES[k] ? STATES[k].name : 'Elsewhere')+'</span><em>'+found+'/'+g[k].length+'</em>';
      el.appendChild(h);
    }
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
  if (open) paintList(); else setTimeout(resumeCeremonies, 350);
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
   THE CARTOGRAPHER — portrait scenes between the questions
   ═══════════════════════════════════════════════════════════════ */
var typeTimer = null;

function cartographer(lines, buttonText, kind, then){
  var el = $('cart'), box = $('cart-box'), txt = $('cart-text'), btn = $('cart-next');
  el.style.display = 'flex';
  el.classList.remove('gone');
  box.classList.remove('in'); void box.offsetWidth; box.classList.add('in');
  vocalize(kind || (Math.random() < 0.5 ? 'hmm' : 'clear'));

  var full = lines.join(' ');
  txt.textContent = '';
  btn.disabled = true;
  btn.textContent = buttonText || 'Continue';
  clearInterval(typeTimer);

  var i = 0, delay = reduceMotion ? 0 : 18;
  function finish(){ clearInterval(typeTimer); txt.textContent = full; btn.disabled = false; }
  if (!delay) finish();
  else typeTimer = setInterval(function(){
    i += 1;
    txt.textContent = full.slice(0,i);
    if (i >= full.length) finish();
  }, delay);

  box.onclick = function(e){ if (e.target !== btn) finish(); };   // tap to skip the typing
  btn.onclick = function(){
    clearInterval(typeTimer);
    el.classList.add('gone');
    setTimeout(function(){ el.style.display = 'none'; el.classList.remove('gone'); }, 420);
    if (then) then();
  };
}

function introSequence(){
  cartographer(
    LINES.greeting.say, LINES.greeting.btn, null,
    function(){ openSetup(); showStep('mode'); }
  );
}
function exploreQuestion(){
  $('setup').style.display = 'none';
  cartographer(
    LINES.explore.say, LINES.explore.btn, null,
    function(){ $('setup').style.display = 'flex'; showStep('explore'); }
  );
}
function seenQuestion(){
  $('setup').style.display = 'none';
  cartographer(
    LINES.seen.say, LINES.seen.btn, null,
    function(){ $('setup').style.display = 'flex'; showStep(1); paintSetupList(); }
  );
}
/* State Mode has nothing to configure past this point. */
function afterSeen(){
  if (stateMode()) farewell(finishSetup); else neverQuestion();
}

function neverQuestion(){
  $('setup').style.display = 'none';
  cartographer(
    LINES.never.say, LINES.never.btn, null,
    function(){ $('setup').style.display = 'flex'; showStep(3); paintNeverList(); }
  );
}
function secondQuestion(){
  $('setup').style.display = 'none';
  cartographer(
    LINES.want.say, LINES.want.btn, null,
    function(){ $('setup').style.display = 'flex'; showStep(2); paintAdded(); }
  );
}
function farewell(after){
  $('setup').style.display = 'none';
  cartographer(
    LINES.farewell.say, LINES.farewell.btn, 'cackle',
    function(){ setTimeout(function(){ vocalize('cackle'); }, 120); after(); }
  );
}

/* ── Logging travels (Map Mode) ───────────────────────────────────
   The Cartographer asks where you have been; you tick them off; the
   world map plays out every discovery in turn. */
var logged = {};

function logTravels(){
  logged = {};
  cartographer(
    LINES.logAsk.say, LINES.logAsk.btn, null,
    function(){ $('logbook').style.display = 'flex'; paintLogList(); }
  );
}

function paintLogList(){
  var q = ($('log-search').value || '').toLowerCase();
  var el = $('log-list'); el.innerHTML = '';
  var pool = openPois().filter(function(p){
    if (p.found) return false;
    if (!q) return true;
    var st = p.state && STATES[p.state] ? STATES[p.state].name.toLowerCase() : '';
    return p.name.toLowerCase().indexOf(q) >= 0 || st.indexOf(q) >= 0;
  });
  if (!pool.length){
    el.innerHTML = '<div class="empty"><b>Nothing left unseen</b>You have taken every place on the map.</div>';
    countLogged(); return;
  }
  var g = groupByState(pool);
  Object.keys(g).sort(function(x,y){
    return (STATES[x]?STATES[x].name:'zz') < (STATES[y]?STATES[y].name:'zz') ? -1 : 1;
  }).forEach(function(k){
    if (!stateMode()){
      var h = document.createElement('div'); h.className = 'state-head';
      h.innerHTML = '<span>'+(STATES[k]?STATES[k].name:'Elsewhere')+'</span>';
      el.appendChild(h);
    }
    g[k].forEach(function(p){
      var row = document.createElement('button');
      row.className = 'check' + (logged[p.id] ? ' on' : '');
      row.innerHTML = '<span class="box"></span><span class="nm"></span>';
      row.querySelector('.nm').textContent = p.name;
      row.onclick = function(){
        logged[p.id] = !logged[p.id];
        row.classList.toggle('on', !!logged[p.id]);
        countLogged();
      };
      el.appendChild(row);
    });
  });
  countLogged();
}
function countLogged(){
  var n = Object.keys(logged).filter(function(k){ return logged[k]; }).length;
  $('log-count').textContent = n === 0 ? 'Nowhere new' :
    n + (n === 1 ? ' place logged' : ' places logged');
}

function commitLog(){
  $('logbook').style.display = 'none';
  var picked = pois.filter(function(p){ return logged[p.id]; });
  logged = {};
  if (!picked.length){ resumeCeremonies(); return; }
  cartographer(LINES.logDone.say, LINES.logDone.btn, 'cackle', function(){
    setTimeout(function(){ vocalize('cackle'); }, 100);
    setTimeout(function(){                 // let the portrait clear first
      picked.forEach(function(p){ discover(p); });
      resumeCeremonies();
    }, 620);
  });
}

/* ═══════════════════════════════════════════════════════════════
   SETUP — the first conversation
   ═══════════════════════════════════════════════════════════════ */
var visited = {}, added = [];

function openSetup(){
  $('setup').style.display = 'flex';
  paintSetupList();
}
function showStep(n){
  ['mode','explore',1,3,2].forEach(function(k){
    var el = $('step-'+k) || $('step'+k);
    if (el) el.style.display = (k === n) ? 'flex' : 'none';
  });
}

var struck = {};
function paintNeverList(){
  var q = ($('never-search').value || '').toLowerCase();
  var el = $('never-list'); el.innerHTML = '';
  var g = groupByState(openPois().filter(function(p){
    if (!q) return true;
    var st = p.state && STATES[p.state] ? STATES[p.state].name.toLowerCase() : '';
    return p.name.toLowerCase().indexOf(q) >= 0 || st.indexOf(q) >= 0;
  }));
  Object.keys(g).sort(function(x,y){
    return (STATES[x]?STATES[x].name:'zz') < (STATES[y]?STATES[y].name:'zz') ? -1 : 1;
  }).forEach(function(k){
    var h = document.createElement('div'); h.className = 'state-head';
    h.innerHTML = '<span>'+(STATES[k]?STATES[k].name:'Elsewhere')+'</span>';
    el.appendChild(h);
    g[k].forEach(function(p){
      var row = document.createElement('button');
      row.className = 'check strike' + (struck[p.id] ? ' on' : '');
      row.innerHTML = '<span class="box"></span><span class="nm"></span>';
      row.querySelector('.nm').textContent = p.name;
      row.onclick = function(){
        struck[p.id] = !struck[p.id];
        row.classList.toggle('on', !!struck[p.id]);
        countStruck();
      };
      el.appendChild(row);
    });
  });
  countStruck();
}
function countStruck(){
  var n = Object.keys(struck).filter(function(k){ return struck[k]; }).length;
  $('never-count').textContent = n === 0 ? 'Everything stays' :
    n + (n === 1 ? ' place struck out' : ' places struck out');
}
function paintSetupList(){
  var q = ($('setup-search').value || '').toLowerCase();
  var el = $('setup-list'); el.innerHTML = '';
  var g = groupByState(openPois().filter(function(p){
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

/* ── Finding places ───────────────────────────────────────────────
   Photon (komoot) is built for search-as-you-type, so that is the first
   stop. If it is unreachable we fall back to Nominatim, which is not, so
   that path only runs on an explicit search. Coordinates always work. */
var searchTimer = null, searchSeq = 0;

function queueSearch(){
  clearTimeout(searchTimer);
  var q = ($('add-search').value || '').trim();
  if (q.length < 3){ $('add-results').innerHTML = ''; return; }
  searchTimer = setTimeout(function(){ searchPlace(); }, 350);
}

function searchPlace(){
  var q = ($('add-search').value || '').trim();
  var box = $('add-results');
  if (!q){ box.innerHTML = ''; return; }
  if (q.length < 2){ box.innerHTML = '<div class="hint">A little more to go on.</div>'; return; }

  var seq = ++searchSeq;
  box.innerHTML = '<div class="hint">Searching the maps…</div>';

  var near = pos ? ('&lat=' + pos.lat.toFixed(3) + '&lon=' + pos.lng.toFixed(3)) : '';
  var url = 'https://photon.komoot.io/api/?limit=10&lang=en' + near + '&q=' + encodeURIComponent(q);

  fetch(url)
    .then(function(r){ if (!r.ok) throw 0; return r.json(); })
    .then(function(d){
      if (seq !== searchSeq) return;
      var hits = (d.features || []).map(function(f){
        var pr = f.properties || {}, c = f.geometry && f.geometry.coordinates;
        if (!c) return null;
        return {
          name: pr.name || pr.city || pr.county || 'Unnamed',
          where: [pr.state, pr.country].filter(Boolean).join(', '),
          kind: pr.osm_value || pr.type || '',
          isPlace: pr.osm_key === 'place' || pr.osm_key === 'boundary',
          lat: c[1], lng: c[0]
        };
      }).filter(Boolean);

      // towns and cities first, then everything else
      hits.sort(function(x,y){ return (y.isPlace?1:0) - (x.isPlace?1:0); });
      if (!hits.length) throw 0;
      showResults(hits);
    })
    .catch(function(){
      if (seq !== searchSeq) return;
      // Nominatim, one shot, no type-ahead
      fetch('https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&q=' +
            encodeURIComponent(q))
        .then(function(r){ return r.json(); })
        .then(function(list){
          if (seq !== searchSeq) return;
          var hits = (list || []).map(function(r){
            var ad = r.address || {};
            return {
              name: ad.city || ad.town || ad.village || ad.hamlet || r.name || r.display_name.split(',')[0],
              where: [ad.state, ad.country].filter(Boolean).join(', '),
              kind: r.type || '', isPlace: true,
              lat: parseFloat(r.lat), lng: parseFloat(r.lon)
            };
          });
          if (!hits.length){
            $('add-results').innerHTML = '<div class="hint">Nothing by that name. Try the town it sits near, or add it by coordinates.</div>';
            return;
          }
          showResults(hits);
        })
        .catch(function(){
          $('add-results').innerHTML = '<div class="hint">The map service did not answer. You can still add it by coordinates.</div>';
        });
    });
}

function showResults(hits){
  var box = $('add-results');
  box.innerHTML = '';
  hits.slice(0,8).forEach(function(h){
    var b = document.createElement('button');
    b.className = 'result';
    var sub = [h.where, h.isPlace ? '' : h.kind].filter(Boolean).join(' · ');
    b.innerHTML = '<span class="r-name"></span><span class="r-where"></span>';
    b.querySelector('.r-name').textContent = h.name;
    b.querySelector('.r-where').textContent = sub;
    b.onclick = function(){
      added.push({ id:uid(), name:h.name, state:stateOf(h.lat,h.lng),
                   lat:h.lat, lng:h.lng, found:false });
      $('add-search').value = '';
      box.innerHTML = '';
      searchSeq++;
      paintAdded();
    };
    box.appendChild(b);
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

  // strike out everywhere the traveller will never go
  var gone = Object.keys(struck).filter(function(k){ return struck[k]; });
  if (gone.length){
    gone.forEach(function(id){ if (removed.indexOf(id) < 0) removed.push(id); });
    gone.forEach(function(id){
      if (poiLayer[id]){ map.removeLayer(poiLayer[id]); delete poiLayer[id]; }
    });
    pois = pois.filter(function(p){ return gone.indexOf(p.id) < 0; });
    struck = {};
  }

  var any = false;
  pois.forEach(function(p){
    if (visited[p.id]){ p.found = true; revealPoi(p, false); any = true; }
  });
  setupDone = true;
  applyMode();
  auditStates();
  save();
  refreshPoiMarkers(); paintStats(); paintList();
  $('setup').style.display = 'none';
  maskDirty = true;
  if (any) toast('Your travels are on the map.');
  beginTracking();
  setTimeout(resumeCeremonies, 600);
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
  applyMode();
  if (mapMode()){                      // nothing to track — the traveller reports in
    setWorldView(false);
    $('g-err').textContent = '';
    return;
  }
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
    ensureAudio(); hideGate();
    if (!setupDone) introSequence(); else beginTracking();
  };
  $('g-sim').onclick = function(){
    ensureAudio(); cfg.sim = true; hideGate();
    if (!setupDone) introSequence(); else startSim();
  };

  // setup wizard
  $('setup-search').oninput = paintSetupList;
  $('s1-next').onclick = function(){ afterSeen(); };
  $('s1-none').onclick = function(){ visited = {}; paintSetupList(); afterSeen(); };
  Array.prototype.forEach.call(document.querySelectorAll('.choice'), function(b){
    b.onclick = function(){
      var group = b.dataset.key, val = b.dataset.v;
      Array.prototype.forEach.call(
        document.querySelectorAll('.choice[data-key="'+group+'"]'), function(x){
          x.classList.toggle('on', x === b);
        });
      cfg[group] = val; save();
      setTimeout(function(){
        if (group === 'mode') exploreQuestion();
        else {
          applyMode();
          // switching to State Mode swaps the whole set of places
          if (stateMode()) pois = statePois(); else if (!pois.length) load();
          refreshPoiMarkers();
          seenQuestion();
        }
      }, 260);
    };
  });

  $('b-log').onclick = logTravels;
  $('log-search').oninput = paintLogList;
  $('log-done').onclick = commitLog;
  $('log-none').onclick = function(){        // nothing to report — just close
    logged = {};
    $('logbook').style.display = 'none';
    setTimeout(resumeCeremonies, 300);
  };
  $('never-search').oninput = paintNeverList;
  $('s3-next').onclick = function(){ secondQuestion(); };
  $('s3-none').onclick = function(){ struck = {}; paintNeverList(); secondQuestion(); };
  $('add-go').onclick = function(){ clearTimeout(searchTimer); searchPlace(); };
  $('add-search').oninput = queueSearch;
  $('add-search').onkeydown = function(e){
    e.stopPropagation();
    if (e.key === 'Enter'){ e.preventDefault(); clearTimeout(searchTimer); searchPlace(); }
  };
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
  $('s2-done').onclick = function(){ farewell(finishSetup); };

  // HUD
  $('f-realm').onchange = function(){ setRealm(this.value, true); setWorldView(true); this.blur(); };

  $('b-center').onclick = recenter;
  $('b-sheet').onclick  = function(){ openSheet(true); };
  $('b-drop').onclick   = function(){ setPlaceMode(placeMode === 'poi' ? false : 'poi'); };
  $('b-secret').onclick = function(){ setPlaceMode(placeMode === 'secret' ? false : 'secret'); };
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

  $('build-id').textContent = BUILD;

  /* Clears every cache and the service worker, then reloads from the server.
     Your journal is untouched. */
  /* Runs the audit by hand and, if nothing needed fixing, says why —
     usually a state has a place in it that has not been reached yet. */
  $('a-repair').onclick = function(){
    var fixed = auditStates();
    if (fixed){
      toast(fixed + (fixed === 1 ? ' state opened.' : ' states opened.'));
      return;
    }
    var partial = [];
    for (var code in STATES){
      var inState = openPois().filter(function(p){ return p.state === code; });
      var f = inState.filter(function(p){ return p.found; }).length;
      if (f && f < inState.length) partial.push(STATES[code].name+' '+f+'/'+inState.length);
    }
    toast(partial.length
      ? 'Not finished yet — ' + partial.slice(0,3).join(', ')
      : 'Every finished state is already open.');
  };

  $('a-update').onclick = function(){
    toast('Fetching the newest charts…');
    var jobs = [];
    if (window.caches && caches.keys)
      jobs.push(caches.keys().then(function(k){
        return Promise.all(k.map(function(n){ return caches.delete(n); }));
      }));
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations)
      jobs.push(navigator.serviceWorker.getRegistrations().then(function(rs){
        return Promise.all(rs.map(function(r){ return r.unregister(); }));
      }));
    Promise.all(jobs).catch(function(){}).then(function(){
      setTimeout(function(){ location.replace(location.pathname + '?r=' + Date.now()); }, 300);
    });
  };

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
    visited = {}; struck = {};
    pois.forEach(function(p){ if (p.found && !p.secret) visited[p.id] = true; });
    openSheet(false); introSequence();
  };
  $('a-reset').onclick = function(){
    if (!confirm('Let the fog return? Every charted mile is forgotten.')) return;
    reveals = []; trailCells = new Set(); areaCells = new Set();
    path = []; drawPath();
    pois.forEach(function(p){ p.found = false; p.at = null; });
    refreshPoiMarkers(); maskDirty = true; save(); paintStats(); paintList();
    toast('The world is dark again.');
  };

  // d-pad + keys
  var dirs = { n:{x:0,y:1}, s:{x:0,y:-1}, e:{x:1,y:0}, w:{x:-1,y:0}, stop:{x:0,y:0} };
  Array.prototype.forEach.call(document.querySelectorAll('#pad button'), function(b){
    b.onclick = function(){ simHalted = false; simVec = Object.assign({}, dirs[b.dataset.dir]); };
  });
  var keymap = { ArrowUp:'n', ArrowDown:'s', ArrowLeft:'w', ArrowRight:'e',
                 w:'n', s:'s', a:'w', d:'e', W:'n', S:'s', A:'w', D:'e' };
  /* WASD steers the test traveller — but never while the traveller is typing.
     iOS fires keydown for the on-screen keyboard too, so swallowing these
     would eat those letters out of every search field. */
  function typingInto(e){
    var t = e.target;
    if (!t) return false;
    var tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }
  window.addEventListener('keydown', function(e){
    if (typingInto(e) || uiBusy()) return;
    if (e.key === 'Shift') simSprint = true;
    if (!cfg.sim || !keymap[e.key]) return;
    e.preventDefault();
    // a held key repeats; only a fresh press picks the reins back up
    if (simHalted && e.repeat) return;
    simHalted = false;
    simVec = Object.assign({}, dirs[keymap[e.key]]);
  });
  window.addEventListener('keyup', function(e){
    if (typingInto(e)) return;
    if (e.key === 'Shift') simSprint = false;
    if (cfg.sim && keymap[e.key]) simVec = {x:0,y:0};
  });
  ['gesturestart','gesturechange','gestureend'].forEach(function(g){
    document.addEventListener(g, function(e){ e.preventDefault(); }, { passive:false });
  });
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════ */
load();
buildMap();
applyMode();
auditStates();
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
