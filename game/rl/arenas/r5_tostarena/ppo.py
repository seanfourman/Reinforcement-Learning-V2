"""PPO (Proximal Policy Optimization, clipped) - Round 5's Blue default.

The modern policy-gradient workhorse. Collect a fixed-horizon rollout (across
episode boundaries), estimate advantages with GAE(lambda), then run K epochs of
minibatched updates where the probability ratio pi_new/pi_old is CLAMPED to
[1-clip, 1+clip]:

    loss = - min( ratio * A,  clamp(ratio, 1-clip, 1+clip) * A )

The clip is what keeps each batch's policy step small and stable: once the new
policy has moved a clip's-worth away from the behaviour policy, the gradient
for that sample switches off, so no batch can drag the policy off a cliff.
Stable AND sample-efficient (each rollout is reused for several epochs).
"""

import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Categorical

from .pg_base import PGAgent


class PPO(PGAgent):
    name = "PPO"
    has_critic = True
    horizon = 512           # steps collected before an update
    epochs = 4              # optimization passes over each rollout
    minibatch = 128
    clip = 0.2
    lam = 0.95              # GAE lambda
    value_coef = 0.5

    def _reset_buffers(self):
        super()._reset_buffers()
        self.LogpOld, self.Vold, self.Boundary = [], [], []

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        # cache the OLD policy's log-prob + value at collection time (PPO needs the
        # behaviour policy to form the clipped ratio, and GAE needs V(s)).
        with torch.no_grad():
            logits, v = self._forward(s)
            logp = Categorical(logits=logits[0]).log_prob(torch.tensor(int(a)))
        self.S.append(np.asarray(s, dtype=np.float32))
        self.A.append(int(a))
        self.R.append(float(r))
        self.Done.append(bool(done))
        self.NS.append(np.asarray(ns, dtype=np.float32))
        self.LogpOld.append(float(logp.item()))
        self.Vold.append(float(v[0].item()))
        self.Boundary.append(False)     # end_episode marks the true episode ends
        self.steps_seen += 1
        if len(self.S) >= self.horizon:
            self._update()

    def end_episode(self):
        # mark the episode boundary so GAE does not bleed advantage across resets,
        # but do NOT force an update - PPO updates on the horizon, not per episode.
        if self.Boundary:
            self.Boundary[-1] = True

    def _gae(self):
        T = len(self.R)
        # value after the final buffered step: 0 if it ended an episode, else bootstrap
        last_boundary = self.Boundary[-1]
        boot = 0.0 if (last_boundary and self.Done[-1]) else \
            (0.0 if last_boundary else self.state_value(self.NS[-1]))
        adv = [0.0] * T
        gae = 0.0
        for t in range(T - 1, -1, -1):
            nonterminal = 0.0 if self.Boundary[t] else 1.0
            next_v = boot if t == T - 1 else self.Vold[t + 1]
            delta = self.R[t] + self.gamma * next_v * nonterminal - self.Vold[t]
            gae = delta + self.gamma * self.lam * nonterminal * gae
            adv[t] = gae
        ret = [adv[t] + self.Vold[t] for t in range(T)]
        return adv, ret

    def _update(self):
        if not self.S:
            return
        adv, ret = self._gae()
        S = torch.as_tensor(np.stack(self.S), device=self.device)
        A = torch.as_tensor(self.A, device=self.device).long()
        old_logp = torch.as_tensor(self.LogpOld, device=self.device).float()
        Adv = torch.as_tensor(adv, device=self.device).float()
        Ret = torch.as_tensor(ret, device=self.device).float()
        Adv = (Adv - Adv.mean()) / (Adv.std() + 1e-8)

        n = S.shape[0]
        idx = np.arange(n)
        pl = vl = en = 0.0
        passes = 0
        for _ in range(self.epochs):
            np.random.shuffle(idx)
            for start in range(0, n, self.minibatch):
                mb = idx[start:start + self.minibatch]
                mbt = torch.as_tensor(mb, device=self.device).long()
                logits, V = self.net(S[mbt])
                dist = Categorical(logits=logits)
                logp = dist.log_prob(A[mbt])
                ratio = torch.exp(logp - old_logp[mbt])
                a_mb = Adv[mbt]
                unclipped = ratio * a_mb
                clipped = torch.clamp(ratio, 1 - self.clip, 1 + self.clip) * a_mb
                ploss = -torch.min(unclipped, clipped).mean()
                vloss = nn.functional.smooth_l1_loss(V, Ret[mbt])
                ent = dist.entropy().mean()
                loss = ploss + self.value_coef * vloss - self.entropy_coef * ent
                self.opt.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(self.net.parameters(), 5.0)
                self.opt.step()
                pl += ploss.item(); vl += vloss.item(); en += ent.item(); passes += 1
        if passes:
            self._smooth(pl / passes, vl / passes, en / passes)
        self._reset_buffers()


# --------------------------------------------------------------------- self-test
if __name__ == "__main__":
    # Round-5 Capture-the-Flag smoke test: can this PG variant learn the CARRY LOOP at
    # all? Blue COASTS (never contests), so Red only has to grab the flag and haul it to
    # its base three times (crates + power-ups are optional bonuses). A learner should
    # climb to capturing every episode; the full opponent-aware self-play (both sides
    # learning to steal/evade/use crates) is what happens in the live tournament - this
    # is just the single-agent learnability check.
    import os
    import sys
    from collections import deque

    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
    from core.continuous_arena import N_ACTIONS
    from core.registry import make_pg
    from arenas.r5_tostarena.arena import CtfArena

    which = sys.argv[1] if len(sys.argv) > 1 else "ppo"
    env = CtfArena(seed=0, round_id=5, theme="tostarena")
    agent = make_pg(which, env.obs_dim, N_ACTIONS, alpha=0.2, gamma=0.99, seed=0)
    print(f"training {agent.name} on Capture the Flag (Red learns, Blue coasts) ...")

    EPISODES = 1500
    recent = deque(maxlen=100)
    recent_caps = deque(maxlen=100)
    for ep in range(EPISODES):
        (s, _), _ = env.reset(seed=10_000 + ep)
        a = agent.policy_action(s)
        done = False
        info = {"winner": None}
        while not done:
            (ns, _), rew, done, trunc, info = env.step(a, 8)     # blue coasts (action 8)
            na = agent.policy_action(ns) if not done else 0
            agent.learn_step(s, a, rew["red"], ns, na, done and not trunc)
            s, a = ns, na
        agent.end_episode()
        recent.append(1 if info["winner"] == "red" else 0)
        recent_caps.append(env.captures["red"])
        if (ep + 1) % 100 == 0:
            d = agent.diag()
            print(f"ep {ep + 1:4d}  winrate(last100) {sum(recent) / len(recent):.2f}  "
                  f"captures/ep {sum(recent_caps) / len(recent_caps):.2f}  "
                  f"ploss {d['policyLoss']:+.4f}  vloss {d['valueLoss']:.4f}  ent {d['entropy']:.3f}")
    final = sum(recent_caps) / len(recent_caps)
    print(f"FINAL captures/ep (last 100): {final:.2f}  ->  "
          f"{'OK' if final >= 2.0 else 'WARN: weak carry loop'}")
