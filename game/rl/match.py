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

import copy
import math
import os
import threading
from collections import deque

from env import (GridWorld, N_ACTIONS,
                 COIN_REWARD, BLOCK_REWARD, GHOST_LEN, FREEZE_LEN,
                 SLIP_PROB, R2_SLIP_PROB, R3_SLIP_PROB, STAR_REWARD)
from continuous import ContinuousArena
from agents import make_agent, ALGORITHMS
from dp import is_dp, make_dp
import worlds

# The deep agents (Rounds 4-5) need PyTorch. Import them LAZILY (inside _make_one)
# so the server still boots and runs the tabular / DP rounds in a Python that
# doesn't have torch installed - only building a deep agent requires it. Keep the
# name lists + predicates here (a plain membership test, no torch) so validation /
# family labels work without importing the torch modules.
DQN_ALGOS = ("dqn", "double_dqn", "dueling_dqn")
PG_ALGOS = ("reinforce", "actor_critic", "ppo")
ROUND_ALGO_FAMILIES = {
    1: {"value_iteration", "policy_iteration"},
    2: {"monte_carlo", "first_visit_mc"},
    3: {"qlearning", "sarsa", "expected_sarsa"},
    4: set(DQN_ALGOS),
    5: set(PG_ALGOS),
}


def is_dqn(algo):
    return algo in DQN_ALGOS


def is_pg(algo):
    return algo in PG_ALGOS


def is_deep(algo):
    return is_dqn(algo) or is_pg(algo)

FRAME_CAP = 10001          # record the WHOLE episode: R4 survival is bounded by the
                           # env's own 10,000-step ceiling, so this never truncates a
                           # replay. Memory scales with ACTUAL survival, not this cap.
HISTORY_CAP = 4000         # max learning-curve points kept per round
TOP_N = 30                 # best replays kept per model (fastest or longest by game)
DQN_CHECKPOINT_SCHEMA = 2
DQN_CHECKPOINT_INTERVAL = 25
DQN_CHECKPOINT_NAME = "round4_dqn.pt"
# This revision tracks the meaning of Round 4's experience, independently of the
# on-disk container format. Revision 6 adds ENDLESS ESCALATION (missiles + pickups
# grow with survival time, no 3-cap) and a wider observation (6 nearest missiles +
# 3 nearest pickups + the mercy-invuln timer). The observation dimension changed, so
# an older checkpoint is rejected on both counts and agents retrain from scratch.
ROUND4_TRAINING_REVISION = 8

# Red (the CPU) is NOT tunable from the panel; its strength comes from the chosen
# CPU character's tier (1 = easiest .. 5 = hardest). Stage 1 reads ONLY plan_speed.
# The learning rate and epsilon schedule are stored in the same cross-stage character
# profile for the later learning arenas, but DP never reads or applies them.
RED_GAMMA = 0.98


def _int_or_none(v, lo=0, hi=10 ** 9):
    """Coerce a panel value to a clamped int, or None. The panel sends -1 (or an
    empty/None value) to mean 'use the built-in default' for the optional knobs
    (hazard counts, train seed)."""
    if v is None:
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    return max(lo, min(hi, n))


def _unique_argmax(values, valid=None):
    """Return the sole maximizing index, or None for a genuine policy tie."""
    choices = list(valid if valid is not None else range(len(values)))
    if not choices:
        choices = list(range(len(values)))
    best = max(values[i] for i in choices)
    tied = [i for i in choices if values[i] == best]
    return tied[0] if len(tied) == 1 else None


# 10 CPU hyperparameter MODELS, one PER CHARACTER (level 0 = Mario, easiest .. 9 =
# Parabones, hardest). Stage 1 reads plan_speed. The generic learning values remain
# the defaults for later TD/deep arenas. Arena 2 has its own empirically tuned MC
# block because long, full-return learning FAILS when epsilon is driven toward zero:
# Every-visit needs a floor around .20 and First-visit tolerates about .16. Rows are
# monotonic within each alternating MC family (even levels Every-visit, odd levels
# First-visit), and gamma=.98 won the long-course benchmark over .995.
RED_MODELS = [
    # Generic later arenas ------------------------------  Arena 2 MC -------------------------------------------
    # plan     alpha  eps0   eps1  decay                    alpha gamma eps0  eps1  decay
    {"plan_speed": .15, "alpha": .08, "eps_start": 1.00, "eps_end": .35, "eps_episodes": 9000,
     "r2": {"alpha": .14, "gamma": .98, "eps_start": 1.00, "eps_end": .40, "eps_episodes": 11000}},  # 0 Mario
    {"plan_speed": .30, "alpha": .12, "eps_start": .96, "eps_end": .30, "eps_episodes": 8000,
     "r2": {"alpha": .15, "gamma": .98, "eps_start": .98, "eps_end": .36, "eps_episodes": 10000}},  # 1 Luigi
    {"plan_speed": .50, "alpha": .16, "eps_start": .92, "eps_end": .26, "eps_episodes": 7000,
     "r2": {"alpha": .16, "gamma": .98, "eps_start": .96, "eps_end": .33, "eps_episodes": 9500}},   # 2 Yoshi
    {"plan_speed": .75, "alpha": .20, "eps_start": .88, "eps_end": .22, "eps_episodes": 6000,
     "r2": {"alpha": .17, "gamma": .98, "eps_start": .94, "eps_end": .29, "eps_episodes": 8500}},   # 3 Toadette
    {"plan_speed": 1.05, "alpha": .24, "eps_start": .84, "eps_end": .18, "eps_episodes": 5000,
     "r2": {"alpha": .18, "gamma": .98, "eps_start": .92, "eps_end": .27, "eps_episodes": 8000}},   # 4 Pauline
    {"plan_speed": 1.40, "alpha": .28, "eps_start": .80, "eps_end": .14, "eps_episodes": 4000,
     "r2": {"alpha": .19, "gamma": .98, "eps_start": .90, "eps_end": .23, "eps_episodes": 7200}},   # 5 Koopa
    {"plan_speed": 1.80, "alpha": .31, "eps_start": .75, "eps_end": .10, "eps_episodes": 3000,
     "r2": {"alpha": .20, "gamma": .98, "eps_start": .88, "eps_end": .23, "eps_episodes": 7000}},   # 6 Bowser
    {"plan_speed": 2.25, "alpha": .34, "eps_start": .70, "eps_end": .07, "eps_episodes": 2000,
     "r2": {"alpha": .21, "gamma": .98, "eps_start": .87, "eps_end": .19, "eps_episodes": 6500}},   # 7 Peach
    {"plan_speed": 2.80, "alpha": .37, "eps_start": .65, "eps_end": .04, "eps_episodes": 1000,
     "r2": {"alpha": .22, "gamma": .98, "eps_start": .86, "eps_end": .20, "eps_episodes": 6000}},   # 8 Toad
    {"plan_speed": 3.40, "alpha": .40, "eps_start": .60, "eps_end": .01, "eps_episodes": 400,
     "r2": {"alpha": .22, "gamma": .98, "eps_start": .86, "eps_end": .16, "eps_episodes": 6000}},   # 9 Parabones
]

# Blue is user-tunable, but every arena starts from a profile that is actually
# suitable for that algorithm. The generic schedule remains the default for
# later one-step/deep arenas; Arena 2 needs sustained exploration because a
# Monte-Carlo update only arrives after a long three-room return.
BLUE_MODEL = {
    "alpha": .20, "gamma": .98,
    "eps_start": 1.00, "eps_end": .05, "eps_episodes": 3000,
    "r2": {
        "alpha": .19, "gamma": .98,
        "eps_start": .90, "eps_end": .05, "eps_episodes": 7200,
    },
}


# Arena 4 (Ruined Kingdom, DQN survival) CPU ladder: a stronger character plays closer
# to optimal (lower final epsilon => it DODGES instead of wandering into a Bill), learns
# faster (fewer decay episodes), and looks a little further ahead (higher gamma). dt=0.02
# discrete velocity + action-repeat make these learnable. Index = character level 0..9.
R4_LADDER = [
    {"alpha": .20, "gamma": .980, "eps_start": 1.00, "eps_end": .30, "eps_episodes": 4000},  # 0 Mario
    {"alpha": .22, "gamma": .980, "eps_start": 1.00, "eps_end": .26, "eps_episodes": 3600},  # 1 Luigi
    {"alpha": .24, "gamma": .982, "eps_start": 1.00, "eps_end": .22, "eps_episodes": 3200},  # 2 Yoshi
    {"alpha": .26, "gamma": .984, "eps_start": .98, "eps_end": .18, "eps_episodes": 2800},   # 3 Toadette
    {"alpha": .28, "gamma": .986, "eps_start": .96, "eps_end": .15, "eps_episodes": 2400},   # 4 Pauline
    {"alpha": .30, "gamma": .988, "eps_start": .94, "eps_end": .12, "eps_episodes": 2000},   # 5 Koopa
    {"alpha": .32, "gamma": .990, "eps_start": .92, "eps_end": .09, "eps_episodes": 1600},   # 6 Bowser
    {"alpha": .34, "gamma": .992, "eps_start": .90, "eps_end": .07, "eps_episodes": 1200},   # 7 Peach
    {"alpha": .36, "gamma": .994, "eps_start": .88, "eps_end": .05, "eps_episodes": 900},    # 8 Toad
    {"alpha": .38, "gamma": .995, "eps_start": .85, "eps_end": .03, "eps_episodes": 600},    # 9 Parabones
]
BLUE_R4 = {"alpha": .30, "gamma": .99, "eps_start": 1.00, "eps_end": .05, "eps_episodes": 2500}


def red_params(level, round_id=None):
    """Resolved CPU profile for a character and arena.

    Arena-specific values override the generic learning profile without leaking
    into the other rounds.
    """
    idx = max(0, min(len(RED_MODELS) - 1, int(round(level))))
    raw = RED_MODELS[idx]
    resolved = {k: v for k, v in raw.items() if k != "r2"}
    if round_id == 2:
        resolved.update(raw["r2"])
    elif round_id == 4:
        resolved.update(R4_LADDER[idx])
    return resolved


def blue_params(round_id=None):
    """Resolve the user model's safe per-arena starting profile."""
    resolved = {k: v for k, v in BLUE_MODEL.items() if k != "r2"}
    if round_id == 2:
        resolved.update(BLUE_MODEL["r2"])
    elif round_id == 4:
        resolved.update(BLUE_R4)
    return resolved


class Match:
    def __init__(self, seed=None, round_id=1, checkpoint_dir=None):
        self.lock = threading.RLock()
        self.seed = seed
        self.round_id = round_id
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
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
        # Round-4 game-feel overrides (None = the arena's own default), applied to
        # the env after any (re)build and live from the panel's World card.
        self.r4_missile_speed = None
        self.r4_missile_homing = None
        self.r4_hearts = None
        self.r4_hit_penalty = None
        self.r4_action_repeat = None       # None = the arena's own default (4)
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
        self.algo_red, self.algo_blue = self._round_matchup(round_id)
        self._build_agents()
        self._reset_stats()
        self._load_checkpoint()
        self._new_episode()

    # ------------------------------------------------------------------ setup
    def _make_env(self, round_id):
        """Pick the env for a round: the shared continuous arena for a CONTINUOUS
        round (its module THEME picks the 3D scene), else the tabular grid world.
        SKELETON: both are bare navigate/fly-to-goal shells (no hazards)."""
        mod = worlds.ROUND_MODULES.get(round_id)
        seed = self.train_seed
        if getattr(mod, "CONTINUOUS", False):
            return ContinuousArena(seed, round_id=round_id,
                                   theme=getattr(mod, "THEME", "ruined"))
        return GridWorld(seed, round_id=round_id)

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
        setd = getattr(self.env, "set_dynamics", None)
        if setd:
            return setd(slip_prob=self.slip_prob, ghost_len=self.ghost_len,
                        r2_slip_prob=self.r2_slip_prob, r3_slip_prob=self.r3_slip_prob,
                        freeze_len=self.freeze_len, block_ghost_prob=self.block_ghost_prob,
                        coin_reward=self.coin_reward, block_reward=self.block_reward,
                        star_reward=self.r2_tomato_reward)
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
                for rid in worlds.ROUNDS]

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
            from dqn import make_dqn   # lazy: only the deep rounds need PyTorch
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
            from pg import make_pg     # lazy: the policy-gradient round (R5) needs PyTorch
            return make_pg(algo, obs_dim=self.env.obs_dim, n_actions=self.env.n_actions,
                           seed=seed, alpha=alpha, gamma=gamma, hidden=self.dqn_hidden)
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

    # ---------------------------------------------------------- DQN checkpoint
    def _checkpoint_eligible(self):
        return (
            self._is_round4_missile()
            and is_dqn(self.algo_red)
            and is_dqn(self.algo_blue)
            and hasattr(self.red, "checkpoint_state")
            and hasattr(self.blue, "checkpoint_state")
        )

    def _checkpoint_payload(self):
        return {
            "schemaVersion": DQN_CHECKPOINT_SCHEMA,
            "trainingRevision": ROUND4_TRAINING_REVISION,
            "roundId": 4,
            "obsDim": int(self.env.obs_dim),
            "nActions": int(self.env.n_actions),
            "algorithms": {"red": self.algo_red, "blue": self.algo_blue},
            "episode": int(self.episode),
            "totalSteps": int(self.total_steps),
            "agents": {
                "red": self.red.checkpoint_state(),
                "blue": self.blue.checkpoint_state(),
            },
        }

    def save_checkpoint(self, force=True):
        """Persist Round-4 DQN learning; return True only when a file was written."""
        with self.lock:
            if not self._checkpoint_eligible():
                self.checkpoint_status = "not-applicable"
                return False
            if not force and (
                self.episode <= 0
                or self.episode % DQN_CHECKPOINT_INTERVAL
                or self.episode == self._last_checkpoint_episode
            ):
                return False
            try:
                from dqn import save_checkpoint_file
                save_checkpoint_file(self.checkpoint_path, self._checkpoint_payload())
            except Exception as exc:
                self.checkpoint_status = "save-error"
                self.checkpoint_error = f"{type(exc).__name__}: {exc}"
                return False
            self._last_checkpoint_episode = int(self.episode)
            self.checkpoint_episode = int(self.episode)
            self.checkpoint_status = "saved"
            self.checkpoint_error = None
            return True

    def _load_checkpoint(self):
        """Load one compatible Round-4 checkpoint, leaving fresh agents on error."""
        if not self._checkpoint_eligible():
            self.checkpoint_status = "not-applicable"
            self.checkpoint_error = None
            return False

        from dqn import load_checkpoint_file
        payload, error = load_checkpoint_file(self.checkpoint_path)
        if error is not None:
            self.checkpoint_status = "missing" if error == "missing" else "corrupt"
            self.checkpoint_error = None if error == "missing" else error
            return False

        try:
            if int(payload.get("schemaVersion", -1)) != DQN_CHECKPOINT_SCHEMA:
                raise ValueError(
                    f"schemaVersion mismatch (expected {DQN_CHECKPOINT_SCHEMA})")
            if int(payload.get("trainingRevision", -1)) != ROUND4_TRAINING_REVISION:
                raise ValueError(
                    "trainingRevision mismatch "
                    f"(expected {ROUND4_TRAINING_REVISION})")
            if int(payload.get("roundId", -1)) != 4:
                raise ValueError("roundId mismatch")
            if int(payload.get("obsDim", -1)) != int(self.env.obs_dim):
                raise ValueError("obsDim mismatch")
            if int(payload.get("nActions", -1)) != int(self.env.n_actions):
                raise ValueError("nActions mismatch")
            expected_algos = {"red": self.algo_red, "blue": self.algo_blue}
            if payload.get("algorithms") != expected_algos:
                raise ValueError("algorithms mismatch")
            episode = int(payload["episode"])
            total_steps = int(payload.get("totalSteps", 0))
            if episode < 0 or total_steps < 0:
                raise ValueError("negative progress counter")
            agents = payload["agents"]
            if not isinstance(agents, dict):
                raise ValueError("agents is not a dict")
            # Prepare both sides before mutating either one.
            red_state = self.red.prepare_checkpoint_state(agents["red"])
            blue_state = self.blue.prepare_checkpoint_state(agents["blue"])
        except Exception as exc:
            self.checkpoint_status = "incompatible"
            self.checkpoint_error = f"{type(exc).__name__}: {exc}"
            return False

        self.red.apply_checkpoint_state(red_state)
        self.blue.apply_checkpoint_state(blue_state)
        self.episode = episode
        self.total_steps = total_steps
        self._last_checkpoint_episode = episode
        self.checkpoint_episode = episode
        self.checkpoint_status = "loaded"
        self.checkpoint_error = None
        return True

    def delete_checkpoint(self):
        """Delete saved Round-4 learning for an explicit wipe-learning control."""
        with self.lock:
            try:
                if os.path.exists(self.checkpoint_path):
                    os.remove(self.checkpoint_path)
            except OSError as exc:
                self.checkpoint_status = "delete-error"
                self.checkpoint_error = f"{type(exc).__name__}: {exc}"
                return False
            self._last_checkpoint_episode = -1
            self.checkpoint_episode = 0
            self.checkpoint_status = "deleted"
            self.checkpoint_error = None
            return True

    def _reset_stats(self):
        if getattr(self.env, "missile_game", False):
            # A manual model/world reset is not an automatic episode transition;
            # no terminal blast from the discarded run should survive it forever.
            self.env.explosions = []
        self.episode = 0
        self.full_course_episodes = 0
        self.curriculum_episodes = 0
        self.total_steps = 0
        self.wins = {"red": 0, "blue": 0, "draw": 0}
        self.recent = deque(maxlen=200)      # recent winners, for a rolling rate
        self.ep_lengths = deque(maxlen=100)
        self.last_return = {"red": 0.0, "blue": 0.0}
        self.epsilon = self.eps_start
        self.hist = deque(maxlen=HISTORY_CAP)   # learning curve points
        self._frames = []                       # frames of the in-flight episode
        self.last_episode = None                # most recent finished episode
        self.best_episode = None
        # Navigation rounds rank the fastest win; missile survival ranks the
        # longest winning survival. The replay browser receives the same ordering.
        self._best_len = -1 if getattr(self.env, "missile_game", False) else 10 ** 9
        # the TOP_N winning episodes per model, ordered by the round's objective
        self._top = {"red": [], "blue": []}
        # per-cell visit counts per side (the "where do they travel" heatmap)
        self.red_visits = [[0] * self.env.W for _ in range(self.env.H)]
        self.blue_visits = [[0] * self.env.W for _ in range(self.env.H)]
        # Continuous rounds use a denser position histogram instead of pretending
        # their float coordinates are board cells.
        self.arena_visit_n = 32
        self.arena_visits = {
            "red": [[0] * self.arena_visit_n for _ in range(self.arena_visit_n)],
            "blue": [[0] * self.arena_visit_n for _ in range(self.arena_visit_n)],
        }
        # outcome breakdown: split the old "draw" bucket into a genuine dead-heat
        # vs a max-steps timeout (which used to be conflated)
        self.outcomes = {"red": 0, "blue": 0, "draw": 0, "timeout": 0}
        self.recent_out = deque(maxlen=200)
        # action-frequency histogram per side (sized to the current env's actions)
        self.act_counts = {"red": [0] * self.env.n_actions,
                           "blue": [0] * self.env.n_actions}
        # rolling per-episode reward decomposition (terminal / shaping / other),
        # grid rounds only (the grid env accumulates env.ep_parts)
        self.reward_parts_hist = deque(maxlen=100)
        # V at a landmark (the spawn) per episode - the "start-state value climbs" probe
        self.q_probe = deque(maxlen=HISTORY_CAP)
        # recent per-episode returns per side, for the MC-vs-TD variance comparison
        self.ret_hist = {"red": deque(maxlen=100), "blue": deque(maxlen=100)}

    def _apply_epsilon(self):
        # each side follows its own schedule, but a DP planner ignores epsilon and
        # plays optimally, so we read each agent's ACTUAL epsilon back for display:
        # 0.0 on DP rounds (it does not explore), the scheduled value for TD/MC.
        fb = min(1.0, self.episode / self._effective_blue_eps_episodes())
        self.blue.set_epsilon(self.eps_start + (self.eps_end - self.eps_start) * fb)
        self.epsilon = self.blue.epsilon
        fr = min(1.0, self.episode / self._effective_red_eps_episodes())
        self.red.set_epsilon(self.red_eps_start + (self.red_eps_end - self.red_eps_start) * fr)
        self.red_epsilon = self.red.epsilon

    def _amask(self, agent):
        # per-cell mask of EFFECTIVE actions (grid envs only) so a greedy policy can't
        # self-loop on a wall / no-op. Continuous arenas have no such method -> None
        # (no masking, and their open action space has no wall-bumps anyway).
        fn = getattr(self.env, "effective_actions", None)
        return fn(agent) if fn else None

    def _new_episode(self):
        self._apply_epsilon()
        # Round 4 learns against an episode curriculum rather than immediately
        # facing the final missile dynamics.  Push the restored/current training
        # episode before reset so the very first observation and every launch in
        # this episode use the same curriculum stage.
        set_curriculum_episode = getattr(
            self.env, "set_curriculum_episode", None)
        if self._is_round4_missile() and set_curriculum_episode is not None:
            set_curriculum_episode(self.episode)
        (self.s_red, self.s_blue), _ = self.env.reset()
        self._full_course_episode = True
        self._curriculum_stage = 0
        # action-repeat (R4) macro-step accumulators; reset each episode in lockstep with
        # the env's own commit window so decision boundaries stay aligned.
        self._ar_pending = {"red": None, "blue": None}
        self._ar_count = {"red": 0, "blue": 0}
        if self.round_id == 2 and getattr(self.env, "star_mode", False):
            # Exploring starts are the standard way to make long-horizon Monte
            # Carlo control visit later state/action pairs. Collecting a tomato
            # changes the state mask, so the route FROM each tomato belongs to a
            # different Q slice than the route TO it. Keep every post-pickup slice
            # alive for the whole run: seven episodes out of ten are genuine
            # bottom-spawn races, then one mirrored random start in each of masks
            # 1, 3 and 7. Retiring the later slices made tiny constant-step MC
            # estimation noise harden into deterministic two-cell greedy loops.
            stage = (0, 0, 0, 0, 0, 0, 0, 3, 4, 5)[self.episode % 10]
            self._curriculum_stage = stage
            self._full_course_episode = stage == 0
            if stage in (3, 4, 5):
                # Explore the whole post-pickup state slice for room 1/2/3, not
                # just one checkpoint. Classic MC exploring starts need every
                # state-action pair to remain reachable; this is what breaks a
                # locally greedy two-cell loop instead of waiting for ε to rescue
                # it by luck. Starts are mirrored and never placed in a hazard,
                # Pipe, goal, or wall.
                tomato_idx = stage - 3
                held = (1 << (tomato_idx + 1)) - 1
                row_bands = ((13, 18), (6, 10), (0, 3))
                r0, r1 = row_bands[tomato_idx]
                blocked = (
                    set(self.env.plant_cells)
                    | set(self.env.plant_lethal)
                    | set(self.env.pipe_map)
                    | set(self.env.goal_set)
                )
                candidates = sorted(
                    cell for cell in self.env.floor_cells
                    if r0 <= cell[0] <= r1 and cell[1] < self.env.W // 2
                    and cell not in blocked
                    and (cell[0], self.env.W - 1 - cell[1])
                    in self.env.cell_index
                    and (cell[0], self.env.W - 1 - cell[1]) not in blocked
                )
                if candidates:
                    pick = (
                        self.episode * 37
                        + (0 if self.train_seed is None else int(self.train_seed)) * 101
                    ) % len(candidates)
                    self.env.blue_pos = candidates[pick]
                    self.env.red_pos = (
                        self.env.blue_pos[0], self.env.W - 1 - self.env.blue_pos[1]
                    )
                else:
                    # A validated city always has candidates, but keep custom/test
                    # worlds safe: the collected tomato tile is a valid mirrored
                    # post-pickup state and avoids a modulo-by-zero reset failure.
                    self.env.blue_pos = self.env.star_cells["blue"][tomato_idx]
                    self.env.red_pos = self.env.star_cells["red"][tomato_idx]
                self.env.stars_collected = {"red": held, "blue": held}
            if stage:
                self.s_red = self.env.observe("red")
                self.s_blue = self.env.observe("blue")
        if self.env.objective != "arena":
            # Align the live visit map with replay frame 0: an episode's actual
            # starting tile is a visit too (including sectional curriculum starts).
            for pos, vis in ((self.env.red_pos, self.red_visits),
                             (self.env.blue_pos, self.blue_visits)):
                if pos in self.env.cell_index:
                    vis[pos[0]][pos[1]] += 1
        self.a_red = self.red.policy_action(self.s_red, self._amask("red"))
        self.a_blue = self.blue.policy_action(self.s_blue, self._amask("blue"))
        if self.round_id == 2 and getattr(self, "_curriculum_stage", 0) >= 3:
            # Exploring-start episodes force the first action as well as the
            # state. Subsequent actions follow the normal ε-greedy MC policy.
            rm, bm = self._amask("red"), self._amask("blue")
            rv = [a for a, ok in enumerate(rm) if ok] or list(range(self.env.n_actions))
            bv = [a for a, ok in enumerate(bm) if ok] or list(range(self.env.n_actions))
            self.a_red = self.red.rng.choice(rv)
            self.a_blue = self.blue.rng.choice(bv)
        self.ep_return = {"red": 0.0, "blue": 0.0}
        # frame 0 = the TRUE start (spawn positions, before any move). tick() records
        # snapshots AFTER stepping, so without this seed the replay began one move in
        # and agents appeared to start a square off their real spawn.
        self._frames = [self._replay_snapshot()]

    def _replay_snapshot(self, actions=None):
        """Environment frame plus the tiny DP progress marker needed by replay."""
        frame = self.env.snapshot()
        if actions:
            for side in ("red", "blue"):
                action = actions.get(side)
                if action is not None:
                    frame[f"{side}Action"] = int(action)
        if getattr(self.env, "missile_game", False):
            # Terminal explosions are carried briefly across the automatic reset so
            # live polling cannot miss them. They belong to the previous episode and
            # must never contaminate the next episode's recorded replay.
            frame["explosions"] = [
                event for event in frame.get("explosions", [])
                if not event.get("carryover", False)
            ]
        for side, agent in (("red", self.red), ("blue", self.blue)):
            if hasattr(agent, "sweeps"):
                frame[f"{side}DpSweep"] = sum(agent.sweeps or [])
        return frame

    # ------------------------------------------------------------------- tick
    def tick(self):
        """Advance the simulation by one env step (and learn). Returns True if the
        episode ended on this step."""
        with self.lock:
            # honour a training-length target: idle once we've run the requested episodes
            if self.target_episodes is not None and self.episode >= self.target_episodes:
                return False
            obs, reward, done, truncated, info = self.env.step(self.a_red, self.a_blue)
            ns_red, ns_blue = obs
            # the effective-action mask AT THE NEXT STATE (env positions are already
            # post-step here): used both to pick the next action AND to bootstrap the
            # TD target over valid actions only (never over a never-updated wall-bump).
            nmask_red, nmask_blue = self._amask("red"), self._amask("blue")
            active_before = info.get(
                "agentActiveBefore", {"red": True, "blue": True}
            )
            agent_done = info.get("agentDone", {"red": done, "blue": done})
            agent_terminated = info.get(
                "agentTerminated", {"red": False, "blue": False}
            )
            na_red = (
                self.red.policy_action(ns_red, nmask_red)
                if not done and not agent_done.get("red", False) else 0
            )
            na_blue = (
                self.blue.policy_action(ns_blue, nmask_blue)
                if not done and not agent_done.get("blue", False) else 0
            )

            # a max-steps TIMEOUT is truncation, not a true terminal: the next state is
            # not absorbing, so the value backup must still bootstrap through it. Only a
            # real win/lose/draw (done and not truncated) cuts the bootstrap.
            terminated = done and not truncated
            hazardous = bool(getattr(self.env, "hazardous", False))
            # ACTION-REPEAT (R4 only): the env holds a committed direction for
            # `action_repeat` steps (smooth execution, no per-step flip-flop), AND we learn
            # COARSELY - one macro-transition per decision (accumulated reward, start->end
            # state). That gives the value backup a 4x-longer horizon, which is what makes
            # survival actually learn. Every other round keeps plain per-step learning.
            ar = getattr(self.env, "action_repeat", 1) if getattr(self.env, "missile_game", False) else 1
            _exec = getattr(self.env, "_executed", None) if getattr(self.env, "missile_game", False) else None
            xa_red = _exec["red"] if _exec else self.a_red
            xa_blue = _exec["blue"] if _exec else self.a_blue
            red_terminal = bool(agent_terminated.get("red", False)) if hazardous else terminated
            blue_terminal = bool(agent_terminated.get("blue", False)) if hazardous else terminated

            def _learn(side, agent, s, xa, r, ns, na, nmask, active, term):
                if not active:
                    return
                if ar <= 1:
                    agent.learn_step(s, xa, r, ns, na, term, nmask)
                    return
                pend = self._ar_pending[side]
                if pend is None:
                    pend = self._ar_pending[side] = [s, xa, 0.0]
                pend[2] += r
                self._ar_count[side] += 1
                if self._ar_count[side] >= ar or term or done:
                    agent.learn_step(pend[0], pend[1], pend[2], ns, na, term, nmask)
                    self._ar_pending[side] = None
                    self._ar_count[side] = 0

            _learn("red", self.red, self.s_red, xa_red, reward["red"], ns_red, na_red,
                   nmask_red, active_before.get("red", True), red_terminal)
            _learn("blue", self.blue, self.s_blue, xa_blue, reward["blue"], ns_blue, na_blue,
                   nmask_blue, active_before.get("blue", True), blue_terminal)

            self.ep_return["red"] += reward["red"]
            self.ep_return["blue"] += reward["blue"]
            self.total_steps += 1
            if active_before.get("red", True) and xa_red < len(self.act_counts["red"]):
                self.act_counts["red"][xa_red] += 1
            if active_before.get("blue", True) and xa_blue < len(self.act_counts["blue"]):
                self.act_counts["blue"][xa_blue] += 1
            if self.env.objective != "arena":
                warp_from = getattr(self.env, "_warp_from", {}) or {}
                for side, pos, vis in (
                    ("red", self.env.red_pos, self.red_visits),
                    ("blue", self.env.blue_pos, self.blue_visits),
                ):
                    if not active_before.get(side, True):
                        continue
                    entry = warp_from.get(side)
                    if entry in self.env.cell_index:
                        vis[entry[0]][entry[1]] += 1
                    # count FLOOR cells only; a ghosting agent can sit on a wall cell,
                    # which the travel heatmap (floor-only) never reads (skip dead writes)
                    if pos in self.env.cell_index:
                        vis[pos[0]][pos[1]] += 1
            else:
                A = float(getattr(self.env, "arena", 20.0))
                n = self.arena_visit_n
                for side, pos in (("red", self.env.red_pos),
                                  ("blue", self.env.blue_pos)):
                    if not active_before.get(side, True):
                        continue
                    i = max(0, min(n - 1, int(float(pos[0]) / A * n)))
                    j = max(0, min(n - 1, int(float(pos[1]) / A * n)))
                    self.arena_visits[side][j][i] += 1
            if len(self._frames) < FRAME_CAP:
                self._frames.append(self._replay_snapshot({
                    "red": self.a_red if active_before.get("red", True) else None,
                    "blue": self.a_blue if active_before.get("blue", True) else None,
                }))
            self.s_red, self.s_blue = ns_red, ns_blue
            self.a_red, self.a_blue = na_red, na_blue

            if done:
                replay_fields = {}
                if getattr(self, "_full_course_episode", True):
                    for side in info.get("finishers") or []:
                        field = self._capture_replay_fields(side)
                        if field:
                            replay_fields[side] = field
                # Arena 2 now lets each racer reach its own terminal state. A
                # terminal racer contributes no frozen self-loops while its rival
                # continues, so both complete trajectories are valid MC samples.
                # At a timeout an unresolved trajectory is a finite-horizon sample.
                self.red.end_episode()
                self.blue.end_episode()
                w = info["winner"] or "draw"
                full_course = bool(getattr(self, "_full_course_episode", True))
                if full_course:
                    # Only genuine bottom-spawn races belong in the public
                    # contest. Later-section/exploring starts are an internal MC
                    # curriculum, not shorter games that may award the arena.
                    self.full_course_episodes += 1
                    self.wins[w] += 1
                    self.recent.append(w)
                    # A None winner is a genuine draw only if the episode ended
                    # naturally; max-steps is a timeout, not a dead heat.
                    out = (
                        info["winner"]
                        if info["winner"] in ("red", "blue")
                        else ("timeout" if truncated else "draw")
                    )
                    self.outcomes[out] += 1
                    self.recent_out.append(out)
                    self.ep_lengths.append(self.env.steps)
                    self.last_return = dict(self.ep_return)
                    self.ret_hist["red"].append(self.ep_return["red"])
                    self.ret_hist["blue"].append(self.ep_return["blue"])
                else:
                    self.curriculum_episodes += 1
                self.episode += 1
                if full_course:
                    self._finish_episode(
                        w,
                        truncated=truncated,
                        finishers=info.get("finishers"),
                        finish_steps=info.get("finishSteps"),
                        replay_fields=replay_fields,
                    )
                else:
                    # Still sample the learned spawn value after each curriculum
                    # update, but keep partial-room returns/lengths/replays out of
                    # the full-course dashboard.
                    self._record_probe()
                self.save_checkpoint(force=False)
                self._new_episode()
            return done

    def _finish_episode(
            self, winner, truncated=False, finishers=None, finish_steps=None,
            replay_fields=None):
        """Snapshot the finished episode for replay + log a learning-curve point."""
        parts = getattr(self.env, "ep_parts", None)   # grid env's reward decomposition
        if parts is not None:
            self.reward_parts_hist.append({s: dict(parts[s]) for s in ("red", "blue")})
        self._record_probe()
        self.last_episode = {"winner": winner, "steps": self.env.steps,
                             "frames": self._frames}
        survival = bool(getattr(self.env, "missile_game", False))
        if survival:
            replay_sides = (
                [winner] if winner in ("red", "blue")
                else ["red", "blue"] if truncated
                else []
            )
        elif finishers is not None:
            # Grid environments report physical goal arrivals. Arena 2 may name
            # the survivor as match winner after its rival dies, but that is not
            # a completed-course replay.
            replay_sides = [
                side for side in ("red", "blue") if side in finishers
            ]
        else:
            # Continuous goal races predate explicit finisher metadata.
            replay_sides = [winner] if winner in ("red", "blue") else []
        if not getattr(self, "_full_course_episode", True):
            replay_sides = []
        side_steps = {
            side: (
                self.env.steps if survival
                else int((finish_steps or {}).get(side, self.env.steps))
            )
            for side in replay_sides
        }
        candidate_len = (
            max(side_steps.values()) if survival and side_steps
            else min(side_steps.values()) if side_steps
            else self.env.steps
        )
        is_best = (
            candidate_len > self._best_len if survival
            else candidate_len < self._best_len
        )
        if replay_sides and is_best:
            self._best_len = candidate_len
            best_side = (
                max(side_steps, key=side_steps.get) if survival
                else min(side_steps, key=side_steps.get)
            )
            best_n = side_steps[best_side]
            self.best_episode = {
                "winner": best_side,
                "steps": best_n,
                "frames": self._frames[:best_n + 1],
            }
        race = winner if winner in ("red", "blue") else "draw"
        env_parts = getattr(self.env, "ep_parts", None)
        for replay_side in replay_sides:
            lst = self._top[replay_side]
            replay_policy = self._replay_policy_frames(replay_side)
            steps = side_steps[replay_side]
            frames = self._frames[:steps + 1]
            # Freeze this run's numbers so the replay browser can show WHAT it
            # actually scored (return + its terminal/shaping/step-cost split, the
            # exploration ε it acted under, and the head-to-head outcome), not just
            # its length. ep_parts is grid-only; arena rounds carry no split.
            side_parts = None
            if env_parts is not None and replay_side in env_parts:
                p = env_parts[replay_side]
                side_parts = {k: round(float(p.get(k, 0.0)), 3)
                              for k in ("terminal", "shape", "other")}
            stats = {
                "return": round(float(self.ep_return.get(replay_side, 0.0)), 3),
                "parts": side_parts,
                "epsilon": round(float(self.red_epsilon if replay_side == "red"
                                       else self.epsilon), 3),
                "raceWinner": race,
                "outcome": ("win" if race == replay_side
                            else "lose" if race in ("red", "blue") else "draw"),
                "truncated": bool(truncated),
            }
            lst.append({"steps": steps, "episode": self.episode,
                        "winner": replay_side,
                        "stats": stats,
                        "frames": frames,
                        "policyFrames": replay_policy,
                        "replayFields": (replay_fields or {}).get(replay_side)})
            lst.sort(key=lambda e: e["steps"], reverse=survival)
            del lst[TOP_N:]
        recent = list(self.recent)
        n = len(recent) or 1
        self.hist.append({
            "ep": self.episode,
            "steps": self.total_steps,
            "eps": round(self.epsilon, 3),
            "redEps": round(self.red_epsilon, 3),
            "len": self.env.steps,
            "rateRed": round(recent.count("red") / n, 3),
            "rateBlue": round(recent.count("blue") / n, 3),
            "retRed": round(self.last_return["red"], 3),
            "retBlue": round(self.last_return["blue"], 3),
            "tdRed": round(self._learn_signal("red"), 4),
            "tdBlue": round(self._learn_signal("blue"), 4),
            "gnormRed": round(self._dqn_field("red", "gradNorm"), 3),
            "gnormBlue": round(self._dqn_field("blue", "gradNorm"), 3),
            "predQRed": round(self._dqn_field("red", "predQ"), 3),
            "predQBlue": round(self._dqn_field("blue", "predQ"), 3),
        })

    def _replay_policy_frames(self, agent):
        """Compact HxW canonical policy history for a DP replay; empty for learners."""
        planner = self._agent(agent)
        frames = getattr(planner, "policy_frames", None)
        if not frames:
            return []
        out = []
        for fr in frames:
            grid = [[None] * self.env.W for _ in range(self.env.H)]
            for (r, c), action in fr.items():
                if 0 <= r < self.env.H and 0 <= c < self.env.W:
                    grid[r][c] = int(action)
            out.append(grid)
        return out

    def _capture_replay_fields(self, agent):
        """Freeze Arena-2 Q/value/policy fields before MC learns from the run.

        A replay frame carries the collected-tomato mask, so store one field for
        every mask visited during this episode. This is the historical model that
        selected the replay's actions; future training must not alter it.
        """
        if not getattr(self.env, "star_mode", False):
            return None
        learner = self._agent(agent)
        star_key = agent + "Stars"
        masks = sorted({int(frame.get(star_key, 0)) for frame in self._frames})
        fields = {}
        floor = [list(cell) for cell in self.env.floor_cells]
        for star_mask in masks:
            q_grid = [[None] * self.env.W for _ in range(self.env.H)]
            value_grid = [[None] * self.env.W for _ in range(self.env.H)]
            policy = [[None] * self.env.W for _ in range(self.env.H)]
            effective = [[None] * self.env.W for _ in range(self.env.H)]
            for (r, c), idx in self.env.cell_index.items():
                state = (idx, star_mask)
                if learner.state_value(state) is None:
                    continue
                q = learner.q_values(state)
                allowed = self.env.effective_actions(
                    agent, (r, c), star_mask=star_mask)
                valid = [
                    action for action in range(len(q)) if allowed[action]
                ] or list(range(len(q)))
                q_grid[r][c] = [round(float(value), 4) for value in q]
                value_grid[r][c] = round(
                    float(max(q[action] for action in valid)), 4
                )
                policy[r][c] = _unique_argmax(q, valid)
                effective[r][c] = [bool(value) for value in allowed]
            fields[str(star_mask)] = {
                "q": q_grid,
                "value": value_grid,
                "policy": policy,
                "effective": effective,
            }
        return {
            "H": self.env.H,
            "W": self.env.W,
            "floor": floor,
            "masks": fields,
            "epsilon": round(float(learner.epsilon), 4),
        }

    def _ceremony_frame(self, side):
        frame = copy.deepcopy(self._frames[-1]) if self._frames else self.env.snapshot()
        if side not in ("red", "blue"):
            return frame
        frame["winner"] = side
        if frame.get("continuous") and frame.get("goal"):
            frame[side] = list(frame["goal"])
            return frame
        goal = None
        world = getattr(self.env, "world", None)
        exits = getattr(world, "escape", None) if world is not None else None
        if exits:
            goal = list(exits[0])
        if goal is not None:
            frame[side] = goal
        return frame

    # --------------------------------------------------------------- controls
    def regenerate(self, seed=None):
        """Install a newly-seeded world and wipe both models (New World control).

        With no explicit seed, advance the current training seed so repeated
        ``New World`` clicks produce different but reproducible layouts.  An
        explicit seed remains an exact replay mechanism.
        """
        with self.lock:
            if seed is None:
                seed = 1 if self.train_seed is None else int(self.train_seed) + 1
            else:
                seed = int(seed)
            self.train_seed = seed
            if self._is_round4_missile():
                self.delete_checkpoint()
                # Regeneration is also an explicit learning wipe.  This reset only
                # reseeds/clears the live arena before _new_episode resets it again,
                # so it must not briefly reuse the discarded model's curriculum.
                set_curriculum_episode = getattr(
                    self.env, "set_curriculum_episode", None)
                if set_curriculum_episode is not None:
                    set_curriculum_episode(0)
            self.env.reset(seed=seed, regenerate=True)
            self.world_version += 1
            self._build_agents()
            self.finish_event = None
            self._reset_stats()
            self._new_episode()

    def reset_models(self):
        """Wipe learning, KEEP the current world."""
        with self.lock:
            if self._is_round4_missile():
                self.delete_checkpoint()
            self._build_agents()
            self.finish_event = None
            self._reset_stats()
            self._new_episode()

    def reset_tournament(self):
        """Start a fresh tournament from round 1 and clear all stage points."""
        with self.lock:
            first = worlds.ROUNDS[0] if worlds.ROUNDS else self.round_id
            self.set_round(first, keep_score=False)

    def set_params(self, p):
        """Update tunable settings live from the panel. Three tiers:
          * per-side LEARNING (alpha / gamma / epsilon schedule) -> OUR model, Blue;
          * GLOBAL algorithm internals (DP theta+sweeps, DQN batch/buffer/warmup/
            sync/width) -> BOTH agents; buffer+width need an agent rebuild;
          * GLOBAL world dynamics (thrust/drag/speed cap/sand/slip) apply live, and
            structural world knobs (hazard counts, train seed) rebuild the scene.
        Learning knobs apply instantly. Structural changes restart the contest;
        Arena-2 MDP changes also reset its learners so returns are never mixed."""
        with self.lock:
            old_gamma = self.gamma
            need_env_rebuild = False   # scene layout moved (counts / seed)
            need_agent_rebuild = False  # network shape changed (buffer / width)
            replan = False              # GLOBAL DP change: BOTH planners must re-solve
            replan_blue = False         # per-side (Blue's discount / speed): only Blue re-solves
            r4_dyn = False              # Round-4 game-feel change (apply live to the env)
            r4_hearts_reset = False     # a heart-count change needs a fresh episode
            r2_mdp_reset = False        # changed Arena-2 transition/reward function

            # ---- per-side LEARNING (Blue) ----
            if "alpha" in p:
                self.alpha = max(0.0, min(1.0, float(p["alpha"])))
            if "gamma" in p:
                self.gamma = max(0.0, min(1.0, float(p["gamma"])))
            if "epsStart" in p:
                self.eps_start = max(0.0, min(1.0, float(p["epsStart"])))
            if "epsEnd" in p:
                self.eps_end = max(0.0, min(1.0, float(p["epsEnd"])))
            if "epsEpisodes" in p:
                eps_episodes = max(1, int(p["epsEpisodes"]))
                if self._is_round4_missile():
                    self.r4_eps_episodes = eps_episodes
                else:
                    self.eps_episodes = eps_episodes
            if "targetEpisodes" in p:
                t = int(p["targetEpisodes"])
                self.target_episodes = t if t > 0 else None
            if "maxSteps" in p:
                self.max_steps_override = max(50, min(10_000, int(p["maxSteps"])))
                self.env.max_steps = self.max_steps_override

            # ---- GLOBAL: DP internals (both planners re-solve) ----
            if "dpTheta" in p:
                self.dp_theta = max(1e-9, min(1.0, float(p["dpTheta"])))
                replan = True
            if "dpMaxIters" in p:
                self.dp_max_sweeps = max(1, min(100_000, int(p["dpMaxIters"])))
                replan = True

            # ---- Blue's DP planning speed (Bellman sweeps per tick, the race knob) ----
            # Per-side, exactly like set_red_params: it changes only HOW FAST Blue plans,
            # never the solution, so it restarts Blue's own race and leaves Red's untouched.
            if "dpPlanning" in p:
                self.dp_plan_speed = max(0.0, min(10.0, float(p["dpPlanning"])))
                replan_blue = True

            # ---- GLOBAL: Round-1 game mechanics (ice + "?" ghost/freeze blocks) ----
            # Each is pushed onto the env by _apply_env_config below; because the DP
            # planners precompute their transition model (and enumerate a status range),
            # ANY mechanic change means both planners must re-solve from scratch -> replan.
            if "slipProb" in p:
                self.slip_prob = max(0.0, min(0.9, float(p["slipProb"])))
                replan = True
            if "blockGhostProb" in p:
                self.block_ghost_prob = max(0.0, min(1.0, float(p["blockGhostProb"])))
                replan = True
            if "ghostLen" in p:
                self.ghost_len = max(1, min(8, int(p["ghostLen"])))
                replan = True
            if "freezeLen" in p:
                self.freeze_len = max(1, min(8, int(p["freezeLen"])))
                replan = True
            if "coinReward" in p:
                self.coin_reward = max(0.0, min(2.0, float(p["coinReward"])))
                replan = True
            if "blockReward" in p:
                self.block_reward = max(0.0, min(2.0, float(p["blockReward"])))
                replan = True

            # ---- GLOBAL: Round-2 dynamics (the validated seeded layout stays fixed) ----
            if "r2SlipProb" in p:
                value = max(0.0, min(0.9, float(p["r2SlipProb"])))
                r2_mdp_reset |= value != self.r2_slip_prob
                self.r2_slip_prob = value
            if "r3SlipProb" in p:                # Round-3 wet-cell skid chance
                self.r3_slip_prob = max(0.0, min(0.9, float(p["r3SlipProb"])))
                self._apply_env_config()
            if "r2TomatoReward" in p:
                value = max(0.0, min(2.0, float(p["r2TomatoReward"])))
                r2_mdp_reset |= value != self.r2_tomato_reward
                self.r2_tomato_reward = value

            # ---- Round-4 game feel (World card; applied live to the arena) ----
            if "r4MissileSpeed" in p:
                self.r4_missile_speed = max(2.0, min(10.0, float(p["r4MissileSpeed"])))
                r4_dyn = True
            if "r4MissileHoming" in p:
                self.r4_missile_homing = max(0.0, min(1.5, float(p["r4MissileHoming"])))
                r4_dyn = True
            if "r4HitPenalty" in p:
                self.r4_hit_penalty = max(-5.0, min(-0.1, float(p["r4HitPenalty"])))
                r4_dyn = True
            if "r4Hearts" in p:
                self.r4_hearts = max(1, min(9, int(p["r4Hearts"])))
                r4_dyn = True
                r4_hearts_reset = True
            if "r4ActionRepeat" in p:
                self.r4_action_repeat = max(1, min(8, int(p["r4ActionRepeat"])))
                if getattr(self.env, "missile_game", False):
                    self.env.action_repeat = self.r4_action_repeat

            # ---- BLUE's DQN internals (per-side; Red's are in set_red_params) ----
            if "dqnBatch" in p:
                self.dqn_batch = max(1, min(1024, int(p["dqnBatch"])))
            if "dqnWarmup" in p:
                self.dqn_warmup = max(0, int(p["dqnWarmup"]))
            if "dqnTargetSync" in p:
                self.dqn_target_sync = max(1, int(p["dqnTargetSync"]))
            if "dqnBuffer" in p:
                self.dqn_buffer = max(1_000, min(2_000_000, int(p["dqnBuffer"])))
                need_agent_rebuild = True
            if "dqnHidden" in p:
                self.dqn_hidden = max(16, min(1024, int(p["dqnHidden"])))
                need_agent_rebuild = True
            if "dqnLayers" in p:
                self.dqn_layers = max(1, min(6, int(p["dqnLayers"])))
                need_agent_rebuild = True
            if "dqnNstep" in p:
                self.dqn_n_step = max(1, min(10, int(p["dqnNstep"])))
                need_agent_rebuild = True

            # ---- GLOBAL: structural world (rebuild the scene) ----
            if "trainSeed" in p:
                self.train_seed = _int_or_none(p["trainSeed"], lo=0, hi=10_000_000)
                need_env_rebuild = True

            # push live learning-rate / discount onto OUR live agent (Blue) only
            if hasattr(self.blue, "alpha"):
                self.blue.alpha = self.alpha
            if hasattr(self.blue, "gamma"):
                self.blue.gamma = self.gamma
            if hasattr(self.blue, "plan_speed"):          # DP sweeps/tick (Blue), live
                self.blue.plan_speed = self.dp_plan_speed
            # live-settable DQN attrs on BLUE only (buffer/width handled by rebuild;
            # Red's internals are applied in set_red_params)
            if hasattr(self.blue, "batch"):
                self.blue.batch = self.dqn_batch
            if hasattr(self.blue, "warmup"):
                self.blue.warmup = self.dqn_warmup
            if hasattr(self.blue, "target_sync"):
                self.blue.target_sync = self.dqn_target_sync

            if need_env_rebuild:
                self._rebuild_world()
            elif need_agent_rebuild:
                self._apply_env_config()   # keep live env dynamics unchanged
                self._build_agents()
                self._reset_stats()
                self._new_episode()
            elif r2_mdp_reset and self.round_id == 2:
                # Slip probability changes P(s'|s,a), and tomato reward changes
                # R(s,a,s'). Mixing either with old returns/Q fields/replays would
                # no longer describe one MDP, so restart both MC learners cleanly.
                self._apply_env_config()
                self._build_agents()
                self.finish_event = None
                self._reset_stats()
                self._new_episode()
            else:
                space_moved = self._apply_env_config()
                # A ghost/freeze LENGTH change re-sizes the DP state space (the planners
                # re-enumerate below). Without a scene rebuild the episode keeps running, so
                # the in-flight env.status can now sit OUTSIDE the new range (e.g. status 8
                # while ghost_len just dropped to 3) - a state the re-enumerated planner has
                # no V/policy for. Pull each agent's live status back into the new bounds so
                # it stays on a planned state (else policy_action's masked fallback / the Q
                # inspector would hit an un-enumerated successor). Only fires on a genuine
                # length change; slip/coin/prob edits leave the status range untouched.
                if space_moved and hasattr(self.env, "status"):
                    gl, fl = self.env.ghost_len, self.env.freeze_len
                    for a in ("red", "blue"):
                        self.env.status[a] = max(-fl, min(gl, self.env.status[a]))
                # A GLOBAL DP change (theta / max-sweeps / a shared world mechanic) forces
                # BOTH planners to re-solve. A change to Blue's OWN discount or planning
                # speed restarts ONLY Blue's plan (Red's race keeps running), mirroring
                # set_red_params, so tuning one side never disturbs the other's contest.
                if replan:
                    for ag in (self.red, self.blue):
                        if hasattr(ag, "plan_speed"):     # a DP planner
                            ag.theta = self.dp_theta
                            ag.max_sweeps = self.dp_max_sweeps
                            ag.reset_learning()
                elif (replan_blue or self.gamma != old_gamma) and is_dp(self.algo_blue) \
                        and hasattr(self.blue, "plan_speed"):
                    self.blue.reset_learning()
                self._apply_epsilon()
            # A Round-4 heart-count change needs a fresh episode to take effect (the
            # rebuild paths already restart; only the pure-live path needs this).
            if r4_hearts_reset and not need_env_rebuild and not need_agent_rebuild:
                self._new_episode()
            return self.params()

    def params(self):
        return {
            "alpha": round(self.alpha, 4),
            "gamma": round(self.gamma, 4),
            "epsStart": round(self.eps_start, 3),
            "epsEnd": round(self.eps_end, 3),
            "epsEpisodes": self._effective_blue_eps_episodes(),
            "maxSteps": self.env.max_steps,
            "targetEpisodes": self.target_episodes or 0,
            # global algorithm internals
            "dpTheta": self.dp_theta,
            "dpMaxIters": self.dp_max_sweeps,
            "dpPlanning": self.dp_plan_speed,
            # round-1 game mechanics (Peach's Castle)
            "slipProb": round(self.slip_prob, 2),
            "blockGhostProb": round(self.block_ghost_prob, 2),
            "ghostLen": self.ghost_len,
            "freezeLen": self.freeze_len,
            "coinReward": round(self.coin_reward, 2),
            "blockReward": round(self.block_reward, 2),
            "r2SlipProb": round(self.r2_slip_prob, 2),
            "r3SlipProb": round(self.r3_slip_prob, 2),
            "r2TomatoReward": round(self.r2_tomato_reward, 2),
            # round-4 game feel (only shown on R4; safe defaults on other rounds)
            "r4MissileSpeed": round(getattr(self.env, "missile_max_speed", 5.4), 2),
            "r4MissileHoming": round(getattr(self.env, "missile_turn", 0.5), 2),
            "r4Hearts": int(getattr(self.env, "hearts_max", 3)),
            "r4HitPenalty": round(getattr(self.env, "hit_penalty", -2.0), 2),
            "r4ActionRepeat": int(getattr(self.env, "action_repeat", 4)),
            "dqnBatch": self.dqn_batch,
            "dqnBuffer": self.dqn_buffer,
            "dqnWarmup": self.dqn_warmup,
            "dqnTargetSync": self.dqn_target_sync,
            "dqnNstep": self.dqn_n_step,
            "dqnHidden": self.dqn_hidden,
            "dqnLayers": self.dqn_layers,
            # reproducibility
            "trainSeed": self.train_seed if self.train_seed is not None else -1,
        }

    def set_red_params(self, p):
        """Manually override the CPU (Red) hyperparameters from the locked N panel.
        Mirrors set_params but targets Red; the shared step cap / episode target are
        NOT here (they go through set_params). Lasts until the tier changes."""
        with self.lock:
            old_gamma = self.red_gamma
            old_plan_speed = self.red_plan_speed
            if "alpha" in p:
                self.red_alpha = max(0.0, min(1.0, float(p["alpha"])))
            if "gamma" in p:
                self.red_gamma = max(0.0, min(1.0, float(p["gamma"])))
            if "epsStart" in p:
                self.red_eps_start = max(0.0, min(1.0, float(p["epsStart"])))
            if "epsEnd" in p:
                self.red_eps_end = max(0.0, min(1.0, float(p["epsEnd"])))
            if "epsEpisodes" in p:
                eps_episodes = max(1, int(p["epsEpisodes"]))
                if self._is_round4_missile():
                    self.r4_red_eps_episodes = eps_episodes
                else:
                    self.red_eps_episodes = eps_episodes
            # Red's PER-SIDE DQN internals. batch/warmup/target-sync apply live;
            # buffer/width/depth need fresh weights -> rebuild.
            if "dqnBatch" in p:
                self.red_dqn_batch = max(1, min(1024, int(p["dqnBatch"])))
            if "dqnWarmup" in p:
                self.red_dqn_warmup = max(0, int(p["dqnWarmup"]))
            if "dqnTargetSync" in p:
                self.red_dqn_target_sync = max(1, int(p["dqnTargetSync"]))
            if hasattr(self.red, "batch"):
                self.red.batch = self.red_dqn_batch
            if hasattr(self.red, "warmup"):
                self.red.warmup = self.red_dqn_warmup
            if hasattr(self.red, "target_sync"):
                self.red.target_sync = self.red_dqn_target_sync
            red_net_change = False
            if "dqnBuffer" in p:
                self.red_dqn_buffer = max(1_000, min(2_000_000, int(p["dqnBuffer"])))
                red_net_change = True
            if "dqnHidden" in p:
                self.red_dqn_hidden = max(16, min(1024, int(p["dqnHidden"])))
                red_net_change = True
            if "dqnLayers" in p:
                self.red_dqn_layers = max(1, min(6, int(p["dqnLayers"])))
                red_net_change = True
            if "dqnNstep" in p:
                self.red_dqn_n_step = max(1, min(10, int(p["dqnNstep"])))
                red_net_change = True
            if red_net_change:
                # a new architecture / buffer needs fresh weights: rebuild both sides
                # and restart the contest (mirrors set_params' width/buffer rebuild).
                self._build_agents()
                self._reset_stats()
                self._new_episode()
                return self.red_view()
            if "dpPlanning" in p:
                self.red_plan_speed = max(0.0, min(10.0, float(p["dpPlanning"])))
                if hasattr(self.red, "plan_speed"):
                    self.red.plan_speed = self.red_plan_speed
            if hasattr(self.red, "alpha"):
                self.red.alpha = self.red_alpha
            if hasattr(self.red, "gamma"):
                self.red.gamma = self.red_gamma
            if ((self.red_gamma != old_gamma or self.red_plan_speed != old_plan_speed)
                    and is_dp(self.algo_red) and hasattr(self.red, "reset_learning")):
                self.red.reset_learning()   # replay the DP race with the new CPU setting
            self._apply_epsilon()
            return self.red_view()

    def red_view(self):
        """Red's current params (for the locked CPU panel). Step cap / episode
        target are the shared globals, shown for parity with the Blue panel."""
        return {
            "alpha": round(self.red_alpha, 4),
            "gamma": round(self.red_gamma, 4),
            "epsStart": round(self.red_eps_start, 3),
            "epsEnd": round(self.red_eps_end, 3),
            "epsEpisodes": self._effective_red_eps_episodes(),
            "dpPlanning": round(self.red_plan_speed, 3),
            "dqnBatch": self.red_dqn_batch,
            "dqnBuffer": self.red_dqn_buffer,
            "dqnWarmup": self.red_dqn_warmup,
            "dqnTargetSync": self.red_dqn_target_sync,
            "dqnNstep": self.red_dqn_n_step,
            "dqnHidden": self.red_dqn_hidden,
            "dqnLayers": self.red_dqn_layers,
            "maxSteps": self.env.max_steps,
            "targetEpisodes": self.target_episodes or 0,
        }

    def set_cpu_tier(self, tier, level=None, force=False):
        """Set the CPU (Red) difficulty from the chosen character. ``tier`` (1..5) is the
        display tier; ``level`` (0..9) picks the PER-CHARACTER hyperparameter model in
        RED_MODELS that actually drives Red's strength (defaults from the tier if not
        given). Rebuilds Red and restarts fresh; no-op if unchanged, so the frontend can
        send it freely on start. ``force`` deliberately restores the character's
        profile even when the same character was already selected (new tournament)."""
        with self.lock:
            t = max(1, min(5, int(tier)))
            lv = int(round((t - 1) / 4.0 * 9)) if level is None else max(0, min(9, int(round(level))))
            if not force and t == self.red_tier and lv == self.red_level:
                return
            self.red_tier = t
            self.red_level = lv
            self._red_from_tier()              # a new opponent resets any manual override
            self._build_agents()
            self.finish_event = None
            self._reset_stats()
            self._new_episode()

    def set_side_algo(self, side, algo):
        with self.lock:
            valid = algo in ALGORITHMS or is_dp(algo) or is_deep(algo)
            if not valid or algo not in ROUND_ALGO_FAMILIES.get(
                    self.round_id, set()):
                return
            if side == "red":
                self.algo_red = algo
            elif side == "blue":
                self.algo_blue = algo
            self._build_agents()
            self.finish_event = None
            self._reset_stats()
            self._new_episode()

    def _algo_for_env(self, algo, default):
        """Accept a per-round override only if it exists AND fits this round's env
        kind (deep on the continuous arenas; tabular / DP on the grids). Else
        fall back to the round default, so a mismatched pick can never build the
        wrong agent for the env."""
        if not algo:
            return default
        ok = algo in ROUND_ALGO_FAMILIES.get(self.round_id, set())
        return algo if ok else default

    def _round_matchup(self, round_id):
        """(red, blue) for a round: the menu loadouts if set + compatible, else the
        ROUND_ALGOS defaults. Red = CPU character's algo, Blue = player's card pick."""
        dr, db = worlds.round_algos(round_id)
        return (self._algo_for_env(self.cpu_algos.get(round_id), dr),
                self._algo_for_env(self.player_algos.get(round_id), db))

    def set_loadouts(self, cpu=None, player=None):
        """Install the menu's per-round algorithm picks (lists in round order, index
        0 = first round): cpu = the chosen CPU character's algo per round (Red),
        player = the card picks per round (Blue). Re-applies to the current round."""
        with self.lock:
            order = worlds.ROUNDS

            def build(lst):
                d = {}
                if isinstance(lst, (list, tuple)):
                    for i, key in enumerate(lst):
                        if i < len(order) and key:
                            d[order[i]] = key
                return d

            self.cpu_algos = build(cpu)
            self.player_algos = build(player)
            self.algo_red, self.algo_blue = self._round_matchup(self.round_id)
            self._build_agents()
            self._reset_stats()
            self._new_episode()

    def set_round(self, round_id, keep_score=True):
        """Switch to a round: install its world + its matchup + reset learning.
        Tournament score is preserved unless told otherwise."""
        with self.lock:
            # Preserve the model being left before replacing its env/agents.
            self.save_checkpoint(force=True)
            self.round_id = round_id
            self.env = self._make_env(round_id)   # rebuild: round may switch env class
            self._apply_env_config()              # carry dynamics/slip/step-cap across
            self.world_version += 1
            self.algo_red, self.algo_blue = self._round_matchup(round_id)
            # Manual tuning belongs to the arena where it was entered. Switching
            # arenas reinstalls each algorithm's validated starting profile.
            self._blue_from_round()
            self._red_from_tier()
            if not keep_score:
                self.score = {"red": 0, "blue": 0}
                self.awarded_rounds.clear()
                self.round_results = {}
                self.last_award = None
            self.finish_event = None
            self._build_agents()
            self._reset_stats()
            self._load_checkpoint()
            self._new_episode()

    def prev_round(self):
        """Step back to the previous round (navigation only; leaves the score as-is)."""
        with self.lock:
            order = worlds.ROUNDS
            i = order.index(self.round_id) if self.round_id in order else 0
            self.set_round(order[(i - 1) % len(order)], keep_score=True)

    def next_round(self):
        """Advance to the next round (wraps). Navigation only: it does NOT score.

        A point is awarded ONLY when the stage is finished with T (award_round).
        Moving between stages is free and leaves the tournament score untouched -
        if the current round was resolved with T its point is already banked, and
        if it wasn't, skipping past it gives nobody a point."""
        with self.lock:
            order = worlds.ROUNDS
            i = order.index(self.round_id) if self.round_id in order else 0
            self.set_round(order[(i + 1) % len(order)], keep_score=True)

    def award_round(self):
        """Finish the current stage INSTANTLY (no waiting for the next live finish).

        The point goes to whichever model has more RECENT wins; a tie is a genuine
        draw - no point, no winner, and the ceremony won't zoom on a character. The
        round is marked resolved either way so a following Next can never re-score it.
        """
        with self.lock:
            # already resolved this round? re-show the same result, never double-score.
            if self.round_id in self.awarded_rounds and self.last_award \
                    and self.last_award.get("roundId") == self.round_id:
                return dict(self.last_award)
            # nothing has been contested yet (no episode finished) -> don't lock the
            # round as a no-op draw; let the user press T again once there's a result.
            if not self.recent and self.round_id not in self.awarded_rounds:
                return {"winner": None, "awarded": False, "pending": True,
                        "roundId": self.round_id, "score": dict(self.score)}
            award = self._award_current_round()   # winner=recent leader (or the banked one), None on a tie
            self.awarded_rounds.add(self.round_id)                  # resolved (a draw counts as resolved too)
            focus = award.get("winner")
            frame = self._ceremony_frame(focus)                    # focus=None (draw) -> no character moved
            self.finish_serial += 1
            self.finish_event = {
                "serial": self.finish_serial,
                "awardSerial": award.get("serial"),
                "roundId": self.round_id,
                "roundIndex": award.get("roundIndex", 0),
                "roundTotal": award.get("roundTotal", len(worlds.ROUNDS)),
                "title": award.get("title", ""),
                "winner": focus if focus in ("red", "blue") else None,
                "episodeWinner": None,
                "awarded": award.get("awarded", False),
                "score": dict(self.score),
                "award": dict(award),
                "frame": frame,
                "labelRed": award.get("labelRed", self.algo_red),
                "labelBlue": award.get("labelBlue", self.algo_blue),
            }
            return dict(award)

    def _award_current_round(self):
        recent = list(self.recent)
        red_wins = recent.count("red")
        blue_wins = recent.count("blue")
        draw_wins = recent.count("draw")
        meta = self._matchup()
        idx = meta.get("index", 0)
        already = self.round_id in self.awarded_rounds

        if already:
            # the round is banked - re-show the STORED winner (from round_results),
            # never recompute from the since-reset recent window and never re-score.
            # This is what stops a re-award (after navigating away and back) from
            # announcing a different winner than the one actually banked.
            banked = self.round_results.get(idx)
            winner = banked if banked in ("red", "blue") else None
        else:
            winner = ("red" if red_wins > blue_wins
                      else "blue" if blue_wins > red_wins
                      else None)
            if winner:
                self.score[winner] += 1
                self.awarded_rounds.add(self.round_id)
            # record who took THIS round (draw included) for the header dots
            self.round_results[idx] = winner if winner in ("red", "blue") else "draw"

        self.award_serial += 1
        self.last_award = {
            "serial": self.award_serial,
            "source": "official",
            "roundId": self.round_id,
            "roundIndex": idx,
            "roundTotal": meta.get("total", len(worlds.ROUNDS)),
            "title": meta.get("title", ""),
            "winner": winner,
            "awarded": bool(winner and not already),
            "already": already,
            "pending": False,
            "recent": {"red": red_wins, "blue": blue_wins, "draw": draw_wins},
            "score": dict(self.score),
            "labelRed": meta.get("labelRed", self.algo_red),
            "labelBlue": meta.get("labelBlue", self.algo_blue),
        }
        return dict(self.last_award)

    # ------------------------------------------------------------- inspection
    def _matchup(self):
        # round_meta carries the ROUND_ALGOS DEFAULTS; overwrite the algo labels with
        # the LIVE agents so the briefing / HUD / award reflect the actual matchup
        # (the chosen character's algo for Red, the player's card pick for Blue), not
        # the round default. World identity (theme / title / index) stays from meta.
        m = dict(worlds.round_meta(self.round_id))
        lr = worlds.ALGO_LABELS.get(self.algo_red, self.algo_red)
        lb = worlds.ALGO_LABELS.get(self.algo_blue, self.algo_blue)
        m["algoRed"], m["algoBlue"] = self.algo_red, self.algo_blue
        m["labelRed"], m["labelBlue"] = lr, lb
        # Blue (the player's model) reads on the LEFT, matching the HUD, the panel
        # header and the Head-to-head table (all Blue-left / Red-right).
        m["matchup"] = f"{lb} vs {lr}"
        return m

    def _family(self):
        a = self.algo_blue
        if is_dp(a):
            return "Dynamic Programming"
        if is_pg(a):
            return "Policy Gradient (policy-based)"
        if is_dqn(a):
            return "Deep RL (function approximation)"
        if a in ("monte_carlo", "first_visit_mc"):
            return "Monte-Carlo"
        return "Temporal-Difference"

    def mdp_spec(self):
        """The round's MDP tuple (S, A, R, gamma) + win condition, for the BRIEFING
        card. Reward constants mirror env.py / continuous.py."""
        with self.lock:
            env = self.env
            arena = env.objective == "arena"
            meta = self._matchup()
            slip_prob = 0.0
            observation_tuple = "(state)"
            state_groups = None   # optional VISUAL breakdown of a continuous obs vector
            # optional VISUAL breakdown of a DISCRETE (tabular) state as MULTIPLIED
            # factors: |S| = n1 x n2 x ... - one chip per factor, so the grid rounds
            # get the same at-a-glance state teaching the continuous rounds do.
            state_factors = None
            reward_note = (
                "Only the listed rewards are used; there is no hidden "
                "closer-to-goal bonus."
            )
            if not arena and getattr(env, "rich", False):
                # Round 1's real game: a stochastic maze with optional coins + Mystery Blocks
                actions = ["North", "South", "West", "East"]
                nbits = env._n_coins["blue"] + len(env.block_cells["blue"])
                # floor cells carry all statuses; interior wall cells (ghost-only) carry
                # just the positive ghost statuses (see dp._enumerate_states)
                n_floor = env.n_cells
                n_wall = len(getattr(env, "pos_cells", [])) - n_floor
                # live (panel-tunable) mechanic values, so the briefing matches the game
                gl, fl = env.ghost_len, env.freeze_len
                gp = env.block_ghost_prob
                sp = env.slip_prob
                state_size = ((n_floor * (gl + fl + 1) + n_wall * gl) * (1 << nbits))
                state_factors = [
                    {"label": "Your tile", "n": n_floor + n_wall,
                     "detail": "the (row, col) cell you stand on", "color": "#3f7fe0"},
                    {"label": "Collected", "n": 1 << nbits,
                     "detail": f"{nbits}-bit mask of coins / Mystery Blocks claimed",
                     "color": "#8b5cf6"},
                    {"label": "Status", "n": gl + fl + 1,
                     "detail": "ghost or freeze countdown (0 = normal)",
                     "color": "#22a39f"},
                ]
                state_desc = ("your tile, which of your own coins/Mystery Blocks you have claimed, "
                              "and your power-up / frozen countdown")
                observation = ("Each model sees its own tile, its collected coins/Mystery Blocks, and "
                               "any active ghost or freeze timer - the rival stays invisible, so "
                               "it still plans as a single agent.")
                observation_tuple = "(cell, collected mask, status)"
                sees_opp = False
                opp_info = ("Nothing. There is no opponent term in the state; each model owns a "
                            "mirror-image set of coins/Mystery Blocks, so the race is fair but solo.")
                dynamics = (f"Deterministic on dry tiles. On ICE a move slips sideways "
                            f"({round((1 - sp) * 100)}% intended, {round(sp * 50)}% each "
                            f"perpendicular). A Mystery Block is a one-time gamble: {round(gp * 100)}% "
                            f"Ghost (phase through walls, up to {gl} floor tiles - the timer only "
                            f"counts tiles landed on, so you can never be trapped mid-wall) or "
                            f"{round((1 - gp) * 100)}% Freeze (stuck for {fl} turns).")
                rewards = [["Step", -0.01], ["Coin reward", round(env.coin_reward, 2)],
                           ["Mystery Block reward", round(env.block_reward, 2)],
                           ["Win (reach the Power Moon)", 1.0], ["Lose", -1.0]]
                win = ("First to the Power Moon wins; coins are optional value on the way. A "
                       "simultaneous arrival is a draw.")
                slip_prob = sp
            elif not arena and getattr(env, "hazardous", False) and not getattr(env, "goomba_mode", False):
                # Round 2 (New Donk City): the collect-three-tomatoes MC tour.
                actions = ["North", "South", "West", "East"]
                n_stars = getattr(env, "n_stars", 0)
                star_mode = getattr(env, "star_mode", False)
                n_floor = getattr(env, "n_cells", None)
                n_pipes = len(getattr(env, "pipe_map", ()))
                n_slip = len(getattr(env, "slip_cells", ()))
                n_plants = len(getattr(env, "plant_cells", ()))
                if star_mode:
                    state_desc = (f"your tile AND which of your {n_stars} tomatoes you already "
                                  f"hold - the cell index x a {n_stars}-bit tomato mask")
                    state_size = (n_floor * (1 << n_stars)) if n_floor else None
                    if n_floor:
                        state_factors = [
                            {"label": "Your tile", "n": n_floor,
                             "detail": "the floor cell you stand on", "color": "#3f7fe0"},
                            {"label": "Tomatoes held", "n": 1 << n_stars,
                             "detail": f"{n_stars}-bit mask (2^{n_stars} = {1 << n_stars} combos)",
                             "color": "#e0563f"},
                        ]
                else:
                    state_desc = "your tile only: the (row, column) cell index"
                    state_size = n_floor
                    if n_floor:
                        state_factors = [
                            {"label": "Your tile", "n": n_floor,
                             "detail": "the floor cell you stand on", "color": "#3f7fe0"},
                        ]
                observation = (f"Each model sees its own tile and its own {n_stars}-tomato progress - a "
                               "single-agent navigator. The maze walls and pipes are FIXED map "
                               "features, so (tile, tomatoes-held) stays Markov; the rival is invisible.")
                observation_tuple = "(cell, tomato mask)" if star_mode else "(cell)"
                sees_opp = False
                opp_info = ("Nothing. There is no opponent term in the state; each model races its "
                            "own mirror-image copy of the same tomato-collection course.")
                stage_pipes = len({
                    req for req in getattr(env, "pipe_req", {}).values()
                    if req is not None
                })
                skid = getattr(env, "r2_slip_prob", R2_SLIP_PROB)
                slip_prob = skid
                if star_mode:
                    dynamics = (
                        f"The generated bottom room offers a SHORT mandatory-puddle shortcut beside "
                        f"a PIRANHA PLANT and a longer hazard-free route into one shared centre Pipe. "
                        f"The second tomato has a short puddle approach and a longer dry approach; "
                        f"after collecting it, the room offers a separate puddle-and-plant shortcut "
                        f"or a longer safe route to each racer's side Pipe. The final tomato also "
                        f"offers wet-short versus dry-long approaches before seeded bush corridors, "
                        f"another plant, and the shared goal. "
                        f"Training keeps 70% full bottom-spawn races and 10% mirrored random "
                        f"post-tomato exploring starts in each collected-mask slice, so Monte "
                        f"Carlo continues to cover the whole long course. Only complete bottom-"
                        f"spawn races count in contest statistics or qualify for top replays. "
                        f"While standing on a puddle, movement skids perpendicular with probability "
                        f"{round(skid * 100)}% total. The 19x19 course contains {n_slip} puddles "
                        f"and {n_plants} plants. There are "
                        f"{stage_pipes} required deterministic WARP PIPE transfers per racer. "
                        f"Entering any of the eight cells around a plant eliminates that racer. "
                        f"Its MC trajectory ends there and it stays out until the next episode; "
                        f"the rival continues until it also resolves or the time limit expires."
                    )
                    rewards = [
                        ["Step", -0.01],
                        ["Collect a tomato (first time only)",
                         round(getattr(env, "star_reward", STAR_REWARD), 2)],
                        ["Win (all 3 tomatoes, then the goal)", 1.0],
                        ["Die in a plant attack zone", -1.0],
                    ]
                    win = (
                        f"Gather all {n_stars} tomatoes and reach the top goal first. "
                        "A racer eaten by a plant remains out until the next episode while "
                        "the other can finish; a simultaneous finish is a draw."
                    )
                    reward_note = (
                        "Each tomato pays its bonus once when collected. Step cost, "
                        "tomato bonuses, the goal reward, and plant-death penalty are "
                        "the complete reward function."
                    )
                else:
                    observation = ("Each model sees only its own tile. The seeded bush maze, "
                                   "puddle, plant attack zone, and Pipe are fixed map features.")
                    opp_info = ("Nothing. Both models receive exact mirrored copies of the same "
                                "bottom-section decision room.")
                    dynamics = (
                        f"The bottom section forks into a SHORT slippery route and a LONG safe "
                        f"route to a deterministic Pipe. On the puddle, movement skids sideways "
                        f"with probability {round(skid * 100)}% total; one skid enters one of the "
                        f"eight lethal cells surrounding the Piranha Plant. Death terminates only "
                        f"that racer's trajectory; it stays out and respawns only when the next "
                        f"episode begins, while the rival keeps moving."
                    )
                    rewards = [["Step", -0.01], ["Opponent dies", 1.0],
                               ["Die in a plant attack zone", -1.0]]
                    win = (
                        "This construction stage tests the bottom decision room. A plant death "
                        "eliminates that racer until the next episode while the rival continues."
                    )
            elif getattr(env, "goomba_mode", False):
                # Round 3 (Fossil Falls): a MIRROR-SYMMETRIC maze race. Both racers start in
                # opposite bottom corners and hunt the shared top-centre exit; 6 Goombas patrol
                # as sentries. A 5th action, STAY, lets a racer wait a beat to time the Goombas.
                actions = ["North", "South", "West", "East", "Stay"]
                state_desc = (
                    f"your tile, the Goomba patrol PHASE (steps mod {env._phase_period}: the "
                    "shared cycle on which every Goomba's position repeats), and a compact RIVAL "
                    "flag (ahead / level / behind, plus whether YOUR cage pickup is still ready)"
                )
                n_cells_r3 = getattr(env, "n_cells", 0)
                phase_period = int(getattr(env, "_phase_period", 1))
                state_size = (n_cells_r3 * phase_period * 6) or None
                if n_cells_r3:
                    state_factors = [
                        {"label": "Your tile", "n": n_cells_r3,
                         "detail": "the floor cell you stand on", "color": "#3f7fe0"},
                        {"label": "Patrol phase", "n": phase_period,
                         "detail": f"steps mod {phase_period}: all {len(env.goombas)} Goombas share this cycle",
                         "color": "#e0563f"},
                        {"label": "Rival flag", "n": 6,
                         "detail": "ahead / level / behind x cage-ready",
                         "color": "#8b5cf6"},
                    ]
                observation = (
                    "Its own tile, the patrol phase (so it can TIME the moving Goombas), where the "
                    "rival is, and whether its own cage pickup is still there to grab."
                )
                observation_tuple = "(cell, phase, rival_flag)"
                sees_opp = True
                opp_info = (
                    "The rival's RELATIVE position is in the state (ahead / level / behind), and a "
                    "bit for whether your CAGE pickup is still available - so a racer can learn to "
                    "detour for the cage and freeze the rival, especially when it is falling behind."
                )
                dynamics = (
                    "4-way moves PLUS a STAY (wait); walls block and the board edge is the outer "
                    "wall. Six GOOMBAS patrol as sentries, each guarding one route cell from a side "
                    "branch - a Goomba on your cell = DEATH, so wait for the gap and slip through. "
                    "WET puddles on the route can SKID your move sideways (the luck that lets one "
                    "racer fall behind). An OFF-route CAGE pickup per side: grab yours (worth it "
                    "when you're behind) to freeze the rival for several steps and catch up. The "
                    "maze is MIRROR-SYMMETRIC: both racers face an identical route to the top exit."
                )
                rewards = [["Step", -0.01], ["Reach the goal first (win)", 1.0],
                           ["Grab your cage (freeze the rival)", round(getattr(env, "cage_reward", 0.2), 2)],
                           ["Caught by a Goomba (death)", -1.0],
                           ["Rival reaches the goal first (lose)", -1.0]]
                win = (
                    "First to the shared exit at top-centre wins; a dead heat draws. The maze is "
                    "MIRROR-SYMMETRIC, so both racers run an identical route from their bottom "
                    "corner - the edge comes from TIMING the Goomba sentries (wait for the gap, "
                    "slip through) and detouring to grab your CAGE pickup to freeze the rival."
                )
            elif not arena:
                # skeleton grid rounds: a bare navigate-to-goal ("cross") race
                actions = ["North", "South", "West", "East"]
                state_desc = "your tile only: the (row, column) cell index"
                state_size = getattr(env, "n_cells", None)
                if state_size:
                    state_factors = [
                        {"label": "Your tile", "n": state_size,
                         "detail": "the floor cell you stand on", "color": "#3f7fe0"},
                    ]
                observation = ("Each model sees ONLY its own tile. It learns as a single-agent "
                               "navigator: the maze is shared, but neither model perceives the other.")
                observation_tuple = "(cell)"
                sees_opp = False
                opp_info = ("Nothing. There is no opponent term in the state, so the rival is "
                            "invisible to the agent.")
                dynamics = ("Moves are deterministic. Walls and the map edge block movement "
                            "(you stay put).")
                rewards = [["Step", -0.01], ["Win (reach the Power Moon)", 1.0], ["Lose", -1.0]]
                win = "First to reach the Power Moon wins; a simultaneous arrival is a draw."
            elif getattr(env, "missile_game", False):
                actions = ["8 compass directions + stay (9)"]
                state_size = None
                sees_opp = False
                state_desc = (
                    f"continuous {env.obs_dim}-vector = "
                    "5 own kinematics (position x/z, velocity x/z, rim clearance) + "
                    "5 own effect timers (speed, shield, slow, freeze, post-hit mercy) + "
                    "3 nearest missiles x 8 (present, relative x/z, velocity x/z, "
                    "aimed-at-me, time-to-impact, predicted miss) + "
                    "3 nearest pickups x 7 (present, relative x/z, 4-way type one-hot)"
                )
                # a VISUAL segmented breakdown of the same vector (dims sum to obs_dim),
                # rendered as a stacked bar + legend instead of the run-on sentence above
                state_groups = [
                    {"label": "Self", "dim": 5, "color": "#3f7fe0",
                     "detail": "position x/z, velocity x/z, rim clearance"},
                    {"label": "Effects", "dim": 5, "color": "#22a39f",
                     "detail": "speed, shield, slow, freeze and post-hit mercy timers"},
                    {"label": "Missiles", "dim": 24, "count": 3, "each": 8, "color": "#e0563f",
                     "detail": "3 nearest x (present, rel x/z, vel x/z, aimed-at-me, "
                               "time-to-impact, predicted miss)"},
                    {"label": "Pickups", "dim": 21, "count": 3, "each": 7, "color": "#8b5cf6",
                     "detail": "3 nearest x (present, rel x/z, 4-way type one-hot)"},
                ]
                observation = (
                    "Each agent sees ONLY itself and its immediate surroundings: its own "
                    "position / velocity and clearance to the rim, its own power-up and "
                    "post-hit timers, the 3 nearest Banzai Bills SORTED by how soon they "
                    "reach it (each with a targets-me flag, a time-to-impact and a "
                    "predicted miss distance), and the 3 nearest pickups with their type."
                )
                observation_tuple = "(self, effects, missiles x3, pickups x3)"
                opp_info = (
                    "Nothing - the rival is not in the observation. Each agent just "
                    "survives its own share of the shared missiles; a targets-me flag "
                    "tells it which Bills are currently hunting it."
                )
                repeat = int(getattr(env, "action_repeat", 4))
                hearts = int(getattr(env, "hearts_max", 3))
                dynamics = (
                    "Movement follows the project spec: DISCRETE velocity (each axis -1/0/1) "
                    "chosen every 0.02 s, with NO momentum. The chosen direction is HELD for "
                    f"{repeat} steps (action-repeat) so the policy commits to a heading instead "
                    "of flip-flopping. Inside a circular tower, Banzai Bills enter from the "
                    "north and home in, exploding on a character or the rim. The barrage "
                    "escalates with survival time: 1 Bill at the start, 2 from 100 steps, 3 "
                    f"from 200 (capped at 3). Each character has {hearts} HEARTS - a hit costs "
                    "a heart and grants a brief mercy-invulnerability in place (no respawn); "
                    "the round ends only when a character loses them all. Pickups can speed "
                    "you up, shield you, slow you or briefly freeze you."
                )
                rewards = [
                    ["Stay alive", "+0.2 / second"],
                    ["Dodge a Bill aimed at you (it expires without a hit)", 0.15],
                    ["Change a closing missile's projected miss distance",
                     "up to +/-0.25 / second"],
                    ["Lose a heart (hit by a Banzai Bill)", -2.0],
                    ["Rival loses their last heart (you win)", 0.05],
                ]
                win = (
                    "Each character has 3 hearts; a Bill hit costs one. The round ends when "
                    "a character runs OUT of hearts - the survivor wins (both emptied on "
                    "the same instant is a draw)."
                )
            elif getattr(env, "ctf_game", False):
                actions = ["8 compass thrusts + coast (9)"]
                state_size = None
                sees_opp = True
                state_desc = (
                    f"continuous {env.obs_dim}-vector = "
                    "4 own kinematics (position x/z, velocity x/z) + "
                    "4 opponent terms (rival relative position x/z, velocity x/z) + "
                    "5 flag terms (relative x/z, and 3 flags: free / you-carry / "
                    "rival-carries) + 4 base vectors (to your base, to the rival's base) + "
                    "4 status terms (carrying, your + rival stun timers, capture lead) + "
                    "6 crate terms (2 nearest crates: present, relative x/z) + "
                    "4 power-up timers (your + rival speed and shield)"
                )
                # segmented breakdown (dims sum to obs_dim = 31) for the stacked bar
                state_groups = [
                    {"label": "Self", "dim": 4, "color": "#3f7fe0",
                     "detail": "your position x/z and velocity x/z"},
                    {"label": "Opponent", "dim": 4, "color": "#e0563f",
                     "detail": "the RIVAL's relative position x/z and velocity x/z"},
                    {"label": "Flag", "dim": 5, "color": "#f5c542",
                     "detail": "flag relative x/z + who holds it (free / you / rival)"},
                    {"label": "Bases", "dim": 4, "color": "#22a39f",
                     "detail": "vector to YOUR base and to the rival's base"},
                    {"label": "Status", "dim": 4, "color": "#8b5cf6",
                     "detail": "carrying, your + rival stun timers, capture lead"},
                    {"label": "Crates", "dim": 6, "count": 2, "each": 3, "color": "#c98a3a",
                     "detail": "2 nearest crates (present, relative x/z)"},
                    {"label": "Power-ups", "dim": 4, "color": "#22a39f",
                     "detail": "your + rival speed and shield timers"},
                ]
                observation = (
                    "Each agent sees ITSELF AND ITS RIVAL: its own position/velocity, the "
                    "rival's relative position/velocity, where the flag is and who holds "
                    "it, the direction to both bases, the status terms (carrying, the two "
                    "stun timers, capture lead), the two nearest crates, and both sides' "
                    "power-up timers."
                )
                observation_tuple = (
                    "(self, opponent, flag + holder, bases, status, crates, power-ups)")
                opp_info = (
                    "FULLY VISIBLE - this is the whole point of the round. The rival's "
                    "relative position and velocity are in every observation, so a good "
                    "policy learns to INTERCEPT the carrier when chasing and to JUKE away "
                    "from the chaser when carrying (and the best juke is unpredictable - "
                    "why a stochastic policy-gradient policy shines here)."
                )
                dynamics = (
                    "Continuous physics WITH momentum: a thrust accelerates the flyer (with "
                    "drag) up to a speed cap. One flag sits on the centre pole. GRAB it to "
                    "become the CARRIER (you move ~0.72x speed while carrying); the other "
                    "is the CHASER. Tag the carrier to INSTANTLY STEAL the flag - the "
                    "robbed carrier is briefly stunned. Deliver the flag to your own corner "
                    "base to CAPTURE it (+1); it then respawns on the pole. Breakable "
                    "CRATES spawn around the board: touch one to smash it for a random "
                    "POWER-UP - speed boost, chain-pull (yank + stun the rival), shield "
                    "(immune to steal/stun), or flag-bomb (knock the flag off the carrier)."
                )
                rewards = [
                    ["Grab the loose flag", 0.15],
                    ["Steal it (tag the enemy carrier)", 0.40],
                    ["Lose it to a tag", -0.40],
                    ["Capture at your base", 1.0],
                    ["The rival captures one", -0.30],
                    ["Smash a crate (earn a power-up)", 0.10],
                    ["Flag-bomb strips the enemy carrier", 0.20],
                    ["Win the round (first to 3 captures)", 2.0],
                    ["Step", -0.002],
                ]
                win = (
                    "First to CAPTURE 3 flags wins the round. If time runs out first, "
                    "whoever has captured more wins (equal captures is a draw)."
                )
            else:
                actions = ["8 compass thrusts + coast (9)"]
                state_size = None
                sees_opp = False
                state_desc = "continuous 6-vector: position, velocity, goal offset (all normalized)"
                observation = ("Its own position and velocity, and the vector to the goal - all "
                               "normalized to the arena size.")
                observation_tuple = "(x, z, vx, vz, goal dx, goal dz)"
                opp_info = ("Nothing. Each model flies its own copy of the physics; the opponent "
                            "is not part of the observation.")
                dynamics = ("Continuous physics: a thrust accelerates the flyer (with drag). Walls "
                            "clamp it back.")
                rewards = [["Step", -0.006], ["Win (reach goal)", 1.0], ["Lose", -1.0]]
                win = "First to reach the goal region wins; a tie is a draw."
            g, gr = self.gamma, self.red_gamma
            horizon = lambda x: (round(1.0 / (1.0 - x), 1) if x < 1 else None)
            # is the factor product the EXACT |S|? true only when every factor is
            # independent (R2 cell x mask); R1's wall cells carry fewer statuses and
            # R3's phase/rival flags are not all jointly reachable, so those are "~".
            factor_product = 1
            for f in (state_factors or []):
                factor_product *= f["n"]
            state_factors_exact = bool(
                state_factors and state_size and factor_product == state_size
            )
            learning = {
                "blue": {"alpha": round(self.alpha, 3), "gamma": round(g, 3),
                         "epsStart": round(self.eps_start, 2), "epsEnd": round(self.eps_end, 2),
                         "epsEpisodes": self._effective_blue_eps_episodes(),
                         "algo": meta["labelBlue"]},
                "red": {"alpha": round(self.red_alpha, 3), "gamma": round(gr, 3),
                        "epsStart": round(self.red_eps_start, 2), "epsEnd": round(self.red_eps_end, 2),
                        "epsEpisodes": self._effective_red_eps_episodes(),
                        "algo": meta["labelRed"]},
                "planning": bool(is_dp(self.algo_blue)),
            }
            return {
                "round": self.round_id, "title": meta["title"], "theme": meta["theme"],
                "objective": env.objective,
                "kind": "arena" if arena else env.objective,
                "missileGame": bool(getattr(env, "missile_game", False)),
                "matchup": meta["matchup"], "labelRed": meta["labelRed"], "labelBlue": meta["labelBlue"],
                "family": self._family(),
                "stateDesc": state_desc, "stateSize": state_size, "stateGroups": state_groups,
                "stateFactors": state_factors, "stateFactorsExact": state_factors_exact,
                "learning": learning,
                "observation": observation, "observationTuple": observation_tuple,
                "seesOpponent": sees_opp, "opponentInfo": opp_info,
                "dynamics": dynamics,
                "actions": actions, "nActions": env.n_actions,
                "maxSteps": env.max_steps,
                "slipProb": slip_prob,
                "gammaRed": round(gr, 3), "gammaBlue": round(g, 3),
                "horizonBlue": horizon(g), "horizonRed": horizon(gr),
                "horizon": horizon(g),
                "winCondition": win,
                "rewards": rewards,
                "rewardNote": reward_note,
            }

    def stats(self):
        with self.lock:
            recent = list(self.recent)
            rate = {
                "red": recent.count("red") / len(recent) if recent else 0.0,
                "blue": recent.count("blue") / len(recent) if recent else 0.0,
                "draw": recent.count("draw") / len(recent) if recent else 0.0,
            }
            avg_len = sum(self.ep_lengths) / len(self.ep_lengths) if self.ep_lengths else 0.0
            meta = self._matchup()
            return {
                "round": meta,
                "score": dict(self.score),
                "roundResults": [self.round_results.get(i) for i in range(len(worlds.ROUNDS))],
                "roundAwarded": self.round_id in self.awarded_rounds,
                "award": dict(self.last_award) if self.last_award else None,
                "finishEvent": copy.deepcopy(self.finish_event) if self.finish_event else None,
                "algoRed": self.algo_red, "algoBlue": self.algo_blue,
                "episode": self.episode,
                "fullCourseEpisodes": self.full_course_episodes,
                "curriculumEpisodes": self.curriculum_episodes,
                "curriculumStage": getattr(self, "_curriculum_stage", 0),
                "totalSteps": self.total_steps,
                "epsilon": round(self.epsilon, 3),
                "wins": dict(self.wins),
                "recentRate": {k: round(v, 3) for k, v in rate.items()},
                "avgEpisodeLen": round(avg_len, 1),
                "lastReturn": {k: round(v, 3) for k, v in self.last_return.items()},
                "returnStd": self._ret_std(),
                "qStates": {"red": self.red.learned_count(),
                            "blue": self.blue.learned_count()},
                "params": self.params(),
                "redParams": self.red_view(),
                "redEpsilon": round(self.red_epsilon, 3),
                "targetEpisodes": self.target_episodes or 0,
                "cpuTier": self.red_tier,
                "cpuLevel": self.red_level,
                "outcomes": dict(self.outcomes),
                "recentOutcome": self._recent_outcome(),
                "actionDist": self.action_dist(),
                "learnSignal": {"red": round(self._learn_signal("red"), 4),
                                "blue": round(self._learn_signal("blue"), 4)},
                "diag": {"red": self._diag("red"), "blue": self._diag("blue")},
            }

    def snapshot(self, include_world=False):
        with self.lock:
            snap = self.env.snapshot()
            out = {
                "worldVersion": self.world_version,
                "frame": snap,
                "stats": self.stats(),
            }
            if include_world:
                out["world"] = self.env.to_json()
            return out

    def history(self):
        with self.lock:
            return {"round": self.round_id, "points": list(self.hist)}

    def replay(self, which="last", agent=None, rank=0, episode=None):
        with self.lock:
            metric = "longest" if getattr(self.env, "missile_game", False) else "fastest"
            if which == "top":
                lst = self._top.get(agent, [])
                if episode is not None:
                    found = next(
                        (
                            (i, item) for i, item in enumerate(lst)
                            if item.get("episode") == episode
                        ),
                        None,
                    )
                    if found is None:
                        return {"available": False}
                    rank, ep = found
                else:
                    if not (0 <= rank < len(lst)):
                        return {"available": False}
                    ep = lst[rank]
                return {"available": True, "which": "top", "agent": agent,
                        "metric": metric,
                        "rank": rank, "winner": ep["winner"], "steps": ep["steps"],
                        "episode": ep["episode"], "frames": ep["frames"],
                        "stats": ep.get("stats"),
                        "policyFrames": ep.get("policyFrames", []),
                        "replayFields": ep.get("replayFields")}
            ep = self.best_episode if which == "best" else self.last_episode
            if not ep:
                return {"available": False}
            return {"available": True, "which": which, "winner": ep["winner"],
                    "metric": metric,
                    "steps": ep["steps"], "frames": ep["frames"]}

    def replays_index(self, agent):
        """Lightweight metadata (no frames) for the top-30 replay list per model."""
        with self.lock:
            lst = self._top.get(agent, [])
            return {"agent": agent, "count": len(lst),
                    "metric": "longest" if getattr(self.env, "missile_game", False) else "fastest",
                    "items": [{"rank": i, "steps": e["steps"], "episode": e["episode"],
                               "return": (e.get("stats") or {}).get("return"),
                               "id": f"{self.round_id}:{agent}:{e['episode']}"}
                              for i, e in enumerate(lst)]}

    def dp_report(self, agent):
        """A DP planner's per-sweep convergence trace + meta, for the training
        console's charts. Returns isDP:false for non-DP agents (Q-learning etc.)."""
        with self.lock:
            a = self._agent(agent)
            log = getattr(a, "sweep_log", None)
            if log is None:
                return {"isDP": False, "agent": agent}
            return {"isDP": True, "agent": agent,
                    "method": getattr(a, "mode", ""),
                    "name": getattr(a, "name", ""),
                    "gamma": getattr(a, "gamma", None),
                    "theta": getattr(a, "theta", None),
                    "phases": 1,   # single-goal DP round (VI/PI run one plan)
                    "sweepCount": sum(getattr(a, "sweeps", []) or []),
                    "backups": getattr(a, "backups", 0),
                    "converged": bool(getattr(a, "converged", False)),
                    "hitLimit": bool(getattr(a, "hit_limit", False)),
                    "maxSweeps": getattr(a, "max_sweeps", None),
                    "policyChanges": list(getattr(a, "policy_changes", []) or []),
                    "sweeps": list(log)}

    def dp_planning_complete(self):
        """True only when both Stage-1 planners genuinely converged.

        Hitting the safety sweep limit is intentionally not completion: the UI
        reports that separately and the other planner may still be working.
        """
        with self.lock:
            agents = (self.red, self.blue)
            return (
                all(is_dp(algo) for algo in (self.algo_red, self.algo_blue))
                and all(
                    bool(getattr(agent, "converged", False))
                    and not bool(getattr(agent, "hit_limit", False))
                    for agent in agents
                )
            )

    def dp_sweeps(self, agent):
        """Per-sweep V snapshots (H x W grids) for the Value-Iteration propagation
        animation - watch value spread outward from the goal one ring per sweep."""
        with self.lock:
            a = self._agent(agent)
            frames = getattr(a, "v_frames", None)
            if not frames or self.env.objective == "arena":
                return {"available": False}
            H, W = self.env.H, self.env.W
            out = []
            for fr in frames:
                g = [[None] * W for _ in range(H)]
                for (r, c), v in fr.items():
                    if 0 <= r < H and 0 <= c < W:
                        g[r][c] = round(v, 4)
                out.append(g)
            return {"available": True, "agent": agent, "n": len(out), "H": H, "W": W, "frames": out}

    def _agent(self, agent):
        return self.red if agent == "red" else self.blue

    # ---- diagnostics helpers (Tier 1) -----------------------------------
    def _learn_signal(self, side):
        """The learning signal to chart: smoothed |TD error| for tabular agents,
        the Huber loss for DQN (its td_error() returns the loss), 0 for DP."""
        f = getattr(self._agent(side), "td_error", None)
        return f() if f else 0.0

    def _dqn_field(self, side, key):
        # DQN-only fields (gradNorm/predQ); PG agents expose a different diag shape
        # (policyLoss/entropy), so missing keys read as 0.0 instead of crashing.
        d = getattr(self._agent(side), "diag", None)
        return d().get(key, 0.0) if d else 0.0

    def _diag(self, side):
        d = getattr(self._agent(side), "diag", None)
        return d() if d else None

    def _ret_std(self):
        """Std of recent per-episode returns per side (MC is noisier than TD)."""
        out = {}
        for s in ("red", "blue"):
            h = list(self.ret_hist[s])
            if len(h) > 1:
                m = sum(h) / len(h)
                out[s] = round((sum((x - m) ** 2 for x in h) / len(h)) ** 0.5, 3)
            else:
                out[s] = 0.0
        return out

    def _recent_outcome(self):
        ro = list(self.recent_out)
        n = len(ro) or 1
        return {k: round(ro.count(k) / n, 3) for k in ("red", "blue", "draw", "timeout")}

    # The continuous arena's 9 thrust actions (see continuous.DIRS): 8 compass
    # directions + coast. Shown as real directions, never bare 0..8 indices.
    _ARENA_LABELS = ["N", "S", "W", "E", "NW", "NE", "SW", "SE", "Stay"]
    _ARENA_LABELS_FULL = ["North", "South", "West", "East", "North-West",
                          "North-East", "South-West", "South-East", "Stay (coast)"]

    def _action_labels(self, full=False):
        if self.env.n_actions == 9 and getattr(self.env, "objective", "") == "arena":
            return self._ARENA_LABELS_FULL if full else self._ARENA_LABELS
        if self.env.n_actions == 5:     # Round 3: the 4 moves + a STAY (wait out a Goomba)
            return (["North", "South", "West", "East", "Wait"] if full
                    else ["N", "S", "W", "E", "Wait"])
        if self.env.n_actions != 4:
            return [str(i) for i in range(self.env.n_actions)]
        # Peach's camera views the board from the opposite side. Keep the learner's
        # stable action indices, but expose directions as the player sees them:
        # row -1 is screen-down, row +1 screen-up, col -1 right, col +1 left.
        if self.round_id == 1:
            return ["South", "North", "East", "West"] if full else ["S", "N", "E", "W"]
        return ["North", "South", "West", "East"] if full else ["N", "S", "W", "E"]

    def action_dist(self):
        """Normalized action-frequency histogram per side (is the policy balanced?)."""
        out = {"nActions": self.env.n_actions, "labels": self._action_labels()}
        for side in ("red", "blue"):
            c = self.act_counts[side]
            tot = sum(c) or 1
            out[side] = [round(x / tot, 4) for x in c]
        return out

    def policy_grid(self, agent):
        """Per-cell GREEDY action (argmax_a Q) for the policy-arrow overlay."""
        with self.lock:
            if self.env.objective == "arena":
                return self._blank_grid(agent, mode="policy")
            a = self._agent(agent)
            grid = [[None] * self.env.W for _ in range(self.env.H)]
            for (r, c), idx in self.env.cell_index.items():
                state = self.env.full_state(agent, (r, c))
                if a.state_value(state) is None:
                    continue
                q = a.q_values(state)
                # mask to EFFECTIVE actions at this cell so the arrow matches what the
                # agent would actually do (never an arrow pointing into a wall)
                m = self.env.effective_actions(agent, (r, c))
                valid = [i for i in range(len(q)) if m[i]] or list(range(len(q)))
                grid[r][c] = _unique_argmax(q, valid)
            # while this agent is GHOSTING, also expose its phase-direction on each
            # interior WALL cell (its through-wall plan) - rendered as raised arrows;
            # empty otherwise, so the arrows show only during the power-up.
            ghost = []
            if getattr(self.env, "rich", False) and self.env.status.get(agent, 0) > 0:
                ghost = self._ghost_wall_arrows(agent)
            return {"agent": agent, "grid": grid, "H": self.env.H, "W": self.env.W,
                    "mode": "policy", "ghostArrows": ghost}

    def _ghost_wall_arrows(self, agent):
        """The greedy phase-direction (N/S/W/E) on each interior WALL cell for the
        agent's CURRENT ghost state - i.e. which way it would keep phasing from there."""
        a = self._agent(agent)
        pos_cells = getattr(self.env, "pos_cells", None)
        if not pos_cells:
            return []
        out = []
        for cell in pos_cells[self.env.n_cells:]:      # the appended interior-wall cells
            state = self.env.full_state(agent, cell)
            if a.state_value(state) is None:
                continue
            q = a.q_values(state)
            m = self.env.effective_actions(agent, cell)
            valid = [i for i in range(len(q)) if m[i]] or list(range(len(q)))
            best = _unique_argmax(q, valid)
            if best is not None:
                out.append([cell[0], cell[1], int(best)])
        return out

    def visit_stats(self, agent):
        """Board coverage / unique cells / visitation entropy (exploration breadth)."""
        with self.lock:
            if self.env.objective == "arena":
                vis = self.arena_visits.get(agent, self.arena_visits["blue"])
                n = len(vis)
                shape = getattr(self.env, "shape", "square")
                counts = []
                for j, row in enumerate(vis):
                    for i, value in enumerate(row):
                        if shape == "circle" and math.hypot(
                                i + 0.5 - n / 2, j + 0.5 - n / 2) > n / 2:
                            continue
                        counts.append(value)
                total = sum(counts) or 1
                uniq = sum(1 for value in counts if value > 0)
                ent = -sum((value / total) * math.log2(value / total)
                           for value in counts if value > 0)
                return {
                    "agent": agent,
                    "coverage": round(uniq / len(counts), 3) if counts else 0.0,
                    "unique": uniq,
                    "entropy": round(ent, 3),
                    "maxVisits": max(counts) if counts else 0,
                    "floor": len(counts),
                }
            vis = self.red_visits if agent == "red" else self.blue_visits
            floor = list(self.env.floor_cells)
            counts = [vis[r][c] for (r, c) in floor]
            total = sum(counts) or 1
            uniq = sum(1 for x in counts if x > 0)
            ent = -sum((x / total) * math.log2(x / total) for x in counts if x > 0)
            return {"agent": agent, "coverage": round(uniq / len(floor), 3) if floor else 0.0,
                    "unique": uniq, "entropy": round(ent, 3),
                    "maxVisits": max(counts) if counts else 0, "floor": len(floor)}

    def _blank_grid(self, agent, mode=None):
        """Empty H x W grid - the arena round has no cells, so the grid overlays
        render nothing (the value-surface viz is added with the frontend)."""
        g = [[None] * self.env.W for _ in range(self.env.H)]
        out = {"agent": agent, "grid": g, "H": self.env.H, "W": self.env.W}
        if mode:
            out["mode"] = mode
        return out

    def value_grid(self, agent):
        """V(s) per tile, holding the agent's CURRENT non-position context fixed.
        Uses the agent's ``state_value`` so it works for both tabular Q-tables
        (None where unvisited) and DP planners (the solved value field)."""
        with self.lock:
            if self.env.objective == "arena":
                return self._blank_grid(agent)
            a = self._agent(agent)
            grid = [[None] * self.env.W for _ in range(self.env.H)]
            for (r, c), idx in self.env.cell_index.items():
                state = self.env.full_state(agent, (r, c))
                if a.state_value(state) is None:
                    continue
                q = a.q_values(state)
                mask = self.env.effective_actions(agent, (r, c))
                valid = [i for i in range(len(q)) if mask[i]] or list(range(len(q)))
                grid[r][c] = round(max(q[i] for i in valid), 4)
            return {"agent": agent, "grid": grid, "H": self.env.H, "W": self.env.W}

    def arena_field(self, agent, n=22, mode="value"):
        """Value + greedy-action field for the CONTINUOUS arenas: sample the agent's
        Q over an n x n grid of still (x,z) probes. Grid rounds return unavailable
        (they use value_grid). This is what makes R4/R5 not a black box."""
        with self.lock:
            env = self.env
            if env.objective != "arena" or not hasattr(env, "field_obs"):
                return {"available": False}
            a = self._agent(agent)
            if not hasattr(a, "diag"):     # only the DQN family exposes a Q field here
                return {"available": False}
            wj = env.to_json()
            A = float(wj.get("arena", 20.0))
            shape = wj.get("shape", "square")
            if mode == "visits":
                visits = self.arena_visits.get(agent, self.arena_visits["blue"])
                vmax = max((max(row) for row in visits), default=0)
                values = []
                vn = len(visits)
                for j, row in enumerate(visits):
                    out = []
                    for i, v in enumerate(row):
                        x = (i + 0.5) / vn * A
                        z = (j + 0.5) / vn * A
                        outside = shape == "circle" and math.hypot(x - A / 2, z - A / 2) > A / 2
                        out.append(None if outside else v)
                    values.append(out)
                return {
                    "available": True, "agent": agent, "mode": "visits",
                    "n": vn, "arena": A, "shape": shape,
                    "sceneCenter": wj.get("sceneCenter"),
                    "sceneScale": wj.get("sceneScale", 1.0),
                    "value": values, "vmin": 0, "vmax": vmax or 1,
                }
            solids = list(wj.get("obstacles", []) or [])   # solid circles (skip inside)
            vals, pols = [], []
            vmin, vmax = float("inf"), float("-inf")
            for j in range(n):
                vr, pr = [], []
                for i in range(n):
                    x = (i + 0.5) / n * A
                    z = (j + 0.5) / n * A
                    outside = shape == "circle" and math.hypot(x - A / 2, z - A / 2) > A / 2
                    blocked = any((x - c[0]) ** 2 + (z - c[1]) ** 2 < (c[2] + 0.2) ** 2 for c in solids)
                    if outside or blocked:
                        vr.append(None)
                        pr.append(None)
                        continue
                    q = a.q_values(env.field_obs(agent, x, z))
                    v = max(q)
                    vmin = min(vmin, v)
                    vmax = max(vmax, v)
                    vr.append(round(v, 3))
                    pr.append(int(max(range(len(q)), key=lambda k: q[k])))
                vals.append(vr)
                pols.append(pr)
            return {"available": True, "agent": agent, "mode": mode,
                    "n": n, "arena": A, "shape": shape,
                    "sceneCenter": wj.get("sceneCenter"),
                    "sceneScale": wj.get("sceneScale", 1.0),
                    "value": vals, "policy": pols,
                    "vmin": round(vmin, 3) if vmin < float("inf") else 0.0,
                    "vmax": round(vmax, 3) if vmax > float("-inf") else 1.0,
                    "goal": wj.get("goal"), "goalR": wj.get("goalR"), "obstacles": solids}

    def va_probe(self, agent):
        """Dueling-DQN V(s) / A(s,a) split at the agent's CURRENT position (Tier 3).
        Unavailable for plain nets / tabular / DP (only Dueling exposes the split)."""
        with self.lock:
            env = self.env
            a = self._agent(agent)
            va = getattr(a, "value_advantage", None)
            if env.objective != "arena" or va is None or not hasattr(env, "field_obs"):
                return {"available": False}
            pos = env.blue_pos if agent == "blue" else env.red_pos
            out = va(env.field_obs(agent, float(pos[0]), float(pos[1])))
            if out is None:
                return {"available": False}
            return {"available": True, "agent": agent, "v": out["v"], "a": out["a"]}

    def reward_decomp(self):
        """Average per-episode reward decomposition (terminal / bonuses / other)
        per side over recent episodes. Grid rounds only (arena envs don't track it)."""
        with self.lock:
            h = list(self.reward_parts_hist)
            if not h:
                return {"available": False}
            if getattr(self.env, "star_mode", False):
                shape_label = "Tomato rewards"
            elif getattr(self.env, "rich", False):
                shape_label = "Collectible rewards"
            else:
                shape_label = "Bonuses"
            out = {
                "available": True,
                "episodes": len(h),
                "shapeLabel": shape_label,
            }
            for side in ("red", "blue"):
                out[side] = {k: round(sum(p[side][k] for p in h) / len(h), 3)
                             for k in ("terminal", "shape", "other")}
            return out

    def _record_probe(self):
        """V(spawn) for each side this episode - shows the start-state value rising
        as the agent learns a path to the goal. Grid rounds only (no lock: called
        from tick, which already holds it)."""
        if self.env.objective == "arena":
            return
        ci = getattr(self.env, "cell_index", None)
        world = getattr(self.env, "world", None)
        if ci is None or world is None:
            return
        pt = {"ep": self.episode}
        for side in ("red", "blue"):
            spawn = tuple(
                world.red_spawn if side == "red" else world.blue_spawn
            )
            if spawn not in ci:
                continue
            idx = ci[spawn]
            # Probe each model at ITS OWN mirrored spawn in the canonical slice
            # (no collectibles, normal status).
            if getattr(self.env, "rich", False):
                state = (idx, 0, 0)
            elif getattr(self.env, "star_mode", False):
                state = (idx, 0)
            else:
                state = (idx,)
            a = self._agent(side)
            known = a.state_value(state)
            if known is None:
                v = None
            else:
                q = a.q_values(state)
                mask = self.env.effective_actions(
                    side, spawn,
                    star_mask=0 if getattr(self.env, "star_mode", False) else None,
                )
                valid = [i for i in range(len(q)) if mask[i]] or list(range(len(q)))
                v = max(q[i] for i in valid)
            pt[side + "V"] = round(v, 4) if v is not None else 0.0
        self.q_probe.append(pt)

    def q_probe_series(self):
        with self.lock:
            return {"available": bool(self.q_probe), "points": list(self.q_probe)}

    def policy_agreement(self):
        """Fraction of comparable learned cells where the two greedy policies agree.

        Symmetric race boards compare Red at (r,c) with Blue at its reflected tile,
        including the West/East action reflection. Comparing raw coordinates made
        mirror-correct Arena-2 policies look unrelated.
        """
        with self.lock:
            if self.env.objective == "arena":
                return {"available": False}
            rg = self.policy_grid("red")["grid"]
            bg = self.policy_grid("blue")["grid"]
            world = getattr(self.env, "world", None)
            mirrored = bool(
                world
                and tuple(world.red_spawn)
                == (world.blue_spawn[0], self.env.W - 1 - world.blue_spawn[1])
            )
            mirror_action = {0: 0, 1: 1, 2: 3, 3: 2}
            cells = same = 0
            for r in range(len(rg)):
                for c in range(len(rg[r])):
                    bc = self.env.W - 1 - c if mirrored else c
                    ra, ba = rg[r][c], bg[r][bc]
                    if ra is None or ba is None:
                        continue
                    cells += 1
                    same += (
                        ra == mirror_action.get(ba, ba) if mirrored else ra == ba
                    )
            if not cells:
                return {"available": False}
            return {"available": True, "cells": cells, "agree": same,
                    "rate": round(same / cells, 3), "mirrored": mirrored}

    def visit_grid(self, agent):
        """Per-cell visit counts for the agent (the 'where do they travel' heatmap).
        Floor cells carry their count (0 if never stepped on); walls stay None."""
        with self.lock:
            if self.env.objective == "arena":
                return self._blank_grid(agent, mode="visits")
            vis = self.red_visits if agent == "red" else self.blue_visits
            grid = [[None] * self.env.W for _ in range(self.env.H)]
            for (r, c) in self.env.floor_cells:
                grid[r][c] = vis[r][c]
            return {"agent": agent, "grid": grid, "H": self.env.H, "W": self.env.W, "mode": "visits"}

    def q_grid(self, agent):
        """Per-action Q for EVERY tile (the 'numbers on tiles' value overlay), in the
        agent's current context: [qN, qS, qW, qE], or None on walls / unlearned
        cells. Action order matches env.ACTIONS (North, South, West, East)."""
        with self.lock:
            if self.env.objective == "arena":
                return self._blank_grid(agent, mode="q")
            a = self._agent(agent)
            grid = [[None] * self.env.W for _ in range(self.env.H)]
            best = [[None] * self.env.W for _ in range(self.env.H)]
            for (r, c), idx in self.env.cell_index.items():
                state = self.env.full_state(agent, (r, c))
                if a.state_value(state) is None:        # leave unlearned tiles blank
                    continue
                q = a.q_values(state)
                grid[r][c] = [round(x, 2) for x in q]
                # highlight the action the agent WOULD take (argmax over EFFECTIVE
                # actions), not the raw argmax - so the value-numbers overlay agrees with
                # the policy arrows + tile inspector + the agent's actual masked behavior
                m = self.env.effective_actions(agent, (r, c))
                valid = [i for i in range(len(q)) if m[i]] or list(range(len(q)))
                best[r][c] = _unique_argmax(q, valid)
            return {"agent": agent, "grid": grid, "best": best,
                    "H": self.env.H, "W": self.env.W, "mode": "q"}

    def q_at(self, agent, r, c):
        """Per-action Q for one tile in the current context (the Q inspector)."""
        with self.lock:
            if self.env.objective == "arena":
                return None
            a = self._agent(agent)
            if (r, c) not in self.env.cell_index:
                return None
            state = self.env.full_state(agent, (r, c))
            q = a.q_values(state)
            # `best` = the action the agent would ACTUALLY take here (argmax over the
            # EFFECTIVE actions), and `mask` flags which are blocked - so the inspector
            # can star the real choice, not a higher-Q move that walks into a wall.
            m = self.env.effective_actions(agent, (r, c))
            valid = [i for i in range(len(q)) if m[i]] or list(range(len(q)))
            best = _unique_argmax(q, valid)
            ties = [
                i for i in valid
                if q[i] == max(q[j] for j in valid)
            ]
            return {"agent": agent, "cell": [r, c], "q": q, "best": best,
                    "ties": ties,
                    "mask": m, "labels": self._action_labels(full=True)}
