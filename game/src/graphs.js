// Learning-curve charts + single-episode replay player (both spec requirements).
//
// * initCurves(parent, side) polls /api/history and plots ONLY that side's signals
//   (Blue on the player panel, Red on the CPU panel): its per-episode return, its
//   rolling win rate, its exploration epsilon, and the shared episode length.
// * initReplay(parent) builds the replay player (one shared replay): it fetches
//   /api/replay (last or best episode) and feeds the recorded frames back through
//   the live actors via window.RL.playFrame, with play/pause + a scrubber.
//
// initGraphs(parent) = initCurves(parent, 'blue') + initReplay(parent), the
// player's left panel. The CPU panel calls initCurves(panel, 'red') on its own.

const REPLAY_FPS = 12;

// the four charts for one side; only that model's series are plotted
function chartsFor(side) {
  const isRed = side === 'red';
  const c = isRed ? '#e60012' : '#1f5fd0';
  const label = isRed ? 'Red' : 'Blue';
  return [
    { id: `return-${side}`, title: 'Episode return', legend: [[c, label]],
      series: [{ key: isRed ? 'retRed' : 'retBlue', color: c }], fmt: (v) => v.toFixed(1) },
    { id: `rate-${side}`, title: 'Win rate · recent', legend: [[c, label]],
      series: [{ key: isRed ? 'rateRed' : 'rateBlue', color: c }], min: 0, max: 1, fmt: (v) => v.toFixed(1) },
    { id: `eps-${side}`, title: 'Exploration ε', legend: [['#7c4dd0', 'ε']],
      series: [{ key: isRed ? 'redEps' : 'eps', color: '#7c4dd0' }], min: 0, max: 1, fmt: (v) => v.toFixed(2) },
    { id: `len-${side}`, title: 'Episode length', legend: [['#1f9d63', 'steps']],
      series: [{ key: 'len', color: '#1f9d63' }], fmt: (v) => v.toFixed(0) },
  ];
}

function chartBlock(c) {
  const lg = c.legend.map(([col, t]) => `<i style="background:${col}"></i>${t}`).join('');
  return `
    <div class="chart">
      <div class="ct"><h3>${c.title}</h3><span class="lg">${lg}</span></div>
      <canvas id="rl-ch-${c.id}"></canvas>
    </div>`;
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
    ctx.strokeStyle = '#edeff2'; ctx.lineWidth = 1;
    for (let g = 0; g <= 2; g++) {
      const yy = Math.round(y0 + (g / 2) * (y1 - y0)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
    }
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = '#d6dae0';
      const yz = Math.round(yOf(0)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x0, yz); ctx.lineTo(x1, yz); ctx.stroke();
    }
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
    ctx.fillStyle = '#a2a5ac'; ctx.font = '9px system-ui,sans-serif';
    ctx.textBaseline = 'top'; ctx.fillText(cfg.fmt(hi), 5, 2);
    ctx.textBaseline = 'bottom'; ctx.fillText(cfg.fmt(lo), 5, H - 1);
  }
  return { draw, resize };
}

// ---- per-side learning curves ----
export function initCurves(parent, side) {
  const CH = chartsFor(side);
  parent.insertAdjacentHTML('beforeend',
    `<section><h2>Learning curves</h2>${CH.map(chartBlock).join('')}</section>`);
  const charts = CH.map((c) => makeChart(parent.querySelector(`#rl-ch-${c.id}`), c));
  window.addEventListener('resize', () => charts.forEach((c) => c.resize()));
  async function refresh() {
    try {
      const h = await (await fetch('/api/history', { cache: 'no-store' })).json();
      charts.forEach((c) => c.draw(h.points));
    } catch (e) { /* server warming up */ }
  }
  setInterval(refresh, 1000);
  refresh();
}

// ---- shared episode replay: browse each model's TOP-30 fastest winning runs ----
export function initReplay(parent) {
  parent.insertAdjacentHTML('beforeend', `
    <section>
      <h2>Episode replay</h2>
      <div class="seg" id="rl-rep-model">
        <button data-a="red" class="active">Red · top 30</button>
        <button data-a="blue">Blue · top 30</button>
      </div>
      <div id="rl-rep-list" class="replist"></div>
      <input type="range" id="rl-rep-seek" min="0" max="0" value="0" style="margin-top:12px;--fill:#8a8d94">
      <div class="stat" style="margin-top:8px;"><span id="rl-rep-info">Pick a run to replay</span><b id="rl-rep-frame"></b></div>
      <div class="btns" style="margin-top:10px;"><button id="rl-rep-stop">Back to live</button></div>
    </section>`);
  const $ = (id) => parent.querySelector(id);
  const paintRange = (el) => {
    const min = +el.min, max = +el.max, v = +el.value;
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    const fill = el.style.getPropertyValue('--fill') || '#8a8d94';
    el.style.background = `linear-gradient(to right,${fill} ${pct}%,#e1e3e8 ${pct}%)`;
  };
  const seg = $('#rl-rep-model');
  const listEl = $('#rl-rep-list');
  const seek = $('#rl-rep-seek');
  const info = $('#rl-rep-info');
  const frameLbl = $('#rl-rep-frame');
  let frames = [];
  let idx = 0;
  let timer = null;
  let model = 'red';   // which model's winning runs we're browsing
  let selRank = -1;    // currently loaded rank (highlighted in the list)
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

  async function refreshList() {
    try {
      const r = await (await fetch(`/api/replays?agent=${model}`, { cache: 'no-store' })).json();
      const items = r.items || [];
      if (!items.length) {
        listEl.innerHTML = `<div class="empty">No winning runs yet for ${model === 'red' ? 'Red' : 'Blue'}.</div>`;
        return;
      }
      listEl.innerHTML = items.map((it) =>
        `<div class="rrow${it.rank === selRank ? ' sel' : ''}" data-rank="${it.rank}">` +
        `<span class="rk">#${it.rank + 1}</span>` +
        `<span class="st">${it.steps} steps</span>` +
        `<span class="ep">ep ${(it.episode || 0).toLocaleString()}</span></div>`).join('');
    } catch (e) { listEl.innerHTML = '<div class="empty">List fetch failed.</div>'; }
  }

  async function loadTop(rank) {
    try {
      const r = await (await fetch(`/api/replay?which=top&agent=${model}&rank=${rank}`, { cache: 'no-store' })).json();
      if (!r.available) { info.textContent = 'That run rolled out of the top 30'; refreshList(); return; }
      frames = r.frames || [];
      seek.max = Math.max(0, frames.length - 1);
      selRank = rank;
      info.textContent = `${model === 'red' ? 'Red' : 'Blue'} #${rank + 1} · ${r.steps} steps`;
      [...listEl.children].forEach((el) => el.classList.toggle('sel', +el.dataset.rank === rank));
      window.RL?.setReplay?.(true);
      stopPlayback(false);
      idx = 0; showFrame(0);
      timer = setInterval(() => {
        if (idx >= frames.length - 1) { stopPlayback(true); return; }
        showFrame(idx + 1);
      }, 1000 / REPLAY_FPS);
    } catch (e) { info.textContent = 'Replay fetch failed'; }
  }

  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    [...seg.children].forEach((x) => x.classList.toggle('active', x === b));
    model = b.dataset.a; selRank = -1; refreshList();
  });
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.rrow'); if (!row) return;
    loadTop(+row.dataset.rank);
  });
  $('#rl-rep-stop').addEventListener('click', () => {
    stopPlayback(true); selRank = -1;
    [...listEl.children].forEach((el) => el.classList.remove('sel'));
    info.textContent = 'Live';
  });
  seek.addEventListener('input', () => {
    paintRange(seek);
    if (!frames.length) return;
    if (timer) { clearInterval(timer); timer = null; }
    window.RL?.setReplay?.(true);
    showFrame(+seek.value);
  });

  refreshList();
  // keep the list fresh as new fast runs come in, but not while a replay auto-plays
  setInterval(() => { if (timer === null) refreshList(); }, 4000);
}

// ---- DP convergence (Round 1's Dynamic-Programming room): per-sweep Bellman
// residual + mean state value - the distinctive "how DP converges" charts ----
export function initDP(parent) {
  parent.insertAdjacentHTML('beforeend', `
    <section id="rl-dp" hidden>
      <h2>DP convergence</h2>
      <div class="stat"><span id="rl-dp-name">-</span><b id="rl-dp-sweeps"></b></div>
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
    </section>`);
  const q = (s) => parent.querySelector(s);
  const sec = q('#rl-dp');
  let dpAgent = 'red';
  const chDelta = makeChart(q('#rl-ch-dp-delta'), {
    series: [{ key: 'logDelta', color: '#e11f2b' }],
    fmt: (v) => { const d = Math.pow(10, v); return d >= 1 ? d.toFixed(1) : d.toExponential(0); },
  });
  const chMeanV = makeChart(q('#rl-ch-dp-meanv'), {
    series: [{ key: 'meanV', color: '#1f9d63' }], fmt: (v) => v.toFixed(2),
  });
  window.addEventListener('resize', () => { chDelta.resize(); chMeanV.resize(); });
  q('#rl-dp-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    [...q('#rl-dp-seg').children].forEach((x) => x.classList.toggle('active', x === b));
    dpAgent = b.dataset.a; refresh();
  });
  // convergence threshold theta: re-solve BOTH planners live -> the charts re-paint
  const theta = q('#rl-dp-theta'), thetaV = q('#rl-dp-theta-v');
  const paintTheta = () => {
    const p = ((+theta.value - +theta.min) / ((+theta.max - +theta.min) || 1)) * 100;
    theta.style.background = `linear-gradient(to right,#7c4dd0 ${p}%,#e1e3e8 ${p}%)`;
  };
  let thTimer = null;
  theta.addEventListener('input', () => {
    const th = Math.pow(10, +theta.value);
    thetaV.textContent = th.toExponential(0);
    paintTheta();
    clearTimeout(thTimer);
    thTimer = setTimeout(() => {
      window.RL?.control?.({ cmd: 'setParams', params: { dpTheta: th } });
      setTimeout(refresh, 60);
    }, 220);
  });
  paintTheta();
  async function refresh() {
    try {
      const d = await (await fetch(`/api/dp?agent=${dpAgent}`, { cache: 'no-store' })).json();
      if (!d.isDP) { sec.hidden = true; return; }   // hidden on non-DP rounds
      sec.hidden = false;
      q('#rl-dp-name').textContent = d.name || d.method || 'Dynamic Programming';
      q('#rl-dp-sweeps').textContent = `${d.sweepCount} sweeps · γ ${d.gamma}`;
      const pts = (d.sweeps || []).map((s) => ({
        logDelta: Math.log10(Math.max(s.delta, 1e-6)), meanV: s.meanV }));
      chDelta.draw(pts); chMeanV.draw(pts);
    } catch (e) { /* server warming up */ }
  }
  setInterval(refresh, 1500);
  refresh();
}

export function initGraphs(parent) {
  initCurves(parent, 'blue');
  initDP(parent);
  initReplay(parent);
}
