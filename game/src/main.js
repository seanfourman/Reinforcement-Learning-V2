import * as THREE from "three";
import { GRID, PALETTE, CAMERA } from "./config.js";
import { createTextures } from "./textures.js";
import { buildWorld } from "./build.js";
import { buildFixedWorld } from "./fixedworld.js";
import { buildArchitecture } from "./architecture.js";
import { createFurniture } from "./furniture.js";
import { createDoors } from "./doors.js";
import { createDressing } from "./dressing.js";
import { parseLayout, setCell, setOffset, worldToCell } from "./layout.js";
import { makeKing, makePrincess } from "./characters.js";
import { createLiveActors } from "./live.js";
import { createMechanics } from "./mechanics.js";
import { createHeatmap } from "./heatmap.js";
import { initPanel } from "./panel.js";
import { initCpuPanel } from "./cpupanel.js";
import { createCameraRig } from "./camera.js";
import { createPostFX } from "./postfx.js";
import { getTheme } from "./themes/index.js";
import { initHud } from "./hud.js";
import { createTransition } from "./transition.js";
import { createStartMenu, getCpuTier } from "./startmenu.js";
import { loadBoardWalkers } from "./boardchars.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

const app = document.getElementById("app");

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.fog, 34, 78);

// soft vertical sky gradient - rebuilt per theme via setSky()
let skyTex = null; // only our own gradient is disposed here, never a cached HDRI
function setSky(stops) {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.55, stops[1]);
  g.addColorStop(1, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;
  if (skyTex) skyTex.dispose();
  skyTex = sky;
  scene.background = sky;
  scene.backgroundBlurriness = 0;
  scene.backgroundIntensity = 1;
}
setSky(["#8fa3cc", "#b9c2dd", "#d9cfd2"]);

// Some themes (the city) light the scene with a real captured HDRI: it
// drives image-based reflections on glossy surfaces and doubles as the skybox.
// We PMREM-prefilter it once and cache per URL; the gradient sky above is the
// fallback while it loads and for themes that don't request one.
const pmrem = new THREE.PMREMGenerator(renderer);
const hdrLoader = new HDRLoader();
const envCache = new Map(); // url -> { envMap, background }
let currentEnvKey = null; // guards against a theme switch mid-load

function applyEnv(theme) {
  const key = theme.env || null;
  currentEnvKey = key;
  if (!key) {
    scene.environment = null;
    return;
  } // gradient sky (setSky) stays
  const put = (entry) => {
    if (currentEnvKey !== key) return; // theme switched while loading
    scene.environment = entry.envMap;
    scene.environmentIntensity = theme.envIntensity ?? 1;
    scene.background = entry.background;
    scene.backgroundBlurriness = theme.envBlur ?? 0;
    scene.backgroundIntensity = theme.bgIntensity ?? 1;
  };
  const cached = envCache.get(key);
  if (cached) {
    put(cached);
    return;
  }
  hdrLoader.load(key, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const envMap = pmrem.fromEquirectangular(tex).texture;
    const entry = { envMap, background: tex };
    envCache.set(key, entry);
    put(entry);
  });
}

const camera = new THREE.PerspectiveCamera(
  CAMERA.fov,
  innerWidth / innerHeight,
  0.1,
  200,
);
const rig = createCameraRig(camera, renderer.domElement);

// ------------------------------------------------------------------ lights
const hemi = new THREE.HemisphereLight(0xdfd8f7, 0x9a7a68, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 1.9);
sun.position.set(GRID / 2 - 9, 21, GRID / 2 - 5);
sun.target.position.set(GRID / 2, 0, GRID / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -19;
sun.shadow.camera.right = 19;
sun.shadow.camera.top = 19;
sun.shadow.camera.bottom = -19;
sun.shadow.camera.near = 4;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.008; // low: keeps shadows attached to the object base (no light gap)
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xb9a8e8, 0.35);
fill.position.set(GRID / 2 + 10, 12, GRID / 2 + 9);
scene.add(fill);

// apply a theme's palette/sky/lighting (called on every world rebuild)
function applyTheme(theme) {
  setSky(theme.sky);
  scene.fog.color.set(theme.fog);
  scene.fog.near = theme.fogNear;
  scene.fog.far = theme.fogFar;
  hemi.color.set(theme.hemi[0]);
  hemi.groundColor.set(theme.hemi[1]);
  hemi.intensity = theme.hemi[2];
  sun.color.set(theme.sun);
  sun.intensity = theme.sunIntensity;
  fill.color.set(theme.fill);
  fill.intensity = theme.fillIntensity;
  renderer.toneMappingExposure = theme.exposure;
  applyEnv(theme); // HDRI image-based lighting/skybox, or clears it
  fx.setBloom(theme.bloom); // per-theme glow (undefined -> default medieval bloom)
}

// ------------------------------------------------------------------ world + actors
const textures = createTextures();
const walkers = { red: makeKing(), blue: makePrincess() };
const actors = createLiveActors(scene, walkers);
const heatmap = createHeatmap(scene);

let current = null; // static scene shell (castle, walls, nature)
let archGroup = null; // plastered architecture (walls + columns)
let furniture = null; // beds, wardrobes, bookshelves, tables
let doors = null; // arched bedroom doors
let dressing = null; // carpet + rugs
let mechanics = null; // mirrors, levers, traps
let themeScene = null; // a theme that ships its own geometry (e.g. the city)
let arenaMode = false; // round 4 (continuous arena): the theme renders its own agents
let worldVersion = -1; // last world we built
let latestStats = null;
let latestFrame = null;
let menu = null; // start menu (cabin background); gates the game boot

initHud(); // Blue top-left / Red top-right score + round banner
const transition = createTransition(); // video-game curtain between arenas

// keep downloaded files (textures, .dae) resident so a re-load never re-fetches
THREE.Cache.enabled = true;

// Resident cache of BUILT themed scenes, keyed by theme name. Rounds wrap
// (round 4 -> round 1 -> ...), so instead of disposing + rebuilding a theme's
// heavy model every time we revisit it, we build it ONCE and keep it in memory,
// just detaching / re-attaching its group. Revisiting a level is then instant -
// no reload, no re-parse, no shader recompile. `rowsKey` guards against a level
// whose layout regenerated differently (rebuild fresh in that case).
const sceneCache = new Map(); // theme name -> { themeScene, rowsKey }
let activeThemeKey = null; // theme name of the themed scene currently attached

// detach the live world: a resident themed scene is kept warm in the cache; a
// non-themed (medieval) world is freed as before.
function detachActiveWorld() {
  if (activeThemeKey && themeScene) {
    scene.remove(themeScene.group); // keep it resident in sceneCache
    themeScene = null;
    activeThemeKey = null;
    return;
  }
  disposeWorld();
}

function disposeWorld() {
  if (current) {
    scene.remove(current.group);
    current.dispose?.();
    current = null;
  }
  if (archGroup) {
    scene.remove(archGroup);
    archGroup.userData.dispose?.();
    archGroup = null;
  }
  if (furniture) {
    furniture.dispose();
    furniture = null;
  }
  if (doors) {
    doors.dispose();
    doors = null;
  }
  if (dressing) {
    dressing.dispose();
    dressing = null;
  }
  if (mechanics) {
    mechanics.dispose();
    mechanics = null;
  }
  if (themeScene) {
    themeScene.dispose?.();
    themeScene = null;
  }
}

function rebuildWorld(worldJson) {
  const key = worldJson.theme;
  const rowsKey = (worldJson.rows || []).join("\n"); // arena rounds have no rows
  const theme = getTheme(key);

  detachActiveWorld(); // stash the current world (themed -> keep resident)

  setCell(theme.cell || 1); // per-round board square size (1 = original); resets each round
  setOffset(...(theme.offset || [0, 0])); // per-round arena slide (resets each round)
  applyTheme(theme);
  rig.setView?.(theme.camera); // cinematic per-theme framing if the rig supports it
  const rows = worldJson.rows;

  // only the fixed GRID rounds are cached resident; the continuous arena (round 4,
  // no stable rows) always builds fresh so it's never served a stale scene.
  const cacheable = !!(theme.buildScene && worldJson.rows);
  const cached = cacheable ? sceneCache.get(key) : null;
  if (cached && cached.rowsKey === rowsKey) {
    // REUSE the warm resident scene: instant, no reload / re-parse / recompile.
    // (If it was prebuilt during the menu and its model is still streaming in, its
    // .ready keeps the transition's black up until it's done - never a pop-in.)
    themeScene = cached.themeScene;
    scene.add(themeScene.group);
    activeThemeKey = key;
    themeReady = themeScene.ready || Promise.resolve();
  } else if (theme.buildScene) {
    // first visit (or the level regenerated differently): drop any stale cache
    // entry, build fresh, and (if cacheable) keep it resident for next time.
    if (cached) {
      cached.themeScene.dispose?.();
      sceneCache.delete(key);
    }
    // a theme that ships its own world geometry (e.g. the city) takes over;
    // the medieval-only groups stay null, so the render loop simply skips them.
    themeScene = theme.buildScene(scene, worldJson, { THREE, renderer });
    if (cacheable) {
      sceneCache.set(key, { themeScene, rowsKey });
      activeThemeKey = key; // resident: detach + keep on the next round change
    } else {
      activeThemeKey = null; // arena: not cached -> disposed normally next change
    }
    // the transition holds its black screen until this resolves (themes that load
    // async models expose .ready; others are ready synchronously)
    themeReady = themeScene?.ready || Promise.resolve();
  } else {
    const world = buildFixedWorld(rows); // empty wall grid: floor + castle + nature
    current = buildWorld(world, textures);
    scene.add(current.group);
    archGroup = buildArchitecture(worldJson); // plastered walls + stone columns
    scene.add(archGroup);
    furniture = createFurniture(scene, worldJson); // beds, wardrobes, shelves, tables
    doors = createDoors(scene, worldJson); // arched bedroom doors
    dressing = createDressing(scene, worldJson); // carpet + rugs
    mechanics = createMechanics(scene, worldJson);
    activeThemeKey = null;
    themeReady = Promise.resolve();
  }
  arenaMode = worldJson.objective === "arena";
  actors.setHidden(false);
  actors.setArena(arenaMode); // arena round drives the chosen characters as the racers
  if (!arenaMode)
    actors.setWorld(parseLayout(rows), worldJson.objective === "cross");
}

// ---- prewarm: build EVERY round's arena UP FRONT (in the background, while the
// start menu is shown) into the resident sceneCache, so even the FIRST time a
// level appears the transition is instant. Each scene is built into an offscreen
// holder (never rendered), so it's invisible until gameplay re-attaches its group.
async function prewarmRound(worldJson) {
  const key = worldJson && worldJson.theme;
  if (!key || !worldJson.rows) return; // skip the continuous arena (no stable rows)
  const theme = getTheme(key);
  if (!theme || !theme.buildScene || sceneCache.has(key)) return;
  try {
    const holder = new THREE.Scene(); // offscreen: never passed to renderer.render()
    setCell(theme.cell || 1); // build the geometry with this theme's board scale...
    setOffset(...(theme.offset || [0, 0])); // ...and slide (baked in; reset per round anyway)
    const ts = theme.buildScene(holder, worldJson, { THREE, renderer });
    sceneCache.set(key, { themeScene: ts, rowsKey: (worldJson.rows || []).join("\n") });
    // wait for its model to finish parsing/processing, bounded so one bad asset
    // can't stall the rest of the prewarm
    await Promise.race([
      ts && ts.ready ? ts.ready : Promise.resolve(),
      new Promise((r) => setTimeout(r, 15000)),
    ]);
  } catch (e) {
    console.warn("prewarm failed for", key, e);
  }
}

async function prewarmAllRounds() {
  let allWorlds;
  try {
    const res = await fetch(`${API}/api/worlds`, { cache: "no-store" });
    allWorlds = (await res.json()).worlds;
  } catch (e) {
    return; // older server / offline: fall back to lazy build-on-first-visit
  }
  for (const w of allWorlds || []) await prewarmRound(w.world); // sequential = low peak load
}

// ------------------------------------------------------------------ live polling
const API = "";
async function control(body) {
  try {
    await fetch(`${API}/api/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    /* server not up yet */
  }
}

let heatAgent = null; // 'red' | 'blue' | null - which model's overlay to show
let heatMode = "value"; // 'value' (V(s)) | 'visits' (where it travels)
let pollCount = 0;
let polling = false;
let replayActive = false; // while replaying a recorded episode, ignore live frames
let holdUI = false; // true while an arena transition covers the screen: freeze all
//                     live UI (HUD, panels, board) so nothing updates before black

// push a snapshot into the live UI (HUD algo names, panels, board pieces). Kept in
// one place so a transition can defer it until the screen is fully black.
function applyStats(snap) {
  latestStats = snap.stats;
  latestFrame = snap.frame;
  if (!replayActive) actors.onFrame(snap.frame);
  window.dispatchEvent(new CustomEvent("rl-snapshot", { detail: snap }));
}

// the freshly rebuilt theme's own "fully loaded + processed" signal (if it exposes
// one via buildScene().ready); Promise.resolve() for themes that don't.
let themeReady = Promise.resolve();
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

// resolve only once the new arena is COMPLETELY ready under the black - model
// loaded + processed, every texture done (and STAYS done, catching multi-wave
// loaders), all shaders force-compiled, and a few frames settled - so the iris
// opens onto a finished scene with no pop-in and no compile hitch (that was the
// "lag" on reveal). Capped so a failed asset can never hang on black forever.
async function whenReady() {
  const t0 = performance.now();
  // 1) the theme's own ready signal (e.g. peach's castle model + backing shell)
  await Promise.race([themeReady, new Promise((r) => setTimeout(r, 8000))]);
  // 2) the loading manager is idle AND has stayed idle briefly (wave loaders)
  await new Promise((resolve) => {
    let lastBusy = performance.now();
    (function tick() {
      const mgr = THREE.DefaultLoadingManager;
      const idle = !mgr.itemsTotal || mgr.itemsLoaded >= mgr.itemsTotal;
      const built = themeScene != null || current != null;
      if (!idle) lastBusy = performance.now();
      const stable = idle && performance.now() - lastBusy > 250;
      if ((built && stable) || performance.now() - t0 > 8000) resolve();
      else requestAnimationFrame(tick);
    })();
  });
  // 3) force EVERY shader to compile now, while the screen is still black
  try {
    renderer.compile(scene, camera);
  } catch (e) {
    /* older three / edge case: fall back to the settle frames below */
  }
  // 4) render a few frames under black so the compile + first GPU upload settle
  for (let i = 0; i < 4; i++) await nextFrame();
}

async function poll() {
  if (polling || holdUI) return; // frozen while a transition covers the screen
  polling = true;
  try {
    const snap = await (
      await fetch(`${API}/api/snapshot`, { cache: "no-store" })
    ).json();
    if (snap.worldVersion !== worldVersion) {
      const w = await (
        await fetch(`${API}/api/world`, { cache: "no-store" })
      ).json();
      const firstBuild = worldVersion === -1;
      worldVersion = w.worldVersion;
      if (firstBuild) {
        rebuildWorld(w.world); // initial load: no curtain
      } else {
        // Hold ALL live UI (HUD algo names, panels, board pieces) on the CURRENT
        // stage until the iris is fully black; then swap the world + UI together
        // under black, wait until every asset is loaded + settled, and only then
        // open the iris. holdUI stays set until the whole transition finishes.
        holdUI = true;
        transition
          .play(w.world, snap.stats, async () => {
            rebuildWorld(w.world);
            applyStats(snap); // update HUD / panels now, while black covers them
            await whenReady(); // don't open until the new arena is fully ready
          })
          .catch((err) => console.warn("arena transition failed:", err))
          .finally(() => {
            holdUI = false;
          });
        return; // this poll's UI update is deferred into the transition
      }
    }
    if (holdUI) return; // a transition is covering the screen - freeze the UI
    applyStats(snap);
    // value (numbers) / visits (colours) overlay is heavier - refresh a few times a second
    if (heatAgent && pollCount % 5 === 0) {
      const m = heatMode === "value" ? "q" : "visits";
      const v = await (
        await fetch(`${API}/api/values?agent=${heatAgent}&mode=${m}`, {
          cache: "no-store",
        })
      ).json();
      if (v.grid) {
        if (heatMode === "value") heatmap.setNumbers(v.grid);
        else heatmap.setGrid(v.grid);
      }
    }
    pollCount++;
  } catch (e) {
    /* transient */
  } finally {
    polling = false;
  }
}
// ------------------------------------------------------------------ input
window.addEventListener("keydown", (e) => {
  // fixed curated world now - R resets the two models (relearn from scratch)
  if (e.code === "KeyR" && !/input|select|textarea/i.test(e.target.tagName))
    control({ cmd: "reset" });
});

// click a tile while a heatmap is shown -> inspect that tile's per-action Q
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
renderer.domElement.addEventListener("click", async (e) => {
  if (!heatAgent) return;
  ndc.x = (e.clientX / innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(groundPlane, hit)) return;
  const { r, c } = worldToCell(hit.x, hit.z);
  if (r < 0 || c < 0 || r >= GRID || c >= GRID) return;
  try {
    const q = await (
      await fetch(`${API}/api/values?agent=${heatAgent}&cell=${r},${c}`, {
        cache: "no-store",
      })
    ).json();
    window.dispatchEvent(new CustomEvent("rl-qinspect", { detail: q }));
  } catch (err) {
    /* ignore */
  }
});

// TEMP diagnostic: press I to toggle "identify" mode, then click a mesh to log
// its name + the hit point in the mesh's LOCAL coords (matches the model's raw
// vertex space used by the peach trimmers). Used to pin down leftover castle bits.
let identifyMode = false;
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyI" && !/input|select|textarea/i.test(e.target.tagName)) {
    identifyMode = !identifyMode;
    console.log(
      `IDENTIFY mode ${identifyMode ? "ON - click the thing you want gone" : "off"}`,
    );
  }
});
renderer.domElement.addEventListener("click", (e) => {
  if (!identifyMode) return;
  ndc.x = (e.clientX / innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  const hits = ray
    .intersectObjects(scene.children, true)
    .filter((h) => h.object.isMesh && h.object.visible);
  console.log("--- IDENTIFY: meshes under cursor (nearest first) ---");
  for (const h of hits.slice(0, 6)) {
    const lp = h.object.worldToLocal(h.point.clone());
    console.log(
      `${h.object.name || "(unnamed)"}  dist=${h.distance.toFixed(1)}  ` +
        `local=(${lp.x.toFixed(0)}, ${lp.y.toFixed(0)}, ${lp.z.toFixed(0)})  ` +
        `world=(${h.point.x.toFixed(1)}, ${h.point.y.toFixed(1)}, ${h.point.z.toFixed(1)})`,
    );
  }
});

// expose a tiny control API for the panel
window.RL = {
  control,
  getStats: () => latestStats,
  setHeatmap: (agent, mode) => {
    heatAgent = agent;
    heatMode = mode || "value";
    if (!agent) heatmap.hide();
    else if (heatMode === "value") heatmap.showNumbers();
    else heatmap.showColors();
    // broadcast so the two panels stay mutually exclusive (one overlay)
    window.dispatchEvent(
      new CustomEvent("rl-heatmap", { detail: { agent, mode: heatMode } }),
    );
  },
  playFrame: (frame) => {
    latestFrame = frame;
    actors.onFrame(frame);
  },
  setReplay: (on) => {
    replayActive = !!on;
  },
};
initPanel();
initCpuPanel();

// ------------------------------------------------------------------ post fx
const fx = createPostFX(renderer, scene, camera);

// show the start menu (cabin background) first; boot the live match on Start.
// Created after fx so the menu can tune bloom (books shouldn't glow).
menu = createStartMenu({
  scene,
  camera,
  renderer,
  actors,
  heatmap,
  fx,
  // boot the live match, then resolve once the world is built AND every asset has
  // finished loading - the menu keeps the screen black (iris) until this resolves,
  // so the player never sees the scene pop in.
  onStart: () =>
    new Promise((resolve) => {
      control({ cmd: "cpuTier", value: getCpuTier() }); // Red's strength = chosen CPU character's tier
      // swap the board pieces to the chosen menu characters (player = blue, CPU = red)
      let walkersReady = false;
      loadBoardWalkers()
        .then((w) => {
          actors.setWalkers(w);
          walkersReady = true;
        })
        .catch((e) => {
          console.warn("board characters failed to load:", e);
          walkersReady = true;
        });
      setInterval(poll, 33);
      poll();
      const t0 = performance.now();
      (function ready() {
        const mgr = THREE.DefaultLoadingManager;
        const idle = !mgr.itemsTotal || mgr.itemsLoaded >= mgr.itemsTotal;
        const built = themeScene != null || current != null;
        const elapsed = performance.now() - t0;
        // wait for round 1 + walkers (and any menu-time prewarm still in flight) to
        // finish, but CAP it so a fast Start never hangs on a black screen - any
        // unfinished prewarm just keeps warming in the background during round 1.
        if ((built && idle && walkersReady && elapsed > 600) || elapsed > 6000) {
          requestAnimationFrame(() => requestAnimationFrame(resolve)); // a couple frames to settle
        } else {
          requestAnimationFrame(ready);
        }
      })();
    }),
});

// Build EVERY round's arena in the background while the menu is up, so all
// transitions are instant. Delayed a touch so the menu's own cabin + characters
// get first crack at the bandwidth; runs sequentially to keep the peak modest.
setTimeout(() => prewarmAllRounds(), 1500);
function resize() {
  const pr = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  fx.setSize(innerWidth, innerHeight, pr);
}
resize();
window.addEventListener("resize", resize);

// ------------------------------------------------------------------ loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();
  if (menu && menu.active) {
    menu.update(dt, t);
    fx.composer.render();
    return;
  }
  rig.update(dt);

  if (current) {
    for (const to of current.animated.torches) {
      const f =
        0.82 +
        0.18 * Math.sin(t * 11 + to.phase) +
        0.1 * Math.sin(t * 23 + to.phase * 1.7);
      to.flame.scale.set(0.9 + 0.2 * f, f, 0.9 + 0.2 * f);
      if (to.light) to.light.intensity = 5 + f * 2.4;
    }
    for (const b of current.animated.banners) {
      b.pivot.rotation.x =
        Math.sin(t * 1.4 + b.phase) * 0.11 + Math.sin(t * 3.1 + b.phase) * 0.04;
      b.pivot.rotation.z = Math.sin(t * 1.1 + b.phase * 1.3) * 0.05;
    }
    for (const f of current.animated.fog) {
      f.mesh.position.x = f.baseX + Math.sin(t * f.spd + f.phase) * f.range;
      f.mesh.position.z =
        f.baseZ + Math.cos(t * f.spd * 0.8 + f.phase) * f.range;
      f.mesh.rotation.z += f.spin * dt;
      f.mesh.material.opacity =
        f.baseOp * (0.7 + 0.3 * Math.sin(t * 0.5 + f.phase));
    }
    for (const w of current.animated.water) {
      w.tex.offset.x = t * 0.02;
      w.tex.offset.y = t * 0.014;
      w.mat.emissiveIntensity = 0.2 + 0.06 * Math.sin(t * 1.3);
    }
    for (const d of current.animated.ducks) {
      d.heading += Math.sin(t * 0.6 + d.weave) * 0.9 * dt;
      const dx = d.x - d.cx,
        dz = d.z - d.cz;
      if (dx * dx + dz * dz > d.roam * d.roam) {
        const toCentre = Math.atan2(d.cz - d.z, d.cx - d.x);
        let diff = toCentre - d.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        d.heading += diff * Math.min(1, dt * 2.5);
      }
      d.x += Math.cos(d.heading) * d.speed * dt;
      d.z += Math.sin(d.heading) * d.speed * dt;
      d.group.position.set(
        d.x,
        d.baseY + Math.sin(t * 1.6 + d.bob) * 0.015,
        d.z,
      );
      d.group.rotation.y = -d.heading;
    }
  }

  if (mechanics && latestFrame) mechanics.update(latestFrame, t);
  if (doors && latestFrame) doors.update(latestFrame, t);
  if (dressing) dressing.update(t);
  if (themeScene) themeScene.update?.(t, dt, latestFrame);
  actors.update(dt, t);
  fx.composer.render();
});
