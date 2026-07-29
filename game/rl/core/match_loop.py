"""The live episode loop (a Match mixin): reset the contest, start an episode,
and advance the whole simulation by one env step per ``tick()``.

``tick`` is the heart of the tournament: the server's trainer thread calls it
repeatedly; each call steps the env once, lets BOTH agents learn from their own
transition (with Round 4's action-repeat macro-transitions), updates every
statistic the dashboard charts, and rolls the episode over when it ends.
"""

from collections import deque

from core.replays import FRAME_CAP, HISTORY_CAP


class MatchLoopMixin:
    """Contest reset + episode lifecycle + the per-tick simulation step."""


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
        # "First key events" milestone replays: the FIRST time each notable thing
        # happens this round (first win, first goal reached, first death by each
        # hazard). Append-only + first-occurrence, so a row's rank never shifts.
        self._milestones = []
        self._milestone_keys = set()
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
