// The tournament control panel (toggle with M). Per-round it shows the live
// matchup (Red vs Blue, each running its own algorithm), lets you reassign either
// side's algorithm, control speed/play/regenerate/reset, advance to the next
// round, watch the learning curves, replay an episode, and overlay each model's
// learned value heatmap (with a per-tile Q inspector).
//
// Talks to the backend through window.RL (set up in main.js):
//   RL.control({cmd,...})  RL.setHeatmap('red'|'blue'|null)
//   RL.playFrame(frame)    RL.setReplay(bool)
// and listens for 'rl-snapshot' (live stats) and 'rl-qinspect' (clicked tile Q).

import { initGraphs } from './graphs.js';

const STYLE = `
#rl-panel{position:fixed;top:0;left:0;height:100%;width:330px;z-index:10;
  transform:translateX(-340px);transition:transform .35s cubic-bezier(.2,.8,.2,1);
  font-family:"Palatino Linotype","Book Antiqua",Georgia,serif;color:#2b2016;
  background:linear-gradient(160deg,#efe2c4,#e3d2ad 55%,#d8c39a);
  box-shadow:4px 0 26px rgba(0,0,0,.5);border-right:3px solid #7a5a2e;
  overflow-y:auto;overflow-x:hidden;}
#rl-panel.open{transform:translateX(0);}
#rl-panel .hdr{padding:16px 18px 10px;border-bottom:2px solid #b59a63;
  background:linear-gradient(#5a3a1a,#3f2912);color:#f3e2bb;}
#rl-panel .hdr h1{margin:0;font-size:19px;letter-spacing:.5px;}
#rl-panel .hdr p{margin:4px 0 0;font-size:11px;opacity:.8;font-style:italic;}
#rl-panel section{padding:12px 18px;border-bottom:1px solid #c4ab78;}
#rl-panel h2{margin:0 0 9px;font-size:12px;text-transform:uppercase;
  letter-spacing:1.5px;color:#6e4a1f;}
#rl-panel label{font-size:12px;display:block;margin:8px 0 3px;color:#4a371f;}
#rl-panel select,#rl-panel input[type=range]{width:100%;}
#rl-panel select{padding:5px;border:1px solid #8a6a3a;border-radius:4px;
  background:#f6ecd2;color:#3a2a16;font-family:inherit;font-size:13px;}
#rl-panel .btns{display:flex;gap:7px;margin-top:10px;}
#rl-panel button{flex:1;padding:7px 4px;border:1px solid #6e4a1f;border-radius:5px;
  background:linear-gradient(#f0dfb6,#d9bf86);color:#3a2a16;font-family:inherit;
  font-size:12px;cursor:pointer;font-weight:600;}
#rl-panel button:hover{background:linear-gradient(#f8ebc8,#e3cd98);}
#rl-panel button.active{background:linear-gradient(#7a5a2e,#5a3f1c);color:#f3e2bb;}
#rl-panel .stat{display:flex;justify-content:space-between;font-size:13px;
  padding:3px 0;border-bottom:1px dotted #c4ab78;}
#rl-panel .stat b{font-variant-numeric:tabular-nums;}
#rl-panel .bar{height:13px;border-radius:3px;background:#cdb888;overflow:hidden;
  display:flex;margin:7px 0 2px;border:1px solid #a98c55;}
#rl-panel .bar i{display:block;height:100%;}
#rl-panel .bar .r{background:#d8473f;} #rl-panel .bar .b{background:#3f6fd6;}
#rl-panel .bar .d{background:#9b8a66;}
#rl-panel .seg{display:flex;gap:6px;}
#rl-panel .seg button{flex:1;}
#rl-panel .qrow{display:flex;justify-content:space-between;font-size:12px;padding:2px 0;}
#rl-panel .qrow .qbar{flex:1;margin:0 8px;height:10px;background:#cdb888;border-radius:2px;
  position:relative;border:1px solid #a98c55;}
#rl-panel .qrow .qbar i{position:absolute;top:0;bottom:0;background:#6e4a1f;border-radius:2px;}
#rl-panel .hint{font-size:11px;font-style:italic;color:#6e4a1f;opacity:.8;margin-top:6px;}
#rl-tab{position:fixed;bottom:14px;left:14px;z-index:9;padding:8px 12px;cursor:pointer;
  font-family:"Palatino Linotype",Georgia,serif;font-size:13px;font-weight:700;color:#f3e2bb;
  background:linear-gradient(#5a3a1a,#3f2912);border:2px solid #b59a63;border-radius:6px;
  box-shadow:0 3px 12px rgba(0,0,0,.4);}
#rl-panel.open ~ #rl-tab{opacity:0;pointer-events:none;}
`;

// algorithms selectable for either side (DQN variants arrive with the continuous rounds)
const ALGOS = [
  ['value_iteration', 'Value Iteration (DP)'],
  ['policy_iteration', 'Policy Iteration (DP)'],
  ['qlearning', 'Q-Learning (off-policy TD)'],
  ['sarsa', 'SARSA (on-policy TD)'],
  ['expected_sarsa', 'Expected-SARSA'],
  ['monte_carlo', 'Monte-Carlo'],
];
const ACTION_NAMES = ['North', 'South', 'West', 'East', 'Use'];
const opts = () => ALGOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');

// slider 0..100 <-> steps/sec on a log scale (2 .. 12000)
const sliderToSpeed = (v) => Math.round(2 * Math.pow(6000, v / 100));

export function initPanel() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'rl-panel';
  panel.innerHTML = `
    <div class="hdr"><h1>⚔ Tournament Control</h1>
      <p>Five themed rounds — a different model duels each arena.</p></div>
    <section>
      <h2>This round — matchup</h2>
      <label>Red player</label>
      <select id="rl-algo-red">${opts()}</select>
      <label>Blue player</label>
      <select id="rl-algo-blue">${opts()}</select>
      <label>Speed — slow ↔ fast <span id="rl-spd-val"></span></label>
      <input type="range" id="rl-speed" min="0" max="100" value="88">
      <div class="btns">
        <button id="rl-play">⏸ Pause</button>
        <button id="rl-regen">⚑ New world</button>
        <button id="rl-reset">↺ Reset</button>
      </div>
      <div class="btns"><button id="rl-next">⏭ Next round</button></div>
    </section>
    <section>
      <h2>Training</h2>
      <div class="stat"><span>Iteration (episode)</span><b id="rl-ep">0</b></div>
      <div class="stat"><span>Total steps</span><b id="rl-steps">0</b></div>
      <div class="stat"><span>ε explore vs exploit</span><b id="rl-eps">1.00</b></div>
      <div class="stat"><span>Avg episode length</span><b id="rl-len">—</b></div>
      <div class="stat"><span>Learned states (R/B)</span><b id="rl-q">0 / 0</b></div>
    </section>
    <section>
      <h2>Contest (recent)</h2>
      <div class="bar"><i class="r" id="rl-br"></i><i class="b" id="rl-bb"></i><i class="d" id="rl-bd"></i></div>
      <div class="stat"><span style="color:#a3322c">● Red wins</span><b id="rl-wr">0</b></div>
      <div class="stat"><span style="color:#3358a8">● Blue wins</span><b id="rl-wb">0</b></div>
      <div class="stat"><span>Draws</span><b id="rl-wd">0</b></div>
    </section>
    <section>
      <h2>Learned value map</h2>
      <div class="seg">
        <button id="rl-h-off" class="active">Off</button>
        <button id="rl-h-red">Red</button>
        <button id="rl-h-blue">Blue</button>
      </div>
      <p class="hint">Brighter = higher expected reward V(s). Click a tile to inspect Q.</p>
      <div id="rl-qinspect" style="margin-top:8px;"></div>
    </section>`;
  document.body.appendChild(panel);

  // learning curves + replay sections (built by graphs.js)
  initGraphs(panel);

  const $ = (id) => panel.querySelector(id);

  // ---- toggle (M key only; the on-screen tab was removed) ----
  const toggle = () => panel.classList.toggle('open');
  if (new URLSearchParams(location.search).has('panel')) panel.classList.add('open');
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !/input|select|textarea/i.test(e.target.tagName)) toggle();
  });

  // ---- controls ----
  let paused = false;
  $('#rl-algo-red').addEventListener('change', (e) =>
    window.RL.control({ cmd: 'sideAlgo', side: 'red', value: e.target.value }));
  $('#rl-algo-blue').addEventListener('change', (e) =>
    window.RL.control({ cmd: 'sideAlgo', side: 'blue', value: e.target.value }));
  $('#rl-next').addEventListener('click', () => window.RL.control({ cmd: 'nextRound' }));
  const speed = $('#rl-speed');
  const showSpeed = () => { $('#rl-spd-val').textContent = `(${sliderToSpeed(+speed.value)}/s)`; };
  speed.addEventListener('input', () => { showSpeed(); window.RL.control({ cmd: 'speed', value: sliderToSpeed(+speed.value) }); });
  showSpeed();
  window.RL.control({ cmd: 'speed', value: sliderToSpeed(+speed.value) });
  $('#rl-play').addEventListener('click', () => {
    paused = !paused;
    window.RL.control({ cmd: paused ? 'pause' : 'play' });
    $('#rl-play').textContent = paused ? '▶ Play' : '⏸ Pause';
  });
  $('#rl-regen').addEventListener('click', () => window.RL.control({ cmd: 'regenerate' }));
  $('#rl-reset').addEventListener('click', () => window.RL.control({ cmd: 'reset' }));

  // ---- heatmap mode ----
  const hbtns = { off: $('#rl-h-off'), red: $('#rl-h-red'), blue: $('#rl-h-blue') };
  const setHeat = (mode) => {
    for (const k in hbtns) hbtns[k].classList.toggle('active', k === mode);
    window.RL.setHeatmap(mode === 'off' ? null : mode);
    if (mode === 'off') $('#rl-qinspect').innerHTML = '';
  };
  hbtns.off.addEventListener('click', () => setHeat('off'));
  hbtns.red.addEventListener('click', () => setHeat('red'));
  hbtns.blue.addEventListener('click', () => setHeat('blue'));
  const _hp = new URLSearchParams(location.search).get('heat');
  if (_hp === 'red' || _hp === 'blue') setHeat(_hp);

  // ---- live stats ----
  window.addEventListener('rl-snapshot', (e) => {
    const s = e.detail.stats;
    if (!s) return;
    // keep the dropdowns in sync if the backend changed them (round switch / reset)
    if (s.algoRed && $('#rl-algo-red').value !== s.algoRed) $('#rl-algo-red').value = s.algoRed;
    if (s.algoBlue && $('#rl-algo-blue').value !== s.algoBlue) $('#rl-algo-blue').value = s.algoBlue;
    $('#rl-ep').textContent = s.episode.toLocaleString();
    $('#rl-steps').textContent = s.totalSteps.toLocaleString();
    $('#rl-eps').textContent = s.epsilon.toFixed(2);
    $('#rl-len').textContent = s.avgEpisodeLen ? s.avgEpisodeLen.toFixed(0) : '—';
    $('#rl-q').textContent = `${s.qStates.red} / ${s.qStates.blue}`;
    $('#rl-wr').textContent = s.wins.red.toLocaleString();
    $('#rl-wb').textContent = s.wins.blue.toLocaleString();
    $('#rl-wd').textContent = s.wins.draw.toLocaleString();
    const rr = s.recentRate;
    $('#rl-br').style.width = `${rr.red * 100}%`;
    $('#rl-bb').style.width = `${rr.blue * 100}%`;
    $('#rl-bd').style.width = `${rr.draw * 100}%`;
  });

  // ---- Q inspector ----
  window.addEventListener('rl-qinspect', (e) => {
    const d = e.detail;
    if (!d || !d.q) { $('#rl-qinspect').innerHTML = '<p class="hint">No data for that tile yet.</p>'; return; }
    const lo = Math.min(...d.q, 0), hi = Math.max(...d.q, 0), span = hi - lo || 1;
    const best = d.q.indexOf(Math.max(...d.q));
    $('#rl-qinspect').innerHTML =
      `<div class="hint">Tile (${d.cell[0]}, ${d.cell[1]}) — ${d.agent === 'red' ? 'Red' : 'Blue'}</div>` +
      d.q.map((q, i) =>
        `<div class="qrow"><span>${ACTION_NAMES[i]}${i === best ? ' ★' : ''}</span>
          <span class="qbar"><i style="left:${((Math.min(q, 0) - lo) / span) * 100}%;
            width:${(Math.abs(q) / span) * 100}%"></i></span>
          <span>${q.toFixed(2)}</span></div>`).join('');
  });
}
