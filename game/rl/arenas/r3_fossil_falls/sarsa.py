"""SARSA - ON-policy TD control, Round 3's Red default.

Same one-step bootstrapping as Q-Learning, but the target uses Q(ns, na) where
``na`` is the action the policy ACTUALLY takes next (State, Action, Reward,
next State, next Action - hence the name). Learning about the policy being
followed - exploration mistakes included - is what ON-policy means, and it is
the round's contrast with off-policy Q-Learning: SARSA learns safer, more
"realistic" values near hazards because its target includes its own epsilon
slips.
"""

from core.base_agent import Tabular


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
