# Open World Maps — *OpenWorld*

The real world under fog. Travel it, and the map remembers.

## Files

| File | Purpose |
|---|---|
| `index.html` | Shell — markup, art direction, HUD, cartographer scene, setup screens |
| `data.js` | 128 cities and 48 secrets by state, state extents, US outline, realm frames |
| `states.js` | Hand-authored outlines for all 50 states |
| `app.js` | Fog engine, region unfogging, GPS, audio, wizard |
| `manifest.json` | Home-screen install metadata |
| `sw.js` | Caches the app and every tile you've loaded |
| `cartographer.jpg` | The Cartographer's portrait |
| `icon.svg`, `icon-180/192/512.png`, `icon-maskable-512.png` | App icons |

All thirteen files go in the repo root. No build step.

## How you play

The Cartographer's first two questions set the shape of the game, each with a description on screen.

**How would you like to play?**

- **Explorer Mode** — the map follows you. Carry it as you travel and fog lifts around you in real
  time. Needs location.
- **Map Mode** — no tracking at all. A **Log your travels** button opens a conversation with the
  Cartographer, you tick off where you have been, he says *"very good"* and laughs, and the world map
  plays every discovery in turn. The camera is locked to world view throughout.

**How do you explore?**

- **By Place** — cities and towns are the prize, clearing 75/100/125 miles by size. Taking every
  place in a state opens the whole state with a *Fully Explored* celebration. Secrets are in play.
- **By State** — the fifty states are the prize. Set foot anywhere in one and it opens border to
  border. No cities to configure, no secrets, and the places menu disappears entirely.

The two are independent: Map Mode with By State means ticking off states from an armchair; Explorer
Mode with By Place is the original game.

## First run

A title card, then the Cartographer himself. He appears in portrait with a dialogue box that
animates up and types his line out; each appearance is announced by a short wordless vocalization
(a throat clear or an "hmm", synthesized, no audio files). **Continue** hands off to the answer
screen. After the first answer the scene cuts back to him for the second question, and after the
last one he says *"Very good. Good luck out there."* and cackles before the world opens.

He asks three things: which cities you have already seen, **what you will never see** — struck out
and removed from the map for good — and what else you want added. Checked cities are unfogged immediately and silently. Added places are searched
through OpenStreetMap's Nominatim service, or entered as coordinates. Tapping the dialogue box
skips the typing. You can reopen the whole sequence from **Expedition → Revisit the questions**.

## How the fog clears

The fog is a living body rather than a flat sheet: four layers of tileable noise, two lit and two
shadowed, drift very slowly at different speeds, turn, breathe in and out over about sixteen
seconds, and lag behind the map as you move so they read as hanging above the world rather than
pinned to it. A vertical gradient weights it heavier below, and the fog rim just outside cleared
ground is lit so the edge looks like it has thickness. Where the fog's extent is uncertain it errs
on the side of covering more — better a little spill onto cleared ground or open sea than a bare
strip that should have been hidden.

**Travelling** clears a soft circle around you as you move (trail clearing, default 150 m).

**Arriving at a city** plays out as a short ceremony: the map pulls back to world view, the place
is named on screen, a gust runs through the fog and carries it off over about three seconds with the
wind cue underneath it, and then the view drops back to where you are standing. Simultaneous
arrivals queue and play one after another, and nothing starts while you have the atlas, the settings
or the Cartographer open — a held discovery waits until you are back on the map.

Reaching a city clears a circle centred on **wherever you were standing** when it triggered — not on
the city's own coordinates. How far it reaches depends on the size of the place: **75 miles** for a
small town, **100** for a mid-sized city, **125** for a major one (`TIER_MILES` in `app.js`, tier per
city in `data.js`).

Circles freely run over towns nobody has reached yet, and that is the point — see **Towns** below.

When every city in a state has been reached, that whole state falls open at once — **along its real
border**. States are clipped to hand-authored outlines (`states.js`, 811 vertices across 50 states,
straight-line borders exact and coasts generalised) rather than bounding boxes. The old boxes cleared
about 35% more ground than the state actually occupies; Florida, New Jersey and Michigan were the
worst offenders, spilling fog clearance far out to sea. Each state is divided among its
cities by proximity: every point in the state belongs to whichever city is nearest. So in
California, San Francisco opens 57% of the state — everything north of roughly Fresno — Los
Angeles opens 35% from the middle down, and San Diego opens the bottom 7%. The split is computed
from whatever cities exist in that state at the moment of discovery, so adding your own city
changes how the state divides. Discovery also plays a wind-and-sting cue and unfurls a banner.

State shapes are rectangles for now. To use true outlines, define `window.OW_STATE_SHAPES` as
`{ CA: [[[lng,lat], ...]], ... }` before `app.js` loads — the region builder will clip to the
polygon automatically, no other change needed.

## Three views, and realms

There is no free zoom. The map has exactly three states, and pinching steps one rung at a time:

- **Local** — centred on you, half a mile in every direction. The fog is slightly translucent here,
  so you can just make out the streets beneath it.
- **Region** — thirty-five miles in every direction: seventy miles across the short edge of the screen.
  This is the road-trip view, far enough to see a day's driving and how much ground it opened, close
  enough that the cleared corridor still reads. The walked corridor is held to a minimum thread
  width so it never disappears at distance.
- **World** — the framed continental United States, with the Pacific, the Atlantic, Canada and
  Mexico around it. Fog is fully opaque and the frame is a hard boundary you cannot pull back past.

Scroll wheel steps too, and double-tap draws you in a rung (wrapping back to world from local).

**The camera is yours** in local and region view: drag to look around. While you have moved it by
hand the map stops following you and the compass button pulses. Press it once to bring the camera
back to you, press again to step closer. In world view dragging is off — the frame is the frame.

Which view you were in is remembered between sessions, and a discovery ceremony returns you to it.

Because the world frame excludes them, Alaska and Hawaii have their own frames. The faint **Realms**
picker in the bottom-left corner switches between *The Forty-Eight*, *Alaska* and *Hawaii*; each has
its own zoom-out limit and boundary. The app also switches automatically to whichever realm you are
standing in. Frames are defined in `REALMS` in `data.js`.

## Two maps in one

There are no drawn creatures, ships, wilds or invented sea names on the map — all of that has been
removed. The atmosphere comes from the fog, the tinting and the interface. Terrain styles that carry
a tint (Aged parchment, Cartographer's ink) ease it off as you move from world view to local view;
the default **Nightfall** style carries none, so the local map reads plainly and accurately.

**Fog stops at the coast.** It is clipped to a US outline (`OUTLINE` in `data.js`), so the Pacific,
the Atlantic, the Gulf, Canada and Mexico are always visible for context — only undiscovered
American ground is hidden. Travelling outside the US at local zoom restores ordinary fog everywhere.

## Editing what the Cartographer says

Every line of his dialogue is in one block at the top of `app.js`, marked
**EVERYTHING THE CARTOGRAPHER SAYS** — a `LINES` object keyed by moment (`greeting`, `explore`,
`seen`, `never`, `want`, `farewell`, `logAsk`, `logDone`), each with the lines he speaks and the
label on his button. The `BANNER` object just below holds the discovery banner wording.

The headings and option descriptions printed on the setup screens themselves live in `index.html`,
in the `.ask` and `.choice` blocks.

## Towns

Every city sits **beneath the fog**, so up close you see it only once its ground is clear. An
unreached place is nothing more than a **pale dot** — no name, no detail, just a mark that something
is there. Reach it and it becomes a **lit town**: gold, lamps burning, a pennant on the tower, its
name lettered underneath. It kindles to life the moment you arrive.

At **world view** all of that collapses to pips — a lit gold dot for a place you have reached, red
for a secret, and a small faint dot for one you have not. Towns and lettering would be unreadable
clutter at that distance. The pips also sit above the fog at world view, so unreached places show
faintly through it: you can make out where the country's places are without being told anything
about them.

This makes a discovery worth more than the ground it clears. Your circle spills over neighbouring
places and shows you that they exist without naming them or giving you credit. Roughly nine of every
ten discoveries expose at least one neighbour this way, about 1.8 on average. Dot size and town size
both follow the city's tier, so a major city reads larger even as a dot.

## Secrets

Forty-eight places are hidden in the data and never appear in the atlas, the setup questions or any
count — you find them only by wandering close enough. A secret announces itself as **Secret
Discovered** in red rather than gold, names the town it hides in, plays a colder minor chord, drops a
castle marker instead of a star, and clears **50 miles**, trimmed by the same rule. Secrets never count toward opening a state.

For testing, the red **+** below the gold one hides a secret wherever you tap.

## Your travel path

Everywhere you have physically moved is drawn as a faint red dashed line, over the cleared ground so
it stays readable. **Expedition → Travel path** sets its opacity, or slides to zero to hide it.
Jumps (teleporting in test mode) start a new line rather than drawing a straight streak across the
country.

## Testing without walking

**Expedition → Travel by d-pad, not GPS.** Arrow keys or WASD; hold Shift to ride hard. A discovery
brings you to a halt — you keep moving only once you press a direction again, so a ceremony never
plays out while you are still barrelling across the map. Speed scales with the current zoom, so crossing the country at country scale takes about as long as
crossing a block at street scale. In this mode every row in the atlas gets a **Travel** button
that carries you straight there — the fastest way to see discoveries fire.

## Adjustable in Expedition

Trail clearing radius, arrival range (how close counts as reaching a city), the shift threshold,
travel-path opacity, map style, and the discovery sound. Point clearing radius is gone — that is now derived from the
state split.

## Map styles

Nightfall (default), Aged parchment, Cartographer's ink, Wilderness relief, Realm from above.
The first three are ordinary OSM-based tiles with a sepia filter over the tile layer only, so the
fog and UI keep their own colour. Attribution must stay visible. For real traffic, move to a keyed
tile plan (MapTiler, Stadia, Mapbox) and swap the URL in `STYLES` at the top of `app.js`.

## Saved data

Everything lives in `localStorage` on the one device — no account, no server. Export and import
write a JSON journal. "Let the fog return" wipes it.

## Deploying an update

The service worker serves cached files first. After pushing, bump `VERSION` in `sw.js`
(`v4` → `v5`), then close and reopen the app once so the new version takes over.
