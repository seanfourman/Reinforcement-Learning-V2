"""DQN + Double-DQN + Dueling-DQN for the Ruined Kingdom continuous arena (Round 4) -
the value-based deep round of the syllabus (Round 5, the policy round, is Actor-Critic
vs PPO in pg.py). Same agent interface as the
tabular learners in agents.py (policy_action / learn_step / end_episode /
q_values / state_value / set_epsilon / learned_count, with alpha/gamma/epsilon),
so match.py drives them unchanged - but the action-value function is a small MLP
over the continuous observation vector instead of a dict, trained off a replay
buffer against a periodically-synced target network.

Double-DQN differs in the bootstrap target only: vanilla DQN uses
    max_a' Q_target(s', a')
which over-estimates; Double-DQN decouples action SELECTION (online net) from its
EVALUATION (target net):
    Q_target(s', argmax_a' Q_online(s', a'))

Dueling-DQN (an alternate pick, not a round default) differs in the NETWORK HEAD
only: instead of one linear layer emitting Q(s,a) directly, a shared trunk splits
into a state VALUE head V(s) and an ADVANTAGE head A(s,a), recombined as
    Q(s,a) = V(s) + A(s,a) - mean_a A(s,a)
so the net can learn how good a STATE is without needing to nail every action.
Target rule stays the vanilla max, so the ONLY experimental variable vs DQN is the head.
"""

import random
from collections import deque

import numpy as np
import torch
import torch.nn as nn


class QNet(nn.Module):
    def __init__(self, obs_dim, n_actions, hidden=128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(obs_dim, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, n_actions),
        )

    def forward(self, x):
        return self.net(x)


class DuelingQNet(nn.Module):
    """Shared trunk -> V(s) head + A(s,a) head, Q = V + A - mean(A). The mean
    subtraction pins down the V/A split (they are otherwise only identified up
    to a constant)."""

    def __init__(self, obs_dim, n_actions, hidden=128):
        super().__init__()
        self.trunk = nn.Sequential(
            nn.Linear(obs_dim, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
        )
        self.value = nn.Linear(hidden, 1)
        self.adv = nn.Linear(hidden, n_actions)

    def forward(self, x):
        h = self.trunk(x)
        v = self.value(h)
        a = self.adv(h)
        return v + a - a.mean(dim=-1, keepdim=True)


class DQNAgent:
    name = "DQN"
    double = False
    net_cls = QNet

    def __init__(self, obs_dim, n_actions, alpha=0.2, gamma=0.98, seed=0,
                 buffer=50_000, batch=64, warmup=1_000, target_sync=500, hidden=128):
        self.obs_dim = obs_dim
        self.n_actions = n_actions
        self.hidden = hidden
        self.gamma = gamma
        self.epsilon = 1.0
        self.rng = random.Random(seed)
        # NOTE: weight init uses the GLOBAL torch RNG, so building two agents (or a
        # reset) reseeds shared state - "seeded" runs are reproducible per-process
        # but not bit-identical across construction orders. Buffer sampling +
        # epsilon-greedy use the instance-local self.rng, which IS isolated. The nets
        # have no stochastic layers after init, so this only affects initial weights.
        torch.manual_seed(seed)
        self.device = torch.device("cpu")
        self.q = self.net_cls(obs_dim, n_actions, hidden).to(self.device)
        self.target = self.net_cls(obs_dim, n_actions, hidden).to(self.device)
        self.target.load_state_dict(self.q.state_dict())
        self.target.eval()
        self._alpha = alpha
        self.opt = torch.optim.Adam(self.q.parameters(), lr=self._lr(alpha))
        self.buf = deque(maxlen=buffer)
        self.batch = batch
        self.warmup = warmup
        self.target_sync = target_sync
        self.train_steps = 0
        # --- live training diagnostics (surfaced to the dashboard) ---
        self.loss_ema = 0.0         # smoothed Huber TD loss
        self.grad_ema = 0.0         # smoothed pre-clip gradient L2 norm
        self.q_pred_ema = 0.0       # smoothed mean predicted max-Q (overestimation)
        self.sync_count = 0

    # alpha (panel "learning rate") maps onto the Adam lr; keep the attribute so
    # the match loop's `agent.alpha = ...` just works and retunes the optimizer.
    @staticmethod
    def _lr(alpha):
        return max(2e-4, float(alpha) * 5e-3)   # alpha 0.2 -> 1e-3 (stable Adam range)

    @property
    def alpha(self):
        return self._alpha

    @alpha.setter
    def alpha(self, v):
        self._alpha = v
        for g in self.opt.param_groups:
            g["lr"] = self._lr(v)

    # ------------------------------------------------------------- inference
    def _q_row(self, state):
        with torch.no_grad():
            t = torch.as_tensor(np.asarray(state, dtype=np.float32), device=self.device)
            return self.q(t.unsqueeze(0))[0]

    def greedy_action(self, state, mask=None):
        # mask is accepted for a uniform agent API but ignored: the DQN arenas are
        # OPEN (continuous, no grid walls), so there are no wall-bump actions to mask.
        return int(torch.argmax(self._q_row(state)).item())

    def policy_action(self, state, mask=None):
        if self.rng.random() < self.epsilon:
            return self.rng.randrange(self.n_actions)
        return self.greedy_action(state)

    def q_values(self, state):
        return [round(float(x), 4) for x in self._q_row(state).tolist()]

    def state_value(self, state):
        return float(torch.max(self._q_row(state)).item())

    def value(self, state):
        return self.state_value(state)

    def learned_count(self):
        return self.train_steps

    def set_epsilon(self, eps):
        self.epsilon = eps

    def reset_learning(self):
        self.q = self.net_cls(self.obs_dim, self.n_actions, self.hidden).to(self.device)
        self.target = self.net_cls(self.obs_dim, self.n_actions, self.hidden).to(self.device)
        self.target.load_state_dict(self.q.state_dict())
        self.target.eval()   # keep the target net in eval mode (matches __init__)
        self.opt = torch.optim.Adam(self.q.parameters(), lr=self._lr(self._alpha))
        self.buf.clear()
        self.train_steps = 0
        self.epsilon = 1.0
        self.loss_ema = 0.0
        self.grad_ema = 0.0
        self.q_pred_ema = 0.0
        self.sync_count = 0

    # ------------------------------------------------------------- learning
    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        # next_mask is unused (the continuous arenas have an open action space with
        # no wall-bumps to exclude); accepted to match the learner interface.
        self.buf.append((np.asarray(s, dtype=np.float32), int(a), float(r),
                         np.asarray(ns, dtype=np.float32), bool(done)))
        if len(self.buf) < max(self.batch, self.warmup):
            return
        # sample from a list snapshot: random.sample indexes its population, and a
        # deque indexes in O(n), so sampling the deque directly is O(batch x buffer).
        # A one-shot list() copy (cheap - it only copies tuple references) makes each
        # draw O(1), so the minibatch build is O(buffer) instead.
        batch = self.rng.sample(list(self.buf), self.batch)
        s_b = torch.as_tensor(np.stack([b[0] for b in batch]), device=self.device)
        a_b = torch.as_tensor([b[1] for b in batch], device=self.device).long().unsqueeze(1)
        r_b = torch.as_tensor([b[2] for b in batch], device=self.device).float().unsqueeze(1)
        ns_b = torch.as_tensor(np.stack([b[3] for b in batch]), device=self.device)
        d_b = torch.as_tensor([b[4] for b in batch], device=self.device).float().unsqueeze(1)

        q_sa = self.q(s_b).gather(1, a_b)
        with torch.no_grad():
            if self.double:
                next_a = torch.argmax(self.q(ns_b), dim=1, keepdim=True)
                next_q = self.target(ns_b).gather(1, next_a)
            else:
                next_q = self.target(ns_b).max(dim=1, keepdim=True).values
            target = r_b + self.gamma * next_q * (1.0 - d_b)
        loss = nn.functional.smooth_l1_loss(q_sa, target)
        self.opt.zero_grad()
        loss.backward()
        gnorm = nn.utils.clip_grad_norm_(self.q.parameters(), 10.0)  # returns pre-clip norm
        self.opt.step()

        self.train_steps += 1
        # smooth the loss, grad norm, and the bootstrap next-state value (next_q).
        # THIS is the quantity the max operator over-estimates: vanilla DQN uses
        # target.max (optimistic), Double-DQN decouples select/evaluate (corrected),
        # so tracking next_q surfaces the DQN vs Double-DQN overestimation contrast.
        # (The earlier q_sa.mean() measured the Q of buffer actions - not the max.)
        self.loss_ema = 0.99 * self.loss_ema + 0.01 * float(loss.item())
        self.grad_ema = 0.9 * self.grad_ema + 0.1 * float(gnorm)
        self.q_pred_ema = 0.99 * self.q_pred_ema + 0.01 * float(next_q.mean().item())
        if self.train_steps % self.target_sync == 0:
            self.target.load_state_dict(self.q.state_dict())
            self.sync_count += 1

    def td_error(self):
        # the DQN analogue of the tabular TD error is the batch (Huber) loss
        return self.loss_ema

    def diag(self):
        """Live DQN training internals for the dashboard (loss, grad, buffer, sync)."""
        cap = self.buf.maxlen or 1
        need = max(self.batch, self.warmup)
        return {
            "isDQN": True,
            "loss": round(self.loss_ema, 5),
            "gradNorm": round(self.grad_ema, 4),
            "predQ": round(self.q_pred_ema, 4),
            "bufferSize": len(self.buf),
            "bufferCap": cap,
            "bufferFill": round(len(self.buf) / cap, 4),
            "warmup": need,
            "warmupDone": len(self.buf) >= need,
            "trainSteps": self.train_steps,
            "targetSync": self.target_sync,
            "stepsToSync": (self.target_sync - self.train_steps % self.target_sync) if self.target_sync else 0,
            "syncCount": self.sync_count,
            "lr": round(self._lr(self._alpha), 6),
            "dueling": self.net_cls is DuelingQNet,
        }

    def value_advantage(self, state):
        """Dueling nets only: {v, a:[...]} the V(s) / centered-A(s,a) split, else None."""
        if self.net_cls is not DuelingQNet:
            return None
        with torch.no_grad():
            t = torch.as_tensor(np.asarray(state, dtype=np.float32), device=self.device).unsqueeze(0)
            h = self.q.trunk(t)
            v = float(self.q.value(h)[0, 0].item())
            a = self.q.adv(h)[0]
            a = (a - a.mean()).tolist()
            return {"v": round(v, 4), "a": [round(float(x), 4) for x in a]}

    def end_episode(self):
        pass


class DoubleDQNAgent(DQNAgent):
    name = "Double-DQN"
    double = True


class DuelingDQNAgent(DQNAgent):
    name = "Dueling-DQN"
    net_cls = DuelingQNet     # vanilla max target: the head is the only change


DQN_ALGORITHMS = {"dqn": DQNAgent, "double_dqn": DoubleDQNAgent,
                  "dueling_dqn": DuelingDQNAgent}


def is_dqn(algo):
    return algo in DQN_ALGORITHMS


def make_dqn(algo, obs_dim, n_actions, **kwargs):
    cls = DQN_ALGORITHMS.get(algo, DQNAgent)
    return cls(obs_dim=obs_dim, n_actions=n_actions, **kwargs)


# --------------------------------------------------------------------- self-test
if __name__ == "__main__":
    from continuous import ContinuousArena, N_ACTIONS, OBS_DIM

    env = ContinuousArena(seed=0)
    agent = DoubleDQNAgent(OBS_DIM, N_ACTIONS, alpha=0.2, gamma=0.98, seed=0, warmup=500)

    EPISODES = 500
    eps_start, eps_end, eps_eps = 1.0, 0.05, 300
    recent = deque(maxlen=100)
    for ep in range(EPISODES):
        agent.set_epsilon(eps_start + (eps_end - eps_start) * min(1.0, ep / eps_eps))
        (s, _), _ = env.reset(seed=10_000 + ep)
        a = agent.policy_action(s)
        done = False
        while not done:
            (ns, _), rew, done, trunc, info = env.step(a, 8)   # blue coasts
            na = agent.policy_action(ns) if not done else 0
            agent.learn_step(s, a, rew["red"], ns, na, done)
            s, a = ns, na
        agent.end_episode()
        recent.append(1 if info["winner"] == "red" else 0)
        if (ep + 1) % 100 == 0:
            print(f"ep {ep + 1:4d}  eps {agent.epsilon:.2f}  "
                  f"winrate(last100) {sum(recent) / len(recent):.2f}  "
                  f"train_steps {agent.train_steps}")
    final = sum(recent) / len(recent)
    print(f"FINAL winrate (last 100): {final:.2f}  ->  {'OK' if final >= 0.7 else 'WARN: not learning well'}")
