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

Camera movement is smooth (damped), the camera cannot go below the ground,
and the view cannot be dragged away from the land.

## What it shows

- **Ground:** 127 m x 127 m of flat dry soil, with uneven colour like the
  real land.
- **Right side** (seen from the entrance): a block wall along the full side,
  2 m high and 0.4 m thick.
- **Other three sides:** grey concrete pillars (1.8 m high, 15 cm square, one
  about every 3 m) joined by 3 lines of metal wire. Three pillars are left
  out in the middle of the front to make the entrance gate (about 12 m wide).
- Sunlight with soft shadows and a simple sky.

The land is built in code in `main.js` (no model file). Colours and the look
of the soil, wall and pillars follow the photos in `reference-photos/`. Sizes
are constants at the top of `main.js`.

## Project status

- **Phase 1 - done:** PWA skeleton and Three.js viewer.
- **Phase 2 - done:** The land, wall and fence, built in Three.js code
  instead of Blender.
- **Phase 3 - later:** Placeable objects on the land (pool, pit, plants, crop
  field).

The GLB loader is still in `main.js` for later use. It is switched off by
`USE_GLB_MODEL = false`; set it to `true` and add `models/zameen.glb` to show
a Blender model instead of the built-in land.

## Files

```
index.html             Page
style.css              Styles
main.js                3D viewer (Three.js + OrbitControls + GLTFLoader)
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

## Rules for this repo

- The source land video (282 MB) is reference only and must **not** be
  committed. Video files are blocked in `.gitignore`.
