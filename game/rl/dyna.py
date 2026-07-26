"""Model-based tabular agents (the Dyna family) - Round 3 (Fossil Falls).

Learn a model of the world from experience, then do extra "planning" updates from
that model on top of the real ones. All subclass the model-free ``Tabular`` agent
(same Q-table + epsilon-greedy interface), so match.py and the heatmap reuse them
unchanged. The key knob is ``planning`` (n): how many imagined updates per real
step - more planning learns the maze from fewer real steps.

  * DynaQ               - after each real step, n RANDOM planning updates from the
                          learned model (Sutton & Barto's Dyna-Q).
  * PrioritizedSweeping - plan where it matters first: a priority queue focuses the
                          n updates on the state-actions whose value just moved most
                          (and their predecessors), so it learns far more efficiently.
  * DynaQPlus           - Dyna-Q plus an exploration bonus that rewards revisiting
                          state-actions not tried in a while (better exploration).

The model is deterministic (it stores the latest (s,a) -> (r, s', done)); on the
slippery tiles that's an approximation the real updates keep correcting - exactly
the "plan with a model you learned" story the round is about.
"""

import heapq

from agents import Tabular, N_ACTIONS


class _DynaBase(Tabular):
    """Q-learning on real experience + n planning updates from a learned model."""

    def __init__(self, n_actions=N_ACTIONS, alpha=0.2, gamma=0.98, seed=0, planning=10):
        super().__init__(n_actions=n_actions, alpha=alpha, gamma=gamma, seed=seed)
        self.planning = max(0, int(planning))   # planning updates per real step
        self.model = {}                          # (s,a) -> (r, ns, done, ns_mask)
        self.seen = []                           # observed (s,a) keys, for sampling

    def _q_update(self, s, a, r, ns, done, ns_mask):
        """One Q-learning backup (masked bootstrap, no bootstrap past a terminal)."""
        row = self.row(s)
        nrow = self.row(ns)
        target = r if done else r + self.gamma * max(nrow[i] for i in self._valid(ns_mask))
        td = target - row[a]
        row[a] += self.alpha * td
        return td

    def _remember(self, s, a, r, ns, done, ns_mask):
        if (s, a) not in self.model:
            self.seen.append((s, a))
        self.model[(s, a)] = (r, ns, done, ns_mask)

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        td = self._q_update(s, a, r, ns, done, next_mask)   # learn from REAL experience
        self._record_td(td)
        self._remember(s, a, r, ns, done, next_mask)        # update the learned model
        self._plan()                                        # n imagined updates

    def _plan(self):
        raise NotImplementedError

    def reset_learning(self):
        super().reset_learning()
        self.model = {}
        self.seen = []


class DynaQ(_DynaBase):
    name = "Dyna-Q"

    def _plan(self):
        for _ in range(self.planning):
            if not self.seen:
                return
            s, a = self.rng.choice(self.seen)
            r, ns, done, ns_mask = self.model[(s, a)]
            self._q_update(s, a, r, ns, done, ns_mask)


class DynaQPlus(_DynaBase):
    name = "Dyna-Q+"

    def __init__(self, n_actions=N_ACTIONS, alpha=0.2, gamma=0.98, seed=0,
                 planning=10, kappa=1e-4):
        super().__init__(n_actions=n_actions, alpha=alpha, gamma=gamma, seed=seed,
                         planning=planning)
        # exploration-bonus weight. Dyna-Q+ adds kappa*sqrt(staleness) to planning
        # rewards to lure re-exploration - its point in NON-stationary worlds. Kept
        # SMALL (1e-4) so on a STATIC task the bonus never overtakes the real goal
        # value: at 1e-3 the greedy policy chases stale off-path actions forever and
        # never settles on the optimal path (verified by the sanity check).
        self.kappa = kappa
        self.t = 0              # real-step clock
        self.last = {}          # (s,a) -> the time it was last really tried

    def _remember(self, s, a, r, ns, done, ns_mask):
        self.t += 1
        # model EVERY action from a visited state (untried ones as a reward-0 self
        # loop) so the staleness bonus can pull planning toward exploring them
        for a2 in range(self.n_actions):
            if (s, a2) not in self.model:
                self.seen.append((s, a2))
                self.model[(s, a2)] = (0.0, s, False, None)
        self.model[(s, a)] = (r, ns, done, ns_mask)
        self.last[(s, a)] = self.t

    def _plan(self):
        for _ in range(self.planning):
            if not self.seen:
                return
            s, a = self.rng.choice(self.seen)
            r, ns, done, ns_mask = self.model[(s, a)]
            tau = self.t - self.last.get((s, a), 0)          # steps since last tried
            self._q_update(s, a, r + self.kappa * (tau ** 0.5), ns, done, ns_mask)

    def reset_learning(self):
        super().reset_learning()
        self.t = 0
        self.last = {}


class PrioritizedSweeping(_DynaBase):
    name = "Prioritized Sweeping"

    def __init__(self, n_actions=N_ACTIONS, alpha=0.2, gamma=0.98, seed=0,
                 planning=10, theta=1e-4):
        super().__init__(n_actions=n_actions, alpha=alpha, gamma=gamma, seed=seed,
                         planning=planning)
        self.theta = theta       # min priority worth queueing
        self.pqueue = []         # max-heap over |TD error| (priority negated)
        self.pred = {}           # ns -> set of (s,a) observed leading into ns

    def _priority(self, s, a):
        r, ns, done, ns_mask = self.model[(s, a)]
        row = self.row(s)
        nrow = self.row(ns)
        target = r if done else r + self.gamma * max(nrow[i] for i in self._valid(ns_mask))
        return abs(target - row[a])

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        # PS defers the update: it queues (s,a) by priority and the planning loop
        # below does the actual backups, most-urgent first + their predecessors.
        self._remember(s, a, r, ns, done, next_mask)
        self.pred.setdefault(ns, set()).add((s, a))
        p = self._priority(s, a)
        self._record_td(p)
        if p > self.theta:
            heapq.heappush(self.pqueue, (-p, s, a))
        self._plan()

    def _plan(self):
        for _ in range(self.planning):
            if not self.pqueue:
                break
            _, s, a = heapq.heappop(self.pqueue)
            r, ns, done, ns_mask = self.model[(s, a)]
            self._q_update(s, a, r, ns, done, ns_mask)
            for (ps, pa) in self.pred.get(s, ()):            # ripple back to predecessors
                if self._priority(ps, pa) > self.theta:
                    heapq.heappush(self.pqueue, (-self._priority(ps, pa), ps, pa))

    def reset_learning(self):
        super().reset_learning()
        self.pqueue = []
        self.pred = {}


DYNA_ALGORITHMS = {
    "dyna_q": DynaQ,
    "prioritized_sweeping": PrioritizedSweeping,
    "dyna_q_plus": DynaQPlus,
}


def is_dyna(algo):
    return algo in DYNA_ALGORITHMS


def make_dyna(algo, **kwargs):
    cls = DYNA_ALGORITHMS.get(algo, DynaQ)
    return cls(**kwargs)
