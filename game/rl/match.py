"""The live tournament - env + two learning/planning agents, driven one step at
a time, across a sequence of themed rounds.

A background thread (in ``serve.py``) calls ``tick()`` repeatedly; the viewer
reads ``snapshot()`` / ``value_grid()`` / ``history()`` / ``replay()``
concurrently, so every state mutation and read is guarded by one lock. Controls
(switch round, set a side's algorithm, regenerate, reset, epsilon schedule) are
serialized through it too.

Each round is a head-to-head between two (possibly different) algorithms - e.g.
Round 1 is Value-Iteration (Red) vs Policy-Iteration (Blue). A round is *won* by
whichever side leads its recent contest when you advance; round wins accumulate
into the tournament ``score`` shown in the HUD.
"""

import threading
from collections import deque

from env import GridWorld, N_ACTIONS
from agents import make_agent, ALGORITHMS
from dp import is_dp, make_dp
import worlds

FRAME_CAP = 800            # max frames recorded for one replayable episode
HISTORY_CAP = 4000         # max learning-curve points kept per round

# Red (the CPU) is NOT tunable from the panel; its strength comes from the chosen
# CPU character's tier (1 = easiest .. 5 = hardest). A higher tier means a higher
# learning rate and a faster, greedier epsilon schedule, so Red learns a stronger
# policy. This shapes the TD/MC learning rounds; DP rounds plan optimally regardless.
RED_GAMMA = 0.98


def red_params(tier):
    """Map a CPU tier (1..5) to Red's learning-rate + epsilon schedule."""
    t = max(1, min(5, int(tier)))
    f = (t - 1) / 4.0                          # 0 .. 1
    lerp = lambda a, b: a + (b - a) * f        # noqa: E731
    return {
        "alpha": round(lerp(0.10, 0.35), 3),   # higher tier -> learns faster
        "eps_start": round(lerp(1.00, 0.70), 3),
        "eps_end": round(lerp(0.30, 0.02), 3), # higher tier -> ends much greedier (stronger)
        "eps_episodes": int(lerp(6000, 800)),  # higher tier -> decays sooner
    }


class Match:
    def __init__(self, seed=None, round_id=1):
        self.lock = threading.RLock()
        self.seed = seed
        self.round_id = round_id
        self.env = GridWorld(seed, round_id=round_id)
        self.world_version = 1
        self.score = {"red": 0, "blue": 0}     # cumulative tournament round-wins
        # tunable hyperparameters for OUR model, Blue (driven from the M panel).
        # Red (CPU) always trains on the fixed RED_* defaults above.
        self.alpha = 0.2                       # Blue learning rate (TD/MC)
        self.gamma = 0.98                      # Blue discount factor (TD/MC)
        # Blue epsilon schedule: linear eps_start -> eps_end over eps_episodes, then hold
        self.eps_start, self.eps_end, self.eps_episodes = 1.0, 0.05, 3000
        self.target_episodes = None            # auto-pause after N episodes (None = run forever)
        self.red_tier = 1                      # CPU difficulty, set from the chosen character
        self._red_from_tier()                  # derive Red's params from the tier
        self.algo_red, self.algo_blue = worlds.round_algos(round_id)
        self._build_agents()
        self._reset_stats()
        self._new_episode()

    # ------------------------------------------------------------------ setup
    def _make_one(self, algo, color, seed, alpha, gamma):
        if is_dp(algo):
            return make_dp(algo, self.env, color, gamma=gamma)
        return make_agent(algo, n_actions=N_ACTIONS, seed=seed, alpha=alpha, gamma=gamma)

    def _red_from_tier(self):
        """(Re)derive Red's params from its tier. Manual overrides via set_red_params
        replace these until the tier (chosen character) changes again."""
        rp = red_params(self.red_tier)
        self.red_alpha = rp["alpha"]
        self.red_gamma = RED_GAMMA
        self.red_eps_start = rp["eps_start"]
        self.red_eps_end = rp["eps_end"]
        self.red_eps_episodes = rp["eps_episodes"]
        self.red_epsilon = rp["eps_start"]

    def _build_agents(self):
        # Red = CPU (params from its tier, or a manual override); Blue = ours, panel-tunable
        self.red = self._make_one(self.algo_red, "red", seed=1,
                                  alpha=self.red_alpha, gamma=self.red_gamma)
        self.blue = self._make_one(self.algo_blue, "blue", seed=2,
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

    def _new_episode(self):
        self._apply_epsilon()
        (self.s_red, self.s_blue), _ = self.env.reset()
        self.a_red = self.red.policy_action(self.s_red)
        self.a_blue = self.blue.policy_action(self.s_blue)
        self.ep_return = {"red": 0.0, "blue": 0.0}
        self._frames = []

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
            na_red = self.red.policy_action(ns_red) if not done else 0
            na_blue = self.blue.policy_action(ns_blue) if not done else 0

            self.red.learn_step(self.s_red, self.a_red, reward["red"], ns_red, na_red, done)
            self.blue.learn_step(self.s_blue, self.a_blue, reward["blue"], ns_blue, na_blue, done)

            self.ep_return["red"] += reward["red"]
            self.ep_return["blue"] += reward["blue"]
            self.total_steps += 1
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
                self.ep_lengths.append(self.env.steps)
                self.last_return = dict(self.ep_return)
                self.episode += 1
                self._finish_episode(w)
                self._new_episode()
            return done

    def _finish_episode(self, winner):
        """Snapshot the finished episode for replay + log a learning-curve point."""
        self.last_episode = {"winner": winner, "steps": self.env.steps,
                             "frames": self._frames}
        if winner in ("red", "blue") and self.env.steps < self._best_len:
            self._best_len = self.env.steps
            self.best_episode = self.last_episode
        recent = list(self.recent)
        n = len(recent) or 1
        self.hist.append({
            "ep": self.episode,
            "steps": self.total_steps,
            "eps": round(self.epsilon, 3),
            "len": self.env.steps,
            "rateRed": round(recent.count("red") / n, 3),
            "rateBlue": round(recent.count("blue") / n, 3),
            "retRed": round(self.last_return["red"], 3),
            "retBlue": round(self.last_return["blue"], 3),
        })

    # --------------------------------------------------------------- controls
    def regenerate(self, seed=None):
        """Re-install the current round's world + wipe both models (what R does)."""
        with self.lock:
            self.env.reset(seed=seed, regenerate=True)
            self.world_version += 1
            self._build_agents()
            self._reset_stats()
            self._new_episode()

    def reset_models(self):
        """Wipe learning, KEEP the current world."""
        with self.lock:
            self._build_agents()
            self._reset_stats()
            self._new_episode()

    def set_params(self, p):
        """Update tunable hyperparameters live from the panel. They apply to OUR
        model (Blue): alpha and the epsilon schedule to the TD/MC learners, the
        discount gamma to the learners AND to the DP planners (which re-solve), and
        the step cap / episode target take effect immediately."""
        with self.lock:
            old_gamma = self.gamma
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
            if "maxSteps" in p:
                self.env.max_steps = max(10, int(p["maxSteps"]))
            if "targetEpisodes" in p:
                t = int(p["targetEpisodes"])
                self.target_episodes = t if t > 0 else None
            # push learning-rate / discount onto OUR live agent (Blue) only
            if hasattr(self.blue, "alpha"):
                self.blue.alpha = self.alpha
            if hasattr(self.blue, "gamma"):
                self.blue.gamma = self.gamma
            # a DP planner must RE-SOLVE its plan to reflect a new discount
            if self.gamma != old_gamma and is_dp(self.algo_blue) and hasattr(self.blue, "plan"):
                self.blue.plan()
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
            if self.red_gamma != old_gamma and is_dp(self.algo_red) and hasattr(self.red, "plan"):
                self.red.plan()
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

    def set_cpu_tier(self, tier):
        """Set the CPU (Red) difficulty from the chosen character's tier (1..5).
        Rebuilds Red at the new strength and restarts the contest fresh. No-op if
        the tier is unchanged, so the frontend can send it freely on game start."""
        with self.lock:
            t = max(1, min(5, int(tier)))
            if t == self.red_tier:
                return
            self.red_tier = t
            self._red_from_tier()              # a new opponent resets any manual override
            self._build_agents()
            self._reset_stats()
            self._new_episode()

    def set_side_algo(self, side, algo):
        with self.lock:
            valid = algo in ALGORITHMS or is_dp(algo)
            if not valid:
                return
            if side == "red":
                self.algo_red = algo
            elif side == "blue":
                self.algo_blue = algo
            self._build_agents()
            self._reset_stats()
            self._new_episode()

    def set_round(self, round_id, keep_score=True):
        """Switch to a round: install its world + its default matchup + reset
        learning. Tournament score is preserved unless told otherwise."""
        with self.lock:
            self.round_id = round_id
            self.env.set_round(round_id)
            self.world_version += 1
            self.algo_red, self.algo_blue = worlds.round_algos(round_id)
            if not keep_score:
                self.score = {"red": 0, "blue": 0}
            self._build_agents()
            self._reset_stats()
            self._new_episode()

    def next_round(self):
        """Finalize the current round into the tournament score (leader of the
        recent contest wins the round), then advance to the next round (wraps)."""
        with self.lock:
            recent = list(self.recent)
            r, b = recent.count("red"), recent.count("blue")
            if r > b:
                self.score["red"] += 1
            elif b > r:
                self.score["blue"] += 1
            order = worlds.ROUNDS
            i = order.index(self.round_id) if self.round_id in order else 0
            self.set_round(order[(i + 1) % len(order)], keep_score=True)

    # ------------------------------------------------------------- inspection
    def _matchup(self):
        m = worlds.round_meta(self.round_id)
        return m

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
                "algoRed": self.algo_red, "algoBlue": self.algo_blue,
                "episode": self.episode,
                "totalSteps": self.total_steps,
                "epsilon": round(self.epsilon, 3),
                "wins": dict(self.wins),
                "recentRate": {k: round(v, 3) for k, v in rate.items()},
                "avgEpisodeLen": round(avg_len, 1),
                "lastReturn": {k: round(v, 3) for k, v in self.last_return.items()},
                "qStates": {"red": self.red.learned_count(),
                            "blue": self.blue.learned_count()},
                "params": self.params(),
                "redParams": self.red_view(),
                "redEpsilon": round(self.red_epsilon, 3),
                "targetEpisodes": self.target_episodes or 0,
                "cpuTier": self.red_tier,
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
                out["world"] = self.env.world.to_json()
            return out

    def history(self):
        with self.lock:
            return {"round": self.round_id, "points": list(self.hist)}

    def replay(self, which="last"):
        with self.lock:
            ep = self.best_episode if which == "best" else self.last_episode
            if not ep:
                return {"available": False}
            return {"available": True, "which": which, "winner": ep["winner"],
                    "steps": ep["steps"], "frames": ep["frames"]}

    def _agent(self, agent):
        return self.red if agent == "red" else self.blue

    def value_grid(self, agent):
        """V(s) per tile, holding the agent's CURRENT non-position context fixed.
        Uses the agent's ``state_value`` so it works for both tabular Q-tables
        (None where unvisited) and DP planners (the solved value field)."""
        with self.lock:
            a = self._agent(agent)
            _, own_key, gold_loc, opp_region, opp_adj, trap = self.env.observe(agent)
            grid = [[None] * self.env.W for _ in range(self.env.H)]
            for (r, c), idx in self.env.cell_index.items():
                state = (idx, own_key, gold_loc, opp_region, opp_adj, trap)
                v = a.state_value(state)
                grid[r][c] = round(v, 4) if v is not None else None
            return {"agent": agent, "grid": grid, "H": self.env.H, "W": self.env.W}

    def q_at(self, agent, r, c):
        """Per-action Q for one tile in the current context (the Q inspector)."""
        with self.lock:
            a = self._agent(agent)
            if (r, c) not in self.env.cell_index:
                return None
            _, own_key, gold_loc, opp_region, opp_adj, trap = self.env.observe(agent)
            state = (self.env.cell_index[(r, c)], own_key, gold_loc, opp_region, opp_adj, trap)
            return {"agent": agent, "cell": [r, c], "q": a.q_values(state)}
