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
      fmt: (v) => v.toFixed(1),
    },
    {
      id: `rate-${side}`,
      title: "Win rate - recent",
      legend: [[c, label]],
      series: [{ key: isRed ? "rateRed" : "rateBlue", color: c }],
      min: 0,
      max: 1,
      fmt: (v) => v.toFixed(1),
    },
    {
      id: `eps-${side}`,
      title: "Exploration ε",
      legend: [["#7c4dd0", "ε"]],
      series: [{ key: isRed ? "redEps" : "eps", color: "#7c4dd0" }],
      min: 0,
      max: 1,
      fmt: (v) => v.toFixed(2),
    },
    {
      id: `len-${side}`,
      title: "Episode length",
      legend: [["#1f9d63", "steps"]],
      series: [{ key: "len", color: "#1f9d63" }],
      fmt: (v) => v.toFixed(0),
    },
  ];
}

function chartBlock(c) {
  const lg = c.legend
    .map(([col, t]) => `<i style="background:${col}"></i>${t}`)
    .join("");
  // c.fullonly charts are hidden in the docked quick view (only the win-rate
  // chart rides along there); they all show in fullscreen.
  return `
    <div class="chart${c.fullonly ? " fullonly" : ""}">
      <div class="ct"><h3>${c.title}</h3><span class="lg">${lg}</span></div>
      <canvas id="rl-ch-${c.id}"></canvas>
    </div>`;
}

// a small auto-scaling line chart on a crisp (dpr-aware) canvas
function makeChart(canvas, cfg) {
  const ctx = canvas.getContext("2d");
  let W = 0,
    H = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || 332;
    H = canvas.clientHeight || 94;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function draw(points) {
    if (!W) resize();
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
    }
    ctx.fillStyle = "#a2a5ac";
    ctx.font = "9px system-ui,sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(cfg.fmt(hi), 5, 2);
    ctx.textBaseline = "bottom";
    ctx.fillText(cfg.fmt(lo), 5, H - 1);
  }
  return { draw, resize };
}

// draw a value grid (H x W, nulls = walls) as a cropped blue(low)->red(high) heatmap
// on a 2D canvas - used by the Value-Iteration propagation animation.
function drawVGrid(canvas, grid) {
  const ctx = canvas.getContext("2d");
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
  const cw = canvas.clientWidth || 280,
    ch = canvas.clientHeight || 280;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (r1 < 0) return;
  const span = hi - lo || 1,
    rows = r1 - r0 + 1,
    cols = c1 - c0 + 1;
  const tw = cw / cols,
    th = ch / rows;
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const v = grid[r][c];
      if (v == null) {
        ctx.fillStyle = "#e8eaee";
      } else {
        const t = (v - lo) / span;
        ctx.fillStyle = `rgb(${Math.round(41 + t * 179)},${Math.round(107 - t * 54)},${Math.round(235 - t * 189)})`;
      }
      ctx.fillRect((c - c0) * tw, (r - r0) * th, tw + 0.6, th + 0.6);
    }
}

function shade(r, g, b, f) {
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

// draw a value grid as an ISOMETRIC 3D relief (the "value surface"): each cell is a
// bar whose height + colour track V. Painter-ordered back-to-front. Used by the
// Value-Iteration animation so scrubbing sweeps shows the surface rising from the goal.
function drawVSurface(canvas, grid) {
  const ctx = canvas.getContext("2d");
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
  const cw = canvas.clientWidth || 280,
    ch = canvas.clientHeight || 280;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (r1 < 0) return;
  const R = r1 - r0 + 1,
    C = c1 - c0 + 1,
    span = hi - lo || 1;
  const hw = (cw * 0.92) / (R + C); // half-width of a tile diamond
  const hh = hw * 0.5;
  const barH = ch * 0.34; // tallest bar
  const ox = cw / 2 + ((R - C) * hw) / 2;
  const oy = ch * 0.3;
  const cells = [];
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) if (grid[r][c] != null) cells.push([r, c]);
  cells.sort((a, b) => a[0] + a[1] - (b[0] + b[1])); // back (small r+c) first
  for (const [r, c] of cells) {
    const rr = r - r0,
      cc = c - c0;
    const t = (grid[r][c] - lo) / span,
      h = t * barH;
    const x = ox + (cc - rr) * hw,
      yb = oy + (cc + rr) * hh,
      yt = yb - h;
    const R8 = 41 + t * 179,
      G8 = 107 - t * 54,
      B8 = 235 - t * 189;
    ctx.strokeStyle = "rgba(20,22,30,0.10)";
    ctx.lineWidth = 0.5;
    ctx.fillStyle = shade(R8, G8, B8, 0.72); // left face
    ctx.beginPath();
    ctx.moveTo(x - hw, yt);
    ctx.lineTo(x, yt + hh);
    ctx.lineTo(x, yb + hh);
    ctx.lineTo(x - hw, yb);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = shade(R8, G8, B8, 0.55); // right face
    ctx.beginPath();
    ctx.moveTo(x + hw, yt);
    ctx.lineTo(x, yt + hh);
    ctx.lineTo(x, yb + hh);
    ctx.lineTo(x + hw, yb);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgb(${Math.round(R8)},${Math.round(G8)},${Math.round(B8)})`; // top
    ctx.beginPath();
    ctx.moveTo(x, yt - hh);
    ctx.lineTo(x + hw, yt);
    ctx.lineTo(x, yt + hh);
    ctx.lineTo(x - hw, yt);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// ---- per-side learning curves ----
export function initCurves(parent, side) {
  const CH = chartsFor(side);
  // one card per chart, so they tile as uniform grid cells in fullscreen
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
      <div class="seg" id="rl-rep-model">
        <button data-a="blue" class="active">Blue - top 30</button>
        <button data-a="red">Red - top 30</button>
      </div>
      <div id="rl-rep-list" class="replist"></div>
    </section>`,
  );
  const $ = (id) => parent.querySelector(id);
  const seg = $("#rl-rep-model");
  const listEl = $("#rl-rep-list");
  let model = "blue"; // default: the player's own model (Blue), on the left
  let selRank = -1; // currently loaded rank (highlighted in the list)

  async function refreshList() {
    try {
      const r = await (
        await fetch(`/api/replays?agent=${model}`, { cache: "no-store" })
      ).json();
      const items = r.items || [];
      if (!items.length) {
        listEl.innerHTML = `<div class="empty">No winning runs yet for ${model === "red" ? "Red" : "Blue"}.</div>`;
        return;
      }
      listEl.innerHTML = items
        .map(
          (it) =>
            `<div class="rrow${it.rank === selRank ? " sel" : ""}" data-rank="${it.rank}">` +
            `<span class="rk">#${it.rank + 1}</span>` +
            `<span class="st">${it.steps} steps</span>` +
            `<span class="ep">ep ${(it.episode || 0).toLocaleString()}</span></div>`,
        )
        .join("");
    } catch (e) {
      listEl.innerHTML = '<div class="empty">List fetch failed.</div>';
    }
  }

  async function loadTop(rank) {
    try {
      const r = await (
        await fetch(`/api/replay?which=top&agent=${model}&rank=${rank}`, {
          cache: "no-store",
        })
      ).json();
      if (!r.available) {
        refreshList(); // rolled out of the top 30 - refresh
        return;
      }
      selRank = rank;
      [...listEl.children].forEach((el) =>
        el.classList.toggle("sel", +el.dataset.rank === rank),
      );
      // hand the frames to the shared player, PAUSED (Playback takes over from here);
      // pass the model so the Playback scrubber matches (red for Red runs)
      const label = `${model === "red" ? "Red" : "Blue"} #${rank + 1} - ${r.steps} steps`;
      window.RL?.replay?.load?.(r.frames || [], label, model);
    } catch (e) {
      /* ignore a failed fetch - the list stays as-is */
    }
  }

  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    [...seg.children].forEach((x) => x.classList.toggle("active", x === b));
    model = b.dataset.a;
    listEl.classList.toggle("red", model === "red"); // red model -> red row selection
    selRank = -1;
    refreshList();
  });
  listEl.addEventListener("click", (e) => {
    const row = e.target.closest(".rrow");
    if (!row) return;
    loadTop(+row.dataset.rank);
  });
  // when the panel exits replay (Back to live / arena change), drop the highlight
  window.addEventListener("rl-replay-state", (e) => {
    if (!e.detail?.active && selRank !== -1) {
      selRank = -1;
      [...listEl.children].forEach((el) => el.classList.remove("sel"));
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
      <div class="stat"><span>Bellman backups</span><b id="rl-dp-backups">-</b></div>
      <div class="btns" id="rl-dp-seg" style="margin-top:10px;">
        <button data-a="red" class="active">Value Iteration</button>
        <button data-a="blue">Policy Iteration</button>
      </div>
      <div class="ctl" style="margin-top:12px;">
        <div class="row"><span>Convergence θ</span><b id="rl-dp-theta-v">1e-5</b></div>
        <input type="range" id="rl-dp-theta" min="-6" max="0" step="0.5" value="-5" style="--fill:#7c4dd0">
      </div>
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
  let dpAgent = "red";
  const chDelta = makeChart(q("#rl-ch-dp-delta"), {
    series: [{ key: "logDelta", color: "#e11f2b" }],
    fmt: (v) => {
      const d = Math.pow(10, v);
      return d >= 1 ? d.toFixed(1) : d.toExponential(0);
    },
  });
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
  q("#rl-dp-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    [...q("#rl-dp-seg").children].forEach((x) =>
      x.classList.toggle("active", x === b),
    );
    dpAgent = b.dataset.a;
    refresh();
    loadSweeps();
  });
  // convergence threshold theta: re-solve BOTH planners live -> the charts re-paint
  const theta = q("#rl-dp-theta"),
    thetaV = q("#rl-dp-theta-v");
  const paintTheta = () => {
    const p =
      ((+theta.value - +theta.min) / (+theta.max - +theta.min || 1)) * 100;
    theta.style.background = `linear-gradient(to right,#7c4dd0 ${p}%,#e1e3e8 ${p}%)`;
  };
  let thTimer = null;
  theta.addEventListener("input", () => {
    const th = Math.pow(10, +theta.value);
    thetaV.textContent = th.toExponential(0);
    paintTheta();
    clearTimeout(thTimer);
    thTimer = setTimeout(() => {
      window.RL?.control?.({ cmd: "setParams", params: { dpTheta: th } });
      setTimeout(() => {
        refresh();
        loadSweeps();
      }, 60);
    }, 220);
  });
  paintTheta();
  // ---- Value-Iteration propagation animation (per-sweep V snapshots) ----
  const anim = q("#rl-dp-anim"),
    vcanvas = q("#rl-dp-vcanvas"),
    vseek = q("#rl-dp-vseek"),
    vlbl = q("#rl-dp-vlbl");
  let vframes = [];
  const paintVseek = () => {
    const p = +vseek.max > 0 ? (+vseek.value / +vseek.max) * 100 : 0;
    vseek.style.background = `linear-gradient(to right,#e11f2b ${p}%,#e1e3e8 ${p}%)`;
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
  async function loadSweeps() {
    try {
      const sw = await (
        await fetch(`/api/dpsweeps?agent=${dpAgent}`, { cache: "no-store" })
      ).json();
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
  async function refresh() {
    try {
      const d = await (
        await fetch(`/api/dp?agent=${dpAgent}`, { cache: "no-store" })
      ).json();
      if (!d.isDP) {
        sec.hidden = true;
        return;
      } // hidden on non-DP rounds
      sec.hidden = false;
      q("#rl-dp-name").textContent =
        d.name || d.method || "Dynamic Programming";
      q("#rl-dp-sweeps").textContent = `${d.sweepCount} sweeps - γ ${d.gamma}`;
      q("#rl-dp-backups").textContent = (d.backups || 0).toLocaleString();
      const pts = (d.sweeps || []).map((s) => ({
        logDelta: Math.log10(Math.max(s.delta, 1e-6)),
        meanV: s.meanV,
      }));
      chDelta.draw(pts);
      chMeanV.draw(pts);
      const pol = d.policyChanges || [];
      polWrap.hidden = pol.length === 0; // only PI has policy-improvement iterations
      if (pol.length) chPol.draw(pol.map((c, i) => ({ i, changed: c })));
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
        [RED, "Red"],
        [BLUE, "Blue"],
      ],
      series: [
        { key: "retRed", color: RED },
        { key: "retBlue", color: BLUE },
      ],
      fmt: (v) => v.toFixed(1),
    },
    {
      id: "d-rate",
      title: "Win rate - recent",
      legend: [
        [RED, "Red"],
        [BLUE, "Blue"],
      ],
      series: [
        { key: "rateRed", color: RED },
        { key: "rateBlue", color: BLUE },
      ],
      min: 0,
      max: 1,
      fmt: (v) => v.toFixed(1),
    },
    {
      id: "d-eps",
      fullonly: true,
      title: "Exploration ε",
      legend: [
        [RED, "Red"],
        [BLUE, "Blue"],
      ],
      series: [
        { key: "redEps", color: RED },
        { key: "eps", color: BLUE },
      ],
      min: 0,
      max: 1,
      fmt: (v) => v.toFixed(2),
    },
    {
      id: "d-len",
      fullonly: true,
      title: "Episode length",
      legend: [["#1f9d63", "steps"]],
      series: [{ key: "len", color: "#1f9d63" }],
      fmt: (v) => v.toFixed(0),
    },
    {
      id: "d-td",
      fullonly: true,
      title: "Learning signal - |TD error| / DQN loss",
      legend: [
        [RED, "Red"],
        [BLUE, "Blue"],
      ],
      series: [
        { key: "tdRed", color: RED },
        { key: "tdBlue", color: BLUE },
      ],
      fmt: (v) => v.toFixed(3),
    },
  ];
}

export function initCurvesDual(parent) {
  const CH = dualCharts();
  // one card PER chart, so they tile as uniform cells in the fullscreen grid
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
      <div class="bar" style="margin-bottom:11px;"><i class="r" id="rl-oc-r"></i><i class="b" id="rl-oc-b"></i><i class="d" id="rl-oc-d"></i><i class="t" id="rl-oc-t"></i></div>
      <div class="stat"><span><i class="dot" style="background:#e60012"></i>Red wins</span><b id="rl-oc-rv">0</b></div>
      <div class="stat"><span><i class="dot" style="background:#1f5fd0"></i>Blue wins</span><b id="rl-oc-bv">0</b></div>
      <div class="stat"><span><i class="dot" style="background:#c6c9cf"></i>Draws</span><b id="rl-oc-dv">0</b></div>
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
      <div class="chart" style="margin-top:12px;"><div class="ct"><h3>Gradient norm (pre-clip)</h3><span class="lg"><i style="background:#e60012"></i>Red<i style="background:#1f5fd0"></i>Blue</span></div><canvas id="rl-ch-gnorm"></canvas></div>
      <div class="chart"><div class="ct"><h3>Predicted Q - overestimation</h3><span class="lg"><i style="background:#e60012"></i>Red<i style="background:#1f5fd0"></i>Blue</span></div><canvas id="rl-ch-predq"></canvas></div>
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
      q("#rl-act-body").innerHTML = ad.labels
        .map(
          (lb, i) =>
            `<div class="actrow"><span class="al">${lb}</span>` +
            `<span class="ab"><i class="r" style="width:${pct(ad.red[i] || 0)}"></i></span>` +
            `<span class="ab"><i class="b" style="width:${pct(ad.blue[i] || 0)}"></i></span></div>`,
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
  let lastRound = -1;
  async function refresh() {
    try {
      const s = await (await fetch("/api/mdp", { cache: "no-store" })).json();
      if (s.round === lastRound) return; // rebuild only when the round changes
      lastRound = s.round;
      const rewards = (s.rewards || [])
        .map(
          ([k, v]) =>
            `<div class="stat"><span>${k}</span><b>${v > 0 ? "+" : ""}${v}</b></div>`,
        )
        .join("");
      body.innerHTML =
        `<div class="brief-matchup">${s.matchup}</div>` +
        `<p class="hint">${s.family}. ${s.winCondition}</p>` +
        `<div class="stat"><span>State space</span><b>${s.stateSize ? s.stateSize.toLocaleString() : "continuous"}</b></div>` +
        `<p class="note"><b>S:</b> ${s.stateDesc}</p>` +
        `<div class="stat"><span>Actions (${s.nActions})</span><b>${s.actions.join(", ")}</b></div>` +
        `<div class="stat"><span>Discount γ - R / B</span><b>${s.gammaRed} / ${s.gammaBlue}</b></div>` +
        `<div class="stat"><span>Effective horizon</span><b>${s.horizon || "∞"} steps</b></div>` +
        (s.slipProb
          ? `<div class="stat"><span>Slip probability</span><b>${s.slipProb}</b></div>`
          : "") +
        `<div class="stat"><span>Max steps / episode</span><b>${s.maxSteps}</b></div>` +
        `<h3 class="brief-sub">Reward structure</h3>${rewards}`;
    } catch (e) {
      /* warming up */
    }
  }
  setInterval(refresh, 2000);
  refresh();
}

// small two-column (Red vs Blue) comparison table used by Head-to-head + Exploration
function cmpHead(rLabel, bLabel) {
  return `<div class="cmp-head"><span></span><span class="cr">${rLabel}</span><span class="cb">${bLabel}</span></div>`;
}
function cmpRow(label, r, b, lead) {
  return (
    `<div class="cmp-row"><span class="cl">${label}</span>` +
    `<b class="cr${lead === "r" ? " win" : ""}">${r}</b><b class="cb${lead === "b" ? " win" : ""}">${b}</b></div>`
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
        "Avg ep length",
        s.avgEpisodeLen ?? "-",
        s.avgEpisodeLen ?? "-",
        "",
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
          "Board coverage",
          (100 * rb.coverage).toFixed(0) + "%",
          (100 * bb.coverage).toFixed(0) + "%",
          lead(rb.coverage, bb.coverage),
        ) +
        cmpRow(
          "Cells visited",
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

// ---- DUELING value/advantage split (Round 5's Dueling-DQN) ----
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

// ---- REWARD DECOMPOSITION: how much of the return is real terminal reward vs
// potential shaping vs step-level cost (grid rounds; the env tracks the split) ----
export function initReward(parent) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <section id="rl-reward" hidden>
      <h2>Reward decomposition</h2>
      <p class="hint">Average return per episode split into terminal (win/lose), potential shaping, and other (step cost + bonuses).</p>
      <div id="rl-reward-body"></div>
    </section>`,
  );
  const sec = parent.querySelector("#rl-reward");
  const body = parent.querySelector("#rl-reward-body");
  const PARTS = [
    ["Terminal", "terminal", "#37b26a"],
    ["Shaping", "shape", "#7c4dd0"],
    ["Other", "other", "#8a8d94"],
  ];
  const rows = (s, color) => {
    const tot = Math.max(
      0.01,
      Math.abs(s.terminal) + Math.abs(s.shape) + Math.abs(s.other),
    );
    return PARTS.map(([label, key, c]) => {
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
      body.innerHTML =
        `<div class="brief-sub" style="color:#e60012">Red - ${d.episodes}-ep avg</div>` +
        rows(d.red, "#e60012") +
        `<div class="brief-sub" style="color:#1f5fd0;margin-top:12px">Blue</div>` +
        rows(d.blue, "#1f5fd0");
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
      <div class="chart"><div class="ct"><h3>V(spawn) over episodes</h3><span class="lg"><i style="background:#e60012"></i>Red<i style="background:#1f5fd0"></i>Blue</span></div><canvas id="rl-ch-probe"></canvas></div>
    </section>`,
  );
  const sec = parent.querySelector("#rl-probe");
  const ch = makeChart(parent.querySelector("#rl-ch-probe"), {
    series: [
      { key: "redV", color: "#e60012" },
      { key: "blueV", color: "#1f5fd0" },
    ],
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
      <div class="stat"><span>Red &amp; Blue greedy match</span><b id="rl-pa-rate">-</b></div>
      <div class="bar" style="margin-top:9px;"><i class="b" id="rl-pa-bar"></i></div>
      <p class="hint">On the DP round, Value Iteration and Policy Iteration reach the SAME optimal policy - agreement heads to 100%. TD/MC learners can diverge.</p>
    </section>`,
  );
  const sec = parent.querySelector("#rl-polagree");
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
