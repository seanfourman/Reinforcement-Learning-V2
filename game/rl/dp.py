"""Dynamic-Programming planners for Round 1 - the MODEL-KNOWN room.

Because the transition model P(s'|s,a) is *known* (see ``env.move_dist``), we
don't need to learn from experience: we **plan** the optimal policy with Dynamic
Programming, exactly as in Benny's DP lecture.

The DP round (Peach's Castle) is a single-goal gridworld: navigate from the spawn
to the goal tile. We solve that one known stochastic-shortest-path MDP over the
grid (the same slip model the live env runs - see ``env.move_dist`` /
``env._cross_move``, both driven by ``slip_ctrl``), using either:

  * ``ValueIteration``  - Bellman-optimality sweeps until V converges, then read
    off the greedy policy (Red).
  * ``PolicyIteration`` - alternate full policy *evaluation* with greedy
    *improvement* until the policy stops changing (Blue).

Both converge to the SAME optimal policy (the contrast Benny teaches is *how* and
*how many iterations*); on a slippery round the slip model makes the live race
stochastic, so who wins is not a foregone conclusion. The planners conform to the
agent interface (``policy_action`` / ``learn_step`` / ``value`` / ``q_values`` /
``set_epsilon`` / ``reset_learning``) so ``match.py`` and the heatmap reuse them
unchanged. ``learn_step`` / ``end_episode`` are no-ops - a planner already knows.
"""

from env import MOVE_ACTIONS, N_ACTIONS

GOAL_REWARD = 1.0      # reward for transitioning INTO the goal (then terminal)


class _DPBase:
    """Shared machinery: build the known single-goal MDP from the env and solve it.
    Subclasses implement ``_solve`` (value- vs policy-iteration)."""

    mode = "dp"

    def __init__(self, env, agent, gamma=0.97, theta=1e-5, max_sweeps=2000, seed=0):
        self.env = env
        self.agent = agent              # 'red' | 'blue'
        self.gamma = gamma
        self.theta = theta
        self.max_sweeps = max_sweeps
        self.epsilon = 0.0
        self.sweeps = [0]               # iteration count (a list, for the panel's sum())
        self.sweep_log = []             # per-sweep {delta, meanV} for the convergence charts
        self.backups = 0                # total Bellman backups (sweeps x states) - fair compute
        self.policy_changes = []        # PI only: states whose greedy action changed, per iteration
        self.v_frames = []              # per-sweep V snapshots for the propagation animation
        self.plan()

    # ---- the known model: cells, goal, transitions ------------------------
    def _goals(self):
        return {tuple(e) for e in self.env.world.escape}

    def _passable(self, agent, r, c):
        return self.env._static_passable(agent, r, c)

    def _dist(self, cell, action):
        return self.env.move_dist(self.agent, cell, action, passable=self._passable)

    def _q_of(self, cell, action, V, goals):
        q = 0.0
        for prob, c2 in self._dist(cell, action):
            if c2 in goals:
                q += prob * GOAL_REWARD            # arrive -> reward, terminal
            else:
                q += prob * self.gamma * V[c2]
        return q

    # ---- planning ----------------------------------------------------------
    def plan(self):
        self.sweep_log = []             # fresh convergence trace on every (re)solve
        self.backups = 0
        self.policy_changes = []
        self.v_frames = []
        self.cells = list(self.env.floor_cells)
        goals = self._goals()
        self.V, self.policy, n = self._solve(goals)
        self.sweeps = [n]

    def _greedy(self, cell, V, goals):
        best_a, best_q = MOVE_ACTIONS[0], float("-inf")
        for a in MOVE_ACTIONS:
            q = self._q_of(cell, a, V, goals)
            if q > best_q:
                best_q, best_a = q, a
        return best_a, best_q

    def _solve(self, goals):
        raise NotImplementedError

    # ---- agent interface ---------------------------------------------------
    def _cell(self, state):
        return self.env.floor_cells[state[0]]

    def policy_action(self, state, mask=None):
        cell = self._cell(state)
        a = self.policy.get(cell, MOVE_ACTIONS[0])
        # the model-optimal move is essentially never a wall-bump, but if this cell's
        # planned action happens to be blocked here, fall back to the best-Q valid one
        # so a DP agent can't self-loop on a wall either.
        if mask is not None and not mask[a]:
            valid = [i for i, m in enumerate(mask) if m]
            if valid:
                a = max(valid, key=lambda i: self._q_of(cell, i, self.V, self._goals()))
        return a

    def value(self, state):
        return self.V.get(self._cell(state), 0.0)

    def state_value(self, state):
        v = self.V.get(self._cell(state))
        return v if (v is None or abs(v) > 1e-6) else None

    def q_values(self, state):
        cell = self._cell(state)
        goals = self._goals()
        q = [0.0] * N_ACTIONS
        for a in MOVE_ACTIONS:
            q[a] = self._q_of(cell, a, self.V, goals)
        return q

    def learned_count(self):
        return len(self.V)

    # planners don't learn - deliberate no-ops (``next_mask`` accepted for parity
    # with the learner interface match.py drives)
    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        pass

    def end_episode(self):
        pass

    def set_epsilon(self, eps):
        self.epsilon = 0.0          # DP follows the optimal policy; slip adds variance

    def reset_learning(self):
        self.plan()                 # "relearn" = re-solve the known MDP


class ValueIteration(_DPBase):
    name = "Value Iteration"
    mode = "value_iteration"

    def _solve(self, goals):
        V = {c: 0.0 for c in self.cells}
        nb = sum(1 for c in self.cells if c not in goals)   # states backed up per sweep
        sweeps = 0
        for _ in range(self.max_sweeps):
            delta = 0.0
            for c in self.cells:
                if c in goals:
                    continue
                _, best_q = self._greedy(c, V, goals)
                delta = max(delta, abs(best_q - V[c]))
                V[c] = best_q
            sweeps += 1
            self.backups += nb
            self.sweep_log.append({"delta": round(delta, 6),
                                   "meanV": round(sum(V.values()) / (len(V) or 1), 4)})
            if len(self.v_frames) < 80:        # per-sweep V snapshot for the animation
                self.v_frames.append(dict(V))
            if delta < self.theta:
                break
        policy = {c: self._greedy(c, V, goals)[0] for c in self.cells if c not in goals}
        return V, policy, sweeps


class PolicyIteration(_DPBase):
    name = "Policy Iteration"
    mode = "policy_iteration"

    def _evaluate(self, policy, V, goals):
        nb = sum(1 for c in self.cells if c not in goals)
        for _ in range(self.max_sweeps):
            delta = 0.0
            for c in self.cells:
                if c in goals:
                    continue
                v = self._q_of(c, policy[c], V, goals)
                delta = max(delta, abs(v - V[c]))
                V[c] = v
            self.backups += nb
            self.sweep_log.append({"delta": round(delta, 6),
                                   "meanV": round(sum(V.values()) / (len(V) or 1), 4)})
            if delta < self.theta:
                break
        return V

    def _solve(self, goals):
        # init an arbitrary policy (action 0) + zero V
        policy = {c: MOVE_ACTIONS[0] for c in self.cells if c not in goals}
        V = {c: 0.0 for c in self.cells}
        improvements = 0
        for _ in range(self.max_sweeps):
            self._evaluate(policy, V, goals)
            stable = True
            improvements += 1
            changed = 0
            for c in policy:
                best_a, _ = self._greedy(c, V, goals)
                self.backups += 1
                if best_a != policy[c]:
                    policy[c] = best_a
                    stable = False
                    changed += 1
            self.policy_changes.append(changed)   # -> 0 when the policy is stable (PI proof)
            if stable:
                break
        return V, policy, improvements


DP_ALGORITHMS = {
    "value_iteration": ValueIteration,
    "policy_iteration": PolicyIteration,
}


def is_dp(algo):
    return algo in DP_ALGORITHMS


def make_dp(algo, env, agent, **kwargs):
    cls = DP_ALGORITHMS.get(algo, ValueIteration)
    return cls(env, agent, **kwargs)
