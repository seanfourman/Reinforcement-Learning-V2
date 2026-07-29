"""The base policy-gradient agent for the Tostarena arena (Round 5) - the
POLICY-based counterpart to Round 4's value-based DQN family.

Where DQN learns Q(s,a) and acts greedily, these learn the policy pi(a|s)
DIRECTLY: a small MLP maps the continuous observation to logits over the
discrete thrusts, and a categorical sample IS the action. Learning nudges those
logits toward higher expected return. The three variants (increasing
sophistication) live beside this file: ``reinforce.py`` (Monte-Carlo policy
gradient), ``actor_critic.py`` (a bootstrapping critic), ``ppo.py`` (clipped
multi-epoch updates).

Same agent interface as the DQN family and the tabular learners
(policy_action / learn_step / end_episode / q_values / state_value /
set_epsilon / reset_learning / learned_count, an alpha property + gamma attr),
so the tournament drives them unchanged. A few notes on the mapping onto that
value-shaped interface:

  * policy_action SAMPLES from pi (that stochasticity IS the exploration - there is
    no epsilon-greedy here, so set_epsilon is a no-op and epsilon reads back 0).
  * greedy_action / q_values expose the LOGITS, so the arena value/policy field and
    the action-arrows still render (argmax logit = greedy action; the logit surface
    stands in for the "value" heat - a policy method has action preferences, not Qs).
  * value_advantage returns None (that split is a Dueling-DQN artifact); va_probe
    then reports unavailable for these rounds, as it does for plain DQN.
"""

import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Categorical


class PolicyNet(nn.Module):
    """Shared Tanh trunk -> policy logits, plus an optional value head. Tanh (not
    ReLU) is the usual choice for policy nets: bounded activations keep the logits
    - and therefore the action distribution - from swinging wildly between updates."""

    def __init__(self, obs_dim, n_actions, hidden=128, value_head=False):
        super().__init__()
        self.trunk = nn.Sequential(
            nn.Linear(obs_dim, hidden), nn.Tanh(),
            nn.Linear(hidden, hidden), nn.Tanh(),
        )
        self.pi = nn.Linear(hidden, n_actions)
        self.v = nn.Linear(hidden, 1) if value_head else None

    def forward(self, x):
        h = self.trunk(x)
        logits = self.pi(h)
        v = self.v(h).squeeze(-1) if self.v is not None else None
        return logits, v


class PGAgent:
    """Base policy-gradient agent: everything the match interface needs EXCEPT the
    update rule, which each subclass supplies. Subclasses set `has_critic` and
    implement `_update(...)` (called from end_episode and/or learn_step)."""

    name = "Policy Gradient"
    has_critic = False
    entropy_coef = 0.01     # small bonus that keeps the policy from collapsing early

    def __init__(self, obs_dim, n_actions, alpha=0.2, gamma=0.98, seed=0, hidden=128,
                 entropy_coef=None, lam=None, value_coef=None, horizon=None,
                 clip=None, epochs=None, minibatch=None):
        self.obs_dim = obs_dim
        self.n_actions = n_actions
        self.hidden = hidden
        self.gamma = gamma
        self.epsilon = 0.0          # unused: PG explores via policy entropy, not eps
        # weight init uses the GLOBAL torch RNG (same caveat as the DQN family):
        # reproducible per-process, but not bit-identical across construction order.
        torch.manual_seed(seed)
        self.device = torch.device("cpu")
        self.net = PolicyNet(obs_dim, n_actions, hidden, value_head=self.has_critic).to(self.device)
        self._alpha = alpha
        self.opt = torch.optim.Adam(self.net.parameters(), lr=self._lr(alpha))
        # per-episode trajectory (REINFORCE / Actor-Critic accumulate here and flush
        # in end_episode). PPO overrides with a horizon rollout buffer.
        self._reset_buffers()
        # --- live training diagnostics (surfaced to the dashboard) ---
        self.steps_seen = 0         # transitions observed (comparable to DQN train_steps)
        self.updates = 0            # gradient updates performed
        self.ploss_ema = 0.0        # smoothed policy(-surrogate) loss
        self.vloss_ema = 0.0        # smoothed value loss (0 for REINFORCE)
        self.entropy_ema = 0.0      # smoothed policy entropy (the exploration measure)
        # optional hyperparameter overrides from the panel (None = keep the class
        # default; attrs the algo doesn't use are simply ignored by it)
        for _name, _val, _cast in (("entropy_coef", entropy_coef, float),
                                   ("lam", lam, float), ("value_coef", value_coef, float),
                                   ("horizon", horizon, int), ("clip", clip, float),
                                   ("epochs", epochs, int), ("minibatch", minibatch, int)):
            if _val is not None:
                setattr(self, _name, _cast(_val))

    # alpha (panel "learning rate") maps onto the Adam lr, kept gentle: policy
    # gradients are far more step-size sensitive than value regression.
    @staticmethod
    def _lr(alpha):
        return max(1e-4, float(alpha) * 1.5e-3)   # alpha 0.2 -> 3e-4 (a safe PG lr)

    @property
    def alpha(self):
        return self._alpha

    @alpha.setter
    def alpha(self, v):
        self._alpha = v
        for g in self.opt.param_groups:
            g["lr"] = self._lr(v)

    def _reset_buffers(self):
        self.S, self.A, self.R, self.Done, self.NS = [], [], [], [], []

    # ------------------------------------------------------------- inference
    def _forward(self, state):
        t = torch.as_tensor(np.asarray(state, dtype=np.float32), device=self.device).unsqueeze(0)
        return self.net(t)

    def _logits(self, state):
        with torch.no_grad():
            logits, _ = self._forward(state)
            return logits[0]

    def policy_action(self, state, mask=None):
        # SAMPLE from pi (mask ignored - the arena action space is open). The sample
        # is the on-policy behaviour the gradient estimator assumes.
        logits = self._logits(state)
        return int(Categorical(logits=logits).sample().item())

    def greedy_action(self, state, mask=None):
        return int(torch.argmax(self._logits(state)).item())

    def q_values(self, state):
        # the arena field reads this as a per-action score: argmax = greedy action,
        # max = the "value" heat. For a policy method those scores ARE the logits.
        return [round(float(x), 4) for x in self._logits(state).tolist()]

    def state_value(self, state):
        # critic V(s) when there is one; else the top logit as a rough desirability.
        if self.has_critic:
            with torch.no_grad():
                _, v = self._forward(state)
                return float(v[0].item())
        return float(torch.max(self._logits(state)).item())

    def value(self, state):
        return self.state_value(state)

    def value_advantage(self, state):
        return None                 # V/A split is a Dueling-DQN artifact, not PG's

    def learned_count(self):
        return self.steps_seen

    def set_epsilon(self, eps):
        self.epsilon = 0.0          # PG has no epsilon-greedy dial

    def td_error(self):
        # the learning-signal chart wants one scalar: the smoothed policy loss stands
        # in for the tabular |TD error| / DQN Huber loss.
        return abs(self.ploss_ema)

    def diag(self):
        """Live PG training internals for the dashboard (mirrors the DQN diag shape
        but flagged isPG, with policy/value/entropy in place of buffer/target-sync)."""
        return {
            "isDQN": False,
            "isPG": True,
            "algo": self.name,
            "hasCritic": self.has_critic,
            "policyLoss": round(self.ploss_ema, 5),
            "valueLoss": round(self.vloss_ema, 5),
            "entropy": round(self.entropy_ema, 4),
            "updates": self.updates,
            "trainSteps": self.steps_seen,
            "pending": len(self.S),
            "lr": round(self._lr(self._alpha), 6),
        }

    def reset_learning(self):
        torch.manual_seed(0)
        self.net = PolicyNet(self.obs_dim, self.n_actions, self.hidden,
                             value_head=self.has_critic).to(self.device)
        self.opt = torch.optim.Adam(self.net.parameters(), lr=self._lr(self._alpha))
        self._reset_buffers()
        self.epsilon = 0.0
        self.steps_seen = 0
        self.updates = 0
        self.ploss_ema = 0.0
        self.vloss_ema = 0.0
        self.entropy_ema = 0.0

    # ------------------------------------------------------------- collection
    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        # store the transition; the actual gradient step happens per-episode
        # (REINFORCE / AC, in end_episode) or per-horizon (PPO, overridden there).
        self.S.append(np.asarray(s, dtype=np.float32))
        self.A.append(int(a))
        self.R.append(float(r))
        self.Done.append(bool(done))    # done = TRUE terminal (match passes terminated)
        self.NS.append(np.asarray(ns, dtype=np.float32))
        self.steps_seen += 1

    def _returns(self, bootstrap=0.0):
        """Discounted return G_t for the buffered episode (Monte-Carlo). bootstrap is
        V(last next-state) when the episode was CUT by a timeout rather than a real
        terminal, so the truncated tail is not treated as zero-value."""
        out = [0.0] * len(self.R)
        g = bootstrap
        for t in range(len(self.R) - 1, -1, -1):
            g = self.R[t] + self.gamma * g
            out[t] = g
        return out

    def _smooth(self, ploss, vloss, entropy):
        self.ploss_ema = 0.95 * self.ploss_ema + 0.05 * float(ploss)
        self.vloss_ema = 0.95 * self.vloss_ema + 0.05 * float(vloss)
        self.entropy_ema = 0.9 * self.entropy_ema + 0.1 * float(entropy)
        self.updates += 1

    def end_episode(self):
        raise NotImplementedError
