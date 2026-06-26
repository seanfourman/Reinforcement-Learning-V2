// Learning-curve charts + single-episode replay player (both spec requirements).
//
// * The charts poll /api/history and plot the training signals the tabular
//   self-play produces: per-episode return, the rolling win rate of each side,
//   the exploration rate ε, and episode length - so you watch learning and
//   exploration progress across training.
// * The replay player fetches /api/replay (last or best episode), then feeds the
//   recorded frames back through the SAME live actors via window.RL.playFrame,
//   with play/pause + a scrubber, so you can study what a model actually did.
//
// Builds its own DOM into a parent element provided by the panel.

const REPLAY_FPS = 12;

const CHARTS = [
  { id: 'rl-ch-return', title: 'Episode return',
    legend: [['#e60012', 'Red'], ['#1f5fd0', 'Blue']],
    series: [{ key: 'retRed', color: '#e60012' }, { key: 'retBlue', color: '#1f5fd0' }],
    fmt: (v) => v.toFixed(1) },
  { id: 'rl-ch-rate', title: 'Win rate · recent',
    legend: [['#e60012', 'Red'], ['#1f5fd0', 'Blue']],
    series: [{ key: 'rateRed', color: '#e60012' }, { key: 'rateBlue', color: '#1f5fd0' }],
    min: 0, max: 1, fmt: (v) => v.toFixed(1) },
  { id: 'rl-ch-eps', title: 'Exploration ε',
    legend: [['#7c4dd0', 'ε']],
    series: [{ key: 'eps', color: '#7c4dd0' }],
    min: 0, max: 1, fmt: (v) => v.toFixed(2) },
  { id: 'rl-ch-len', title: 'Episode length',
    legend: [['#1f9d63', 'steps']],
    series: [{ key: 'len', color: '#1f9d63' }],
    fmt: (v) => v.toFixed(0) },
];

function chartBlock(c) {
  const lg = c.legend
    .map(([col, t]) => `<i style="background:${col}"></i>${t}`).join('');
  return `
    <div class="chart">
      <div class="ct"><h3>${c.title}</h3><span class="lg">${lg}</span></div>
      <canvas id="${c.id}"></canvas>
    </div>`;
}

function buildDom(parent) {
  parent.insertAdjacentHTML('beforeend', `
    <section>
      <h2>Learning curves</h2>
      ${CHARTS.map(chartBlock).join('')}
    </section>
    <section>
      <h2>Episode replay</h2>
      <div class="btns">
        <button id="rl-rep-last">▶ Last</button>
        <button id="rl-rep-best">★ Best</button>
        <button id="rl-rep-stop">⏹ Live</button>
      </div>
      <input type="range" id="rl-rep-seek" min="0" max="0" value="0" style="margin-top:12px;--fill:#8a8d94">
      <div class="stat" style="margin-top:8px;"><span id="rl-rep-info">No replay loaded</span><b id="rl-rep-frame"></b></div>
    </section>`);
}

// a small auto-scaling line chart on a crisp (dpr-aware) canvas
function makeChart(canvas, cfg) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
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
    const padT = 9, padB = 9, x0 = 5, x1 = W - 5, y0 = padT, y1 = H - padB;
    // y-range: fixed for bounded signals, auto for the rest
    let lo, hi;
    if (cfg.min != null && cfg.max != null) { lo = cfg.min; hi = cfg.max; }
    else {
      lo = Infinity; hi = -Infinity;
      for (const p of points || []) for (const s of cfg.series) {
        const v = p[s.key];
        if (v == null || Number.isNaN(v)) continue;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (lo === hi) { lo -= 0.5; hi += 0.5; }
      const m = (hi - lo) * 0.12; lo -= m; hi += m;
    }
    const span = hi - lo || 1;
    const yOf = (v) => y1 - ((v - lo) / span) * (y1 - y0);
    // horizontal gridlines
    ctx.strokeStyle = '#edeff2'; ctx.lineWidth = 1;
    for (let g = 0; g <= 2; g++) {
      const yy = Math.round(y0 + (g / 2) * (y1 - y0)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
    }
    // a stronger zero line when the range straddles zero (returns can be +/-)
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = '#d6dae0';
      const yz = Math.round(yOf(0)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x0, yz); ctx.lineTo(x1, yz); ctx.stroke();
    }
    // series
    if (points && points.length >= 2) {
      const cols = Math.max(2, Math.floor(x1 - x0));
      const step = Math.max(1, Math.floor(points.length / cols));
      const xs = [];
      for (let i = 0; i < points.length; i += step) xs.push(points[i]);
      if (xs[xs.length - 1] !== points[points.length - 1]) xs.push(points[points.length - 1]);
      const n = xs.length;
      for (const s of cfg.series) {
        ctx.strokeStyle = s.color; ctx.lineWidth = 1.7;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        let started = false;
        xs.forEach((p, i) => {
          const v = p[s.key];
          if (v == null || Number.isNaN(v)) return;
          const x = x0 + (i / (n - 1)) * (x1 - x0);
          const y = yOf(v);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
    // y min/max labels
    ctx.fillStyle = '#a2a5ac'; ctx.font = '9px system-ui,sans-serif';
    ctx.textBaseline = 'top'; ctx.fillText(cfg.fmt(hi), 5, 2);
    ctx.textBaseline = 'bottom'; ctx.fillText(cfg.fmt(lo), 5, H - 1);
  }
  return { draw, resize };
}

export function initGraphs(parent) {
  buildDom(parent);
  const $ = (id) => parent.querySelector(id);
  const paintRange = (el) => {
    const min = +el.min, max = +el.max, v = +el.value;
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    const fill = el.style.getPropertyValue('--fill') || '#8a8d94';
    el.style.background = `linear-gradient(to right,${fill} ${pct}%,#e1e3e8 ${pct}%)`;
  };

  // ---- learning curves ----
  const charts = CHARTS.map((c) => ({ cfg: c, chart: makeChart($(`#${c.id}`), c) }));
  window.addEventListener('resize', () => charts.forEach((c) => c.chart.resize()));
  async function refresh() {
    try {
      const h = await (await fetch('/api/history', { cache: 'no-store' })).json();
      charts.forEach((c) => c.chart.draw(h.points));
    } catch (e) { /* server warming up */ }
  }
  setInterval(refresh, 1000);
  refresh();

  // ---- replay player ----
  const seek = $('#rl-rep-seek');
  const info = $('#rl-rep-info');
  const frameLbl = $('#rl-rep-frame');
  let frames = [];
  let idx = 0;
  let timer = null;
  paintRange(seek);

  function showFrame(i) {
    if (!frames.length) return;
    idx = Math.max(0, Math.min(frames.length - 1, i));
    seek.value = idx;
    paintRange(seek);
    frameLbl.textContent = `${idx + 1}/${frames.length}`;
    window.RL?.playFrame?.(frames[idx]);
  }
  function stopPlayback(toLive = true) {
    if (timer) { clearInterval(timer); timer = null; }
    if (toLive) window.RL?.setReplay?.(false);
  }
  async function load(which) {
    try {
      const r = await (await fetch(`/api/replay?which=${which}`, { cache: 'no-store' })).json();
      if (!r.available) { info.textContent = 'No finished episode yet'; return; }
      frames = r.frames || [];
      seek.max = Math.max(0, frames.length - 1);
      info.textContent = `${which} · ${r.winner || 'draw'} in ${r.steps} steps`;
      window.RL?.setReplay?.(true);   // take the scene off live frames
      stopPlayback(false);
      idx = 0; showFrame(0);
      timer = setInterval(() => {
        if (idx >= frames.length - 1) { stopPlayback(true); return; }
        showFrame(idx + 1);
      }, 1000 / REPLAY_FPS);
    } catch (e) { info.textContent = 'Replay fetch failed'; }
  }

  $('#rl-rep-last').addEventListener('click', () => load('last'));
  $('#rl-rep-best').addEventListener('click', () => load('best'));
  $('#rl-rep-stop').addEventListener('click', () => { stopPlayback(true); info.textContent = 'Live'; });
  seek.addEventListener('input', () => {
    paintRange(seek);
    if (!frames.length) return;
    if (timer) { clearInterval(timer); timer = null; }   // scrubbing pauses autoplay
    window.RL?.setReplay?.(true);
    showFrame(+seek.value);
  });
}
