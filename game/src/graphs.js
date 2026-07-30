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
  // player-facing UP even though it corresponds to increasing matrix rows.
  ctx.fillText("Up", cw / 2, Math.max(10, oy - 8));
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
        <button data-a="milestones" aria-pressed="false">Milestones</button>
      </div>
      <div id="rl-rep-list" class="replist" role="region" aria-label="Top episode replays"></div>
      <div id="rl-rep-detail" class="repdetail" role="region" aria-label="Selected replay details" hidden></div>
    </section>`,
  );
  const $ = (id) => parent.querySelector(id);
  const seg = $("#rl-rep-model");
  const listEl = $("#rl-rep-list");
  const detailEl = $("#rl-rep-detail");
  let model = "blue"; // "blue" | "red" | "milestones"  (default: your own model, on the left)
  let selEpisode = null; // immutable replay identity; rank changes as training runs
  let selKey = null;     // milestone rows are identified by their event key, not episode
  let listRequest = 0;
  let replayRequest = 0;
  // The list re-pulls every 4 s and used to rewrite every row button each time, even
  // when nothing changed. A rebuild that lands between a mousedown and a mouseup
  // detaches the pressed row, and the browser then fires no click at all - the pick
  // was silently lost. Compare against the last html WE generated (not the DOM's
  // serialization, which differs in quoting) and only touch the DOM on a real change.
  let listHTML = null;
  const setList = (html) => {
    if (html === listHTML) return;
    listHTML = html;
    listEl.innerHTML = html;
  };

  const signed = (v) => (v >= 0 ? "+" : "") + Number(v).toFixed(2);

  function clearDetail() {
    detailEl.hidden = true;
    detailEl.innerHTML = "";
  }
  // Show EVERYTHING recorded for the picked run: its return (total reward) and the
  // terminal / shaping / step-cost split, the exploration ε it acted under, and how
  // the head-to-head went - not just the length in the list row.
  function renderDetail(r) {
    if (r.agent === "milestones") {
      const who = r.winner === "red" ? "Red" : "Blue";
      const s = r.stats || null;
      const rows = [
        ["Milestone", r.label || "-"],
        ["Model", who],
        ["Episode", (r.episode || 0).toLocaleString()],
        ["Steps", `${r.steps}`],
      ];
      if (s) {
        if (Number.isFinite(s.return))
          rows.push(["Return (total reward)", signed(s.return)]);
        if (Number.isFinite(s.epsilon))
          rows.push(["Exploration ε", s.epsilon.toFixed(2)]);
      }
      detailEl.innerHTML = rows
        .map(
          ([k, v]) =>
            `<div class="rd-row"><span class="rd-k">${k}</span><b class="rd-v">${v}</b></div>`,
        )
        .join("");
      detailEl.hidden = false;
      return;
    }
    const who = r.agent === "red" ? "Red" : "Blue";
    const s = r.stats || null;
    const rows = [
      ["Run", `${who} #${(r.rank ?? 0) + 1}`],
      ["Episode", (r.episode || 0).toLocaleString()],
      [r.metric === "longest" ? "Survived" : "Steps", `${r.steps}`],
    ];
    if (s) {
      if (Number.isFinite(s.return))
        rows.push(["Return (total reward)", signed(s.return)]);
      if (s.parts) {
        rows.push(["&nbsp;&nbsp;· Win / loss", signed(s.parts.terminal)]);
        rows.push(["&nbsp;&nbsp;· Shaping (pickups)", signed(s.parts.shape)]);
        rows.push(["&nbsp;&nbsp;· Step cost", signed(s.parts.other)]);
      }
      if (Number.isFinite(s.epsilon))
        rows.push(["Exploration ε", s.epsilon.toFixed(2)]);
      if (s.outcome) {
        const label =
          s.outcome === "win" ? "Won the race"
          : s.outcome === "lose" ? "Rival finished first"
          : s.truncated ? "Rival timed out" : "Draw";
        rows.push(["Head-to-head", label]);
      }
    }
    detailEl.innerHTML = rows
      .map(
        ([k, v]) =>
          `<div class="rd-row"><span class="rd-k">${k}</span><b class="rd-v">${v}</b></div>`,
      )
      .join("");
    detailEl.hidden = false;
  }

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
        setList(`<div class="empty">${
          requestedModel === "milestones"
            ? "No milestones reached yet - keep training."
            : `No winning runs yet for ${requestedModel === "red" ? "Red" : "Blue"}.`
        }</div>`);
        return;
      }
      if (requestedModel === "milestones") {
        // one row per notable FIRST (mixed models), newest-first is the natural
        // append order; show the event label + an agent-coloured dot.
        setList(items
          .map(
            (it) =>
              `<button type="button" class="rrow ms${it.key === selKey ? " sel" : ""}" ` +
              `data-rank="${it.rank}" data-episode="${it.episode}" data-key="${it.key}" ` +
              `aria-label="${it.label}, ${it.steps} steps, episode ${it.episode}">` +
              `<span class="mdot ${it.milestoneAgent === "red" ? "red" : "blue"}"></span>` +
              `<span class="ml">${it.label}</span>` +
              `<span class="ep">ep ${(it.episode || 0).toLocaleString()}</span></button>`,
          )
          .join(""));
        return;
      }
      setList(items
        .map(
          (it) =>
            `<button type="button" class="rrow${it.episode === selEpisode ? " sel" : ""}" ` +
            `data-rank="${it.rank}" data-episode="${it.episode}" ` +
            `aria-label="Replay rank ${it.rank + 1}, ${it.steps} steps, episode ${it.episode}">` +
            `<span class="rk">#${it.rank + 1}</span>` +
            `<span class="st">${it.steps} steps</span>` +
            (Number.isFinite(it.return)
              ? `<span class="rt">R ${signed(it.return)}</span>`
              : "") +
            `<span class="ep">ep ${(it.episode || 0).toLocaleString()}</span></button>`,
        )
        .join(""));
    } catch (e) {
      if (request !== listRequest || requestedModel !== model) return;
      setList('<div class="empty">List fetch failed.</div>');
    }
  }

  async function loadTop(rank, episode, key) {
    const requestedModel = model;
    const isMs = requestedModel === "milestones";
    const request = ++replayRequest;
    // Cancel an older replay load immediately, rather than waiting for this
    // request to cross both the fetch and replayEnter pause boundary.
    const loadGeneration = window.RL?.replay?.reserveLoad?.();
    try {
      const url = isMs
        ? `/api/replay?which=top&agent=milestones&rank=${rank}`
        : `/api/replay?which=top&agent=${requestedModel}&rank=${rank}&episode=${episode}`;
      const r = await (await fetch(url, { cache: "no-store" })).json();
      if (request !== replayRequest || requestedModel !== model) return;
      if (!r.available) {
        refreshList(); // rolled out of the list - refresh
        return;
      }
      // hand the frames to the shared player; pass the model so the Playback scrubber
      // matches. A milestone carries its OWN model (r.winner: red for a Red event).
      const eps = r.replayFields?.epsilon;
      const replayModel = isMs
        ? (r.winner === "red" ? "red" : "blue")
        : (r.agent === "red" ? "red" : requestedModel);
      const label = isMs
        ? `${r.label}${Number.isFinite(r.stats?.epsilon) ? ` · ε ${r.stats.epsilon.toFixed(2)}` : ""}`
        : `${replayModel === "red" ? "Red" : "Blue"} #${r.rank + 1} - ${r.steps} steps` +
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
      // Choosing a replay starts it playing right away at the fixed watchable pace
      // (the Playback bar's on-entry hook sets REPLAY_VIEW_FPS = 5/s).
      window.RL?.replay?.play?.();
      selEpisode = r.episode ?? episode;
      selKey = isMs ? (r.key ?? key ?? null) : null;
      renderDetail(r);
      [...listEl.children].forEach((el) =>
        el.classList.toggle(
          "sel",
          isMs ? el.dataset.key === selKey : +el.dataset.episode === selEpisode,
        ),
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
    selKey = null;
    clearDetail();
    refreshList();
  });
  listEl.addEventListener("click", (e) => {
    const row = e.target.closest(".rrow");
    if (!row) return;
    loadTop(+row.dataset.rank, +row.dataset.episode, row.dataset.key);
  });
  // when the panel exits replay (Back to live / arena change), drop the highlight
  // AND re-pull the list: an arena change wipes the backend's per-round top-30, so the
  // browser must refresh immediately instead of showing the previous round's stale rows.
  window.addEventListener("rl-replay-state", (e) => {
    if (!e.detail?.active) {
      if (selEpisode !== null || selKey !== null) {
        selEpisode = null;
        selKey = null;
        [...listEl.children].forEach((el) => el.classList.remove("sel"));
      }
      clearDetail();
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
      const labels = peach ? ["Up", "Down", "Left", "Right"] : ad.labels;
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

// A complete, self-contained explanation of every algorithm, keyed by its display
// label (the backend's ALGO_LABELS). Written for someone who has never seen RL:
//   fam  = the family it belongs to           cat  = the big category chip (Tabular / Deep / Planning)
//   tags = classification chips (model-free? on/off-policy? when it learns?)
//   is   = one-line "what it is"               how  = the real mechanism, from scratch
//   key  = the single defining idea to remember
const ALGO_INFO = {
  "Value Iteration": { fam: "Dynamic Programming", cat: "Planning", tags: ["Knows the rules", "Uses a table", "No exploration"],
    is: "A planner that computes the perfect policy from a fully known map, without ever playing a game.",
    how: "It keeps one number (a VALUE) for every state, meaning 'how much total reward can I still collect from here'. Then it sweeps over all states again and again. On each sweep it sets a state's value to: the best move's immediate reward, plus the discounted value of wherever that move leads. Each pass makes the numbers more accurate; when a sweep barely changes anything, they have converged, and the best move in any state is simply the one pointing to the highest-valued neighbour.",
    key: "Because it already knows the world's rules, it never has to try things - it solves the maze by pure calculation. That is Dynamic Programming." },
  "Policy Iteration": { fam: "Dynamic Programming", cat: "Planning", tags: ["Knows the rules", "Uses a table", "No exploration"],
    is: "Another planner for a known map that repeatedly EVALUATES a plan and then IMPROVES it.",
    how: "Start with any policy (any set of moves). Step 1, EVALUATION: work out the value of every state assuming you follow that exact policy, by sweeping until the numbers settle. Step 2, IMPROVEMENT: at every state, switch to whichever move now looks best given those values. Repeat. The policy can only get better each round, and when a round changes nothing, it is provably optimal.",
    key: "Fewer big rounds than Value Iteration, but each round does a full evaluation before improving." },
  "Every-visit MC": { fam: "Monte Carlo (MC)", cat: "Tabular", tags: ["Model-free", "On-policy", "Learns from full games"],
    is: "Learns the value of each move purely by playing whole games and averaging what really happened - no map of the world needed.",
    how: "It stores a Q-VALUE (expected total reward) for every state-and-move, in a big table. It plays an entire episode to the end, recording every state-move it took and the rewards. Then it looks back and computes the RETURN (the actual total reward that followed) from each step, and nudges that move's Q-value toward the return it just saw. Over thousands of games each Q-value becomes the AVERAGE real return, which is the truth. 'Every-visit' means every time a square was entered in a game contributes to the average.",
    key: "Monte Carlo = learn by AVERAGING the real outcomes of many complete playthroughs. It is model-free (learns by trial, no rules given) and can only learn once a game finishes." },
  "First-visit MC": { fam: "Monte Carlo (MC)", cat: "Tabular", tags: ["Model-free", "On-policy", "Learns from full games"],
    is: "The Monte Carlo method (learn by averaging real game outcomes), but each square counts only the FIRST time it was entered in a game.",
    how: "Like every-visit Monte Carlo, it plays a full episode, then averages the RETURNS (actual total reward that followed) into a Q-value table. The only difference: within a single game it uses just the FIRST visit to each state-move. If a path loops back through a square, that square is not counted twice, which removes a bias and lowers the noise in the averages.",
    key: "A cleaner statistical estimate than every-visit, using slightly less of each game. Still tabular and model-free: it learns only from finished games." },
  "SARSA": { fam: "Temporal Difference (TD)", cat: "Tabular", tags: ["Model-free", "On-policy", "Learns every step"],
    is: "Learns Q-values one step at a time, from the move it actually takes next.",
    how: "After every single move it makes a small update: nudge Q(state, move) toward [reward now + discounted Q(next state, the move it ACTUALLY chose next)]. Notice it does not wait for the game to end - it BOOTSTRAPS, using its own current estimate of the next step as a stand-in for the whole future. Because it learns from its own next move (which is sometimes a random exploration), it accounts for its own mistakes and plays safer near danger.",
    key: "On-policy Temporal Difference: it learns the value of the policy it is actually following. The name is literally the tuple it uses - State, Action, Reward, next State, next Action." },
  "Q-Learning": { fam: "Temporal Difference (TD)", cat: "Tabular", tags: ["Model-free", "Off-policy", "Learns every step"],
    is: "Learns Q-values one step at a time, always assuming the BEST possible next move.",
    how: "After every move it updates: nudge Q(state, move) toward [reward now + discounted MAX over next moves of Q(next state, .)] - the value of the best next move, even if it did not take it. Like SARSA it bootstraps (learns each step from its own estimate rather than waiting for the end), but its target always aims at optimal future play.",
    key: "Off-policy Temporal Difference: it learns the OPTIMAL policy while still exploring randomly. It reaches the best route faster than SARSA, but can be bolder near danger because it assumes best-case play." },
  "Expected-SARSA": { fam: "Temporal Difference (TD)", cat: "Tabular", tags: ["Model-free", "Learns every step"],
    is: "A steadier SARSA that aims at the AVERAGE next move instead of the single one it happened to take.",
    how: "Same one-step bootstrapped update as SARSA, but the target uses the EXPECTED next Q-value: the average of all next moves' Q-values, weighted by how likely the policy is to pick each. Averaging cancels the randomness of which exploratory move came next, so every update is less noisy.",
    key: "Sits between SARSA and Q-Learning: smoother, often more stable learning." },
  "DQN": { fam: "Deep value learning", cat: "Deep (neural net)", tags: ["Model-free", "Off-policy", "Learns every step"],
    is: "Q-Learning for when there are far too many states to fit in a table, so a NEURAL NETWORK estimates the Q-values instead.",
    how: "This arena has endless possible states (continuous positions), so no table fits. A neural network takes the observation numbers in and outputs a Q-value for each move. It trains toward the same Q-Learning target (reward + best next Q), but two tricks are needed to keep a network stable: a REPLAY BUFFER stores past experiences and trains on random batches of them, so it is not thrown off by the latest few correlated moves; and a TARGET NETWORK, a slow-updating copy, computes the learning target so the network is not chasing its own constantly-shifting output.",
    key: "Deep Q-Network = Q-Learning + a neural network + replay buffer + target network. This is what first made RL work on huge, continuous problems." },
  "Double-DQN": { fam: "Deep value learning", cat: "Deep (neural net)", tags: ["Model-free", "Off-policy", "Learns every step"],
    is: "DQN fixed so it stops over-estimating how good its moves are.",
    how: "Plain DQN uses one network both to PICK the best next move and to SCORE it, so any lucky over-estimate feeds back on itself and inflates the values. Double-DQN splits those two jobs: the main network picks the best next move, and the separate target network scores that move. Decoupling them cancels most of the optimistic bias, giving more accurate values and steadier learning.",
    key: "Everything in DQN, with one small change to the learning target: less overconfidence." },
  "Dueling-DQN": { fam: "Deep value learning", cat: "Deep (neural net)", tags: ["Model-free", "Off-policy", "Learns every step"],
    is: "A DQN whose network separately estimates 'how good is this state' and 'how much does each move matter'.",
    how: "Before its final layer the network splits into two streams: a VALUE stream (how good is this state overall) and an ADVANTAGE stream (how much better or worse each move is than average, right here). They recombine into the Q-values. In states where the move barely matters, it can still learn the state is good or bad without having to pin down every move's exact value.",
    key: "A smarter network shape for DQN, especially helpful when many moves lead to similar outcomes." },
  "REINFORCE": { fam: "Policy Gradient", cat: "Deep (neural net)", tags: ["Model-free", "On-policy", "Learns from full games"],
    is: "Learns the POLICY directly - a network that outputs action probabilities - instead of learning values at all.",
    how: "The network outputs a probability for each move. It plays a full game, sees the total reward, then adjusts the network so moves taken in a HIGH-reward game become more likely and moves in a low-reward game become less likely. That adjustment direction is the 'policy gradient'. Repeat over many games and the good behaviours get reinforced.",
    key: "The simplest policy-gradient method: it optimises behaviour directly. Direct but noisy, because a whole game's reward is blamed or credited to every move in it." },
  "Actor-Critic": { fam: "Policy Gradient", cat: "Deep (neural net)", tags: ["Model-free", "Learns every step"],
    is: "Two networks working together: an ACTOR that chooses moves, and a CRITIC that judges how good the situation is.",
    how: "The ACTOR is the policy (it outputs move probabilities). The CRITIC learns the VALUE of states, just like the value methods above. After each step the critic reports whether the outcome was better or worse than it expected (the 'advantage'), and the actor uses that signal to push the move's probability up or down. Because the critic gives feedback every single step, the actor learns far more smoothly than REINFORCE, which must wait for the whole game.",
    key: "Actor acts, critic critiques. It fuses policy gradients with a learned value to cut the noise." },
  "PPO": { fam: "Policy Gradient", cat: "Deep (neural net)", tags: ["Model-free", "On-policy", "Learns every step"],
    is: "A modern, very stable Actor-Critic - the default algorithm in most of today's real-world RL.",
    how: "It is an Actor-Critic with one crucial safety trick: CLIPPING. Each update is only allowed to change the policy's move probabilities by a small, capped amount, so one unlucky batch of experience can never lurch the policy into something terrible. It also reuses each batch of collected experience for several optimisation passes, which makes it efficient with data.",
    key: "Proximal Policy Optimisation: stable because it only takes small, safe steps. Reliable and sample-efficient, the workhorse of modern deep RL." },
};

// A one-time primer of the words every algorithm above uses, shown atop the Algorithm tab.
const RL_PRIMER = [
  ["State", "the situation the agent is in (here: which square, and what it is carrying)."],
  ["Action", "a move it can make."],
  ["Reward", "the points it gets right after a move (for example +1 for reaching the goal)."],
  ["Return", "the TOTAL reward from now until the game ends - what it really wants to maximise."],
  ["Value / Q-value", "how much return a state (Value) or a state-plus-move (Q-value) is expected to give. Learning good values means knowing which moves are good."],
  ["Policy", "the agent's rule for which move to pick in each state - the thing it is ultimately learning."],
  ["Discount &gamma;", "how much a future reward counts versus an immediate one (near 1 = plans far ahead)."],
];

// Small inline icons for the Items / Enemies cards (kept simple + recognizable).
const BICONS = {
  coin: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6" fill="#fff" fill-opacity=".35"/><rect x="10.7" y="7.5" width="2.6" height="9" rx="1.3" fill="#fff" fill-opacity=".8"/></svg>',
  block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9 9.5a3 3 0 1 1 3.6 2.94c-.6.15-.6.56-.6 1.06"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 14.9 8.6 21.5 9.5l-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9z"/></svg>',
  tomato: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14.5" r="7" fill="currentColor" fill-opacity=".18"/><path d="M12 7.5V5"/><path d="M12 7.5C10.5 6 8.8 5.6 7.2 6.1c.3 1.6 1.5 2.8 3.1 3.2M12 7.5c1.5-1.5 3.2-1.9 4.8-1.4-.3 1.6-1.5 2.8-3.1 3.2"/></svg>',
  cage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M5 20V9a7 7 0 0 1 14 0v11"/><path d="M9 20V9M15 20V9M12 20V4.2"/></svg>',
  plant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-6"/><path d="M8 8a4 4 0 0 1 8 0v1.5a4 4 0 0 1-8 0z"/><path d="M8.5 8.6 7 7.4M15.5 8.6 17 7.4M8.5 9.6 7 10.4M15.5 9.6 17 10.4"/><path d="M12 16c-3 0-4-2-4-2M12 16c3 0 4-2 4-2"/></svg>',
  spike: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 20 8 8l4 12zM12 20 16 8l4 12z" fill-opacity=".85"/><rect x="2" y="20" width="20" height="2" rx="1"/></svg>',
  pipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="18" height="4" rx="1"/><rect x="6" y="10" width="12" height="11" rx="1"/></svg>',
  goomba: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 0 1 17 0z"/><path d="M5 12c0 3.5 3 6 7 6s7-2.5 7-6"/><path d="M9 11.5 10.6 13M9 13l1.6-1.5M15 11.5 13.4 13M15 13l-1.6-1.5"/><path d="M9 17h6"/></svg>',
  bill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4M2 9l2 3-2 3"/><path d="M15 6a7 7 0 0 1 0 12H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><circle cx="10" cy="10" r="1" fill="currentColor"/><circle cx="10" cy="14" r="1" fill="currentColor"/></svg>',
  cannon: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="13" r="8"/><path d="M13 5.5 15.5 3l1.5 1.5-2.4 2.6z" /><circle cx="9.5" cy="10.5" r="2" fill="#fff" fill-opacity=".4"/></svg>',
  water: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4h11l-2.5 3.5L17 11H6" fill="currentColor" fill-opacity=".18"/></svg>',
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="1"/><circle cx="14.5" cy="12" r="1" fill="currentColor"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21 4.3 13.3a5 5 0 0 1 7.1-7 .8.8 0 0 0 1.1 0 5 5 0 0 1 7.1 7z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4a3.5 3.5 0 0 0-3.5 3.5 3 3 0 0 0-1 5.7V16a3 3 0 0 0 4.5 2.6 3 3 0 0 0 4.5-2.6v-2.8a3 3 0 0 0-1-5.7A3.5 3.5 0 0 0 12 4z"/><path d="M12 4v14.6"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v4a4 4 0 0 1-8 0z"/><path d="M8 5H5v1a3 3 0 0 0 3 3M16 5h3v1a3 3 0 0 1-3 3"/><path d="M12 12v3M9 20h6M10 20l.4-3.2h3.2L14 20"/></svg>',
  crate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 8.5h17M3.5 15.5h17M8.5 3.5v17M15.5 3.5v17"/></svg>',
};

// Per-round Items (collectibles) and Enemies/hazards, as visual cards. R4 uses the
// spec's `pickups` and R5 uses the spec's `weapons` (real art), so those rounds add
// only their objective item here. tone: good = seek, bad = avoid, info = neutral.
const BESTIARY = {
  1: {
    items: [
      { ic: "coin", tone: "good", name: "Coin", desc: "A small one-time reward for grabbing your own coin along the way." },
      { ic: "block", tone: "info", name: "Mystery Block", desc: "Hitting one randomly grants Ghost (walk through walls for a few tiles) OR Freeze (lose a few turns stuck)." },
    ],
    foes: [
      { ic: "water", tone: "bad", name: "Ice Puddle", desc: "Stepping off an icy tile can skid you sideways instead of where you aimed. Pure chance, so plan around it." },
    ],
  },
  2: {
    items: [
      { ic: "tomato", tone: "good", name: "Tomato", desc: "Three of them are spread across the park, and each pays a one-time bonus the first time you take it. Every racer has its own mirror set." },
      { ic: "star", tone: "good", name: "Shine", desc: "The goal at the end of the park. It stays LOCKED until you hold all three tomatoes - only then does reaching it win the race." },
    ],
    foes: [
      { ic: "plant", tone: "bad", name: "Piranha Plant", desc: "Its zone is instant death: wander into the tiles around a plant and you are out of the race until the next episode." },
      { ic: "pipe", tone: "info", name: "Warp Pipe", desc: "Diving into a pipe teleports you across the board - a shortcut you must learn to use." },
      { ic: "water", tone: "bad", name: "Puddle", desc: "A move made while standing on a puddle can skid sideways. Adds risk to tight paths." },
    ],
  },
  3: {
    items: [
      { ic: "cage", tone: "good", name: "Cage", desc: "Grab it WHILE BEHIND to drop a cage on the rival, freezing them so you can catch up. Grabbing while ahead does nothing." },
      { ic: "door", tone: "info", name: "Secret Door", desc: "Push the boulder onto the pressure plate to hold a shortcut door open." },
    ],
    foes: [
      { ic: "goomba", tone: "bad", name: "Goomba", desc: "Patrols a fixed route back and forth. Touching one is death, so time your crossing." },
      { ic: "water", tone: "bad", name: "Wet Cell", desc: "A move from a wet tile can skid sideways. This is the variance that lets one racer fall behind (and the cage catch up)." },
    ],
  },
  4: {
    items: [],  // uses the spec's four power-ups (Speed / Shield / Slow / Freeze)
    foes: [
      { ic: "bill", tone: "bad", name: "Banzai Bill", desc: "A giant homing missile that hunts you and explodes on contact. A hit costs one heart; more of them spawn the longer you survive." },
    ],
  },
  5: {
    items: [
      { ic: "flag", tone: "good", name: "The Flag", desc: "Grab the flag from the centre and carry it to your base to score. First to the capture target wins." },
    ],  // plus the spec's crate weapons, rendered below
    foes: [
      { ic: "cannon", tone: "bad", name: "Bowser's Airship", desc: "Circles overhead and rains cannonballs onto the board. Dodge the incoming shots while you fight for the flag." },
    ],
  },
};

// Per-round STORY: a distilled goal line + a short illustrated "how it works" beat list,
// shown ALWAYS (not hidden) so the Game tab reads like a quick storyboard of the round.
const STORY = {
  1: { goal: "Race your rival through the castle maze - first one to the goal wins.",
    beats: [
      ["target", "Two racers start apart and sprint for the same goal square."],
      ["coin", "Coins picked up along the way give a small reward bonus."],
      ["block", "Mystery Blocks are a gamble: phase through walls for a bit, or freeze for a few turns."],
      ["water", "Ice puddles are slippery - a move can skid you sideways."],
      ["brain", "The two planners already KNOW the maze, so they solve it by pure calculation."],
    ] },
  2: { goal: "Collect all 3 tomatoes, then reach the goal first.",
    beats: [
      ["tomato", "Three tomatoes are spread across the city park - grab them all."],
      ["plant", "A Piranha Plant's zone is instant death: one wrong step and you are out for the round."],
      ["pipe", "Warp Pipes teleport you across the board - learn which shortcut to take."],
      ["water", "Puddles can skid your move off course."],
      ["brain", "The two learners have NO map - they figure it all out by playing thousands of full games."],
    ] },
  3: { goal: "Escape the fossil maze first.",
    beats: [
      ["target", "Both racers spawn in the bottom corners and race for the exit at the top."],
      ["goomba", "Goombas patrol fixed routes back and forth - touching one is death."],
      ["cage", "Falling behind? Grab the Cage to freeze your rival and catch up."],
      ["door", "Push a boulder onto a pressure plate to open a secret shortcut door."],
      ["water", "Wet tiles are slippery - the variance that lets one racer fall behind."],
    ] },
  4: { goal: "Survive the missile storm - the last one standing wins.",
    beats: [
      ["bill", "Banzai Bills relentlessly home in on you and explode on contact."],
      ["heart", "Each hit costs one of your 3 hearts. Lose them all and you are out."],
      ["bolt", "Grab Speed and Shield power-ups; avoid the Slow and Freeze ones."],
      ["trend", "The longer you last, the more Bills spawn - it never stops getting harder."],
      ["brain", "The neural-network learners get better at dodging the more they play."],
    ] },
  5: { goal: "Capture the flag - first to the target number of captures wins.",
    beats: [
      ["flag", "Grab the flag from the centre and carry it back to your base to score."],
      ["target", "Tag the carrier to instantly steal the flag back."],
      ["crate", "Smash crates for Mario-Kart weapons: shells, bananas, oil, a Chain Chomp."],
      ["cannon", "Bowser's airship rains cannonballs on the board - dodge while you fight."],
      ["brain", "The policy-gradient learners refine their whole strategy, getting sharper each game."],
    ] },
};

// ---- BRIEFING: the round's MDP tuple, reward table + win condition ----
export function initBriefing(parent) {
  const html = `
    <section id="rl-brief">
      <div id="rl-brief-body"><p class="hint">Loading round spec...</p></div>
    </section>`;
  const hdr = parent.querySelector(".hdr");
  if (hdr) hdr.insertAdjacentHTML("afterend", html);
  else parent.insertAdjacentHTML("beforeend", html);
  const body = parent.querySelector("#rl-brief-body");
  let lastSpecKey = "";
  let activeSub = "game";  // which sub-tab is open inside the Challenge card (persists across rebuilds)
  // sub-tab switching, delegated once so it survives every innerHTML rebuild
  body.addEventListener("click", (e) => {
    const chip = e.target.closest(".bsub-chip");
    if (!chip) return;
    activeSub = chip.dataset.sub;
    body.querySelectorAll(".bsub-chip").forEach((c) => c.classList.toggle("on", c.dataset.sub === activeSub));
    body.querySelectorAll(".bsub-panel").forEach((p) => p.classList.toggle("on", p.dataset.sub === activeSub));
  });
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
      // ---- REWARDS: signed proportional bars (green = gain, red = cost);
      // string-valued rewards (e.g. "+0.2 / second") show as text with no bar.
      const rvals = s.rewards || [];
      const maxMag = Math.max(
        0.001,
        ...rvals.map(([, v]) => (typeof v === "number" ? Math.abs(v) : 0)),
      );
      const rewardRows = rvals
        .map(([k, v]) => {
          if (typeof v !== "number") {
            return (
              `<div class="rw-row str"><span class="rw-k">${k}</span>` +
              `<b class="rw-val str">${v}</b></div>`
            );
          }
          const cls = v >= 0 ? "pos" : "neg";
          const w = Math.max(6, (Math.abs(v) / maxMag) * 100);
          // fixed-width bar + value columns (label flexes), so every bar starts
          // at the SAME x across rows regardless of how long the number is.
          return (
            `<div class="rw-row"><span class="rw-k">${k}</span>` +
            `<span class="rw-track"><span class="rw-fill ${cls}" style="width:${w}%"></span></span>` +
            `<b class="rw-val ${cls}">${v > 0 ? "+" : ""}${v}</b></div>`
          );
        })
        .join("");
      const rewardsPanel =
        `<p class="bf-lead">After every single move, the AI is paid or fined the amounts below. Nobody tells it HOW to play - it simply learns whatever behaviour collects the most in total.</p>` +
        `<div class="rw-leg"><span><i class="pos"></i>Gain</span><span><i class="neg"></i>Cost</span></div>` +
        rewardRows +
        (s.rewardNote ? `<p class="note">${s.rewardNote}</p>` : "");

      // ---- GAME: goal hero + storyboard rows + move keycaps + fact tiles ----
      const glyph = { Up: "↑", Down: "↓", Left: "←", Right: "→", Stay: "•" };
      const acts = s.actions || [];
      const movesVisual =
        acts.length && acts.every((a) => glyph[a])
          ? `<div class="bf-keys">` +
            acts
              .map((a) => `<span class="bf-key"><b>${glyph[a]}</b><span>${a}</span></span>`)
              .join("") +
            `</div>`
          : `<div class="bf-keys"><span class="bf-key wide"><span>${acts.join(" · ")}</span></span></div>`;
      const story = STORY[s.round] || null;
      const beats = story
        ? story.beats
            .map(([ic, t]) => {
              const tn = /^(plant|spike|goomba|bill|cannon|water)$/.test(ic) ? "bad"
                : /^(coin|star|tomato|cage|flag|bolt)$/.test(ic) ? "good" : "info";
              return `<div class="bf-beat"><span class="bf-beat-ic ${tn}">${BICONS[ic] || ""}</span><p>${t}</p></div>`;
            })
            .join("")
        : "";
      const finePrint = (s.dynamics || s.winCondition)
        ? `<details class="bf-more"><summary>The fine print - exact rules</summary>` +
          (s.dynamics ? `<p>${s.dynamics}</p>` : "") +
          (s.winCondition ? `<p><b>Winning:</b> ${s.winCondition}</p>` : "") +
          `</details>`
        : "";
      const gamePanel =
        `<div class="goal-card"><span class="goal-ic">${BICONS.trophy}</span>` +
        `<div class="goal-body"><span class="goal-lbl">The goal</span>` +
        `<span class="goal-txt">${story ? story.goal : s.winCondition}</span></div></div>` +
        (beats ? `<h3 class="bf-h">How a round plays out</h3>` + beats : "") +
        `<h3 class="bf-h">The moves</h3>` + movesVisual +
        `<div class="bf-facts">` +
        `<div class="bf-fact"><b>${s.nActions}</b><span>moves</span></div>` +
        (s.slipProb ? `<div class="bf-fact"><b>${Math.round(100 * s.slipProb)}%</b><span>slip chance</span></div>` : "") +
        `<div class="bf-fact"><b>${(+s.maxSteps).toLocaleString()}</b><span>max steps</span></div>` +
        `</div>` +
        finePrint;

      // ---- ALGORITHM: glossary primer + one explainer card per rival + live hyperparameters ----
      const L = s.learning || null;
      const algoCard = (who, label, color) => {
        const info = ALGO_INFO[label] || {};
        const tags = (info.tags || []).map((t) => `<span class="alg-tg">${t}</span>`).join("");
        return `<div class="alg-card" style="--ac:${color}">` +
          `<div class="alg-head"><span class="alg-who">${who}</span>` +
          `<b class="alg-name">${label}</b>${info.fam ? `<span class="alg-fam">${info.fam}</span>` : ""}</div>` +
          `<div class="alg-tags">${info.cat ? `<span class="alg-cat">${info.cat}</span>` : ""}${tags}</div>` +
          (info.is ? `<p class="alg-is">${info.is}</p>` : "") +
          (info.how ? `<div class="alg-lbl">How it learns</div><p class="alg-how">${info.how}</p>` : "") +
          (info.key ? `<div class="alg-lbl">Key idea</div><p class="alg-how">${info.key}</p>` : "") +
          `</div>`;
      };
      // Blue vs Red hyperparameter mini-columns. A planning round (DP) has no
      // α/ε - it solves the MDP directly - so only γ is shown there.
      const lcol = (who, d, color) =>
        `<div class="lh-col"><div class="lh-who" style="color:${color}">${who}</div>` +
        `<div class="lh-algo">${d.algo}</div>` +
        (L.planning
          ? `<div class="lh-row"><span>γ discount</span><b>${d.gamma}</b></div>` +
            `<div class="lh-note">Plans directly - no α / ε.</div>`
          : `<div class="lh-row"><span>α learn rate</span><b>${d.alpha}</b></div>` +
            `<div class="lh-row"><span>γ discount</span><b>${d.gamma}</b></div>` +
            `<div class="lh-row"><span>ε explore</span><b>${d.epsStart} → ${d.epsEnd}</b></div>` +
            `<div class="lh-row"><span>ε decay</span><b>${(d.epsEpisodes || 0).toLocaleString()} eps</b></div>`) +
        `</div>`;
      const algoPanel = L
        ? `<details class="alg-primer" open><summary>New to RL? The seven words everything uses</summary>` +
          `<dl>` + RL_PRIMER.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join("") + `</dl></details>` +
          `<h3 class="bf-h">The two rivals</h3>` +
          `<p class="bf-p" style="margin-bottom:9px">Both race to solve the exact same round - but they go about it very differently:</p>` +
          algoCard("BLUE", L.blue.algo, "#1f5fd0") +
          algoCard("RED", L.red.algo, "#e60012") +
          `<h3 class="bf-h">Current hyperparameters</h3>` +
          `<div class="lh-grid">` + lcol("Blue", L.blue, "#1f5fd0") + lcol("Red", L.red, "#e60012") + `</div>` +
          `<p class="note">Effective horizon &asymp; 1/(1-γ) &asymp; ${horizon(s.gammaBlue)} steps - roughly how far ahead a reward still sways a choice.</p>`
        : "";

      // ---- STATE: the snapshot story. One narrative: what the AI is handed
      // each step, what the snapshot is made of, how big the problem is, and
      // whether the rival is in it. ----
      const groups = s.stateGroups || null;
      const factors = s.stateFactors || null;
      const gTotal = groups ? groups.reduce((a, g) => a + g.dim, 0) || 1 : 0;
      const planning = !!(L && L.planning);
      const obsTuple = s.observationTuple || "(state)";
      let breakdown, totalStrip;
      if (groups) {
        // continuous rounds: the observation vector as a stacked bar + legend
        breakdown =
          `<div class="st-bar">` +
          groups
            .map((g) =>
              `<span class="st-seg" style="width:${((g.dim / gTotal) * 100).toFixed(2)}%;background:${g.color}" title="${g.label}: ${g.dim} numbers">${g.dim}</span>`)
            .join("") +
          `</div>` +
          groups
            .map((g) =>
              `<div class="st-li"><span class="st-dot" style="background:${g.color}"></span>` +
              `<span class="st-lab">${g.label}</span>` +
              `<span class="st-n">${g.count ? `${g.count}×${g.each} = ${g.dim}` : g.dim}</span>` +
              `<span class="st-det">${g.detail}</span></div>`)
            .join("");
        totalStrip =
          `<div class="st-total"><div class="st-row1"><span class="st-num">${gTotal}</span>` +
          `<span class="st-unit">numbers per snapshot</span></div>` +
          `<p class="st-why">Positions here are continuous, so no two snapshots are ever exactly alike and no table could list them all. That is why this round uses a neural network: it reads the ${gTotal} numbers and judges each move directly.</p></div>`;
      } else if (factors) {
        // tabular rounds: |S| as multiplied factor chips + legend
        breakdown =
          `<div class="st-chips">` +
          factors
            .map((f, i) => {
              const c = f.color || "#3f7fe0";
              return `${i ? `<span class="st-x">×</span>` : ""}` +
                `<span class="st-chip" style="color:${c};background:${c}0f;border-color:${c}44">` +
                `<b>${(f.n || 0).toLocaleString()}</b><span>${f.label}</span></span>`;
            })
            .join("") +
          `</div>` +
          factors
            .map((f) =>
              `<div class="st-li"><span class="st-dot" style="background:${f.color || "#3f7fe0"}"></span>` +
              `<span class="st-lab">${f.label}</span>` +
              `<span class="st-det">${f.detail}</span></div>`)
            .join("");
        totalStrip = s.stateSize
          ? `<div class="st-total"><div class="st-row1"><span class="st-num">${s.stateFactorsExact ? "" : "≈ "}${(+s.stateSize).toLocaleString()}</span>` +
            `<span class="st-unit">possible situations</span></div>` +
            `<p class="st-why">${planning
              ? "Multiply the pieces together and that is every situation this round can produce. Few enough to LIST - the planners literally compute a value for every single one. That is what makes Dynamic Programming possible here."
              : "Multiply the pieces together and that is every situation this round can produce. Few enough for a TABLE with one row per situation - each row remembers how good every move is from there. That is what &quot;tabular&quot; learning means."}</p></div>`
          : "";
      } else {
        breakdown = `<p class="bf-p">${s.stateDesc || ""}</p>`;
        totalStrip = "";
      }
      const EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/></svg>';
      const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 5.7A11 11 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.8 17.8 0 0 1-2.8 3.7M6.4 6.7A16.7 16.7 0 0 0 2.5 12s3.5 6.5 9.5 6.5a10.3 10.3 0 0 0 4.9-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3.5 3.5l17 17"/></svg>';
      const statePanel =
        `<p class="bf-lead">Each step, the AI is handed one small snapshot of the world - the <b>state</b>. Everything it will ever know when picking its next move is in that snapshot.</p>` +
        `<h3 class="bf-h">What it knows each step</h3>` +
        `<p class="bf-p">${s.observation}</p>` +
        `<code class="st-tuple">state = ${obsTuple}</code>` +
        `<h3 class="bf-h">Inside the snapshot</h3>` +
        breakdown +
        totalStrip +
        `<h3 class="bf-h">Does it see its rival?</h3>` +
        `<div class="st-opp"><span class="st-eye ${s.seesOpponent ? "yes" : "no"}">` +
        (s.seesOpponent ? EYE_ON : EYE_OFF) +
        `<b>${s.seesOpponent ? "VISIBLE" : "HIDDEN"}</b></span>` +
        `<p class="bf-p">${s.opponentInfo}</p></div>`;

      // ---- ITEMS & ENEMIES: icon-tile rows (+ R4 power-up cards, R5 crate weapons) ----
      // Round-4 POWER-UPS: a card per collectible - SEEK the good (speed /
      // shield), AVOID the bad (slow / freeze). Icons keyed off each `icon`.
      const PK_ICONS = {
        bolt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
        shield: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 8.6 8 11 4.6-2.4 8-6 8-11V5z"/></svg>',
        snail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 18h6"/><circle cx="14" cy="12" r="6"/><circle cx="14" cy="12" r="2.3"/><path d="M8 18a4 4 0 0 1-4-4"/><path d="M19.2 7.8 20.8 6"/></svg>',
        ice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/></svg>',
      };
      const pkList = Array.isArray(s.pickups) ? s.pickups : [];
      const pickupsBlock = pkList.length
        ? `<h3 class="bf-h">Power-ups on the field</h3>` +
          `<div class="pk-grid">` +
          pkList
            .map(
              (p) =>
                `<div class="pk-card ${p.good ? "good" : "bad"}" style="--pc:${p.color || "#3f7fe0"}" ` +
                `title="${(p.detail || "").replace(/"/g, "&quot;")}">` +
                `<span class="pk-tag">${p.good ? "SEEK" : "AVOID"}</span>` +
                `<span class="pk-ic">${PK_ICONS[p.icon] || PK_ICONS.bolt}</span>` +
                `<b class="pk-name">${p.label}</b>` +
                `<span class="pk-eff">${p.effect}</span>` +
                `<span class="pk-dur">${p.seconds}s</span></div>`,
            )
            .join("") +
          `</div>`
        : "";
      // Round-5 Capture-the-Flag: the crate weapons, each with its Mario-Kart icon
      const WPN_ICON = {
        chain: "./assets/icons/weapons/Chain_Chomp.png",
        red_shell: "./assets/icons/weapons/red-shell-2x.png",
        green_shell: "./assets/icons/weapons/green-shell-2x.png",
        banana: "./assets/icons/weapons/banana-2x.png",
        oil: "./assets/icons/weapons/MKAGPDX_Sticky_Oil.png",
      };
      const weaponsBlock = (s.weapons && s.weapons.length)
        ? `<h3 class="bf-h">Crate weapons</h3>` +
          `<p class="bf-p" style="margin:0 0 3px">Smash a crate to pick one up (one slot); fire it with the USE action.</p>` +
          s.weapons
            .map((w) =>
              `<div class="bf-it"><span class="bf-it-ic">` +
              (WPN_ICON[w.icon] ? `<img src="${WPN_ICON[w.icon]}" alt="">` : "") +
              `</span><div class="bf-it-tx"><b>${w.name}</b><span>${w.desc}</span></div></div>`)
            .join("")
        : "";
      const round = s.round || 0;
      const best = BESTIARY[round] || { items: [], foes: [] };
      const itRow = (e) =>
        `<div class="bf-it"><span class="bf-it-ic ${e.tone || "info"}">${BICONS[e.ic] || ""}</span>` +
        `<div class="bf-it-tx"><b>${e.name}</b><span>${e.desc}</span></div></div>`;
      const itemsPanel =
        (best.items.length ? `<h3 class="bf-h">On the board</h3>` + best.items.map(itRow).join("") : "") +
        pickupsBlock + weaponsBlock;
      const enemiesPanel = best.foes.length
        ? `<h3 class="bf-h">Watch out for these</h3>` + best.foes.map(itRow).join("")
        : "";

      // ---- assemble the sub-tabbed briefing (Game / Algorithm / State / Rewards / Items / Enemies) ----
      const TAB_ICONS = {
        game: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
        algo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a4 4 0 0 0-4 4 3 3 0 0 0-1 5.8V17a3 3 0 0 0 5 2 3 3 0 0 0 5-2v-4.2A3 3 0 0 0 16 7a4 4 0 0 0-4-4z"/><path d="M12 3v16"/></svg>',
        state: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/></svg>',
        rewards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v3a4 4 0 0 1-8 0z"/><path d="M8 5H5v1a3 3 0 0 0 3 3M16 5h3v1a3 3 0 0 1-3 3"/><path d="M12 11v4M9 20h6M10 20l.5-3h3l.5 3"/></svg>',
        items: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 12h18M12 8v13M8 8 12 4l4 4"/></svg>',
        enemies: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20v-8a7 7 0 0 1 14 0v8l-2-1.5-2 1.5-3-1.5-3 1.5-2-1.5z"/><circle cx="9.5" cy="11" r="1" fill="currentColor"/><circle cx="14.5" cy="11" r="1" fill="currentColor"/></svg>',
      };
      const hasItems = best.items.length || pkList.length || (s.weapons && s.weapons.length);
      const hasFoes = best.foes.length;
      const TABS = [["game", "Game"], ["algo", "Algorithm"], ["state", "State"], ["rewards", "Rewards"]];
      if (hasItems) TABS.push(["items", "Items"]);
      if (hasFoes) TABS.push(["enemies", "Enemies"]);
      if (!TABS.some(([k]) => k === activeSub)) activeSub = "game";
      const PANELS = { game: gamePanel, algo: algoPanel, state: statePanel,
                       rewards: rewardsPanel, items: itemsPanel, enemies: enemiesPanel };

      body.innerHTML =
        `<div class="bsub-bar">` +
        TABS.map(([k, lab]) =>
          `<button type="button" class="bsub-chip${k === activeSub ? " on" : ""}" data-sub="${k}">` +
          `<span class="bsub-ic">${TAB_ICONS[k] || ""}</span>${lab}</button>`).join("") +
        `</div>` +
        TABS.map(([k]) =>
          `<div class="bsub-panel${k === activeSub ? " on" : ""}" data-sub="${k}">${PANELS[k]}</div>`).join("");
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
      <p class="note" id="rl-pa-note" hidden>No tile can be compared yet: a tile counts only once BOTH models have a single clearly-best move there. Fresh (or just re-planned) values leave every move tied, so the count starts at zero and grows as value spreads out from the goal.</p>
    </section>`,
  );
  const sec = parent.querySelector("#rl-polagree");
  const label = parent.querySelector("#rl-pa-label");
  const rate = parent.querySelector("#rl-pa-rate");
  const bar = parent.querySelector("#rl-pa-bar");
  const note = parent.querySelector("#rl-pa-note");
  async function refresh() {
    try {
      const d = await (
        await fetch("/api/polagree", { cache: "no-store" })
      ).json();
      // the continuous arenas have no tile grid at all - nothing to compare, so the
      // card stays hidden there. A grid round with zero comparable tiles is only
      // WARMING UP: keep the card in place (a card that pops in and out mid-run just
      // reads as a glitch) and say why it is empty.
      if (d.applicable === false) {
        sec.hidden = true;
        return;
      }
      sec.hidden = false;
      label.textContent = d.mirrored
        ? "Mirrored greedy-policy match"
        : "Blue & Red greedy match";
      note.hidden = d.available;
      rate.style.color = d.available ? "" : "#a2a5ac";
      rate.textContent = d.available
        ? `${(100 * d.rate).toFixed(0)}%  (${d.agree}/${d.cells})`
        : "Warming up";
      bar.style.width = d.available ? (100 * d.rate).toFixed(0) + "%" : "0%";
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
