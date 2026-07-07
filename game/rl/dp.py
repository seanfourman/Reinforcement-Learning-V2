"""Dynamic-Programming planners for Round 1 - the MODEL-KNOWN room.

Because the slippery transition model P(s'|s,a) is *known* (see
``env.move_dist``), we don't need to learn from experience: we **plan** the
optimal policy with Dynamic Programming, exactly as in Benny's DP lecture.

Each agent's quest is three sequential sub-MDPs (a known stochastic shortest
path each): **reach my key -> reach the gold -> reach an escape tile**. We solve
each phase over the 20x20 grid with the slip model baked in, using either:

  * ``ValueIteration``  - Bellman-optimality sweeps until V converges, then read
    off the greedy policy (Red).
  * ``PolicyIteration`` - alternate full policy *evaluation* with greedy
    *improvement* until the policy stops changing (Blue).

Both converge to the SAME optimal policy (the contrast Benny teaches is *how* and
*how many iterations*); the slippery tiles then make the live race stochastic, so
who wins is not a foregone conclusion. The planners conform to the agent
interface (``policy_action`` / ``learn_step`` / ``value`` / ``q_values`` /
``set_epsilon`` / ``reset_learning``) so ``match.py`` and the heatmap reuse them
unchanged. ``learn_step``/``end_episode`` are no-ops - a planner already knows.
"""

from env import MOVE_ACTIONS, N_ACTIONS, GOLD_ME

GOAL_REWARD = 1.0      # reward for transitioning INTO the phase goal (then terminal)
N_PHASES = 3


def _phase(has_key, gold_loc):
    """0 = need my key, 1 = have key & need gold, 2 = have gold & need escape."""
    if not has_key:
        return 0
    if gold_loc != GOLD_ME:
        return 1
    return 2


class _DPBase:
    """Shared machinery: build the per-phase known MDP from the env and solve it.
    Subclasses implement ``_solve_phase`` (value- vs policy-iteration)."""

    mode = "dp"

    def __init__(self, env, agent, gamma=0.97, theta=1e-5, max_sweeps=2000, seed=0):
        self.env = env
        self.agent = agent              # 'red' | 'blue'
        self.gamma = gamma
        self.theta = theta
        self.max_sweeps = max_sweeps
        self.epsilon = 0.0
        self.sweeps = [0, 0, 0]         # per-phase iteration counts (for the panel)
        self.sweep_log = []             # per-sweep {delta, meanV} for the convergence charts
        # a "cross" world (no keys/gold) is a single-goal gridworld: plan ONE phase
        # (reach an escape tile) instead of the key->gold->escape race.
        self.cross = getattr(env, "objective", "race") == "cross"
        self.plan()

    # ---- the known model: cells, goals, transitions -----------------------
    def _goals(self, phase):
        w = self.env.world
        if self.cross:                  # single-goal gridworld: just reach an escape tile
            return {tuple(e) for e in w.escape}
        if phase == 0:
            return {tuple(w.red_key if self.agent == "red" else w.blue_key)}
        if phase == 1:
            return {tuple(w.gold_home)}
        return {tuple(e) for e in w.escape}

    def _passable(self, agent, r, c):
        # door treated as open (the agent holds the key by the time it matters);
        # safe for phase 0 too, since routing through the door never reaches the
        # key faster than going inward.
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
        self.cells = list(self.env.floor_cells)
        self.V = [None] * N_PHASES
        self.policy = [None] * N_PHASES
        nphases = 1 if self.cross else N_PHASES
        for ph in range(nphases):
            goals = self._goals(ph)
            V, pol, n = self._solve_phase(goals)
            self.V[ph], self.policy[ph], self.sweeps[ph] = V, pol, n

    def _greedy(self, cell, V, goals):
        best_a, best_q = MOVE_ACTIONS[0], float("-inf")
        for a in MOVE_ACTIONS:
            q = self._q_of(cell, a, V, goals)
            if q > best_q:
                best_q, best_a = q, a
        return best_a, best_q

    def _solve_phase(self, goals):
        raise NotImplementedError

    # ---- agent interface ---------------------------------------------------
    def _cell_phase(self, state):
        cell = self.env.floor_cells[state[0]]
        if self.cross:
            return cell, 0
        return cell, _phase(state[1], state[2])

    def policy_action(self, state):
        cell, ph = self._cell_phase(state)
        pol = self.policy[ph]
        return pol.get(cell, MOVE_ACTIONS[0])

    def value(self, state):
        cell, ph = self._cell_phase(state)
        return self.V[ph].get(cell, 0.0)

    def state_value(self, state):
        cell, ph = self._cell_phase(state)
        v = self.V[ph].get(cell)
        return v if (v is None or abs(v) > 1e-6) else None

    def q_values(self, state):
        cell, ph = self._cell_phase(state)
        V, goals = self.V[ph], self._goals(ph)
        q = [0.0] * N_ACTIONS
        for a in MOVE_ACTIONS:
            q[a] = self._q_of(cell, a, V, goals)
        return q

    def learned_count(self):
        return sum(len(v) for v in self.V if v)

    # planners don't learn - these are deliberate no-ops
    def learn_step(self, s, a, r, ns, na, done):
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

    def _solve_phase(self, goals):
        V = {c: 0.0 for c in self.cells}
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
            self.sweep_log.append({"delta": round(delta, 6),
                                   "meanV": round(sum(V.values()) / len(V), 4)})
            if delta < self.theta:
                break
        policy = {c: self._greedy(c, V, goals)[0] for c in self.cells if c not in goals}
        return V, policy, sweeps


class PolicyIteration(_DPBase):
    name = "Policy Iteration"
    mode = "policy_iteration"

    def _evaluate(self, policy, V, goals):
        for _ in range(self.max_sweeps):
            delta = 0.0
            for c in self.cells:
                if c in goals:
                    continue
                v = self._q_of(c, policy[c], V, goals)
                delta = max(delta, abs(v - V[c]))
                V[c] = v
            self.sweep_log.append({"delta": round(delta, 6),
                                   "meanV": round(sum(V.values()) / len(V), 4)})
            if delta < self.theta:
                break
        return V

    def _solve_phase(self, goals):
        # init an arbitrary policy (head toward the goal-ish: action 0) + zero V
        policy = {c: MOVE_ACTIONS[0] for c in self.cells if c not in goals}
        V = {c: 0.0 for c in self.cells}
        improvements = 0
        for _ in range(self.max_sweeps):
            self._evaluate(policy, V, goals)
            stable = True
            improvements += 1
            for c in policy:
                best_a, _ = self._greedy(c, V, goals)
                if best_a != policy[c]:
                    policy[c] = best_a
                    stable = False
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
