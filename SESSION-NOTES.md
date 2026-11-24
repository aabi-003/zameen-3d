# Session notes (handoff)

Last updated 2026-11-21, so the next session can continue from here.
The owner prefers explanations in simple Roman Urdu, one step at a time.

## Where things stand

- All work is on branch `phone-3d`. `main` is untouched. No pull request exists.
- GitHub Pages serves branch `phone-3d`, folder `/ (root)`:
  <https://aabi-003.github.io/zameen-3d/>. A push to `phone-3d` updates it.
- **Phase 1 is done** (PWA + viewer) and confirmed on the owner's Android phone.
- **Phase 2 is done in Three.js code, not Blender** (owner's change of plan,
  2026-11-16). `main.js` builds the ground, the right-side wall, and the
  pillar-and-wire fence on the other three sides, matched to
  `reference-photos/`. Not yet confirmed by the owner on the phone.
- The entrance/front is the +Z side; the wall is on +X. Ground surface is at
  height 0, plot centre at the origin. Parts are named `ground`, `wall`,
  `fence`, `pillars`, `wires` inside the `land` group.
- Entrance gate: 3 pillars are left out in the middle of the front side
  (`GATE_PILLARS`), an opening about 12 m wide with no wire across it.
- Default camera (and the reset button): "top-front" view from the gate side,
  tilted 35 degrees down (`HOME_TILT_DEG`), backed off until the whole plot fits.
- **Phase 3 is done (2026-11-21):** orchard plants (instanced, types in
  `plants.js`), 2 pools + khet in the right half (area 2 : 1.5 : 0.5),
  tap-to-select / hold-to-drag, 5 ft / 10 ft rules with red cross + beep,
  layout saved in localStorage (`zameen3d-layout-v1`, now version 2).
- **2026-11-21 changes:** pools one after another (big pool at the front,
  then small pool, then khet), kamra + 2 solar panels on a stand as one
  draggable object at the back-right, gate moved one pillar toward the baag
  side (`GATE_SHIFT = -1`; owner said "add a pillar on the water side, remove
  one on the baag side"). Old v1 layouts keep their plants; pools/khet go to
  the new default.
- **2026-11-24 changes (layout version 3):** kamra, solar1, solar2 are three
  separate objects at the front of the baag, right next to the gate on its
  left (owner said the back-right corner was wrong). First 3 baag rows
  removed (`ORCHARD_ROWS_FREE`). Solar: 2 big panels per stand, back legs =
  room height, tilt 30 deg, facing +Z (front). Plants redone with leaf cards,
  3 designs per type, natural colours, per-plant tint/lean, thaala with
  earth ring (suggestions 1-3 + part of 4). Ready-made 3D models (5): owner
  said leave it.
- **2026-11-24 later:** suggestion 4 done (grass tufts, water channels from
  the big pool along every baag row). Kacha track (`TRACK`, static, from the
  gate turning left behind the room/solar to the car; nothing may be placed
  on it). White car `gaadi` (draggable). Solar 2 has chhappar (thatch walls)
  on back and both sides, front open. Layout version still 3 (missing
  `gaadi` in a save just takes its default place).
- **2026-11-24 (3rd round):** track lighter (alpha ~0.4-0.5); track is now
  worked out from the car position (`trackPath(car)`, redrawn in
  `placeRect`), car refused if its track would cross objects/plants. New car:
  modern sedan from one extruded outline with wheel arches, cabin narrowing,
  creased normals (no brand logos). Both solar stands: chhappar on front +
  sides, back open, plastic chair each. Main channel 1.3 m wide with water,
  branches 0.3 m with a 7 cm water line.
- The GLB loader is kept but off (`USE_GLB_MODEL = false`).
- Shadows are drawn once (`shadowMap.autoUpdate = false`). After adding or
  moving any object, set `renderer.shadowMap.needsUpdate = true`.

## Phase 3 notes

- Rects (pools, khet) are fixed size; only positions are saved.
- `window.__zameen` is a small test hook used by automated browser checks.
- Free texture sites (ambientCG) are blocked from the cloud container, so
  all textures are drawn in code.

## Rules

- Never commit the source land video (282 MB). Video files are in `.gitignore`.
- After changing files that the service worker caches, bump `CACHE` in `sw.js`
  if phones keep showing an old version.
