// Mario-style boot loading screen.
//
// The white overlay + the spinning Mario-cap sprite live in index.html and
// animate with PURE CSS (an 8-frame sprite strip ripped from Odyssey's screen
// transitions), so they paint from the very first frame - before three.js, the
// ES modules, or any asset has loaded. That is the whole point of a loading
// screen, and it's why this is CSS, not a 3D model that would itself need loading.
//
// This module does NOT show the screen (the browser already did). It only drives
// the REVEAL: main.js waits until the menu's assets are actually loaded, then
// calls finish() - the cap flies at the screen and the white fades to show the
// menu, and the overlay removes itself.

export function createLoadScreen() {
  const el = document.getElementById("loadscreen");
  let done = false;
  return {
    // resolves once the overlay is gone. Safe to call once.
    finish() {
      if (done) return Promise.resolve();
      done = true;
      if (!el) return Promise.resolve();
      return new Promise((resolve) => {
        el.classList.add("ls-out"); // CSS: cap zooms in, white fades out
        const end = () => {
          el.remove();
          resolve();
        };
        // remove after the CSS reveal (with a fallback in case the browser
        // skips the transition, e.g. reduced-motion)
        setTimeout(end, 680);
      });
    },
  };
}
