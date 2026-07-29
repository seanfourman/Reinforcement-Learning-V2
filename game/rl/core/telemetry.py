"""Aggregate live telemetry (a Match mixin): the stats/snapshot feed the
browser polls ~30x a second, the learning-curve history, the DP convergence
reports, and the per-side training diagnostics.
"""

import copy

from core import registry
from core.registry import is_dp


class TelemetryMixin:
    """The polled stats/snapshot payloads + diagnostics helpers."""

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
                "roundResults": [self.round_results.get(i) for i in range(len(registry.ROUNDS))],
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
        # Round 5 CTF adds a 10th "use the held weapon" action after the 9 thrusts.
        if self.env.n_actions == 10 and getattr(self.env, "objective", "") == "arena":
            base = list(self._ARENA_LABELS_FULL if full else self._ARENA_LABELS)
            base.append("Use weapon" if full else "Use")
            return base
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
