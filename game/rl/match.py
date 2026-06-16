"""The live self-play match — env + two learning agents, driven one step at a time.

A background thread (in server.py) calls ``tick()`` repeatedly; the viewer reads
``snapshot()`` / ``value_grid()`` concurrently, so every state mutation and every
read is guarded by one lock. Controls (regenerate world, reset models, switch
algorithm, set epsilon schedule) are also serialized through it.

Pressing R in the browser -> ``regenerate()``: a brand-new world AND both
Q-tables wiped, so the two models genuinely start untrained again.
"""

import threading
from collections import deque

from env import GridWorld, N_ACTIONS
from agents import make_agent, ALGORITHMS


class Match:
    def __init__(self, seed=None, algo="qlearning"):
        self.lock = threading.RLock()
        self.algo = algo if algo in ALGORITHMS else "qlearning"
        self.env = GridWorld(seed)
        self.world_version = 1
        # epsilon schedule (per world): linear 1.0 -> 0.05, then hold
        self.eps_start, self.eps_end, self.eps_episodes = 1.0, 0.05, 3000
        self._build_agents()
        self._reset_stats()
        self._new_episode()

    # ------------------------------------------------------------------ setup
    def _build_agents(self):
        self.red = make_agent(self.algo, n_actions=N_ACTIONS, seed=1)
        self.blue = make_agent(self.algo, n_actions=N_ACTIONS, seed=2)

    def _reset_stats(self):
        self.episode = 0
        self.total_steps = 0
        self.wins = {"red": 0, "blue": 0, "draw": 0}
        self.recent = deque(maxlen=200)      # recent winners, for a rolling rate
        self.ep_lengths = deque(maxlen=100)
        self.last_return = {"red": 0.0, "blue": 0.0}
        self.epsilon = self.eps_start

    def _apply_epsilon(self):
        frac = min(1.0, self.episode / self.eps_episodes)
        self.epsilon = self.eps_start + (self.eps_end - self.eps_start) * frac
        self.red.set_epsilon(self.epsilon)
        self.blue.set_epsilon(self.epsilon)

    def _new_episode(self):
        self._apply_epsilon()
        (self.s_red, self.s_blue), _ = self.env.reset()
        self.a_red = self.red.policy_action(self.s_red)
        self.a_blue = self.blue.policy_action(self.s_blue)
        self.ep_return = {"red": 0.0, "blue": 0.0}

    # ------------------------------------------------------------------- tick
    def tick(self):
        """Advance the simulation by one env step (and learn). Returns True if the
        episode ended on this step."""
        with self.lock:
            obs, reward, done, truncated, info = self.env.step(self.a_red, self.a_blue)
            ns_red, ns_blue = obs
            na_red = self.red.policy_action(ns_red) if not done else 0
            na_blue = self.blue.policy_action(ns_blue) if not done else 0

            self.red.learn_step(self.s_red, self.a_red, reward["red"], ns_red, na_red, done)
            self.blue.learn_step(self.s_blue, self.a_blue, reward["blue"], ns_blue, na_blue, done)

            self.ep_return["red"] += reward["red"]
            self.ep_return["blue"] += reward["blue"]
            self.total_steps += 1
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
                self._new_episode()
            return done

    # --------------------------------------------------------------- controls
    def regenerate(self, seed=None):
        """New world + both models wiped (what R does)."""
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

    def set_algorithm(self, algo):
        with self.lock:
            if algo in ALGORITHMS and algo != self.algo:
                self.algo = algo
                self.reset_models()

    # ------------------------------------------------------------- inspection
    def stats(self):
        with self.lock:
            recent = list(self.recent)
            decided = [w for w in recent if w != "draw"]
            rate = {
                "red": recent.count("red") / len(recent) if recent else 0.0,
                "blue": recent.count("blue") / len(recent) if recent else 0.0,
                "draw": recent.count("draw") / len(recent) if recent else 0.0,
            }
            avg_len = sum(self.ep_lengths) / len(self.ep_lengths) if self.ep_lengths else 0.0
            return {
                "algo": self.algo,
                "episode": self.episode,
                "totalSteps": self.total_steps,
                "epsilon": round(self.epsilon, 3),
                "wins": dict(self.wins),
                "recentRate": {k: round(v, 3) for k, v in rate.items()},
                "avgEpisodeLen": round(avg_len, 1),
                "lastReturn": {k: round(v, 3) for k, v in self.last_return.items()},
                "qStates": {"red": len(self.red.Q), "blue": len(self.blue.Q)},
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

    def value_grid(self, agent):
        """V(s) = max_a Q for each tile, holding the agent's CURRENT non-position
        context fixed (key/gold/opponent/trap). This is "what have I learned about
        standing on each tile, given the situation right now" — the heatmap."""
        with self.lock:
            a = self.red if agent == "red" else self.blue
            _, own_key, gold_loc, opp_region, opp_adj, trap = self.env.observe(agent)
            grid = [[None] * self.env.W for _ in range(self.env.H)]
            for (r, c), idx in self.env.cell_index.items():
                state = (idx, own_key, gold_loc, opp_region, opp_adj, trap)
                v = a.Q.get(state)
                grid[r][c] = round(max(v), 4) if v else None
            return {"agent": agent, "grid": grid, "H": self.env.H, "W": self.env.W}

    def q_at(self, agent, r, c):
        """Per-action Q for one tile in the current context (the Q inspector)."""
        with self.lock:
            a = self.red if agent == "red" else self.blue
            if (r, c) not in self.env.cell_index:
                return None
            _, own_key, gold_loc, opp_region, opp_adj, trap = self.env.observe(agent)
            state = (self.env.cell_index[(r, c)], own_key, gold_loc, opp_region, opp_adj, trap)
            return {"agent": agent, "cell": [r, c], "q": a.q_values(state)}
