"""Actor-Critic - Round 5's Red default.

The genuine TD step between Monte-Carlo REINFORCE and PPO: an ACTOR (the
policy head) chooses actions, and a CRITIC (the value head) estimates V(s) so
the actor can be judged against expectation - the advantage A = R - V(s) -
instead of against raw returns.
"""

import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Categorical

from .pg_base import PGAgent


class ActorCritic(PGAgent):
    """A TRUE bootstrapping actor-critic (synchronous advantage AC / A2C-style).

    Instead of waiting for the whole episode (Monte-Carlo), it collects a short n-step
    rollout of `horizon` transitions and lets the CRITIC bootstrap: the target for step
    t is the n-step return R_t = r_t + gamma*r_{t+1} + ... + gamma^k * V(s_{t+k}) (V
    fills in the value BEYOND the rollout), and the advantage is A_t = R_t - V(s_t).
    That bootstrapping is what makes it a real critic (not just a baseline): it cuts the
    variance and, crucially, updates every `horizon` steps regardless of how long the
    episode is - so it is DECOUPLED from episode length and gets many updates where the
    Monte-Carlo version got one. Truncation is handled correctly (a timeout is NOT a
    terminal, so its tail is bootstrapped with V, not treated as zero).

    (The textbook distinction, Sutton & Barto 13.5 - REINFORCE-with-a-baseline is
    still Monte-Carlo and is NOT a real actor-critic; this one bootstraps.)

    Distinct from PPO: plain n-step returns (no clipped multi-epoch reuse), one
    SINGLE gradient step per rollout, a short horizon."""

    name = "Actor-Critic"
    has_critic = True
    value_coef = 0.5
    horizon = 64           # rollout length; an update fires every `horizon` steps
    lam = 0.95             # GAE lambda - trades bias for variance in the bootstrap

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        # accumulate the rollout; fire an update once it reaches the horizon. `done` is
        # the TRUE terminal flag (the match passes `terminated`, so a timeout is False).
        self.S.append(np.asarray(s, dtype=np.float32))
        self.A.append(int(a))
        self.R.append(float(r))
        self.Done.append(bool(done))
        self.NS.append(np.asarray(ns, dtype=np.float32))
        self.steps_seen += 1
        if len(self.S) >= self.horizon:
            self._update()

    def end_episode(self):
        # flush the trailing partial rollout so the episode's tail is not lost
        self._update()

    def _update(self):
        if not self.S:
            return
        S = torch.as_tensor(np.stack(self.S), device=self.device)
        A = torch.as_tensor(self.A, device=self.device).long()
        # advantages via GAE(lambda) off the CURRENT critic (bootstrapping the tail with
        # V(last next-state); the nonterminal gate stops it crossing a real terminal).
        with torch.no_grad():
            _, V_all = self.net(S)
            boot = self.state_value(self.NS[-1])
        V_np = V_all.cpu().numpy()
        T = len(self.R)
        adv = np.zeros(T, dtype=np.float32)
        gae = 0.0
        for t in range(T - 1, -1, -1):
            nonterminal = 0.0 if self.Done[t] else 1.0
            next_v = boot if t == T - 1 else float(V_np[t + 1])
            delta = self.R[t] + self.gamma * next_v * nonterminal - float(V_np[t])
            gae = delta + self.gamma * self.lam * nonterminal * gae
            adv[t] = gae
        returns = adv + V_np                       # critic target = advantage + V
        Adv = torch.as_tensor(adv, device=self.device)
        Ret = torch.as_tensor(returns, device=self.device)
        if Adv.numel() > 1:
            Adv = (Adv - Adv.mean()) / (Adv.std() + 1e-8)
        logits, V = self.net(S)
        dist = Categorical(logits=logits)
        logp = dist.log_prob(A)
        ent = dist.entropy().mean()
        ploss = -(logp * Adv).mean() - self.entropy_coef * ent
        vloss = nn.functional.smooth_l1_loss(V, Ret)   # critic regresses toward the return
        loss = ploss + self.value_coef * vloss
        self.opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(self.net.parameters(), 5.0)
        self.opt.step()
        self._smooth(ploss.item(), vloss.item(), ent.item())
        self._reset_buffers()
