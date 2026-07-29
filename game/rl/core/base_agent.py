"""The base TABULAR agent shared by the Monte-Carlo (Round 2) and
Temporal-Difference (Round 3) learners.

Every tabular algorithm in the tournament is "a Q-table plus an update rule".
This class owns everything EXCEPT the update rule: the Q-table itself,
epsilon-greedy action selection, effective-action masking, the inspection
accessors the heatmaps read, and the smoothed |TD error| learning signal.
Subclasses (``arenas/r2_new_donk_city/monte_carlo.py``,
``arenas/r3_fossil_falls/qlearning.py``, ...) implement only ``learn_step`` /
``end_episode`` - which is exactly the point the syllabus makes: MC and TD
differ ONLY in how they update the same action-value table.

The shared interface (used by ``core/tournament.py`` for every agent kind,
including the DP planners and the deep agents):

    a = agent.policy_action(state, mask)     # epsilon-greedy (explore/exploit)
    agent.learn_step(s, a, r, ns, na, done, next_mask)
    agent.end_episode()                      # MC learns here; TD methods no-op
    agent.state_value(state) / agent.q_values(state)   # heatmap / Q inspector

Q-tables are plain dicts keyed by the observation tuple, so they reset to empty
the instant a new world is generated (both models "start untrained" again).
"""

import random

N_ACTIONS = 4  # default table width; the env's real action count is passed in


class Tabular:
    """Q-table + epsilon-greedy selection; subclasses supply the update rule."""

    name = "tabular"

    def __init__(self, n_actions=N_ACTIONS, alpha=0.2, gamma=0.98, seed=0):
        self.n_actions = n_actions
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon = 1.0
        self.rng = random.Random(seed)
        self.Q = {}
        self.td_ema = 0.0            # smoothed |TD error|, the learning signal

    # ------------------------------------------------------------------ tables
    def row(self, state):
        r = self.Q.get(state)
        if r is None:
            r = [0.0] * self.n_actions
            self.Q[state] = r
        return r

    def greedy_action(self, state, mask=None):
        # break ties RANDOMLY - otherwise an all-zero (unlearned) state always
        # returns action 0, so a barely-trained greedy policy walks into the same
        # wall forever. Random ties keep exploring blank states (vital for MC).
        # `mask` (from the env) restricts the choice to actions that actually move /
        # do something, so the greedy policy can NEVER self-loop on a wall or no-op.
        r = self.row(state)
        valid = [a for a in range(self.n_actions) if mask is None or mask[a]]
        if not valid:
            valid = list(range(self.n_actions))
        best = max(r[a] for a in valid)
        ties = [a for a in valid if r[a] == best]
        return ties[0] if len(ties) == 1 else self.rng.choice(ties)

    def policy_action(self, state, mask=None):
        valid = [a for a in range(self.n_actions) if mask is None or mask[a]]
        if not valid:
            valid = list(range(self.n_actions))
        if self.rng.random() < self.epsilon:
            return self.rng.choice(valid)       # explore among EFFECTIVE actions only
        return self.greedy_action(state, mask)

    # ------------------------------------------------------------- inspection
    def value(self, state):
        r = self.Q.get(state)
        return max(r) if r else 0.0

    def state_value(self, state):
        """V(s) = max_a Q, or None if the state was never visited (so the heatmap
        can leave unlearned tiles blank). DP planners override with their V."""
        r = self.Q.get(state)
        return max(r) if r else None

    def learned_count(self):
        return len(self.Q)

    def q_values(self, state):
        r = self.Q.get(state)
        return list(r) if r else [0.0] * self.n_actions

    def set_epsilon(self, eps):
        self.epsilon = eps

    # the TD error target-Q(s,a) is the signal the update chases; smooth |it| so
    # the panel can chart the learning signal shrinking toward convergence.
    def _record_td(self, td):
        self.td_ema = 0.98 * self.td_ema + 0.02 * abs(td)

    def td_error(self):
        return self.td_ema

    def reset_learning(self):
        self.Q = {}
        self.epsilon = 1.0
        self.td_ema = 0.0

    def _valid(self, mask):
        """The action indices the (masked) policy may actually take at a state.
        Falls back to all actions when there is no mask (open action space)."""
        if mask is None:
            return range(self.n_actions)
        v = [a for a in range(self.n_actions) if mask[a]]
        return v if v else range(self.n_actions)

    # ------------------------------------------------------------------ hooks
    # ``next_mask`` is the effective-action mask AT THE NEXT STATE. Bootstrapping
    # methods restrict the target to those actions so a never-taken (masked-out)
    # wall-bump action, whose Q sits forever at the 0.0 init, can't pollute the
    # max/expectation on the net-negative cross maps.
    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        raise NotImplementedError

    def end_episode(self):
        pass
