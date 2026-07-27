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
import threading
from collections import deque

from env import (GridWorld, N_ACTIONS,
                 COIN_REWARD, BLOCK_REWARD, GHOST_LEN, FREEZE_LEN, SLIP_PROB)
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


def is_dqn(algo):
    return algo in DQN_ALGOS


def is_pg(algo):
    return algo in PG_ALGOS


def is_deep(algo):
    return is_dqn(algo) or is_pg(algo)

FRAME_CAP = 801            # max frames recorded for one replayable episode
                           # (800 steps + the seeded frame-0 spawn snapshot)
HISTORY_CAP = 4000         # max learning-curve points kept per round
TOP_N = 30                 # best replays kept PER MODEL (red/blue), fastest first

# Red (the CPU) is NOT tunable from the panel; its strength comes from the chosen
# CPU character's tier (1 = easiest .. 5 = hardest). A higher tier means a higher
# learning rate and a faster, greedier epsilon schedule, so Red learns a stronger
# policy. This shapes the TD/MC learning rounds; DP rounds plan optimally regardless.
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


def red_params(diff):
    """Map a CPU DIFFICULTY fraction (0 = easiest / Mario .. 1 = hardest / Parabones) to
    Red's learning-rate + epsilon schedule (+ DP plan speed). This is PER-CHARACTER (finer
    than the 1-5 display tier), so all 10 opponents scale to distinct, progressively better
    hyperparameters - the point being you need increasingly good play to beat them."""
    f = max(0.0, min(1.0, float(diff)))        # 0 .. 1
    lerp = lambda a, b: a + (b - a) * f        # noqa: E731
    return {
        "alpha": round(lerp(0.08, 0.40), 3),   # harder -> learns faster (TD/MC rounds)
        "eps_start": round(lerp(1.00, 0.60), 3),
        "eps_end": round(lerp(0.35, 0.01), 3), # harder -> ends much greedier (stronger)
        "eps_episodes": int(lerp(9000, 500)),  # harder -> decays sooner
        "plan_speed": round(lerp(0.15, 2.2), 3),  # DP (R1): harder converges much faster
    }


class Match:
    def __init__(self, seed=None, round_id=1):
        self.lock = threading.RLock()
        self.seed = seed
        self.round_id = round_id
        # ---- panel-driven GLOBAL config (apply to BOTH agents / the env) -------
        # These are structural: the algorithms' internals and the world dynamics,
        # as opposed to the per-side learning knobs (alpha/gamma/epsilon) below.
        self.train_seed = seed                 # reproducibility: seeds env rng + agents
        self.max_steps_override = None          # None -> each env's own default cap
        # DP planners (Round 1: Value/Policy Iteration)
        self.dp_theta = 1e-5                    # convergence threshold
        self.dp_max_sweeps = 2000               # hard iteration cap per phase
        self.dp_plan_speed = 0.6               # Blue's Bellman sweeps per tick (race knob)
        # DQN learners (continuous rounds 4-5)
        self.dqn_batch = 64
        self.dqn_buffer = 50_000                # replay capacity  (rebuild on change)
        self.dqn_warmup = 1_000                 # steps before learning starts
        self.dqn_target_sync = 500              # target-net copy interval
        self.dqn_hidden = 128                   # hidden width     (rebuild on change)
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
        self.target_episodes = None            # auto-pause after N episodes (None = run forever)
        self.red_tier = 1                      # CPU display tier (1-5), from the chosen character
        self.red_diff = 0.0                    # CPU difficulty 0..1 (per-character, finer)
        self._red_from_tier()                  # derive Red's params from the difficulty
        # per-round algorithm overrides from the menu selection (empty = the
        # ROUND_ALGOS defaults). cpu_algos = the chosen CPU character's algorithm per
        # round (Red); player_algos = the player's card pick per round (Blue). Applied
        # in set_round, and only if the algorithm fits the round's env kind.
        self.cpu_algos = {}
        self.player_algos = {}
        self.algo_red, self.algo_blue = self._round_matchup(round_id)
        self._build_agents()
        self._reset_stats()
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
        """Apply the step-cap override onto the current env, after any (re)build."""
        if self.max_steps_override is not None:
            self.env.max_steps = self.max_steps_override

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

    def _make_one(self, algo, color, seed, alpha, gamma):
        if is_dp(algo):
            speed = self.red_plan_speed if color == "red" else self.dp_plan_speed
            return make_dp(algo, self.env, color, gamma=gamma,
                           theta=self.dp_theta, max_sweeps=self.dp_max_sweeps,
                           plan_speed=speed)
        if is_dqn(algo):
            from dqn import make_dqn   # lazy: only the deep rounds need PyTorch
            return make_dqn(algo, obs_dim=self.env.obs_dim, n_actions=self.env.n_actions,
                            seed=seed, alpha=alpha, gamma=gamma,
                            buffer=self.dqn_buffer, batch=self.dqn_batch,
                            warmup=self.dqn_warmup, target_sync=self.dqn_target_sync,
                            hidden=self.dqn_hidden)
        if is_pg(algo):
            from pg import make_pg     # lazy: the policy-gradient round (R5) needs PyTorch
            return make_pg(algo, obs_dim=self.env.obs_dim, n_actions=self.env.n_actions,
                           seed=seed, alpha=alpha, gamma=gamma, hidden=self.dqn_hidden)
        return make_agent(algo, n_actions=self.env.n_actions, seed=seed, alpha=alpha, gamma=gamma)

    def _red_from_tier(self):
        """(Re)derive Red's params from its per-character DIFFICULTY. Manual overrides via
        set_red_params replace these until the character (difficulty) changes again."""
        rp = red_params(self.red_diff)
        self.red_alpha = rp["alpha"]
        self.red_gamma = RED_GAMMA
        self.red_eps_start = rp["eps_start"]
        self.red_eps_end = rp["eps_end"]
        self.red_eps_episodes = rp["eps_episodes"]
        self.red_epsilon = rp["eps_start"]
        self.red_plan_speed = rp["plan_speed"]    # DP (R1): Red's sweeps per tick

    def _build_agents(self):
        # Red = CPU (params from its tier, or a manual override); Blue = ours, panel-tunable.
        # The train seed offsets BOTH agents' seeds so a different seed gives a
        # genuinely different-but-reproducible run (layouts stay hand-designed).
        off = 0 if self.train_seed is None else int(self.train_seed) * 101
        self.red = self._make_one(self.algo_red, "red", seed=1 + off,
                                  alpha=self.red_alpha, gamma=self.red_gamma)
        self.blue = self._make_one(self.algo_blue, "blue", seed=2 + off,
                                   alpha=self.alpha, gamma=self.gamma)

    def _reset_stats(self):
        self.episode = 0
        self.total_steps = 0
        self.wins = {"red": 0, "blue": 0, "draw": 0}
        self.recent = deque(maxlen=200)      # recent winners, for a rolling rate
        self.ep_lengths = deque(maxlen=100)
        self.last_return = {"red": 0.0, "blue": 0.0}
        self.epsilon = self.eps_start
        self.hist = deque(maxlen=HISTORY_CAP)   # learning curve points
        self._frames = []                       # frames of the in-flight episode
        self.last_episode = None                # most recent finished episode
        self.best_episode = None                # shortest WINNING episode so far
        self._best_len = 10 ** 9
        # the TOP_N fastest WINNING episodes per model, for the replay browser
        self._top = {"red": [], "blue": []}
        # per-cell visit counts per side (the "where do they travel" heatmap)
        self.red_visits = [[0] * self.env.W for _ in range(self.env.H)]
        self.blue_visits = [[0] * self.env.W for _ in range(self.env.H)]
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
        fb = min(1.0, self.episode / self.eps_episodes)
        self.blue.set_epsilon(self.eps_start + (self.eps_end - self.eps_start) * fb)
        self.epsilon = self.blue.epsilon
        fr = min(1.0, self.episode / self.red_eps_episodes)
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
        (self.s_red, self.s_blue), _ = self.env.reset()
        self.a_red = self.red.policy_action(self.s_red, self._amask("red"))
        self.a_blue = self.blue.policy_action(self.s_blue, self._amask("blue"))
        self.ep_return = {"red": 0.0, "blue": 0.0}
        # frame 0 = the TRUE start (spawn positions, before any move). tick() records
        # snapshots AFTER stepping, so without this seed the replay began one move in
        # and agents appeared to start a square off their real spawn.
        self._frames = [self.env.snapshot()]

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
            na_red = self.red.policy_action(ns_red, nmask_red) if not done else 0
            na_blue = self.blue.policy_action(ns_blue, nmask_blue) if not done else 0

            # a max-steps TIMEOUT is truncation, not a true terminal: the next state is
            # not absorbing, so the value backup must still bootstrap through it. Only a
            # real win/lose/draw (done and not truncated) cuts the bootstrap.
            terminated = done and not truncated
            self.red.learn_step(self.s_red, self.a_red, reward["red"], ns_red, na_red,
                                terminated, nmask_red)
            self.blue.learn_step(self.s_blue, self.a_blue, reward["blue"], ns_blue, na_blue,
                                 terminated, nmask_blue)

            self.ep_return["red"] += reward["red"]
            self.ep_return["blue"] += reward["blue"]
            self.total_steps += 1
            if self.a_red < len(self.act_counts["red"]):
                self.act_counts["red"][self.a_red] += 1
            if self.a_blue < len(self.act_counts["blue"]):
                self.act_counts["blue"][self.a_blue] += 1
            if self.env.objective != "arena":   # arena positions are floats, not cells
                for pos, vis in ((self.env.red_pos, self.red_visits),
                                 (self.env.blue_pos, self.blue_visits)):
                    # count FLOOR cells only; a ghosting agent can sit on a wall cell,
                    # which the travel heatmap (floor-only) never reads (skip dead writes)
                    if pos in self.env.cell_index:
                        vis[pos[0]][pos[1]] += 1
            if len(self._frames) < FRAME_CAP:
                self._frames.append(self.env.snapshot())
            self.s_red, self.s_blue = ns_red, ns_blue
            self.a_red, self.a_blue = na_red, na_blue

            if done:
                self.red.end_episode()
                self.blue.end_episode()
                w = info["winner"] or "draw"
                self.wins[w] += 1
                self.recent.append(w)
                # a None winner is a genuine draw only if the episode ended naturally;
                # a max-steps cutoff (truncated) is a timeout, not a dead-heat
                out = info["winner"] if info["winner"] in ("red", "blue") else ("timeout" if truncated else "draw")
                self.outcomes[out] += 1
                self.recent_out.append(out)
                self.ep_lengths.append(self.env.steps)
                self.last_return = dict(self.ep_return)
                self.ret_hist["red"].append(self.ep_return["red"])
                self.ret_hist["blue"].append(self.ep_return["blue"])
                self.episode += 1
                self._finish_episode(w)
                self._new_episode()
            return done

    def _finish_episode(self, winner):
        """Snapshot the finished episode for replay + log a learning-curve point."""
        parts = getattr(self.env, "ep_parts", None)   # grid env's reward decomposition
        if parts is not None:
            self.reward_parts_hist.append({s: dict(parts[s]) for s in ("red", "blue")})
        self._record_probe()
        self.last_episode = {"winner": winner, "steps": self.env.steps,
                             "frames": self._frames}
        if winner in ("red", "blue") and self.env.steps < self._best_len:
            self._best_len = self.env.steps
            self.best_episode = self.last_episode
        if winner in ("red", "blue"):
            lst = self._top[winner]
            lst.append({"steps": self.env.steps, "episode": self.episode,
                        "winner": winner, "frames": self._frames})
            lst.sort(key=lambda e: e["steps"])   # fastest first
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
        """Re-install the current round's world + wipe both models (what R does)."""
        with self.lock:
            self.env.reset(seed=seed, regenerate=True)
            self.world_version += 1
            self._build_agents()
            self.finish_event = None
            self._reset_stats()
            self._new_episode()

    def reset_models(self):
        """Wipe learning, KEEP the current world."""
        with self.lock:
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
        Learning + dynamics apply instantly; structural changes restart the contest."""
        with self.lock:
            old_gamma = self.gamma
            need_env_rebuild = False   # scene layout moved (counts / seed)
            need_agent_rebuild = False  # network shape changed (buffer / width)
            replan = False              # DP planners must re-solve

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
                self.eps_episodes = max(1, int(p["epsEpisodes"]))
            if "targetEpisodes" in p:
                t = int(p["targetEpisodes"])
                self.target_episodes = t if t > 0 else None
            if "maxSteps" in p:
                self.max_steps_override = max(10, int(p["maxSteps"]))
                self.env.max_steps = self.max_steps_override

            # ---- GLOBAL: DP internals (both planners re-solve) ----
            if "dpTheta" in p:
                self.dp_theta = max(1e-9, min(1.0, float(p["dpTheta"])))
                replan = True
            if "dpMaxIters" in p:
                self.dp_max_sweeps = max(1, min(100_000, int(p["dpMaxIters"])))
                replan = True

            # ---- GLOBAL: DP planning speed (Bellman sweeps per tick, the race knob) ----
            if "dpPlanning" in p:
                self.dp_plan_speed = max(0.0, min(10.0, float(p["dpPlanning"])))
                replan = True

            # ---- GLOBAL: DQN internals ----
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
            # live-settable DQN attrs on BOTH agents (buffer/width handled by rebuild)
            for ag in (self.red, self.blue):
                if hasattr(ag, "batch"):
                    ag.batch = self.dqn_batch
                if hasattr(ag, "warmup"):
                    ag.warmup = self.dqn_warmup
                if hasattr(ag, "target_sync"):
                    ag.target_sync = self.dqn_target_sync

            if need_env_rebuild:
                self._rebuild_world()
            elif need_agent_rebuild:
                self._apply_env_config()   # keep live env dynamics unchanged
                self._build_agents()
                self._reset_stats()
                self._new_episode()
            else:
                self._apply_env_config()
                # DP internals / discount changed -> RESTART the incremental plan so the
                # convergence race replays from scratch with the new settings
                if replan or (self.gamma != old_gamma and is_dp(self.algo_blue)):
                    for ag in (self.red, self.blue):
                        if hasattr(ag, "plan_speed"):     # a DP planner
                            ag.theta = self.dp_theta
                            ag.max_sweeps = self.dp_max_sweeps
                            ag.reset_learning()
                self._apply_epsilon()
            return self.params()

    def params(self):
        return {
            "alpha": round(self.alpha, 4),
            "gamma": round(self.gamma, 4),
            "epsStart": round(self.eps_start, 3),
            "epsEnd": round(self.eps_end, 3),
            "epsEpisodes": self.eps_episodes,
            "maxSteps": self.env.max_steps,
            "targetEpisodes": self.target_episodes or 0,
            # global algorithm internals
            "dpTheta": self.dp_theta,
            "dpMaxIters": self.dp_max_sweeps,
            "dpPlanning": self.dp_plan_speed,
            "dqnBatch": self.dqn_batch,
            "dqnBuffer": self.dqn_buffer,
            "dqnWarmup": self.dqn_warmup,
            "dqnTargetSync": self.dqn_target_sync,
            "dqnHidden": self.dqn_hidden,
            # reproducibility
            "trainSeed": self.train_seed if self.train_seed is not None else -1,
        }

    def set_red_params(self, p):
        """Manually override the CPU (Red) hyperparameters from the locked N panel.
        Mirrors set_params but targets Red; the shared step cap / episode target are
        NOT here (they go through set_params). Lasts until the tier changes."""
        with self.lock:
            old_gamma = self.red_gamma
            if "alpha" in p:
                self.red_alpha = max(0.0, min(1.0, float(p["alpha"])))
            if "gamma" in p:
                self.red_gamma = max(0.0, min(1.0, float(p["gamma"])))
            if "epsStart" in p:
                self.red_eps_start = max(0.0, min(1.0, float(p["epsStart"])))
            if "epsEnd" in p:
                self.red_eps_end = max(0.0, min(1.0, float(p["epsEnd"])))
            if "epsEpisodes" in p:
                self.red_eps_episodes = max(1, int(p["epsEpisodes"]))
            if hasattr(self.red, "alpha"):
                self.red.alpha = self.red_alpha
            if hasattr(self.red, "gamma"):
                self.red.gamma = self.red_gamma
            if self.red_gamma != old_gamma and is_dp(self.algo_red) and hasattr(self.red, "reset_learning"):
                self.red.reset_learning()   # restart Red's incremental plan on a new discount
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
            "epsEpisodes": self.red_eps_episodes,
            "maxSteps": self.env.max_steps,
            "targetEpisodes": self.target_episodes or 0,
        }

    def set_cpu_tier(self, tier, diff=None):
        """Set the CPU (Red) difficulty from the chosen character. ``tier`` (1..5) is the
        display tier; ``diff`` (0..1) is the finer PER-CHARACTER strength that actually
        drives the hyperparameters (defaults to the tier if not given). Rebuilds Red and
        restarts fresh; no-op if unchanged, so the frontend can send it freely on start."""
        with self.lock:
            t = max(1, min(5, int(tier)))
            d = ((t - 1) / 4.0) if diff is None else max(0.0, min(1.0, float(diff)))
            if t == self.red_tier and abs(d - self.red_diff) < 1e-6:
                return
            self.red_tier = t
            self.red_diff = d
            self._red_from_tier()              # a new opponent resets any manual override
            self._build_agents()
            self.finish_event = None
            self._reset_stats()
            self._new_episode()

    def set_side_algo(self, side, algo):
        with self.lock:
            valid = algo in ALGORITHMS or is_dp(algo) or is_deep(algo)
            if not valid:
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
        arena = getattr(self.env, "objective", "") == "arena"
        ok = is_deep(algo) if arena else (algo in ALGORITHMS or is_dp(algo))
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
            self.round_id = round_id
            self.env = self._make_env(round_id)   # rebuild: round may switch env class
            self._apply_env_config()              # carry dynamics/slip/step-cap across
            self.world_version += 1
            self.algo_red, self.algo_blue = self._round_matchup(round_id)
            if not keep_score:
                self.score = {"red": 0, "blue": 0}
                self.awarded_rounds.clear()
                self.round_results = {}
                self.last_award = None
            self.finish_event = None
            self._build_agents()
            self._reset_stats()
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
        m["matchup"] = f"{lr} vs {lb}"
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
        card. SKELETON: bare navigate/fly-to-goal, no hazards or shaping. Reward
        constants mirror env.py / continuous.py."""
        with self.lock:
            env = self.env
            arena = env.objective == "arena"
            meta = self._matchup()
            slip_prob = 0.0
            if not arena and getattr(env, "rich", False):
                # Round 1's real game: a stochastic maze with optional coins + "?" blocks
                actions = ["North", "South", "West", "East"]
                nbits = env._n_coins["blue"] + len(env.block_cells["blue"])
                # floor cells carry all statuses; interior wall cells (ghost-only) carry
                # just the positive ghost statuses (see dp._enumerate_states)
                n_floor = env.n_cells
                n_wall = len(getattr(env, "pos_cells", [])) - n_floor
                state_size = ((n_floor * (GHOST_LEN + FREEZE_LEN + 1) + n_wall * GHOST_LEN)
                              * (1 << nbits))
                state_desc = ("your tile, which of your own coins/blocks you have claimed, "
                              "and your power-up / frozen countdown")
                observation = ("Each model sees its own tile, its collected coins/blocks, and "
                               "any active ghost or freeze timer - the rival stays invisible, so "
                               "it still plans as a single agent.")
                sees_opp = False
                opp_info = ("Nothing. There is no opponent term in the state; each model owns a "
                            "mirror-image set of coins/blocks, so the race is fair but solo.")
                dynamics = ("Deterministic on dry tiles. On ICE a move slips sideways (70% "
                            "intended, 15% each perpendicular). A '?' block is a one-time 50/50 "
                            "gamble: Ghost (phase through walls one cell at a time, ~4 moves) or "
                            "Freeze (stuck for 3 turns).")
                rewards = [["Step", -0.01], ["Coin", round(COIN_REWARD, 2)],
                           ["? block -> Ghost", round(BLOCK_REWARD, 2)],
                           ["Win (reach the Power Moon)", 1.0], ["Lose", -1.0]]
                win = ("First to the Power Moon wins; coins are optional value on the way. A "
                       "simultaneous arrival is a draw.")
                slip_prob = SLIP_PROB
            elif not arena:
                # skeleton grid rounds: a bare navigate-to-goal ("cross") race
                actions = ["North", "South", "West", "East"]
                state_desc = "your tile only: the (row, column) cell index"
                state_size = getattr(env, "n_cells", None)
                observation = ("Each model sees ONLY its own tile. It learns as a single-agent "
                               "navigator: the maze is shared, but neither model perceives the other.")
                sees_opp = False
                opp_info = ("Nothing. There is no opponent term in the state, so the rival is "
                            "invisible to the agent.")
                dynamics = ("Moves are deterministic. Walls and the map edge block movement "
                            "(you stay put).")
                rewards = [["Step", -0.01], ["Win (reach the Power Moon)", 1.0], ["Lose", -1.0]]
                win = "First to reach the Power Moon wins; a simultaneous arrival is a draw."
            else:
                actions = ["8 compass thrusts + coast (9)"]
                state_size = None
                sees_opp = False
                state_desc = "continuous 6-vector: position, velocity, goal offset (all normalized)"
                observation = ("Its own position and velocity, and the vector to the goal - all "
                               "normalized to the arena size.")
                opp_info = ("Nothing. Each model flies its own copy of the physics; the opponent "
                            "is not part of the observation.")
                dynamics = ("Continuous physics: a thrust accelerates the flyer (with drag). Walls "
                            "clamp it back.")
                rewards = [["Step", -0.006], ["Win (reach goal)", 1.0], ["Lose", -1.0]]
                win = "First to reach the goal region wins; a tie is a draw."
            g, gr = self.gamma, self.red_gamma
            horizon = lambda x: (round(1.0 / (1.0 - x), 1) if x < 1 else None)
            return {
                "round": self.round_id, "title": meta["title"], "theme": meta["theme"],
                "objective": env.objective,
                "kind": "arena" if arena else env.objective,
                "matchup": meta["matchup"], "labelRed": meta["labelRed"], "labelBlue": meta["labelBlue"],
                "family": self._family(),
                "stateDesc": state_desc, "stateSize": state_size,
                "observation": observation, "seesOpponent": sees_opp, "opponentInfo": opp_info,
                "dynamics": dynamics,
                "actions": actions, "nActions": env.n_actions,
                "maxSteps": env.max_steps,
                "slipProb": slip_prob,
                "gammaRed": round(gr, 3), "gammaBlue": round(g, 3),
                "horizonBlue": horizon(g), "horizonRed": horizon(gr),
                "horizon": horizon(g),
                "winCondition": win,
                "rewards": rewards,
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

    def replay(self, which="last", agent=None, rank=0):
        with self.lock:
            if which == "top":
                lst = self._top.get(agent, [])
                if not (0 <= rank < len(lst)):
                    return {"available": False}
                ep = lst[rank]
                return {"available": True, "which": "top", "agent": agent,
                        "rank": rank, "winner": ep["winner"], "steps": ep["steps"],
                        "episode": ep["episode"], "frames": ep["frames"]}
            ep = self.best_episode if which == "best" else self.last_episode
            if not ep:
                return {"available": False}
            return {"available": True, "which": which, "winner": ep["winner"],
                    "steps": ep["steps"], "frames": ep["frames"]}

    def replays_index(self, agent):
        """Lightweight metadata (no frames) for the top-30 replay list per model."""
        with self.lock:
            lst = self._top.get(agent, [])
            return {"agent": agent, "count": len(lst),
                    "items": [{"rank": i, "steps": e["steps"], "episode": e["episode"]}
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
                    "policyChanges": list(getattr(a, "policy_changes", []) or []),
                    "sweeps": list(log)}

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
        d = getattr(self._agent(side), "diag", None)
        return d()[key] if d else 0.0

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

    def _action_labels(self):
        return ["N", "S", "W", "E"] if self.env.n_actions == 4 \
            else [str(i) for i in range(self.env.n_actions)]

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
                grid[r][c] = max(valid, key=lambda i: q[i])
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
            out.append([cell[0], cell[1], int(max(valid, key=lambda i: q[i]))])
        return out

    def visit_stats(self, agent):
        """Board coverage / unique cells / visitation entropy (exploration breadth)."""
        with self.lock:
            if self.env.objective == "arena":
                return {"agent": agent, "coverage": 0.0, "unique": 0,
                        "entropy": 0.0, "maxVisits": 0, "floor": 0}
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
                v = a.state_value(state)
                grid[r][c] = round(v, 4) if v is not None else None
            return {"agent": agent, "grid": grid, "H": self.env.H, "W": self.env.W}

    def arena_field(self, agent, n=22):
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
            solids = list(wj.get("obstacles", []) or [])   # solid circles (skip inside)
            vals, pols = [], []
            vmin, vmax = float("inf"), float("-inf")
            for j in range(n):
                vr, pr = [], []
                for i in range(n):
                    x = (i + 0.5) / n * A
                    z = (j + 0.5) / n * A
                    if any((x - c[0]) ** 2 + (z - c[1]) ** 2 < (c[2] + 0.2) ** 2 for c in solids):
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
            return {"available": True, "agent": agent, "n": n, "arena": A,
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
        """Average per-episode reward decomposition (terminal / shaping / other)
        per side over recent episodes. Grid rounds only (arena envs don't track it)."""
        with self.lock:
            h = list(self.reward_parts_hist)
            if not h:
                return {"available": False}
            out = {"available": True, "episodes": len(h)}
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
        sp = getattr(getattr(self.env, "world", None), "blue_spawn", None)
        if ci is None or sp is None or tuple(sp) not in ci:
            return
        idx = ci[tuple(sp)]
        # probe the spawn value in the CANONICAL slice (no coins, normal status) so the
        # "start-state value climbs as it learns a path" curve stays a clean scalar.
        state = (idx, 0, 0) if getattr(self.env, "rich", False) else (idx,)
        pt = {"ep": self.episode}
        for side in ("red", "blue"):
            a = self._agent(side)
            v = a.state_value(state)
            pt[side + "V"] = round(v, 4) if v is not None else 0.0
        self.q_probe.append(pt)

    def q_probe_series(self):
        with self.lock:
            return {"available": bool(self.q_probe), "points": list(self.q_probe)}

    def policy_agreement(self):
        """Fraction of learned cells where Red's and Blue's greedy actions match.
        NOTE: VI and PI converge to the SAME optimal policy only for the SAME MDP; on
        Round 1 Red and Blue own MIRRORED coin/block layouts, so their optimal policies
        legitimately DIFFER (this reads well below 100%, and that is not a convergence
        bug). Grid rounds only."""
        with self.lock:
            if self.env.objective == "arena":
                return {"available": False}
            rg = self.policy_grid("red")["grid"]
            bg = self.policy_grid("blue")["grid"]
            cells = same = 0
            for r in range(len(rg)):
                for c in range(len(rg[r])):
                    ra, ba = rg[r][c], bg[r][c]
                    if ra is None or ba is None:
                        continue
                    cells += 1
                    same += (ra == ba)
            if not cells:
                return {"available": False}
            return {"available": True, "cells": cells, "agree": same,
                    "rate": round(same / cells, 3)}

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
                best[r][c] = max(valid, key=lambda i: q[i])
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
            best = max(valid, key=lambda i: q[i])
            return {"agent": agent, "cell": [r, c], "q": q, "best": best, "mask": m}
