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
  monte_carlo: 'Every-visit MC', first_visit_mc: 'First-visit MC',
  dqn: 'DQN', double_dqn: 'Double-DQN', dueling_dqn: 'Dueling-DQN',
  reinforce: 'REINFORCE', actor_critic: 'Actor-Critic', ppo: 'PPO',
};
const ACTION_NAMES = ['North', 'South', 'West', 'East'];

// slider 0..100 <-> steps/sec on a log scale (2 .. 15000)
const sliderToSpeed = (v) => Math.round(Math.pow(15000, v / 100)); // 1/s (v=0) -> 15000/s (v=100)

// per-level control scoping. DP planners (Value / Policy Iteration) plan with the
// discount γ + a planning-speed knob, so the learning controls (α, ε) hide there.
// Neural-net (DQN) controls only ever show on a DQN round.
export const DP_ALGOS = new Set(['value_iteration', 'policy_iteration']);
export const DQN_ALGOS = new Set(['dqn', 'double_dqn', 'dueling_dqn']);
export const PG_ALGOS = new Set(['reinforce', 'actor_critic', 'ppo']);

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
const C_GLOBAL = '#141518'; // black fill for the global / structural sliders (was gray)
const TIER_LABELS = { 1: 'Rookie', 2: 'Amateur', 3: 'Skilled', 4: 'Veteran', 5: 'Master' };

// tunable training hyperparameters - the panel writes these to the trainer live.
// PARAMS = the per-side LEARNING knobs (both the N and the mirrored M panel use
// this array). The global structural settings live in GLOBAL_PARAMS below and
// are rendered by the N (Training) panel only, since they are match-wide (not
// "Red's params") and route through setParams.
export const PARAMS = [
  { key: 'targetEpisodes', label: 'Stop after (episodes)', min: 0, max: 20000, step: 100, color: C_GLOBAL, scope: 'always', desc: 'Stops new training episodes at this count. 0 keeps running.', fmt: (v) => (v <= 0 ? 'no limit' : (+v).toLocaleString()) },
  { key: 'maxSteps', label: 'Max steps / episode', min: 50, max: 1000, step: 10, color: C_GLOBAL, scope: 'always', desc: 'Ends an episode as a timeout if nobody reaches the goal in time.', fmt: (v) => (+v).toLocaleString() },
  { key: 'alpha', label: 'Learning rate α', min: 0.01, max: 1, step: 0.01, color: C_OURS, scope: 'learn', desc: 'How strongly one new experience changes this model. Dynamic Programming does not use α.', fmt: (v) => (+v).toFixed(2) },
  { key: 'gamma', label: 'Discount γ', min: 0, max: 1, step: 0.01, color: C_OURS, scope: 'always', desc: 'How much future rewards matter. Higher values make the model plan farther ahead.', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsStart', label: 'ε start', min: 0, max: 1, step: 0.01, color: C_OURS, scope: 'eps', desc: 'Chance of a random action at the start of training.', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsEnd', label: 'ε end', min: 0, max: 0.5, step: 0.01, color: C_OURS, scope: 'eps', desc: 'Final random-action chance after decay. It does not have to reach zero.', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsEpisodes', label: 'ε decay (episodes)', min: 100, max: 20000, step: 100, color: C_OURS, scope: 'eps', desc: 'Episodes needed to move linearly from ε start to ε end—not to zero.', fmt: (v) => (+v).toLocaleString() },
];

// shared display + reset helpers
const fLoc = (v) => (+v).toLocaleString();
const fCount = (v) => (v < 0 ? 'default' : String(Math.round(v)));   // -1 = built-in

// GLOBAL settings (N panel only), scoped per round by showRelevant():
//   'dp'   -> DP planners (Value/Policy Iteration): convergence + sweep cap + speed
//   'dqn'  -> neural value rounds: replay / batch / target-net / width
//   'always' -> every round (the reproducibility seed)
// (The game-mechanic scopes 'cont'/'slip'/'r4'/'r5' are gone with the hazards.)
// `sect` places the slider in the Algorithm-internals ('algo') or World ('world')
// card. `def` is the backend default (for Reset). `enc`/`dec` map slider-space
// <-> backend-space where they differ (dpTheta rides a log/exponent slider).
export const GLOBAL_PARAMS = [
  // --- algorithm internals ---
  { key: 'dpTheta', label: 'Convergence tolerance θ', min: -9, max: -1, step: 1, sect: 'algo', scope: 'dp', def: 1e-5,
    desc: 'Converged when the largest value change is below θ. Left is stricter; right stops earlier.',
    enc: (e) => Math.pow(10, Math.round(e)), dec: (t) => Math.max(-9, Math.min(-1, Math.round(Math.log10(t || 1e-5)))),
    fmt: (e) => (10 ** Math.round(e)).toFixed(-Math.round(e)) },
  { key: 'dpMaxIters', label: 'Maximum Bellman sweeps', min: 50, max: 5000, step: 50, sect: 'algo', scope: 'dp', def: 2000,
    desc: 'Safety cap on total planning sweeps. Raise it only if the model reaches the cap before convergence.', fmt: fLoc },
  { key: 'dpPlanning', label: 'Planning speed (sweeps / step)', min: 0.1, max: 5, step: 0.1, color: C_OURS, sect: 'algo', scope: 'dp', def: 0.6,
    desc: 'Bellman sweeps this selected model performs per game step. This is the Stage-1 race-speed control.', fmt: (v) => (+v).toFixed(1) },
  { key: 'dqnBatch', label: 'Batch size', min: 8, max: 256, step: 8, sect: 'algo', scope: 'dqn', def: 64, fmt: fLoc },
  { key: 'dqnBuffer', label: 'Replay buffer', min: 5000, max: 200000, step: 5000, sect: 'algo', scope: 'dqn', def: 50000, fmt: fLoc },
  { key: 'dqnWarmup', label: 'Warmup steps', min: 0, max: 10000, step: 250, sect: 'algo', scope: 'dqn', def: 1000, fmt: fLoc },
  { key: 'dqnTargetSync', label: 'Target sync (steps)', min: 50, max: 5000, step: 50, sect: 'algo', scope: 'dqn', def: 500, fmt: fLoc },
  { key: 'dqnHidden', label: 'Hidden width', min: 32, max: 512, step: 32, sect: 'algo', scope: 'dqn', def: 128, fmt: fLoc },
  // --- Round-1 game mechanics (Peach's Castle: ice puddles + "?" ghost/freeze blocks).
  // Only rounds 2-5 are still bare skeletons; R1 is a real stochastic MDP, so these
  // scope to 'r1' and live in the World card. Each edit re-solves both DP planners. ---
  { key: 'slipProb', label: 'Puddle slip chance', min: 0, max: 0.9, step: 0.05, sect: 'world', scope: 'r1', def: 0.30, desc: 'Chance that an ice move goes sideways; the two side directions split this probability.', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'blockGhostProb', label: '? block: Ghost chance', min: 0, max: 1, step: 0.05, sect: 'world', scope: 'r1', def: 0.5, desc: 'Probability that a ? block grants Ghost. The remaining probability causes Freeze.', fmt: (v) => `${Math.round(v * 100)}% (else Freeze)` },
  { key: 'ghostLen', label: 'Ghost length (tiles)', min: 1, max: 8, step: 1, sect: 'world', scope: 'r1', def: 4, desc: 'Number of landed tiles for which wall-phasing stays active.', fmt: (v) => `${Math.round(v)}` },
  { key: 'freezeLen', label: 'Freeze length (turns)', min: 1, max: 8, step: 1, sect: 'world', scope: 'r1', def: 3, desc: 'Turns lost when a ? block produces Freeze.', fmt: (v) => `${Math.round(v)}` },
  { key: 'coinReward', label: 'Coin value', min: 0, max: 1, step: 0.05, sect: 'world', scope: 'r1', def: 0.2, desc: 'Optional reward added once when the model collects one of its coins.', fmt: (v) => (+v).toFixed(2) },
  { key: 'blockReward', label: 'Ghost bonus', min: 0, max: 1, step: 0.05, sect: 'world', scope: 'r1', def: 0.15, desc: 'One-time reward when a ? block grants Ghost.', fmt: (v) => (+v).toFixed(2) },
  // --- reproducibility ---
  { key: 'trainSeed', label: 'Random seed', min: -1, max: 999, step: 1, sect: 'world', scope: 'always', def: -1, fmt: (v) => (v < 0 ? 'auto' : String(Math.round(v))) },
];


const STYLE = `
@property --hue{syntax:'<color>';inherits:true;initial-value:#1f5fd0;}
#rl-panel{position:fixed;top:0;left:0;height:100%;width:465px;z-index:62;--hue:#1f5fd0;
  transform:translateX(calc(-100% - 24px));
  transition:transform .5s cubic-bezier(.19,1,.22,1),width .5s cubic-bezier(.16,1,.3,1),--hue .3s ease;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:#1f1f21;background:#f3f4f6;box-shadow:3px 0 30px rgba(0,0,0,.24);
  overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-ms-overflow-style:none;}
#rl-panel.open{transform:translateX(0);}
/* scroll stays, scrollbar hidden (Chromium/WebKit here; Firefox/IE via the rule above) */
#rl-panel::-webkit-scrollbar{width:0;height:0;display:none;}

/* sticky header with the live matchup */
#rl-panel .hdr{position:sticky;top:0;z-index:2;padding:15px 16px 14px;background:#fff;
  border-bottom:1px solid #e6e8ec;}
/* arena name (left) + round tag pushed to the far right - the header's title row.
   On the CPU model the lock swings in top-right, so reserve space then to avoid an overlap. */
#rl-panel .hdr .harena{display:flex;align-items:center;gap:10px;margin-top:0;
  padding-right:0;transition:padding-right .3s ease;}
#rl-panel[data-model="cpu"] .hdr .harena{padding-right:42px;}
/* circular close button at the top-left of the header - closes (slides out) the panel */
#rl-panel .hdr .closebtn{flex:none;width:24px;height:24px;padding:0;border-radius:50%;border:0;
  background:#1f1f21;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;}
#rl-panel .hdr .closebtn svg{width:12px;height:12px;display:block;}
/* 5 round-result dots (pushed to the right of the arena name): who won each round */
#rl-panel .hdr .rdots{flex:none;margin-left:auto;display:flex;gap:6px;align-items:center;}
#rl-panel .hdr .rdot{width:12px;height:12px;border-radius:50%;background:#d7dade;}   /* not played yet = grey */
#rl-panel .hdr .rdot.b{background:#1f5fd0;} #rl-panel .hdr .rdot.r{background:#e60012;} #rl-panel .hdr .rdot.d{background:#8b5cf6;}
#rl-panel .hdr .rdot.cur{box-shadow:0 0 0 2px #fff,0 0 0 3.5px #c4c8ce;}   /* the round in progress */
#rl-panel .hdr .harena b{font-size:23px;font-weight:800;letter-spacing:-.5px;color:#1f1f21;line-height:1.3;
  min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-bottom:1px;}
/* the model being trained + who it faces */
#rl-panel .hdr .myalgo{margin-top:12px;padding-top:11px;border-top:1px solid #f0f1f3;}
#rl-panel .hdr .myalgo .mlabel{display:block;font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#a2a5ac;}
/* the model selector: two plain text columns (Your model | CPU model), NO card boxes.
   A solid colour block (blue for you, red for CPU) sits behind the ACTIVE column;
   switching slides that block to the other side and recolours it (--hue). */
/* mselect spans the FULL panel width: -16px side margins cancel the .hdr padding, so each
   half of the block reaches a panel edge on its own (no reliance on bleeding through padding);
   -14px margin-bottom drops it to the header's bottom line. */
#rl-panel .hdr .mselect{position:relative;display:flex;gap:0;margin:12px -16px -14px;isolation:isolate;}
/* the solid colour block: square. Positioned by left/right INSETS (not width+transform) so
   the reaching edge is pinned straight to the panel edge (right:-2px / left:-2px overshoot,
   clipped by #rl-panel's overflow-x:hidden) with no transform sub-pixel rounding. The inner
   edge sits on centre; animating left+right keeps a constant width, so it still slides. */
#rl-panel .hdr .msel-wash{position:absolute;z-index:0;top:0;bottom:0;left:-2px;right:50%;pointer-events:none;
  background:var(--hue);border-radius:0;opacity:.82;
  transition:left .34s cubic-bezier(.4,.75,.2,1),right .34s cubic-bezier(.4,.75,.2,1);}
#rl-panel[data-model="cpu"] .hdr .msel-wash{left:50%;right:-2px;}
#rl-panel .hdr .msel{flex:1;min-width:0;text-align:left;border:0;border-radius:0;background:transparent;
  position:relative;z-index:1;display:flex;flex-direction:column;justify-content:center;padding:13px 16px;cursor:pointer;transition:opacity .2s;}
#rl-panel .hdr .msel.active{background:transparent;color:inherit;border-color:transparent;} /* neutralise the global button.active dark fill/white text */
#rl-panel .hdr .msel:not(.active){opacity:.45;}
#rl-panel .hdr .msel:not(.active):hover{opacity:.75;}
#rl-panel .hdr .msel .msel-k{display:block;font-size:8.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#a2a5ac;}
#rl-panel .hdr .msel .msel-n{display:block;font-size:16px;font-weight:800;letter-spacing:-.3px;line-height:1.15;margin-top:3px;color:#7c7f86;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .2s;}
#rl-panel .hdr .msel .msel-s{display:block;font-style:normal;font-size:9.5px;font-weight:700;color:#a8abb2;margin-top:4px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#rl-panel .hdr .msel.active .msel-n{color:#fff;} /* name goes white on the coloured block (was the same hue as the bg) */
/* on the active (coloured) band the label + subline go white; the model name keeps its accent */
#rl-panel .hdr .msel.active .msel-k{color:#fff;}
#rl-panel .hdr .msel.active .msel-s{color:rgba(255,255,255,.9);}
/* the CPU model tints the learning sliders + the tab accent red (--hue transitions) */
#rl-panel[data-model="cpu"]{--hue:#d4141f;}
#rl-panel .plegend .ple-hue{background:var(--hue);}
#rl-panel[data-model="cpu"] .rl-tab.active{color:#d4141f;}
#rl-panel[data-model="cpu"] .rl-tab-hl::before{background:radial-gradient(72% 118% at 50% 100%,rgba(212,20,31,.13),rgba(212,20,31,0) 70%);}
#rl-panel[data-model="cpu"] .rl-tab-hl::after{background:#d4141f;}
#rl-panel .hdr .myalgo b{display:block;font-size:20px;font-weight:800;color:#1f5fd0;letter-spacing:-.3px;line-height:1.15;margin-top:3px;}
#rl-panel .hdr .myalgo em{display:block;font-style:normal;font-size:10.5px;color:#9a9da4;margin-top:5px;}
/* ===== Playback sits at the top ALWAYS (not a tab); an underline tab row below
   it picks ONE section. Active tab = coloured text + a line under it with a soft
   glow rising above the line. ===== */
#rl-panel .hdr{z-index:4;}                            /* header stays above the tab bar */
#rl-panel .rl-tabs{position:sticky;top:0;z-index:3;display:flex;gap:0;padding:0 8px;
  background:#fff;border-bottom:1px solid #e6e8ec;}
#rl-panel .rl-tab{flex:1 1 0;min-width:0;position:relative;padding:11px 3px 12px;border:0;border-radius:0;background:none;
  color:#8a8d94;font:inherit;font-size:10.5px;font-weight:700;letter-spacing:-.2px;cursor:pointer;outline:none;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .2s ease,background-color .22s ease;}
#rl-panel .rl-tab:hover{background:#eff1f5;}   /* soft light bg fades in on hover */
/* our .active also matches the global button.active (dark segmented-control style),
   so override its background/border back off for tabs */
#rl-panel .rl-tab.active{color:#1f5fd0;background:none;border-color:transparent;}
/* one sliding highlight (glow + underline) that animates between tabs; JS sets its
   width + translateX to the active tab. The glow fades on the sides AND the top
   (radial from the bottom centre), the line is the crisp bar at the bottom. */
#rl-panel .rl-tab-hl{position:absolute;bottom:0;left:0;height:100%;width:0;pointer-events:none;z-index:0;
  transform:translateX(0);transition:transform .24s cubic-bezier(.4,0,.2,1),width .24s cubic-bezier(.4,0,.2,1);}
#rl-panel .rl-tab-hl::before{content:"";position:absolute;inset:0;
  background:radial-gradient(72% 118% at 50% 100%,rgba(31,95,208,.15),rgba(31,95,208,0) 70%);}
#rl-panel .rl-tab-hl::after{content:"";position:absolute;left:2px;right:2px;bottom:0;height:2.5px;background:#1f5fd0;}
#rl-panel .rl-tab{z-index:1;}   /* text/labels sit above the sliding highlight */
/* show only the active section; the tab names it, so hide the big in-panel heading
   and keep just the one-line description at the top of the section */
#rl-panel .rl-group{display:none;margin:0;}
#rl-panel .rl-group.active{display:block;}
#rl-panel .rl-group-h{display:none;}
#rl-panel .rl-group-sub{display:block;margin:14px 12px 2px;font-size:11.5px;line-height:1.45;color:#6a6d75;}

/* cards */
#rl-panel section{margin:11px 11px;padding:13px 14px;background:#fff;border:1px solid #e6e8ec;
  border-radius:13px;box-shadow:0 1px 2px rgba(20,20,30,.04);}
#rl-panel h2{margin:0 0 12px;font-size:10.5px;font-weight:800;letter-spacing:.9px;
  text-transform:uppercase;color:#8a8d94;}
/* ---- Playback: the REPLAY corner tag + the grow-in replay scrubber ---- */
#rl-panel #rl-sec-playback{position:relative;overflow:hidden;} /* clip the tag to the card's corner */
/* REPLAY tag: fills the card's TOP-RIGHT corner (flush to the top + right edges; the
   top-right rounds with the card via the section's overflow, the inner bottom-left is
   rounded). Drops in top->bottom via .show; on HOVER its two stacked faces slide DOWN
   so it swaps to a red "Back to live" (clicking it exits the replay). */
#rl-panel .reptag{position:absolute;top:0;right:0;z-index:4;width:118px;height:26px;margin:0;padding:0;border:0;
  background:none;overflow:hidden;border-radius:0 0 0 12px;cursor:pointer;outline:none;
  opacity:0;transform:translateY(-100%);pointer-events:none;
  transition:transform .3s cubic-bezier(.34,1.28,.5,1),opacity .22s ease;}
#rl-panel .reptag.show{opacity:1;transform:translateY(0);pointer-events:auto;}
#rl-panel .reptag-face{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:#fff;font-size:9.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap;
  transition:transform .3s cubic-bezier(.4,0,.2,1);}
#rl-panel .reptag-front{background:#1f5fd0;transform:translateY(0);}
#rl-panel .reptag.red .reptag-front{background:#e60012;}                  /* red model -> red REPLAY */
#rl-panel .reptag-back{background:#5e626b;transform:translateY(-100%);}   /* BACK TO LIVE = grey (both models) */
#rl-panel .reptag:hover .reptag-front{transform:translateY(100%);}       /* front exits DOWN */
#rl-panel .reptag:hover .reptag-back{transform:translateY(0);}           /* back drops in from top */
/* replay scrubber: grows in / collapses out instead of popping */
#rl-panel #rl-rep-scrub{max-height:0;opacity:0;overflow:hidden;margin:0;
  transition:max-height .34s ease,opacity .26s ease,margin-top .34s ease;}
#rl-panel #rl-rep-scrub.show{max-height:74px;opacity:1;margin-top:13px;}
/* slim, rounded scrollbar inside the replay list */
#rl-panel .replist{scrollbar-width:thin;scrollbar-color:#c6ccd6 transparent;}
#rl-panel .replist::-webkit-scrollbar{width:10px;}
#rl-panel .replist::-webkit-scrollbar-button{display:none;width:0;height:0;}
#rl-panel .replist::-webkit-scrollbar-track{background:transparent;}
#rl-panel .replist::-webkit-scrollbar-thumb{background:#c6ccd6;border-radius:99px;border:3px solid #fff;background-clip:padding-box;}
#rl-panel .replist::-webkit-scrollbar-thumb:hover{background:#aab2bf;background-clip:padding-box;}

/* buttons */
#rl-panel .btns{display:flex;gap:7px;}
#rl-panel .btns[hidden]{display:none;}   /* [hidden] must beat the flex rule above */
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
/* the CPU lock: top-right of the header; swings in from the right on the CPU model */
#rl-panel .lockbtn{position:absolute;top:13px;right:14px;z-index:6;width:34px;height:34px;padding:0;
  display:grid;place-items:center;border:1px solid #d7dade;border-radius:50%;background:#fff;color:#8a8d94;cursor:pointer;
  opacity:0;transform:translateX(64px) rotate(14deg);pointer-events:none;
  transition:opacity .26s ease,transform .4s cubic-bezier(.34,1.42,.5,1),background .12s,color .12s,border-color .12s;}
#rl-panel .lockbtn.show{opacity:1;transform:translateX(0) rotate(0);pointer-events:auto;}
#rl-panel .lockbtn:hover{background:#f0f1f3;color:#54565c;border-color:#c4c8ce;}
#rl-panel .lockbtn.locked{background:#dc3e47;border-color:#dc3e47;color:#fff;} /* same red as the CPU model block: #d4141f at 82% over white */
#rl-panel .lockbtn.locked:hover{background:#d4141f;border-color:#d4141f;color:#fff;}
#rl-panel .lockbtn svg{width:18px;height:18px;display:block;}
/* locked learning sliders (CPU + locked) read grayed out; black shared sliders stay open */
#rl-panel .ctl.learn{transition:opacity .15s;}
#rl-panel .ctl.learn:has(input:disabled){opacity:.5;}
#rl-panel input[type=range]:disabled{cursor:default;}
#rl-panel input[type=range]:disabled::-webkit-slider-thumb{background:#eef0f3;cursor:default;}
#rl-panel input[type=range]:disabled::-moz-range-thumb{background:#eef0f3;cursor:default;}
/* media-player transport: prev round | play/pause | next round */
#rl-panel .transport{display:flex;align-items:center;justify-content:center;gap:20px;margin-top:2px;}
#rl-panel .transport button{flex:none;padding:0;display:flex;align-items:center;justify-content:center;}
#rl-panel .tbtn{width:44px;height:44px;border-radius:50%;border:1.5px solid #d7dade;background:#fff;color:#3a3d44;}
#rl-panel .tbtn:hover{background:#f0f1f3;border-color:#c4c8ce;}
#rl-panel .tplay{width:54px;height:54px;border-radius:50%;border:none;background:#141518;color:#fff;}
#rl-panel .tplay:hover{background:#2a2b30;}
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
#rl-panel .bar{height:10px;border-radius:0;background:#eceef1;overflow:hidden;display:flex;margin:0 0 11px;}
#rl-panel .bar i{display:block;height:100%;transition:width .3s;}
#rl-panel .bar .r{background:#e60012;} #rl-panel .bar .b{background:#1f5fd0;} #rl-panel .bar .d{background:#8b5cf6;}
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
#rl-panel #rl-brief .stat b.rw-pos{color:#1f7a3d;}   /* positive rewards green */
#rl-panel #rl-brief .stat b.rw-neg{color:#c0392b;}   /* penalties red */
/* State & observation - the briefing's centrepiece card */
#rl-panel #rl-brief .so-card{margin:9px 0 6px;padding:15px 15px 13px;border:1px solid #e4e7ec;border-radius:14px;
  background:linear-gradient(180deg,#f8f9fc,#eef1f6);box-shadow:0 1px 3px rgba(20,22,28,.05);}
#rl-panel #rl-brief .so-hero{display:flex;align-items:baseline;gap:9px;padding-bottom:11px;margin-bottom:3px;border-bottom:1px solid #e2e5ea;}
#rl-panel #rl-brief .so-big{font-size:33px;font-weight:800;letter-spacing:-1.2px;color:#1f1f21;line-height:.9;font-variant-numeric:tabular-nums;}
#rl-panel #rl-brief .so-unit{font-size:12px;font-weight:700;color:#9a9da4;letter-spacing:.2px;}
#rl-panel #rl-brief .so-row{padding:9px 0 8px;border-bottom:1px solid #e7eaef;}
#rl-panel #rl-brief .so-row:last-child{border-bottom:0;padding-bottom:1px;}
#rl-panel #rl-brief .so-k{display:block;font-size:9px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#a2a5ac;margin-bottom:4px;}
#rl-panel #rl-brief .so-v{display:block;font-size:11.5px;color:#4b4d53;line-height:1.5;}
/* the observation vector, shown as a code-style tuple */
#rl-panel #rl-brief .so-tuple{display:block;margin-top:7px;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  font-size:11px;font-weight:700;color:#1f5fd0;background:#eef2fa;border:1px solid #e0e6f2;border-radius:8px;
  padding:7px 9px;letter-spacing:.2px;line-height:1.5;}
/* opponent visibility: a square two-line badge with the explanation to its right */
#rl-panel #rl-brief .so-opp{display:flex;align-items:center;gap:12px;margin-top:3px;}
#rl-panel #rl-brief .so-sq{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;
  width:68px;height:68px;border-radius:13px;text-align:center;}
#rl-panel #rl-brief .so-sq b{display:block;font-size:11px;font-weight:800;letter-spacing:.7px;line-height:1.5;}
#rl-panel #rl-brief .so-sq.no{background:#f3eaea;color:#b0555a;}
#rl-panel #rl-brief .so-sq.yes{background:#e7f0ff;color:#1f5fd0;}
#rl-panel #rl-brief .so-opp-txt{font-size:11.5px;color:#4b4d53;line-height:1.5;}
#rl-panel .cmp-head{display:flex;align-items:center;font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;color:#a2a5ac;padding:0 0 6px;border-bottom:1px solid #f0f1f3;}
#rl-panel .cmp-head span{flex:1;}
#rl-panel .cmp-head .cr,#rl-panel .cmp-head .cb{flex:none;width:100px;text-align:center;white-space:nowrap;}
#rl-panel .cmp-head .cr{color:#e60012;} #rl-panel .cmp-head .cb{color:#1f5fd0;}
#rl-panel .cmp-row{display:flex;align-items:center;font-size:12.5px;padding:8px 0;border-bottom:1px solid #f0f1f3;}
#rl-panel .cmp-row:last-child{border-bottom:0;}
#rl-panel .cmp-row .cl{flex:1;color:#54565c;}
#rl-panel .cmp-row .cr,#rl-panel .cmp-row .cb{flex:none;width:100px;text-align:center;font-variant-numeric:tabular-nums;font-weight:700;}
#rl-panel .cmp-row .cr{color:#e60012;} #rl-panel .cmp-row .cb{color:#1f5fd0;}
/* win-lead dot removed (pointless per user); the .win class now has no visual effect */

/* descriptive note under the Algorithm-internals / World settings cards */
#rl-panel .cfgnote{font-size:10.5px;color:#a2a5ac;margin:12px 0 0;line-height:1.45;}
#rl-panel .ctl-help{font-size:9.8px;color:#92969e;line-height:1.4;margin:6px 0 0;}
#rl-panel .dp-status{font-weight:800;}
#rl-panel .dp-status.ok{color:#1f7a3d;}
#rl-panel .dp-status.limit{color:#b45b12;}

/* segmented control (value-map mode) */
#rl-panel .seg{display:flex;border:1px solid #d7dade;border-radius:9px;overflow:hidden;}
#rl-panel .seg button{flex:1;border:0;border-right:1px solid #d7dade;border-radius:0;background:#fff;}
#rl-panel .seg button:last-child{border-right:0;}
/* round the END buttons themselves (not just the container) so an active button promoted
   to its own compositing layer during its transition can't pop square corners */
#rl-panel .seg button:first-child{border-top-left-radius:8px;border-bottom-left-radius:8px;}
#rl-panel .seg button:last-child{border-top-right-radius:8px;border-bottom-right-radius:8px;}
#rl-panel .seg button.active{background:#1f1f21;color:#fff;}

/* top-30 replay browser (per model) */
#rl-panel .replist{max-height:196px;overflow-y:auto;margin:10px 0 0;border:1px solid #e6e8ec;border-radius:10px;}
#rl-panel .replist .rrow{display:flex;align-items:center;gap:10px;padding:8px 11px;font-size:12px;cursor:pointer;
  border-bottom:1px solid #f0f1f3;}
#rl-panel .replist .rrow:last-child{border-bottom:0;}
#rl-panel .replist .rrow:hover{background:#f0f1f3;}
#rl-panel .replist .rrow.sel{background:#eaf0fb;box-shadow:inset 3px 0 0 #1f5fd0;}
#rl-panel .replist.red .rrow.sel{background:#fceceb;box-shadow:inset 3px 0 0 #e60012;} /* red model = red selection */
#rl-panel .replist .rrow .rk{color:#9a9da4;font-weight:800;width:30px;flex:none;}
#rl-panel .replist .rrow .st{font-variant-numeric:tabular-nums;font-weight:700;color:#1f1f21;}
#rl-panel .replist .rrow .ep{margin-left:auto;color:#9a9da4;font-size:11px;font-variant-numeric:tabular-nums;}
#rl-panel .replist .empty{padding:15px 12px;color:#9a9da4;font-size:12px;text-align:center;}

/* Q inspector */
#rl-panel #rl-qinspect:empty{display:none;} /* no empty gap under the value map until a tile is clicked */
#rl-panel .qrow{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;padding:3px 0;}
#rl-panel .qrow .qbar{flex:1;margin:0 9px;height:8px;background:#eceef1;border-radius:4px;position:relative;}
#rl-panel .qrow .qbar i{position:absolute;top:0;bottom:0;background:#8a8d94;border-radius:4px;}
#rl-panel .qrow.blk{opacity:.42;} /* action blocked here (wall / no-op) - not chosen */
#rl-panel .blktag{font-size:9px;color:#b23127;letter-spacing:.3px;text-transform:uppercase;}
#rl-panel .hint{font-size:11px;color:#a2a5ac;margin-top:7px;line-height:1.45;}

/* learning-curve charts (built by graphs.js into this panel) */
#rl-panel .chart{margin:0 0 14px;}
#rl-panel .chart:last-child{margin-bottom:0;}
#rl-panel .chart .ct{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
#rl-panel .chart .ct h3{margin:0;font-size:11.5px;font-weight:700;color:#3a3b40;}
#rl-panel .chart .ct .lg{font-size:9.5px;color:#9a9da4;display:flex;gap:10px;}
#rl-panel .chart .ct .lg i{display:inline-block;width:10px;height:3px;border-radius:2px;vertical-align:middle;margin-right:4px;}
#rl-panel .chart canvas{width:100%;height:132px;background:#fbfbfc;border:1px solid #eceef1;border-radius:9px;display:block;}
`;

// Fold every card into big titled groups, in the given order. Each group renders
// a large plain-language heading, an optional one-line subtitle, then its cards
// stacked vertically (one scrolling column). A catch-all 'More' group guarantees
// any unmapped/future section still appears (never silently dropped). Shared by
// both the N and M panels.
//   groups = [[id, title, [sectionId, ...], subtitle?], ...]
export function organizeGroups(body, groups) {
  const mk = (id, title, sub) => {
    const g = document.createElement('div');
    g.className = 'rl-group';
    g.dataset.group = id;
    // (subtitle intentionally not rendered - the user removed the per-tab explainer
    // one-liner; the `sub` field in the group tuples is kept but ignored)
    g.innerHTML = `<h2 class="rl-group-h">${title}</h2>` +
      '<div class="rl-group-cards"></div>';
    return g;
  };
  const els = groups.map(([id, title, ids, sub]) => {
    const g = mk(id, title, sub);
    const cards = g.querySelector('.rl-group-cards');
    for (const sid of ids) {
      const sec = body.querySelector('#' + sid);
      if (sec) cards.appendChild(sec); // moves the node out of the flat body
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

// Playback is pinned at the top (handled separately, not a tab). The rest are
// TABS in a story order a newcomer can follow: understand the task -> see the
// score -> watch it learn -> tune it -> deeper knobs -> look inside its head ->
// rewatch great runs. Tuple is [id, title, [sectionIds], subtitle, tabLabel].
const N_GROUPS = [
  ['challenge', "What's the challenge?", ['rl-brief'],
    'The task both AIs are racing to solve, and how their two methods differ.', 'Challenge'],
  ['tune', 'Tune your AI', ['rl-sec-hyper'],
    'Change how your AI learns. Effects show up live.', 'Tune'],
  ['advanced', 'World', ['rl-sec-algo', 'rl-sec-world'],
    'Deeper knobs for the algorithm and the world itself. Safe to ignore.', 'World'],
  ['inside', 'Inside the AI', ['rl-sec-value', 'rl-polagree', 'rl-dp', 'rl-va', 'rl-dqn', 'rl-actdist'],
    'Peek at what your AI has actually learned.', 'Inside'],
  ['progress', 'Training progress', ['rl-sec-training', 'rl-curve-d-rate', 'rl-curve-d-return', 'rl-curve-d-eps', 'rl-curve-d-len', 'rl-probe', 'rl-curve-d-td', 'rl-reward', 'rl-explore'],
    'Watch your AI (Blue) get better over time.', 'Progress'],
  ['score', 'Scoreboard', ['rl-compare', 'rl-outcomes'],
    'Who is winning right now.', 'Score'],
  ['replays', 'Replays', ['rl-replay', 'rl-traj'], '', 'Replays'],
];

// Build the sticky tab bar (one tab per group) and wire it to swap sections. The
// tab bar pins right under the sticky header; clicking a tab shows only that
// group and scrolls the panel back to the top. Shared by the N and M panels.
export function buildTabs(panel, body, groups) {
  // the header may live OUTSIDE `body` (the merged panel shares one header across two
  // view containers) - fall back to the panel's header for the sticky offset
  const hdr = body.querySelector('.hdr') || panel.querySelector('.hdr');
  const bar = document.createElement('div');
  bar.className = 'rl-tabs';
  const tabs = [...body.querySelectorAll('.rl-group')].map((g) => {
    const meta = groups.find((x) => x[0] === g.dataset.group);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rl-tab';
    btn.dataset.group = g.dataset.group;
    btn.textContent = (meta && (meta[4] || meta[1])) || g.dataset.group;
    bar.appendChild(btn);
    return { btn, g };
  });
  // place the tab bar right before the first section (i.e. below any pinned-top
  // cards like Playback), falling back to just after the header
  const firstGroup = body.querySelector('.rl-group');
  if (firstGroup) body.insertBefore(bar, firstGroup);
  else hdr.insertAdjacentElement('afterend', bar);
  // one sliding highlight (glow + underline) that animates between tabs; sits
  // behind the labels (inserted first) and is positioned by JS to the active tab
  const hl = document.createElement('div');
  hl.className = 'rl-tab-hl';
  bar.insertBefore(hl, bar.firstChild);
  let hlPlaced = false;
  const moveHl = () => {
    const act = tabs.find((t) => t.btn.classList.contains('active'));
    if (!act || !act.btn.offsetWidth) return;              // hidden: metrics not ready yet
    if (!hlPlaced) hl.style.transition = 'none';           // first placement must not slide in from 0
    hl.style.width = act.btn.offsetWidth + 'px';
    hl.style.transform = 'translateX(' + act.btn.offsetLeft + 'px)';
    if (!hlPlaced) { void hl.offsetWidth; hl.style.transition = ''; hlPlaced = true; }
  };
  // keep the tab bar pinned directly below the (also-sticky) header, and the
  // highlight aligned. The header can measure 0 while the panel is hidden during
  // the start menu, so recompute on tab switch, first snapshot, and resize.
  const setOffset = () => { if (hdr.offsetHeight) bar.style.top = hdr.offsetHeight + 'px'; moveHl(); };
  const activate = (id) => {
    for (const { btn, g } of tabs) {
      const on = g.dataset.group === id;
      g.classList.toggle('active', on);
      btn.classList.toggle('active', on);
    }
    moveHl();
    panel.scrollTop = 0;
  };
  tabs.forEach(({ btn }) => btn.addEventListener('click', () => activate(btn.dataset.group)));
  if (tabs.length) activate(tabs[0].g.dataset.group);
  setOffset();
  window.addEventListener('resize', setOffset);
  window.addEventListener('rl-snapshot', setOffset, { once: true });
  if (window.ResizeObserver) {
    new ResizeObserver(setOffset).observe(hdr);
    new ResizeObserver(moveHl).observe(bar);   // reposition the highlight if the bar reflows
  }
  return activate;
}

export function initPanel() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const ctlHTML = (p) => {
    const learn = p.color === C_OURS;   // a per-model learning knob (tints blue <-> red)
    const fill = learn ? 'var(--hue)' : (p.color || C_GLOBAL);
    const showHelp = ['dpTheta', 'dpMaxIters', 'dpPlanning'].includes(p.key);
    return `
    <div class="ctl${learn ? ' learn' : ''}" data-scope="${p.scope}">
      <div class="row"><span>${p.label}</span><b id="rl-pv-${p.key}">-</b></div>
      <input type="range" id="rl-p-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.min}" style="--fill:${fill}">
      ${showHelp && p.desc ? `<p class="ctl-help">${p.desc}</p>` : ''}
    </div>`;
  };
  const algoParams = GLOBAL_PARAMS.filter((p) => p.sect === 'algo');
  const worldParams = GLOBAL_PARAMS.filter((p) => p.sect === 'world');

  const panel = document.createElement('div');
  panel.id = 'rl-panel';
  panel.innerHTML = `
    <div class="rl-body">
    <div class="hdr">
      <button class="lockbtn" type="button" aria-label="Unlock the CPU's values"></button>
      <div class="harena"><button class="closebtn" type="button" aria-label="Close controls"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M6 18L18 6"/></svg></button><b id="rl-arena">-</b><div class="rdots" id="rl-round"></div></div>
      <div class="mselect">
        <span class="msel-wash" aria-hidden="true"></span>
        <button type="button" class="msel your active" data-view="your">
          <span class="msel-k">Your model</span>
          <b class="msel-n" id="rl-mb">-</b>
          <em class="msel-s" id="rl-vs"></em>
        </button>
        <button type="button" class="msel cpu" data-view="cpu">
          <span class="msel-k">CPU model</span>
          <b class="msel-n" id="rl-cp-algo">-</b>
          <em class="msel-s" id="rl-cp-tier"></em>
        </button>
      </div>
    </div>
    <section id="rl-sec-playback" class="qk">
      <h2>Playback</h2>
      <button id="rl-rep-tag" class="reptag" type="button" aria-label="Back to live">
        <span class="reptag-face reptag-front">Replay</span>
        <span class="reptag-face reptag-back">Back to live</span>
      </button>
      <div class="transport">
        <button id="rl-prev" class="tbtn">${SVG.prev}</button>
        <button id="rl-play" class="tplay">${SVG.pause}</button>
        <button id="rl-next" class="tbtn">${SVG.next}</button>
      </div>
      <div class="ctl" id="rl-rep-scrub">
        <div class="row"><span id="rl-rep-info">Replay</span><b id="rl-rep-frame"></b></div>
        <input type="range" id="rl-rep-seek" min="0" max="0" value="0" style="--fill:#1f5fd0">
      </div>
      <div class="btns" style="margin-top:14px;">
        <button id="rl-reset">↺ Reset</button>
        <button id="rl-regen">⟳ New world</button>
      </div>
      <div class="ctl" style="margin-top:13px;">
        <div class="row"><span>Speed</span><b id="rl-spd-val">-</b></div>
        <input type="range" id="rl-speed" min="0" max="100" value="10" style="--fill:#141518">
      </div>
    </section>
    <section id="rl-sec-hyper" class="qk">
      <h2>Hyperparameters</h2>
      <div class="plegend">
        <span><i class="ple-hue"></i><span id="rl-ple-model">Your model</span></span>
        <span><i style="background:#141518"></i>Both models</span>
      </div>
      ${PARAMS.map(ctlHTML).join('')}
    </section>
    <section id="rl-sec-algo">
      <h2>Algorithm internals</h2>
      ${algoParams.map(ctlHTML).join('')}
    </section>
    <section id="rl-sec-world">
      <h2>World &amp; dynamics</h2>
      ${worldParams.map(ctlHTML).join('')}
    </section>
    <section id="rl-sec-training" class="qk">
      <h2>Training</h2>
      <div class="stat"><span>Episode</span><b id="rl-ep">0</b></div>
      <div class="stat"><span>Exploration ε</span><b id="rl-eps">1.00</b></div>
      <div class="stat fullonly"><span>Total steps</span><b id="rl-steps">0</b></div>
      <div class="stat fullonly"><span>Avg episode length</span><b id="rl-len">-</b></div>
      <div class="stat fullonly"><span>Last return (B / R)</span><b id="rl-ret">-</b></div>
      <div class="stat fullonly"><span>Learned states (B / R)</span><b id="rl-q">0 / 0</b></div>
    </section>
    <section id="rl-sec-value" class="qk">
      <h2>Value map</h2>
      <div class="seg">
        <button id="rl-h-off" class="active">Off</button>
        <button id="rl-h-policy">Policy</button>
        <button id="rl-h-value">Value</button>
        <button id="rl-h-visits">Visits</button>
      </div>
      <div id="rl-qinspect" style="margin-top:8px;"></div>
    </section>
    </div>`;
  document.body.appendChild(panel);

  // learning-curve charts + episode replay (built by graphs.js) into the same
  // .rl-body wrapper, then fold every card (native + the graphs.js sections) into
  // the big titled groups. Any section not named still shows (catch-all group) so
  // nothing is ever silently dropped.
  const body = panel.querySelector('.rl-body');
  const playback = body.querySelector('#rl-sec-playback');
  const lockBtn = body.querySelector('.lockbtn');
  const closeBtn = body.querySelector('.closebtn');
  closeBtn?.addEventListener('click', () => panel.classList.remove('open'));
  const hdrEl = body.querySelector('.hdr');
  initGraphs(body); // the player's graph sections

  // Playback pinned at the top (not a tab); fold everything else into the tabbed groups.
  playback.remove();
  organizeGroups(body, N_GROUPS);
  hdrEl.insertAdjacentElement('afterend', playback);
  buildTabs(panel, body, N_GROUPS);

  // ---- model selector: SAME tabs. Picking the CPU tints the accent + the learning sliders
  // red (via --hue) and shows the CPU's values; the lock swings in and locks ONLY those red
  // sliders. The black (shared) sliders stay open. No section swap / whole-tab fade. The
  // per-model helpers (loadLearn / applyLock / rewriteModelLabel / reShowRelevant / lock UI)
  // are defined further down once the sliders are wired; applyModel calls them at click time.
  panel.dataset.model = 'your';
  const msels = [...panel.querySelectorAll('.mselect .msel')];
  let lastEps = { blue: 1, red: 1 };
  const updateEps = () => {
    const el = panel.querySelector('#rl-eps');
    if (el) el.textContent = ((panel.dataset.model === 'cpu' ? lastEps.red : lastEps.blue) ?? 0).toFixed(2);
  };
  let lastParams = {}, lastRedParams = {}, cpuLocked = true;
  const applyModel = (m) => {
    panel.dataset.model = m;   // tints --hue (blue <-> red) + the tab accent
    updateEps();
    loadLearn();               // learning sliders -> the selected model's values
    applyLock();               // red learning sliders locked only on CPU + locked
    rewriteModelLabel(m);      // legend "Your model" <-> "CPU model" (rewrite animation)
    reShowRelevant();          // controls relevant to the selected model's algorithm
    window.dispatchEvent(new CustomEvent('rl-modelview', { detail: { model: m } }));
    window.dispatchEvent(new Event('resize'));
  };
  const setModel = (m) => {
    if (panel.dataset.model === m) return;
    msels.forEach((b) => b.classList.toggle('active', b.dataset.view === m));
    lockBtn.classList.toggle('show', m === 'cpu'); // the lock swings in on the CPU model
    applyModel(m);
  };
  msels.forEach((b) => b.addEventListener('click', () => setModel(b.dataset.view)));

  const $ = (id) => panel.querySelector(id);

  // paint the filled (left-of-thumb) part of a range slider red
  const paintRange = (el) => {
    if (!el) return;
    const min = +el.min, max = +el.max, v = +el.value;
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    const fill = el.style.getPropertyValue('--fill') || '#8a8d94';
    el.style.background = `linear-gradient(to right,${fill} ${pct}%,#e1e3e8 ${pct}%)`;
  };

  // ---- open / close the control menu (N key) ----
  if (new URLSearchParams(location.search).has('panel')) panel.classList.add('open');
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyC' || /input|select|textarea/i.test(e.target.tagName)) return;
    if (getComputedStyle(panel).display === 'none') return; // hidden while the start menu is up
    window.RL?.panels?.toggle?.();
  });

  // ---- playback ----
  let paused = false;
  // arena nav (prev/next round) must fire ONCE per press, not once PER CLICK -
  // spamming next used to advance a round on every click. A shared lock silently
  // swallows the extra clicks for ~one transition (no visual disable).
  let navLock = false;
  const navRound = (cmd) => {
    if (navLock) return; // ignore the spam while a change is already under way
    navLock = true;
    window.RL.control({ cmd });
    setTimeout(() => { navLock = false; }, 2600); // ~one iris transition
  };
  $('#rl-prev').addEventListener('click', () => navRound('prevRound'));
  $('#rl-next').addEventListener('click', () => navRound('nextRound'));
  const speed = $('#rl-speed');
  const showSpeed = () => {
    $('#rl-spd-val').textContent = `${sliderToSpeed(+speed.value).toLocaleString()} / s`;
    paintRange(speed);
  };
  // a loaded replay plays at the CURRENT speed setting (mapped to a watchable fps)
  const replayFps = () => Math.max(1, Math.min(60, sliderToSpeed(+speed.value)));
  speed.addEventListener('input', () => {
    showSpeed();
    window.RL.control({ cmd: 'speed', value: sliderToSpeed(+speed.value) });
    if (window.RL.replay?.active?.()) window.RL.replay.setFps(replayFps());
  });
  showSpeed();
  window.RL.control({ cmd: 'speed', value: sliderToSpeed(+speed.value) });

  // play/pause is DUAL-MODE: drives the loaded replay when there is one, else the live game
  const playBtn = $('#rl-play');
  const setLiveIcon = () => { playBtn.innerHTML = paused ? SVG.play : SVG.pause; };
  playBtn.addEventListener('click', () => {
    if (window.RL.replay?.active?.()) window.RL.replay.toggle(); // icon updates via rl-replay-state
    else {
      paused = !paused;
      window.RL.control({ cmd: paused ? 'pause' : 'play' });
      setLiveIcon();
    }
  });
  $('#rl-regen').addEventListener('click', () => window.RL.control({ cmd: 'regenerate' }));
  $('#rl-reset').addEventListener('click', () => window.RL.control({ cmd: 'reset' }));

  // ---- replay controls: revealed in Playback while a recorded run is loaded ----
  const repTag = $('#rl-rep-tag'), scrubEl = $('#rl-rep-scrub'), seekEl = $('#rl-rep-seek');
  const repInfo = $('#rl-rep-info'), repFrame = $('#rl-rep-frame');
  seekEl.addEventListener('input', () => { paintRange(seekEl); window.RL.replay?.seek?.(+seekEl.value); });
  repTag.addEventListener('click', () => window.RL.replay?.stop?.()); // the tag itself = Back to live
  let lastReplayActive = false;
  window.addEventListener('rl-replay-state', (e) => {
    const s = e.detail || {};
    const on = !!s.active;
    repTag.classList.toggle('show', on);   // slides in from the corner / out again
    scrubEl.classList.toggle('show', on);  // grows in / collapses
    // red model -> the whole replay UI (tag REPLAY bg, play button, scrubber) goes red
    const red = on && s.agent === 'red';
    if (on && !lastReplayActive) setModel(red ? 'cpu' : 'your');
    repTag.classList.toggle('red', red);
    // live = gray (CSS default), blue replay = blue, red replay = red
    playBtn.style.background = on ? (red ? '#e60012' : '#1f5fd0') : '';
    if (on) {
      if (!lastReplayActive) window.RL.replay?.setFps?.(replayFps()); // sync to current speed on entry
      seekEl.style.setProperty('--fill', red ? '#e60012' : '#1f5fd0'); // scrubber matches the model
      seekEl.max = Math.max(0, (s.total || 1) - 1);
      if (document.activeElement !== seekEl) { seekEl.value = s.idx; paintRange(seekEl); } // don't fight a drag
      repInfo.textContent = s.label || 'Replay';
      repFrame.textContent = s.total ? `${s.idx + 1}/${s.total}` : '';
      playBtn.innerHTML = s.playing ? SVG.pause : SVG.play;
    } else {
      setLiveIcon(); // back to live: restore the live play/pause icon
    }
    lastReplayActive = on;
  });

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
  let seedTimer = null;
  let pending = {};
  const flush = () => {
    const keys = Object.keys(pending);
    if (keys.length) {
      // learning-knob edits while viewing the CPU route to setRedParams; everything else
      // (the shared globals, and all edits while on your model) routes to setParams.
      const mine = {}, cpu = {};
      for (const k of keys) {
        const p = ALL_PARAMS.find((x) => x.key === k);
        if (panel.dataset.model === 'cpu' && p && p.color === C_OURS) cpu[k] = pending[k];
        else mine[k] = pending[k];
      }
      if (Object.keys(mine).length) window.RL.control({ cmd: 'setParams', params: mine });
      if (Object.keys(cpu).length) window.RL.control({ cmd: 'setRedParams', params: cpu });
    }
    pending = {};
  };
  const queue = (p) => {
    const raw = +$(`#rl-p-${p.key}`).value;
    // Random seed rebuilds the entire world. During a drag or held arrow key,
    // keep replacing the requested seed and trigger exactly once after input settles.
    if (p.key === 'trainSeed') {
      clearTimeout(seedTimer);
      seedTimer = setTimeout(() => {
        window.RL.control({ cmd: 'setParams', params: { trainSeed: raw } });
      }, 700);
      return;
    }
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
  let lastAlgoBlue = null, lastAlgoRed = null;  // re-show relevant controls per model + round
  let lastRoundIndex = -1;  // r4/r5 hazard sliders are scoped by round, not just algo

  // show only the controls that matter for THIS round: hide α / ε on DP rounds
  // (planners use only γ); DP / DQN internals + arena dynamics + hazard counts each
  // appear only where they apply. Then hide any settings card left empty.
  const showRelevant = (algoBlue, roundIndex) => {
    const isDP = DP_ALGOS.has(algoBlue);
    const isDqn = DQN_ALGOS.has(algoBlue);
    const isPg = PG_ALGOS.has(algoBlue);
    const vis = (sc) => {
      switch (sc) {
        case 'learn': return !isDP;               // learning rate α: every learner (not DP)
        case 'eps': return !isDP && !isPg;        // ε-greedy schedule: not DP, not PG (PG samples its policy)
        case 'dp': return isDP;                   // convergence + sweeps + speed: DP round
        case 'dqn': return isDqn;                 // replay / batch / target-net: DQN rounds only
        case 'r1': return roundIndex === 0;       // Round-1 game mechanics (ice + "?" blocks)
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

  // ---- per-model helpers used by applyModel (defined here, once the sliders exist) ----
  const loadLearn = () => {
    const src = panel.dataset.model === 'cpu' ? lastRedParams : lastParams;
    for (const p of ALL_PARAMS) if (p.color === C_OURS) setFromBackend(p, src[p.key]);
  };
  const applyLock = () => {
    const disable = panel.dataset.model === 'cpu' && cpuLocked;
    panel.querySelectorAll('.ctl.learn input[type=range]').forEach((el) => { el.disabled = disable; });
  };
  const reShowRelevant = () =>
    showRelevant(panel.dataset.model === 'cpu' ? lastAlgoRed : lastAlgoBlue, lastRoundIndex);
  // legend label rewrite: erase the current text, then type the target (a small typewriter)
  let rewriteTimer = null;
  const rewriteModelLabel = (m) => {
    const el = panel.querySelector('#rl-ple-model');
    if (!el) return;
    const target = m === 'cpu' ? 'CPU model' : 'Your model';
    clearInterval(rewriteTimer);
    let cur = el.textContent;
    rewriteTimer = setInterval(() => {
      if (cur.length) { cur = cur.slice(0, -1); el.textContent = cur; }
      else {
        clearInterval(rewriteTimer);
        let i = 0;
        rewriteTimer = setInterval(() => {
          if (i < target.length) el.textContent = target.slice(0, ++i);
          else clearInterval(rewriteTimer);
        }, 26);
      }
    }, 16);
  };
  // the CPU lock (top-right, swings in on the CPU model): locks only the red learning sliders
  const LOCK_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
  const LOCK_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 7.8-1.1"/></svg>';
  const updateLockUI = () => {
    lockBtn.innerHTML = cpuLocked ? LOCK_CLOSED : LOCK_OPEN;
    lockBtn.classList.toggle('locked', cpuLocked);
    lockBtn.title = cpuLocked ? "Unlock to edit the CPU's values" : "Lock the CPU's values";
  };
  updateLockUI();
  lockBtn.addEventListener('click', () => { cpuLocked = !cpuLocked; updateLockUI(); applyLock(); });

  // ---- value-map mode ----
  // ONE value map, shared by both views: it targets whichever model is selected (Blue =
  // you, Red = CPU). Modes Off / Value / Policy / Visits.
  const hbtns = { off: $('#rl-h-off'), value: $('#rl-h-value'), policy: $('#rl-h-policy'), visits: $('#rl-h-visits') };
  const heatAgent = () => (panel.dataset.model === 'cpu' ? 'red' : 'blue');
  const setMode = (m) => {
    for (const k in hbtns) hbtns[k].classList.toggle('active', k === m);
    if (m === 'off') { window.RL.setHeatmap(null); $('#rl-qinspect').innerHTML = ''; }
    else window.RL.setHeatmap(heatAgent(), m);
  };
  hbtns.off.addEventListener('click', () => setMode('off'));
  hbtns.value.addEventListener('click', () => setMode('value'));
  hbtns.policy.addEventListener('click', () => setMode('policy'));
  hbtns.visits.addEventListener('click', () => setMode('visits'));
  // switching model re-points an active overlay at the newly-selected model
  window.addEventListener('rl-modelview', () => {
    const cur = Object.keys(hbtns).find((k) => hbtns[k].classList.contains('active'));
    if (cur && cur !== 'off') setMode(cur);
  });
  // if some other source grabs the single overlay, fall back to Off here
  window.addEventListener('rl-heatmap', (e) => {
    if ((e.detail || {}).agent !== heatAgent()) {
      for (const k in hbtns) hbtns[k].classList.toggle('active', k === 'off');
      $('#rl-qinspect').innerHTML = '';
    }
  });

  // ---- live stats ----
  window.addEventListener('rl-snapshot', (e) => {
    const s = e.detail.stats;
    if (!s) return;
    // cache both models' params; seed the sliders from the backend once
    if (s.params) lastParams = s.params;
    if (s.redParams) lastRedParams = s.redParams;
    if (!paramsInit && s.params) {
      for (const p of ALL_PARAMS) setFromBackend(p, s.params[p.key]);
      paramsInit = true;
    }
    // while viewing the CPU LOCKED, mirror its (tier-set) learning values live
    if (panel.dataset.model === 'cpu' && cpuLocked) loadLearn();
    $('#rl-mb').textContent = NAMES[s.algoBlue] || s.algoBlue || '-';
    const redNm = NAMES[s.algoRed] || s.algoRed || '';
    const tier = s.cpuTier ? `CPU - Tier ${s.cpuTier}` : '';
    $('#rl-vs').textContent = redNm
      ? `vs ${redNm}${tier ? ` - ${tier}` : ''}`
      : (tier ? `vs ${tier}` : '');
    // the CPU card in the header selector
    $('#rl-cp-algo').textContent = redNm || '-';
    $('#rl-cp-tier').textContent = s.cpuTier
      ? `Tier ${s.cpuTier}${TIER_LABELS[s.cpuTier] ? ` - ${TIER_LABELS[s.cpuTier]}` : ''}` : '';
    const r = s.round || {};
    const ri = r.index ?? 0;
    if (s.algoBlue !== lastAlgoBlue || s.algoRed !== lastAlgoRed || ri !== lastRoundIndex) {
      lastAlgoBlue = s.algoBlue; lastAlgoRed = s.algoRed; lastRoundIndex = ri;
      reShowRelevant();
    }
    // 5 round-result dots: blue / red / draw(purple) for played rounds, grey otherwise,
    // with a ring on the round currently in progress.
    const roundResults = s.roundResults || [];
    const roundTotal = r.total || roundResults.length || 5;
    let dotsHTML = '';
    for (let i = 0; i < roundTotal; i++) {
      const res = roundResults[i];
      const cls = res === 'blue' ? ' b' : res === 'red' ? ' r' : res === 'draw' ? ' d' : '';
      dotsHTML += `<i class="rdot${cls}${i === ri ? ' cur' : ''}"></i>`;
    }
    const roundEl = $('#rl-round');
    if (roundEl.innerHTML !== dotsHTML) roundEl.innerHTML = dotsHTML;
    $('#rl-arena').textContent = r.title || '';
    const tgt = s.targetEpisodes || 0;
    $('#rl-ep').textContent = tgt > 0
      ? `${s.episode.toLocaleString()} / ${tgt.toLocaleString()}`
      : s.episode.toLocaleString();
    $('#rl-steps').textContent = s.totalSteps.toLocaleString();
    lastEps = { blue: s.epsilon, red: s.redEpsilon ?? lastEps.red };
    updateEps(); // Exploration ε follows the selected model (blue = you, red = CPU)
    $('#rl-len').textContent = s.avgEpisodeLen ? s.avgEpisodeLen.toFixed(0) : '-';
    const lr = s.lastReturn || { red: 0, blue: 0 };
    const sign = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
    $('#rl-ret').textContent = `${sign(lr.blue)} / ${sign(lr.red)}`;
    $('#rl-q').textContent = `${s.qStates.blue} / ${s.qStates.red}`;
  });

  // ---- Q inspector ----
  window.addEventListener('rl-qinspect', (e) => {
    const d = e.detail;
    if (!d || !d.q) { $('#rl-qinspect').innerHTML = '<p class="hint">No data for that tile yet.</p>'; return; }
    const lo = Math.min(...d.q, 0), hi = Math.max(...d.q, 0), span = hi - lo || 1;
    // star the action the agent WOULD take (best among EFFECTIVE actions), not just the
    // raw argmax - a higher-Q move that bumps a wall is blocked and shown dimmed
    const best = (d.best != null) ? d.best : d.q.indexOf(Math.max(...d.q));
    const mask = d.mask || null;
    $('#rl-qinspect').innerHTML =
      `<div class="hint">Tile (${d.cell[0]}, ${d.cell[1]}) - ${d.agent === 'red' ? 'Red' : 'Blue'}</div>` +
      d.q.map((q, i) => {
        const blk = mask && !mask[i];
        return `<div class="qrow${blk ? ' blk' : ''}"><span>${ACTION_NAMES[i]}${i === best ? ' ★' : ''}${blk ? ' <span class="blktag">blocked</span>' : ''}</span>
          <span class="qbar"><i style="left:${((Math.min(q, 0) - lo) / span) * 100}%;
            width:${(Math.abs(q) / span) * 100}%"></i></span>
          <span>${q.toFixed(2)}</span></div>`;
      }).join('');
  });
}
