"""Policy Iteration (truncated) - Round 1's Blue default.

The two-phase DP method: EVALUATE the current policy (compute its value), then
IMPROVE it greedily against that value, and repeat until the policy stops
changing. Contrast with Value Iteration, which fuses both into one max-backup.
"""

from .dp_base import _DPBase


class PolicyIteration(_DPBase):
    """TRUNCATED (a.k.a. modified) policy iteration: a fixed budget of synchronous
    policy-EVALUATION passes, THEN one greedy IMPROVEMENT, repeat. Running evaluation to
    full convergence before every improvement (classic PI) needs hundreds of sweeps at
    gamma~0.98 over this state space - far too slow for the live race - and "several
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
                if best_a != self.policy[s]:
                    self.policy[s] = best_a
                    changed += 1
            self.policy_changes.append(changed)
            self._eval_since = 0
            # converged only when the policy is stable AND its value has settled
            if changed == 0 and delta < self.theta:
                self.converged = True
