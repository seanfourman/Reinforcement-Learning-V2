// Mario-style boot loading screen.
//
// The white overlay + the Mario-cap sprite live in index.html so they paint from
// the very first frame - before three.js, the ES modules, or any asset has
// loaded. That is the whole point of a loading screen, and it's why the cap is a
// CSS sprite strip (ripped from Odyssey's screen transitions), not a 3D model
// that would itself need loading.
//
// This module DRIVES the reveal from JS (one rAF loop):
//
//   1. SPIN - the cap tumbles (frames stepped in JS) while main.js loads assets.
//   2. LAND - finish() eases the tumble to a stop on the default frame (frame 0,
//             cap facing front). No snap: it decelerates onto a whole rotation.
//   3. WIND-UP - the cap pulls back a touch (shrinks) as anticipation.
//   4. GROW - then it SPRINTS out: the cap becomes a window to the scene (a
//             cap-shaped HOLE in the white) that grows until the white is gone.
//             Nothing fades. The white M badge (#capbadge, M cut out so the scene
//             shows through it) rides on the cap as it grows.
//
// The hole (#loadscreen.grow) and the M badge (#capbadge) share the SAME full-cell
// geometry + the SAME --hole (set on :root), so they're pixel-aligned and grow
// together; HANDOFF_HOLE = one sprite cell, so the reveal starts at the exact size
// and position of the landed sprite.

const N = 8; // sprite frames
const CELL_VMIN = 42.2; // one cell width, matches #capwin / #capstrip cell
const SPIN_MS = 48; // ms per frame while tumbling (fast = fluid)
const HANDOFF_HOLE = 42.2; // vmin: = one sprite cell, so the reveal == the landed sprite
const BACK_HOLE = HANDOFF_HOLE * 0.78; // wind-up: pull back a touch before the sprint
const FULL_HOLE = 820; // vmin: cap-hole big enough to clear any screen
const WINDUP_MS = 190; // the little pull-back before it grows
const GROW_MS = 560; // sprint out to full screen

const easeIn = (p) => p * p;
const easeOut = (p) => 1 - (1 - p) * (1 - p);

export function createLoadScreen() {
  const root = document.documentElement;
  const el = document.getElementById("loadscreen");
  const win = document.getElementById("capwin");
  const strip = document.getElementById("capstrip");
  const badge = document.getElementById("capbadge");
  if (!el || !win || !strip) return { finish: () => Promise.resolve() };

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // take over the frames from the CSS cold-start spin (index.html). Driving them
  // from JS is what lets finish() decelerate and land exactly on frame 0.
  strip.style.animation = "none";

  let raf = 0;
  let gone = false;
  let resolveDone = null;
  let phase = "spin";

  // timers (ms, performance.now based)
  let spinBase = performance.now(); // frame 0 origin for the tumble
  let landFrom = 0;
  let landTo = 0;
  let landStart = 0;
  let landDur = 0;
  let windupStart = 0;
  let growStart = 0;

  const showFrame = (f) => {
    const fr = ((Math.floor(f) % N) + N) % N;
    strip.style.transform = `translate3d(${-fr * CELL_VMIN}vmin, 0, 0)`;
  };
  const setHole = (vmin) => root.style.setProperty("--hole", vmin + "vmin");

  const finishNow = () => {
    if (gone) return;
    gone = true;
    cancelAnimationFrame(raf);
    if (el.parentNode) el.remove();
    if (badge && badge.parentNode) badge.remove();
    if (resolveDone) resolveDone();
  };

  const startReveal = (now) => {
    // hand off from the sprite to the reveal at the landed size: hide the sprite,
    // open the scene-hole and show the M badge at exactly the sprite's size/place.
    setHole(HANDOFF_HOLE);
    el.classList.add("grow");
    if (badge) badge.style.opacity = "1";
    phase = "windup";
    windupStart = now;
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    const now = performance.now();

    if (phase === "spin") {
      showFrame((now - spinBase) / SPIN_MS);
    } else if (phase === "land") {
      const p = Math.min(1, (now - landStart) / landDur);
      showFrame(landFrom + (landTo - landFrom) * easeOut(p));
      if (p >= 1) {
        showFrame(0); // default frame: cap facing front
        startReveal(now);
      }
    } else if (phase === "windup") {
      // pull back a touch (anticipation) - decelerate into the pulled-back size
      const p = Math.min(1, (now - windupStart) / WINDUP_MS);
      setHole(HANDOFF_HOLE + (BACK_HOLE - HANDOFF_HOLE) * easeOut(p));
      if (p >= 1) {
        phase = "grow";
        growStart = now;
      }
    } else if (phase === "grow") {
      // ...then SPRINT out until the white is gone; the M rides along
      const p = Math.min(1, (now - growStart) / GROW_MS);
      setHole(BACK_HOLE + (FULL_HOLE - BACK_HOLE) * easeIn(p));
      if (p >= 1) finishNow();
    }
  };
  raf = requestAnimationFrame(tick);

  return {
    // Called by main.js once the heavy assets are actually loaded. Lands the
    // tumble on the default frame, then grows the cap to reveal the scene.
    // Resolves when the overlay is gone. Safe to call once.
    finish() {
      if (gone || phase !== "spin") return Promise.resolve();
      if (reduced) {
        finishNow();
        return Promise.resolve();
      }
      const cur = (performance.now() - spinBase) / SPIN_MS;
      let to = Math.ceil(cur / N) * N; // next time the cap faces front
      if (to - cur < N * 0.5) to += N; // guarantee at least half a turn to land
      landFrom = cur;
      landTo = to;
      landDur = (to - cur) * SPIN_MS * 1.45; // ease the tumble to a stop
      landStart = performance.now();
      phase = "land";
      return new Promise((resolve) => (resolveDone = resolve));
    },
  };
}
