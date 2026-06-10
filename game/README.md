# Grid World — visual prototype

A 20×20 grid world in the browser, styled after the reference frames in
`../docs/frames`: high-angle 3D camera, pastel stone tiles with mossy cracks,
castle walls with battlements and corner towers, randomly generated rooms
with glowing (locked/open) gates, and crystal clusters.

Visuals only for now — no gameplay, no rules. Generation is placeholder
random; real rules come later.

## Run

```sh
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

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
into `public/textures/` and refresh — see `public/textures/README.md` for
the full list of names and sizes.

## Code map

| File              | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `src/config.js`   | Grid size, palette, camera tuning constants               |
| `src/textures.js` | Procedural placeholder textures + PNG override loading    |
| `src/generate.js` | Random layout: rooms, walls, gates, crystals (seeded RNG) |
| `src/build.js`    | Turns a layout into instanced meshes (the whole scene)    |
| `src/camera.js`   | Fixed-angle rig with smoothed, clamped pan/zoom           |
| `src/postfx.js`   | Bloom + vignette post-processing                          |
| `src/main.js`     | Renderer, lights, sky/fog, animation loop, regeneration   |
