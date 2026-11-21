# Zameen 3D

An interactive 3D view of a plot of land (4 acres, about 16,190 sq m, roughly
127 m x 127 m). It runs in the browser and can be installed on a phone as a
PWA (Progressive Web App). You move the camera around the land with mouse or
touch.

## Controls

| Action        | Touch (phone)          | Mouse (laptop)        |
| ------------- | ---------------------- | --------------------- |
| Orbit (ghumao) | Drag with one finger   | Left-button drag      |
| Zoom          | Pinch with two fingers | Scroll wheel          |
| Pan (khiskao) | Drag with two fingers  | Right-button drag     |
| Reset view    | Round button, bottom right | Same button       |

| Select an object | Tap it (yellow ring/frame) | Click it |
| Move an object | Put a finger on the selected object and drag, or press and hold any object for half a second | Drag the selected object |

Camera movement is smooth (damped), the camera cannot go below the ground,
and the view cannot be dragged away from the land.

## What it shows

- **Ground:** 127 m x 127 m of flat dry soil, with uneven colour like the
  real land.
- **Right side** (seen from the entrance): a block wall along the full side,
  2 m high and 0.4 m thick.
- **Other three sides:** grey concrete pillars (1.8 m high, 15 cm square, one
  about every 3 m) joined by 3 lines of metal wire. Three pillars are left
  out in the front to make the entrance gate (about 12 m wide), one pillar
  toward the baag side of the middle (`GATE_SHIFT` in `main.js`).
- Sunlight with soft shadows and a simple sky.

## Phase 3: objects you can move

Seen from the entrance (1 ft = 0.3048 m, all gaps 10 ft = 3.05 m):

- **Left half: orchard (baag).** 200 baby plants, 2 to 2.5 ft tall, about
  20 ft apart: cheeku (round dark-green bush), anar (upright light-green
  shrub with red fruit) and khajoor (thin trunk, long palm leaves).
- **Right half, from the entrance going back:** big pool, small pool, khet
  (one after another, long side left-right), then the kamra + solar at the
  back near the wall. Pool and khet areas are exactly khet 2 : big pool 1.5
  : small pool 0.5, after leaving 10 ft gaps between them and from the
  boundary/wall.
- **Kamra + solar** (one object, 24 ft x 10 ft): a small block room
  (12 ft x 10 ft, 10 ft high, steel door, window with grill, flat concrete
  roof) on one half, and two solar panels on a full steel stand (4 legs,
  slanted rails, braces, concrete footings, tilted 25 degrees to the front)
  on the other half.
- **Pools:** blue water (lighter near the edge) inside a concrete edge.
- **Khet:** tilled soil, an earth border and green crop rows.

**Bottom menu:** `+ Cheeku`, `+ Khajoor`, `+ Anar` add a plant at the free
spot nearest the middle of the screen. `Delete` removes the selected plant
(pools and khet can only be moved). `Reset layout` brings back the default
layout (it asks first).

**Rules while dragging:** plants at least 5 ft apart; pools, khet and plants
at least 10 ft from each other; everything 10 ft inside the boundary. If a
spot is too close, a red cross shows there, a short beep plays (Web Audio,
no sound file; the phone also vibrates), and on release the object goes back
to where it was. The camera does not move while you drag.

**Saving:** the layout is saved in the browser (`localStorage`, key
`zameen3d-layout-v1`) after every change, so it is still there after closing
the app.

**Adding a new plant type:** open `plants.js` and copy one line in
`PLANT_TYPES` (id, name, shape `bush` or `palm`, height, colours). A button
for it appears in the menu by itself.

All textures (water, tilled soil, crop leaves) are drawn in code, so there
are no image files and nothing copyrighted.

The land is built in code in `main.js` (no model file). Colours and the look
of the soil, wall and pillars follow the photos in `reference-photos/`. Sizes
are constants at the top of `main.js`.

## Project status

- **Phase 1 - done:** PWA skeleton and Three.js viewer.
- **Phase 2 - done:** The land, wall and fence, built in Three.js code
  instead of Blender.
- **Phase 3 - done:** Orchard plants, two pools, a khet and a kamra + solar, with
  drag-and-drop, spacing rules, warning beep and saved layout.

The GLB loader is still in `main.js` for later use. It is switched off by
`USE_GLB_MODEL = false`; set it to `true` and add `models/zameen.glb` to show
a Blender model instead of the built-in land.

## Files

```
index.html             Page
style.css              Styles
main.js                3D viewer, land, pools, khet, drag-and-drop, saving
plants.js              Plant types list (PLANT_TYPES) and how each plant is built
sw.js                  Service worker (offline support)
manifest.webmanifest   PWA manifest (name, icons, colours)
icons/                 App icons
models/                Optional zameen.glb (see USE_GLB_MODEL)
reference-photos/      Photos of the real land (frames from the video)
vendor/three/          Three.js r170, stored locally so the app works offline
```

There is no build step. It is a plain static site.

## Run it locally

A service worker needs `http://localhost` or HTTPS, so open it through a small
web server, not by double-clicking `index.html`:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

The live version is on GitHub Pages (served from branch `phone-3d`):
<https://aabi-003.github.io/zameen-3d/>. On a phone, open it in Chrome and
choose "Add to Home screen" to install it.

## Performance notes (mid-range Android)

- Renders only when the camera moves, not continuously (saves battery).
- Pixel ratio capped at 2, and lowered automatically if the phone is slow.
- The shadow map is drawn once and reused, because nothing in the scene moves.
- All pillars are one draw call, all wires another; textures are made in
  code, so there is nothing extra to download.
- Plants use instancing: one draw call per plant type, however many plants.
  All crop rows of the khet are one draw call too.
- Shadows are redrawn only while something is being dragged or changed.

## Rules for this repo

- The source land video (282 MB) is reference only and must **not** be
  committed. Video files are blocked in `.gitignore`.
