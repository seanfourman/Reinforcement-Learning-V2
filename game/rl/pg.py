"""Policy-gradient agents for the continuous arena (Round 5) - the POLICY-based
counterpart to Round 4's value-based DQN family. Where DQN learns Q(s,a) and acts
greedily, these learn the policy pi(a|s) DIRECTLY: a small MLP maps the continuous
observation to logits over the 9 discrete thrusts, and a categorical sample IS the
action. Learning nudges those logits toward higher expected return.

Three variants, increasing sophistication (matches the "Policy Gradient" card):

  REINFORCE     - the basic Monte-Carlo policy gradient. Play a whole episode, then
                  push up the log-prob of each action in proportion to the (whitened)
                  return that followed it. No critic, so high variance - exactly the
                  card's framing.
  Actor-Critic  - add a value head (the CRITIC). The actor is updated by the
                  ADVANTAGE A = G - V(s) instead of the raw return, and the critic
                  regresses V toward G. Same gradient idea, far lower variance.
  PPO           - the modern workhorse. Collect a fixed-horizon rollout, estimate
                  advantages with GAE, then take several CLIPPED policy steps: the
                  probability ratio pi_new/pi_old is clamped to [1-eps, 1+eps] so one
                  batch can't move the policy too far. Stable, sample-efficient.

Same agent interface as dqn.py / agents.py (policy_action / learn_step /
end_episode / q_values / state_value / set_epsilon / reset_learning /
learned_count, an alpha property + gamma attr), so match.py drives them unchanged.
A few notes on the mapping onto that value-shaped interface:

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

    def __init__(self, obs_dim, n_actions, alpha=0.2, gamma=0.98, seed=0, hidden=128):
        self.obs_dim = obs_dim
        self.n_actions = n_actions
        self.hidden = hidden
        self.gamma = gamma
        self.epsilon = 0.0          # unused: PG explores via policy entropy, not eps
        # weight init uses the GLOBAL torch RNG (same caveat as dqn.py): reproducible
        # per-process, but not bit-identical across construction order.
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
        """Live PG training internals for the dashboard (mirrors dqn.diag's shape but
        flagged isPG, with policy/value/entropy in place of buffer/target-sync)."""
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
        # (REINFORCE / AC, in end_episode) or per-horizon (PPO, overridden below).
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


class ActorCritic(PGAgent):
    name = "Actor-Critic"
    has_critic = True
    value_coef = 0.5

    def end_episode(self):
        if not self.S:
            return
        # bootstrap the tail only if the episode was truncated (last step not terminal)
        boot = 0.0
        if not self.Done[-1]:
            boot = self.state_value(self.NS[-1])
        returns = self._returns(bootstrap=boot)
        S = torch.as_tensor(np.stack(self.S), device=self.device)
        A = torch.as_tensor(self.A, device=self.device).long()
        G = torch.as_tensor(returns, device=self.device).float()
        logits, V = self.net(S)
        dist = Categorical(logits=logits)
        logp = dist.log_prob(A)
        ent = dist.entropy().mean()
        adv = G - V.detach()                       # critic judges: advantage
        if adv.numel() > 1:
            adv = (adv - adv.mean()) / (adv.std() + 1e-8)
        ploss = -(logp * adv).mean() - self.entropy_coef * ent
        vloss = nn.functional.smooth_l1_loss(V, G)  # critic regresses toward the return
        loss = ploss + self.value_coef * vloss
        self.opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(self.net.parameters(), 5.0)
        self.opt.step()
        self._smooth(ploss.item(), vloss.item(), ent.item())
        self._reset_buffers()


class PPO(PGAgent):
    """Proximal Policy Optimization (clipped). Collects a fixed-horizon rollout across
    episode boundaries, estimates advantages with GAE(lambda), then runs K epochs of
    minibatched CLIPPED updates. The clip on the pi_new/pi_old ratio is what keeps
    each batch's policy step small and stable."""

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


PG_ALGORITHMS = {"reinforce": REINFORCE, "actor_critic": ActorCritic, "ppo": PPO}


def is_pg(algo):
    return algo in PG_ALGORITHMS


def make_pg(algo, obs_dim, n_actions, **kwargs):
    cls = PG_ALGORITHMS.get(algo, REINFORCE)
    return cls(obs_dim=obs_dim, n_actions=n_actions, **kwargs)


# --------------------------------------------------------------------- self-test
if __name__ == "__main__":
    import sys
    from collections import deque
    from continuous import ContinuousArena, N_ACTIONS

    # Round-5 Capture-the-Flag smoke test: can this PG variant learn the CARRY LOOP at
    # all? Blue COASTS (never contests), so Red only has to grab the flag and haul it to
    # its base three times (crates + power-ups are optional bonuses). A learner should
    # climb to capturing every episode; the full opponent-aware self-play (both sides
    # learning to steal/evade/use crates) is what happens in the live tournament - this
    # is just the single-agent learnability check.
    which = sys.argv[1] if len(sys.argv) > 1 else "ppo"
    env = ContinuousArena(seed=0, round_id=5, theme="tostarena")
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
