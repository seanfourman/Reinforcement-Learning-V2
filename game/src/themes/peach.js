// Round 1 - Peach's Castle: the full castle interior scene, with the RL grid
// blended invisibly into it. The agents walk the model's REAL foyer floor
// (MODEL_FLOOR_FRAC drops it to y=0); the only addition is a flush plane over
// the foyer floor region re-laying the hall's own checkered marble at exactly
// ONE CHECK = ONE GRID CELL, so the checker itself delineates the cells. The
// model's grand staircases, carpets and its own sun carpet sit above that
// plane untouched - there is no board object, frame or furniture. The only
// markers are a hair-thin gold inlay + light pool at the goal and two small
// flush marble medallions at the spawns.
//
// Vertical stack: agents' feet at y=0, floor plane top 0.012, flush decals
// 0.016-0.03, heatmap overlays at y=0.19 renderOrder 3.

import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { getCell, getOffset } from "../layout.js";
import { loadBoardWalker } from "../boardchars.js";
import { CHARACTERS } from "../startmenu.js";
import { updateWalker } from "../characters.js";

const MODEL = "./assets/models/peach-castle/interior.dae";
const TEXDIR = "./assets/models/peach-castle/";

// ---- castle model placement knobs (tuned from screenshots) ----------------
// Footprint the castle is scaled to (board is 20). At 84 the foyer's CLEAR
// floor between the throne stair (north) and the entrance staircase (south)
// is only ~14.5 units deep - the entrance stair's foot landed inside the
// board's south rows. 126 (x1.5) makes the clear span cover the whole board:
// throne-stair foot at the north border, entrance stair past the south edge.
const MODEL_TARGET = 126;
// The WALKABLE foyer floor is ~1.7% of the footprint above box.min (probed by
// raycasting the checker mesh: main floor at +1.425 with an 84 footprint; the
// octagonal sun-carpet recess mid-floor sits 0.4 lower, and box.min itself is
// the foundation). The old 0.108 aligned the UPSTAIRS landing instead, leaving
// the arena hanging ~8 units in the air above the real floor.
const MODEL_FLOOR_FRAC = 0.01696;
const MODEL_DX = 0;
const MODEL_DY = 0; // manual vertical nudge (the hall floor is auto-dropped to y=0)
const MODEL_DZ = 3.5; // slide south: entrance stair clears the board's south edge
const MODEL_ROT = Math.PI; // radians, flip the whole castle scene 180 degrees

const TEX_CHECKS = 6; // MarbleCheckFloor00 has 6 checker squares across each texture tile (measured)
const FLOOR_MULT = 1; // foyer floor checks are this many board-cells across (1 = same size as the board tiles)
export const peach = {
  name: "peach",
  title: "Peach's Castle",
  subtitle: "The Grand Foyer",
  cell: 1.21, // board cell size
  // offX = 0.5*cell (0.605) re-centres the ODD 15-board (its centre col lands on
  // the screen centre x=10); offZ slides it up/down - tune for perfect alignment.
  offset: [0.605, 3.1],
  sky: ["#bfa9dc", "#dcc8ea", "#f6ecf2"], // soft regal lavender-cream
  fog: 0xe9e0f3,
  fogNear: 55,
  fogFar: 240,
  hemi: [0xfff2e0, 0x9a8aa0, 1.0], // bright warm interior ambient
  sun: 0xffeccf,
  sunIntensity: 2.6,
  fill: 0xc9b8e0,
  fillIntensity: 0.32,
  exposure: 1.12,
  bloom: { strength: 0.16, radius: 0.5, threshold: 0.82 },
  camera: { startDist: 36, maxDist: 36, target: [10, 0, 10.7], panMargin: 4, flip: true },
  redName: "Crimson",
  blueName: "Cobalt",

  buildScene(scene, world, { renderer, camera } = {}) {
    const group = new THREE.Group();
    scene.add(group);
    let disposed = false;
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;

    // ---- world layout ------------------------------------------------------
    const rows =
      world.rows && world.rows.length
        ? world.rows
        : Array.from({ length: 20 }, (_, r) =>
            r === 0 || r === 19 ? "#".repeat(20) : "#" + ".".repeat(18) + "#",
          );
    const H = rows.length;
    const W = rows[0].length;
    const cell = getCell();
    const cx = W / 2; // board centre (10, 10)
    const cz = H / 2;
    // match layout.cellToWorld exactly (incl. the per-round arena slide) so the
    // board tiles/markers stay aligned to the agents + heatmap
    const [offX, offZ] = getOffset();
    const cw = (r, c) => ({
      x: cx + (c + 0.5 - cx) * cell + offX,
      z: cz + (r + 0.5 - cz) * cell + offZ,
    });
    const at = (ch) => {
      const out = [];
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) if (rows[r][c] === ch) out.push([r, c]);
      return out;
    };
    const goals = at("E");
    // Round-1 game layout (empty on skeleton rounds): per-agent coins/blocks + puddles
    const slipCells = world.slipCells || [];

    // ---- textures (the castle's own PBR set) --------------------------------
    const loader = new THREE.TextureLoader();
    const tex = (name, rx = 1, ry = 1, srgb = true) => {
      const t = loader.load(TEXDIR + name);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      t.anisotropy = maxAniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    // ---- the floor IS the grid ----------------------------------------------
    // One flush plane re-laying the FOYER FLOOR REGION (probed model bounds:
    // x -21.7..41.7, z 1.3..42.3) with the hall's own checker texture at one
    // check per grid cell, 20mm above the model's real floor. Integer world
    // bounds keep check edges exactly on cell boundaries, so the checker
    // itself delineates the cells - no frame, no grout, no board edge, and no
    // scale seam anywhere at floor level. The model's raised carpets and
    // stairs sit ABOVE this plane and stay visible; its sunken sun-carpet
    // recess mid-floor is bridged flat and hidden.
    const FX0 = -38;
    const FX1 = 58;
    const FZ0 = -2;
    const FZ1 = 62;
    // foyer checker: one check == one board cell (CHECKS_PER_TEX), and PHASE-
    // aligned to the board grid so the floor checks line up with the board tiles.
    // Alignment is derived from cell + offset, so it holds if those are tuned.
    const floorCheck = FLOOR_MULT * cell; // foyer check world size
    const frepX = (FX1 - FX0) / (TEX_CHECKS * floorCheck);
    const frepZ = (FZ1 - FZ0) / (TEX_CHECKS * floorCheck);
    // shift the texture so a floor-check line lands on a board cell boundary
    // (FLOOR_MULT is a whole number, so the bigger floor checks nest with the board)
    const alignOff = (boardEdge, planeMin) => {
      const g = (boardEdge - planeMin) / (TEX_CHECKS * floorCheck);
      return Math.round(g * TEX_CHECKS) / TEX_CHECKS - g;
    };
    // MarbleCheckFloor00's checker is phased with a square CENTRE at its UV
    // origin (measured), so snapping to the texture's check grid lands a check
    // CORNER on the board centre. Shift half a check so a floor SQUARE centres on
    // the board grid: gives a middle square AND nests the board tiles in the floor.
    const HALF = 0.5 / TEX_CHECKS;
    const fOffX = alignOff(cx + offX, FX0) + HALF;
    const fOffZ = -alignOff(cz + offZ, FZ0) + HALF; // V flips under the plane's -90deg X rotation
    const floorTex = (name, srgb) => {
      const t = tex(name, frepX, frepZ, srgb);
      t.offset.set(fOffX, fOffZ);
      return t;
    };
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex("MarbleCheckFloor00_alb.png", true),
      normalMap: floorTex("MarbleCheckFloor00_nrm.png", false),
      // no roughnessMap + full roughness = a matte floor with no specular
      // glare (the marble rgh map had polished spots that caught the sun)
      roughness: 1,
      metalness: 0,
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FX1 - FX0, FZ1 - FZ0),
      floorMat,
    );
    floor.rotation.x = -Math.PI / 2;
    // FLOOR_FWD slides ONLY the checker tile floor along z, independent of the
    // board/agents (the pattern travels with the plane). +z = toward the camera
    // (down-screen), -z = forward into the scene (toward the throne). "A bit
    // forward" = a small negative slide.
    const FLOOR_FWD = -1.7;
    floor.position.set((FX0 + FX1) / 2, 0.02, (FZ0 + FZ1) / 2 + FLOOR_FWD);
    floor.receiveShadow = true;
    group.add(floor);

    // ---- the PLAYABLE BOARD: genuine per-cell squares -----------------------
    // The RL agents move cell-to-cell, so the walkable interior is laid as REAL
    // individual square tiles (not just a texture on the whole floor): a low
    // raised platform of checkered marble squares with brass grout showing in
    // the gaps between them and a slim gold frame, so the arena reads as a
    // defined board that stands out a bit from the foyer floor around it while
    // still matching the castle's marble.
    {
      const walk = [];
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) if (rows[r][c] !== "#") walk.push([r, c]);
      let bx0 = Infinity,
        bx1 = -Infinity,
        bz0 = Infinity,
        bz1 = -Infinity;
      for (const [r, c] of walk) {
        const p = cw(r, c);
        bx0 = Math.min(bx0, p.x - cell / 2);
        bx1 = Math.max(bx1, p.x + cell / 2);
        bz0 = Math.min(bz0, p.z - cell / 2);
        bz1 = Math.max(bz1, p.z + cell / 2);
      }
      const bW = bx1 - bx0;
      const bD = bz1 - bz0;
      const bCx = (bx0 + bx1) / 2;
      const bCz = (bz0 + bz1) / 2;

      // brass grout base under the tiles (shows in the gaps as the grid lines)
      const groutBase = new THREE.Mesh(
        new THREE.BoxGeometry(bW + 0.1, 0.03, bD + 0.1),
        new THREE.MeshStandardMaterial({
          color: 0x9c7b34,
          roughness: 0.5,
          metalness: 0.45,
        }),
      );
      groutBase.position.set(bCx, 0.025, bCz); // top ~0.04
      groutBase.receiveShadow = true;
      group.add(groutBase);

      // one real square tile per walkable cell; a 0.1 gap leaves the grout
      // showing between them so the individual cells read as genuine squares
      const boardTileMat = new THREE.MeshStandardMaterial({
        map: tex("MarbleWhite00_alb.png", 0.5, 0.5),
        roughness: 0.85,
        metalness: 0,
      });
      const tiles = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.9 * cell, 0.02, 0.9 * cell),
        boardTileMat,
        walk.length,
      );
      tiles.receiveShadow = true;
      const bd = new THREE.Object3D();
      const bcol = new THREE.Color();
      const LIGHT = 0xf7efe0;
      const DARK = 0x847a6c;
      const GOALC = 0xf0cf82;
      walk.forEach(([r, c], i) => {
        const p = cw(r, c);
        bd.position.set(p.x, 0.035, p.z); // top ~0.045
        bd.updateMatrix();
        tiles.setMatrixAt(i, bd.matrix);
        const goalCell = rows[r][c] === "E";
        tiles.setColorAt(
          i,
          bcol.set(goalCell ? GOALC : (r + c) % 2 === 0 ? LIGHT : DARK),
        );
      });
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
      group.add(tiles);

      // slim gold frame standing a touch proud around the board perimeter
      const frameMat = new THREE.MeshStandardMaterial({
        color: 0xd9a94a,
        metalness: 0.7,
        roughness: 0.35,
      });
      const fw = 0.06; // thin gold border
      const fh = 0.055;
      const fy = 0.028; // top ~0.055, just above the tiles
      const bar = (w, d, x, z) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, fh, d), frameMat);
        b.position.set(x, fy, z);
        b.receiveShadow = true;
        group.add(b);
      };
      bar(bW + 2 * fw, fw, bCx, bz0 - fw / 2);
      bar(bW + 2 * fw, fw, bCx, bz1 + fw / 2);
      bar(fw, bD, bx0 - fw / 2, bCz);
      bar(fw, bD, bx1 + fw / 2, bCz);
    }

    // solid marble for a BACKING shell placed just behind the model's own walls
    // (built after the model loads, below). Where a front wall has a gap / a
    // missing or one-sided face, this backing shows through as marble instead
    // of the empty void. The front walls keep their own texture untouched.
    // DoubleSide so it shows regardless of the cloned faces' winding.
    const wallMarbleMat = new THREE.MeshStandardMaterial({
      map: tex("MarbleWhite00_alb.png", 8, 6),
      normalMap: tex("MarbleWhite00_nrm.png", 8, 6, false),
      roughnessMap: tex("MarbleWhite00_rgh.png", 8, 6, false),
      color: 0xffffff, // no warm tint - the marble shows at its natural white
      // the backing sits behind the walls in shadow, so self-light it (emissive
      // driven by the marble map) to keep it bright white through the gaps
      emissive: 0xffffff,
      emissiveMap: tex("MarbleWhite00_alb.png", 8, 6),
      emissiveIntensity: 0.4,
      roughness: 0.6,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    // GOLD variant, used to back the newer wall layers (the structural marble +
    // gold-panel meshes) so THEIR gaps read gold, while the sky-fresco wall
    // keeps the white marble backing above.
    const wallGoldMat = new THREE.MeshStandardMaterial({
      map: tex("MarbleWhite00_alb.png", 8, 6),
      normalMap: tex("MarbleWhite00_nrm.png", 8, 6, false),
      roughnessMap: tex("MarbleWhite00_rgh.png", 8, 6, false),
      color: 0xd9a94a,
      emissive: 0xd9a94a,
      emissiveMap: tex("MarbleWhite00_alb.png", 8, 6),
      emissiveIntensity: 0.4,
      roughness: 0.45,
      metalness: 0.25,
      side: THREE.DoubleSide,
    });
    // ---- the maze WALLS: white-marble blocks with a gold top rail ------------
    // '#' cells INSIDE the play area (Round 1's procedural maze) are drawn as
    // instanced white-marble boxes capped with a slim gold rail. The OUTER frame
    // (the walled margin around the board) stays unrendered - plain foyer floor.
    {
      // board interior bounds (from the walkable cells), so the outer frame is skipped
      let rMin = H, rMax = -1, cMin = W, cMax = -1;
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++)
          if (rows[r][c] !== "#") {
            if (r < rMin) rMin = r;
            if (r > rMax) rMax = r;
            if (c < cMin) cMin = c;
            if (c > cMax) cMax = c;
          }
      const wallCells = [];
      for (let r = rMin; r <= rMax; r++)
        for (let c = cMin; c <= cMax; c++)
          if (rows[r][c] === "#") wallCells.push([r, c]);

      if (wallCells.length) {
        const WALL_H = 0.7; // a bit shorter
        const CAP_H = 0.12;
        const TOP = 0.05; // sit on the board (tiles top ~0.045)
        const marbleMat = new THREE.MeshStandardMaterial({
          map: tex("MarbleWhite00_alb.png", 1, 1),
          normalMap: tex("MarbleWhite00_nrm.png", 1, 1, false),
          roughnessMap: tex("MarbleWhite00_rgh.png", 1, 1, false),
          roughness: 0.7,
          metalness: 0.0,
        });
        // golden MARBLE for the cap: the marble texture (veining) tinted gold. Keep
        // metalness MODEST - with no env-map, high metalness reflects the dark scene
        // and reads brown; a lower metalness lets the gold base colour show.
        const goldMat = new THREE.MeshStandardMaterial({
          map: tex("MarbleWhite00_alb.png", 1, 1),
          normalMap: tex("MarbleWhite00_nrm.png", 1, 1, false),
          color: 0xd2a53a,
          metalness: 0.35,
          roughness: 0.35,
        });
        const bodies = new THREE.InstancedMesh(
          new THREE.BoxGeometry(cell, WALL_H, cell),
          marbleMat,
          wallCells.length,
        );
        const caps = new THREE.InstancedMesh(
          new THREE.BoxGeometry(cell, CAP_H, cell),
          goldMat,
          wallCells.length,
        );
        bodies.castShadow = true;
        bodies.receiveShadow = true;
        caps.castShadow = true;
        const o = new THREE.Object3D();
        wallCells.forEach(([r, c], i) => {
          const p = cw(r, c);
          o.position.set(p.x, TOP + WALL_H / 2, p.z);
          o.updateMatrix();
          bodies.setMatrixAt(i, o.matrix);
          o.position.set(p.x, TOP + WALL_H + CAP_H / 2, p.z);
          o.updateMatrix();
          caps.setMatrixAt(i, o.matrix);
        });
        group.add(bodies);
        group.add(caps);
      }
    }

    // ---- goal: a hair-thin gold inlay + a soft light pool -------------------
    // The goal is marked only by a flush gold inlay hugging the exact goal
    // cells and a warm pool of light at the throne approach.
    const animated = { inlay: null };
    if (goals.length) {
      let gx = 0;
      let gz = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const [r, c] of goals) {
        const p = cw(r, c);
        gx += p.x;
        gz += p.z;
        minX = Math.min(minX, p.x - cell / 2);
        maxX = Math.max(maxX, p.x + cell / 2);
        minZ = Math.min(minZ, p.z - cell / 2);
        maxZ = Math.max(maxZ, p.z + cell / 2);
      }
      gx /= goals.length;
      gz /= goals.length;

      // hair-thin flush gold inlay around the goal pair, faint breathing glow
      const oW = (maxX - minX) / 2 + 0.02;
      const oH = (maxZ - minZ) / 2 + 0.02;
      const band = 0.06;
      const outline = new THREE.Shape();
      outline.moveTo(-oW, -oH);
      outline.lineTo(oW, -oH);
      outline.lineTo(oW, oH);
      outline.lineTo(-oW, oH);
      outline.closePath();
      const holePath = new THREE.Path();
      holePath.moveTo(-oW + band, -oH + band);
      holePath.lineTo(oW - band, -oH + band);
      holePath.lineTo(oW - band, oH - band);
      holePath.lineTo(-oW + band, oH - band);
      holePath.closePath();
      outline.holes.push(holePath);
      const inlayMat = new THREE.MeshStandardMaterial({
        color: 0xd9a94a,
        metalness: 0.75,
        roughness: 0.35,
        emissive: 0xffb23a,
        emissiveIntensity: 0.25,
      });
      const inlay = new THREE.Mesh(
        new THREE.ExtrudeGeometry(outline, {
          depth: 0.012,
          bevelEnabled: false,
        }),
        inlayMat,
      );
      inlay.geometry.rotateX(-Math.PI / 2);
      inlay.position.set(gx, 0.05, gz); // above the raised board tiles
      group.add(inlay);
      animated.inlay = inlayMat;

      // (goal light pool removed - the thin gold inlay marks the goal, no glow)
    }

    // ---- Round-1 game objects: coins, Shine, "?" power-up blocks -------------
    // Each agent owns a MIRROR set of coins + one "?" block (Red tinted warm, Blue
    // cool); the Shine hovers over the Power Moon goal. The live frame's collected
    // bitmasks hide coins/blocks as each agent claims them (see update()).
    const objLoader = new ColladaLoader();
    const collect = { redCoins: [], blueCoins: [], redBlocks: [], blueBlocks: [], shine: null };
    const spin = []; // {obj, baseY, spin} - animated in update()

    const fitObject = (obj, size) => {
      // ColladaLoader already orients Z-up assets to Y-up; centre + scale to `size`
      const box = new THREE.Box3().setFromObject(obj);
      const dim = new THREE.Vector3();
      box.getSize(dim);
      const ctr = new THREE.Vector3();
      box.getCenter(ctr);
      obj.position.set(-ctr.x, -ctr.y, -ctr.z);
      const wrap = new THREE.Group();
      wrap.add(obj);
      wrap.scale.setScalar(size / (Math.max(dim.x, dim.y, dim.z) || 1));
      return wrap;
    };
    // this asset pack's DAEs use samplers three's ColladaLoader can't bind (it warns
    // "Undefined sampler" and ships blank textures), so we take only the GEOMETRY from
    // the DAE and give each object a fresh material with textures loaded by hand.
    const objTex = (path, srgb = true) => {
      const t = loader.load(path);
      t.anisotropy = maxAniso;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const setMat = (obj, mat) => {
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.material = mat;
        o.castShadow = true;
      });
    };
    // this asset pack flags static meshes as SkinnedMesh with a broken skeleton (same
    // as the castle export), which breaks Box3.setFromObject + the skinning shader ->
    // the object mis-scales and never renders. Convert each to a plain rest-pose Mesh.
    const deskin = (root) => {
      const skinned = [];
      root.traverse((o) => o.isSkinnedMesh && skinned.push(o));
      for (const sm of skinned) {
        const m = new THREE.Mesh(sm.geometry, sm.material);
        m.name = sm.name;
        m.position.copy(sm.position);
        m.quaternion.copy(sm.quaternion);
        m.scale.copy(sm.scale);
        if (sm.parent) {
          sm.parent.add(m);
          sm.parent.remove(sm);
        }
      }
      return root;
    };
    const place = (obj, r, c, y, doSpin) => {
      const p = cw(r, c);
      obj.position.set(p.x, y, p.z);
      obj.userData.baseY = y;
      group.add(obj);
      spin.push({ obj, baseY: y, spin: doSpin });
      return obj;
    };

    // per-team GLOW aura: a soft additive halo, coloured for the owning player, around a
    // coin / "?" block that otherwise keeps its OWN normal texture (gold coin, yellow box).
    const glowTex = (() => {
      const S = 128, cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const ctx = cv.getContext("2d");
      const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.4, "rgba(255,255,255,0.5)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      const tx = new THREE.CanvasTexture(cv);
      tx.colorSpace = THREE.SRGBColorSpace;
      return tx;
    })();
    const TEAM_GLOW = { red: 0xff4636, blue: 0x2f6bff };
    const glowDir = new THREE.Vector3();
    const syncGlow = (obj) => {
      const spr = obj.userData.glow;
      if (!spr) return;
      spr.position.copy(obj.position);
      if (obj.userData.glowBehind && camera) {
        // Push the billboard away from the camera, behind the entire coin model.
        // Its centre can no longer intersect the coin, so depth testing cleanly
        // removes the halo beneath the coin silhouette.
        glowDir.copy(obj.position).sub(camera.position).normalize();
        spr.position.addScaledVector(glowDir, 0.35 * cell);
      }
    };
    // a billboarded halo added to `group` (world space) and pinned to the object each
    // frame in update(); stored on obj.userData.glow so it hides when the item is taken.
    const addGlow = (obj, size, colorHex, behindObject = false) => {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: colorHex, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      spr.scale.setScalar(size * 2.4);
      obj.userData.glowBehind = behindObject;
      obj.userData.glow = spr;
      syncGlow(obj);
      group.add(spr);
    };

    // COINS: their OWN normal gold texture; the owning player's colour is the GLOW around it
    objLoader
      .loadAsync("./assets/objects/Coin/Coin.dae")
      .then((asset) => {
        if (disposed) return;
        deskin(asset.scene);
        const cdir = "./assets/objects/Coin/Textures/";
        // one shared, un-tinted gold coin material. This theme has NO HDRI env map,
        // so keep metalness LOW - a high-metal surface with nothing to reflect renders
        // black; low metal lets the gold albedo read directly under the scene lights.
        const coinMat = new THREE.MeshStandardMaterial({
          map: objTex(cdir + "coinbody00_alb.png"),
          normalMap: objTex(cdir + "coinbody00_nrm.png", false),
          metalness: 0.25, roughness: 0.4,
        });
        const mk = (cells, glowColor, arr) => {
          for (const [r, c] of cells || []) {
            const coin = fitObject(asset.scene.clone(true), 0.55 * cell);
            setMat(coin, coinMat);
            // hover ABOVE the 0.7-tall maze walls so the coin reads from the game camera
            arr.push(place(coin, r, c, 0.95, true));
            addGlow(coin, 0.44 * cell, glowColor, true); // 20% smaller, fully behind coin
          }
        };
        mk(world.redCoins, TEAM_GLOW.red, collect.redCoins);
        mk(world.blueCoins, TEAM_GLOW.blue, collect.blueCoins);
      })
      .catch((e) => console.warn("Coin model failed to load", e));

    // SHINE: the Power Moon over the goal, its own gold albedo + emissive glow
    objLoader
      .loadAsync("./assets/objects/Shine/Shine.dae")
      .then((asset) => {
        if (disposed || !goals.length) return;
        deskin(asset.scene);
        let gx = 0, gz = 0;
        for (const [r, c] of goals) {
          const p = cw(r, c);
          gx += p.x;
          gz += p.z;
        }
        gx /= goals.length;
        gz /= goals.length;
        const shine = fitObject(asset.scene, 0.92 * cell); // 20% smaller goal Moon
        setMat(shine, new THREE.MeshStandardMaterial({
          map: objTex("./assets/objects/Shine/Textures/ShineBody_alb.png"),
          normalMap: objTex("./assets/objects/Shine/Textures/ShineBody_nrm.png", false),
          emissive: 0xffd24a,
          emissiveMap: objTex("./assets/objects/Shine/Textures/ShineBody_emm.png", false),
          emissiveIntensity: 1.0, metalness: 0.5, roughness: 0.35,
        }));
        shine.position.set(gx, 1.15, gz);
        shine.userData.baseY = 1.15;
        group.add(shine);
        collect.shine = shine;
        spin.push({ obj: shine, baseY: 1.15, spin: true });
        const glow = new THREE.PointLight(0xffe08a, 1.2, 7, 2);
        glow.position.set(gx, 1.4, gz);
        group.add(glow);
      })
      .catch((e) => console.warn("Shine model failed to load", e));

    // "?" BLOCKS: their OWN normal yellow "?" texture; owning player's colour is the GLOW
    objLoader
      .loadAsync("./assets/objects/Question%20Block/BlockQuestion.dae")
      .then((asset) => {
        if (disposed) return;
        deskin(asset.scene);
        const dir = "./assets/objects/Question%20Block/";
        // one shared, un-tinted "?" block material (albedo + normal + roughness)
        const blkMat = new THREE.MeshStandardMaterial({
          map: objTex(dir + "BlockQuestionBody_alb.png"),
          normalMap: objTex(dir + "BlockQuestionBody_nrm.png", false),
          roughnessMap: objTex(dir + "BlockQuestionBody_rgh.png", false),
          metalness: 0.2, roughness: 1,
        });
        const mk = (cells, glowColor, arr) => {
          for (const [r, c] of cells || []) {
            const blk = fitObject(asset.scene.clone(true), 0.82 * cell);
            setMat(blk, blkMat);
            arr.push(place(blk, r, c, 0.55 * cell, false));
            addGlow(blk, 0.82 * cell, glowColor);
          }
        };
        mk(world.redBlocks, TEAM_GLOW.red, collect.redBlocks);
        mk(world.blueBlocks, TEAM_GLOW.blue, collect.blueBlocks);
      })
      .catch((e) => console.warn("Mystery Block model failed to load", e));

    // ---- slippery PUDDLES: the SAME New Donk City cartoon water ------------------
    // A generated seamless turquoise water texture on an EXTRUDED organic blob (a low
    // rounded bulge), ripple normals + texture scroll in update(). Ported from city.js.
    if (slipCells.length) {
      const waterCanvasEl = () => {
        const S = 256, cv = document.createElement("canvas");
        cv.width = cv.height = S;
        const ctx = cv.getContext("2d"), img = ctx.createImageData(S, S), d = img.data;
        const lo = [24, 78, 140], hi = [58, 128, 190];
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const u = x / S, v = y / S;
            let n = 0.5 + 0.3 * Math.sin(2 * Math.PI * (u + v))
                        + 0.2 * Math.sin(2 * Math.PI * (2 * u - v) + 1.3);
            n = Math.max(0, Math.min(1, 0.5 + (n - 0.5) * 0.7));
            const i = (y * S + x) * 4;
            d[i] = lo[0] + (hi[0] - lo[0]) * n;
            d[i + 1] = lo[1] + (hi[1] - lo[1]) * n;
            d[i + 2] = lo[2] + (hi[2] - lo[2]) * n;
            d[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        return cv;
      };
      const waterTex = new THREE.CanvasTexture(waterCanvasEl());
      waterTex.colorSpace = THREE.SRGBColorSpace;
      waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
      waterTex.repeat.set(1.6, 1.6);
      waterTex.anisotropy = maxAniso;
      const waterNrm = loader.load("./assets/textures/mushroom-kingdom/water00_nrm.png");
      waterNrm.wrapS = waterNrm.wrapT = THREE.RepeatWrapping;
      waterNrm.repeat.set(2.2, 2.2);
      waterNrm.anisotropy = maxAniso;
      const waterMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, map: waterTex, transparent: true, opacity: 0.92,
        roughness: 0.3, metalness: 0.1, emissive: 0x123a66, emissiveIntensity: 0.06,
        normalMap: waterNrm, normalScale: new THREE.Vector2(0.14, 0.14), depthWrite: false,
      });
      const hashF = (seed, salt) => {
        const x = Math.sin(seed * 374.761 + salt * 66.826) * 43758.5453;
        return x - Math.floor(x);
      };
      const puddleShape = (seed) => {
        const s = new THREE.Shape();
        const ph1 = hashF(seed, 1) * 6.283, ph2 = hashF(seed, 2) * 6.283;
        const radius = (0.34 + hashF(seed, 4) * 0.03) * cell;
        const rx = radius * (1.02 + (hashF(seed, 5) - 0.5) * 0.08);
        const ry = radius * (0.98 + (hashF(seed, 6) - 0.5) * 0.08);
        const n = 64;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const w = 1 + 0.06 * Math.sin(a * 3 + ph1) + 0.035 * Math.sin(a * 5 + ph2);
          const x = Math.cos(a) * rx * w, y = Math.sin(a) * ry * w;
          if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
        }
        return s;
      };
      for (const [r, c] of slipCells) {
        const seed = (r * 73856 + c * 19349) >>> 0;
        const geo = new THREE.ExtrudeGeometry(puddleShape(seed), {
          depth: 0.015 * cell, bevelEnabled: true,
          bevelThickness: 0.04 * cell, bevelSize: 0.045 * cell, bevelSegments: 4,
        });
        geo.rotateX(-Math.PI / 2);
        const p = cw(r, c);
        const puddle = new THREE.Mesh(geo, waterMat);
        puddle.position.set(p.x, 0.05, p.z); // a low rounded bulge on the board
        puddle.renderOrder = 3;
        puddle.receiveShadow = true;
        group.add(puddle);
      }
      animated.water = waterNrm;
      animated.waterTex = waterTex;
      animated.waterMat = waterMat;
    }

    // ---- the chase: Bowser hunts Peach around the grand staircase ----------
    // A decorative lap between the two SIDE staircases, whose feet sit right
    // at the frame edges (their newel towers are the white posts at the
    // screen's mid-left/right). The camera views from the north, so +x is
    // screen-LEFT. Visible arc: come off the east side stair into the frame's
    // left edge (under the gold-deco pillar cluster probed at x 32..36,
    // z 2..5), sprint right across the throne carpet at the bottom of the
    // screen (flat and clear, probed), then swing up the WEST side staircase,
    // climbing out through the right frame edge. Hidden return: across the
    // balcony behind the grand stair head and down the east side staircase -
    // beyond what the game camera can show (pan clamp), so the loop never pops.
    const CHASE_PATH = [
      [32.5, 0.1, 9.0], // enters at the screen's left edge, off the east stair
      [27.5, 0.1, 4.5], // clear of the pillar cluster at x>=32
      [22.0, 0.1, 0.5], // curls onto the red carpet
      [16.0, 0.1, -0.9],
      [8.0, 0.1, -1.0], // flat out across the bottom of the screen
      [2.0, 0.1, 0.2],
      [-3.0, 0.1, 3.2], // rounds toward the west staircase (screen right)
      [-8.5, 0.1, 7.3],
      [-15.2, 0.1, 11.8], // west side stair foot, at the right frame edge
      [-18.9, 2.8, 15.0], // climbs the middle of the stair at normal speed
      [-21.9, 5.0, 18.0],
      [-24.8, 7.0, 20.9],
      [-26.8, 8.5, 22.9], // ~the 10th step - the speed boost starts HERE
      [-29.0, 10.15, 25.1], // west stair top (never visible in-game)
      [-27.5, 10.3, 36.5], // hidden: behind the grand stair head, balcony level
      [10.0, 10.3, 40.0],
      [47.0, 10.3, 36.5],
      [49.0, 10.15, 25.1], // hidden: east side stair top
      [44.8, 7.0, 20.9], // descends its probed centerline
      [41.9, 5.0, 18.0],
      [38.9, 2.8, 15.0],
      [35.2, 0.1, 11.8], // east foot, a step from the entry
    ];
    const CHASE_SPEED = 6.0; // world units / s along the path
    const CHASE_CAST = [
      // armSwing damps the run cycle's arm pump so the raised arms only sway
      { key: "peach", scale: 1.45, lead: 0, pose: "panic", armSwing: 0.3 },
      { key: "bowser", scale: 1.8, lead: -4.2, pose: "reach" }, // arms out, grabbing
    ];
    const chaseCurve = new THREE.CatmullRomCurve3(
      CHASE_PATH.map((p) => new THREE.Vector3(...p)),
      true,
      "centripetal",
    );
    chaseCurve.arcLengthDivisions = 800;
    const chaseLen = chaseCurve.getLength();
    // speed boost from ~the 10th step of the west stair (waypoint 12 - they
    // climb the visible lower steps at NORMAL speed first) until the descent
    // of the east stair begins (waypoint 17). The boosted stretch - upper
    // steps, balcony crossover - is off-camera, and hurrying through it
    // brings the pair back around the loop much sooner. On a closed
    // CatmullRom, control point i sits at parameter i/N, so its arc offset
    // comes from the length table.
    const chaseLens = chaseCurve.getLengths(800);
    const arcAt = (i) => chaseLens[Math.round((i / CHASE_PATH.length) * 800)];
    const FAST_FROM = arcAt(12);
    const FAST_TO = arcAt(17);
    const CHASE_CLIMB_BOOST = 2.5;
    const runners = [];
    for (const c of CHASE_CAST) {
      const idx = CHARACTERS.findIndex((ch) => ch.file.startsWith(c.key));
      loadBoardWalker(idx, { armPose: c.pose })
        .then((w) => {
          if (disposed) return;
          w.baseY = 0.05; // feet just kissing the carpet pile
          w.cadence = 14; // full sprint
          if (c.armSwing != null) w.armSwing = c.armSwing;
          w.group.scale.setScalar(c.scale);
          w.group.traverse((o) => o.isMesh && (o.castShadow = true));
          const mover = new THREE.Group();
          mover.add(w.group);
          group.add(mover);
          runners.push({ w, mover, dist: c.lead });
        })
        .catch((e) => console.warn(`chase ${c.key} failed to load`, e));
    }
    const chasePos = new THREE.Vector3();
    const chaseTan = new THREE.Vector3();
    function updateChase(dt) {
      for (const r of runners) {
        const boost =
          r.dist >= FAST_FROM && r.dist < FAST_TO ? CHASE_CLIMB_BOOST : 1;
        r.dist =
          (((r.dist + dt * CHASE_SPEED * boost) % chaseLen) + chaseLen) %
          chaseLen;
        const u = r.dist / chaseLen;
        chaseCurve.getPointAt(u, chasePos);
        r.mover.position.copy(chasePos);
        chaseCurve.getTangentAt(u, chaseTan);
        r.w.group.rotation.y = Math.atan2(chaseTan.x, chaseTan.z);
        // scaled dt keeps the leg churn in step with the boosted ground speed
        updateWalker(r.w, dt * boost, true);
      }
    }

    // ---- the FULL Peach's Castle interior (loaded async, fit onto the board)
    // `ready` resolves only after the model is loaded AND fully processed (backing
    // shell built), so the arena transition can hold its black screen until then.
    let markReady;
    const ready = new Promise((res) => (markReady = res));
    const collada = new ColladaLoader();
    collada
      .loadAsync(MODEL)
      .then((asset) => {
        if (disposed) return;
        const model = asset.scene;
        // The castle export flags static meshes as SkinnedMesh with a broken /
        // empty skeleton, which crashes Box3.setFromObject + the skinning shader.
        // Convert each to a plain static Mesh (rest pose) first.
        const skinned = [];
        model.traverse((o) => o.isSkinnedMesh && skinned.push(o));
        for (const sm of skinned) {
          const m = new THREE.Mesh(sm.geometry, sm.material);
          m.name = sm.name;
          m.position.copy(sm.position);
          m.quaternion.copy(sm.quaternion);
          m.scale.copy(sm.scale);
          if (sm.parent) {
            sm.parent.add(m);
            sm.parent.remove(sm);
          }
        }
        const matSrc = (m) => {
          if (!m) return "";
          const t = m.map;
          return (
            (t && (t.image?.src || t.source?.data?.src || t.name)) ||
            m.name ||
            ""
          );
        };
        model.traverse((o) => {
          if (!o.isMesh) return;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          // hide: god-ray / light-shaft meshes (render as black streaks), and the
          // wooden entrance DOOR (the only Wood-textured mesh in the foyer).
          const meshName = o.name || "";
          const hide =
            /polySurface71[02]/i.test(meshName) ||
            ms.some((m) => /godray|lightground|wood00/i.test(matSrc(m)));
          if (hide) {
            o.visible = false;
            return;
          }
          o.castShadow = false; // backdrop: agents cast, the floor receives
          o.receiveShadow = true;
          o.frustumCulled = false;
          for (const m of ms) {
            if (m && m.map) {
              m.map.colorSpace = THREE.SRGBColorSpace;
              m.map.anisotropy = maxAniso;
            }
          }
        });
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const s = MODEL_TARGET / (Math.max(size.x, size.z) || 1);
        // centre the footprint at the origin, floor (box.min.y) at y=0 (pre-scale)
        model.position.set(-center.x, -box.min.y, -center.z);
        const wrap = new THREE.Group();
        wrap.add(model);
        wrap.scale.setScalar(s);
        wrap.position.set(
          W / 2 + MODEL_DX,
          MODEL_DY - MODEL_FLOOR_FRAC * MODEL_TARGET, // drop the hall floor to y=0
          H / 2 + MODEL_DZ,
        );
        wrap.rotation.y = MODEL_ROT;
        group.add(wrap);

        // ---- BACKING shell --------------------------------------------------
        // Clone each of the model's WALL-SHELL meshes, push the copy OUTWARD
        // (behind the wall) so any gap / missing / culled face shows the backing
        // through it instead of the void. The sky-fresco wall gets a WHITE marble
        // backing; the newer structural-marble + gold-panel layers get a GOLD
        // backing (per request). Front walls untouched. The push is a 3D radial
        // scale about the shell centre so the domed ceiling stays behind. Uniform
        // K preserves each layer's relative depth (gold stays behind the white).
        const WALL_ALL = /fresco|marblewhite|golddecowall/i;
        wrap.updateMatrixWorld(true);
        const wbox = new THREE.Box3();
        const wallMeshes = [];
        model.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          const oms = Array.isArray(o.material) ? o.material : [o.material];
          if (!oms.some((m) => WALL_ALL.test(m?.name || ""))) return;
          const isFresco = oms.some((m) => /fresco/i.test(m?.name || ""));
          wallMeshes.push({ o, mat: isFresco ? wallMarbleMat : wallGoldMat });
          wbox.expandByObject(o);
        });
        const wc = new THREE.Vector3();
        wbox.getCenter(wc);
        const makePush = (K) =>
          new THREE.Matrix4()
            .makeTranslation(wc.x, wc.y, wc.z)
            .multiply(new THREE.Matrix4().makeScale(K, K, K))
            .multiply(new THREE.Matrix4().makeTranslation(-wc.x, -wc.y, -wc.z));
        const pushWhite = makePush(1.03); // fresco backing: a bit behind
        // gold backing sits CLOSE behind the wall so it fills the gap fully
        // (pushing it further out just lets the gap's edge hide it)
        const pushGold = makePush(1.005);
        const backings = [];
        for (const { o, mat } of wallMeshes) {
          const geo = o.geometry.clone();
          geo.applyMatrix4(o.matrixWorld); // bake to world space
          geo.applyMatrix4(mat === wallGoldMat ? pushGold : pushWhite);
          const backing = new THREE.Mesh(geo, mat);
          backing.receiveShadow = true;
          backing.frustumCulled = false;
          backings.push(backing);
        }
        for (const b of backings) group.add(b);

        let nmesh = 0;
        model.traverse((o) => o.isMesh && nmesh++);
        console.log(
          `PEACH model loaded: ${nmesh} meshes, raw footprint ${Math.max(size.x, size.z).toFixed(0)}, scale ${s.toFixed(4)}, ${backings.length} marble backing wall(s)`,
        );
      })
      .catch((e) => console.warn("Peach's Castle model failed to load", e))
      .finally(() => markReady()); // ready even on failure, so the black never hangs

    return {
      group,
      ready,
      update(t, dt, frame) {
        // subtle animation: the goal inlay breathes
        if (animated.inlay)
          animated.inlay.emissiveIntensity = 0.25 + 0.15 * Math.sin(1.6 * t);
        // slippery puddles: pulse + scroll the water (same as the New Donk City round)
        if (animated.water) {
          animated.waterMat.opacity = 0.82 + 0.04 * Math.sin(t * 1.4);
          animated.water.offset.x = t * 0.015;
          animated.water.offset.y = t * 0.011;
          animated.waterTex.offset.x = t * 0.018;
          animated.waterTex.offset.y = t * 0.012;
        }
        // spin the coins + Shine, gently bob every collectible (glow rides along)
        for (const s of spin) {
          if (s.spin) s.obj.rotation.y = t * 1.7;
          s.obj.position.y = s.baseY + Math.sin(t * 2 + s.obj.position.x) * 0.08;
          syncGlow(s.obj);
        }
        // hide each coin/block the live frame reports collected/used (bit i per index)
        if (frame) {
          const hide = (arr, mask) => {
            const m = mask | 0;
            for (let i = 0; i < arr.length; i++) {
              const on = !((m >> i) & 1);
              arr[i].visible = on;
              if (arr[i].userData.glow) arr[i].userData.glow.visible = on;
            }
          };
          hide(collect.redCoins, frame.redCoins);
          hide(collect.blueCoins, frame.blueCoins);
          hide(collect.redBlocks, frame.redBlocks);
          hide(collect.blueBlocks, frame.blueBlocks);
        }
        // the Bowser-chases-Peach loop around the grand staircase
        updateChase(Math.min(dt || 0.016, 0.05));
      },
      dispose() {
        disposed = true;
        scene.remove(group);
        group.traverse((o) => {
          if (o.isMesh) {
            if (o.isInstancedMesh) o.dispose(); // frees instance GPU buffers
            o.geometry?.dispose?.();
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of ms) {
              if (!m) continue;
              for (const v of Object.values(m)) v?.isTexture && v.dispose?.();
              m.dispose?.();
            }
          } else if (o.isSprite) {
            o.material?.map?.dispose?.();   // the shared glow texture (idempotent)
            o.material?.dispose?.();
          }
        });
      },
    };
  },
};
