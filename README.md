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

## Project status

- **Phase 1 - done:** PWA skeleton and Three.js viewer. Until the real model
  exists, a flat soil-coloured placeholder ground (with a faint 10 m grid) is
  shown.
- **Phase 2 - not started:** Model the land in Blender and export it to
  `models/zameen.glb` (under 5 MB). Flat plain soil; mud wall on the right
  side (seen from the entrance); concrete pillars with 3 lines of wire on the
  other three sides.
- **Phase 3 - later:** Placeable objects on the land (pool, pit, plants, crop
  field).

When `models/zameen.glb` is added, the viewer loads it automatically and
removes the placeholder. No code change is needed.

## Files

```
index.html             Page
style.css              Styles
main.js                3D viewer (Three.js + OrbitControls + GLTFLoader)
sw.js                  Service worker (offline support)
manifest.webmanifest   PWA manifest (name, icons, colours)
icons/                 App icons
models/                zameen.glb goes here (Phase 2)
vendor/three/          Three.js r170, stored locally so the app works offline
```

There is no build step. It is a plain static site.

## Run it locally

A service worker needs `http://localhost` or HTTPS, so open it through a small
web server, not by double-clicking `index.html`:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. To install on a phone, host the folder on
any HTTPS static host (for example GitHub Pages), open it in Chrome and choose
"Add to Home screen".

## Performance notes (mid-range Android)

- Renders only when the camera moves, not continuously (saves battery).
- Pixel ratio capped at 2.
- Two lights, no shadows, simple materials.

## Rules for this repo

- The source land video (282 MB) is reference only and must **not** be
  committed. Video files are blocked in `.gitignore`.
