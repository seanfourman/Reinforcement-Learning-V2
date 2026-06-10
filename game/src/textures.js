import * as THREE from 'three';
import { GRID } from './config.js';

// Every texture is generated procedurally as a placeholder, then we try to
// load `public/textures/<name>.png`. If the file exists it silently replaces
// the placeholder, so swapping art is just dropping PNGs in that folder.

function overridable(name, canvas, { wrap = false, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (wrap) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // overrides need a server (file:// images can't be uploaded to WebGL)
  if (location.protocol.startsWith('http')) {
    const img = new Image();
    img.onload = () => {
      tex.image = img;
      tex.needsUpdate = true;
    };
    img.src = `textures/${name}.png`;
  }
  return tex;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

const rand = (a, b) => a + Math.random() * (b - a);

function speckle(ctx, w, h, n, alpha, dark = true) {
  for (let i = 0; i < n; i++) {
    const a = rand(alpha * 0.4, alpha);
    ctx.fillStyle = dark && Math.random() < 0.6 ? `rgba(60,40,40,${a})` : `rgba(255,250,240,${a})`;
    ctx.fillRect(rand(0, w), rand(0, h), rand(1, 2.5), rand(1, 2.5));
  }
}

function blotches(ctx, w, h, n, colors, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    const x = rand(0, w), y = rand(0, h), r = rand(rMin, rMax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colors[(Math.random() * colors.length) | 0];
    g.addColorStop(0, c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// ---------------------------------------------------------------- floor tile
function floorCanvas() {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#f4eae2';
  ctx.fillRect(0, 0, 256, 256);
  blotches(ctx, 256, 256, 16, ['rgba(200,170,158,0.13)', 'rgba(240,212,222,0.13)', 'rgba(212,202,222,0.09)'], 30, 90);
  speckle(ctx, 256, 256, 600, 0.055);
  // hairline cracks
  ctx.strokeStyle = 'rgba(120,90,85,0.4)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    let x = rand(20, 236), y = rand(20, 236);
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += rand(-40, 40);
      y += rand(-40, 40);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // bevel: light top-left, dark bottom-right
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.fillRect(0, 0, 256, 7);
  ctx.fillRect(0, 0, 7, 256);
  ctx.fillStyle = 'rgba(90,55,55,0.28)';
  ctx.fillRect(0, 249, 256, 7);
  ctx.fillRect(249, 0, 7, 256);
  ctx.strokeStyle = 'rgba(80,50,50,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 253, 253);
  return c;
}

function floorSideCanvas() {
  const [c, ctx] = makeCanvas(128, 64);
  ctx.fillStyle = '#cdb3a6';
  ctx.fillRect(0, 0, 128, 64);
  blotches(ctx, 128, 64, 8, ['rgba(120,85,75,0.25)', 'rgba(230,210,200,0.15)'], 10, 30);
  speckle(ctx, 128, 64, 200, 0.1);
  ctx.fillStyle = 'rgba(70,45,40,0.4)';
  ctx.fillRect(0, 56, 128, 8);
  return c;
}

// ------------------------------------------------------------ stone walls
function brickCanvas(base, mortar, rows, jitter) {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * rh;
    for (let x = -rh + off; x < 256; x += rh * 2) {
      ctx.fillStyle = `rgba(${rand(0, 60) | 0},${rand(0, 35) | 0},${rand(0, 25) | 0},${rand(0, jitter)})`;
      ctx.fillRect(x, r * rh, rh * 2 - 3, rh - 3);
      ctx.fillStyle = `rgba(255,240,220,${rand(0, jitter * 0.6)})`;
      ctx.fillRect(x, r * rh, rh * 2 - 3, 4);
    }
  }
  // mortar lines
  ctx.strokeStyle = mortar;
  ctx.lineWidth = 3;
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * rh);
    ctx.lineTo(256, r * rh);
    ctx.stroke();
    const off = (r % 2) * rh;
    for (let x = off; x < 256; x += rh * 2) {
      ctx.beginPath();
      ctx.moveTo(x, r * rh);
      ctx.lineTo(x, (r + 1) * rh);
      ctx.stroke();
    }
  }
  speckle(ctx, 256, 256, 500, 0.08);
  return c;
}

function wallTopCanvas(base) {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  blotches(ctx, 128, 128, 10, ['rgba(60,40,30,0.2)', 'rgba(255,235,210,0.12)'], 15, 45);
  speckle(ctx, 128, 128, 250, 0.1);
  ctx.strokeStyle = 'rgba(60,40,30,0.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 124);
  return c;
}

// ---------------------------------------------------- grout + moss underlay
function groundCanvas() {
  const [c, ctx] = makeCanvas(1024, 1024);
  ctx.fillStyle = '#7d604f';
  ctx.fillRect(0, 0, 1024, 1024);
  blotches(ctx, 1024, 1024, 60, ['rgba(50,30,20,0.25)', 'rgba(160,120,95,0.2)'], 20, 80);
  // moss creeping along the tile cracks (grid lines)
  const cell = 1024 / GRID;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  for (let i = 0; i < 260; i++) {
    const horizontal = Math.random() < 0.5;
    const line = (rand(0, GRID + 1) | 0) * cell;
    const along = rand(0, 1024);
    const x = horizontal ? along : line;
    const y = horizontal ? line : along;
    const r = rand(4, 14);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = Math.random() < 0.5 ? '110,160,60' : '85,135,50';
    g.addColorStop(0, `rgba(${tone},${rand(0.5, 0.95)})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  speckle(ctx, 1024, 1024, 1500, 0.08);
  return c;
}

function outsideGroundCanvas() {
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#5f7546';
  ctx.fillRect(0, 0, S, S);
  // seamless: every blotch is also drawn wrapped across all edges so the
  // texture tiles with no visible seam
  const cols = ['rgba(40,60,28,0.40)', 'rgba(120,140,80,0.28)', 'rgba(96,80,50,0.30)', 'rgba(70,98,46,0.34)'];
  for (let i = 0; i < 150; i++) {
    const x = rand(0, S), y = rand(0, S), r = rand(28, 120);
    const col = cols[(Math.random() * cols.length) | 0];
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        if (Math.abs(x + dx - S / 2) > S / 2 + r || Math.abs(y + dy - S / 2) > S / 2 + r) continue;
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  speckle(ctx, S, S, 2600, 0.06);
  return c;
}

// soft round puff for drifting ground fog (alpha fades to edge)
function fogCanvas() {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  // a few lighter lobes so it isn't a perfect circle
  for (let i = 0; i < 5; i++) {
    const x = rand(70, 186), y = rand(70, 186), r = rand(40, 80);
    const lg = ctx.createRadialGradient(x, y, 0, x, y, r);
    lg.addColorStop(0, 'rgba(255,255,255,0.25)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

// soft, low-contrast water shimmer (scrolled over time = gentle moving surface)
function waterCanvas() {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#4f97bd';
  ctx.fillRect(0, 0, S, S);
  const blot = (x, y, r, col) => {
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        if (Math.abs(x + dx - S / 2) > S / 2 + r || Math.abs(y + dy - S / 2) > S / 2 + r) continue;
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  };
  // big soft light patches — calm and pastel, not busy
  for (let i = 0; i < 28; i++) blot(rand(0, S), rand(0, S), rand(60, 140), 'rgba(170,215,235,0.22)');
  for (let i = 0; i < 22; i++) blot(rand(0, S), rand(0, S), rand(40, 90), 'rgba(70,140,175,0.20)');
  return c;
}

// a little tuft of grass blades (transparent background, light so it tints)
function grassCanvas() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 11; i++) {
    const x = rand(18, 110);
    const baseW = rand(4, 8);
    const h = rand(54, 104);
    const lean = rand(-26, 26);
    const g = 200 + rand(0, 40);
    ctx.fillStyle = `rgb(${(150 + rand(0, 40)) | 0},${g | 0},${(120 + rand(0, 40)) | 0})`;
    ctx.beginPath();
    ctx.moveTo(x - baseW / 2, 128);
    ctx.lineTo(x + baseW / 2, 128);
    ctx.lineTo(x + lean, 128 - h);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

// ------------------------------------------------------------------- roofs
function roofCanvas() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#3e8c93';
  ctx.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 8; r++) {
    const y = r * 16;
    ctx.fillStyle = r % 2 ? 'rgba(20,60,65,0.35)' : 'rgba(160,220,220,0.12)';
    ctx.fillRect(0, y, 128, 3);
    for (let x = (r % 2) * 8; x < 128; x += 16) {
      ctx.strokeStyle = 'rgba(20,55,60,0.4)';
      ctx.beginPath();
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x, y + 16);
      ctx.stroke();
    }
  }
  return c;
}

// ----------------------------------------------------------------- banners
function bannerCanvas() {
  const [c, ctx] = makeCanvas(64, 128);
  ctx.clearRect(0, 0, 64, 128);
  // near-white body so instance colors tint it; swallow-tail bottom
  ctx.fillStyle = '#efeae4';
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(60, 0);
  ctx.lineTo(60, 100);
  ctx.lineTo(32, 124);
  ctx.lineTo(4, 100);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(218,180,100,0.95)'; // gold band + emblem
  ctx.fillRect(4, 10, 56, 7);
  ctx.beginPath();
  ctx.arc(32, 55, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(4, 92, 56, 4);
  return c;
}

// ------------------------------------------------------- floor decal (star)
function decalCanvas() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.translate(64, 64);
  ctx.strokeStyle = 'rgba(190,150,80,0.9)';
  ctx.fillStyle = 'rgba(220,185,110,0.35)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  const spikes = 8;
  for (let i = 0; i <= spikes * 2; i++) {
    const r = i % 2 === 0 ? 50 : 20;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

export function createTextures() {
  return {
    floor: overridable('floor', floorCanvas()),
    floorSide: overridable('floor_side', floorSideCanvas()),
    wall: overridable('wall', brickCanvas('#dfc6a0', 'rgba(150,118,86,0.55)', 4, 0.09)),
    wallTop: overridable('wall_top', wallTopCanvas('#cdb191')),
    outerWall: overridable('outer_wall', brickCanvas('#b6a49b', 'rgba(100,85,80,0.7)', 5, 0.1), { wrap: true }),
    ground: overridable('ground', groundCanvas()),
    outsideGround: overridable('outside_ground', outsideGroundCanvas(), { wrap: true }),
    roof: overridable('roof', roofCanvas()),
    banner: overridable('banner', bannerCanvas()),
    decal: overridable('decal', decalCanvas()),
    fog: overridable('fog', fogCanvas()),
    grass: overridable('grass', grassCanvas()),
    water: overridable('water', waterCanvas(), { wrap: true }),
  };
}
