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
const TEAM_RED = 0xb8332c;
const TEAM_BLUE = 0x2456c8;

function crownShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.42, -0.22);
  s.lineTo(-0.42, 0.18);
  s.lineTo(-0.24, 0.02);
  s.lineTo(-0.08, 0.28);
  s.lineTo(0.08, 0.02);
  s.lineTo(0.24, 0.28);
  s.lineTo(0.42, 0.02);
  s.lineTo(0.42, -0.22);
  s.closePath();
  return s;
}

function starShape() {
  // 4-point compass star - the Blue spawn emblem (shape-codes the teams so
  // the medallions stay tellable apart without color)
  const s = new THREE.Shape();
  s.moveTo(0, 0.5);
  s.lineTo(0.13, 0.13);
  s.lineTo(0.5, 0);
  s.lineTo(0.13, -0.13);
  s.lineTo(0, -0.5);
  s.lineTo(-0.13, -0.13);
  s.lineTo(-0.5, 0);
  s.lineTo(-0.13, 0.13);
  s.closePath();
  return s;
}

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

  buildScene(scene, world, { renderer } = {}) {
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
    const redSpawn = at("R")[0];
    const blueSpawn = at("B")[0];
    const onBorder = (r, c) => r === 0 || c === 0 || r === H - 1 || c === W - 1;

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
    // NOTE: wall ('#') cells are intentionally NOT rendered as anything - the
    // 16x16 play area is framed by a walled-off margin (see peach.py) that must
    // read as plain foyer floor, so no columns/geometry go on wall cells.
    void onBorder;

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

    // ---- spawns: small flush marble medallions (static, quiet) --------------
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xd9a94a,
      metalness: 0.85,
      roughness: 0.35,
    });
    const medallion = (spawn, color, emblemShape, emblemScale) => {
      if (!spawn) return;
      const { x, z } = cw(spawn[0], spawn[1]);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.3 * cell, 40),
        new THREE.MeshStandardMaterial({
          map: tex("MarbleWhite00_alb.png", 0.5, 0.5),
          color,
          roughness: 0.5,
          metalness: 0,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, 0.05, z); // above the raised board tiles
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.3 * cell, 0.36 * cell, 48),
        goldMat,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.052, z);
      const emblem = new THREE.Mesh(
        new THREE.ShapeGeometry(emblemShape),
        new THREE.MeshStandardMaterial({
          color: 0xf7f3ee,
          roughness: 0.45,
          metalness: 0,
        }),
      );
      emblem.rotation.x = -Math.PI / 2;
      emblem.scale.setScalar(emblemScale * cell);
      emblem.position.set(x, 0.054, z);
      group.add(disc, ring, emblem);
    };
    // spawn medallions removed (no start-position icons on the board)

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
      update(t) {
        // single subtle animation: the goal inlay breathes
        if (animated.inlay)
          animated.inlay.emissiveIntensity = 0.25 + 0.15 * Math.sin(1.6 * t);
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
          }
        });
      },
    };
  },
};
