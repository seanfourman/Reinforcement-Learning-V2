"""Tabular self-play agents - the learnable "models".

Every agent shares one interface so the match loop and the M-panel can swap
algorithms at runtime:

    a  = agent.policy_action(state)      # epsilon-greedy (explore/exploit)
    agent.learn_step(s, a, r, ns, na, done)
    agent.end_episode()                  # MC learns here; TD methods no-op
    agent.value(state) / agent.q_values(state)   # for the heatmap / Q inspector

Implemented (all "capture" a concept from the syllabus):
  * QLearning      - off-policy TD control (bootstraps on max_a Q)
  * Sarsa          - on-policy TD control (bootstraps on the action actually taken)
  * ExpectedSarsa  - TD control bootstrapping on the policy's EXPECTED next value
  * MonteCarlo     - every-visit MC control (learns from full episode returns)

Q-tables are plain dicts keyed by the observation tuple, so they reset to empty
the instant a new world is generated (both models "start untrained" again).
"""

import random

N_ACTIONS = 5  # keep in sync with env.ACTIONS; imported lazily elsewhere


class Tabular:
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

    # ------------------------------------------------------------------ hooks
    def learn_step(self, s, a, r, ns, na, done):
        raise NotImplementedError

    def end_episode(self):
        pass


class QLearning(Tabular):
    name = "Q-learning"

    def learn_step(self, s, a, r, ns, na, done):
        row = self.row(s)
        target = r if done else r + self.gamma * max(self.row(ns))
        td = target - row[a]
        row[a] += self.alpha * td
        self._record_td(td)


class Sarsa(Tabular):
    name = "SARSA"

    def learn_step(self, s, a, r, ns, na, done):
        row = self.row(s)
        target = r if done else r + self.gamma * self.row(ns)[na]
        td = target - row[a]
        row[a] += self.alpha * td
        self._record_td(td)


class ExpectedSarsa(Tabular):
    name = "Expected-SARSA"

    def _expected(self, state):
        row = self.row(state)
        best = max(row)
        n = self.n_actions
        # epsilon-greedy policy: eps/n to each action, +(1-eps) to the greedy one
        exp = sum(row) * (self.epsilon / n)
        exp += (1 - self.epsilon) * best
        return exp

    def learn_step(self, s, a, r, ns, na, done):
        row = self.row(s)
        target = r if done else r + self.gamma * self._expected(ns)
        td = target - row[a]
        row[a] += self.alpha * td
        self._record_td(td)


class MonteCarlo(Tabular):
    name = "Monte-Carlo"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._episode = []          # (s, a, r) trajectory

    def learn_step(self, s, a, r, ns, na, done):
        self._episode.append((s, a, r))

    def end_episode(self):
        # every-visit MC control with CONSTANT alpha (sample-average 1/c decays
        # too fast for non-stationary self-play, where the rival keeps changing).
        G = 0.0
        for s, a, r in reversed(self._episode):
            G = r + self.gamma * G
            row = self.row(s)
            td = G - row[a]
            row[a] += self.alpha * td
            self._record_td(td)
        self._episode = []

    def reset_learning(self):
        super().reset_learning()
        self._episode = []


ALGORITHMS = {
    "qlearning": QLearning,
    "sarsa": Sarsa,
    "expected_sarsa": ExpectedSarsa,
    "monte_carlo": MonteCarlo,
}


def make_agent(algo="qlearning", **kwargs):
    cls = ALGORITHMS.get(algo, QLearning)
    return cls(**kwargs)
