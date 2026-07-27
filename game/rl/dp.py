"""Dynamic-Programming planners for Round 1 - the MODEL-KNOWN maze.

Because the transition model P(s'|s,a) is *known* (see ``env.move_dist``), we don't
learn from experience: we **plan** the optimal policy with Dynamic Programming, as
in Benny's DP lecture. Round 1 (Peach's Castle) is a single-goal maze: navigate from
the spawn to the Power Moon.

The twist that makes it a RACE: instead of solving to convergence up front, each
planner advances a few Bellman sweeps PER TICK (``plan_speed``) and the agent acts on
its CURRENT, still-converging policy. Early on the value hasn't propagated from the
goal to the agent's tile yet, so it wanders; as sweeps flow the value backward, the
policy sharpens and it beelines. Whoever converges faster (more sweeps/tick, better
gamma) reaches the Moon sooner - and once BOTH converge they play the same optimum,
so it settles to a draw. That is the whole DP-vs-DP contest.

  * ``ValueIteration``  - each sweep: Bellman-optimality backup V(s) <- max_a Q(s,a),
    policy read off greedily.
  * ``PolicyIteration`` - each sweep: one policy-EVALUATION pass of the current
    policy; when evaluation settles, one greedy IMPROVEMENT; stable policy = done.

Both converge to the SAME optimal policy (the contrast is *how* + *how many sweeps*).
The planners conform to the agent interface (``policy_action`` / ``learn_step`` /
``value`` / ``q_values`` / ``set_epsilon`` / ``reset_learning``) so match.py and the
heatmap reuse them unchanged; ``learn_step`` is where a sweep budget is spent (the
agent "thinks" as it moves), and ``end_episode`` is a no-op.
"""

from env import MOVE_ACTIONS, N_ACTIONS, GHOST_LEN, FREEZE_LEN, WALL

GOAL_REWARD = 1.0      # reward for transitioning INTO the goal (then terminal)
DEFAULT_PLAN_SPEED = 0.6   # Bellman sweeps per tick (the convergence-race knob)


class _DPBase:
    """Shared machinery: build the known MDP from the env and advance the plan
    incrementally. On the skeleton rounds the state is a single cell; on Round 1 it is
    ``(cell, collected_mask, status)`` and the backup runs over the env's shared
    ``state_transition`` model, so the value field is EXACTLY the live env's stochastic
    dynamics (ice slip, coins, "?" ghost/freeze). Subclasses implement ``_sweep``."""

    mode = "dp"

    def __init__(self, env, agent, gamma=0.97, theta=1e-5, max_sweeps=2000,
                 plan_speed=DEFAULT_PLAN_SPEED, seed=0):
        self.env = env
        self.agent = agent              # 'red' | 'blue'
        self.gamma = gamma
        self.theta = theta
        self.max_sweeps = max_sweeps
        self.plan_speed = max(0.0, float(plan_speed))
        self.epsilon = 0.0
        self._init_plan()

    # ---- the known model: states, goal, transitions -----------------------
    def _goals(self):
        return {tuple(e) for e in self.env.world.escape}

    def _cell(self, state):
        return self.env.pos_cells[state[0]]

    def _is_goal(self, state):
        return self._cell(state) in self.goals

    def _enumerate_states(self):
        """Every planning state. Skeleton rounds: one per cell. Round 1: the product
        cell x its own collected-mask x status - but a WALL cell is only reachable while
        GHOSTING, so wall cells get positive (ghost) statuses only (keeps the space small
        even though ghost positions now include interior walls)."""
        if not self.env.rich:
            return [(i,) for i in range(self.env.n_cells)]
        nbits = self.env._n_coins[self.agent] + len(self.env.block_cells[self.agent])
        grid = self.env.world.grid
        states = []
        for i, (r, c) in enumerate(self.env.pos_cells):
            floor = grid[r][c] != WALL
            statuses = range(-FREEZE_LEN, GHOST_LEN + 1) if floor else range(1, GHOST_LEN + 1)
            for m in range(1 << nbits):
                for s in statuses:
                    states.append((i, m, s))
        return states

    def _q_of(self, state, action, V):
        # transitions are precomputed once per plan (the env is static); fall back to a
        # live query for the rare goal-cell probe that isn't in the cached model.
        trans = self._model.get(state)
        outs = trans[action] if trans else self.env.state_transition(self.agent, state, action)
        q = 0.0
        for prob, ns, reward, done in outs:
            q += prob * (reward + (GOAL_REWARD if done else self.gamma * V[ns]))
        return q

    def _greedy(self, state, V):
        best_a, best_q = MOVE_ACTIONS[0], float("-inf")
        for a in MOVE_ACTIONS:
            q = self._q_of(state, a, V)
            if q > best_q:
                best_q, best_a = q, a
        return best_a, best_q

    # ---- incremental planning ---------------------------------------------
    def _init_plan(self):
        """Start UNCONVERGED: zero values, an arbitrary policy. Sweeps accrue over
        ticks via plan_tick(). The static transition model is precomputed ONCE here so
        each sweep just reuses it (keeps the race smooth over a large state space)."""
        self.goals = self._goals()
        self.cells = list(self.env.floor_cells)
        self.states = self._enumerate_states()
        self._model = {s: [self.env.state_transition(self.agent, s, a) for a in MOVE_ACTIONS]
                       for s in self.states if not self._is_goal(s)}
        self.V = {s: 0.0 for s in self.states}
        self.policy = {s: MOVE_ACTIONS[0] for s in self._model}
        self.converged = False
        self._acc = 0.0                 # fractional-sweep accumulator
        self.sweeps = [0]               # iteration count (a list, for the panel's sum())
        self.sweep_log = []             # per-sweep {delta, meanV} for the convergence charts
        self.backups = 0                # total Bellman backups (fair-compute measure)
        self.policy_changes = []        # PI only: #states whose greedy action changed
        self.v_frames = []              # per-sweep V-slices for the propagation animation

    def plan(self):
        """Solve to convergence in one go (used by read-only previews / heatmaps that
        want the final field, not the live race)."""
        self._init_plan()
        for _ in range(self.max_sweeps):
            self._sweep()
            self.sweeps[0] += 1
            if self.converged:
                break

    def plan_tick(self):
        """Advance the plan by ``plan_speed`` sweeps this tick (fractional accrues)."""
        if self.converged or self.plan_speed <= 0.0:
            return
        self._acc += self.plan_speed
        while self._acc >= 1.0 and not self.converged:
            self._acc -= 1.0
            self._sweep()
            self.sweeps[0] += 1
            if self.sweeps[0] >= self.max_sweeps:
                self.converged = True

    def _value_slice(self):
        """V projected onto the board for the propagation animation: value at each cell
        in the CANONICAL slice (no coins collected, normal status) so it stays a clean
        H x W field even though the real state space is much larger."""
        key = (lambda i: (i,)) if not self.env.rich else (lambda i: (i, 0, 0))
        sl = {cell: self.V.get(key(i), 0.0) for i, cell in enumerate(self.cells)}
        # the goal is terminal (V=0); paint it as the PEAK so the animation reads as
        # value spreading OUT from the goal, not a 0-hole sitting at the source.
        if sl:
            peak = max(sl.values())
            for g in self.goals:
                if g in sl:
                    sl[g] = peak
        return sl

    def _log_sweep(self, delta):
        self.backups += len(self._model)
        self.sweep_log.append({"delta": round(delta, 6),
                               "meanV": round(sum(self.V.values()) / (len(self.V) or 1), 4)})
        if len(self.v_frames) < 80:
            self.v_frames.append(self._value_slice())

    def _sweep(self):
        raise NotImplementedError

    # ---- agent interface ---------------------------------------------------
    def policy_action(self, state, mask=None):
        a = self.policy.get(state, MOVE_ACTIONS[0])
        # the planned action shouldn't bump a wall, but if it's blocked here fall back
        # to the best-Q valid one (no self-loop on a wall).
        if mask is not None and not mask[a]:
            valid = [i for i, m in enumerate(mask) if m]
            if valid:
                a = max(valid, key=lambda i: self._q_of(state, i, self.V))
        return a

    def value(self, state):
        return self.V.get(state, 0.0)

    def state_value(self, state):
        v = self.V.get(state)
        return v if (v is None or abs(v) > 1e-6) else None

    def q_values(self, state):
        q = [0.0] * N_ACTIONS
        for a in MOVE_ACTIONS:
            q[a] = self._q_of(state, a, self.V)
        return q

    def learned_count(self):
        return len(self.V)

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        # a planner "thinks" as it moves: spend this tick's sweep budget
        self.plan_tick()

    def end_episode(self):
        pass

    def set_epsilon(self, eps):
        self.epsilon = 0.0          # DP follows its planned policy, not epsilon-greedy

    def reset_learning(self):
        self._init_plan()           # "relearn" = restart the plan from scratch


class ValueIteration(_DPBase):
    name = "Value Iteration"
    mode = "value_iteration"

    def _sweep(self):
        # SYNCHRONOUS (Jacobi) backup: read the OLD V for every state, write into a
        # fresh table, then swap - so value spreads ONE ring per sweep (the visible
        # wave), instead of jumping across the whole maze as an in-place sweep would.
        newV = dict(self.V)
        delta = 0.0
        for s in self._model:
            best_a, best_q = self._greedy(s, self.V)
            delta = max(delta, abs(best_q - self.V[s]))
            newV[s] = best_q
            self.policy[s] = best_a          # policy = greedy(V), refreshed each sweep
        self.V = newV
        self._log_sweep(delta)
        if delta < self.theta:
            self.converged = True


class PolicyIteration(_DPBase):
    """TRUNCATED (a.k.a. modified) policy iteration: a fixed budget of synchronous
    policy-EVALUATION passes, THEN one greedy IMPROVEMENT, repeat. Running evaluation to
    full convergence before every improvement (classic PI) needs hundreds of sweeps at
    gamma~0.97 over this state space - far too slow for the live race - and "several
    rounds of evaluation then an improvement" is exactly what the round is meant to
    show. EVAL_SWEEPS=1 would BE value iteration; a handful shows distinct eval phases."""

    name = "Policy Iteration"
    mode = "policy_iteration"
    EVAL_SWEEPS = 8            # evaluation passes per improvement (truncation budget)

    def _init_plan(self):
        super()._init_plan()
        self._eval_since = 0

    def _sweep(self):
        # one SYNCHRONOUS policy-EVALUATION pass of the current policy...
        newV = dict(self.V)
        delta = 0.0
        for s in self._model:
            v = self._q_of(s, self.policy[s], self.V)
            delta = max(delta, abs(v - self.V[s]))
            newV[s] = v
        self.V = newV
        self._log_sweep(delta)
        self._eval_since += 1
        # ...then a greedy IMPROVEMENT once evaluation SETTLES or the budget is spent.
        if delta < self.theta or self._eval_since >= self.EVAL_SWEEPS:
            changed = 0
            for s in self.policy:
                best_a, _ = self._greedy(s, self.V)
                self.backups += 1
                if best_a != self.policy[s]:
                    self.policy[s] = best_a
                    changed += 1
            self.policy_changes.append(changed)
            self._eval_since = 0
            # converged only when the policy is stable AND its value has settled
            if changed == 0 and delta < self.theta:
                self.converged = True


DP_ALGORITHMS = {
    "value_iteration": ValueIteration,
    "policy_iteration": PolicyIteration,
}


def is_dp(algo):
    return algo in DP_ALGORITHMS


def make_dp(algo, env, agent, **kwargs):
    cls = DP_ALGORITHMS.get(algo, ValueIteration)
    return cls(env, agent, **kwargs)
