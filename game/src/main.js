import * as THREE from 'three';
import { GRID, PALETTE, CAMERA } from './config.js';
import { createTextures } from './textures.js';
import { buildWorld } from './build.js';
import { buildFixedWorld } from './fixedworld.js';
import { buildArchitecture } from './architecture.js';
import { createFurniture } from './furniture.js';
import { createDoors } from './doors.js';
import { createDressing } from './dressing.js';
import { parseLayout } from './layout.js';
import { makeKing, makePrincess } from './characters.js';
import { createLiveActors } from './live.js';
import { createMechanics } from './mechanics.js';
import { createHeatmap } from './heatmap.js';
import { initPanel } from './panel.js';
import { createCameraRig } from './camera.js';
import { createPostFX } from './postfx.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.fog, 34, 78);

// soft vertical sky gradient
{
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#8fa3cc');
  g.addColorStop(0.55, '#b9c2dd');
  g.addColorStop(1, '#d9cfd2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
}

const camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, 0.1, 200);
const rig = createCameraRig(camera, renderer.domElement);

// ------------------------------------------------------------------ lights
scene.add(new THREE.HemisphereLight(0xdfd8f7, 0x9a7a68, 1.15));
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
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xb9a8e8, 0.35);
fill.position.set(GRID / 2 + 10, 12, GRID / 2 + 9);
scene.add(fill);

// ------------------------------------------------------------------ world + actors
const textures = createTextures();
const walkers = { red: makeKing(), blue: makePrincess() };
const actors = createLiveActors(scene, walkers);
const heatmap = createHeatmap(scene);

let current = null;     // static scene shell (castle, walls, nature)
let archGroup = null;   // plastered architecture (walls + columns)
let furniture = null;   // beds, wardrobes, bookshelves, tables
let doors = null;       // arched bedroom doors
let dressing = null;    // carpet + rugs
let mechanics = null;   // mirrors, levers, traps
let worldVersion = -1;  // last world we built
let latestStats = null;
let latestFrame = null;

function disposeWorld() {
  if (current) { scene.remove(current.group); current.dispose?.(); current = null; }
  if (archGroup) { scene.remove(archGroup); archGroup.userData.dispose?.(); archGroup = null; }
  if (furniture) { furniture.dispose(); furniture = null; }
  if (doors) { doors.dispose(); doors = null; }
  if (dressing) { dressing.dispose(); dressing = null; }
  if (mechanics) { mechanics.dispose(); mechanics = null; }
}

function rebuildWorld(worldJson) {
  disposeWorld();
  const rows = worldJson.rows;
  const world = buildFixedWorld(rows);   // empty wall grid: floor + castle + nature
  current = buildWorld(world, textures);
  scene.add(current.group);
  archGroup = buildArchitecture(worldJson);  // plastered walls + stone columns
  scene.add(archGroup);
  furniture = createFurniture(scene, worldJson);  // beds, wardrobes, shelves, tables
  doors = createDoors(scene, worldJson);          // arched bedroom doors
  dressing = createDressing(scene, worldJson);    // carpet + rugs
  mechanics = createMechanics(scene, worldJson);
  actors.setWorld(parseLayout(rows));
}

// ------------------------------------------------------------------ live polling
const API = '';
async function control(body) {
  try {
    await fetch(`${API}/api/control`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) { /* server not up yet */ }
}

let heatAgent = null;      // 'red' | 'blue' | null — which value map to overlay
let pollCount = 0;
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const snap = await (await fetch(`${API}/api/snapshot`, { cache: 'no-store' })).json();
    if (snap.worldVersion !== worldVersion) {
      const w = await (await fetch(`${API}/api/world`, { cache: 'no-store' })).json();
      worldVersion = w.worldVersion;
      rebuildWorld(w.world);
    }
    latestStats = snap.stats;
    latestFrame = snap.frame;
    actors.onFrame(snap.frame);
    window.dispatchEvent(new CustomEvent('rl-snapshot', { detail: snap }));
    // value heatmap is heavier (whole grid) — refresh it a few times a second
    if (heatAgent && pollCount % 5 === 0) {
      const v = await (await fetch(`${API}/api/values?agent=${heatAgent}`, { cache: 'no-store' })).json();
      if (v.grid) heatmap.setGrid(v.grid);
    }
    pollCount++;
  } catch (e) { /* transient */ }
  finally { polling = false; }
}
setInterval(poll, 33); // ~30 Hz
poll();

// ------------------------------------------------------------------ input
window.addEventListener('keydown', (e) => {
  // fixed curated world now — R resets the two models (relearn from scratch)
  if (e.code === 'KeyR' && !/input|select|textarea/i.test(e.target.tagName)) control({ cmd: 'reset' });
});

// click a tile while a heatmap is shown -> inspect that tile's per-action Q
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
renderer.domElement.addEventListener('click', async (e) => {
  if (!heatAgent) return;
  ndc.x = (e.clientX / innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(groundPlane, hit)) return;
  const c = Math.floor(hit.x), r = Math.floor(hit.z);
  if (r < 0 || c < 0 || r >= GRID || c >= GRID) return;
  try {
    const q = await (await fetch(`${API}/api/values?agent=${heatAgent}&cell=${r},${c}`, { cache: 'no-store' })).json();
    window.dispatchEvent(new CustomEvent('rl-qinspect', { detail: q }));
  } catch (err) { /* ignore */ }
});

// expose a tiny control API for the panel
window.RL = {
  control,
  getStats: () => latestStats,
  setHeatmap: (agent) => { heatAgent = agent; if (agent) heatmap.show(); else heatmap.hide(); },
};
initPanel();

// ------------------------------------------------------------------ post fx
const fx = createPostFX(renderer, scene, camera);
function resize() {
  const pr = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  fx.setSize(innerWidth, innerHeight, pr);
}
resize();
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();
  rig.update(dt);

  if (current) {
    for (const to of current.animated.torches) {
      const f = 0.82 + 0.18 * Math.sin(t * 11 + to.phase) + 0.1 * Math.sin(t * 23 + to.phase * 1.7);
      to.flame.scale.set(0.9 + 0.2 * f, f, 0.9 + 0.2 * f);
      if (to.light) to.light.intensity = 5 + f * 2.4;
    }
    for (const b of current.animated.banners) {
      b.pivot.rotation.x = Math.sin(t * 1.4 + b.phase) * 0.11 + Math.sin(t * 3.1 + b.phase) * 0.04;
      b.pivot.rotation.z = Math.sin(t * 1.1 + b.phase * 1.3) * 0.05;
    }
    for (const f of current.animated.fog) {
      f.mesh.position.x = f.baseX + Math.sin(t * f.spd + f.phase) * f.range;
      f.mesh.position.z = f.baseZ + Math.cos(t * f.spd * 0.8 + f.phase) * f.range;
      f.mesh.rotation.z += f.spin * dt;
      f.mesh.material.opacity = f.baseOp * (0.7 + 0.3 * Math.sin(t * 0.5 + f.phase));
    }
    for (const w of current.animated.water) {
      w.tex.offset.x = t * 0.02;
      w.tex.offset.y = t * 0.014;
      w.mat.emissiveIntensity = 0.2 + 0.06 * Math.sin(t * 1.3);
    }
    for (const d of current.animated.ducks) {
      d.heading += Math.sin(t * 0.6 + d.weave) * 0.9 * dt;
      const dx = d.x - d.cx, dz = d.z - d.cz;
      if (dx * dx + dz * dz > d.roam * d.roam) {
        const toCentre = Math.atan2(d.cz - d.z, d.cx - d.x);
        let diff = toCentre - d.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        d.heading += diff * Math.min(1, dt * 2.5);
      }
      d.x += Math.cos(d.heading) * d.speed * dt;
      d.z += Math.sin(d.heading) * d.speed * dt;
      d.group.position.set(d.x, d.baseY + Math.sin(t * 1.6 + d.bob) * 0.015, d.z);
      d.group.rotation.y = -d.heading;
    }
  }

  if (mechanics && latestFrame) mechanics.update(latestFrame, t);
  if (doors && latestFrame) doors.update(latestFrame);
  if (dressing) dressing.update(t);
  actors.update(dt, t);
  fx.composer.render();
});
