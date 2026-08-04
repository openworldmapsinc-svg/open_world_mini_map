# Open World Maps — *OpenWorld*

The real world under fog. Travel it, and the map remembers.

## Files

| File | Purpose |
|---|---|
| `index.html` | Shell — markup, art direction, HUD, zoom rail, setup screens |
| `data.js` | The 130 default cities by state, state extents, US outline, creatures and sea lettering |
| `app.js` | Fog engine, region unfogging, GPS, audio, wizard |
| `manifest.json` | Home-screen install metadata |
| `sw.js` | Caches the app and every tile you've loaded |
| `icon.svg`, `icon-180/192/512.png`, `icon-maskable-512.png` | App icons |

All eleven files go in the repo root. No build step.

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

**Pinch to zoom**, from roughly **100 feet across** to the **whole United States** (zoom 3–21),
continuously. Scroll wheel and double-tap work too. The **Span** reading in the crest is the width
of the short edge of the screen. Whatever the scale, the view recenters on you when you reach 70%
of the way to the edge.

## Two maps in one

Zoomed out, the country is drawn as a chart of the realms: heavy parchment tint, sea serpents and
krakens in the oceans, yeti and pine wilds across Canada, dragons and a volcano over Mexico, a
compass rose in the Atlantic, and lettered seas. As you zoom past about level 6 the illustration
fades and the tint eases off, so by street level you are looking at the plain, accurate modern map
of wherever you are standing. Creatures and lettering live in `data.js` under `LORE` and `LABELS`;
their drawings are in the `ART` block at the top of `app.js`.

**Fog stops at the coast.** It is clipped to a US outline (`OUTLINE` in `data.js`), so the Pacific,
the Atlantic, the Gulf, Canada and Mexico are always visible for context — only undiscovered
American ground is hidden. Travelling outside the US at local zoom restores ordinary fog everywhere.

## Your travel path

Everywhere you have physically moved is drawn as a faint red dashed line, over the cleared ground so
it stays readable. **Expedition → Travel path** sets its opacity, or slides to zero to hide it.
Jumps (teleporting in test mode) start a new line rather than drawing a straight streak across the
country.

## Testing without walking

**Expedition → Travel by d-pad, not GPS.** Arrow keys or WASD; hold Shift to ride hard. Speed
scales with the current zoom, so crossing the country at country scale takes about as long as
crossing a block at street scale. In this mode every row in the atlas gets a **Travel** button
that carries you straight there — the fastest way to see discoveries fire.

## Adjustable in Expedition

Trail clearing radius, arrival range (how close counts as reaching a city), the shift threshold,
travel-path opacity, map style, and the discovery sound. Point clearing radius is gone — that is now derived from the
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
