# FILES - what every file does (English)

A file-by-file walkthrough of the codebase: what each file is for, how it does
its job, and a short explanation of every class and function inside it. The
Hebrew version, `FILES_HE.md`, has the same content. (For the opposite
direction - "where is concept X implemented?" - use `CODE_MAP.md`.)

The big picture first:

```
game/
  serve.py            the ONE server: static files + training thread + JSON API
  index.html          the page shell the browser loads
  rl/
    core/             everything SHARED: engines, base agent, registries,
                      the tournament driver and its concern mixins
    arenas/           one package PER ROUND: its world generator, its game
                      mechanics, and the algorithms that round showcases
  src/                the browser viewer (three.js scenes, HUD, panels)
  vendor/             bundled three.js (no package manager needed)
  assets/             models/textures (Git LFS)
checkpoints/          Round-4 DQN learning saved between runs (gitignored)
```

The flow at runtime: `serve.py` builds one `Match` (from `rl/core/tournament.py`)
and calls `match.tick()` in a background thread forever. Each tick advances the
current round's environment by one step and lets both agents learn. The browser
polls `/api/snapshot` ~30x per second and renders whatever the backend says;
every button in the UI becomes a POST to `/api/control`, which calls a `Match`
method under its lock.

---

## game/serve.py - the all-in-one server

Purpose: the single entry point. Hosts the static site, runs the live training
loop in a daemon thread, and translates HTTP routes into `Match` method calls.

How: standard-library `http.server` only. A module-global `match` object holds
the whole tournament; a handful of module globals (`_speed`, `_paused`,
`_ff_remaining`, `_sync_hold_until`) let HTTP handler threads steer the trainer
thread with single atomic assignments (no lock needed; `Match` has its own).

| Symbol | What it does |
| --- | --- |
| `trainer()` | The training loop: honours pause/speed, batches ticks at high speed, burns through fast-forward ("turbo") requests, and survives transient tick errors so the sim never silently dies. |
| `Handler.do_GET` | Routes every `GET /api/...` (snapshot, world/worlds, values incl. q/policy/visits modes + per-cell probe, vstats, mdp, field, va, reward, qprobe, polagree, dpsweeps, history, replay, replays, dp) to the matching `Match` method and serialises the result as JSON; anything else falls through to static file serving. |
| `Handler.do_POST` | Parses `/api/control` bodies safely (size cap, bad-JSON and bad-value guards) and dispatches to `_control`. |
| `Handler._control` | The command switchboard: play/pause/speed/fastForward, regenerate/reset/resetTournament, round navigation, algorithm switches, parameter updates, loadouts, the award, and the frontend's world-load sync holds. |
| `Handler._json`, `end_headers`, `log_message` | JSON reply helper; no-cache headers; silenced request logging. |
| `Server` | A `ThreadingHTTPServer` that swallows the harmless connection-reset errors a polling browser constantly produces. |
| `main()` | Picks a free port (8008-8027), starts the trainer thread, opens the browser, and saves a final Round-4 checkpoint on shutdown. |

---

## game/rl/core/ - the shared layer

### core/worldgen.py - grid-world primitives

Purpose: the data language every grid round speaks: the tile alphabet, the
`World` container, and a generic solvability check.

| Symbol | What it does |
| --- | --- |
| `WALL/FLOOR/ESCAPE/RED_SPAWN/BLUE_SPAWN`, `SIZE`, `ORTHO` | The tile characters, the default board size (20), and the four orthogonal offsets. |
| `class World` | A pure data object for one round's static layout: the grid, spawns, goal(s), and every optional per-round feature list (coins, blocks, ice, spikes, plants, pipes, tomatoes, hedges, goombas, bridge, cages, plate puzzles). No behavior, just structure. |
| `World.rows()` | The grid as strings (one per row) - what the browser renders from. |
| `World.to_json()` | The exact world descriptor `/api/world` ships to the browser. |
| `validate(world)` | Hazard-aware reachability check: both spawns must reach a goal ALIVE (never stepping on spikes or into a plant's 8-cell attack zone; pipes count as teleport edges). Raises on an unsolvable map, so a bad seed can never ship. |

### core/grid_env.py - the shared grid engine (Rounds 1-3)

Purpose: everything the three grid rounds have in common: actions, movement,
action masking, the independent-racer outcome machinery, the step/timeout loop,
and the snapshot the viewer polls. Each arena's `env.py` subclasses this and
fills in a small set of hooks.

How: one `GridWorld(gym.Env)` base class. Round-specific behavior is gated by
class flags (`rich`, `hazardous`, `star_mode`, `goomba_mode`) that stay False
here and are switched on by the subclasses when their world features exist.

| Symbol | What it does |
| --- | --- |
| `ACTIONS/N_ACTIONS/MOVE_ACTIONS/STAY/PERP` | The N/S/W/E move set, the Round-3 extra STAY action, and each move's two perpendicular "slip" directions. |
| `STEP_COST/WIN/LOSE/MAX_STEPS` | The shared reward skeleton (-0.01 per step, +/-1 terminal) and the default 400-step cap. |
| `GridWorld.__init__` | Seeds the env RNG, then installs the world produced by the subclass's `_generate`. |
| `_generate(seed)` | Hook: each arena binds its own `world.py` generator here. |
| `_install(world)` | Adopts a (new) world: indexes floor cells, builds the observation space, resets defaults, calls the `_install_features` hook, then finalizes `pos_index` and the action space (the hook may have extended them). |
| `_install_features(world)` | Hook: the arena parses its round's static layout and sets its flags. |
| `passable`, `_resolve`, `_move`, `_set_pos`, `_pos` | Movement primitives: bounds/wall checks and "where does one move land". |
| `effective_actions(agent, pos, star_mask)` | The Boolean action mask the agents' greedy policies rely on: excludes moves that cannot change state (wall bumps), accounts for possible slips, treats locked pipes as walls, and always allows STAY on Round 3. |
| `_pick`, `set_dynamics`, `_set_round_dynamics` | The live-tuning surface: the shared slip-probability trio is applied here; all other knobs are forwarded to the arena's hook. Returns whether a DP state space moved. |
| `reset(...)` | Starts a fresh episode: spawn positions, counters, hazard bookkeeping, the independent-racer state, then the arena's `_reset_round_state` hook. |
| `_accum_parts` | Folds each step's reward into the terminal/shaping/other decomposition the dashboard charts. |
| `observe`, `full_state` | The agent's observation tuple; base is `(cell,)`, each arena overrides with its extra state factors. |
| `_resolve_order` | Hook: who moves first this tick (Round 3 overrides for bridge fairness). |
| `_advance_agent(...)` | Hook: how ONE agent's action resolves; base is the plain deterministic move. |
| `_goal_reached(agent)` | Hook: whether standing on the goal wins (Round 2 also requires all tomatoes). |
| `step(a_red, a_blue)` | The shared tick: per-agent advancement via the hooks, then outcome resolution - hazardous rounds resolve each racer independently (dead/finished racers freeze while the rival plays on), Round 1 ends on first arrival - then the timeout check and the info dict. |
| `to_json`, `snapshot`, `_hazard_snapshot` | The world descriptor and the live per-frame state (positions, steps, winner), plus the death/warp/skid FX cues shared by Rounds 2-3. |

### core/continuous_arena.py - the shared continuous engine (Rounds 4-5)

Purpose: the physics and plumbing the two deep rounds share; the arena
subclasses add their games on top.

| Symbol | What it does |
| --- | --- |
| `DIRS/N_ACTIONS` | The 8 compass thrusts + coast. |
| `ARENA/DT/THRUST/DAMP/VMAX/GOAL_R/AGENT_R/MAX_STEPS`, `STEP_COST/WIN/LOSE`, `RACE_OBS_DIM` | Engine defaults (the base class alone plays a plain fly-to-goal race). |
| `ContinuousArena.__init__` | Shared construction: RNG, physics constants, spawns/goal, the `_init_round_state` hook, then one historical RNG draw (kept so every seeded stream stays reproducible) and `reset()`. |
| `_init_round_state` / `_reset_round_state` | Hooks: one-time and per-episode round state. |
| `_spawn_pos`, `_dist_goal`, `_seconds_to_steps`, `_game_mode` | Small helpers; `_seconds_to_steps` is why all timings are quoted in seconds and stay dt-independent. |
| `_observe_race`, `_observe`, `field_obs` | The base 6-dim race observation, the per-arena observation hook, and the still-state probe the sampled value field uses. |
| `_integrate(pos, vel, action, mult, frozen)` | The one physics step: momentum+drag (R5) or direct discrete velocity (R4), speed caps, and square-wall or circular-rim collision (slide along the rim, don't stick). |
| `_segment_circle_entry_time`, `_swept_hit_time`, `_circle_exit_time` | Swept-circle geometry: exact first-contact times for moving circles - used for missile hits, pickup touches, and rim exits. |
| `_commit_action(side, a)` | Round-4 action-repeat: hold a chosen heading for `action_repeat` steps and report what actually executed. |
| `step`, `to_json`, `snapshot` | The base race game and the base viewer payloads; every arena overrides/extends them. |

### core/base_agent.py - the base tabular agent

Purpose: the one Q-table agent the MC (R2) and TD (R3) families share -
subclasses supply ONLY the update rule, which is exactly the point the course
makes.

| Symbol | What it does |
| --- | --- |
| `Tabular.__init__` | Q as a plain dict keyed by the state tuple, plus alpha/gamma/epsilon and a private RNG. |
| `row(state)` | The state's Q-row, created zeroed on first touch. |
| `greedy_action(state, mask)` | Argmax over the VALID actions with random tie-breaking (so untrained states don't always pick action 0). |
| `policy_action(state, mask)` | Epsilon-greedy over the valid actions - THE explore/exploit dial. |
| `value`, `state_value`, `q_values`, `learned_count` | Inspection accessors for the heatmaps (`state_value` returns None for never-visited states so tiles stay blank). |
| `set_epsilon`, `_record_td`, `td_error`, `reset_learning`, `_valid` | Schedule plumbing, the smoothed \|TD error\| learning signal, the wipe, and the mask helper. |
| `learn_step`, `end_episode` | The hooks subclasses implement (TD learns per step; MC records and learns at episode end). |

### core/registry.py - every name -> thing mapping

Purpose: one place that answers "which module/class does this round or this
algorithm name refer to?". The browser addresses algorithms by string name, so
these names are part of the frozen API.

| Symbol | What it does |
| --- | --- |
| `ROUND_MODULES`, `ROUNDS` | round id -> its arena world module; the tournament running order. |
| `ROUND_ALGOS`, `ALGO_LABELS`, `round_algos`, `round_meta` | Default matchups, display names, and the round metadata card. |
| `make_world` | Builds a round's `World` via its arena generator. |
| `GRID_ENVS` / `make_grid_env`, `CONTINUOUS_ENVS` / `make_continuous_env` | round id -> env class, and the factories the tournament uses. |
| `ALGORITHMS` / `make_agent` | The tabular family (qlearning, sarsa, expected_sarsa, monte_carlo, first_visit_mc). |
| `DP_ALGORITHMS` / `is_dp` / `make_dp` | The Round-1 planners. |
| `DQN_ALGOS`, `PG_ALGOS`, `ROUND_ALGO_FAMILIES`, `is_dqn/is_pg/is_deep` | Name tuples + membership tests that work WITHOUT importing torch. |
| `make_dqn`, `make_pg` | Deep factories; they import torch lazily, inside the call, so the server boots without it. |

### core/tournament.py - the Match driver (construction)

Purpose: the heart object. This file owns CONSTRUCTION - the panel-driven
config state, building the round's env and the two agents - and assembles the
full `Match` class from the concern mixins below (one object, one lock, many
files).

| Symbol | What it does |
| --- | --- |
| `class Match(...)` | The mixin assembly: MatchLoop + Replay + Checkpoint + Controls + RoundFlow + Briefing + Telemetry + Inspection. |
| `Match.__init__` | The RLock, the checkpoint paths, and EVERY panel-driven setting with its default (DP knobs, per-round mechanic dials, per-side DQN internals, PG knobs), then env + agents + stats + checkpoint restore + first episode. |
| `_make_env(round_id)` | Builds the round's env via the registry (continuous vs grid). |
| `_apply_env_config()` | Pushes the panel's current dynamics onto a (re)built env; reports if the DP state space moved. |
| `_rebuild_world()` | Structural change path: new env + agents + restart, bumping `world_version` so the browser refetches the scene. |
| `world_for_round`, `world_json`, `all_worlds` | Read-only world builders for the client's scene prewarm + the locked live accessor. |
| `_is_round4_missile`, `_effective_blue/red_eps_episodes` | Round-4 specifics: the epsilon-decay cap that keeps R4 exploring on a sane budget. |
| `_make_one(algo, color, ...)` | Builds ONE agent of any family (DP planner over the env, DQN with per-side internals, PG with the panel's knobs, or tabular). |
| `_red_from_tier`, `_blue_from_round` | (Re)derive each side's profile from the CPU ladder / Blue's per-arena defaults. |
| `_build_agents`, `_agent` | Construct both sides with seed offsets; side-name lookup. |

### core/match_loop.py - the episode lifecycle + tick

Purpose: the live loop. `tick()` is what the trainer thread calls forever.

| Symbol | What it does |
| --- | --- |
| `_reset_stats()` | Wipes every dashboard series for a fresh contest: wins/outcomes, rolling deques, learning-curve history, replay buffers, milestones, per-cell visit maps, action histograms, reward decomposition, the V(spawn) probe. |
| `_apply_epsilon()` | Advances both sides' linear epsilon schedules (each agent reports its ACTUAL epsilon back - DP reads 0). |
| `_amask(agent)` | The env's effective-action mask for one side (None on continuous arenas). |
| `_new_episode()` | Resets the env, seeds Round-4's curriculum, runs Round-2's exploring-starts logic (7/10 real races, 3/10 mirrored mid-course starts), picks both sides' first actions, and records replay frame 0. |
| `tick()` | ONE simulation step under the lock: env.step, per-side learning (with Round-4's action-repeat macro-transitions folding 4 steps into one learned transition), reward/visit/action bookkeeping, replay frame capture, and on episode end - the win tallies, learning-curve point, replay/milestone capture, checkpoint autosave, and the next episode. |

### core/replays.py - recording + playback

Purpose: everything about remembering great episodes: the per-model top-30
lists and the append-only "first key events" milestones.

| Symbol | What it does |
| --- | --- |
| `FRAME_CAP/HISTORY_CAP/TOP_N` | Recording bounds. |
| `_replay_snapshot(actions)` | One recorded frame: the env snapshot + the actions taken + the DP sweep counter (so Stage-1 replays can show what the planner knew). |
| `_finish_episode(...)` | On episode end: stores the last/best episode, inserts winners into the top-30 (ranked by the round's objective: reward, speed, or survival), freezes Arena-2's per-mask Q fields for honest replay overlays, captures milestones, and appends the learning-curve point. |
| `_DEATH_PHRASE`, `_capture_milestones(...)` | Scans the recorded frames for each FIRST occurrence (first win, first goal, first death by each hazard, first pickup/steal/capture/weapon hit...) and banks a one-off replay per key. |
| `_replay_policy_frames`, `_capture_replay_fields` | The per-sweep DP policy history and Arena-2's frozen Q/value/policy fields that ride along with a replay. |
| `_ceremony_frame(side)` | The finish-line frame the award ceremony zooms on. |
| `replay(which, agent, rank, episode)` | Serves one replay (last / best / top-N / milestone) with its frames and stats. |
| `replays_index(agent)` | The lightweight replay-browser listing (no frames). |

### core/checkpoints.py - Round-4 persistence

Purpose: the deep survival round trains slowly, so its learning survives
restarts via `checkpoints/round4_dqn.pt`.

| Symbol | What it does |
| --- | --- |
| `DQN_CHECKPOINT_*`, `ROUND4_TRAINING_REVISION` | Schema/versioning: the revision is bumped whenever the MEANING of R4 experience changes, so stale checkpoints are rejected and agents retrain. |
| `_checkpoint_eligible`, `_checkpoint_payload` | Only a real R4 DQN-vs-DQN match checkpoints; the payload bundles both sides' full learning state + dims + algorithms. |
| `save_checkpoint(force)` | Periodic (every 25 episodes) or forced save via the atomic writer in the R4 arena package. |
| `_load_checkpoint()` | Validates schema/revision/dims/matchup, PREPARES both sides, then applies both - so a half-corrupt file can never produce a half-restored match. |
| `delete_checkpoint()` | The explicit wipe-learning control. |

### core/controls.py - the live panel

Purpose: `set_params` is the M panel: every slider lands here.

| Symbol | What it does |
| --- | --- |
| `_int_or_none` | Panel convention: -1/empty means "use the built-in default". |
| `set_params(p)` | Clamps and applies every Blue/global knob at the correct depth: live attribute pushes (alpha/gamma/eps, PG knobs), agent rebuilds (network width/buffer), full scene rebuilds (train seed), DP replans (theta/mechanics), and Arena-2's clean MDP restarts when its transition/reward function changes. |
| `params()` | Echo of every current value (reading the LIVE agents where relevant) for the panel UI. |
| `set_red_params(p)` | The same for the locked CPU panel (per-side DQN internals included); manual overrides last until the character changes. |
| `red_view()` | Red's current profile for display. |

### core/rounds.py - tournament flow

Purpose: rounds, matchups, resets and the award.

| Symbol | What it does |
| --- | --- |
| `regenerate(seed)` | New world + wiped models (advances the train seed so repeated clicks differ but stay reproducible). |
| `reset_models`, `reset_tournament` | Wipe learning keeping the world; restart from round 1 with cleared score. |
| `set_cpu_tier(tier, level, force)` | Installs the chosen CPU character's ladder row and rebuilds Red. |
| `set_side_algo(side, algo)` | Algorithm switch, validated against the round's family. |
| `_algo_for_env`, `_round_matchup`, `set_loadouts` | The menu's per-round picks, applied only when compatible with the round's env kind. |
| `set_round`, `prev_round`, `next_round` | Round navigation: rebuild env + matchup + profiles; NEVER scores (checkpoint saved on the way out). |
| `award_round`, `_award_current_round` | The T award: banks the point for the recent-window leader exactly once, builds the ceremony event, and can never double-score or re-decide a banked round. |
| `_matchup`, `_family` | Live matchup labels for the HUD; Blue's algorithm family name. |

### core/briefing.py - the Challenge card

Purpose: one big, deliberately explicit method.

| Symbol | What it does |
| --- | --- |
| `mdp_spec()` | Describes the CURRENT round as an MDP for the browser's Challenge card: the state structure (with visual factor/segment breakdowns), the observation, dynamics text, every reward term, the win condition, and both sides' live learning profiles - all read off the live env so panel changes show immediately. One branch per round family. |

### core/telemetry.py - the polled feed

Purpose: the aggregate numbers the browser polls ~30x/second.

| Symbol | What it does |
| --- | --- |
| `stats()` | The big dashboard payload: score/results/award state, episodes, wins, rates, returns and their std, learned-state counts, params echoes, outcome split (win/draw/timeout), action distribution, learning signals, per-side diagnostics. |
| `snapshot(include_world)` | worldVersion + the env frame + `stats()` - the one poll the viewer lives on. |
| `history()` | The learning-curve points. |
| `dp_report`, `dp_planning_complete`, `dp_sweeps` | Round-1 convergence: per-sweep deltas, converged flags, and the V-propagation animation frames. |
| `_learn_signal`, `_dqn_field`, `_diag`, `_ret_std`, `_recent_outcome` | Per-side diagnostics helpers (tabular \|TD\|, DQN loss/grad/predQ, PG losses/entropy). |
| `_action_labels`, `action_dist` | Human action names (camera-aware for R1) + the normalized action histogram. |

### core/inspection.py - looking inside the models

Purpose: everything that renders the LEARNING itself.

| Symbol | What it does |
| --- | --- |
| `_unique_argmax` | The sole maximizer or None - a genuine tie renders as "no arrow". |
| `policy_grid(agent)` | Per-tile greedy action (masked to effective actions), plus the through-wall ghost arrows while R1's power-up is active (`_ghost_wall_arrows`). |
| `value_grid`, `q_grid`, `q_at` | V(s) per tile; per-action Q per tile with the actually-taken best highlighted; the single-tile Q inspector. |
| `visit_grid`, `visit_stats` | The travel heatmap and its coverage/entropy summary (continuous rounds use a 32x32 histogram). |
| `arena_field(agent, n, mode)` | The continuous rounds' sampled value/policy field: probe the net's Q over an n x n grid of still states (or the visit histogram). |
| `va_probe(agent)` | Dueling-DQN's V/A split at the agent's current position. |
| `reward_decomp`, `_record_probe`, `q_probe_series` | The terminal/shaping/step-cost split, and V(spawn) over time - "watch the start state's value climb". |
| `policy_agreement()` | How much the two greedy policies agree, mirror-aware on symmetric boards. |

### core/ladders.py - the CPU difficulty ladders

Purpose: Red's whole personality. 10 hyperparameter rows per arena (level 0 =
Mario ... 9 = Parabones) plus Blue's per-arena starting profiles.

| Symbol | What it does |
| --- | --- |
| `RED_MODELS` | The generic ladder (plan_speed for R1, alpha/eps schedules) + each row's dedicated Arena-2 MC block. |
| `R3_LADDER`, `R4_LADDER`, `R5_LADDER` | The per-arena overrides (R5's rows carry entropy instead of epsilon). |
| `BLUE_MODEL`, `BLUE_R4`, `BLUE_R5` | Blue's validated starting profiles. |
| `red_params(level, round_id)`, `blue_params(round_id)` | Resolve one flat profile for a level + arena. |

---

## game/rl/arenas/ - one package per round

Each arena package bundles everything specific to its round. The pattern is
identical in all five: `world.py` builds the static layout, `env.py`/`arena.py`
implements the round's mechanics as a subclass of the shared engine, and the
algorithm files implement that round's family.

### r1_peach_castle/ - Round 1, Dynamic Programming

| File | Purpose + contents |
| --- | --- |
| `world.py` | The mirror-symmetric castle maze generator. `generate(seed)` carves a spanning tree on the left half (`carve`), mirrors it, adds centre links + braids (loops) so routing is a real choice, force-connects the Moon, then places mirrored coins/blocks/ice (`take` picks fair fractions; `_mirror`/`_cell`/`_m` are the reflection helpers) and validates. |
| `env.py` | `PeachCastleEnv(GridWorld)` - the "rich" stochastic MDP. `_install_features` parses coins/blocks and extends positions with ghost-phaseable interior walls; `full_state` returns `(cell, mask, status)`; `state_transition` + `_land` are THE known model (slip outcomes, coin pickups, the ghost/freeze gamble) that both the live game (via `_apply_rich`, which samples one outcome) and the DP planners (which sum all outcomes) consume - guaranteeing the planners plan the true game; `_ghost_step` is the one-cell wall phase; `_advance_agent`/`snapshot`/`_set_round_dynamics` wire it into the engine. Constants: `COIN_REWARD`, `GHOST_LEN`, `FREEZE_LEN`, `SLIP_PROB`, `BLOCK_REWARD`. |
| `dp_base.py` | `_DPBase` - the planner shared by both methods: `_enumerate_states` builds the full cell x mask x status space (wall cells get ghost statuses only), `_init_plan` precomputes the transition model once, `_q_of`/`_greedy` are the Bellman backup, `plan_tick` spends the per-tick sweep budget (the RACE mechanism), `_value_slice`/`_policy_slice`/`_log_sweep` record the propagation-animation frames, and the agent-interface methods (`policy_action`, `q_values`, ...) let the tournament drive a planner exactly like a learner. |
| `value_iteration.py` | `ValueIteration._sweep`: one synchronous Bellman-OPTIMALITY sweep (`V <- max_a Q`), policy refreshed greedily each sweep. |
| `policy_iteration.py` | `PolicyIteration._sweep`: truncated PI - up to `EVAL_SWEEPS` (8) policy-EVALUATION passes, then one greedy IMPROVEMENT; converged when the policy is stable and values settled. |

### r2_new_donk_city/ - Round 2, Monte Carlo

| File | Purpose + contents |
| --- | --- |
| `world.py` | The three-room city course. `_build` assembles: the two sealed stair-step dividers, the bottom room's tomato spur + safe/risky fork through a mandatory puddle beside a plant, the shared tomato-locked centre Pipe, the mirrored middle room (second tomato detour + fork + side Pipes), and the top room (final tomato + corridors + goal); `generate` runs `_build` and validates; `_ascii` is a debug printer. |
| `course_tools.py` | The carving toolbox: board constants, `_mirror`/`_surrounding`, `_left_steps`/`_divider` (the sealed stair dividers), `_line`/`_join`/`_shortest_path` (route assembly), `_decision_barrier`/`_branch_cells` (the safe-vs-risky fork), `_run_at`/`_component_count`, and `_procedural_maze_walls` - the seeded bush scatterer that fills each room while preserving exactly three sections and the two-bush run limit. |
| `course_checks.py` | `_validate_design` - every rule a seeded course must obey (mirror symmetry, sealed dividers, three sections, mirrored tomatoes, safe-longer-than-risky in all rooms, mandatory puddles really gating their shortcuts, plant zones clear, sane Pipe landings). A violation raises, so a broken course can never ship. |
| `env.py` | `NewDonkCityEnv(GridWorld)`: `_install_features` parses plants (+ their lethal 8-cell zones), pipes (with weights + tomato locks), and the per-agent tomato sets; `_r2_resolve` is one move (skid sample, pipe transfer, death check); `_advance_agent` applies it + tomato collection; `_goal_reached` enforces the full-set lock; `_pipe_unlocked`, `full_state` (`(cell, mask)`), `snapshot`, `_set_round_dynamics`. Constants: `R2_SLIP_PROB`, `STAR_REWARD`. |
| `monte_carlo.py` | `MonteCarlo(Tabular)`: `learn_step` only records; `end_episode` walks the trajectory backward computing G and updates EVERY (s,a) occurrence with the gentle `alpha x STEP_SCALE` step. |
| `first_visit_mc.py` | `FirstVisitMonteCarlo(MonteCarlo)`: same, but `end_episode` updates only each pair's FIRST occurrence. |

### r3_fossil_falls/ - Round 3, Temporal Difference

| File | Purpose + contents |
| --- | --- |
| `world.py` | The random perfect maze. `_carve_maze` (recursive backtracker) fills 19x19 with 1-thick walls; `_path`/`_open`/`_open_neighbors` are route helpers; `_place_goombas` grows side-branch patrols that cross the main route (`branch_patrol`/`try_place`); `_place_cage` carves mirrored off-route cage nooks (`bfs`/`nook_off`); `_place_wet` places mirrored wet cells on the route; `_place_plate_puzzles` carves the sealed secret-door shortcut + boulder + plate; `generate` assembles + validates. |
| `env.py` | `FossilFallsEnv(GridWorld)`: `_install_features` parses patrols/bridge/cages/puzzles, exposes STAY, computes the shared patrol period (LCM); `_goomba_positions(step)` is the deterministic triangle-wave patrol; `_resolve_order` gives the racer nearer the goal the bridge on ties and freezes this tick's goomba cells; `_advance_agent` is the whole round: wet skids, boulder pushes, sealed doors, rival-cell blocking, cage grabs (bonus only when BEHIND), goomba/swap deaths, cage countdowns; `full_state` returns `(cell, phase, rival_flag, door)`; `_rival_flag` packs ahead/level/behind x cage-ready; `snapshot`, `_set_round_dynamics`. Constants: `R3_SLIP_PROB`, `CAGE_LEN`, `CAGE_REWARD`. |
| `qlearning.py` | `QLearning.learn_step`: the off-policy TD update - target `r + gamma * max_a' Q(s',a')` over the effective next actions. |
| `sarsa.py` | `Sarsa.learn_step`: the on-policy update - target `r + gamma * Q(s', a')` with the action ACTUALLY taken next. |
| `expected_sarsa.py` | `ExpectedSarsa.learn_step` + `_expected`: bootstraps on the epsilon-greedy policy's EXPECTED next value. |

### r4_ruined_kingdom/ - Round 4, deep value-based (DQN)

| File | Purpose + contents |
| --- | --- |
| `world.py` | Metadata only (`THEME/ROUND_ID/TITLE/CONTINUOUS`); the env is the continuous arena, so `generate()` deliberately raises. |
| `arena.py` | `MissileArena(MissilesMixin, PickupsMixin, ContinuousArena)` - the game rules: class attrs pin the spec (10 m circle, dt 0.02, no momentum, action-repeat 4); `_init_round_state`/`_reset_round_state` own missiles/pickups/hearts/mercy state (+ the explosion carryover so the browser never misses a terminal blast); `set_missile_dynamics` + `set_curriculum_episode`/`_curriculum_progress`/`_chaos`/`_sharpness`/`_difficulty` are the dials + escalation schedule; `_missile_observe` builds the 55-dim threat-sorted observation; `_grant_hit_invuln`/`_immune` the mercy window; `step` commits the action-repeat then `_step_missile_game` runs one tick (age timers, move, dodge shaping, missile resolution, pickups, hearts, win/timeout); `to_json`/`snapshot` add the round's viewer payloads. Reward constants live here (`SURVIVAL_REWARD`, `HIT_REWARD`, `HIT_PENALTY`, `HEARTS`, ...). |
| `missiles.py` | `MissilesMixin` - the Bill pipeline: `_threat_metrics`/`_threat_key` (time-to-impact + predicted miss, the obs sort), `_missile_interval`/`_missile_limit`/`_spawn_missile` (the escalating barrage), `_advance_missiles` (homing with capped turn, swept-circle impact resolution in exact event-time order, shield blocks, evade bonuses), `_add_explosion`/`_age_explosions`, and `_dodge_potential`/`_dodge_shaping` (the capped potential-based dodge credit). Constants: `MISSILE_*`, `EVADE_REWARD`, `DODGE_*`. |
| `pickups.py` | `PickupsMixin` - the collectibles: spawn placement rules (`_pickup_position_is_valid`/`_spawn_pickup`), the chaos-scaled caps and cadence (`_pickup_max_active`/`_advance_pickup_spawns`), swept-contact collection with tie-breaks (`_collect_pickups`), the speed/slow/freeze movement effects (`_movement_effect`/`_tick_effects`), and the viewer's pickup events. Constants: `PICKUP_*`, `SPEED/SLOW_MULTIPLIER`. |
| `dqn.py` | The base deep agent. `QNet` (the MLP: `_mlp` trunk + linear head - THE "how many layers" answer: hidden x layers, default 128 x 2); `ReplayBuffer` (preallocated ring buffer, O(batch) sampling); `DQNAgent` - epsilon-greedy over net outputs, `learn_step` -> n-step folding (`_emit_nstep_from_front`) -> `_train` (minibatch, Huber loss, gradient clip, target-net sync, the `double` branch that decouples select/evaluate), `diag` (loss/grad/predQ/buffer/sync for the dashboard), `checkpoint_state`/`prepare_`/`apply_checkpoint_state` (validated persistence), `reset_learning`. Also the atomic checkpoint file I/O: `save_checkpoint_file`/`load_checkpoint_file`. |
| `double_dqn.py` | `DoubleDQNAgent`: sets `double = True` - the one-flag change to the bootstrap target. Includes the standalone Round-4 learnability self-test. |
| `dueling_dqn.py` | `DuelingQNet` (trunk -> V head + A head, `Q = V + A - mean A`) and `DuelingDQNAgent` (same training, different head) + `value_advantage` for the panel's V/A probe. |

### r5_tostarena/ - Round 5, policy gradient

| File | Purpose + contents |
| --- | --- |
| `world.py` | Metadata only, like Round 4's. |
| `arena.py` | `CtfArena(CtfWeaponsMixin, ContinuousArena)` - Capture the Flag: `_init_round_state`/`_reset_round_state` own bases/flag/captures/stuns/weapons/ship state; `set_ctf_dynamics` the airship dials; `_observe_ctf` builds the 66-dim opponent-aware observation; `_ctf_potential` the PBRS shaping target (flag/base/carrier per possession); `_step_ctf_game` runs one tick in strict order (age stuns -> crates -> USE weapon -> move -> grab/capture/steal state machine -> crates/shells/traps/airship -> shaping -> win/timeout); `to_json`/`snapshot` the round's viewer payloads. All CTF reward + geometry constants live here. |
| `weapons.py` | `CtfWeaponsMixin` - the weapon subsystems: crates (`_crate_pos_valid`/`_spawn_crate`/`_advance_crate_spawns`/`_resolve_crates`), firing (`_use_weapon`: chain throw, red/green shells, laid banana/oil), flight + hits (`_advance_chains` two-phase throw-then-reel, `_advance_shells` homing/bouncing + owner-grace, `_advance_traps` trigger + oil knockback), and Bowser's airship (`_advance_bowser`: drifting ship, random-target throws, blast stuns). All weapon/airship constants live here. |
| `pg_base.py` | `PolicyNet` (Tanh trunk -> policy logits + optional value head) and `PGAgent` - the shared policy-gradient base: `policy_action` SAMPLES from the categorical (that IS the exploration; `set_epsilon` is a no-op), `q_values`/`state_value` expose logits/critic-V so the shared visualizations still render, `learn_step` records rollouts, `_returns`/`_smooth`/`diag`/`reset_learning`, and the alpha -> Adam-lr mapping. |
| `reinforce.py` | `REINFORCE.end_episode`: the Monte-Carlo policy gradient - whitened full-episode returns weight the log-probs, plus the entropy bonus. |
| `actor_critic.py` | `ActorCritic`: 64-step rollouts, `_update` computes GAE advantages off the CURRENT critic (bootstrapping the tail), one combined actor+critic step per rollout - the true bootstrapping critic between REINFORCE and PPO. |
| `ppo.py` | `PPO`: `learn_step` caches the OLD policy's log-prob + value; `_gae` computes advantages across episode boundaries; `_update` runs epochs x minibatches of the CLIPPED ratio objective. Includes the standalone CTF learnability self-test. |

---

## game/src/ - the browser viewer (high level)

The JavaScript is a pure viewer: it polls the backend and renders; no learning
happens here. Per-file, briefly:

| File | What it does |
| --- | --- |
| `main.js` | Boot + the poll loop: fetches `/api/snapshot`, routes frames to the scene, drives rendering. |
| `live.js` | The two on-board characters: movement lerps, deaths, warps, effects - driven by polled frames. |
| `layout.js` | Board geometry: cell-to-world transforms (including per-theme cell scale). |
| `themes/` (`peach/city/fossilfalls/ruined/tostarena.js` + `index.js`) | Each round's 3D scene: geometry, palette, sky, camera, and the round's special FX (plants, pipes, goombas, missiles, flags, weapons). |
| `panel.js` | The docked training panel (N/M): playback controls + the tabbed dashboards (Challenge/Score/Progress/Tune/Advanced/Inside/Replays). |
| `graphs.js` | Learning-curve + DP-convergence charts and the replay browser player. |
| `heatmap.js` | The V(s)/Q/policy/visits overlays on the board. |
| `hud.js`, `award.js` | The top HUD (score, matchup, round dots) and the award ceremony. |
| `startmenu.js`, `characters.js`, `boardchars.js` | The cinematic start menu, character select, and character models/animation. |
| `camera.js`, `postfx.js`, `transition.js`, `loadscreen.js` | Camera rig, post-processing, the iris round transition, and the cap-wipe boot loader. |
| `config.js`, `devbar.js` | Client config; the I-key developer toolbar (inspect/rotate/free-cam). |

## Everything else

| File / folder | What it does |
| --- | --- |
| `game/index.html` | The page shell that loads the viewer modules. |
| `game/vendor/three/` | Vendored three.js - the project needs no package manager. |
| `game/assets/` | Models and textures (Git LFS). |
| `game/run.bat` / `game/run.command` | Double-click launchers (install deps if missing, run `serve.py`). |
| `game/requirements.txt` | `gymnasium`, `numpy`, `torch` (torch used only by Rounds 4-5). |
| `checkpoints/` | Round-4's saved learning (`round4_dqn.pt`), created at runtime; gitignored. |
| `README.md`, `GUIDE_EN/HE.md`, `CODE_MAP.md`, `FILES_EN/HE.md` | The docs: overview + parameters, the from-zero course guide, concept -> code lookup, and this file. |
