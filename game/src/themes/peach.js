// Round 1 - Peach's Castle: the full castle interior scene plus a low-profile
// royal training board that lines up with the 20x20 RL grid.

import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { getCell } from "../layout.js";

const MODEL = "./assets/models/peach-castle/interior.dae";

// ---- placement knobs (tune from a screenshot) ----------------------------
const MODEL_TARGET = 84; // world footprint the castle is scaled to (board is 20) - big & grand (+2%)
const MODEL_FLOOR_FRAC = 0.108; // hall floor is ~10.8% of the footprint above box.min
const MODEL_DX = 0;
const MODEL_DY = 0; // manual vertical nudge (the hall floor is auto-dropped to y=0)
const MODEL_DZ = 0;
const MODEL_ROT = Math.PI; // radians, flip the whole castle scene 180 degrees
const BOARD_Y = 0.145;
const BOARD_FRAME = 0.28;

function makeBoardTexture(W, H, rows = []) {
  const px = 96;
  const canvas = document.createElement("canvas");
  canvas.width = W * px;
  canvas.height = H * px;
  const ctx = canvas.getContext("2d");

  const fillFor = (ch, even) => {
    if (ch === "#") return "#bda86e";
    if (ch === "E") return "#efbf44";
    if (ch === "R") return "#ee9d94";
    if (ch === "B") return "#9fc0ea";
    return even ? "#f0e4cf" : "#cfc4b3";
  };

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const x = c * px;
      const y = r * px;
      const ch = rows[r]?.[c] || ".";
      ctx.fillStyle = fillFor(ch, (r + c) % 2 === 0);
      ctx.fillRect(x, y, px, px);

      const g = ctx.createLinearGradient(x, y, x + px, y + px);
      g.addColorStop(0, "rgba(255,255,255,0.2)");
      g.addColorStop(0.55, "rgba(74,58,38,0.04)");
      g.addColorStop(1, "rgba(255,255,255,0.08)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, px, px);

      for (let i = 0; i < 16; i++) {
        const sx = x + ((r * 61 + c * 37 + i * 29) % px);
        const sy = y + ((r * 43 + c * 71 + i * 17) % px);
        ctx.fillStyle = "rgba(62,53,43,0.035)";
        ctx.fillRect(sx, sy, 1, 1);
      }

      ctx.beginPath();
      ctx.moveTo(x - 8, y + ((r * 19 + c * 31) % px));
      ctx.bezierCurveTo(
        x + px * 0.32,
        y + px * 0.18,
        x + px * 0.68,
        y + px * 0.82,
        x + px + 8,
        y + ((r * 47 + c * 13) % px),
      );
      ctx.strokeStyle = "rgba(94,76,56,0.14)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function createCrownMarker(cell) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.42, -0.22);
  shape.lineTo(-0.42, 0.18);
  shape.lineTo(-0.24, 0.02);
  shape.lineTo(-0.08, 0.28);
  shape.lineTo(0.08, 0.02);
  shape.lineTo(0.24, 0.28);
  shape.lineTo(0.42, 0.02);
  shape.lineTo(0.42, -0.22);
  shape.closePath();

  const crown = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({
      color: 0xffd65a,
      roughness: 0.32,
      metalness: 0.55,
      emissive: 0x4a2300,
      emissiveIntensity: 0.18,
    }),
  );
  crown.rotation.x = -Math.PI / 2;
  crown.scale.setScalar(cell * 0.78);
  crown.renderOrder = 2;
  return crown;
}

function createSpawnPad(color, cell) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(cell * 0.23, cell * 0.36, 40),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  ring.renderOrder = 2;

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(cell * 0.21, 36),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.033;
  disc.renderOrder = 2;
  group.add(disc, ring);
  return group;
}

function createPeachBoard(W, H, rows = []) {
  const group = new THREE.Group();
  const cell = getCell();
  const cx = W / 2;
  const cz = H / 2;
  const boardW = W * cell;
  const boardH = H * cell;
  const boardCenterX = W / 2;
  const boardCenterZ = H / 2;

  const gold = new THREE.MeshStandardMaterial({
    color: 0xb98e3a,
    roughness: 0.58,
    metalness: 0.34,
  });
  const redVelvet = new THREE.MeshStandardMaterial({
    color: 0x741a22,
    roughness: 0.86,
    metalness: 0.02,
  });
  const shadow = new THREE.MeshBasicMaterial({
    color: 0x160a0c,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });

  const dropShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(boardW + BOARD_FRAME * 2.8, boardH + BOARD_FRAME * 2.8),
    shadow,
  );
  dropShadow.rotation.x = -Math.PI / 2;
  dropShadow.position.set(boardCenterX, BOARD_Y - 0.018, boardCenterZ + 0.08);
  dropShadow.renderOrder = 0;
  group.add(dropShadow);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(boardW + BOARD_FRAME * 2, 0.11, boardH + BOARD_FRAME * 2),
    redVelvet,
  );
  base.position.set(boardCenterX, BOARD_Y - 0.065, boardCenterZ);
  base.receiveShadow = true;
  group.add(base);

  const frameBars = [
    [boardW + BOARD_FRAME * 2, BOARD_FRAME, 0, -boardH / 2 - BOARD_FRAME / 2],
    [boardW + BOARD_FRAME * 2, BOARD_FRAME, 0, boardH / 2 + BOARD_FRAME / 2],
    [BOARD_FRAME, boardH, -boardW / 2 - BOARD_FRAME / 2, 0],
    [BOARD_FRAME, boardH, boardW / 2 + BOARD_FRAME / 2, 0],
  ];
  for (const [w, h, dx, dz] of frameBars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, h), gold);
    bar.position.set(boardCenterX + dx, BOARD_Y - 0.012, boardCenterZ + dz);
    bar.receiveShadow = true;
    group.add(bar);
  }

  const boardTex = makeBoardTexture(W, H, rows);
  const boardCanvas = document.createElement("canvas");
  boardCanvas.width = boardTex.image.width;
  boardCanvas.height = boardTex.image.height;
  const ctx = boardCanvas.getContext("2d");
  ctx.drawImage(boardTex.image, 0, 0);
  const px = boardCanvas.width / W;
  ctx.strokeStyle = "rgba(150,96,24,0.72)";
  ctx.lineCap = "square";
  for (let c = 0; c <= W; c++) {
    ctx.lineWidth = c === 0 || c === W || c % 5 === 0 ? 4.2 : 2.1;
    ctx.beginPath();
    ctx.moveTo(c * px, 0);
    ctx.lineTo(c * px, boardCanvas.height);
    ctx.stroke();
  }
  for (let r = 0; r <= H; r++) {
    ctx.lineWidth = r === 0 || r === H || r % 5 === 0 ? 4.2 : 2.1;
    ctx.beginPath();
    ctx.moveTo(0, r * px);
    ctx.lineTo(boardCanvas.width, r * px);
    ctx.stroke();
  }
  boardTex.dispose();

  const boardSurfaceTex = new THREE.CanvasTexture(boardCanvas);
  boardSurfaceTex.colorSpace = THREE.SRGBColorSpace;
  boardSurfaceTex.anisotropy = 4;
  const boardSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(boardW, boardH),
    new THREE.MeshBasicMaterial({
      map: boardSurfaceTex,
      side: THREE.DoubleSide,
    }),
  );
  boardSurface.rotation.x = -Math.PI / 2;
  boardSurface.position.set(boardCenterX, BOARD_Y + 0.008, boardCenterZ);
  boardSurface.receiveShadow = true;
  boardSurface.renderOrder = 1;
  group.add(boardSurface);

  const placeCell = (r, c, obj) => {
    obj.position.set(
      cx + (c + 0.5 - cx) * cell,
      BOARD_Y + 0.02,
      cz + (r + 0.5 - cz) * cell,
    );
    group.add(obj);
  };
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ch = rows[r]?.[c];
      if (ch === "E") placeCell(r, c, createCrownMarker(cell));
      if (ch === "R") placeCell(r, c, createSpawnPad(0xff5d58, cell));
      if (ch === "B") placeCell(r, c, createSpawnPad(0x4f91ff, cell));
    }
  }

  return group;
}

export const peach = {
  name: "peach",
  title: "Peach's Castle",
  cell: 1,
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
  camera: { startDist: 36, maxDist: 36, target: [10, 0, 10.7], panMargin: 4 },
  redName: "Crimson",
  blueName: "Cobalt",

  buildScene(scene, world, { renderer } = {}) {
    const group = new THREE.Group();
    scene.add(group);
    let disposed = false;
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;

    const W = (world.rows && world.rows[0] && world.rows[0].length) || 20;
    const H = (world.rows && world.rows.length) || 20;
    group.add(createPeachBoard(W, H, world.rows || []));

    // ---- the FULL Peach's Castle interior (loaded async, fit onto the board)
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
        model.traverse((o) => {
          if (!o.isMesh) return;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          // hide: god-ray / light-shaft meshes (render as black streaks), and the
          // wooden entrance DOOR (the only Wood-textured mesh in the foyer).
          const meshName = o.name || "";
          const hide =
            /polySurface71[02]/i.test(meshName) ||
            ms.some((m) => {
              if (!m) return false;
              const t = m.map;
              const src =
                (t && (t.image?.src || t.source?.data?.src || t.name)) ||
                m.name ||
                "";
              return /godray|lightground|wood00/i.test(src);
            });
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
        let nmesh = 0;
        model.traverse((o) => o.isMesh && nmesh++);
        console.log(
          `PEACH model loaded: ${nmesh} meshes, raw footprint ${Math.max(size.x, size.z).toFixed(0)}, scale ${s.toFixed(4)}`,
        );
      })
      .catch((e) => console.warn("Peach's Castle model failed to load", e));

    return {
      group,
      update() {},
      dispose() {
        disposed = true;
        scene.remove(group);
        group.traverse((o) => {
          if (o.isMesh) {
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
