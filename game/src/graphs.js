// Learning-curve graph + single-episode replay player (both spec requirements).
//
// * The graph polls /api/history and draws the rolling win-rate of each side and
//   the exploration rate ε across episodes — so you watch learning/exploration
//   progress over training.
// * The replay player fetches /api/replay (last or best episode), then feeds the
//   recorded frames back through the SAME live actors via window.RL.playFrame,
//   with play/pause + a scrubber, so you can study what a model actually did.
//
// Builds its own DOM into a parent element provided by the panel.

const REPLAY_FPS = 12;

function buildDom(parent) {
  parent.insertAdjacentHTML('beforeend', `
    <section>
      <h2>Learning curves</h2>
      <canvas id="rl-graph" width="294" height="120"
        style="width:100%;height:120px;background:#f6ecd2;border:1px solid #a98c55;border-radius:5px;"></canvas>
      <div style="display:flex;gap:14px;font-size:11px;margin-top:5px;color:#4a371f;">
        <span><i style="display:inline-block;width:10px;height:3px;background:#a3322c;vertical-align:middle"></i> Red win%</span>
        <span><i style="display:inline-block;width:10px;height:3px;background:#3358a8;vertical-align:middle"></i> Blue win%</span>
        <span><i style="display:inline-block;width:10px;height:3px;background:#6e4a1f;vertical-align:middle"></i> ε</span>
      </div>
    </section>
    <section>
      <h2>Episode replay</h2>
      <div class="btns">
        <button id="rl-rep-last">▶ Last</button>
        <button id="rl-rep-best">★ Best</button>
        <button id="rl-rep-stop">⏹ Live</button>
      </div>
      <input type="range" id="rl-rep-seek" min="0" max="0" value="0" style="width:100%;margin-top:9px;">
      <div class="stat"><span id="rl-rep-info">No replay loaded</span><b id="rl-rep-frame"></b></div>
    </section>`);
}

export function initGraphs(parent) {
  buildDom(parent);
  const $ = (id) => parent.querySelector(id);
  const canvas = $('#rl-graph');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // ---- learning curves ----
  function draw(points) {
    ctx.clearRect(0, 0, W, H);
    // gridlines at 0, .5, 1
    ctx.strokeStyle = '#d9c39a';
    ctx.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      const y = H - 4 - f * (H - 8);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    if (!points || points.length < 2) return;
    // downsample to <= W columns
    const step = Math.max(1, Math.floor(points.length / W));
    const xs = [];
    for (let i = 0; i < points.length; i += step) xs.push(points[i]);
    const n = xs.length;
    const line = (key, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
      xs.forEach((p, i) => {
        const x = (i / (n - 1)) * (W - 2) + 1;
        const v = Math.max(0, Math.min(1, p[key] ?? 0));
        const y = H - 4 - v * (H - 8);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    };
    line('eps', '#6e4a1f');
    line('rateRed', '#a3322c');
    line('rateBlue', '#3358a8');
  }

  async function refresh() {
    try {
      const h = await (await fetch('/api/history', { cache: 'no-store' })).json();
      draw(h.points);
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

  function showFrame(i) {
    if (!frames.length) return;
    idx = Math.max(0, Math.min(frames.length - 1, i));
    seek.value = idx;
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
      info.textContent = `${which} — ${r.winner || 'draw'} in ${r.steps} steps`;
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
    if (!frames.length) return;
    if (timer) { clearInterval(timer); timer = null; }   // scrubbing pauses autoplay
    window.RL?.setReplay?.(true);
    showFrame(+seek.value);
  });
}
