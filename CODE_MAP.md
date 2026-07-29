# CODE_MAP - from question to exact code location

Every path is relative to `game/rl/` unless it starts with `game/`. Every row
was verified against the code after the restructure.

## The big picture

| Question / concept | File | Class or function |
| --- | --- | --- |
| Where does the whole backend start? | `game/serve.py` | `main()` builds the `Match`, starts the trainer thread + HTTP server |
| How does the browser talk to Python? | `game/serve.py` | `Handler.do_GET` / `do_POST` route `/api/*` to `Match` methods |
| What drives the simulation forward? | `core/match_loop.py` | `MatchLoopMixin.tick` (one env step + both agents learn, called by serve.py's `trainer()` loop) |
| Where is the Match object assembled? | `core/tournament.py` | `class Match(...)` (construction + env/agent building; every other concern is a mixin) |
| Which algorithm names exist, per round? | `core/registry.py` | `ALGORITHMS`, `DP_ALGORITHMS`, `DQN_ALGOS`, `PG_ALGOS`, `ROUND_ALGO_FAMILIES` |
| How is an agent built by name? | `core/registry.py` | `make_agent` / `make_dp` / `make_dqn` / `make_pg` (deep factories import torch lazily) |
| Which env class does each round use? | `core/registry.py` | `GRID_ENVS`, `CONTINUOUS_ENVS`, `make_grid_env`, `make_continuous_env` |
| The round running order + titles | `core/registry.py` | `ROUNDS`, `ROUND_MODULES`, `round_meta` |

## States, actions, rewards

| Question / concept | File | Class or function |
| --- | --- | --- |
| The grid rounds' action space (N/S/W/E + Stay) | `core/grid_env.py` | `ACTIONS`, `MOVE_ACTIONS`, `STAY` |
| The continuous rounds' action space (8 thrusts + coast) | `core/continuous_arena.py` | `DIRS`, `N_ACTIONS` |
| Round 1's state tuple `(cell, collected mask, status)` | `arenas/r1_peach_castle/env.py` | `PeachCastleEnv.full_state` |
| Round 2's state tuple `(cell, tomato mask)` | `arenas/r2_new_donk_city/env.py` | `NewDonkCityEnv.full_state` |
| Round 3's state tuple `(cell, phase, rival flag, door)` | `arenas/r3_fossil_falls/env.py` | `FossilFallsEnv.full_state` |
| Round 4's 55-dim observation vector | `arenas/r4_ruined_kingdom/arena.py` | `MissileArena._missile_observe` (layout constant `MISSILE_OBS_DIM`) |
| Round 5's 66-dim observation vector | `arenas/r5_tostarena/arena.py` | `CtfArena._observe_ctf` (layout constant `CTF_OBS_DIM`) |
| The reward function, grid rounds (step cost, win/lose) | `core/grid_env.py` | `STEP_COST`, `WIN`, `LOSE`, applied in `GridWorld.step` |
| Round 1's coin / Mystery-Block rewards | `arenas/r1_peach_castle/env.py` | `COIN_REWARD`, `BLOCK_REWARD`, paid in `_land` |
| Round 2's tomato reward + plant death | `arenas/r2_new_donk_city/env.py` | `STAR_REWARD` (paid in `_advance_agent`), deaths in `_r2_resolve` |
| Round 3's cage bonus (paid only when behind) | `arenas/r3_fossil_falls/env.py` | `CAGE_REWARD`, gate inside `_advance_agent` |
| Round 4's survival / hit / evade rewards | `arenas/r4_ruined_kingdom/arena.py` | `SURVIVAL_REWARD`, `HIT_PENALTY` (class attr `hit_penalty`), `HIT_REWARD`; `EVADE_REWARD` in `missiles.py` |
| Round 4's dodge shaping (potential-based) | `arenas/r4_ruined_kingdom/missiles.py` | `MissilesMixin._dodge_potential` / `_dodge_shaping` |
| Round 5's CTF rewards (grab/steal/capture/...) | `arenas/r5_tostarena/arena.py` | `GRAB_REWARD` ... `CTF_WIN` constants, paid in `_step_ctf_game` |
| Round 5's potential-based shaping (PBRS) | `arenas/r5_tostarena/arena.py` | `CtfArena._ctf_potential` + `CTF_SHAPE_COEF` |

## Environments and worlds

| Question / concept | File | Class or function |
| --- | --- | --- |
| The shared grid engine (movement, masking, step loop) | `core/grid_env.py` | `class GridWorld` |
| The shared continuous engine (physics, geometry) | `core/continuous_arena.py` | `class ContinuousArena` (`_integrate` is the physics) |
| Round 1's known stochastic model P(s'\|s,a) | `arenas/r1_peach_castle/env.py` | `PeachCastleEnv.state_transition` (+ `_land`) |
| Ice / puddle / wet-cell slipping | masks in `core/grid_env.py`; sampled per round in `arenas/r1_peach_castle/env.py` (`state_transition`), `arenas/r2_new_donk_city/env.py` (`_r2_resolve`), `arenas/r3_fossil_falls/env.py` (`_advance_agent`) | `PERP`, `slip_prob` / `r2_slip_prob` / `r3_slip_prob` |
| Warp pipes + tomato progression locks | `arenas/r2_new_donk_city/env.py` | `_install_features` (pipe parsing), `_pipe_unlocked` |
| Goomba patrols (deterministic timing hazard) | `arenas/r3_fossil_falls/env.py` | `_goomba_positions`, patrol phase in `full_state` |
| The boulder / pressure-plate secret door | `arenas/r3_fossil_falls/env.py` | inside `FossilFallsEnv._advance_agent` |
| Banzai Bill spawning / homing / impacts | `arenas/r4_ruined_kingdom/missiles.py` | `MissilesMixin._spawn_missile` / `_advance_missiles` |
| Round 4 pickups (speed/shield/slow/freeze) | `arenas/r4_ruined_kingdom/pickups.py` | `PickupsMixin` |
| Hearts + post-hit mercy invulnerability | `arenas/r4_ruined_kingdom/arena.py` | `_step_missile_game` (hearts), `_grant_hit_invuln` / `_immune` |
| The Round-4 training curriculum | `arenas/r4_ruined_kingdom/arena.py` | `set_curriculum_episode` / `_curriculum_progress` / `_chaos` |
| Capture-the-flag rules (grab / steal / capture) | `arenas/r5_tostarena/arena.py` | `CtfArena._step_ctf_game` |
| Crate weapons (chain / shells / banana / oil) | `arenas/r5_tostarena/weapons.py` | `CtfWeaponsMixin._use_weapon` + `_advance_chains/_advance_shells/_advance_traps` |
| Bowser's airship hazard thrower | `arenas/r5_tostarena/weapons.py` | `CtfWeaponsMixin._advance_bowser` |
| The `World` data object + tile alphabet | `core/worldgen.py` | `class World`, `WALL`/`FLOOR`/`ESCAPE`, `validate` |
| Round 1's maze generator (mirror-symmetric) | `arenas/r1_peach_castle/world.py` | `generate` |
| Round 2's three-room course generator | `arenas/r2_new_donk_city/world.py` | `generate` / `_build` (+ `course_tools.py`, validated by `course_checks.py`) |
| Round 3's random perfect maze generator | `arenas/r3_fossil_falls/world.py` | `generate` |

## The algorithms

| Question / concept | File | Class or function |
| --- | --- | --- |
| Epsilon-greedy exploration | `core/base_agent.py` | `Tabular.policy_action` (and `greedy_action` for ties) |
| The Q-table itself | `core/base_agent.py` | `Tabular.Q` (a dict keyed by the state tuple), `row` |
| The Bellman optimality backup (VI) | `arenas/r1_peach_castle/value_iteration.py` | `ValueIteration._sweep` |
| Policy evaluation + improvement (PI) | `arenas/r1_peach_castle/policy_iteration.py` | `PolicyIteration._sweep` (truncated: `EVAL_SWEEPS`) |
| The incremental "planning race" machinery | `arenas/r1_peach_castle/dp_base.py` | `_DPBase.plan_tick` / `_q_of` / `_enumerate_states` |
| The Monte-Carlo return update (every-visit) | `arenas/r2_new_donk_city/monte_carlo.py` | `MonteCarlo.end_episode` |
| First-visit vs every-visit contrast | `arenas/r2_new_donk_city/first_visit_mc.py` | `FirstVisitMonteCarlo.end_episode` |
| The Q-Learning update (off-policy TD) | `arenas/r3_fossil_falls/qlearning.py` | `QLearning.learn_step` |
| The SARSA update (on-policy TD) | `arenas/r3_fossil_falls/sarsa.py` | `Sarsa.learn_step` |
| The Expected-SARSA update | `arenas/r3_fossil_falls/expected_sarsa.py` | `ExpectedSarsa.learn_step` / `_expected` |
| How many layers does the DQN network have? | `arenas/r4_ruined_kingdom/dqn.py` | `QNet.__init__` (via `_mlp`; width/depth are the `hidden`/`layers` panel knobs, default 128 x 2) |
| Experience replay | `arenas/r4_ruined_kingdom/dqn.py` | `class ReplayBuffer` |
| The target network + sync interval | `arenas/r4_ruined_kingdom/dqn.py` | `DQNAgent.__init__` (`self.target`), synced in `_train` |
| n-step returns | `arenas/r4_ruined_kingdom/dqn.py` | `DQNAgent._emit_nstep_from_front` |
| Double-DQN's decoupled action selection | `arenas/r4_ruined_kingdom/dqn.py` | the `self.double` branch in `DQNAgent._train` (flag set by `double_dqn.py`) |
| The Dueling value/advantage split | `arenas/r4_ruined_kingdom/dueling_dqn.py` | `DuelingQNet.forward` (Q = V + A - mean A) |
| The policy network (actor +/- critic head) | `arenas/r5_tostarena/pg_base.py` | `class PolicyNet` |
| Sampling actions from the policy | `arenas/r5_tostarena/pg_base.py` | `PGAgent.policy_action` (Categorical sample = the exploration) |
| The REINFORCE update (whitened returns) | `arenas/r5_tostarena/reinforce.py` | `REINFORCE.end_episode` |
| The advantage + GAE | `arenas/r5_tostarena/actor_critic.py` | `ActorCritic._update`; PPO's version in `ppo.py` `PPO._gae` |
| The PPO clipped objective | `arenas/r5_tostarena/ppo.py` | `PPO._update` (the `torch.clamp(ratio, ...)` line) |
| The discount gamma | every agent's `gamma` attribute | set from the panel via `core/controls.py` `set_params`, defaults in `core/ladders.py` |
| On-policy vs off-policy, in one diff | `arenas/r3_fossil_falls/sarsa.py` vs `qlearning.py` | the one `target = ...` line in each `learn_step` |

## The tournament around them

| Question / concept | File | Class or function |
| --- | --- | --- |
| How the CPU difficulty ladder works | `core/ladders.py` | `RED_MODELS` (+ `R3_LADDER`/`R4_LADDER`/`R5_LADDER`), resolved by `red_params` |
| Blue's per-arena starting profiles | `core/ladders.py` | `BLUE_MODEL`, `BLUE_R4`, `BLUE_R5`, `blue_params` |
| The epsilon schedule applied every episode | `core/match_loop.py` | `MatchLoopMixin._apply_epsilon` |
| Round 2's exploring-starts curriculum | `core/match_loop.py` | inside `_new_episode` (the `stage` block) |
| Round 4's action-repeat macro-learning | `core/match_loop.py` | the `_learn` closure inside `tick` |
| The live panel controls (alpha/gamma/eps/DQN/PG knobs) | `core/controls.py` | `ControlsMixin.set_params` / `set_red_params` |
| Round navigation + the award (T) | `core/rounds.py` | `RoundFlowMixin.set_round` / `award_round` |
| The Challenge-card MDP description | `core/briefing.py` | `BriefingMixin.mdp_spec` |
| The stats/snapshot feed the browser polls | `core/telemetry.py` | `TelemetryMixin.stats` / `snapshot` |
| V(s) heatmap / per-action Q / policy arrows | `core/inspection.py` | `value_grid` / `q_grid` (+ `q_at`) / `policy_grid` |
| The continuous rounds' sampled value field | `core/inspection.py` | `InspectionMixin.arena_field` |
| Replays + "first key event" milestones | `core/replays.py` | `ReplayMixin._finish_episode` / `_capture_milestones` |
| Round-4 checkpoint save/load | `core/checkpoints.py` | `CheckpointMixin` (file I/O in `arenas/r4_ruined_kingdom/dqn.py`) |
