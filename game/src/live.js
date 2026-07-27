import * as THREE from 'three';
import { cellToWorld, getCell } from './layout.js';
import { updateWalker, swingBone, flapWing } from './characters.js';

// Live actor driver: the two walkers, driven by frames polled from the Python
// backend (/api/snapshot). Frames arrive one at a time, so we smooth the rendered
// position toward the latest frame's target each tick - slow sim speed reads as
// walking, fast speed as a blur (you watch the panel).

export function createLiveActors(scene, walkers) {
  const group = new THREE.Group();
  scene.add(group);

  let king = walkers.red;
  let princess = walkers.blue;
  king.group.scale.setScalar(1.2);
  princess.group.scale.setScalar(1.2);
  group.add(king.group, princess.group);

  // swap in different walker models at runtime (e.g. the chosen menu characters)
  function setWalkers(next) {
    for (const side of ['red', 'blue']) {
      const w = next[side];
      if (!w) continue;
      const old = side === 'red' ? king : princess;
      if (old && old.group) group.remove(old.group);
      w.group.scale.setScalar(agentScale);
      w.group.position.x = rendered[side].x;
      w.group.position.z = rendered[side].z;
      w.group.position.y = w.baseY || 0; // stand at height until the next update's y write
      w.group.rotation.y = heading[side];
      group.add(w.group);
      if (side === 'red') king = w; else princess = w;
      appliedStatus[side] = null; // re-apply any active power-up tint to the new mesh
    }
  }

  const escGlow = new THREE.PointLight(0xffcf8a, 1.2, 6, 2);
  group.add(escGlow);

  const heading = { red: Math.PI, blue: Math.PI };
  const spawnFacing = { red: Math.PI, blue: Math.PI }; // restored on episode reset
  const rendered = { red: { x: 10, z: 18 }, blue: { x: 10, z: 18 } };
  const target = { red: { x: 10, z: 18 }, blue: { x: 10, z: 18 } };
  // Round-2 one-shot FX: a warp DIVE (shrink into the entrance pipe, pop out the exit)
  // or a hazard DEATH (impaled/eaten on the tile it died on, then respawn). Driven by
  // the env's per-frame event cells; overrides the normal target-follow while playing.
  const fx = { red: null, blue: null };
  // Round-1 "?" power-up state per side: 'ghost' (phasing walls -> translucent) or
  // 'frozen' (stuck -> icy tint). Applied on change only (see applyWalkerStatus).
  const status = { red: 'normal', blue: 'normal' };
  const appliedStatus = { red: null, blue: null };
  const lastFxStep = { red: -1, blue: -1 };   // dedup the one-shot Round-2 FX per sim step
  const FROZEN_TINT = new THREE.Color(0x8fd0ff);
  let frame = null;
  let layout = null;
  let isCross = false;   // cross rounds (the hedge maze) have NO keys / gold
  let arena = false;     // continuous arena round: positions are world (x,z), no keys
  let agentScale = 1.2;  // walker scale (bigger in the open arena than in grid cells)
  let celebration = null;
  const poseAxis = new THREE.Vector3();

  const cw = (cell) => cellToWorld(cell.r, cell.c); // {r,c} -> {x,z}
  const cwArr = (arr) => cellToWorld(arr[0], arr[1]); // [row,col] -> {x,z}
  const arrPoint = (arr) => Array.isArray(arr) ? { x: arr[0], z: arr[1] } : null;

  function headingTo(from, to, fallback = Math.PI) {
    if (!from || !to) return fallback;
    const dx = to.x - from.x, dz = to.z - from.z;
    return Math.abs(dx) + Math.abs(dz) > 1e-4 ? Math.atan2(dx, dz) : fallback;
  }

  function placeWalker(side, pos) {
    const walker = side === 'red' ? king : princess;
    walker.group.position.x = pos.x;
    walker.group.position.z = pos.z;
    walker.group.rotation.y = heading[side];
  }

  const sideWalker = (side) => side === 'red' ? king : princess;

  // capture each material's original look once, so a power-up tint can be reverted
  function captureOrig(walker) {
    walker.group.traverse((o) => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (!m || (m.userData && m.userData._origCaptured)) continue;
        m.userData = m.userData || {};
        m.userData._origCaptured = true;
        m.userData._origOpacity = m.opacity;
        m.userData._origTransparent = m.transparent;
        m.userData._origColor = m.color ? m.color.getHex() : null;
        m.userData._origEmissive = m.emissive ? m.emissive.getHex() : null;
        m.userData._origEmissiveIntensity = ('emissiveIntensity' in m) ? m.emissiveIntensity : null;
      }
    });
  }

  // ghost = translucent (rainbow hue cycled per-frame while phasing); frozen = lightly
  // frosted inside an ice block; normal = restore. Applied on status CHANGE only.
  function applyWalkerStatus(walker, st) {
    if (!walker || !walker.group) return;
    captureOrig(walker);
    walker.group.traverse((o) => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (!m) continue;
        const u = m.userData || {};
        if (st === 'ghost') {
          m.transparent = true;
          m.opacity = 0.62;            // color + glow are set each frame in rainbowWalker
        } else if (st === 'frozen') {
          m.transparent = u._origTransparent;
          m.opacity = u._origOpacity == null ? 1 : u._origOpacity;
          if (m.color && u._origColor != null) m.color.setHex(u._origColor).lerp(FROZEN_TINT, 0.3);
          if (m.emissive && u._origEmissive != null) {
            m.emissive.setHex(u._origEmissive);
            if (u._origEmissiveIntensity != null) m.emissiveIntensity = u._origEmissiveIntensity;
          }
        } else {
          m.transparent = u._origTransparent;
          m.opacity = u._origOpacity == null ? 1 : u._origOpacity;
          if (m.color && u._origColor != null) m.color.setHex(u._origColor);
          if (m.emissive && u._origEmissive != null) {
            m.emissive.setHex(u._origEmissive);
            if (u._origEmissiveIntensity != null) m.emissiveIntensity = u._origEmissiveIntensity;
          }
        }
      }
    });
  }

  // cycle the whole walker through vivid, GLOWING rainbow hues (the ghost POWER-UP)
  function rainbowWalker(walker, t) {
    const hue = (t * 0.9) % 1;                 // fast, aggressive cycle
    walker.group.traverse((o) => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (!m) continue;
        if (m.color) m.color.setHSL(hue, 1.0, 0.55);
        if (m.emissive) {                       // self-lit so the rainbow really pops
          m.emissive.setHSL(hue, 1.0, 0.5);
          if ('emissiveIntensity' in m) m.emissiveIntensity = 0.9;
        }
      }
    });
  }

  // a cartoon ICE crystal that encases a FROZEN walker (built lazily, per side)
  const iceBlock = { red: null, blue: null };
  function ensureIce(key) {
    if (iceBlock[key]) return iceBlock[key];
    const geo = new THREE.IcosahedronGeometry(0.6, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xbfeaff, transparent: true, opacity: 0.6,
      roughness: 0.1, metalness: 0.05, flatShading: true,
      emissive: 0x3a86c8, emissiveIntensity: 0.3,
    });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    group.add(m);
    iceBlock[key] = m;
    return m;
  }
  function updateIce(key, walker, on, t) {
    const ice = on ? ensureIce(key) : iceBlock[key];
    if (!ice) return;
    ice.visible = on;
    if (!on) return;
    const p = walker.group.position;
    ice.position.set(p.x, agentScale * 0.6, p.z);
    ice.scale.set(agentScale * 0.8, agentScale * 1.0, agentScale * 0.8); // smaller, hugs body
    ice.rotation.y = t * 0.6;
  }

  function clearCelebration() {
    if (!celebration) return;
    const walker = sideWalker(celebration.side);
    walker?.group?.scale.setScalar(agentScale);
    celebration = null;
  }

  function setWorld(lay, cross = false) {
    clearCelebration();
    layout = lay;
    isCross = cross;
    // grow the walkers with the board's square size so they fill the bigger tiles
    agentScale = 1.2 * getCell();
    king.group.scale.setScalar(agentScale);
    princess.group.scale.setScalar(agentScale);
    const e = lay.escape[0] || { r: 0, c: 10 };
    const ew = cw(e);
    escGlow.position.set(ew.x + 0.5, 1.4, ew.z);
    // snap actors to spawns so they don't streak across a brand-new world
    const rs = lay.redSpawn ? cw(lay.redSpawn) : { x: 18.5, z: 18.5 }; // red high-X (screen right)
    const bs = lay.blueSpawn ? cw(lay.blueSpawn) : { x: 0.5, z: 18.5 }; // blue low-X (screen left)
    rendered.red = { ...rs }; target.red = { ...rs };
    rendered.blue = { ...bs }; target.blue = { ...bs };
    // face each spawn TOWARD the goal so nobody starts looking backward - peach's
    // goal sits on the far side, so its spawns face the opposite way from the rest
    if (lay.escape && lay.escape[0]) {
      const faceGoal = (sp) => {
        const dx = ew.x - sp.x, dz = ew.z - sp.z;
        return Math.abs(dx) + Math.abs(dz) > 1e-4 ? Math.atan2(dx, dz) : Math.PI;
      };
      heading.red = faceGoal(rs);
      heading.blue = faceGoal(bs);
      spawnFacing.red = heading.red;   // restored on every episode reset (see update)
      spawnFacing.blue = heading.blue;
      king.group.rotation.y = heading.red;
      princess.group.rotation.y = heading.blue;
    }
  }

  // continuous arena round: drive the two walkers from world (x,z) floats, no keys
  function setArena(on, world = null) {
    clearCelebration();
    arena = on;
    agentScale = on ? 1.8 : 1.2; // a bit larger in the open arena
    king.group.scale.setScalar(agentScale);
    princess.group.scale.setScalar(agentScale);
    escGlow.visible = !on;
    if (!on) return;

    const defaultSpawns = {
      red: { x: (world?.arena || 20) - 3, z: (world?.arena || 20) - 2.5 },
      blue: { x: 3, z: (world?.arena || 20) - 2.5 },
    };
    for (const side of ['red', 'blue']) {
      const sp = arrPoint(world?.spawns?.[side]) || defaultSpawns[side];
      const firstTour = Array.isArray(world?.tours?.[side]) ? world.tours[side][0] : null;
      const faceTarget = arrPoint(firstTour) || arrPoint(world?.goal);
      rendered[side] = { ...sp };
      target[side] = { ...sp };
      heading[side] = headingTo(sp, faceTarget, Math.PI);
      spawnFacing[side] = heading[side];
      placeWalker(side, sp);
    }
  }

  function onFrame(f) {
    frame = f;
    status.red = f.redStatus || 'normal';   // 'ghost' | 'frozen' | 'normal' (Round 1)
    status.blue = f.blueStatus || 'normal';
    if (arena) {
      target.red = { x: f.red[0], z: f.red[1] };
      target.blue = { x: f.blue[0], z: f.blue[1] };
      return;
    }
    target.red = cwArr(f.red);
    target.blue = cwArr(f.blue);
    // Round-2: kick off the dive / death animation for whatever a char did this tick.
    // Each event lives in ONE sim-step snapshot; guard on the step counter so the FX
    // starts exactly once even though we poll that snapshot many times.
    const step = f.steps || 0;
    for (const side of ['red', 'blue']) {
      if (step < lastFxStep[side]) lastFxStep[side] = -1;        // episode rewound
      if (fx[side] || step === lastFxStep[side]) continue;
      const warpTo = f[side + 'Warp'], from = f[side + 'WarpFrom'];
      const dead = f[side + 'Dead'], at = f[side + 'DeadAt'];
      if (warpTo && from) {
        // start = the tile it stood on; pipe = the entrance it leaps into; to = where it pops out
        fx[side] = { type: 'warp', t: 0, start: { ...rendered[side] }, pipe: cwArr(from), to: cwArr(warpTo) };
        lastFxStep[side] = step;
      } else if (dead === 'plant' && at) {          // ONLY the plant animates the char (eaten);
        fx[side] = { type: 'death', t: 0, kind: dead, at: cwArr(at) };  // a spike death is the
        lastFxStep[side] = step;                    // rising spikes alone - the char just vanishes
      }
    }
  }

  function snapFrame(f) {
    if (!f) return;
    clearCelebration();
    onFrame(f);
    for (const side of ['red', 'blue']) {
      rendered[side] = { ...target[side] };
      const walker = sideWalker(side);
      walker.group.position.y = 0;
      walker.group.scale.setScalar(agentScale);
      placeWalker(side, rendered[side]);
    }
  }

  function faceToward(walker, key, dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) {
      const t = Math.atan2(dx, dz);
      let d = t - heading[key];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      heading[key] += d * 0.35;
    }
    walker.group.rotation.y = heading[key];
  }

  function updateVictoryPose(walker, c) {
    const age = (performance.now() - c.start) / 1000;
    const hop = Math.pow(Math.max(0, Math.sin(age * Math.PI * 2.1)), 1.7) * 0.55;
    walker.moveAmt = 0;
    walker.group.position.copy(c.position);
    walker.group.position.y = c.baseY + hop;
    walker.group.rotation.y = c.faceYaw + Math.sin(age * 8.5) * 0.07;
    walker.group.scale.setScalar(agentScale * (1 + Math.sin(age * 18) * 0.025));

    if (walker.fly) {
      const flap = (Math.sin(age * 14) + 1) * 0.5;
      const flapTip = (Math.sin(age * 14 - 0.7) + 1) * 0.5;
      flapWing(walker.parts.wingL1, walker.rest.wingL1, -flap * 0.7);
      flapWing(walker.parts.wingR1, walker.rest.wingR1, flap * 0.7);
      flapWing(walker.parts.wingL2, walker.rest.wingL2, -flapTip * 0.42);
      flapWing(walker.parts.wingR2, walker.rest.wingR2, flapTip * 0.42);
      return;
    }

    if (walker.bones) {
      const hy = walker.group.rotation.y;
      poseAxis.set(Math.cos(hy), 0, -Math.sin(hy));
      // arms stay at rest (no raised-arm "thumbs up") - just the celebratory hop
      swingBone(walker.parts.shR, walker.rest.shR, poseAxis, 0);
      swingBone(walker.parts.shL, walker.rest.shL, poseAxis, 0);
      swingBone(walker.parts.hipL, walker.rest.hipL, poseAxis, 0.18);
      swingBone(walker.parts.hipR, walker.rest.hipR, poseAxis, -0.18);
      return;
    }

    walker.parts.shR.rotation.x = 0;
    walker.parts.shL.rotation.x = 0;
    walker.parts.hipL.rotation.x = 0.16;
    walker.parts.hipR.rotation.x = -0.16;
  }

  // Round-2 one-shot animation: dive into a pipe + pop out the exit, or die on a
  // hazard then respawn. Returns true when finished (releases the normal follow).
  function playFx(key, walker, dt) {
    const f = fx[key];
    f.t += dt;
    const g = walker.group;
    const baseY = walker.baseY || 0;
    if (f.type === 'warp') {
      const LEAP = 0.32, FALL = 0.48, END = 0.72;
      if (f.t < LEAP) {                              // LEAP off the tile, ARC through the air onto the pipe
        const u = f.t / LEAP;
        g.position.set(
          f.start.x + (f.pipe.x - f.start.x) * u,
          Math.sin(u * Math.PI) * 1.5,                          // up-and-over jump arc
          f.start.z + (f.pipe.z - f.start.z) * u,
        );
        g.scale.setScalar(agentScale);
      } else if (f.t < FALL) {                       // FALL INTO the pipe (sink down + shrink away)
        const u = (f.t - LEAP) / (FALL - LEAP);
        g.position.set(f.pipe.x, -0.85 * u, f.pipe.z);
        g.scale.setScalar(agentScale * (1 - 0.9 * u));
      } else if (f.t < END) {                        // EMERGE at the destination (rise up + grow)
        const u = (f.t - FALL) / (END - FALL);
        g.position.set(f.to.x, -0.85 * (1 - u), f.to.z);
        g.scale.setScalar(agentScale * (0.1 + 0.9 * u));
      } else {
        rendered[key] = { ...f.to };
        g.position.set(f.to.x, baseY, f.to.z);
        g.scale.setScalar(agentScale);
        fx[key] = null;
        return true;
      }
      g.rotation.y = heading[key];
      return false;
    }
    // DEATH: on the tile it died on - a plant yanks it UP small, spikes squash it FLAT -
    // then it is gone and the respawn snaps in.
    const DUR = 0.55;
    if (f.t < DUR) {
      const u = f.t / DUR;
      if (f.kind === 'plant') {
        g.position.set(f.at.x, u * 0.9, f.at.z);     // lifted into the mouth
        g.scale.setScalar(agentScale * (1 - 0.85 * u));
      } else {
        g.position.set(f.at.x, 0, f.at.z);
        g.scale.set(agentScale * (1 + 0.3 * u), agentScale * (1 - 0.9 * u), agentScale * (1 + 0.3 * u));
      }
      g.rotation.y += dt * 12;
      return false;
    }
    rendered[key] = { ...target[key] };              // respawn position
    g.position.set(target[key].x, baseY, target[key].z);
    g.scale.setScalar(agentScale);
    g.rotation.y = heading[key];
    fx[key] = null;
    return true;
  }

  function update(dt, t) {
    if (celebration && performance.now() - celebration.start > celebration.duration) {
      clearCelebration();
    }

    const k = 1 - Math.exp(-dt * 12); // smoothing toward the latest target
    for (const [key, walker] of [['red', king], ['blue', princess]]) {
      if (appliedStatus[key] !== status[key]) {
        applyWalkerStatus(walker, status[key]);   // ghost/frozen power-up tint on change
        appliedStatus[key] = status[key];
      }
      if (fx[key]) { if (!playFx(key, walker, dt)) continue; }   // Round-2 dive / death FX
      if (celebration && celebration.side === key) {
        updateVictoryPose(walker, celebration);
        continue;
      }
      const st = status[key];
      const r = rendered[key], tg = target[key];
      const dx = tg.x - r.x, dz = tg.z - r.z;
      const moving = Math.abs(dx) + Math.abs(dz) > 0.02;
      // ghost now moves ONE cell per step (even onto a wall cell), so a ghost move is
      // ~1 cell and interpolates like any move -> it walks square by square through the
      // wall. Only a big jump (episode reset goal->spawn) snaps.
      const teleport = Math.hypot(dx, dz) > 1.5;
      if (teleport) {
        r.x = tg.x; r.z = tg.z; // snap instead of sliding through walls
      } else {
        r.x += dx * k;
        r.z += dz * k;
      }
      walker.group.position.x = r.x;
      walker.group.position.z = r.z;
      if (teleport) {
        // do NOT spin to face the jump vector: a reset teleports from the goal
        // back to spawn, and turning to face that (backward, toward the camera) is
        // exactly the "spawns facing the wrong way" bug. Re-face toward the next
        // spawn objective on cross/arena rounds; otherwise just hold the heading.
        if (isCross || arena) heading[key] = spawnFacing[key];
        walker.group.rotation.y = heading[key];
      } else {
        faceToward(walker, key, dx, dz);
      }
      // ---- "?" power-up visuals (normal: updateWalker OWNS y - never clobber it) --
      const baseY = walker.baseY || 0;
      if (st === 'frozen') {
        walker.moveAmt = 0;                          // locked solid: no leg motion
        walker.group.position.y = baseY;             // stand at normal height in the ice
      } else {
        updateWalker(walker, dt, moving);            // sets y = baseY + walk-bob/breathe
        if (st === 'ghost') {
          rainbowWalker(walker, t);                  // rainbow power-up hues
          walker.group.position.y = baseY + 0.28 + Math.sin(t * 4) * 0.07; // spectral hover
        }
      }
      updateIce(key, walker, st === 'frozen', t);
    }

    if (!frame) return;
    if (arena) return; // arena round: no escape-gate glow
    if (frame.winner) {
      escGlow.intensity = 2 + Math.sin(t * 6) * 1.0;
    } else {
      escGlow.intensity = 1.2;
    }
  }

  // arena (continuous) rounds render their own agents in the theme, so hide the
  // grid actors / keys / escape glow entirely.
  function setHidden(h) { group.visible = !h; }

  function resetFacing() {
    clearCelebration();
    for (const [key, walker] of [['red', king], ['blue', princess]]) {
      heading[key] = spawnFacing[key];
      walker.group.rotation.y = heading[key];
      walker.group.scale.setScalar(agentScale);
    }
  }

  function getSidePosition(side, out = new THREE.Vector3()) {
    sideWalker(side).group.getWorldPosition(out);
    return out;
  }

  function getSideFocus(side, out = new THREE.Vector3()) {
    const walker = sideWalker(side);
    walker.group.getWorldPosition(out);
    out.y += agentScale * (walker.fly ? 0.85 : 1.15);
    return out;
  }

  function celebrate(side, opts = {}) {
    const walker = sideWalker(side);
    if (!walker) return;
    celebration = {
      side,
      start: performance.now(),
      duration: opts.duration ?? 5200,
      position: walker.group.position.clone(),
      baseY: walker.group.position.y,
      faceYaw: opts.faceYaw ?? walker.group.rotation.y,
    };
    heading[side] = celebration.faceYaw;
    walker.group.rotation.y = celebration.faceYaw;
    walker.moveAmt = 0;
  }

  return {
    setWorld, onFrame, snapFrame, update, group, setWalkers, setHidden, setArena, resetFacing,
    getSidePosition, getSideFocus, celebrate,
  };
}
