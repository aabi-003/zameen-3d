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
  layout saved in localStorage (`zameen3d-layout-v1`). Not yet confirmed by
  the owner on the phone.
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
