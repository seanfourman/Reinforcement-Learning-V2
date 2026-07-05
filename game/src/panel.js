// The training control panel (toggle with M). A clean, Nintendo-style dashboard:
// per-round matchup (read-only), live training controls, the tunable
// hyperparameters (which feed straight back into the trainer), live stats, the
// learning curves, an episode replay, and each model's learned value heatmap.
//
// Talks to the backend through window.RL (set up in main.js):
//   RL.control({cmd,...})  RL.setHeatmap('red'|'blue'|null)
//   RL.playFrame(frame)    RL.setReplay(bool)
// and listens for 'rl-snapshot' (live stats) and 'rl-qinspect' (clicked tile Q).

import { initGraphs } from './graphs.js';

// read-only display names for whichever algorithms the current round pits together
export const NAMES = {
  value_iteration: 'Value Iteration', policy_iteration: 'Policy Iteration',
  qlearning: 'Q-Learning', sarsa: 'SARSA', expected_sarsa: 'Expected-SARSA',
  monte_carlo: 'Monte-Carlo',
  dqn: 'DQN', double_dqn: 'Double-DQN', dueling_dqn: 'Dueling-DQN',
};
const ACTION_NAMES = ['North', 'South', 'West', 'East', 'Use'];

// slider 0..100 <-> steps/sec on a log scale (2 .. 15000)
const sliderToSpeed = (v) => Math.round(2 * Math.pow(7500, v / 100));

// per-level control scoping. DP planners (Value / Policy Iteration) plan with just
// the discount γ, so the learning controls (α, ε) hide on those rounds. Neural-net
// (DQN) controls only ever show on a DQN round (none exist yet).
export const DP_ALGOS = new Set(['value_iteration', 'policy_iteration']);
export const DQN_ALGOS = new Set(['dqn', 'double_dqn', 'dueling_dqn']);

// transport icons: centred SVGs that take the button's colour via currentColor
const SVG = {
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2.2v14H6z"/><path d="M18 5 8.5 12 18 19z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 5 15.5 12 6 19z"/><path d="M15.8 5H18v14h-2.2z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7.5 5v14L18 12z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.2v14H7z"/><path d="M13.8 5h3.2v14h-3.2z"/></svg>',
};

// slider fill colours: blue = tunes OUR model (Blue); gray = global / both models
const C_OURS = '#1f5fd0';
const C_GLOBAL = '#8a8d94';

// tunable training hyperparameters - the panel writes these to the trainer live
export const PARAMS = [
  { key: 'targetEpisodes', label: 'Stop after (episodes)', min: 0, max: 20000, step: 100, color: C_GLOBAL, scope: 'always', fmt: (v) => (v <= 0 ? 'no limit' : (+v).toLocaleString()) },
  { key: 'maxSteps', label: 'Max steps / episode', min: 50, max: 1000, step: 10, color: C_GLOBAL, scope: 'always', fmt: (v) => (+v).toLocaleString() },
  { key: 'alpha', label: 'Learning rate α', min: 0.01, max: 1, step: 0.01, color: C_OURS, scope: 'learn', fmt: (v) => (+v).toFixed(2) },
  { key: 'gamma', label: 'Discount γ', min: 0, max: 1, step: 0.01, color: C_OURS, scope: 'always', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsStart', label: 'ε start', min: 0, max: 1, step: 0.01, color: C_OURS, scope: 'learn', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsEnd', label: 'ε end', min: 0, max: 0.5, step: 0.01, color: C_OURS, scope: 'learn', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsEpisodes', label: 'ε decay (episodes)', min: 100, max: 20000, step: 100, color: C_OURS, scope: 'learn', fmt: (v) => (+v).toLocaleString() },
];

const STYLE = `
#rl-panel{position:fixed;top:0;left:0;height:100%;width:384px;z-index:10;
  transform:translateX(-398px);transition:transform .34s cubic-bezier(.2,.8,.2,1);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:#1f1f21;background:#f3f4f6;box-shadow:3px 0 24px rgba(0,0,0,.26);
  border-right:1px solid #e0e2e6;overflow-y:auto;overflow-x:hidden;}
#rl-panel.open{transform:translateX(0);}
#rl-panel::-webkit-scrollbar{width:11px;}
#rl-panel::-webkit-scrollbar-thumb{background:#cdd0d6;border-radius:6px;border:3px solid #f3f4f6;}

/* sticky header with the live matchup */
#rl-panel .hdr{position:sticky;top:0;z-index:2;padding:15px 16px 13px;background:#fff;
  border-bottom:1px solid #e6e8ec;}
#rl-panel .hdr h1{margin:0;font-size:16px;font-weight:800;letter-spacing:-.2px;
  display:flex;align-items:center;gap:9px;}
#rl-panel .hdr h1::before{content:"";width:5px;height:17px;border-radius:3px;background:#1f5fd0;}
#rl-panel .hdr .sub{margin:7px 0 0;font-size:11px;color:#9a9da4;}
#rl-panel .hdr .myalgo{margin-top:11px;}
#rl-panel .hdr .myalgo span{display:block;font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#a2a5ac;}
#rl-panel .hdr .myalgo b{display:block;font-size:21px;font-weight:800;color:#1f5fd0;letter-spacing:-.3px;line-height:1.15;margin-top:2px;}
#rl-panel .hdr .myalgo em{display:block;font-style:normal;font-size:10.5px;color:#9a9da4;margin-top:4px;}

/* cards */
#rl-panel section{margin:11px 11px;padding:13px 14px;background:#fff;border:1px solid #e6e8ec;
  border-radius:13px;box-shadow:0 1px 2px rgba(20,20,30,.04);}
#rl-panel h2{margin:0 0 12px;font-size:10.5px;font-weight:800;letter-spacing:.9px;
  text-transform:uppercase;color:#8a8d94;}

/* buttons */
#rl-panel .btns{display:flex;gap:7px;}
#rl-panel .btns+.btns{margin-top:7px;}
#rl-panel button{flex:1;padding:9px 6px;border:1px solid #d7dade;border-radius:9px;background:#fff;
  color:#26272b;font:inherit;font-size:12px;font-weight:600;cursor:pointer;outline:none;
  transition:background .12s,border-color .12s,color .12s;}
#rl-panel button:focus,#rl-panel button:focus-visible{outline:none;box-shadow:none;}
#rl-panel button:hover{background:#f0f1f3;}
#rl-panel button:active{background:#e7e8eb;}
#rl-panel button.primary{background:#1f5fd0;border-color:#1a52b8;color:#fff;}
#rl-panel button.primary:hover{background:#1a52b8;}
#rl-panel button.active{background:#1f1f21;border-color:#1f1f21;color:#fff;}
/* media-player transport: prev round | play/pause | next round */
#rl-panel .transport{display:flex;align-items:center;justify-content:center;gap:20px;margin-top:2px;}
#rl-panel .transport button{flex:none;padding:0;display:flex;align-items:center;justify-content:center;}
#rl-panel .tbtn{width:44px;height:44px;border-radius:50%;border:1.5px solid #d7dade;background:#fff;color:#3a3d44;}
#rl-panel .tbtn:hover{background:#f0f1f3;border-color:#c4c8ce;}
#rl-panel .tplay{width:54px;height:54px;border-radius:50%;border:none;background:#1f5fd0;color:#fff;}
#rl-panel .tplay:hover{background:#1a52b8;}
#rl-panel .transport button svg{width:18px;height:18px;display:block;fill:currentColor;}
#rl-panel .tplay svg{width:21px;height:21px;}

/* sliders (speed + every hyperparameter) */
#rl-panel .ctl{margin:0 0 13px;}
#rl-panel .ctl:last-child{margin-bottom:0;}
#rl-panel .ctl .row{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;margin-bottom:6px;}
#rl-panel .ctl .row span{color:#54565c;}
#rl-panel .ctl .row b{font-variant-numeric:tabular-nums;color:#1f1f21;font-weight:700;}
#rl-panel input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:3px;
  background:#e1e3e8;outline:none;margin:0;cursor:pointer;}
#rl-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;
  border-radius:50%;background:#fff;border:2px solid var(--fill,#8a8d94);box-shadow:0 1px 2px rgba(0,0,0,.3);}
#rl-panel input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;
  border:2px solid var(--fill,#8a8d94);box-shadow:0 1px 2px rgba(0,0,0,.3);}
#rl-panel .note{font-size:10.5px;color:#a2a5ac;margin:11px 0 0;line-height:1.45;}
#rl-panel .plegend{display:flex;gap:16px;margin:0 0 14px;font-size:10.5px;color:#8a8d94;}
#rl-panel .plegend i{display:inline-block;width:9px;height:9px;border-radius:3px;vertical-align:middle;margin-right:5px;}

/* key/value stats */
#rl-panel .stat{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;
  padding:7px 0;border-bottom:1px solid #f0f1f3;}
#rl-panel .stat:last-child{border-bottom:0;}
#rl-panel .stat>span{color:#54565c;}
#rl-panel .stat b{font-variant-numeric:tabular-nums;font-weight:700;}

/* contest bar */
#rl-panel .bar{height:10px;border-radius:6px;background:#eceef1;overflow:hidden;display:flex;margin:0 0 11px;}
#rl-panel .bar i{display:block;height:100%;transition:width .3s;}
#rl-panel .bar .r{background:#e60012;} #rl-panel .bar .b{background:#1f5fd0;} #rl-panel .bar .d{background:#c6c9cf;}
#rl-panel .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:middle;}

/* segmented control (value-map mode) */
#rl-panel .seg{display:flex;border:1px solid #d7dade;border-radius:9px;overflow:hidden;}
#rl-panel .seg button{flex:1;border:0;border-right:1px solid #d7dade;border-radius:0;background:#fff;}
#rl-panel .seg button:last-child{border-right:0;}
#rl-panel .seg button.active{background:#1f1f21;color:#fff;}

/* Q inspector */
#rl-panel .qrow{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;padding:3px 0;}
#rl-panel .qrow .qbar{flex:1;margin:0 9px;height:8px;background:#eceef1;border-radius:4px;position:relative;}
#rl-panel .qrow .qbar i{position:absolute;top:0;bottom:0;background:#8a8d94;border-radius:4px;}
#rl-panel .hint{font-size:11px;color:#a2a5ac;margin-top:7px;line-height:1.45;}

/* learning-curve charts (built by graphs.js into this panel) */
#rl-panel .chart{margin:0 0 14px;}
#rl-panel .chart:last-child{margin-bottom:0;}
#rl-panel .chart .ct{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
#rl-panel .chart .ct h3{margin:0;font-size:11.5px;font-weight:700;color:#3a3b40;}
#rl-panel .chart .ct .lg{font-size:9.5px;color:#9a9da4;display:flex;gap:10px;}
#rl-panel .chart .ct .lg i{display:inline-block;width:10px;height:3px;border-radius:2px;vertical-align:middle;margin-right:4px;}
#rl-panel .chart canvas{width:100%;height:94px;background:#fbfbfc;border:1px solid #eceef1;border-radius:9px;display:block;}
`;

export function initPanel() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const ctlHTML = (p) => `
    <div class="ctl" data-scope="${p.scope}">
      <div class="row"><span>${p.label}</span><b id="rl-pv-${p.key}">-</b></div>
      <input type="range" id="rl-p-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.min}" style="--fill:${p.color}">
    </div>`;

  const panel = document.createElement('div');
  panel.id = 'rl-panel';
  panel.innerHTML = `
    <div class="hdr">
      <h1>Training Control</h1>
      <p class="sub" id="rl-round">-</p>
      <div class="myalgo">
        <b id="rl-mb">-</b>
        <em id="rl-vs"></em>
      </div>
    </div>
    <section>
      <h2>Playback</h2>
      <div class="transport">
        <button id="rl-prev" class="tbtn">${SVG.prev}</button>
        <button id="rl-play" class="tplay">${SVG.pause}</button>
        <button id="rl-next" class="tbtn">${SVG.next}</button>
      </div>
      <div class="btns" style="margin-top:14px;">
        <button id="rl-reset">↺ Reset</button>
        <button id="rl-regen">⟳ New world</button>
      </div>
      <div class="ctl" style="margin-top:13px;">
        <div class="row"><span>Speed</span><b id="rl-spd-val">-</b></div>
        <input type="range" id="rl-speed" min="0" max="100" value="10" style="--fill:#8a8d94">
      </div>
    </section>
    <section>
      <h2>Hyperparameters</h2>
      <div class="plegend">
        <span><i style="background:#1f5fd0"></i>Your model (Blue)</span>
        <span><i style="background:#8a8d94"></i>Both models</span>
      </div>
      ${PARAMS.map(ctlHTML).join('')}
      <p class="note">Blue sliders tune your model. Red (the CPU) trains at a strength set by the
        chosen character's tier. Gray sliders are shared by both. Each round shows only the
        controls its algorithm uses: DP rounds plan with the discount γ; the learning rounds
        add the learning rate α and the ε exploration schedule.</p>
    </section>
    <section>
      <h2>Training</h2>
      <div class="stat"><span>Episode</span><b id="rl-ep">0</b></div>
      <div class="stat"><span>Total steps</span><b id="rl-steps">0</b></div>
      <div class="stat"><span>Exploration ε</span><b id="rl-eps">1.00</b></div>
      <div class="stat"><span>Avg episode length</span><b id="rl-len">-</b></div>
      <div class="stat"><span>Last return (R / B)</span><b id="rl-ret">-</b></div>
      <div class="stat"><span>Learned states (R / B)</span><b id="rl-q">0 / 0</b></div>
    </section>
    <section>
      <h2>Contest - recent</h2>
      <div class="bar"><i class="r" id="rl-br"></i><i class="b" id="rl-bb"></i><i class="d" id="rl-bd"></i></div>
      <div class="stat"><span><i class="dot" style="background:#e60012"></i>Red wins</span><b id="rl-wr">0</b></div>
      <div class="stat"><span><i class="dot" style="background:#1f5fd0"></i>Blue wins</span><b id="rl-wb">0</b></div>
      <div class="stat"><span><i class="dot" style="background:#c6c9cf"></i>Draws</span><b id="rl-wd">0</b></div>
    </section>
    <section>
      <h2>Value map · your model</h2>
      <div class="seg">
        <button id="rl-h-off" class="active">Off</button>
        <button id="rl-h-value">Value</button>
        <button id="rl-h-visits">Visits</button>
      </div>
      <p class="hint">Value: each tile shows its Q for N / S / W / E, greedy action in blue (a blue
        number in the center means "Use / stay" is best). Visits: where it travels (red = most
        stepped on, blue = least). Zoom in to read the numbers.</p>
      <div id="rl-qinspect" style="margin-top:8px;"></div>
    </section>`;
  document.body.appendChild(panel);

  // learning-curve charts + episode replay (built by graphs.js)
  initGraphs(panel);

  const $ = (id) => panel.querySelector(id);

  // paint the filled (left-of-thumb) part of a range slider red
  const paintRange = (el) => {
    if (!el) return;
    const min = +el.min, max = +el.max, v = +el.value;
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    const fill = el.style.getPropertyValue('--fill') || '#8a8d94';
    el.style.background = `linear-gradient(to right,${fill} ${pct}%,#e1e3e8 ${pct}%)`;
  };

  // ---- toggle (M key only) ----
  const toggle = () => panel.classList.toggle('open');
  if (new URLSearchParams(location.search).has('panel')) panel.classList.add('open');
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !/input|select|textarea/i.test(e.target.tagName)) toggle();
  });

  // ---- playback ----
  let paused = false;
  $('#rl-prev').addEventListener('click', () => window.RL.control({ cmd: 'prevRound' }));
  $('#rl-next').addEventListener('click', () => window.RL.control({ cmd: 'nextRound' }));
  const speed = $('#rl-speed');
  const showSpeed = () => {
    $('#rl-spd-val').textContent = `${sliderToSpeed(+speed.value).toLocaleString()} / s`;
    paintRange(speed);
  };
  speed.addEventListener('input', () => { showSpeed(); window.RL.control({ cmd: 'speed', value: sliderToSpeed(+speed.value) }); });
  showSpeed();
  window.RL.control({ cmd: 'speed', value: sliderToSpeed(+speed.value) });
  $('#rl-play').addEventListener('click', () => {
    paused = !paused;
    window.RL.control({ cmd: paused ? 'pause' : 'play' });
    $('#rl-play').innerHTML = paused ? SVG.play : SVG.pause;
  });
  $('#rl-regen').addEventListener('click', () => window.RL.control({ cmd: 'regenerate' }));
  $('#rl-reset').addEventListener('click', () => window.RL.control({ cmd: 'reset' }));

  // ---- hyperparameters: drive the trainer live (debounced) ----
  const setLabel = (p) => {
    $(`#rl-pv-${p.key}`).textContent = p.fmt(+$(`#rl-p-${p.key}`).value);
    paintRange($(`#rl-p-${p.key}`));
  };
  let applyTimer = null;
  const sendParams = () => {
    const params = {};
    for (const p of PARAMS) params[p.key] = +$(`#rl-p-${p.key}`).value;
    window.RL.control({ cmd: 'setParams', params });
  };
  for (const p of PARAMS) {
    setLabel(p);
    $(`#rl-p-${p.key}`).addEventListener('input', () => {
      setLabel(p);
      clearTimeout(applyTimer);
      applyTimer = setTimeout(sendParams, 160);
    });
  }
  let paramsInit = false;   // pull the backend defaults onto the sliders just once
  let lastAlgoBlue = null;  // to re-show only the relevant controls when the round changes

  // show only the controls that matter for our model's algorithm: hide α / ε on DP
  // rounds (planners use only γ), and show neural-net controls on DQN rounds only.
  const showRelevant = (algoBlue) => {
    const isDP = DP_ALGOS.has(algoBlue);
    const isDqn = DQN_ALGOS.has(algoBlue);
    panel.querySelectorAll('.ctl[data-scope]').forEach((el) => {
      const sc = el.dataset.scope;
      let show = true;
      if (sc === 'learn') show = !isDP;      // learning rate + exploration: not for DP
      else if (sc === 'dqn') show = isDqn;   // neural-net controls: DQN rounds only
      el.style.display = show ? '' : 'none';
    });
  };

  // ---- value-map mode ----
  // value map: this panel always shows OUR model (Blue), modes Off / Value / Visits
  const hbtns = { off: $('#rl-h-off'), value: $('#rl-h-value'), visits: $('#rl-h-visits') };
  const setMode = (m) => {
    for (const k in hbtns) hbtns[k].classList.toggle('active', k === m);
    if (m === 'off') { window.RL.setHeatmap(null); $('#rl-qinspect').innerHTML = ''; }
    else window.RL.setHeatmap('blue', m);
  };
  hbtns.off.addEventListener('click', () => setMode('off'));
  hbtns.value.addEventListener('click', () => setMode('value'));
  hbtns.visits.addEventListener('click', () => setMode('visits'));
  // one shared overlay: if the CPU panel grabs it, fall back to Off here
  window.addEventListener('rl-heatmap', (e) => {
    if ((e.detail || {}).agent !== 'blue') {
      for (const k in hbtns) hbtns[k].classList.toggle('active', k === 'off');
      $('#rl-qinspect').innerHTML = '';
    }
  });

  // ---- live stats ----
  window.addEventListener('rl-snapshot', (e) => {
    const s = e.detail.stats;
    if (!s) return;
    // seed the hyperparameter sliders from the backend's current values, once
    if (!paramsInit && s.params) {
      for (const p of PARAMS) {
        const el = $(`#rl-p-${p.key}`);
        if (el && s.params[p.key] != null) { el.value = s.params[p.key]; setLabel(p); }
      }
      paramsInit = true;
    }
    $('#rl-mb').textContent = NAMES[s.algoBlue] || s.algoBlue || '-';
    $('#rl-vs').textContent = s.cpuTier ? `vs CPU · Tier ${s.cpuTier}` : '';
    if (s.algoBlue !== lastAlgoBlue) { lastAlgoBlue = s.algoBlue; showRelevant(s.algoBlue); }
    const r = s.round || {};
    $('#rl-round').textContent = r.title
      ? `Round ${(r.index ?? 0) + 1} / ${r.total || 1} · ${r.title}` : '';
    const tgt = s.targetEpisodes || 0;
    $('#rl-ep').textContent = tgt > 0
      ? `${s.episode.toLocaleString()} / ${tgt.toLocaleString()}`
      : s.episode.toLocaleString();
    $('#rl-steps').textContent = s.totalSteps.toLocaleString();
    $('#rl-eps').textContent = s.epsilon.toFixed(2);
    $('#rl-len').textContent = s.avgEpisodeLen ? s.avgEpisodeLen.toFixed(0) : '-';
    const lr = s.lastReturn || { red: 0, blue: 0 };
    const sign = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
    $('#rl-ret').textContent = `${sign(lr.red)} / ${sign(lr.blue)}`;
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
      `<div class="hint">Tile (${d.cell[0]}, ${d.cell[1]}) · ${d.agent === 'red' ? 'Red' : 'Blue'}</div>` +
      d.q.map((q, i) =>
        `<div class="qrow"><span>${ACTION_NAMES[i]}${i === best ? ' ★' : ''}</span>
          <span class="qbar"><i style="left:${((Math.min(q, 0) - lo) / span) * 100}%;
            width:${(Math.abs(q) / span) * 100}%"></i></span>
          <span>${q.toFixed(2)}</span></div>`).join('');
  });
}
