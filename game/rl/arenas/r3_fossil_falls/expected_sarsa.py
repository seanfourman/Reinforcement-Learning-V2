"""Expected-SARSA - Round 3's alternate pick.

Sits between SARSA and Q-Learning: instead of bootstrapping on the single next
action taken (SARSA, noisy) or on the max (Q-Learning, biased optimistic), the
target is the EXPECTED next value under the current epsilon-greedy policy:

    E[Q(ns, .)] = (1 - eps) * max_a Q(ns, a) + eps * mean_a Q(ns, a)

Same expected update as SARSA but with the sampling variance of the next
action averaged out, so it converges more smoothly at the same step size.
"""

from core.base_agent import Tabular


class ExpectedSarsa(Tabular):
    name = "Expected-SARSA"

    def _expected(self, state, mask=None):
        """The policy's expected value at ``state`` over the VALID actions."""
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
