"""Per-tile / per-cell model inspection (a Match mixin): everything that lets
the browser look INSIDE the two models - the V(s) heatmap, the per-action Q
overlay, the greedy-policy arrows, visit counts, the continuous arenas' sampled
value/policy field, the Dueling V/A probe, the reward decomposition, the
V(spawn) learning probe, and the policy-agreement comparison.
"""

import math



def _unique_argmax(values, valid=None):
    """Return the sole maximizing index, or None for a genuine policy tie."""
    choices = list(valid if valid is not None else range(len(values)))
    if not choices:
        choices = list(range(len(values)))
    best = max(values[i] for i in choices)
    tied = [i for i in choices if values[i] == best]
    return tied[0] if len(tied) == 1 else None


class InspectionMixin:
    """Value / policy / visit inspection endpoints."""

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
        """The greedy phase-direction (Up/Down/Left/Right) on each interior WALL cell for the
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
        including the Left/Right action reflection. Comparing raw coordinates made
        mirror-correct Arena-2 policies look unrelated.

        ``applicable`` separates "this round has no tile grid to compare" (the
        continuous arenas - the card is meaningless there and stays hidden) from
        "a grid round that has nothing comparable YET" (every tile still a policy
        tie, or a just-reset planner). The latter is a WARMING-UP state, so the
        card can stay put instead of popping in and out mid-run.
        """
        with self.lock:
            if self.env.objective == "arena":
                return {"available": False, "applicable": False}
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
                return {"available": False, "applicable": True, "cells": 0,
                        "agree": 0, "rate": 0.0, "mirrored": mirrored}
            return {"available": True, "applicable": True, "cells": cells,
                    "agree": same, "rate": round(same / cells, 3),
                    "mirrored": mirrored}

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
        cells. Action order matches env.ACTIONS (Up, Down, Left, Right)."""
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
