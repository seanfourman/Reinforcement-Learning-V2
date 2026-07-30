"""Replay + milestone capture and playback (a Match mixin).

Every in-flight episode is recorded frame by frame (``_replay_snapshot``); when
it finishes, the winning run may enter the per-model TOP list (ranked by the
round's objective: fastest / highest-reward / longest-survival), and the FIRST
occurrence of each notable event (first win, first goal, first death by each
hazard, first flag steal, ...) is banked as a MILESTONE replay. The browser's
replay browser reads ``replay`` / ``replays_index``.
"""

import copy

from core.inspection import _unique_argmax


FRAME_CAP = 10001          # record the WHOLE episode: R4 survival is bounded by the

                           # env's own 10,000-step ceiling, so this never truncates a
                           # replay. Memory scales with ACTUAL survival, not this cap.
HISTORY_CAP = 4000         # max learning-curve points kept per round

TOP_N = 30                 # best replays kept per model (fastest or longest by game)


class ReplayMixin:
    """Episode recording, top/milestone lists, and replay accessors."""

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
            # Rank the RACE "top" list by REWARD (highest return first) - the meaningful
            # quality signal - breaking ties with the FASTEST run; earlier it sorted only by
            # steps, so the many max-step (timeout) episodes tied and fell back to episode
            # order. The survival round keeps its own longest-first ordering.
            if survival:
                lst.sort(key=lambda e: e["steps"], reverse=True)
            else:
                lst.sort(key=lambda e: (e["stats"]["return"], -e["steps"]), reverse=True)
            del lst[TOP_N:]
        self._capture_milestones(race, replay_sides, side_steps, truncated)
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

    # cause string (from the recorded frame's <side>Dead) -> a human phrase
    _DEATH_PHRASE = {
        "plant": "eaten by a Piranha Plant",
        "spike": "impaled on a spike trap",
        "goomba": "caught by a Goomba",
    }

    def _capture_milestones(self, race, replay_sides, side_steps, truncated):
        """Save a one-off replay the FIRST time each notable event happens this round:
        first win, first time each model reaches the goal, and first death by each
        hazard. Append-only + first-occurrence, so an existing row's rank never moves."""
        names = {"red": "Red", "blue": "Blue"}
        events = []  # (key, label, agent, steps) - steps indexes into self._frames
        # first win (whoever reached the goal first)
        if race in ("red", "blue"):
            events.append((f"win_{race}", f"{names[race]}'s first win",
                           race, side_steps.get(race, self.env.steps)))
        # first time each side reaches the goal at all (even a 2nd-place finish). Only the
        # goal-race rounds have a goal: CTF captures a flag and R4 is a survival game (no
        # goal), so both rely on their own firsts (flag / heart / pickup) + the win above.
        if not getattr(self.env, "ctf_game", False) and not getattr(self.env, "missile_game", False):
            for side in replay_sides:
                events.append((f"goal_{side}", f"{names[side]} first reaches the goal",
                               side, side_steps.get(side, self.env.steps)))
        # first death by each hazard: scan the recorded frames for the death step + cause
        for side in ("red", "blue"):
            dk = side + "Dead"
            for i, fr in enumerate(self._frames):
                cause = fr.get(dk)
                if cause:
                    phrase = self._DEATH_PHRASE.get(cause, "killed by a hazard")
                    events.append((f"death_{cause}_{side}",
                                   f"{names[side]} first {phrase}", side, i))
                    break
        # Round-5 Capture-the-Flag weapon/flag firsts: scan the recorded ctfEvents for
        # the FIRST frame each notable thing happens (whoever did it becomes the replay
        # subject). Append-only per round via _milestone_keys, like the rows above.
        if getattr(self.env, "ctf_game", False):
            ctf_specs = [
                ("ctf_grab", "First flag grab",
                 lambda e: e.get("type") == "grab"),
                ("ctf_steal", "First flag steal (a tag)",
                 lambda e: e.get("type") == "steal"),
                ("ctf_capture", "First flag capture",
                 lambda e: e.get("type") == "capture"),
                ("ctf_chainhit", "First Chain Chomp reel-in",
                 lambda e: e.get("type") == "chainhit"),
                ("ctf_redshell", "First red-shell hit",
                 lambda e: e.get("type") == "shellhit" and e.get("kind") == "red"),
                ("ctf_greenshell", "First green-shell hit",
                 lambda e: e.get("type") == "shellhit" and e.get("kind") == "green"),
                ("ctf_banana", "First banana snare",
                 lambda e: e.get("type") == "traphit" and e.get("kind") == "banana"),
                ("ctf_oil", "First oil-slick spin-out",
                 lambda e: e.get("type") == "traphit" and e.get("kind") == "oil"),
                ("ctf_bomb", "First Bowser bomb blast",
                 lambda e: e.get("type") == "bombhit"),
            ]
            for key, label, pred in ctf_specs:
                for i, fr in enumerate(self._frames):
                    ev = next((e for e in (fr.get("ctfEvents") or []) if pred(e)), None)
                    if ev is not None:
                        agent = ev.get("target") or ev.get("side") or "red"
                        if agent not in ("red", "blue"):
                            agent = "red"
                        events.append((key, label, agent, i))
                        break
        # ---- R1-R4 "first X" events (per side), scanned from the recorded frames.
        # Each Match is one round, so only that round's flags add specs; a spec already
        # captured is skipped (no scan), so this costs nothing once every first is logged.
        def _pc(x):
            return bin(int(x or 0)).count("1")

        def _first_idx(pred, cap=4000):
            for i in range(min(len(self._frames), cap)):
                try:
                    if pred(self._frames[i]):
                        return i
                except Exception:
                    pass
            return None

        env = self.env
        specs = []   # (key, label, agent, predicate(frame))
        for side in ("red", "blue"):
            nm = names[side]
            if getattr(env, "rich", False):                       # Round 1: coins + "?" blocks
                specs += [
                    (f"coin_{side}", f"{nm} grabs its first coin", side,
                     (lambda s: lambda fr: _pc(fr.get(s + "Coins")) > 0)(side)),
                    (f"ghost_{side}", f"{nm} first turns into a Ghost", side,
                     (lambda s: lambda fr: fr.get(s + "Status") == "ghost")(side)),
                    (f"frozen_{side}", f"{nm} first freezes on a Mystery Block", side,
                     (lambda s: lambda fr: fr.get(s + "Status") == "frozen")(side)),
                ]
            if getattr(env, "star_mode", False):                  # Round 2: stars
                specs.append(
                    (f"star_{side}", f"{nm} collects its first star", side,
                     (lambda s: lambda fr: _pc(fr.get(s + "Stars")) > 0)(side)))
            if getattr(env, "hazardous", False) and not getattr(env, "goomba_mode", False):
                specs.append(                                     # Round 2: warp pipes
                    (f"pipe_{side}", f"{nm} rides a warp pipe for the first time", side,
                     (lambda s: lambda fr: fr.get(s + "Warp") is not None)(side)))
            if getattr(env, "goomba_mode", False):                # Round 3: the Cage
                specs.append(
                    (f"caged_{side}", f"{nm} first gets caught in a Cage", side,
                     (lambda s: lambda fr: (fr.get("caged") or {}).get(s, 0) > 0)(side)))
            if getattr(env, "missile_game", False):               # Round 4: hearts + pickups
                specs.append(
                    (f"hit_{side}", f"{nm} loses its first heart to a Banzai Bill", side,
                     (lambda s: lambda fr: (fr.get("hearts") or {}).get(s, 99)
                      < (fr.get("maxHearts") or 3))(side)))
                for _t, _lbl in (("speed", "Speed"), ("invincible", "Shield"),
                                 ("slow", "Slow"), ("freeze", "Freeze")):
                    specs.append(
                        (f"pickup_{_t}_{side}",
                         f"{nm} collects its first {_lbl} power-up", side,
                         (lambda s, t: lambda fr: any(
                             ev.get("collector") == s and ev.get("type") == t
                             for ev in (fr.get("pickupEvents") or [])))(side, _t)))
        for key, label, agent, pred in specs:
            if key in self._milestone_keys:
                continue          # already logged this round - don't scan for it again
            idx = _first_idx(pred)
            if idx is not None:
                events.append((key, label, agent, idx))

        for key, label, agent, steps in events:
            if key in self._milestone_keys:
                continue
            self._milestone_keys.add(key)
            n = max(0, int(steps))
            frames = self._frames[:n + 1] if n + 1 <= len(self._frames) else list(self._frames)
            try:
                fields = self._capture_replay_fields(agent)
            except Exception:
                fields = None
            self._milestones.append({
                "key": key, "label": label, "agent": agent,
                "episode": self.episode, "steps": n,
                "stats": {
                    "return": round(float(self.ep_return.get(agent, 0.0)), 3),
                    "epsilon": round(float(self.red_epsilon if agent == "red"
                                           else self.epsilon), 3),
                    "outcome": ("win" if race == agent
                                else "lose" if race in ("red", "blue") else "draw"),
                    "truncated": bool(truncated),
                },
                "frames": frames,
                "policyFrames": self._replay_policy_frames(agent),
                "replayFields": fields,
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
        """Freeze the Q/value/policy field(s) that CHOSE this run, before the model
        moves on. This is the historical model behind the replay; future training
        must not alter it, so the replay browser's maps stay truthful.

        Round 2's frames carry the collected-tomato mask and the field changes a lot
        with it, so that round stores one field PER MASK visited and the frontend
        picks by frame. Every other grid round stores ONE field under "default":
        the model as it stood at the end of the run - exactly what the live map
        would have shown then. Without this the replay had no field at all, so
        Value / Policy / Visits all went blank on rounds 1 and 3.
        """
        if getattr(self.env, "objective", "") == "arena":
            return None            # continuous rounds have no per-cell grid field
        learner = self._agent(agent)
        star_mode = bool(getattr(self.env, "star_mode", False))
        if star_mode:
            star_key = agent + "Stars"
            keys = sorted({int(frame.get(star_key, 0)) for frame in self._frames})
        else:
            keys = [None]          # a single frozen field, keyed "default"
        fields = {}
        floor = [list(cell) for cell in self.env.floor_cells]
        for star_mask in keys:
            q_grid = [[None] * self.env.W for _ in range(self.env.H)]
            value_grid = [[None] * self.env.W for _ in range(self.env.H)]
            policy = [[None] * self.env.W for _ in range(self.env.H)]
            effective = [[None] * self.env.W for _ in range(self.env.H)]
            for (r, c), idx in self.env.cell_index.items():
                if star_mask is None:
                    # the round's own state factors in the CURRENT context, the same
                    # projection the live value map uses (env.full_state)
                    state = self.env.full_state(agent, (r, c))
                    allowed = self.env.effective_actions(agent, (r, c))
                else:
                    state = (idx, star_mask)
                    allowed = self.env.effective_actions(
                        agent, (r, c), star_mask=star_mask)
                if learner.state_value(state) is None:
                    continue
                q = learner.q_values(state)
                valid = [
                    action for action in range(len(q)) if allowed[action]
                ] or list(range(len(q)))
                q_grid[r][c] = [round(float(value), 4) for value in q]
                value_grid[r][c] = round(
                    float(max(q[action] for action in valid)), 4
                )
                policy[r][c] = _unique_argmax(q, valid)
                effective[r][c] = [bool(value) for value in allowed]
            fields["default" if star_mask is None else str(star_mask)] = {
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
            "epsilon": round(float(getattr(learner, "epsilon", 0.0) or 0.0), 4),
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

    def replay(self, which="last", agent=None, rank=0, episode=None):
        with self.lock:
            metric = "longest" if getattr(self.env, "missile_game", False) else "fastest"
            if agent == "milestones":
                # milestones are append-only, so the row rank is a stable identity
                lst = self._milestones
                if not (0 <= rank < len(lst)):
                    return {"available": False}
                ep = lst[rank]
                return {"available": True, "which": "top", "agent": "milestones",
                        "metric": "milestone", "rank": rank,
                        "key": ep["key"], "label": ep["label"],
                        "winner": ep["agent"], "steps": ep["steps"],
                        "episode": ep["episode"], "frames": ep["frames"],
                        "stats": ep.get("stats"),
                        "policyFrames": ep.get("policyFrames", []),
                        "replayFields": ep.get("replayFields")}
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
            if agent == "milestones":
                lst = self._milestones
                return {"agent": "milestones", "count": len(lst), "metric": "milestone",
                        "items": [{"rank": i, "key": e["key"], "label": e["label"],
                                   "milestoneAgent": e["agent"], "steps": e["steps"],
                                   "episode": e["episode"],
                                   "return": (e.get("stats") or {}).get("return"),
                                   "id": f"{self.round_id}:milestone:{e['episode']}:{e['key']}"}
                                  for i, e in enumerate(lst)]}
            lst = self._top.get(agent, [])
            return {"agent": agent, "count": len(lst),
                    "metric": "longest" if getattr(self.env, "missile_game", False) else "reward",
                    "items": [{"rank": i, "steps": e["steps"], "episode": e["episode"],
                               "return": (e.get("stats") or {}).get("return"),
                               "id": f"{self.round_id}:{agent}:{e['episode']}"}
                              for i, e in enumerate(lst)]}
