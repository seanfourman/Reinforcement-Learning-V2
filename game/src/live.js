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
  // The continuous simulation exposes velocity as well as position. Position
  // snapshots can jitter around the interpolation target, whereas velocity is
  // the stable direction the character is actually travelling.
  const velocity = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };
  // Round-2 one-shot FX: a warp DIVE (shrink into the entrance pipe, pop out the exit)
  // or a hazard DEATH (impaled/eaten on the tile it died on, then respawn). Driven by
  // the env's per-frame event cells; overrides the normal target-follow while playing.
  const fx = { red: null, blue: null };
  // Seconds after a warp emerge during which we GLIDE (never snap) toward the live sim
  // position, so the char slides fluidly out of the pipe instead of teleport-jumping.
  const warpSettle = { red: 0, blue: 0 };
  // Round-1 "?" power-up state per side: 'ghost' (phasing walls -> translucent) or
  // 'frozen' (stuck -> icy tint). Applied on change only (see applyWalkerStatus).
  const status = { red: 'normal', blue: 'normal' };
  const appliedStatus = { red: null, blue: null };
  const lastFxStep = { red: -1, blue: -1 };   // dedup the one-shot Round-2 FX per sim step
  const lastMissileHit = { red: 0, blue: 0 }; // dedup persistent Round-4 blast events
  const FROZEN_TINT = new THREE.Color(0x8fd0ff);
  let frame = null;
  let layout = null;
  let isCross = false;   // cross rounds (the hedge maze) have NO keys / gold
  let arena = false;     // continuous arena round: positions are world (x,z), no keys
  let arenaScale = 1;    // scene units per simulated metre
  let arenaOffset = { x: 0, z: 0 }; // sim -> established scene coordinates
  let agentScale = 1.2;  // walker scale (bigger in the open arena than in grid cells)
  const BLINK_HALF = 0.055; // post-hit flicker half-period (s): ~55ms shown / ~55ms hidden
  let celebration = null;
  const poseAxis = new THREE.Vector3();

  const cw = (cell) => cellToWorld(cell.r, cell.c); // {r,c} -> {x,z}
  const cwArr = (arr) => cellToWorld(arr[0], arr[1]); // [row,col] -> {x,z}
  const arrPoint = (arr) => Array.isArray(arr) ? { x: arr[0], z: arr[1] } : null;
  const arenaPoint = (arr) => {
    const p = arrPoint(arr);
    return p ? {
      x: p.x * arenaScale + arenaOffset.x,
      z: p.z * arenaScale + arenaOffset.z,
    } : null;
  };

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
    lastMissileHit.red = 0;
    lastMissileHit.blue = 0;

    const arenaSize = world?.arena || 20;
    arenaScale = Math.max(0.01, Number(world?.sceneScale) || 1);
    const sceneCenter = arrPoint(world?.sceneCenter) || {
      x: arenaSize / 2,
      z: arenaSize / 2,
    };
    arenaOffset = {
      x: sceneCenter.x - (arenaSize * arenaScale) / 2,
      z: sceneCenter.z - (arenaSize * arenaScale) / 2,
    };
    const defaultSpawns = {
      red: { x: arenaSize - 3, z: arenaSize - 2.5 },
      blue: { x: 3, z: arenaSize - 2.5 },
    };
    for (const side of ['red', 'blue']) {
      const simSpawn = arrPoint(world?.spawns?.[side]) || defaultSpawns[side];
      const sp = {
        x: simSpawn.x * arenaScale + arenaOffset.x,
        z: simSpawn.z * arenaScale + arenaOffset.z,
      };
      const firstTour = Array.isArray(world?.tours?.[side]) ? world.tours[side][0] : null;
      const faceTarget = arenaPoint(firstTour) || arenaPoint(world?.goal);
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
      target.red = {
        x: f.red[0] * arenaScale + arenaOffset.x,
        z: f.red[1] * arenaScale + arenaOffset.z,
      };
      target.blue = {
        x: f.blue[0] * arenaScale + arenaOffset.x,
        z: f.blue[1] * arenaScale + arenaOffset.z,
      };
      velocity.red = { x: f.redVel?.[0] || 0, z: f.redVel?.[1] || 0 };
      velocity.blue = { x: f.blueVel?.[0] || 0, z: f.blueVel?.[1] || 0 };
      // A terminal explosion survives the backend's automatic episode reset for
      // several snapshots. Play the hit once, holding the victim at the blast
      // before the newly reset spawn is allowed to take over.
      for (const blast of f.explosions || []) {
        // Only a FATAL blast (took the last heart) plays the death / victory pose.
        // A non-fatal hit just shows its explosion (drawn by the theme) while the
        // victim stays put and blinks - handled in update() via effects.hitFlash.
        if (!blast.fatal) continue;
        const victims =
          blast.hit === 'both'
            ? ['red', 'blue']
            : blast.hit === 'red' || blast.hit === 'blue'
              ? [blast.hit]
              : [];
        for (const side of victims) {
          if (blast.id <= lastMissileHit[side]) continue;
          lastMissileHit[side] = blast.id;
          fx[side] = {
            type: 'missile',
            t: 0,
            // Replay seek may jump directly to the terminal frame: start at that
            // frame's exact actor position. A live carryover event arrives after
            // auto-reset, so there we intentionally retain the rendered death spot.
            start: { ...(blast.carryover ? rendered[side] : target[side]) },
            at: arenaPoint(blast.pos),
          };
        }
        if (victims.length === 1) {
          const winner = victims[0] === 'red' ? 'blue' : 'red';
          if (blast.id > lastMissileHit[winner]) {
            lastMissileHit[winner] = blast.id;
            fx[winner] = {
              type: 'missileWin',
              t: 0,
              start: {
                ...(blast.carryover ? rendered[winner] : target[winner]),
              },
              yaw: heading[winner],
            };
          }
        }
      }
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

  function faceToward(walker, key, dx, dz, dt) {
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) {
      const t = Math.atan2(dx, dz);
      let d = t - heading[key];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (arena) {
        // A real, frame-rate-independent body turn: even a 180-degree reversal
        // takes visible time instead of completing in two or three frames.
        const maxStep = 4.5 * Math.min(dt, 1 / 20);
        heading[key] += THREE.MathUtils.clamp(d, -maxStep, maxStep);
      } else {
        heading[key] += d * 0.35;
      }
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
        warpSettle[key] = 0.5;      // GLIDE (never snap) toward the live sim position next,
        return true;                // so the char slides out of the pipe fluidly, no jump
      }
      g.rotation.y = heading[key];
      return false;
    }
    if (f.type === 'missile') {
      const DUR = 0.78;
      if (f.t < DUR) {
        const u = f.t / DUR;
        const ease = 1 - Math.pow(1 - u, 3);
        const awayX = f.start.x - f.at.x;
        const awayZ = f.start.z - f.at.z;
        const awayLen = Math.hypot(awayX, awayZ) || 1;
        g.position.set(
          f.start.x + (awayX / awayLen) * ease * 1.2,
          Math.sin(u * Math.PI) * 1.5 + ease * 0.25,
          f.start.z + (awayZ / awayLen) * ease * 1.2,
        );
        g.scale.setScalar(agentScale * Math.max(0.08, 1 - ease * 0.92));
        g.rotation.y += dt * (10 + u * 18);
        return false;
      }
      rendered[key] = { ...target[key] };
      g.position.set(target[key].x, baseY, target[key].z);
      g.scale.setScalar(agentScale);
      g.rotation.y = spawnFacing[key];
      heading[key] = spawnFacing[key];
      fx[key] = null;
      return true;
    }
    if (f.type === 'missileWin') {
      const DUR = 0.78;
      if (f.t < DUR) {
        const u = f.t / DUR;
        g.position.set(
          f.start.x,
          baseY + Math.pow(Math.sin(u * Math.PI * 2), 2) * 0.55,
          f.start.z,
        );
        g.scale.setScalar(agentScale * (1 + Math.sin(u * Math.PI) * 0.08));
        g.rotation.y = f.yaw + Math.sin(u * Math.PI * 4) * 0.18;
        walker.moveAmt = 0;
        return false;
      }
      rendered[key] = { ...target[key] };
      g.position.set(target[key].x, baseY, target[key].z);
      g.scale.setScalar(agentScale);
      g.rotation.y = spawnFacing[key];
      heading[key] = spawnFacing[key];
      fx[key] = null;
      return true;
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
      // Arena metres may be stretched into several scene units. Scale the reset
      // threshold with that mapping so ordinary fast movement never gets mistaken
      // for a teleport after the visual stretch.
      // just after a warp we GLIDE toward the emerge->live position (no snap) so the exit
      // reads fluid; otherwise a >1.5-tile jump is a reset teleport and snaps.
      warpSettle[key] = Math.max(0, warpSettle[key] - dt);
      const teleport = warpSettle[key] <= 0 && Math.hypot(dx, dz) > (arena ? 1.5 * arenaScale : 1.5);
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
        const face = arena && Math.hypot(velocity[key].x, velocity[key].z) > 0.08
          ? velocity[key]
          : { x: dx, z: dz };
        faceToward(walker, key, face.x, face.z, dt);
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
      // post-hit BLINK: flicker the character on/off while its mercy-invulnerability
      // lasts (classic invincibility flash). Only the missile arena sends hitFlash;
      // elsewhere it's 0 so the walker stays solidly visible.
      const hitFlash = arena ? frame?.effects?.[key]?.hitFlash || 0 : 0;
      walker.group.visible =
        hitFlash <= 0 || Math.floor(t / BLINK_HALF) % 2 === 0;
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

  function resetArenaEffects(frameToSuppress = null) {
    lastMissileHit.red = 0;
    lastMissileHit.blue = 0;
    for (const blast of frameToSuppress?.explosions || []) {
      if (!blast.hit) continue;
      // A single hit creates both a victim and winner animation, so baseline
      // both sides when restoring a live frame after leaving Replay.
      lastMissileHit.red = Math.max(lastMissileHit.red, blast.id || 0);
      lastMissileHit.blue = Math.max(lastMissileHit.blue, blast.id || 0);
    }
    for (const [key, walker] of [['red', king], ['blue', princess]]) {
      if (fx[key]?.type?.startsWith('missile')) fx[key] = null;
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
    resetArenaEffects, getSidePosition, getSideFocus, celebrate,
  };
}
