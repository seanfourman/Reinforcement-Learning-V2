"""First-visit Monte-Carlo control - Round 2's Blue default.

Identical to every-visit MC (``monte_carlo.py``) except for the classic
textbook contrast: the return G updates Q(s, a) only at the FIRST time each
(state, action) pair appears in the episode. Later revisits inside the same
episode contribute nothing, which makes each update an unbiased sample of the
return from that pair (every-visit's repeats are correlated within an episode).
"""

from .monte_carlo import MonteCarlo


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
