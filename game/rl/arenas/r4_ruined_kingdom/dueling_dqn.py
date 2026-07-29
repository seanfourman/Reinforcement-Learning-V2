"""Dueling-DQN - Round 4's alternate pick.

Differs from vanilla DQN in the NETWORK HEAD only: instead of one linear layer
emitting Q(s,a) directly, a shared trunk splits into a state VALUE head V(s)
and an ADVANTAGE head A(s,a), recombined as

    Q(s,a) = V(s) + A(s,a) - mean_a A(s,a)

so the net can learn how good a STATE is without needing to nail every action
(in a missile storm, most of the value is "where you stand", not tiny action
differences). The mean subtraction pins down the V/A split, which is otherwise
only identified up to a constant. The target rule stays the vanilla max, so
the ONLY experimental variable vs DQN is the head.
"""

import numpy as np
import torch
import torch.nn as nn

from .dqn import DQNAgent, _mlp


class DuelingQNet(nn.Module):
    """Shared trunk -> V(s) head + A(s,a) head, Q = V + A - mean(A)."""

    def __init__(self, obs_dim, n_actions, hidden=128, layers=2):
        super().__init__()
        self.trunk = nn.Sequential(*_mlp(obs_dim, hidden, layers))
        self.value = nn.Linear(hidden, 1)
        self.adv = nn.Linear(hidden, n_actions)

    def forward(self, x):
        h = self.trunk(x)
        v = self.value(h)
        a = self.adv(h)
        return v + a - a.mean(dim=-1, keepdim=True)


class DuelingDQNAgent(DQNAgent):
    name = "Dueling-DQN"
    dueling = True
    net_cls = DuelingQNet     # vanilla max target: the head is the only change

    def value_advantage(self, state):
        """{v, a:[...]} - the V(s) / centered-A(s,a) split at ``state``, for the
        dashboard's V/A probe (plain nets return None from the base class)."""
        with torch.no_grad():
            t = torch.as_tensor(np.asarray(state, dtype=np.float32), device=self.device).unsqueeze(0)
            h = self.q.trunk(t)
            v = float(self.q.value(h)[0, 0].item())
            a = self.q.adv(h)[0]
            a = (a - a.mean()).tolist()
            return {"v": round(v, 4), "a": [round(float(x), 4) for x in a]}
