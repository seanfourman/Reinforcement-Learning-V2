"""The live tournament - env + two learning/planning agents, driven one step at
a time, across a sequence of themed rounds.

A background thread (in ``serve.py``) calls ``tick()`` repeatedly; the viewer
reads ``snapshot()`` / ``value_grid()`` / ``history()`` / ``replay()``
concurrently, so every state mutation and read is guarded by one lock. Controls
(switch round, set a side's algorithm, regenerate, reset, epsilon schedule) are
serialized through it too.

Each round is a head-to-head between two (possibly different) algorithms - e.g.
Round 1 is Value-Iteration (Red) vs Policy-Iteration (Blue). A round's point is
awarded ONLY by pressing T (``award_round``): it goes to whichever model leads
the recent contest (a tie is a genuine draw, no point), and the frontend gets a
finish-line frame for the ceremony. Navigating between rounds is free - it never
scores and can never double-count. Round wins accumulate into the tournament
``score`` shown in the HUD.
"""

import os
import threading

from arenas.r1_peach_castle.env import (COIN_REWARD, BLOCK_REWARD,
                                        GHOST_LEN, FREEZE_LEN, SLIP_PROB)
from arenas.r2_new_donk_city.env import R2_SLIP_PROB, STAR_REWARD
from arenas.r3_fossil_falls.env import R3_SLIP_PROB, CAGE_REWARD, CAGE_LEN
from core import registry
from core.registry import (is_dp, is_dqn, is_pg,
                           make_agent, make_dp, make_dqn, make_pg)
from core.briefing import BriefingMixin
from core.checkpoints import CheckpointMixin, DQN_CHECKPOINT_NAME
from core.controls import ControlsMixin
from core.inspection import InspectionMixin
from core.ladders import RED_GAMMA, red_params, blue_params
from core.match_loop import MatchLoopMixin
from core.replays import ReplayMixin
from core.rounds import RoundFlowMixin
from core.telemetry import TelemetryMixin


class Match(MatchLoopMixin, ReplayMixin, CheckpointMixin, ControlsMixin,
            RoundFlowMixin, BriefingMixin, TelemetryMixin, InspectionMixin):
    """The live tournament driver, assembled from the concern mixins above.

    This class body owns CONSTRUCTION: the panel-driven configuration state,
    building the round's env + the two agents, and the derived per-side
    profiles. The lifecycle (ticking, episodes), controls, replays, telemetry
    and inspection each live in their own core/ module as a mixin - every
    method still runs on this one object, guarded by its one lock.
    """

    def __init__(self, seed=None, round_id=1, checkpoint_dir=None):
        self.lock = threading.RLock()
        self.seed = seed
        self.round_id = round_id
        # this file lives at game/rl/core/, so the repo root is three levels up
        project_root = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        self.checkpoint_dir = os.path.abspath(
            checkpoint_dir if checkpoint_dir is not None
            else os.path.join(project_root, "checkpoints")
        )
        self.checkpoint_path = os.path.join(self.checkpoint_dir, DQN_CHECKPOINT_NAME)
        self.checkpoint_status = "not-checked"
        self.checkpoint_error = None
        self.checkpoint_episode = 0
        self._last_checkpoint_episode = -1
        # ---- panel-driven GLOBAL config (apply to BOTH agents / the env) -------
        # These are structural: the algorithms' internals and the world dynamics,
        # as opposed to the per-side learning knobs (alpha/gamma/epsilon) below.
        self.train_seed = seed                 # reproducibility: seeds env rng + agents
        self.max_steps_override = None          # None -> each env's own default cap
        # DP planners (Round 1: Value/Policy Iteration)
        self.dp_theta = 1e-5                    # convergence threshold
        self.dp_max_sweeps = 2000               # hard iteration cap per phase
        self.dp_plan_speed = 0.6               # Blue's Bellman sweeps per tick (race knob)
        # Round-1 game mechanics (Peach's Castle): pushed onto the env after any (re)build
        # via _apply_env_config; a change re-enumerates + re-solves both DP planners.
        self.slip_prob = SLIP_PROB              # ice/puddle slip chance (half each side)
        self.ghost_len = GHOST_LEN              # floor tiles reachable while wall-phasing
        self.freeze_len = FREEZE_LEN            # turns stuck after a freeze roll
        self.block_ghost_prob = 0.5             # P(Ghost) on a Mystery Block
        self.coin_reward = COIN_REWARD          # value of an optional coin
        self.block_reward = BLOCK_REWARD        # bonus on a Ghost roll
        # Round-2 game mechanics (New Donk City). Hazard placement/counts are part
        # of the validated seeded course; only their stochastic risk and shaping
        # reward are live controls.
        self.r2_slip_prob = R2_SLIP_PROB
        self.r3_slip_prob = R3_SLIP_PROB        # Round-3 wet-cell skid chance (live control)
        self.r2_tomato_reward = STAR_REWARD
        # Round-3 cage comeback tool (live controls): grab bonus + freeze duration
        self.cage_reward = CAGE_REWARD
        self.cage_len = CAGE_LEN
        # Round-4 game-feel overrides (None = the arena's own default), applied to
        # the env after any (re)build and live from the panel's World card.
        self.r4_missile_speed = None
        self.r4_missile_homing = None
        self.r4_hearts = None
        self.r4_hit_penalty = None
        self.r4_action_repeat = None       # None = the arena's own default (4)
        # Round-5 Bowser-airship overrides (None = the arena's own default), live from
        # the panel's World card: objects thrown per throw, their speed, and how far
        # ahead the agents can see incoming objects.
        self.r5_bowser_count = None
        self.r5_bowser_speed = None
        self.r5_bowser_interval = None
        self.r5_agent_sight = None
        # DQN learners (continuous round 4). EVERY internal is PER-SIDE, so Blue and
        # Red each train fully independently (different brain AND different training
        # regime). batch/warmup/target-sync apply live; buffer/width/depth rebuild.
        self.dqn_batch = 64
        self.dqn_buffer = 50_000
        self.dqn_warmup = 500                   # learn after this many samples
        self.dqn_target_sync = 500              # target-net copy interval
        self.dqn_n_step = 3                     # multi-step return length
        self.dqn_hidden = 128                   # Blue hidden width
        self.dqn_layers = 2                     # Blue hidden layers
        self.red_dqn_batch = 64
        self.red_dqn_buffer = 50_000
        self.red_dqn_warmup = 500
        self.red_dqn_target_sync = 500
        self.red_dqn_n_step = 3
        self.red_dqn_hidden = 128               # Red hidden width
        self.red_dqn_layers = 2                 # Red hidden layers
        # Round-5 policy-gradient hyperparameters (REINFORCE / Actor-Critic / PPO),
        # applied to BOTH sides. None = keep each algorithm's own class default.
        self.pg_hidden = 128
        self.pg_entropy = None
        self.pg_lam = None
        self.pg_value_coef = None
        self.pg_horizon = None
        self.pg_clip = None
        self.pg_epochs = None
        self.pg_minibatch = None
        self.red_pg_entropy = None              # CPU entropy from its R5 difficulty tier
        # ------------------------------------------------------------------------
        self.env = self._make_env(round_id)
        self._apply_env_config()
        self.world_version = 1
        self.score = {"red": 0, "blue": 0}     # cumulative tournament round-wins
        self.awarded_rounds = set()            # round ids already scored this tournament
        self.round_results = {}                # round INDEX -> "red"/"blue"/"draw" (header dots)
        self.award_serial = 0                  # increments when the frontend should react
        self.last_award = None                 # latest award event (from pressing T)
        self.finish_serial = 0                 # increments when a finish ceremony is ready
        self.finish_event = None               # latest ceremony event with finish-line frame
        # tunable hyperparameters for OUR model, Blue (driven from the M panel).
        # Red (CPU) always trains on the fixed RED_* defaults above.
        self.alpha = 0.2                       # Blue learning rate (TD/MC)
        self.gamma = 0.98                      # Blue discount factor (TD/MC)
        # Blue epsilon schedule: linear eps_start -> eps_end over eps_episodes, then hold
        self.eps_start, self.eps_end, self.eps_episodes = 1.0, 0.05, 3000
        self.r4_eps_episodes = None             # explicit panel override, else cap at 1,000
        self.r4_red_eps_episodes = None         # same for a manual CPU override
        self._blue_from_round()
        self.target_episodes = None            # auto-pause after N episodes (None = run forever)
        self.red_tier = 1                      # CPU display tier (1-5), from the chosen character
        self.red_level = 0                     # CPU hyperparameter model 0..9 (per-character)
        self._red_from_tier()                  # derive Red's params from the model
        # per-round algorithm overrides from the menu selection (empty = the
        # ROUND_ALGOS defaults). cpu_algos = the chosen CPU character's algorithm per
        # round (Red); player_algos = the player's card pick per round (Blue). Applied
        # in set_round, and only if the algorithm fits the round's env kind.
        self.cpu_algos = {}
        self.player_algos = {}
        # ---- human takeover -------------------------------------------------
        # A PERSON can drive Blue from the browser instead of Blue's algorithm.
        # Blue's action then comes from `human_action` (the key currently held,
        # pushed by /api/control humanAction) and Blue stops learning: a human is
        # not a policy, and feeding its trajectories to the tabular/deep learner
        # would corrupt the model the player picked. Red trains on as usual.
        self.human = False
        self.human_action = None    # latest held action (None = nothing held)
        self._human_last = 0        # last real move, for coasting on a 4-action grid
        self.algo_red, self.algo_blue = self._round_matchup(round_id)
        self._build_agents()
        self._reset_stats()
        self._load_checkpoint()
        self._new_episode()

    # ------------------------------------------------------------------ setup
    def _make_env(self, round_id):
        """Pick the env for a round: the shared continuous arena for a CONTINUOUS
        round (its module THEME picks the 3D scene), else that round's grid-env
        subclass from the registry."""
        mod = registry.ROUND_MODULES.get(round_id)
        seed = self.train_seed
        if getattr(mod, "CONTINUOUS", False):
            return registry.make_continuous_env(round_id, seed,
                                                getattr(mod, "THEME", "ruined"))
        return registry.make_grid_env(round_id, seed)

    def _apply_env_config(self):
        """Apply the step-cap override + the Round-1 mechanic params onto the current env,
        after any (re)build (a fresh env starts at the module defaults). Returns True iff a
        push changed the DP STATE SPACE (ghost/freeze length) - the caller re-enumerates."""
        if self.max_steps_override is not None:
            self.env.max_steps = self.max_steps_override
        setm = getattr(self.env, "set_missile_dynamics", None)
        if setm:                                # Round-4 game-feel overrides
            setm(missile_speed=self.r4_missile_speed,
                 missile_turn=self.r4_missile_homing,
                 hearts=self.r4_hearts, hit_penalty=self.r4_hit_penalty)
        if self.r4_action_repeat is not None and getattr(self.env, "missile_game", False):
            self.env.action_repeat = self.r4_action_repeat
        setc = getattr(self.env, "set_ctf_dynamics", None)
        if setc:                                # Round-5 Bowser-airship overrides
            setc(bowser_throw_count=self.r5_bowser_count,
                 bowser_obj_speed=self.r5_bowser_speed,
                 bowser_interval=self.r5_bowser_interval,
                 agent_sight=self.r5_agent_sight)
        setd = getattr(self.env, "set_dynamics", None)
        if setd:
            return setd(slip_prob=self.slip_prob, ghost_len=self.ghost_len,
                        r2_slip_prob=self.r2_slip_prob, r3_slip_prob=self.r3_slip_prob,
                        freeze_len=self.freeze_len, block_ghost_prob=self.block_ghost_prob,
                        coin_reward=self.coin_reward, block_reward=self.block_reward,
                        star_reward=self.r2_tomato_reward,
                        cage_reward=self.cage_reward, cage_len=self.cage_len)
        return False

    def _rebuild_world(self):
        """Rebuild the live env from the current world config (train seed) and the
        agents on top of it, then restart the contest. For a STRUCTURAL change where
        the scene layout itself moves, so the client re-fetches it."""
        self.env = self._make_env(self.round_id)
        self.world_version += 1
        self._apply_env_config()
        self._build_agents()
        self.finish_event = None
        self._reset_stats()
        self._new_episode()

    def world_for_round(self, round_id):
        """A round's world built READ-ONLY (does not touch the live env/match),
        so the client can build + cache every arena scene up front during the
        start menu and make every transition instant."""
        with self.lock:
            return self._make_env(round_id).to_json()

    def world_json(self):
        """The live world + its version, read ATOMICALLY under the lock (for
        /api/world). Without the lock a concurrent round switch (which swaps
        self.env then bumps world_version) could be read half-applied, so the
        client could pair an old version with a new world (or vice versa)."""
        with self.lock:
            return {"worldVersion": self.world_version, "world": self.env.to_json()}

    def all_worlds(self):
        """Every round's world in tournament order (for the client prewarm)."""
        return [{"roundId": rid, "world": self.world_for_round(rid)}
                for rid in registry.ROUNDS]

    def _is_round4_missile(self):
        return self.round_id == 4 and bool(getattr(self.env, "missile_game", False))

    def _effective_blue_eps_episodes(self):
        if not self._is_round4_missile():
            return self.eps_episodes
        return (
            self.r4_eps_episodes
            if self.r4_eps_episodes is not None
            else min(self.eps_episodes, 1_000)
        )

    def _effective_red_eps_episodes(self):
        if not self._is_round4_missile():
            return self.red_eps_episodes
        return (
            self.r4_red_eps_episodes
            if self.r4_red_eps_episodes is not None
            else min(self.red_eps_episodes, 1_000)
        )

    def _make_one(self, algo, color, seed, alpha, gamma):
        if is_dp(algo):
            speed = self.red_plan_speed if color == "red" else self.dp_plan_speed
            return make_dp(algo, self.env, color, gamma=gamma,
                           theta=self.dp_theta, max_sweeps=self.dp_max_sweeps,
                           plan_speed=speed)
        if is_dqn(algo):
            red = color == "red"       # EVERY DQN internal is per-side
            return make_dqn(algo, obs_dim=self.env.obs_dim, n_actions=self.env.n_actions,
                            seed=seed, alpha=alpha, gamma=gamma,
                            buffer=self.red_dqn_buffer if red else self.dqn_buffer,
                            batch=self.red_dqn_batch if red else self.dqn_batch,
                            warmup=self.red_dqn_warmup if red else self.dqn_warmup,
                            target_sync=(self.red_dqn_target_sync if red
                                         else self.dqn_target_sync),
                            n_step=self.red_dqn_n_step if red else self.dqn_n_step,
                            hidden=self.red_dqn_hidden if red else self.dqn_hidden,
                            layers=self.red_dqn_layers if red else self.dqn_layers)
        if is_pg(algo):
            if color == "red":
                # the CPU's strength comes from its DIFFICULTY TIER: alpha/gamma (above)
                # + the tier's entropy. It uses each algorithm's own default rollout knobs.
                return make_pg(algo, obs_dim=self.env.obs_dim, n_actions=self.env.n_actions,
                               seed=seed, alpha=alpha, gamma=gamma, hidden=self.pg_hidden,
                               entropy_coef=self.red_pg_entropy)
            # Blue = the user's model: the panel's PG hyperparameters apply here.
            return make_pg(algo, obs_dim=self.env.obs_dim, n_actions=self.env.n_actions,
                           seed=seed, alpha=alpha, gamma=gamma, hidden=self.pg_hidden,
                           entropy_coef=self.pg_entropy, lam=self.pg_lam,
                           value_coef=self.pg_value_coef, horizon=self.pg_horizon,
                           clip=self.pg_clip, epochs=self.pg_epochs,
                           minibatch=self.pg_minibatch)
        return make_agent(algo, n_actions=self.env.n_actions, seed=seed, alpha=alpha, gamma=gamma)

    def _red_from_tier(self):
        """(Re)derive Red's params from its per-character DIFFICULTY. Manual overrides via
        set_red_params replace these until the character (difficulty) changes again."""
        rp = red_params(self.red_level, self.round_id)
        self.red_alpha = rp["alpha"]
        self.red_gamma = rp.get("gamma", RED_GAMMA)
        self.red_eps_start = rp["eps_start"]
        self.red_eps_end = rp["eps_end"]
        self.red_eps_episodes = rp["eps_episodes"]
        self.r4_red_eps_episodes = None
        self.red_epsilon = rp["eps_start"]
        self.red_plan_speed = rp["plan_speed"]    # DP (R1): Red's sweeps per tick
        self.red_pg_entropy = rp.get("entropy")   # PG (R5): CPU entropy from its tier

    def _blue_from_round(self):
        """Restore Blue's validated default profile for the active arena."""
        bp = blue_params(self.round_id)
        self.alpha = bp["alpha"]
        self.gamma = bp["gamma"]
        self.eps_start = bp["eps_start"]
        self.eps_end = bp["eps_end"]
        self.eps_episodes = bp["eps_episodes"]
        self.r4_eps_episodes = None
        self.epsilon = bp["eps_start"]

    def _build_agents(self):
        # Red = CPU (params from its tier, or a manual override); Blue = ours, panel-tunable.
        # The train seed offsets BOTH agents' seeds so a different seed gives a
        # genuinely different-but-reproducible run (layouts stay hand-designed).
        off = 0 if self.train_seed is None else int(self.train_seed) * 101
        self.red = self._make_one(self.algo_red, "red", seed=1 + off,
                                  alpha=self.red_alpha, gamma=self.red_gamma)
        self.blue = self._make_one(self.algo_blue, "blue", seed=2 + off,
                                   alpha=self.alpha, gamma=self.gamma)

    def _agent(self, agent):
        return self.red if agent == "red" else self.blue
