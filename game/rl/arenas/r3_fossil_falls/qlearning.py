"""Q-Learning - OFF-policy TD control, Round 3's Blue default.

The temporal-difference idea: instead of waiting for the episode's real return
(Monte Carlo), bootstrap after ONE step - the target is the immediate reward
plus the discounted value of the next state. Q-Learning's target uses
``max_a' Q(ns, a')``: the value of the BEST next action, regardless of what
the exploring policy actually does next. That makes it OFF-policy - it learns
the greedy (optimal) policy while behaving epsilon-greedily.
"""

from core.base_agent import Tabular


class QLearning(Tabular):
    name = "Q-learning"

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        # target = r + gamma * max_a' Q(ns, a') over the EFFECTIVE next actions
        # (next_mask), so a never-updated wall-bump can't pollute the max.
        row = self.row(s)
        nrow = self.row(ns)
        target = r if done else r + self.gamma * max(nrow[i] for i in self._valid(next_mask))
        td = target - row[a]
        row[a] += self.alpha * td
        self._record_td(td)
