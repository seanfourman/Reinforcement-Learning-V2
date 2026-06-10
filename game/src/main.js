import * as THREE from 'three';
import { GRID, PALETTE, CAMERA } from './config.js';
import { createTextures } from './textures.js';
import { generateWorld } from './generate.js';
import { buildWorld } from './build.js';
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

// a faint cool fill from the opposite side so shadows stay lavender, not black
const fill = new THREE.DirectionalLight(0xb9a8e8, 0.35);
fill.position.set(GRID / 2 + 10, 12, GRID / 2 + 9);
scene.add(fill);

// ------------------------------------------------------------------ world
const textures = createTextures();
let current = null;

function regenerate(seed) {
  if (current) {
    scene.remove(current.group);
    current.dispose();
  }
  const world = generateWorld(seed);
  current = buildWorld(world, textures);
  scene.add(current.group);
  console.log(`world seed: ${world.seed}`);
}
regenerate();

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') regenerate();
});

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
    for (const { mat, phase } of current.animated.crystalMats) {
      mat.emissiveIntensity = 0.65 + Math.sin(t * 1.6 + phase) * 0.22;
    }
    for (const { mat, phase } of current.animated.energyMats) {
      mat.opacity = 0.4 + Math.sin(t * 2.4 + phase) * 0.09;
      mat.emissiveIntensity = 1.4 + Math.sin(t * 2.4 + phase) * 0.35;
    }
    for (const { light, phase } of current.animated.lanternLights) {
      light.intensity = 7 + Math.sin(t * 6.5 + phase) * 0.7 + Math.sin(t * 11.3 + phase * 2) * 0.4;
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
      // gentle weave, steering back toward the pond centre near the edge
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
    for (const fl of current.animated.floaters) {
      fl.mesh.rotation.y += fl.spin * dt;
      fl.mesh.position.y = fl.baseY + Math.sin(t * 1.2 + fl.bob) * 0.12;
      fl.mat.emissiveIntensity = 0.85 + 0.25 * Math.sin(t * 1.8 + fl.bob);
      if (fl.light) fl.light.intensity = 5 + 1.5 * Math.sin(t * 1.8 + fl.bob);
    }
    for (const b of current.animated.birds) {
      b.ang += b.spd * dt;
      b.group.position.set(
        b.cx + Math.cos(b.ang) * b.radius,
        b.height + Math.sin(t * 0.6 + b.flap) * 0.6,
        b.cz + Math.sin(b.ang) * b.radius
      );
      b.group.rotation.y = -b.ang - Math.PI / 2 + (b.spd > 0 ? 0 : Math.PI);
      const f = Math.sin(t * 8 + b.flap) * 0.6;
      b.rw.rotation.z = f;
      b.lw.rotation.z = -f;
    }
  }

  fx.composer.render();
});
