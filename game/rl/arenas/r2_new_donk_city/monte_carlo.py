"""Every-visit Monte-Carlo control - Round 2's Red default.

Monte Carlo learns from COMPLETE EPISODE RETURNS: nothing is updated while the
episode runs; when it ends, the discounted return G that actually followed each
visited (state, action) pair pulls its Q toward G. No bootstrapping, no model -
just experienced outcomes, which is why Round 2's long three-room tomato course
is its showcase (the only meaningful reward arrives far in the future).

"Every-visit": Q(s, a) is updated at EVERY occurrence of (s, a) in the episode
(contrast with ``first_visit_mc.py``, which updates only the first).
"""

from core.base_agent import Tabular


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
        # MC does not learn mid-episode: it only RECORDS the trajectory.
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

    def reset_learning(self):
        super().reset_learning()
        self._episode = []
