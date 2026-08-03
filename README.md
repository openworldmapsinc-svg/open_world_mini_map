# Fogbound

A fog-of-war map of the real world, built as an installable web app. Real OpenStreetMap terrain
sits under an opaque fog layer. Walking clears a circle around you; reaching a point of interest
clears a wide one. The window holds a one-mile radius around you and shifts when you approach its edge.

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app — map, fog canvas, GPS tracking, POI system, UI |
| `manifest.json` | Install metadata for the home-screen app |
| `sw.js` | Service worker: caches the app shell and every map tile you've loaded |
| `icon.svg`, `icon-180.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | App icons |

Drop all of these in the repo root, next to each other. No build step.

## Install on iPhone

1. Open `https://openworldmapsinc-svg.github.io/open_world_poc/` in **Safari** (Chrome on iOS can't install to the home screen).
2. Share → **Add to Home Screen**.
3. Launch from the icon. Tap **Begin the survey** and allow location "While Using the App".

Location only works over HTTPS, which GitHub Pages provides.

## Tuning

Open **Expedition** in the app to change values live, or edit the `DEFAULTS` block near the top of the
script in `index.html`:

```js
viewRadiusMiles  : 1     // half-width of the visible window
shiftThreshold   : 0.72  // shift the window at this fraction of the radius
revealRadiusM    : 55    // fog cleared as you walk
poiRevealRadiusM : 400   // fog cleared when a point is found
poiTriggerRadiusM: 45    // how close you must get to trigger a point
maxAccuracyM     : 75    // ignore GPS fixes worse than this
```

## Preloading points of interest

Edit `SEED_POIS` in `index.html`. It is used only on a device with no saved game.

```js
const SEED_POIS = [
  { name:'The Old Mill', lat:34.8526, lng:-82.3940, radius:500 },
  { name:'Signal Hill',  lat:34.8601, lng:-82.4012 }
];
```

`radius` is optional and overrides `poiRevealRadiusM` for that point. In the running app you can also
place points with the **+** button, add them by coordinates, or scatter six test points nearby.

## Testing without walking

Expedition → turn on **Walk with the d-pad instead of GPS**, or tap **Test without GPS** on the
opening screen. Arrow keys or WASD move you; hold Shift to sprint. Everything else behaves identically.

## Saved data

Trail, points, and settings live in `localStorage` on that one device — no account, no server.
**Export save** writes a JSON file; **Import save** restores it. **Re-fog the entire map** wipes it.

## Updating a deployed version

The service worker serves the cached shell first. After pushing changes, bump `VERSION` in `sw.js`
(`v3` → `v4`) so returning devices pick them up, then close and reopen the app once.

## Tiles and attribution

Default terrain is CARTO Voyager; Nightfall, standard OSM, topographic, and satellite are also
available. All are free public endpoints suitable for a prototype, and the on-screen attribution must
stay visible. For real traffic, get a keyed tile plan (MapTiler, Stadia, Mapbox) and swap the URL in
the `STYLES` block.
