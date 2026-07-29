"""REINFORCE - the basic Monte-Carlo policy gradient (Round 5 alternate pick).

Play a whole episode, then push up the log-probability of each action taken in
proportion to the (whitened) return that followed it:

    loss = - mean_t [ log pi(a_t | s_t) * G_t ]  - entropy bonus

No critic, no bootstrapping: G_t is the REAL discounted return, so the gradient
is unbiased but HIGH-VARIANCE - one lucky episode swings the whole update.
That variance is exactly what the Actor-Critic and PPO variants then fix.
"""

import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Categorical

from .pg_base import PGAgent


class REINFORCE(PGAgent):
    name = "REINFORCE"
    has_critic = False

    def end_episode(self):
        if not self.S:
            return
        returns = self._returns(bootstrap=0.0)
        S = torch.as_tensor(np.stack(self.S), device=self.device)
        A = torch.as_tensor(self.A, device=self.device).long()
        G = torch.as_tensor(returns, device=self.device).float()
        # whiten the returns (subtract mean, scale by std): the textbook cheap
        # variance reducer for baseline-free REINFORCE. Still just the score * return.
        if G.numel() > 1:
            G = (G - G.mean()) / (G.std() + 1e-8)
        logits, _ = self.net(S)
        dist = Categorical(logits=logits)
        logp = dist.log_prob(A)
        ent = dist.entropy().mean()
        loss = -(logp * G).mean() - self.entropy_coef * ent
        self.opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(self.net.parameters(), 5.0)
        self.opt.step()
        self._smooth(loss.item(), 0.0, ent.item())
        self._reset_buffers()
