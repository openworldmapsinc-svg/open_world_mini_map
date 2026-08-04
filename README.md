# Open World Maps — *OpenWorld*

The real world under fog. Travel it, and the map remembers.

## Files

| File | Purpose |
|---|---|
| `index.html` | Shell — markup, art direction, HUD, zoom rail, setup screens |
| `data.js` | The 137 default cities by state, plus state extents |
| `app.js` | Fog engine, region unfogging, GPS, audio, wizard |
| `manifest.json` | Home-screen install metadata |
| `sw.js` | Caches the app and every tile you've loaded |
| `icon.svg`, `icon-180/192/512.png`, `icon-maskable-512.png` | App icons |

All seven files go in the repo root. No build step.

## First run

A title card, then the Cartographer asks two questions: which of the cities you have already
seen, and what else you want on the map. Checked cities are unfogged immediately and silently.
Added places are searched through OpenStreetMap's Nominatim service, or entered as coordinates.
You can reopen both questions any time from **Expedition → Revisit the questions**.

## How the fog clears

**Travelling** clears a soft circle around you as you move (trail clearing, default 150 m).

**Arriving at a city** clears that city's share of its state. Each state is divided among its
cities by proximity: every point in the state belongs to whichever city is nearest. So in
California, San Francisco opens 57% of the state — everything north of roughly Fresno — Los
Angeles opens 35% from the middle down, and San Diego opens the bottom 7%. The split is computed
from whatever cities exist in that state at the moment of discovery, so adding your own city
changes how the state divides. Discovery also plays a wind-and-sting cue and unfurls a banner.

State shapes are rectangles for now. To use true outlines, define `window.OW_STATE_SHAPES` as
`{ CA: [[[lng,lat], ...]], ... }` before `app.js` loads — the region builder will clip to the
polygon automatically, no other change needed.

## Zoom

The rail on the right runs from roughly **100 feet across** to the **whole United States**
(zoom 3–21), continuously. The reading under it is the width of the short edge of the screen.
Whatever the scale, the view recenters on you when you reach 70% of the way to the edge.

## Testing without walking

**Expedition → Travel by d-pad, not GPS.** Arrow keys or WASD; hold Shift to ride hard. Speed
scales with the current zoom, so crossing the country at country scale takes about as long as
crossing a block at street scale. In this mode every row in the atlas gets a **Travel** button
that carries you straight there — the fastest way to see discoveries fire.

## Adjustable in Expedition

Trail clearing radius, arrival range (how close counts as reaching a city), the shift threshold,
map style, and the discovery sound. Point clearing radius is gone — that is now derived from the
state split.

## Map styles

Aged parchment (default), Cartographer's ink, Wilderness relief, Nightfall, Realm from above.
The first three are ordinary OSM-based tiles with a sepia filter over the tile layer only, so the
fog and UI keep their own colour. Attribution must stay visible. For real traffic, move to a keyed
tile plan (MapTiler, Stadia, Mapbox) and swap the URL in `STYLES` at the top of `app.js`.

## Saved data

Everything lives in `localStorage` on the one device — no account, no server. Export and import
write a JSON journal. "Let the fog return" wipes it.

## Deploying an update

The service worker serves cached files first. After pushing, bump `VERSION` in `sw.js`
(`v4` → `v5`), then close and reopen the app once so the new version takes over.
