# Session notes (handoff)

Saved on 2026-11-15 so the next session (on the laptop) can continue from here.
The owner prefers explanations in simple Roman Urdu, one step at a time.

## Where things stand

- All work is on branch `phone-3d`. `main` is untouched. No pull request exists.
- **Phase 1 is done and live.** GitHub Pages serves branch `phone-3d`, folder
  `/ (root)`: <https://aabi-003.github.io/zameen-3d/>. The owner confirmed it
  runs on their Android phone.
- The viewer shows a placeholder ground until `models/zameen.glb` exists. When
  that file is pushed, the viewer loads it automatically (no code change) and
  frames the camera from the model's bounding box.

## Phase 2 - next, on the laptop with Blender MCP connected

Ask the owner for permission before starting. Then model the plot in Blender:

- Total area 4 acres (about 16,190 sq m). Assume square, about 127 m x 127 m,
  unless the owner gives exact dimensions.
- Ground: flat plain soil only. No water, no track, no pits, nothing else.
- Boundary: mud wall on the RIGHT side only (right when standing at the
  front/entrance looking in). The other THREE sides have concrete pillars at
  regular spacing, joined by 3 horizontal lines of wire, like a farm fence.
  No wall on those sides.
- Simple, clean, low-poly. Use the land video only as reference for soil
  colour and the look of the wall and pillars.
- Export as GLB, under 5 MB, to `models/zameen.glb`.
- Build it so Phase 3 objects can be placed on top later (ground as its own
  object, origin at the plot centre, ground surface at height 0).

Things the viewer expects from the model:

- Units in metres, Y up (the normal glTF export from Blender).
- Front/entrance on the +Z side in glTF (Blender -Y), so the default camera
  looks in from the front and the mud wall ends up on +X (the right).
- No shadows or heavy textures; plain colours or small textures only.

## Phase 3 - later, do not start without asking

Placeable 3D objects on the land: pool, hole/pit, plants, crop field (khet).

## Rules

- Never commit the source land video (282 MB). Video files are in `.gitignore`.
- Ask before starting Phase 2, and again before Phase 3.
- After changing files that the service worker caches, bump `CACHE` in `sw.js`
  if phones keep showing an old version.
