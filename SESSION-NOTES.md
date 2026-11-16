# Session notes (handoff)

Last updated 2026-11-16, so the next session can continue from here.
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
- The fence is continuous; there is no gate gap (none was asked for).
- The GLB loader is kept but off (`USE_GLB_MODEL = false`).
- Shadows are drawn once (`shadowMap.autoUpdate = false`). After adding or
  moving any object, set `renderer.shadowMap.needsUpdate = true`.

## Phase 3 - later, do not start without asking

Placeable 3D objects on the land: pool, hole/pit, plants, crop field (khet).

## Rules

- Never commit the source land video (282 MB). Video files are in `.gitignore`.
- Ask before starting Phase 3.
- After changing files that the service worker caches, bump `CACHE` in `sw.js`
  if phones keep showing an old version.
