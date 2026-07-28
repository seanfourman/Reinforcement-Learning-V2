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

N_ACTIONS = 4  # keep in sync with env.ACTIONS; imported lazily elsewhere


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

    def discard_episode(self):
        """Drop an externally interrupted trajectory without learning from it."""
        pass


class QLearning(Tabular):
    name = "Q-learning"

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        row = self.row(s)
        nrow = self.row(ns)
        target = r if done else r + self.gamma * max(nrow[i] for i in self._valid(next_mask))
        td = target - row[a]
        row[a] += self.alpha * td
        self._record_td(td)


class Sarsa(Tabular):
    name = "SARSA"

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        # on-policy: bootstrap on the action actually taken next (na is already drawn
        # from the masked policy), so SARSA needs no extra next_mask.
        row = self.row(s)
        target = r if done else r + self.gamma * self.row(ns)[na]
        td = target - row[a]
        row[a] += self.alpha * td
        self._record_td(td)


class ExpectedSarsa(Tabular):
    name = "Expected-SARSA"

    def _expected(self, state, mask=None):
        row = self.row(state)
        valid = list(self._valid(mask))
        m = len(valid)
        best = max(row[i] for i in valid)
        # epsilon-greedy over the VALID actions: eps/m to each, +(1-eps) to the greedy
        exp = sum(row[i] for i in valid) * (self.epsilon / m)
        exp += (1 - self.epsilon) * best
        return exp

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        row = self.row(s)
        target = r if done else r + self.gamma * self._expected(ns, next_mask)
        td = target - row[a]
        row[a] += self.alpha * td
        self._record_td(td)


class MonteCarlo(Tabular):
    name = "Every-visit MC"

    # MC learns from full-episode RETURNS, which are far higher-variance than a
    # one-step TD target, so a full-size step makes Q wobble and the greedy policy
    # drift off the optimal path. Applying the learning rate GENTLY (x0.25) fixes it:
    # at the panel default (alpha 0.2 -> step 0.05) MC converges AND stays at optimal,
    # and actually FASTER than the raw 0.2 (verified by the sanity check on R1-R3;
    # raw 0.2 drifts/fails on the longer maps). Constant-scaled step, not 1/N: a
    # sample-average anchors on early exploratory garbage and fails to control.
    STEP_SCALE = 0.25

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._episode = []          # (s, a, r) trajectory

    def _mc_step(self):
        return self.alpha * self.STEP_SCALE

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        self._episode.append((s, a, r))

    def end_episode(self):
        # every-visit MC control: update Q(s,a) on EVERY occurrence of (s,a).
        step = self._mc_step()
        G = 0.0
        for s, a, r in reversed(self._episode):
            G = r + self.gamma * G
            row = self.row(s)
            td = G - row[a]
            row[a] += step * td
            self._record_td(td)
        self._episode = []

    def discard_episode(self):
        # In the head-to-head city race, the rival can die and end the shared
        # episode while this model is still navigating. That partial trajectory
        # has no terminal outcome belonging to this agent, so MC must not turn it
        # into a return sample.
        self._episode = []

    def reset_learning(self):
        super().reset_learning()
        self._episode = []


class FirstVisitMonteCarlo(MonteCarlo):
    name = "First-visit MC"

    def end_episode(self):
        # first-visit MC control: update Q(s,a) only on the FIRST time (s,a) appears
        # in the episode (the classic contrast with every-visit MC).
        step = self._mc_step()
        ep = self._episode
        first = {}
        for i, (s, a, _r) in enumerate(ep):
            first.setdefault((s, a), i)        # earliest index of each (s,a)
        G = 0.0
        for i in range(len(ep) - 1, -1, -1):   # returns computed backward
            s, a, r = ep[i]
            G = r + self.gamma * G
            if first.get((s, a)) == i:         # apply only at the first visit
                row = self.row(s)
                td = G - row[a]
                row[a] += step * td
                self._record_td(td)
        self._episode = []


ALGORITHMS = {
    "qlearning": QLearning,
    "sarsa": Sarsa,
    "expected_sarsa": ExpectedSarsa,
    "monte_carlo": MonteCarlo,
    "first_visit_mc": FirstVisitMonteCarlo,
}


def make_agent(algo="qlearning", **kwargs):
    cls = ALGORITHMS.get(algo, QLearning)
    return cls(**kwargs)
