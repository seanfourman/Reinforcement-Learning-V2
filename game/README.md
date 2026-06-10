# Grid World — visual prototype

A 20×20 grid world in the browser, styled after the reference frames in
`../docs/frames`: high-angle 3D camera, pastel stone tiles with mossy cracks,
castle walls with battlements and corner towers, randomly generated rooms
with glowing (locked/open) gates, and crystal clusters.

Visuals only for now — no gameplay, no rules. Generation is placeholder
random; real rules come later, and a Python RL model will drive the world.

**Fully self-contained.** The only requirement is Python (standard library
only — no pip installs, no Node.js, no internet). The 3D engine (three.js)
is bundled in `vendor/`.

## Run

- **Windows:** double-click `Play.bat`
- **Mac/Linux:** `python3 serve.py` (or double-click `Play.command` after a
  one-time `chmod +x Play.command`)

A local server starts and the game opens in your default browser. Keep the
console window open while playing.

Why a server at all? Browsers block JavaScript modules on raw `file://`
pages, so the folder must be served over HTTP. `serve.py` is standard
library only, and it's also where the Python RL backend will plug in later.

## Controls

| Input                | Action                                  |
| -------------------- | --------------------------------------- |
| Mouse drag           | Pan the camera                          |
| WASD / arrow keys    | Pan the camera                          |
| Scroll wheel         | Zoom (clamped)                          |
| `R`                  | Regenerate the world with a new seed    |

The camera is locked to the reference viewing angle. Panning is clamped so
you can see a little past the walls but never far off the world.

## Swapping textures

All textures are procedural placeholders. Drop a PNG with the right name
into `textures/` and refresh — see `textures/README.md` for the full list
of names and sizes.

## Code map

| File / folder     | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `serve.py`        | Zero-dependency local server + browser launcher           |
| `src/config.js`   | Grid size, palette, camera tuning constants               |
| `src/textures.js` | Procedural placeholder textures + PNG override loading    |
| `src/generate.js` | Random layout: rooms, walls, gates, crystals (seeded RNG) |
| `src/build.js`    | Turns a layout into instanced meshes (the whole scene)    |
| `src/camera.js`   | Fixed-angle rig with smoothed, clamped pan/zoom           |
| `src/postfx.js`   | Bloom + vignette post-processing                          |
| `src/main.js`     | Renderer, lights, sky/fog, animation loop, regeneration   |
| `vendor/three/`   | Bundled three.js (no package manager needed)              |
