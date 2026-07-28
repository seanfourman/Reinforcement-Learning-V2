// Learning-curve charts + single-episode replay player (both spec requirements).
//
// * initCurves(parent, side) polls /api/history and plots ONLY that side's signals
//   (Blue on the player panel, Red on the CPU panel): its per-episode return, its
//   rolling win rate, its exploration epsilon, and the shared episode length.
// * initReplay(parent) builds the replay BROWSER (pick a model + a top run); picking
//   a run hands its frames to the shared player window.RL.replay (loaded PAUSED). The
//   panel's Playback card owns play/pause/scrub/speed + Back-to-live.
//
// initGraphs(parent) = initCurves(parent, 'blue') + initReplay(parent), the
// player's left panel. The CPU panel calls initCurves(panel, 'red') on its own.

// the four charts for one side; only that model's series are plotted
function chartsFor(side) {
  const isRed = side === "red";
  const c = isRed ? "#e60012" : "#1f5fd0";
  const label = isRed ? "Red" : "Blue";
  return [
    {
      id: `return-${side}`,
      title: "Episode return",
      legend: [[c, label]],
      series: [{ key: isRed ? "retRed" : "retBlue", color: c }],
      showValues: true,
      fmt: (v) => v.toFixed(1),
    },
    {
      id: `rate-${side}`,
      title: "Win rate - recent",
      legend: [[c, label]],
      series: [{ key: isRed ? "rateRed" : "rateBlue", color: c }],
      min: 0,
      max: 1,
      showValues: true,
      fmt: (v) => Math.round(v * 100) + "%",
    },
    {
      id: `eps-${side}`,
      title: "Exploration ε",
      legend: [["#7c4dd0", "ε"]],
      series: [{ key: isRed ? "redEps" : "eps", color: "#7c4dd0" }],
      min: 0,
      max: 1,
      showValues: true,
      fmt: (v) => v.toFixed(2),
    },
    {
      id: `len-${side}`,
      title: "Episode length",
      legend: [["#1f9d63", "steps"]],
      series: [{ key: "len", color: "#1f9d63" }],
      showValues: true,
      fmt: (v) => v.toFixed(0),
    },
  ];
}

function chartBlock(c) {
  const lg = c.legend
    .map(([col, t]) => `<i style="background:${col}"></i>${t}`)
    .join("");
  // c.fullonly charts are hidden in the docked quick view (only the win-rate
  // chart rides along there); grouped chart tabs can show all of them together.
  return `
    <div class="chart${c.fullonly ? " fullonly" : ""}">
      <div class="ct"><h3>${c.title}</h3><span class="lg">${lg}</span></div>
      <canvas id="rl-ch-${c.id}"></canvas>
      ${c.note ? `<p class="hint">${c.note}</p>` : ""}
    </div>`;
}

// Only one chart may own the mouse wheel at a time. Activating another chart
// releases the previous one, so wheel scrolling never gets trapped ambiguously.
let activeZoomRelease = null;
document.addEventListener("pointerdown", (e) => {
  if (activeZoomRelease && !e.target?.closest?.(".chart.zoom-focus"))
    activeZoomRelease();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeZoomRelease) {
    e.preventDefault();
    e.stopPropagation();
    activeZoomRelease();
  }
});

// a small auto-scaling line chart on a crisp (dpr-aware) canvas
function makeChart(canvas, cfg) {
  const ctx = canvas.getContext("2d");
  const chartEl = canvas.closest(".chart") || canvas;
  let W = 0,
    H = 0,
    lastPoints = null,
    zoomFocused = false,
    vs = 0, // zoom viewport start / end as fractions of the points array (wheel to zoom)
    ve = 1,
    frame = null; // last-draw geometry, so the hover readout can map a pixel -> value
  // size the drawing BUFFER to the on-screen box x DPR so lines stay crisp
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || 332;
    H = canvas.clientHeight || 132;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // re-fit (which clears the canvas) then redraw the last data - used on window resize
  // and when the chart finally gets its real size after being drawn while hidden
  function resize() {
    fit();
    if (lastPoints) draw(lastPoints);
  }
  function draw(points) {
    lastPoints = points;
    // (re)fit if the buffer isn't matched to the CURRENT on-screen width. A chart first
    // drawn while its tab was hidden gets a 0/fallback width; shown wider, that small
    // bitmap is scaled up and the lines look blurry - refitting renders them sharp.
    if (!W || (canvas.clientWidth && canvas.clientWidth !== W)) fit();
    frame = null;
    // restrict to the zoom viewport (mouse wheel); full range by default
    if (points && points.length > 2 && (vs > 0 || ve < 1)) {
      const n0 = points.length;
      const a = Math.max(0, Math.floor(vs * n0));
      const b = Math.min(n0, Math.ceil(ve * n0));
      points = points.slice(a, Math.max(a + 2, b));
    }
    ctx.clearRect(0, 0, W, H);
    const padT = 9,
      padB = 9,
      x0 = 5,
      x1 = W - 5,
      y0 = padT,
      y1 = H - padB;
    let lo, hi;
    if (cfg.min != null && cfg.max != null) {
      lo = cfg.min;
      hi = cfg.max;
    } else {
      lo = Infinity;
      hi = -Infinity;
      for (const p of points || [])
        for (const s of cfg.series) {
          const v = p[s.key];
          if (v == null || Number.isNaN(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      if (!isFinite(lo)) {
        lo = 0;
        hi = 1;
      }
      if (lo === hi) {
        lo -= 0.5;
        hi += 0.5;
      }
      const m = (hi - lo) * 0.12;
      lo -= m;
      hi += m;
    }
    const span = hi - lo || 1;
    const yOf = (v) => y1 - ((v - lo) / span) * (y1 - y0);
    ctx.strokeStyle = "#edeff2";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 2; g++) {
      const yy = Math.round(y0 + (g / 2) * (y1 - y0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x1, yy);
      ctx.stroke();
    }
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = "#d6dae0";
      const yz = Math.round(yOf(0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x0, yz);
      ctx.lineTo(x1, yz);
      ctx.stroke();
    }
    if (points && points.length >= 2) {
      const cols = Math.max(2, Math.floor(x1 - x0));
      const step = Math.max(1, Math.floor(points.length / cols));
      const xs = [];
      for (let i = 0; i < points.length; i += step) xs.push(points[i]);
      if (xs[xs.length - 1] !== points[points.length - 1])
        xs.push(points[points.length - 1]);
      const n = xs.length;
      for (const s of cfg.series) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.7;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        let started = false;
        xs.forEach((p, i) => {
          const v = p[s.key];
          if (v == null || Number.isNaN(v)) return;
          const x = x0 + (i / (n - 1)) * (x1 - x0);
          const y = yOf(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      frame = { x0, x1, y0, y1, lo, hi, yOf, xs, n }; // for the hover readout
    }
    ctx.fillStyle = "#a2a5ac";
    ctx.font = "9px system-ui,sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(cfg.fmt(hi), 5, 2);
    ctx.textBaseline = "bottom";
    ctx.fillText(cfg.fmt(lo), 5, H - 1);
    // optionally show each series' CURRENT value near its line end. Placed in the
    // emptier vertical direction (BELOW a high line, ABOVE a low one) over a soft
    // white chip, so it never ends up sitting on top of the line - even at 0%/100%.
    if (cfg.showValues && points && points.length) {
      ctx.font = "700 10px system-ui,sans-serif";
      const mid = (y0 + y1) / 2,
        gap = 8,
        bh = 13,
        padX = 3;
      const items = [];
      for (const s of cfg.series) {
        let lv = null;
        for (let i = points.length - 1; i >= 0; i--) {
          const v = points[i][s.key];
          if (v != null && !Number.isNaN(v)) { lv = v; break; }
        }
        if (lv == null) continue;
        const ey = yOf(lv);
        let cy = ey <= mid ? ey + gap : ey - gap; // push into the emptier half
        cy = Math.max(bh / 2 + 1, Math.min(H - bh / 2 - 1, cy));
        items.push({ cy, text: cfg.fmt(lv), color: s.color });
      }
      items.sort((a, b) => a.cy - b.cy); // keep two chips from overlapping
      for (let i = 1; i < items.length; i++)
        if (items[i].cy - items[i - 1].cy < bh + 1) items[i].cy = items[i - 1].cy + bh + 1;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const it of items) {
        const tw = ctx.measureText(it.text).width;
        const bw = tw + padX * 2,
          bx = x1 - bw,
          by = it.cy - bh / 2,
          r = 3;
        ctx.fillStyle = "rgba(255,255,255,0.82)";
        ctx.beginPath();
        ctx.moveTo(bx + r, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
        ctx.arcTo(bx, by + bh, bx, by, r);
        ctx.arcTo(bx, by, bx + bw, by, r);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, x1 - padX, it.cy);
      }
      ctx.textAlign = "left";
    }
  }
  // ---- interaction: hover to read; double-click grants/releases wheel zoom focus
  function drawHover(mx) {
    if (!lastPoints) return;
    draw(lastPoints); // redraw the base chart (respects the current zoom viewport)
    if (!frame || frame.n < 1) return;
    const { x0, x1, y0, y1, yOf, xs, n } = frame;
    let f = (mx - x0) / (x1 - x0 || 1);
    f = Math.max(0, Math.min(1, f));
    const i = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
    const px = x0 + (i / (n - 1 || 1)) * (x1 - x0);
    const p = xs[i];
    ctx.strokeStyle = "rgba(120,130,140,0.55)"; // crosshair
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(px) + 0.5, y0);
    ctx.lineTo(Math.round(px) + 0.5, y1);
    ctx.stroke();
    const labels = [];
    for (const s of cfg.series) {
      const v = p[s.key];
      if (v == null || Number.isNaN(v)) continue;
      const py = yOf(v);
      ctx.fillStyle = s.color; // dot on each line
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, 6.2832);
      ctx.fill();
      labels.push({ text: cfg.fmt(v), color: s.color });
    }
    if (!labels.length) return;
    ctx.font = "700 10px system-ui,sans-serif";
    ctx.textBaseline = "middle";
    const lh = 13,
      pad = 4,
      bw = Math.max(...labels.map((l) => ctx.measureText(l.text).width)) + pad * 2,
      bh = labels.length * lh + pad;
    let bx = px + 8;
    if (bx + bw > x1) bx = px - 8 - bw; // flip to the left near the right edge
    bx = Math.max(x0, Math.min(x1 - bw, bx));
    const by = Math.max(y0, Math.min(y1 - bh, y0 + 2));
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = "rgba(150,158,168,0.6)";
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.textAlign = "left";
    labels.forEach((l, k) => {
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, bx + pad, by + pad + lh / 2 + k * lh);
    });
    ctx.textAlign = "left";
  }
  canvas.addEventListener("mousemove", (e) => {
    drawHover(e.clientX - canvas.getBoundingClientRect().left);
  });
  canvas.addEventListener("mouseleave", () => { if (lastPoints) draw(lastPoints); });
  const releaseZoom = () => {
    zoomFocused = false;
    chartEl.classList.remove("zoom-focus");
    if (activeZoomRelease === releaseZoom) activeZoomRelease = null;
  };
  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (zoomFocused) {
      releaseZoom();
      vs = 0;
      ve = 1;
      if (lastPoints) draw(lastPoints);
      return;
    }
    activeZoomRelease?.();
    zoomFocused = true;
    chartEl.classList.add("zoom-focus");
    activeZoomRelease = releaseZoom;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      // Until the user explicitly focuses this chart, leave the wheel completely
      // alone so the containing Control Menu continues to scroll.
      if (!zoomFocused) return;
      if (!lastPoints || lastPoints.length < 3) return;
      e.preventDefault();
      const x0 = 5,
        x1 = (canvas.clientWidth || W) - 5;
      let f = (e.clientX - canvas.getBoundingClientRect().left - x0) / (x1 - x0 || 1);
      f = Math.max(0, Math.min(1, f));
      const cur = vs + f * (ve - vs); // data-fraction under the cursor stays put
      let span = (ve - vs) * (e.deltaY < 0 ? 0.8 : 1.25); // in / out
      span = Math.max(0.04, Math.min(1, span));
      vs = cur - f * span;
      ve = cur + (1 - f) * span;
      if (vs < 0) { ve -= vs; vs = 0; }
      if (ve > 1) { vs -= ve - 1; ve = 1; }
      vs = Math.max(0, vs);
      ve = Math.min(1, ve);
      draw(lastPoints);
    },
    { passive: false },
  );

  // sharpen the moment the canvas gets a real size (e.g. its tab is opened), without
  // waiting for the next 1s data refresh
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      if (canvas.clientWidth && canvas.clientWidth !== W) resize();
    });
    ro.observe(canvas);
  }
  return { draw, resize };
}

// Draw a value grid from directly above, matching the board orientation.  The former
// isometric relief looked dramatic but made it unnecessarily hard to relate a value
// cell to the actual maze while scrubbing propagation.
function drawVSurface(canvas, grid) {
  const ctx = canvas.getContext("2d");
  // A canvas inside an inactive tab has no layout size. Drawing against a
  // fallback width makes the grid's internal padding scale when the tab opens,
  // so the map appears to jump larger on its second draw. Wait for a real size.
  const cw = canvas.clientWidth,
    ch = canvas.clientHeight;
  if (!cw || !ch) return false;
  const H = grid.length,
    W = grid[0] ? grid[0].length : 0;
  let r0 = H,
    r1 = -1,
    c0 = W,
    c1 = -1,
    lo = Infinity,
    hi = -Infinity;
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const v = grid[r][c];
      if (v == null) continue;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (r1 < 0) return;
  const R = r1 - r0 + 1, C = c1 - c0 + 1, span = hi - lo || 1;
  const pad = 22;
  const size = Math.min((cw - pad * 2) / C, (ch - pad * 2) / R);
  const ox = (cw - C * size) / 2, oy = (ch - R * size) / 2;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const v = grid[r][c];
    // Peach's Castle is viewed from the flipped side of the board. Rotate the
    // diagnostic 180° as well so its cells line up with what the player sees.
    const dc = C - 1 - (c - c0), dr = R - 1 - (r - r0);
    const x = ox + dc * size, y = oy + dr * size;
    if (v == null) ctx.fillStyle = "#d9dce2";
    else {
      const t = (v - lo) / span;
      ctx.fillStyle = `rgb(${Math.round(41 + t * 179)},${Math.round(107 - t * 54)},${Math.round(235 - t * 189)})`;
    }
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = "rgba(20,22,30,.12)";
    ctx.lineWidth = 0.6;
    ctx.strokeRect(x, y, size, size);
  }
  ctx.fillStyle = "#686d76";
  ctx.font = "700 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  // The diagnostic is rotated with Peach's camera, so its visual top is the
  // player-facing North even though it corresponds to increasing matrix rows.
  ctx.fillText("N", cw / 2, Math.max(10, oy - 8));
  return true;
}

// ---- per-side learning curves ----
export function initCurves(parent, side) {
  const CH = chartsFor(side);
  // one card per chart, so grouped chart views tile as uniform grid cells
  parent.insertAdjacentHTML(
    "beforeend",
    CH.map((c) => `<section id="rl-curve-${c.id}">${chartBlock(c)}</section>`).join(""),
  );
  const charts = CH.map((c) =>
    makeChart(parent.querySelector(`#rl-ch-${c.id}`), c),
  );
  window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
  async function refresh() {
    try {
      const h = await (
        await fetch("/api/history", { cache: "no-store" })
      ).json();
      charts.forEach((c) => c.draw(h.points));
    } catch (e) {
      /* server warming up */
    }
  }
  setInterval(refresh, 1000);
  refresh();
}

// ---- shared episode replay: browse each model's TOP-30 fastest winning runs ----
export function initReplay(parent) {
  // Just the BROWSER now: pick a model (Blue left, Red right) and a top run. Picking
  // a run LOADS it into the shared player (window.RL.replay) PAUSED - the panel's
  // Playback card drives play/pause/scrub/speed + Back to live.
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-replay">
      <h2>Episode replay</h2>
      <div class="seg" id="rl-rep-model" role="group" aria-label="Replay model">
        <button data-a="blue" class="active" aria-pressed="true">Blue - top 30</button>
        <button data-a="red" aria-pressed="false">Red - top 30</button>
      </div>
      <div id="rl-rep-list" class="replist" role="region" aria-label="Top episode replays"></div>
    </section>`,
  );
  const $ = (id) => parent.querySelector(id);
  const seg = $("#rl-rep-model");
  const listEl = $("#rl-rep-list");
  let model = "blue"; // default: the player's own model (Blue), on the left
  let selEpisode = null; // immutable replay identity; rank changes as training runs
  let listRequest = 0;
  let replayRequest = 0;

  async function refreshList() {
    const requestedModel = model;
    const request = ++listRequest;
    try {
      const r = await (
        await fetch(`/api/replays?agent=${requestedModel}`, { cache: "no-store" })
      ).json();
      if (request !== listRequest || requestedModel !== model) return;
      const items = r.items || [];
      if (!items.length) {
        listEl.innerHTML = `<div class="empty">No winning runs yet for ${requestedModel === "red" ? "Red" : "Blue"}.</div>`;
        return;
      }
      listEl.innerHTML = items
        .map(
          (it) =>
            `<button type="button" class="rrow${it.episode === selEpisode ? " sel" : ""}" ` +
            `data-rank="${it.rank}" data-episode="${it.episode}" ` +
            `aria-label="Replay rank ${it.rank + 1}, ${it.steps} steps, episode ${it.episode}">` +
            `<span class="rk">#${it.rank + 1}</span>` +
            `<span class="st">${it.steps} steps</span>` +
            `<span class="ep">ep ${(it.episode || 0).toLocaleString()}</span></button>`,
        )
        .join("");
    } catch (e) {
      if (request !== listRequest || requestedModel !== model) return;
      listEl.innerHTML = '<div class="empty">List fetch failed.</div>';
    }
  }

  async function loadTop(rank, episode) {
    const requestedModel = model;
    const request = ++replayRequest;
    // Cancel an older replay load immediately, rather than waiting for this
    // request to cross both the fetch and replayEnter pause boundary.
    const loadGeneration = window.RL?.replay?.reserveLoad?.();
    try {
      const r = await (
        await fetch(`/api/replay?which=top&agent=${requestedModel}&rank=${rank}&episode=${episode}`, {
          cache: "no-store",
        })
      ).json();
      if (request !== replayRequest || requestedModel !== model) return;
      if (!r.available) {
        refreshList(); // rolled out of the top 30 - refresh
        return;
      }
      // hand the frames to the shared player, PAUSED (Playback takes over from here);
      // pass the model so the Playback scrubber matches (red for Red runs)
      const eps = r.replayFields?.epsilon;
      const replayModel = r.agent === "red" ? "red" : requestedModel;
      const label = `${replayModel === "red" ? "Red" : "Blue"} #${r.rank + 1} - ${r.steps} steps` +
        (Number.isFinite(eps) ? ` · ε ${eps.toFixed(2)}` : "");
      const loaded = await window.RL?.replay?.load?.(
        r.frames || [],
        label,
        replayModel,
        r.policyFrames || [],
        r.replayFields || null,
        loadGeneration,
      );
      if (!loaded || request !== replayRequest || requestedModel !== model) return;
      selEpisode = r.episode ?? episode;
      [...listEl.children].forEach((el) =>
        el.classList.toggle("sel", +el.dataset.episode === selEpisode),
      );
    } catch (e) {
      /* ignore a failed fetch - the list stays as-is */
    }
  }

  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    [...seg.children].forEach((x) => x.classList.toggle("active", x === b));
    [...seg.children].forEach((x) =>
      x.setAttribute("aria-pressed", x === b ? "true" : "false"),
    );
    model = b.dataset.a;
    listRequest++;
    replayRequest++;
    window.RL?.replay?.reserveLoad?.();
    listEl.classList.toggle("red", model === "red"); // red model -> red row selection
    selEpisode = null;
    refreshList();
  });
  listEl.addEventListener("click", (e) => {
    const row = e.target.closest(".rrow");
    if (!row) return;
    loadTop(+row.dataset.rank, +row.dataset.episode);
  });
  // when the panel exits replay (Back to live / arena change), drop the highlight
  // AND re-pull the list: an arena change wipes the backend's per-round top-30, so the
  // browser must refresh immediately instead of showing the previous round's stale rows.
  window.addEventListener("rl-replay-state", (e) => {
    if (!e.detail?.active) {
      if (selEpisode !== null) {
        selEpisode = null;
        [...listEl.children].forEach((el) => el.classList.remove("sel"));
      }
      refreshList();
    }
  });

  refreshList();
  // keep the list fresh as new fast runs come in, but not while a run is loaded
  // (so the current selection stays put)
  setInterval(() => {
    if (!window.RL?.replay?.active?.()) refreshList();
  }, 4000);
}

// ---- DP convergence (Round 1's Dynamic-Programming room): per-sweep Bellman
// residual + mean state value - the distinctive "how DP converges" charts ----
export function initDP(parent) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-dp" hidden>
      <h2>DP convergence</h2>
      <div class="stat"><span id="rl-dp-name">-</span><b id="rl-dp-sweeps"></b></div>
      <div class="stat"><span>Planning status</span><b id="rl-dp-status" class="dp-status">Planning</b></div>
      <div class="stat"><span>State-value updates</span><b id="rl-dp-backups">-</b></div>
      <div class="chart" style="margin-top:12px;"><div class="ct"><h3>Bellman residual &Delta; / sweep (log)</h3></div><canvas id="rl-ch-dp-delta"></canvas></div>
      <div class="chart"><div class="ct"><h3>Mean state value / sweep</h3></div><canvas id="rl-ch-dp-meanv"></canvas></div>
      <div class="chart" id="rl-dp-polwrap" hidden><div class="ct"><h3>Policy changes / iteration (PI)</h3></div><canvas id="rl-ch-dp-pol"></canvas></div>
      <div id="rl-dp-anim" hidden style="margin-top:14px;">
        <div class="ct"><h3>Value propagation</h3></div>
        <canvas id="rl-dp-vcanvas" style="width:100%;aspect-ratio:1/1;background:#f6f7f9;border-radius:10px;display:block;margin-top:6px;"></canvas>
        <input type="range" id="rl-dp-vseek" min="0" max="0" value="0" style="margin-top:10px;--fill:#e11f2b">
        <div class="stat" style="margin-top:2px;"><span>Sweep</span><b id="rl-dp-vlbl">-</b></div>
      </div>
    </section>`,
  );
  const q = (s) => parent.querySelector(s);
  const sec = q("#rl-dp");
  let dpAgent = "blue";
  // request-generation guards: an out-of-order /api/dpsweeps or /api/dp response must
  // not overwrite the newer planner's propagation frames / convergence pin.
  let sweepReq = 0, dpReq = 0;
  // plain decimal string, NEVER scientific notation (e.g. 0.00001, not 1e-5),
  // trimmed of trailing zeros. Keeps ~3 significant figures.
  const plainDec = (x) => {
    if (!isFinite(x)) return String(x);
    let s = Number(x).toPrecision(3);
    if (/e/i.test(s)) s = Number(s).toFixed(20);      // expand any scientific form
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  };
  // the DP section shows ONE selected planner (dpAgent); colour its residual chart and
  // the propagation scrubber by that side (red = Value Iteration, blue = Policy Iteration)
  // rather than a fixed red, so viewing Blue no longer draws Blue's convergence in red.
  const dpColor = () => (dpAgent === "red" ? "#e11f2b" : "#1f5fd0");
  const dpDeltaCfg = {
    series: [{ key: "logDelta", color: dpColor() }],
    fmt: (v) => {
      const d = Math.pow(10, v);
      return d >= 1 ? d.toFixed(1) : plainDec(d);
    },
  };
  const chDelta = makeChart(q("#rl-ch-dp-delta"), dpDeltaCfg);
  const chMeanV = makeChart(q("#rl-ch-dp-meanv"), {
    series: [{ key: "meanV", color: "#1f9d63" }],
    fmt: (v) => v.toFixed(2),
  });
  const chPol = makeChart(q("#rl-ch-dp-pol"), {
    series: [{ key: "changed", color: "#7c4dd0" }],
    min: 0,
    fmt: (v) => v.toFixed(0),
  });
  const polWrap = q("#rl-dp-polwrap");
  window.addEventListener("resize", () => {
    chDelta.resize();
    chMeanV.resize();
    chPol.resize();
  });
  window.addEventListener("rl-modelview", (e) => {
    dpAgent = e.detail?.model === "cpu" ? "red" : "blue";
    vframes = [];
    vseek.value = 0;
    refresh();
    loadSweeps();
  });
  // convergence threshold theta lives in the World panel (ALGORITHM INTERNALS) - the
  // same dpTheta value, so it is not duplicated here.
  // ---- Value-Iteration propagation animation (per-sweep V snapshots) ----
  const anim = q("#rl-dp-anim"),
    vcanvas = q("#rl-dp-vcanvas"),
    vseek = q("#rl-dp-vseek"),
    vlbl = q("#rl-dp-vlbl");
  let vframes = [];
  const paintVseek = () => {
    const p = +vseek.max > 0 ? (+vseek.value / +vseek.max) * 100 : 0;
    const c = dpColor();
    vseek.style.setProperty("--fill", c);
    vseek.style.background = `linear-gradient(to right,${c} ${p}%,#e1e3e8 ${p}%)`;
  };
  const renderV = () => {
    if (!vframes.length) return;
    const i = Math.min(+vseek.value, vframes.length - 1);
    drawVSurface(vcanvas, vframes[i]);
    vlbl.textContent = `${i + 1} / ${vframes.length}`;
    paintVseek();
  };
  vseek.addEventListener("input", renderV);
  window.addEventListener("resize", renderV);
  // display:none -> visible is the important "resize" here. Draw only once the
  // Inside tab has its final width, eliminating the first-open size snap.
  if (window.ResizeObserver) {
    const vro = new ResizeObserver(() => {
      if (vcanvas.clientWidth && vcanvas.clientHeight) renderV();
    });
    vro.observe(vcanvas);
  }
  async function loadSweeps() {
    try {
      const requested = dpAgent, gen = ++sweepReq;
      const sw = await (
        await fetch(`/api/dpsweeps?agent=${dpAgent}`, { cache: "no-store" })
      ).json();
      if (gen !== sweepReq || requested !== dpAgent) return; // a newer request superseded us
      if (sw.available && sw.frames && sw.frames.length) {
        anim.hidden = false;
        vframes = sw.frames;
        vseek.max = vframes.length - 1;
        if (+vseek.value > +vseek.max) vseek.value = vseek.max;
        renderV();
      } else {
        anim.hidden = true;
        vframes = [];
      }
    } catch (e) {
      anim.hidden = true;
    }
  }
  const completionState = (d) => {
    if (!d?.isDP) return { converged: false, hitLimit: false };
    const isPolicyIteration =
      d.method === "policy_iteration" || d.name === "Policy Iteration";
    const trace = Array.isArray(d.sweeps) ? d.sweeps : [];
    const lastSweep = trace.length ? trace[trace.length - 1] : null;
    const toleranceReached =
      lastSweep != null &&
      Number.isFinite(Number(lastSweep.delta)) &&
      Number(lastSweep.delta) < Number(d.theta);
    const changes = Array.isArray(d.policyChanges) ? d.policyChanges : [];
    const policyStable =
      changes.length > 0 && Number(changes[changes.length - 1]) === 0;
    const inferredConverged =
      toleranceReached && (!isPolicyIteration || policyStable);
    const converged =
      typeof d.converged === "boolean" ? d.converged : inferredConverged;
    const statsMax = window.RL?.getStats?.()?.params?.dpMaxIters;
    const maxSweeps =
      d.maxSweeps != null && Number.isFinite(Number(d.maxSweeps))
        ? Number(d.maxSweeps)
        : statsMax != null && Number.isFinite(Number(statsMax))
          ? Number(statsMax)
          : null;
    const hitLimit =
      typeof d.hitLimit === "boolean"
        ? d.hitLimit
        : !converged && maxSweeps != null && Number(d.sweepCount) >= maxSweeps;
    return { converged, hitLimit };
  };
  async function refresh() {
    try {
      const gen = ++dpReq;
      const [red, blue] = await Promise.all(
        ["red", "blue"].map((agent) =>
          fetch(`/api/dp?agent=${agent}`, { cache: "no-store" }).then((r) =>
            r.json(),
          ),
        ),
      );
      if (gen !== dpReq) return; // a newer refresh() started; drop this stale pair
      const reports = { red, blue };
      const d = reports[dpAgent];
      const redState = completionState(red);
      const blueState = completionState(blue);
      const bothComplete =
        red.isDP &&
        blue.isDP &&
        redState.converged &&
        !redState.hitLimit &&
        blueState.converged &&
        !blueState.hitLimit;
      const panelRoot = parent.closest("#rl-panel");
      const convergedPin = panelRoot?.querySelector("#rl-converged-pin");
      if (convergedPin) convergedPin.hidden = !bothComplete;
      panelRoot?.classList.toggle("has-dp-converged", bothComplete);
      if (!d.isDP) {
        sec.hidden = true;
        return;
      } // hidden on non-DP rounds
      sec.hidden = false;
      q("#rl-dp-name").textContent =
        d.name || d.method || "Dynamic Programming";
      q("#rl-dp-sweeps").textContent = `${d.sweepCount} sweeps - γ ${d.gamma}`;
      q("#rl-dp-backups").textContent = (d.backups || 0).toLocaleString();
      const status = q("#rl-dp-status");
      status.className = "dp-status";
      const { converged, hitLimit } = completionState(d);
      if (hitLimit) {
        status.textContent = "Stopped at sweep limit, not converged";
        status.classList.add("limit");
      } else if (converged) {
        status.textContent = "Converged";
        status.classList.add("ok");
      } else {
        status.textContent = "Planning";
      }
      const pts = (d.sweeps || []).map((s) => ({
        logDelta: Math.log10(Math.max(s.delta, 1e-6)),
        meanV: s.meanV,
      }));
      dpDeltaCfg.series[0].color = dpColor();
      chDelta.draw(pts);
      chMeanV.draw(pts);
      const pol = d.policyChanges || [];
      polWrap.hidden = pol.length === 0; // only PI has policy-improvement iterations
      if (pol.length) chPol.draw(pol.map((c, i) => ({ i, changed: c })));
      loadSweeps(); // frames grow while the selected planner is running
    } catch (e) {
      /* server warming up */
    }
  }
  setInterval(refresh, 1500);
  refresh();
  loadSweeps();
}

const RED = "#e60012",
  BLUE = "#1f5fd0";

// dual Red-vs-Blue learning curves for the main panel (Red used to only appear on
// the separate CPU panel; here both models share the axes)
function dualCharts() {
  return [
    {
      id: "d-return",
      fullonly: true,
      title: "Episode return",
      legend: [
        [BLUE, "Blue"],
        [RED, "Red"],
      ],
      series: [
        { key: "retRed", color: RED },
        { key: "retBlue", color: BLUE },
      ],
      showValues: true,
      fmt: (v) => v.toFixed(1),
    },
    {
      id: "d-rate",
      title: "Win rate - recent",
      legend: [
        [BLUE, "Blue"],
        [RED, "Red"],
      ],
      series: [
        { key: "rateRed", color: RED },
        { key: "rateBlue", color: BLUE },
      ],
      min: 0,
      max: 1,
      showValues: true,
      fmt: (v) => Math.round(v * 100) + "%",
    },
    {
      id: "d-eps",
      fullonly: true,
      title: "Exploration ε",
      legend: [
        [BLUE, "Blue"],
        [RED, "Red"],
      ],
      series: [
        { key: "redEps", color: RED },
        { key: "eps", color: BLUE },
      ],
      min: 0,
      max: 1,
      showValues: true,
      fmt: (v) => v.toFixed(2),
    },
    {
      id: "d-len",
      fullonly: true,
      title: "Episode length",
      legend: [["#1f9d63", "steps"]],
      series: [{ key: "len", color: "#1f9d63" }],
      showValues: true,
      fmt: (v) => v.toFixed(0),
    },
    {
      id: "d-td",
      fullonly: true,
      title: "Learning signal - prediction gap / loss",
      legend: [
        [BLUE, "Blue"],
        [RED, "Red"],
      ],
      series: [
        { key: "tdRed", color: RED },
        { key: "tdBlue", color: BLUE },
      ],
      showValues: true,
      fmt: (v) => v.toFixed(3),
      note: "How large the current correction is: |G−Q| for Monte Carlo, TD target error for TD control, or network loss for DQN. It is usually large while estimates move quickly and shrinks as they settle.",
    },
  ];
}

export function initCurvesDual(parent) {
  const CH = dualCharts();
  // one card PER chart, so grouped chart views tile as uniform grid cells
  // (instead of one very tall stacked card). Only the win-rate card (d-rate) is
  // marked '.qk', so it's the single curve the docked quick view shows.
  parent.insertAdjacentHTML(
    "beforeend",
    CH.map(
      (c) =>
        `<section id="rl-curve-${c.id}"${c.id === "d-rate" ? ' class="qk"' : ""}>${chartBlock(c)}</section>`,
    ).join(""),
  );
  const charts = CH.map((c) =>
    makeChart(parent.querySelector(`#rl-ch-${c.id}`), c),
  );
  window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
  async function refresh() {
    try {
      const h = await (
        await fetch("/api/history", { cache: "no-store" })
      ).json();
      charts.forEach((c) => c.draw(h.points));
    } catch (e) {
      /* warming up */
    }
  }
  setInterval(refresh, 1000);
  refresh();
}

// outcome breakdown + action distribution + (DQN-only) function-approximation
// diagnostics. Live readouts come from the 'rl-snapshot' stats; the two DQN charts
// poll /api/history. The DQN card hides itself on non-DQN rounds.
export function initDiag(parent) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-outcomes">
      <h2>Outcome breakdown</h2>
      <div class="bar" style="margin-bottom:11px;"><i class="b" id="rl-oc-b"></i><i class="r" id="rl-oc-r"></i><i class="d" id="rl-oc-d"></i><i class="t" id="rl-oc-t"></i></div>
      <div class="stat"><span><i class="dot" style="background:#1f5fd0"></i>Blue wins</span><b id="rl-oc-bv">0</b></div>
      <div class="stat"><span><i class="dot" style="background:#e60012"></i>Red wins</span><b id="rl-oc-rv">0</b></div>
      <div class="stat"><span><i class="dot" style="background:#8b5cf6"></i>Draws</span><b id="rl-oc-dv">0</b></div>
      <div class="stat"><span><i class="dot" style="background:#8a8d94"></i>Timeouts</span><b id="rl-oc-tv">0</b></div>
    </section>
    <section id="rl-actdist">
      <h2>Action distribution</h2>
      <div id="rl-act-body" class="actlist"><p class="hint">Waiting for steps...</p></div>
    </section>
    <section id="rl-dqn" hidden>
      <h2>DQN diagnostics</h2>
      <div class="stat"><span>Replay buffer</span><b id="rl-dqn-buf">-</b></div>
      <div class="bar" style="margin:7px 0 11px;"><i class="b" id="rl-dqn-bufbar"></i></div>
      <div class="stat"><span>Train steps</span><b id="rl-dqn-ts">-</b></div>
      <div class="stat"><span>Target syncs</span><b id="rl-dqn-sync">-</b></div>
      <div class="stat"><span>Adam lr</span><b id="rl-dqn-lr">-</b></div>
      <div class="chart" style="margin-top:12px;"><div class="ct"><h3>Gradient norm (pre-clip)</h3><span class="lg"><i style="background:#1f5fd0"></i>Blue<i style="background:#e60012"></i>Red</span></div><canvas id="rl-ch-gnorm"></canvas></div>
      <div class="chart"><div class="ct"><h3>Predicted Q - overestimation</h3><span class="lg"><i style="background:#1f5fd0"></i>Blue<i style="background:#e60012"></i>Red</span></div><canvas id="rl-ch-predq"></canvas></div>
    </section>`,
  );
  const q = (s) => parent.querySelector(s);
  const dqnSec = q("#rl-dqn");
  const chGnorm = makeChart(q("#rl-ch-gnorm"), {
    series: [
      { key: "gnormRed", color: RED },
      { key: "gnormBlue", color: BLUE },
    ],
    fmt: (v) => v.toFixed(2),
  });
  const chPredQ = makeChart(q("#rl-ch-predq"), {
    series: [
      { key: "predQRed", color: RED },
      { key: "predQBlue", color: BLUE },
    ],
    fmt: (v) => v.toFixed(2),
  });
  window.addEventListener("resize", () => {
    chGnorm.resize();
    chPredQ.resize();
  });
  const pct = (x) => (100 * x).toFixed(1) + "%";

  window.addEventListener("rl-snapshot", (e) => {
    const s = e.detail && e.detail.stats;
    if (!s) return;
    const o = s.outcomes || {};
    const tot =
      (o.red || 0) + (o.blue || 0) + (o.draw || 0) + (o.timeout || 0) || 1;
    q("#rl-oc-r").style.width = pct((o.red || 0) / tot);
    q("#rl-oc-b").style.width = pct((o.blue || 0) / tot);
    q("#rl-oc-d").style.width = pct((o.draw || 0) / tot);
    q("#rl-oc-t").style.width = pct((o.timeout || 0) / tot);
    q("#rl-oc-rv").textContent = (o.red || 0).toLocaleString();
    q("#rl-oc-bv").textContent = (o.blue || 0).toLocaleString();
    q("#rl-oc-dv").textContent = (o.draw || 0).toLocaleString();
    q("#rl-oc-tv").textContent = (o.timeout || 0).toLocaleString();

    const ad = s.actionDist;
    if (ad && ad.labels) {
      const peach = s.round?.index === 0;
      const labels = peach ? ["N", "S", "W", "E"] : ad.labels;
      const order = peach ? [1, 0, 3, 2] : labels.map((_, i) => i);
      q("#rl-act-body").innerHTML = order
        .map(
          (i, displayIndex) =>
            `<div class="actrow"><span class="al">${labels[displayIndex]}</span>` +
            `<span class="ab"><i class="b" style="width:${pct(ad.blue[i] || 0)}"></i></span>` +
            `<span class="ab"><i class="r" style="width:${pct(ad.red[i] || 0)}"></i></span></div>`,
        )
        .join("");
    }

    const d = s.diag && s.diag.blue;
    if (d && d.isDQN) {
      dqnSec.hidden = false;
      q("#rl-dqn-buf").textContent =
        `${d.bufferSize.toLocaleString()} / ${d.bufferCap.toLocaleString()}${d.warmupDone ? "" : " - warming up"}`;
      q("#rl-dqn-bufbar").style.width = pct(d.bufferFill);
      q("#rl-dqn-ts").textContent = d.trainSteps.toLocaleString();
      q("#rl-dqn-sync").textContent =
        `${d.syncCount} - next in ${d.stepsToSync}`;
      q("#rl-dqn-lr").textContent = d.lr;
    } else {
      dqnSec.hidden = true;
    }
  });
  async function refresh() {
    if (dqnSec.hidden) return;
    try {
      const h = await (
        await fetch("/api/history", { cache: "no-store" })
      ).json();
      chGnorm.draw(h.points);
      chPredQ.draw(h.points);
    } catch (e) {
      /* warming up */
    }
  }
  setInterval(refresh, 1500);
  refresh();
}

// ---- BRIEFING: the round's MDP tuple, reward table + win condition ----
export function initBriefing(parent) {
  const html = `
    <section id="rl-brief">
      <h2>Briefing - the MDP</h2>
      <div id="rl-brief-body"><p class="hint">Loading round spec...</p></div>
    </section>`;
  const hdr = parent.querySelector(".hdr");
  if (hdr) hdr.insertAdjacentHTML("afterend", html);
  else parent.insertAdjacentHTML("beforeend", html);
  const body = parent.querySelector("#rl-brief-body");
  let lastSpecKey = "";
  const horizon = (g) => (g != null && g < 1 ? (1 / (1 - g)).toFixed(1) : "∞");
  // keep the live discount/horizon in sync with the training stream (params carry live γ)
  function updateLive(gb, gr) {
    const gEl = body.querySelector("#rl-brief-gamma");
    const hEl = body.querySelector("#rl-brief-horizon");
    if (gb == null) return;
    if (gEl) gEl.textContent = `${(+gb).toFixed(2)}  /  ${(+gr).toFixed(2)}`;
    if (hEl) hEl.textContent = `${horizon(gb)}  /  ${horizon(gr)} steps`;
  }
  async function refresh() {
    try {
      const s = await (await fetch("/api/mdp", { cache: "no-store" })).json();
      const specKey = JSON.stringify(s);
      if (specKey === lastSpecKey) return updateLive(s.gammaBlue, s.gammaRed);
      lastSpecKey = specKey;
      const rewards = (s.rewards || [])
        .map(
          ([k, v]) =>
            `<div class="stat"><span>${k}</span><b class="${v > 0 ? "rw-pos" : v < 0 ? "rw-neg" : ""}">${v > 0 ? "+" : ""}${v}</b></div>`,
        )
        .join("");
      let heroBig, heroUnit;
      if (s.stateSize) {
        heroBig = s.stateSize.toLocaleString();
        heroUnit = "states in S";
      } else {
        const m = (s.stateDesc || "").match(/(\d+)-vector/);
        heroBig = m ? m[1] + "-D" : "cont.";
        heroUnit = "continuous state";
      }
      const seq = (s.stateDesc || "").includes("9-vector");
      const obsTuple =
        s.observationTuple ||
        (s.objective === "cross"
          ? "(cell)"
          : s.objective === "race"
            ? "(cell, key, gold, opp-region, adjacent, trap)"
            : s.missileGame
              ? "(self + rival, missiles x3, effects, pickups x2)"
              : seq
              ? "(x, z, vx, vz, →cp x, →cp y, leg, →storm x, →storm y)"
              : "(x, z, vx, vz, →goal x, →goal y)");
      const sqCls = s.seesOpponent ? "yes" : "no";
      const sqLabel = s.seesOpponent ? "VISIBLE" : "HIDDEN";
      // a structured obs vector renders as a stacked bar + legend; otherwise fall back
      // to the plain sentence (grid rounds, simple race).
      const groups = s.stateGroups || null;
      const gTotal = groups ? groups.reduce((a, g) => a + g.dim, 0) || 1 : 1;
      const stateRow = groups
        ? `<div class="so-row"><span class="so-k">State (S) - ${gTotal} dimensions</span>` +
          `<div class="sv-bar">` +
          groups
            .map(
              (g) =>
                `<span class="sv-seg" style="width:${((g.dim / gTotal) * 100).toFixed(2)}%;background:${g.color}" title="${g.label}: ${g.dim} dims">${g.dim}</span>`,
            )
            .join("") +
          `</div>` +
          `<div class="sv-legend">` +
          groups
            .map(
              (g) =>
                `<div class="sv-item"><span class="sv-dot" style="background:${g.color}"></span>` +
                `<span class="sv-lab">${g.label}</span>` +
                `<span class="sv-dim">${g.count ? `${g.count}&times;${g.each}` : `&times;${g.dim}`}</span>` +
                `<span class="sv-det">${g.detail}</span></div>`,
            )
            .join("") +
          `</div></div>`
        : `<div class="so-row"><span class="so-k">State (S)</span><span class="so-v">${s.stateDesc}</span></div>`;
      body.innerHTML =
        `<div class="brief-matchup">${s.matchup}</div>` +
        `<p class="hint">${s.family}. ${s.winCondition}</p>` +

        `<h3 class="brief-sub">State &amp; observation</h3>` +
        `<div class="so-card">` +
        `<div class="so-hero"><div class="so-big">${heroBig}</div><div class="so-unit">${heroUnit}</div></div>` +
        stateRow +
        `<div class="so-row"><span class="so-k">Each model observes</span><span class="so-v">${s.observation}</span>` +
        `<span class="so-tuple">${obsTuple}</span></div>` +
        `<div class="so-row"><span class="so-k">Sees the opponent?</span>` +
        `<div class="so-opp"><span class="so-sq ${sqCls}"><b>RIVAL</b><b>${sqLabel}</b></span>` +
        `<span class="so-opp-txt">${s.opponentInfo}</span></div></div>` +
        `</div>` +

        `<h3 class="brief-sub">Actions</h3>` +
        `<div class="stat"><span>Actions (${s.nActions})</span><b>${s.actions.join(", ")}</b></div>` +

        `<h3 class="brief-sub">Transition dynamics</h3>` +
        (s.slipProb
          ? `<div class="stat"><span>Slip probability</span><b>${Math.round(100 * s.slipProb)}%</b></div>`
          : "") +
        `<div class="stat"><span>Max steps / episode</span><b>${s.maxSteps}</b></div>` +
        `<p class="note">${s.dynamics}</p>` +

        `<h3 class="brief-sub">Discount &amp; horizon</h3>` +
        `<div class="stat"><span>Discount γ - Blue / Red</span><b id="rl-brief-gamma">${(+s.gammaBlue).toFixed(2)}  /  ${(+s.gammaRed).toFixed(2)}</b></div>` +
        `<div class="stat"><span>Effective horizon - B / R</span><b id="rl-brief-horizon">${horizon(s.gammaBlue)}  /  ${horizon(s.gammaRed)} steps</b></div>` +
        `<p class="note">γ sets how much a future reward is worth versus an immediate one. The effective horizon &asymp; 1/(1-γ) is roughly how many steps ahead still sway a decision - a higher γ makes the agent more far-sighted.</p>` +

        `<h3 class="brief-sub">Reward structure</h3>${rewards}` +
        (s.rewardNote ? `<p class="note">${s.rewardNote}</p>` : "");
    } catch (e) {
      /* warming up */
    }
  }
  window.addEventListener("rl-snapshot", (e) => {
    const st = e.detail && e.detail.stats;
    if (!st) return;
    const gb = st.params && st.params.gamma,
      gr = st.redParams && st.redParams.gamma;
    if (gb != null) updateLive(gb, gr == null ? gb : gr);
    // World/dynamics edits keep the same round id, so the old implementation never
    // rebuilt the Challenge card. Refresh when the live parameter signature changes.
    const p = st.params || {};
    const worldKey = [st.round?.index, p.maxSteps, p.slipProb, p.blockGhostProb,
      p.ghostLen, p.freezeLen, p.coinReward, p.blockReward,
      p.r2SlipProb, p.r2TomatoReward].join("|");
    if (worldKey !== refresh.worldKey) {
      refresh.worldKey = worldKey;
      clearTimeout(refresh.timer);
      refresh.timer = setTimeout(refresh, 120);
    }
  });
  setInterval(refresh, 2000);
  refresh();
}

// small two-column (Red vs Blue) comparison table used by Head-to-head + Exploration
function cmpHead(rLabel, bLabel) {
  // Blue (the player's model) on the LEFT, Red on the right
  return `<div class="cmp-head"><span></span><span class="cb">${bLabel}</span><span class="cr">${rLabel}</span></div>`;
}
function cmpRow(label, r, b, lead) {
  return (
    `<div class="cmp-row"><span class="cl">${label}</span>` +
    `<b class="cb${lead === "b" ? " win" : ""}">${b}</b><b class="cr${lead === "r" ? " win" : ""}">${r}</b></div>`
  );
}
const lead = (r, b) => (r > b ? "r" : b > r ? "b" : "");

// ---- COMPARISON: head-to-head scoreboard (both models on shared rows) ----
export function initCompare(parent) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-compare"><h2>Head-to-head</h2><div id="rl-cmp"></div></section>`,
  );
  const el = parent.querySelector("#rl-cmp");
  window.addEventListener("rl-snapshot", (e) => {
    const s = e.detail && e.detail.stats;
    if (!s) return;
    const rr = s.recentRate || {},
      ret = s.lastReturn || {},
      q = s.qStates || {},
      sc = s.score || {},
      rstd = s.returnStd || {};
    const pct = (x) => (100 * (x || 0)).toFixed(0) + "%";
    el.innerHTML =
      cmpHead(
        s.round ? s.round.labelRed : "Red",
        s.round ? s.round.labelBlue : "Blue",
      ) +
      cmpRow(
        "Round win rate",
        pct(rr.red),
        pct(rr.blue),
        lead(rr.red || 0, rr.blue || 0),
      ) +
      cmpRow(
        "Tournament",
        sc.red || 0,
        sc.blue || 0,
        lead(sc.red || 0, sc.blue || 0),
      ) +
      cmpRow(
        "Last return",
        (ret.red || 0).toFixed(2),
        (ret.blue || 0).toFixed(2),
        lead(ret.red || 0, ret.blue || 0),
      ) +
      cmpRow(
        "Return σ (variance)",
        (rstd.red || 0).toFixed(2),
        (rstd.blue || 0).toFixed(2),
        "",
      ) +
      cmpRow(
        "Learned states",
        (q.red || 0).toLocaleString(),
        (q.blue || 0).toLocaleString(),
        "",
      );
  });
}

// ---- EXPLORATION: board coverage / entropy per side (grid rounds only) ----
export function initExplore(parent) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-explore" hidden><h2>Exploration</h2><div id="rl-exp-body"></div></section>`,
  );
  const sec = parent.querySelector("#rl-explore");
  const body = parent.querySelector("#rl-exp-body");
  async function refresh() {
    try {
      const [rb, bb] = await Promise.all([
        (await fetch("/api/vstats?agent=red", { cache: "no-store" })).json(),
        (await fetch("/api/vstats?agent=blue", { cache: "no-store" })).json(),
      ]);
      if (!bb.floor) {
        sec.hidden = true;
        return;
      } // arena round has no cells
      sec.hidden = false;
      body.innerHTML =
        cmpHead("Red", "Blue") +
        cmpRow(
          "Physical tile coverage",
          (100 * rb.coverage).toFixed(0) + "%",
          (100 * bb.coverage).toFixed(0) + "%",
          lead(rb.coverage, bb.coverage),
        ) +
        cmpRow(
          "Physical tiles visited",
          `${rb.unique}/${rb.floor}`,
          `${bb.unique}/${bb.floor}`,
          "",
        ) +
        cmpRow(
          "Visit entropy",
          rb.entropy.toFixed(2),
          bb.entropy.toFixed(2),
          lead(rb.entropy, bb.entropy),
        ) +
        cmpRow(
          "Most-stepped",
          rb.maxVisits.toLocaleString(),
          bb.maxVisits.toLocaleString(),
          "",
        );
    } catch (e) {
      /* warming up */
    }
  }
  setInterval(refresh, 2500);
  refresh();
}

// ---- DUELING value/advantage split (the Dueling-DQN alternate pick) ----
export function initDueling(parent) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-va" hidden>
      <h2>Dueling - value / advantage</h2>
      <p class="hint">Q(s,a) = V(s) + A(s,a). The net rates the STATE apart from each action's edge.</p>
      <div class="stat"><span>State value V(s)</span><b id="rl-va-v">-</b></div>
      <div id="rl-va-body" class="actlist" style="margin-top:8px;"></div>
    </section>`,
  );
  const sec = parent.querySelector("#rl-va");
  const vEl = parent.querySelector("#rl-va-v");
  const body = parent.querySelector("#rl-va-body");
  async function refresh() {
    try {
      const d = await (
        await fetch("/api/va?agent=blue", { cache: "no-store" })
      ).json();
      if (!d.available) {
        sec.hidden = true;
        return;
      } // only the Dueling side
      sec.hidden = false;
      vEl.textContent = d.v.toFixed(3);
      const a = d.a || [];
      const mx = Math.max(0.01, ...a.map((x) => Math.abs(x)));
      body.innerHTML = a
        .map((av, i) => {
          const w = ((100 * Math.abs(av)) / mx).toFixed(0);
          return (
            `<div class="actrow"><span class="al">${i === 8 ? "∅" : i}</span>` +
            `<span class="ab"><i class="${av >= 0 ? "b" : "r"}" style="width:${w}%"></i></span>` +
            `<b style="flex:none;width:50px;text-align:right;font-size:11px;color:#54565c;font-variant-numeric:tabular-nums">${av >= 0 ? "+" : ""}${av.toFixed(2)}</b></div>`
          );
        })
        .join("");
    } catch (e) {
      /* warming up */
    }
  }
  setInterval(refresh, 1500);
  refresh();
}

// ---- REWARD DECOMPOSITION: terminal payoff vs one-time collectible/other
// bonuses vs step-level cost (grid rounds; the env tracks the split) ----
export function initReward(parent) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-reward" hidden>
      <h2 style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">Reward decomposition<span id="rl-reward-avg" style="flex:none;font-weight:700;font-size:9.5px;letter-spacing:.2px;text-transform:none;color:#a2a5ac;"></span></h2>
      <div id="rl-reward-body"></div>
      <p class="hint" id="rl-reward-note">Average full-course reward, split by where it comes from. Terminal = the finish/death payoff. Bonuses = one-time collectible rewards. Other = the per-step time cost and miscellaneous rewards.</p>
    </section>`,
  );
  const sec = parent.querySelector("#rl-reward");
  const body = parent.querySelector("#rl-reward-body");
  const avgEl = parent.querySelector("#rl-reward-avg");
  const rows = (s, color, shapeLabel) => {
    const parts = [
      ["Terminal", "terminal", "#37b26a"],
      [shapeLabel || "Bonuses", "shape", "#7c4dd0"],
      ["Other", "other", "#8a8d94"],
    ];
    const tot = Math.max(
      0.01,
      Math.abs(s.terminal) + Math.abs(s.shape) + Math.abs(s.other),
    );
    return parts.map(([label, key, c]) => {
      const v = s[key],
        w = ((100 * Math.abs(v)) / tot).toFixed(0);
      return (
        `<div class="cmp-row"><span class="cl">${label}</span>` +
        `<span style="flex:1;height:8px;border-radius:4px;background:#eceef1;overflow:hidden;margin:0 10px"><i style="display:block;height:100%;width:${w}%;background:${c}"></i></span>` +
        `<b style="flex:none;width:52px;text-align:right;font-size:11.5px;color:${color};font-variant-numeric:tabular-nums">${v >= 0 ? "+" : ""}${v.toFixed(2)}</b></div>`
      );
    }).join("");
  };
  async function refresh() {
    try {
      const d = await (
        await fetch("/api/reward", { cache: "no-store" })
      ).json();
      if (!d.available) {
        sec.hidden = true;
        return;
      }
      sec.hidden = false;
      avgEl.textContent = `${d.episodes}-ep avg`;
      body.innerHTML =
        `<div class="brief-sub" style="color:#1f5fd0">Blue</div>` +
        rows(d.blue, "#1f5fd0", d.shapeLabel) +
        `<div class="brief-sub" style="color:#e60012;margin-top:12px">Red</div>` +
        rows(d.red, "#e60012", d.shapeLabel);
    } catch (e) {
      /* warming up */
    }
  }
  setInterval(refresh, 2500);
  refresh();
}

// ---- Q-evolution probe: V(spawn) over episodes (the start-state value climbing) ----
export function initProbe(parent) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-probe" hidden>
      <h2>Start-state value</h2>
      <div class="chart"><div class="ct"><h3>Value of start tile over episodes</h3><span class="lg"><i style="background:#1f5fd0"></i>Blue<i style="background:#e60012"></i>Red</span></div><canvas id="rl-ch-probe"></canvas></div>
    </section>`,
  );
  const sec = parent.querySelector("#rl-probe");
  const ch = makeChart(parent.querySelector("#rl-ch-probe"), {
    series: [
      { key: "redV", color: "#e60012" },
      { key: "blueV", color: "#1f5fd0" },
    ],
    showValues: true,
    fmt: (v) => v.toFixed(2),
  });
  window.addEventListener("resize", () => ch.resize());
  async function refresh() {
    try {
      const d = await (
        await fetch("/api/qprobe", { cache: "no-store" })
      ).json();
      if (!d.available || !d.points.length) {
        sec.hidden = true;
        return;
      }
      sec.hidden = false;
      ch.draw(d.points);
    } catch (e) {
      /* warming up */
    }
  }
  setInterval(refresh, 1500);
  refresh();
}

// ---- POLICY AGREEMENT: fraction of cells where Red's & Blue's greedy actions match ----
export function initPolicyDiff(parent) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-polagree" hidden>
      <h2>Policy agreement</h2>
      <div class="stat"><span id="rl-pa-label">Blue &amp; Red greedy match</span><b id="rl-pa-rate">-</b></div>
      <!-- neutral (black) fill, not the Blue-model .b class: this bar is about BOTH agents agreeing -->
      <div class="bar" style="margin-top:9px;"><i id="rl-pa-bar" style="background:#141518;"></i></div>
    </section>`,
  );
  const sec = parent.querySelector("#rl-polagree");
  const label = parent.querySelector("#rl-pa-label");
  const rate = parent.querySelector("#rl-pa-rate");
  const bar = parent.querySelector("#rl-pa-bar");
  async function refresh() {
    try {
      const d = await (
        await fetch("/api/polagree", { cache: "no-store" })
      ).json();
      if (!d.available) {
        sec.hidden = true;
        return;
      }
      sec.hidden = false;
      label.textContent = d.mirrored
        ? "Mirrored greedy-policy match"
        : "Blue & Red greedy match";
      rate.textContent = `${(100 * d.rate).toFixed(0)}%  (${d.agree}/${d.cells})`;
      bar.style.width = (100 * d.rate).toFixed(0) + "%";
    } catch (e) {
      /* warming up */
    }
  }
  setInterval(refresh, 2000);
  refresh();
}

// draw one agent's trajectory (list of [r,c] or [x,z]) as a polyline on a mini board
function drawPath(canvas, path, color) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth || 140,
    ch = canvas.clientHeight || 140;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!path || path.length < 2) return;
  let r0 = Infinity,
    r1 = -Infinity,
    c0 = Infinity,
    c1 = -Infinity;
  for (const [r, c] of path) {
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    if (c < c0) c0 = c;
    if (c > c1) c1 = c;
  }
  r0 -= 1;
  r1 += 1;
  c0 -= 1;
  c1 += 1;
  const s = Math.min(cw / (c1 - c0 || 1), ch / (r1 - r0 || 1));
  const X = (c) => (c - c0) * s + (cw - (c1 - c0) * s) / 2;
  const Y = (r) => (r - r0) * s + (ch - (r1 - r0) * s) / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  path.forEach(([r, c], i) => {
    const x = X(c),
      y = Y(r);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  const st = path[0],
    en = path[path.length - 1];
  ctx.fillStyle = "#8a8d94";
  ctx.beginPath();
  ctx.arc(X(st[1]), Y(st[0]), 3.5, 0, 7);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(X(en[1]), Y(en[0]), 4.5, 0, 7);
  ctx.fill();
}

// ---- SIDE-BY-SIDE: each model's fastest winning route, drawn as a mini trajectory ----
export function initTrajectories(parent) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-traj" hidden>
      <h2>Best runs - side by side</h2>
      <div style="display:flex;gap:12px;">
        <div style="flex:1;"><div class="brief-sub" style="color:#1f5fd0;margin:0 0 5px;">Blue</div><canvas id="rl-traj-b" style="width:100%;aspect-ratio:1/1;background:#f0f1f3;border-radius:9px;display:block;"></canvas></div>
        <div style="flex:1;"><div class="brief-sub" style="color:#e60012;margin:0 0 5px;">Red</div><canvas id="rl-traj-r" style="width:100%;aspect-ratio:1/1;background:#f0f1f3;border-radius:9px;display:block;"></canvas></div>
      </div>
    </section>`,
  );
  const sec = parent.querySelector("#rl-traj");
  const cr = parent.querySelector("#rl-traj-r"),
    cb = parent.querySelector("#rl-traj-b");
  async function loadPath(agent) {
    try {
      const r = await (
        await fetch(`/api/replay?which=top&agent=${agent}&rank=0`, {
          cache: "no-store",
        })
      ).json();
      if (!r.available || !r.frames) return null;
      return r.frames
        .map((f) => f[agent])
        .filter((p) => Array.isArray(p) && p.length >= 2);
    } catch (e) {
      return null;
    }
  }
  let lastPr = null,
    lastPb = null;
  // redraw the STORED paths (no fetch) - only meaningful once the canvas has its
  // real on-screen size. Drawing while the tab is hidden (clientWidth 0 -> the 140
  // fallback) rendered a small canvas the browser then scaled UP = thick lines that
  // only "snapped" right on the next 5s fetch; redrawing on resize fixes it instantly.
  function redraw() {
    if (cr.clientWidth) drawPath(cr, lastPr, "#e60012");
    if (cb.clientWidth) drawPath(cb, lastPb, "#1f5fd0");
  }
  async function refresh() {
    const [pr, pb] = await Promise.all([loadPath("red"), loadPath("blue")]);
    if ((!pr || !pr.length) && (!pb || !pb.length)) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    lastPr = pr;
    lastPb = pb;
    redraw();
  }
  window.addEventListener("resize", redraw);
  // redraw the moment the canvas gets a real size (e.g. switching to the Replays tab)
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => redraw());
    ro.observe(cr);
    ro.observe(cb);
  }
  setInterval(refresh, 5000);
  refresh();
}

export function initGraphs(parent) {
  initBriefing(parent); // MDP tuple + reward table (near the top)
  initCurvesDual(parent); // dual Red-vs-Blue curves + learning signal
  initProbe(parent); // start-state value over episodes
  initDP(parent); // DP convergence (Round 1)
  initDiag(parent); // outcome breakdown + action distribution + DQN diagnostics
  initCompare(parent); // head-to-head scoreboard
  initPolicyDiff(parent); // policy-agreement (VI vs PI converge to the same policy)
  initReward(parent); // reward decomposition (grid rounds)
  initExplore(parent); // board coverage / entropy (grid rounds)
  initDueling(parent); // dueling V/A split (Round 5)
  initReplay(parent); // top-30 replay browser
  initTrajectories(parent); // side-by-side best-run trajectories
}
