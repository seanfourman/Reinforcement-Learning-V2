"""Value Iteration - Round 1's Red default.

Each sweep applies the Bellman OPTIMALITY backup to every state:

    V(s) <- max_a  sum_s' P(s'|s,a) * [ r + gamma * V(s') ]

so the value function chases the optimum directly, and the policy is simply
read off greedily after every sweep. Watchable consequence: value spreads
outward from the goal one "ring" per sweep (the propagation animation).
"""

from .dp_base import _DPBase


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
