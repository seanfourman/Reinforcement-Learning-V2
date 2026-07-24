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
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7.5 5v14L18 12z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.2v14H7z"/><path d="M13.8 5h3.2v14h-3.2z"/></svg>',
};

// slider fill colours: blue = tunes OUR model (Blue); gray = global / both models
const C_OURS = '#1f5fd0';
const C_GLOBAL = '#8a8d94';

// tunable training hyperparameters - the panel writes these to the trainer live.
// PARAMS = the per-side LEARNING knobs (both the N and the mirrored M panel use
// this array). The global structural settings live in GLOBAL_PARAMS below and
// are rendered by the N (Training) panel only, since they are match-wide (not
// "Red's params") and route through setParams.
export const PARAMS = [
  { key: 'targetEpisodes', label: 'Stop after (episodes)', min: 0, max: 20000, step: 100, color: C_GLOBAL, scope: 'always', fmt: (v) => (v <= 0 ? 'no limit' : (+v).toLocaleString()) },
  { key: 'maxSteps', label: 'Max steps / episode', min: 50, max: 1000, step: 10, color: C_GLOBAL, scope: 'always', fmt: (v) => (+v).toLocaleString() },
  { key: 'alpha', label: 'Learning rate α', min: 0.01, max: 1, step: 0.01, color: C_OURS, scope: 'learn', fmt: (v) => (+v).toFixed(2) },
  { key: 'gamma', label: 'Discount γ', min: 0, max: 1, step: 0.01, color: C_OURS, scope: 'always', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsStart', label: 'ε start', min: 0, max: 1, step: 0.01, color: C_OURS, scope: 'learn', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsEnd', label: 'ε end', min: 0, max: 0.5, step: 0.01, color: C_OURS, scope: 'learn', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsEpisodes', label: 'ε decay (episodes)', min: 100, max: 20000, step: 100, color: C_OURS, scope: 'learn', fmt: (v) => (+v).toLocaleString() },
];

// shared display + reset helpers
const fLoc = (v) => (+v).toLocaleString();
const fCount = (v) => (v < 0 ? 'default' : String(Math.round(v)));   // -1 = built-in

// GLOBAL structural settings (N panel only). Three families, scoped per round by
// showRelevant():
//   'dp'   -> DP planners (Value/Policy Iteration): convergence + sweep cap
//   'dqn'  -> neural rounds: replay / batch / target-net / width
//   'cont' -> continuous-arena dynamics (rounds 4-5)
//   'slip' -> slippery grid rounds (2-3)
//   'r4'/'r5' -> that round's hazard counts
//   'always' -> every round (the reproducibility seed)
// `sect` places the slider in the Algorithm-internals ('algo') or World ('world')
// card. `def` is the backend default (for Reset). `enc`/`dec` map slider-space
// <-> backend-space where they differ (dpTheta rides a log/exponent slider).
export const GLOBAL_PARAMS = [
  // --- algorithm internals ---
  { key: 'dpTheta', label: 'Convergence θ', min: 1, max: 9, step: 1, sect: 'algo', scope: 'dp', def: 1e-5,
    enc: (e) => Math.pow(10, -Math.round(e)), dec: (t) => Math.max(1, Math.min(9, Math.round(-Math.log10(t || 1e-5)))),
    fmt: (e) => `1e-${Math.round(e)}` },
  { key: 'dpMaxIters', label: 'Max sweeps / phase', min: 50, max: 5000, step: 50, sect: 'algo', scope: 'dp', def: 2000, fmt: fLoc },
  { key: 'dqnBatch', label: 'Batch size', min: 8, max: 256, step: 8, sect: 'algo', scope: 'dqn', def: 64, fmt: fLoc },
  { key: 'dqnBuffer', label: 'Replay buffer', min: 5000, max: 200000, step: 5000, sect: 'algo', scope: 'dqn', def: 50000, fmt: fLoc },
  { key: 'dqnWarmup', label: 'Warmup steps', min: 0, max: 10000, step: 250, sect: 'algo', scope: 'dqn', def: 1000, fmt: fLoc },
  { key: 'dqnTargetSync', label: 'Target sync (steps)', min: 50, max: 5000, step: 50, sect: 'algo', scope: 'dqn', def: 500, fmt: fLoc },
  { key: 'dqnHidden', label: 'Hidden width', min: 32, max: 512, step: 32, sect: 'algo', scope: 'dqn', def: 128, fmt: fLoc },
  // --- world dynamics + hazards ---
  { key: 'slip', label: 'Slip chance', min: 0, max: 0.9, step: 0.05, sect: 'world', scope: 'slip', def: 0.25, fmt: (v) => (+v).toFixed(2) },
  { key: 'thrust', label: 'Thrust', min: 2, max: 40, step: 1, sect: 'world', scope: 'cont', def: 16, fmt: (v) => (+v).toFixed(0) },
  { key: 'drag', label: 'Momentum kept', min: 0.5, max: 0.99, step: 0.01, sect: 'world', scope: 'cont', def: 0.9, fmt: (v) => (+v).toFixed(2) },
  { key: 'speedCap', label: 'Speed cap', min: 2, max: 20, step: 0.5, sect: 'world', scope: 'cont', def: 7, fmt: (v) => (+v).toFixed(1) },
  { key: 'sandDamp', label: 'Quicksand drag', min: 0.4, max: 0.95, step: 0.01, sect: 'world', scope: 'r5', def: 0.72, fmt: (v) => (+v).toFixed(2) },
  { key: 'obstacleCount', label: 'Ruins', min: -1, max: 12, step: 1, sect: 'world', scope: 'r4', def: -1, fmt: fCount },
  { key: 'tornadoCount', label: 'Tornados', min: 0, max: 8, step: 1, sect: 'world', scope: 'r5', def: 2, fmt: (v) => String(Math.round(v)) },
  { key: 'quicksandCount', label: 'Quicksand pools', min: -1, max: 10, step: 1, sect: 'world', scope: 'r5', def: -1, fmt: fCount },
  { key: 'trainSeed', label: 'Random seed', min: -1, max: 999, step: 1, sect: 'world', scope: 'always', def: -1, fmt: (v) => (v < 0 ? 'auto' : String(Math.round(v))) },
];


const STYLE = `
#rl-panel{position:fixed;top:0;left:0;height:100%;width:388px;z-index:10;
  transform:translateX(calc(-100% - 24px));
  transition:transform .5s cubic-bezier(.19,1,.22,1),width .5s cubic-bezier(.16,1,.3,1);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:#1f1f21;background:#f3f4f6;box-shadow:3px 0 30px rgba(0,0,0,.24);
  border-right:1px solid #e0e2e6;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-ms-overflow-style:none;}
#rl-panel.open{transform:translateX(0);}
/* scroll stays, scrollbar hidden (Chromium/WebKit here; Firefox/IE via the rule above) */
#rl-panel::-webkit-scrollbar{width:0;height:0;display:none;}

/* sticky header with the live matchup */
#rl-panel .hdr{position:sticky;top:0;z-index:2;padding:15px 16px 14px;background:#fff;
  border-bottom:1px solid #e6e8ec;}
#rl-panel .hdr h1{margin:0;font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#a2a5ac;
  display:flex;align-items:center;gap:8px;}
#rl-panel .hdr h1::before{content:"";width:4px;height:12px;border-radius:2px;background:#1f5fd0;}
/* round badge + arena name */
#rl-panel .hdr .harena{display:flex;align-items:center;gap:9px;margin-top:9px;}
#rl-panel .hdr .rbadge{flex:none;font-size:10px;font-weight:800;color:#fff;background:#1f5fd0;border-radius:6px;
  padding:3px 8px;font-variant-numeric:tabular-nums;letter-spacing:.3px;}
#rl-panel .hdr .harena b{font-size:19px;font-weight:800;letter-spacing:-.4px;color:#1f1f21;}
/* the model being trained + who it faces */
#rl-panel .hdr .myalgo{margin-top:12px;padding-top:11px;border-top:1px solid #f0f1f3;}
#rl-panel .hdr .myalgo .mlabel{display:block;font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#a2a5ac;}
#rl-panel .hdr .myalgo b{display:block;font-size:20px;font-weight:800;color:#1f5fd0;letter-spacing:-.3px;line-height:1.15;margin-top:3px;}
#rl-panel .hdr .myalgo em{display:block;font-style:normal;font-size:10.5px;color:#9a9da4;margin-top:5px;}
/* fullscreen toggle (top-right of the header) */
#rl-panel .hdr .fullbtn{position:absolute;top:12px;right:14px;flex:none;width:32px;height:32px;padding:0;
  display:grid;place-items:center;border:1px solid #d7dade;border-radius:8px;background:#fff;color:#54565c;cursor:pointer;}
#rl-panel .hdr .fullbtn:hover{background:#f0f1f3;border-color:#c4c8ce;color:#1f1f21;}
#rl-panel .hdr .fullbtn svg{width:16px;height:16px;display:block;}
/* ===== FULLSCREEN DASHBOARD: ONE centred grid. Group wrappers melt away
   (display:contents) so every card shares the same columns, and JS gives each
   card a row-span equal to its height - a true masonry that stays column-aligned
   and packs tight (no ragged gaps, no stray empty space). ===== */
#rl-panel.full{box-sizing:border-box;width:100vw;max-width:100vw;border-right:none;background:#edeff4;padding:0;}
#rl-panel.full .rl-body{max-width:1440px;margin:0 auto;padding:30px 32px 96px;display:block;}
/* each group is a full-width BAND: a title, then a grid whose columns STRETCH to
   fill the width (auto-fit), so there is never an empty column on the right. JS
   then row-spans each card to its height, so heights pack with no ragged gaps. */
#rl-panel.full .rl-group{margin:0 0 28px;}
#rl-panel.full .rl-group-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));
  grid-auto-rows:8px;gap:16px;align-items:start;grid-auto-flow:row dense;}
#rl-panel.full .rl-group-h{display:block;margin:0 0 16px;padding:6px 0 12px;
  font-size:19px;font-weight:800;letter-spacing:-.3px;text-transform:none;color:#22232a;border-bottom:2px solid #dce0e8;}
#rl-panel.full .rl-group-h::before{content:"";display:inline-block;width:6px;height:18px;border-radius:3px;
  background:#1f5fd0;vertical-align:-2px;margin-right:10px;}
#rl-panel.full .rl-group:not(:has(section:not([hidden]))){display:none;}
/* header = the page title bar */
#rl-panel.full .hdr{position:static;background:transparent;border:none;padding:0 2px 18px;margin:0;}
#rl-panel.full .hdr h1{font-size:12px;letter-spacing:1px;}
#rl-panel.full .hdr h1::before{width:4px;height:13px;border-radius:2px;}
#rl-panel.full .hdr .harena{margin-top:11px;gap:11px;}
#rl-panel.full .hdr .harena b{font-size:27px;letter-spacing:-.7px;}
#rl-panel.full .hdr .rbadge{font-size:12px;padding:4px 11px;}
#rl-panel.full .hdr .myalgo{display:inline-block;margin-top:13px;padding-top:0;border-top:none;}
#rl-panel.full .hdr .myalgo b{font-size:21px;}
#rl-panel.full .hdr .fullbtn{top:2px;right:2px;width:40px;height:40px;border-radius:11px;}
#rl-panel.full .hdr .fullbtn svg{width:20px;height:20px;}
/* every card: identical chrome, sized to its content (align-self:start), row-span set by JS */
#rl-panel.full .rl-group-cards > section{margin:0;align-self:start;padding:17px 18px;border-radius:15px;background:#fff;
  border:1px solid #e6e9f0;box-shadow:0 1px 3px rgba(20,20,40,.05);min-width:0;}
#rl-panel.full section h2{font-size:10px;letter-spacing:1px;margin-bottom:13px;}
/* wide cards (charts, tables, replays) take two columns */
#rl-panel.full section.span2{grid-column:span 2;}
@media (max-width:940px){#rl-panel.full section.span2{grid-column:span 2;}}
/* consistent chart height across the whole board */
#rl-panel.full .chart{margin:0 0 13px;}
#rl-panel.full .chart:last-child{margin-bottom:0;}
#rl-panel.full .chart canvas{height:132px;border-radius:10px;}
#rl-panel.full .chart .ct h3{font-size:12.5px;}
#rl-panel.full .chart .ct .lg{font-size:10px;}
/* the MDP briefing is a lone full-width card -> lay its rows out in 2 columns so
   it reads as a filled spec sheet instead of a sparse label/value strip */
#rl-panel.full #rl-brief-body{columns:2;column-gap:44px;}
#rl-panel.full #rl-brief-body>*{break-inside:avoid;}
#rl-panel.full #rl-brief-body .brief-matchup,#rl-panel.full #rl-brief-body .brief-sub:first-child{column-span:all;}
#rl-panel.full .stat{font-size:13.5px;padding:9px 0;}
#rl-panel.full .stat b{font-size:14px;}
#rl-panel.full .ctl{margin-bottom:15px;}
#rl-panel.full .ctl .row{font-size:13px;margin-bottom:7px;}
#rl-panel.full input[type=range]{height:5px;}
#rl-panel.full .btns button{padding:10px 8px;font-size:12.5px;}
#rl-panel.full .transport{gap:16px;}
#rl-panel.full .tbtn{width:44px;height:44px;}
#rl-panel.full .tplay{width:52px;height:52px;}
#rl-panel.full .seg button{padding:9px 6px;font-size:12px;}
#rl-panel.full .hint,#rl-panel.full .note{font-size:11px;}

/* ===== quick (docked) vs full view =========================================
   Docked = a curated QUICK VIEW: only the '.qk' cards, and inside them only the
   quick rows/charts ('.fullonly' bits hidden). Fullscreen shows everything,
   organised into the big titled groups above. */
#rl-panel .rl-group-h{display:none;}                 /* group titles: fullscreen only */
#rl-panel:not(.full) .rl-group{margin:0;}
#rl-panel:not(.full) .rl-group-cards > section:not(.qk){display:none;}
#rl-panel:not(.full) .fullonly{display:none;}
#rl-panel:not(.full) section.qk-nohdr > h2{display:none;} /* one chart, no heavy header */
/* a small "expand for everything" hint under the quick view */
#rl-panel .rl-morehint{display:none;margin:2px 12px 16px;padding:10px 13px;border-radius:11px;
  background:#eef1f7;border:1px solid #e2e6ee;color:#6a6d75;font-size:11.5px;line-height:1.4;cursor:pointer;}
#rl-panel .rl-morehint b{color:#1f5fd0;}
#rl-panel:not(.full) .rl-morehint{display:block;}
#rl-panel .rl-morehint:hover{background:#e7ebf4;}

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
#rl-panel .bar .t{background:#8a8d94;}
#rl-panel .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:middle;}
/* action-distribution rows: a label + a Red mini-bar over a Blue mini-bar */
#rl-panel .actlist{display:flex;flex-direction:column;gap:8px;}
#rl-panel .actrow{display:flex;align-items:center;gap:9px;}
#rl-panel .actrow .al{width:34px;flex:none;font-size:11.5px;font-weight:700;color:#54565c;}
#rl-panel .actrow .ab{flex:1;height:7px;border-radius:4px;background:#eceef1;overflow:hidden;position:relative;}
#rl-panel .actrow .ab+.ab{margin-top:0;}
#rl-panel .actrow .ab i{display:block;height:100%;transition:width .3s;}
#rl-panel .actrow .ab i.r{background:#e60012;} #rl-panel .actrow .ab i.b{background:#1f5fd0;}
/* briefing card + two-column (Red vs Blue) comparison tables */
#rl-panel .brief-matchup{font-size:14.5px;font-weight:800;color:#1f1f21;margin:0 0 3px;letter-spacing:-.2px;}
#rl-panel .brief-sub{font-size:10px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:#8a8d94;margin:15px 0 7px;}
#rl-panel .cmp-head{display:flex;align-items:center;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#a2a5ac;padding:0 0 6px;border-bottom:1px solid #f0f1f3;}
#rl-panel .cmp-head span{flex:1;}
#rl-panel .cmp-head .cr,#rl-panel .cmp-head .cb{flex:none;width:66px;text-align:right;}
#rl-panel .cmp-head .cr{color:#e60012;} #rl-panel .cmp-head .cb{color:#1f5fd0;}
#rl-panel .cmp-row{display:flex;align-items:center;font-size:12.5px;padding:8px 0;border-bottom:1px solid #f0f1f3;}
#rl-panel .cmp-row:last-child{border-bottom:0;}
#rl-panel .cmp-row .cl{flex:1;color:#54565c;}
#rl-panel .cmp-row .cr,#rl-panel .cmp-row .cb{flex:none;width:66px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;padding-right:9px;position:relative;}
#rl-panel .cmp-row .cr{color:#e60012;} #rl-panel .cmp-row .cb{color:#1f5fd0;}
#rl-panel .cmp-row .win::after{content:"";position:absolute;right:1px;top:50%;transform:translateY(-50%);width:5px;height:5px;border-radius:50%;background:currentColor;}

/* descriptive note under the Algorithm-internals / World settings cards */
#rl-panel .cfgnote{font-size:10.5px;color:#a2a5ac;margin:12px 0 0;line-height:1.45;}

/* segmented control (value-map mode) */
#rl-panel .seg{display:flex;border:1px solid #d7dade;border-radius:9px;overflow:hidden;}
#rl-panel .seg button{flex:1;border:0;border-right:1px solid #d7dade;border-radius:0;background:#fff;}
#rl-panel .seg button:last-child{border-right:0;}
#rl-panel .seg button.active{background:#1f1f21;color:#fff;}

/* top-30 replay browser (per model) */
#rl-panel .replist{max-height:196px;overflow-y:auto;margin:10px 0 0;border:1px solid #e6e8ec;border-radius:10px;}
#rl-panel .replist .rrow{display:flex;align-items:center;gap:10px;padding:8px 11px;font-size:12px;cursor:pointer;
  border-bottom:1px solid #f0f1f3;}
#rl-panel .replist .rrow:last-child{border-bottom:0;}
#rl-panel .replist .rrow:hover{background:#f0f1f3;}
#rl-panel .replist .rrow.sel{background:#eaf0fb;box-shadow:inset 3px 0 0 #1f5fd0;}
#rl-panel .replist .rrow .rk{color:#9a9da4;font-weight:800;width:30px;flex:none;}
#rl-panel .replist .rrow .st{font-variant-numeric:tabular-nums;font-weight:700;color:#1f1f21;}
#rl-panel .replist .rrow .ep{margin-left:auto;color:#9a9da4;font-size:11px;font-variant-numeric:tabular-nums;}
#rl-panel .replist .empty{padding:15px 12px;color:#9a9da4;font-size:12px;text-align:center;}
/* fullscreen: let the list breathe */
#rl-panel.full .replist{max-height:340px;}
#rl-panel.full .replist .rrow{font-size:14px;padding:11px 14px;}

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

// Fold every card into big titled groups. The fullscreen dashboard shows the
// group titles + all cards; the docked quick view (CSS) reveals only the '.qk'
// cards. A catch-all 'More' group guarantees any unmapped/future section still
// appears (never silently dropped). Shared by both the N and M panels.
//   groups   = [[id, title, [sectionId, ...]], ...]
//   fullSel  = selector of the expand-to-fullscreen button (for the hint click)
//   hintHTML = docked "expand for more" hint text
export function organizeGroups(body, groups, fullSel, hintHTML, wideIds = []) {
  const wide = new Set(wideIds);
  const mk = (id, title) => {
    const g = document.createElement('div');
    g.className = 'rl-group';
    g.dataset.group = id;
    g.innerHTML = `<h2 class="rl-group-h">${title}</h2><div class="rl-group-cards"></div>`;
    return g;
  };
  const els = groups.map(([id, title, ids]) => {
    const g = mk(id, title);
    const cards = g.querySelector('.rl-group-cards');
    for (const sid of ids) {
      const sec = body.querySelector('#' + sid);
      if (sec) {
        if (wide.has(sid)) sec.classList.add('span2'); // charts/tables take 2 cols
        cards.appendChild(sec); // moves the node out of the flat body
      }
    }
    return g;
  });
  const leftover = [...body.querySelectorAll(':scope > section')];
  if (leftover.length) {
    const g = mk('more', 'More');
    const cards = g.querySelector('.rl-group-cards');
    leftover.forEach((s) => cards.appendChild(s));
    els.push(g);
  }
  for (const g of els) body.appendChild(g);
}

// True masonry on the fullscreen grid: give each visible card a grid-row-span
// equal to its measured height, so the columns stay aligned while cards pack
// tight. Re-runs on resize, snapshots (content can grow) and whenever a card
// resizes (charts drawing). No-op while docked.
//
// The cards are `align-self:start`, so getBoundingClientRect already reports each
// card's NATURAL content height - we must NOT reset every span to '' first (that
// momentarily collapses the whole grid, and since this runs ~30x/s on snapshots
// the scroll container clamps its scrollTop to the tiny collapsed range every
// time, making it impossible to scroll down). Measure in place; only write a span
// when it actually changes, so a steady stream of snapshots is a no-op.
export function attachMasonry(panel, body) {
  const relayout = () => {
    if (!panel.classList.contains('full')) return;
    const cs = getComputedStyle(body);
    const rowH = parseFloat(cs.gridAutoRows) || 8;
    const gap = parseFloat(cs.rowGap || cs.gap) || 18;
    body.querySelectorAll('.rl-group-cards > section').forEach((el) => {
      if (el.offsetParent === null) return; // hidden this round
      const h = el.getBoundingClientRect().height;
      const span = 'span ' + Math.max(1, Math.ceil((h + gap) / (rowH + gap)));
      if (el.style.gridRowEnd !== span) el.style.gridRowEnd = span;
    });
  };
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(relayout);
  };
  panel._relayout = schedule;
  window.addEventListener('resize', schedule);
  window.addEventListener('rl-snapshot', () => panel.classList.contains('full') && schedule());
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => panel.classList.contains('full') && schedule());
    body.querySelectorAll('.rl-group-cards > section').forEach((s) => ro.observe(s));
  }
  return schedule;
}

const N_GROUPS = [
  ['control', 'Control', ['rl-sec-playback', 'rl-sec-hyper', 'rl-sec-algo', 'rl-sec-world']],
  ['status', 'Live Status', ['rl-sec-training', 'rl-sec-contest', 'rl-compare']],
  ['problem', 'The Problem', ['rl-brief']],
  ['learning', 'Learning Progress', ['rl-curve-d-rate', 'rl-curve-d-return', 'rl-curve-d-eps', 'rl-curve-d-len', 'rl-curve-d-td', 'rl-probe', 'rl-reward', 'rl-explore']],
  ['policy', 'Policy &amp; Value', ['rl-sec-value', 'rl-polagree', 'rl-dp', 'rl-va', 'rl-dqn', 'rl-outcomes', 'rl-actdist']],
  ['replays', 'Replays', ['rl-replay', 'rl-traj']],
];

export function initPanel() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const ctlHTML = (p) => `
    <div class="ctl" data-scope="${p.scope}">
      <div class="row"><span>${p.label}</span><b id="rl-pv-${p.key}">-</b></div>
      <input type="range" id="rl-p-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.min}" style="--fill:${p.color || C_GLOBAL}">
    </div>`;
  const algoParams = GLOBAL_PARAMS.filter((p) => p.sect === 'algo');
  const worldParams = GLOBAL_PARAMS.filter((p) => p.sect === 'world');

  const panel = document.createElement('div');
  panel.id = 'rl-panel';
  panel.innerHTML = `
    <div class="rl-body">
    <div class="hdr">
      <button id="rl-full" class="fullbtn" type="button" title="Fullscreen">${SVG.expand}</button>
      <h1>Training Control</h1>
      <div class="harena"><span class="rbadge" id="rl-round">-</span><b id="rl-arena">-</b></div>
      <div class="myalgo">
        <span class="mlabel">Your model</span>
        <b id="rl-mb">-</b>
        <em id="rl-vs"></em>
      </div>
    </div>
    <section id="rl-sec-playback" class="qk">
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
    <section id="rl-sec-hyper" class="qk">
      <h2>Hyperparameters</h2>
      <div class="plegend">
        <span><i style="background:#1f5fd0"></i>Your model (Blue)</span>
        <span><i style="background:#8a8d94"></i>Both models</span>
      </div>
      ${PARAMS.map(ctlHTML).join('')}
      <p class="note fullonly">Blue sliders tune your model. Red (the CPU) trains at a strength set by the
        chosen character's tier. Gray sliders are shared by both. Each round shows only the
        controls its algorithm uses: DP rounds plan with the discount γ; the learning rounds
        add the learning rate α and the ε exploration schedule.</p>
    </section>
    <section id="rl-sec-algo">
      <h2>Algorithm internals</h2>
      <p class="cfgnote" style="margin-top:0;margin-bottom:12px;">Shared by both models. Each round shows only
        its family: DP rounds expose convergence + sweeps; the neural rounds expose the replay / batch / target-net knobs.</p>
      ${algoParams.map(ctlHTML).join('')}
    </section>
    <section id="rl-sec-world">
      <h2>World &amp; dynamics</h2>
      <p class="cfgnote" style="margin-top:0;margin-bottom:12px;">The environment itself: how slippery, how fast the
        agents move, and how many hazards. Changing a hazard count or the seed rebuilds the arena and restarts the contest.</p>
      ${worldParams.map(ctlHTML).join('')}
    </section>
    <section id="rl-sec-training" class="qk">
      <h2>Training</h2>
      <div class="stat"><span>Episode</span><b id="rl-ep">0</b></div>
      <div class="stat"><span>Exploration ε</span><b id="rl-eps">1.00</b></div>
      <div class="stat fullonly"><span>Total steps</span><b id="rl-steps">0</b></div>
      <div class="stat fullonly"><span>Avg episode length</span><b id="rl-len">-</b></div>
      <div class="stat fullonly"><span>Last return (R / B)</span><b id="rl-ret">-</b></div>
      <div class="stat fullonly"><span>Learned states (R / B)</span><b id="rl-q">0 / 0</b></div>
    </section>
    <section id="rl-sec-contest" class="qk">
      <h2>Contest - recent</h2>
      <div class="bar"><i class="r" id="rl-br"></i><i class="b" id="rl-bb"></i><i class="d" id="rl-bd"></i></div>
      <div class="stat"><span><i class="dot" style="background:#e60012"></i>Red wins</span><b id="rl-wr">0</b></div>
      <div class="stat"><span><i class="dot" style="background:#1f5fd0"></i>Blue wins</span><b id="rl-wb">0</b></div>
      <div class="stat"><span><i class="dot" style="background:#c6c9cf"></i>Draws</span><b id="rl-wd">0</b></div>
    </section>
    <section id="rl-sec-value" class="qk">
      <h2>Value map · your model</h2>
      <div class="seg">
        <button id="rl-h-off" class="active">Off</button>
        <button id="rl-h-value">Value</button>
        <button id="rl-h-policy">Policy</button>
        <button id="rl-h-visits">Visits</button>
      </div>
      <p class="hint fullonly">Value: each tile shows its Q for N / S / W / E, greedy action in blue (a blue
        number in the center means "Use / stay" is best). Visits: where it travels (red = most
        stepped on, blue = least). Zoom in to read the numbers.</p>
      <div id="rl-qinspect" style="margin-top:8px;"></div>
    </section>
    </div>`;
  document.body.appendChild(panel);

  // learning-curve charts + episode replay (built by graphs.js) - into the same
  // .rl-body wrapper so fullscreen can flow every card through one masonry column set
  const body = panel.querySelector('.rl-body');
  initGraphs(body);
  // fold every card (native + the ~14 graphs.js sections) into the six big titled
  // groups the fullscreen dashboard shows; docked quick view then reveals only the
  // '.qk' cards. Any section not named still shows (catch-all group) so nothing is
  // ever silently dropped.
  organizeGroups(
    body,
    N_GROUPS,
    '#rl-full',
    'Quick view. <b>Expand ↗</b> for the full dashboard: hyperparameters, ' +
      'learning curves, value maps, replays and more.',
  );
  attachMasonry(panel, body);

  const $ = (id) => panel.querySelector(id);

  // paint the filled (left-of-thumb) part of a range slider red
  const paintRange = (el) => {
    if (!el) return;
    const min = +el.min, max = +el.max, v = +el.value;
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    const fill = el.style.getPropertyValue('--fill') || '#8a8d94';
    el.style.background = `linear-gradient(to right,${fill} ${pct}%,#e1e3e8 ${pct}%)`;
  };

  // ---- toggle (N key only) ----
  const toggle = () => {
    panel.classList.toggle('open');
    if (!panel.classList.contains('open')) panel.classList.remove('full'); // closing exits fullscreen too
  };
  if (new URLSearchParams(location.search).has('panel')) panel.classList.add('open');
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyN' || /input|select|textarea/i.test(e.target.tagName)) return;
    if (getComputedStyle(panel).display === 'none') return; // hidden while the start menu is up
    toggle();
  });
  // ---- fullscreen dashboard: expand the panel to fill the screen + reflow to a grid
  const fullBtn = $('#rl-full');
  fullBtn.addEventListener('click', () => {
    const on = panel.classList.toggle('full');
    fullBtn.innerHTML = on ? SVG.collapse : SVG.expand;
    fullBtn.title = on ? 'Exit fullscreen' : 'Fullscreen';
    // going fullscreen takes over the screen -> close the other (CPU) panel
    if (on) document.getElementById('rl-cpanel')?.classList.remove('open', 'full');
    // re-fit the charts + re-pack the masonry THROUGH the grow animation
    [0, 120, 260, 400, 560].forEach((t) =>
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        panel._relayout?.();
      }, t),
    );
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

  // ---- hyperparameters + global settings: drive the trainer live (debounced) ----
  // one combined list so labels / seeding / sends cover both the per-side learning
  // sliders (PARAMS) and the global structural sliders (GLOBAL_PARAMS).
  const ALL_PARAMS = [...PARAMS, ...GLOBAL_PARAMS];
  const setLabel = (p) => {
    $(`#rl-pv-${p.key}`).textContent = p.fmt(+$(`#rl-p-${p.key}`).value);
    paintRange($(`#rl-p-${p.key}`));
  };
  // send only the keys the user actually touched, so nudging α never triggers the
  // world rebuild that a structural key (hazard counts / seed) does.
  let applyTimer = null;
  let pending = {};
  const flush = () => {
    if (Object.keys(pending).length) window.RL.control({ cmd: 'setParams', params: pending });
    pending = {};
  };
  const queue = (p) => {
    const raw = +$(`#rl-p-${p.key}`).value;
    pending[p.key] = p.enc ? p.enc(raw) : raw;
    clearTimeout(applyTimer);
    applyTimer = setTimeout(flush, 160);
  };
  for (const p of ALL_PARAMS) {
    setLabel(p);
    $(`#rl-p-${p.key}`).addEventListener('input', () => { setLabel(p); queue(p); });
  }
  // set a slider from a BACKEND-space value (dec-maps enc params) - seeding only
  const setFromBackend = (p, val) => {
    const el = $(`#rl-p-${p.key}`);
    if (!el || val == null) return;
    el.value = p.dec ? p.dec(val) : val;
    setLabel(p);
  };

  let paramsInit = false;   // pull the backend defaults onto the sliders just once
  let lastAlgoBlue = null;  // to re-show only the relevant controls when the round changes
  let lastRoundIndex = -1;  // r4/r5 hazard sliders are scoped by round, not just algo

  // show only the controls that matter for THIS round: hide α / ε on DP rounds
  // (planners use only γ); DP / DQN internals + arena dynamics + hazard counts each
  // appear only where they apply. Then hide any settings card left empty.
  const showRelevant = (algoBlue, roundIndex) => {
    const isDP = DP_ALGOS.has(algoBlue);
    const isDqn = DQN_ALGOS.has(algoBlue);
    const vis = (sc) => {
      switch (sc) {
        case 'learn': return !isDP;               // learning rate + exploration: not for DP
        case 'dp': return isDP;                   // convergence + sweeps: DP rounds
        case 'dqn': return isDqn;                 // replay / batch / target-net: neural rounds
        case 'cont': return isDqn;                // arena dynamics: continuous rounds
        case 'slip': return !isDP && !isDqn;      // slippery junctions: model-free grids (R2/R3)
        case 'r4': return roundIndex === 3;       // ruins count: Round 4 only
        case 'r5': return roundIndex === 4;       // tornados / quicksand: Round 5 only
        default: return true;                     // 'always'
      }
    };
    panel.querySelectorAll('.ctl[data-scope]').forEach((el) => {
      el.style.display = vis(el.dataset.scope) ? '' : 'none';
    });
    // collapse a settings card whose every slider is now hidden
    ['rl-sec-hyper', 'rl-sec-algo', 'rl-sec-world'].forEach((id) => {
      const sec = panel.querySelector('#' + id);
      if (!sec) return;
      sec.hidden = ![...sec.querySelectorAll('.ctl[data-scope]')].some((el) => el.style.display !== 'none');
    });
  };

  // ---- value-map mode ----
  // value map: this panel always shows OUR model (Blue), modes Off / Value / Visits
  const hbtns = { off: $('#rl-h-off'), value: $('#rl-h-value'), policy: $('#rl-h-policy'), visits: $('#rl-h-visits') };
  const setMode = (m) => {
    for (const k in hbtns) hbtns[k].classList.toggle('active', k === m);
    if (m === 'off') { window.RL.setHeatmap(null); $('#rl-qinspect').innerHTML = ''; }
    else window.RL.setHeatmap('blue', m);
  };
  hbtns.off.addEventListener('click', () => setMode('off'));
  hbtns.value.addEventListener('click', () => setMode('value'));
  hbtns.policy.addEventListener('click', () => setMode('policy'));
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
    // seed every slider from the backend's current values, once
    if (!paramsInit && s.params) {
      for (const p of ALL_PARAMS) setFromBackend(p, s.params[p.key]);
      paramsInit = true;
    }
    $('#rl-mb').textContent = NAMES[s.algoBlue] || s.algoBlue || '-';
    const redNm = NAMES[s.algoRed] || s.algoRed || '';
    const tier = s.cpuTier ? `CPU · Tier ${s.cpuTier}` : '';
    $('#rl-vs').textContent = redNm
      ? `vs ${redNm}${tier ? ` · ${tier}` : ''}`
      : (tier ? `vs ${tier}` : '');
    const r = s.round || {};
    const ri = r.index ?? 0;
    if (s.algoBlue !== lastAlgoBlue || ri !== lastRoundIndex) {
      lastAlgoBlue = s.algoBlue; lastRoundIndex = ri;
      showRelevant(s.algoBlue, ri);
    }
    $('#rl-round').textContent = `R${ri + 1} · ${r.total || 1}`;
    $('#rl-arena').textContent = r.title || '';
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
