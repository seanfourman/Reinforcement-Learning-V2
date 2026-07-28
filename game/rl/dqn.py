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

import os
import random
import tempfile
from collections import deque

import numpy as np
import torch
import torch.nn as nn


CHECKPOINT_SCHEMA_VERSION = 1


def save_checkpoint_file(path, payload):
    """Atomically write a torch checkpoint in the destination directory.

    The temporary file lives beside the final file so ``os.replace`` is an
    atomic same-volume operation on Windows too.  A failed save leaves the last
    known-good checkpoint untouched.
    """
    final_path = os.path.abspath(path)
    parent = os.path.dirname(final_path)
    os.makedirs(parent, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(
        prefix=f".{os.path.basename(final_path)}.", suffix=".tmp", dir=parent
    )
    os.close(fd)
    try:
        torch.save(payload, temp_path)
        os.replace(temp_path, final_path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def load_checkpoint_file(path):
    """Return ``(payload, error)`` without letting a bad local file stop play."""
    final_path = os.path.abspath(path)
    if not os.path.exists(final_path):
        return None, "missing"
    try:
        try:
            payload = torch.load(final_path, map_location="cpu", weights_only=True)
        except TypeError:
            # PyTorch versions predating ``weights_only`` still load this
            # tensor/dict-only checkpoint safely enough from our own directory.
            payload = torch.load(final_path, map_location="cpu")
    except Exception as exc:  # corrupt/truncated/incompatible pickle or tensor data
        return None, f"unreadable: {type(exc).__name__}: {exc}"
    if not isinstance(payload, dict):
        return None, "invalid: checkpoint root is not a dict"
    return payload, None


def _mlp(obs_dim, hidden, layers):
    """A stack of ``layers`` hidden Linear+ReLU blocks (layers>=1), first mapping
    obs_dim -> hidden and the rest hidden -> hidden. Returns the module list so a
    head can be appended by the caller."""
    layers = max(1, int(layers))
    seq = [nn.Linear(obs_dim, hidden), nn.ReLU()]
    for _ in range(layers - 1):
        seq += [nn.Linear(hidden, hidden), nn.ReLU()]
    return seq


class QNet(nn.Module):
    def __init__(self, obs_dim, n_actions, hidden=128, layers=2):
        super().__init__()
        self.net = nn.Sequential(
            *_mlp(obs_dim, hidden, layers),
            nn.Linear(hidden, n_actions),
        )

    def forward(self, x):
        return self.net(x)


class DuelingQNet(nn.Module):
    """Shared trunk -> V(s) head + A(s,a) head, Q = V + A - mean(A). The mean
    subtraction pins down the V/A split (they are otherwise only identified up
    to a constant)."""

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


class ReplayBuffer:
    """Fixed-capacity ring buffer over preallocated numpy arrays.

    The previous deque implementation rebuilt a full ``list(buffer)`` snapshot on
    EVERY learning step just to sample a minibatch (O(capacity) per step). Here
    each slot is written in place and a minibatch is gathered by fancy-indexing a
    handful of random rows, so a learning step is O(batch) regardless of how big
    the replay memory is.
    """

    def __init__(self, capacity, obs_dim, rng):
        self.maxlen = int(capacity)
        self.rng = rng
        self.s = np.zeros((self.maxlen, obs_dim), dtype=np.float32)
        self.ns = np.zeros((self.maxlen, obs_dim), dtype=np.float32)
        self.a = np.zeros(self.maxlen, dtype=np.int64)
        self.r = np.zeros(self.maxlen, dtype=np.float32)
        self.d = np.zeros(self.maxlen, dtype=np.float32)
        self.size = 0
        self.pos = 0

    def push(self, s, a, r, ns, done):
        i = self.pos
        self.s[i] = s
        self.ns[i] = ns
        self.a[i] = a
        self.r[i] = r
        self.d[i] = 1.0 if done else 0.0
        self.pos = (self.pos + 1) % self.maxlen
        self.size = min(self.size + 1, self.maxlen)

    def sample(self, batch):
        idx = self.rng.sample(range(self.size), batch)   # O(batch), no full copy
        return (self.s[idx], self.a[idx], self.r[idx], self.ns[idx], self.d[idx])

    def clear(self):
        self.size = 0
        self.pos = 0

    def __len__(self):
        return self.size


class DQNAgent:
    name = "DQN"
    double = False
    net_cls = QNet

    def __init__(self, obs_dim, n_actions, alpha=0.2, gamma=0.98, seed=0,
                 buffer=50_000, batch=64, warmup=1_000, target_sync=500, hidden=128,
                 n_step=3, layers=2):
        self.obs_dim = obs_dim
        self.n_actions = n_actions
        self.hidden = hidden
        self.layers = max(1, int(layers))   # number of hidden Linear+ReLU blocks
        self.gamma = gamma
        # n-step returns: the reward of the next ``n_step`` transitions is folded
        # into one target, so a terminal penalty (getting hit) propagates back n
        # steps at once instead of one bootstrap at a time. n_step=1 is vanilla DQN.
        self.n_step = max(1, int(n_step))
        self._nstep = []          # pending 1-step transitions for the current episode
        self.epsilon = 1.0
        self.rng = random.Random(seed)
        # NOTE: weight init uses the GLOBAL torch RNG, so building two agents (or a
        # reset) reseeds shared state - "seeded" runs are reproducible per-process
        # but not bit-identical across construction orders. Buffer sampling +
        # epsilon-greedy use the instance-local self.rng, which IS isolated. The nets
        # have no stochastic layers after init, so this only affects initial weights.
        torch.manual_seed(seed)
        self.device = torch.device("cpu")
        self.q = self.net_cls(obs_dim, n_actions, hidden, self.layers).to(self.device)
        self.target = self.net_cls(obs_dim, n_actions, hidden, self.layers).to(self.device)
        self.target.load_state_dict(self.q.state_dict())
        self.target.eval()
        self._alpha = alpha
        self.opt = torch.optim.Adam(self.q.parameters(), lr=self._lr(alpha))
        self.buf = ReplayBuffer(buffer, obs_dim, self.rng)
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
        self.q = self.net_cls(self.obs_dim, self.n_actions, self.hidden, self.layers).to(self.device)
        self.target = self.net_cls(self.obs_dim, self.n_actions, self.hidden, self.layers).to(self.device)
        self.target.load_state_dict(self.q.state_dict())
        self.target.eval()   # keep the target net in eval mode (matches __init__)
        self.opt = torch.optim.Adam(self.q.parameters(), lr=self._lr(self._alpha))
        self.buf.clear()
        self._nstep = []
        self.train_steps = 0
        self.epsilon = 1.0
        self.loss_ema = 0.0
        self.grad_ema = 0.0
        self.q_pred_ema = 0.0
        self.sync_count = 0

    # ---------------------------------------------------------- persistence
    def checkpoint_state(self):
        """Serializable learning state. Replay memory is deliberately excluded."""
        return {
            "obsDim": int(self.obs_dim),
            "nActions": int(self.n_actions),
            "hidden": int(self.hidden),
            "layers": int(self.layers),
            "q": self.q.state_dict(),
            "target": self.target.state_dict(),
            "optimizer": self.opt.state_dict(),
            "trainSteps": int(self.train_steps),
            "diagnostics": {
                "lossEma": float(self.loss_ema),
                "gradEma": float(self.grad_ema),
                "predQEma": float(self.q_pred_ema),
                "syncCount": int(self.sync_count),
            },
        }

    def prepare_checkpoint_state(self, state):
        """Validate and stage a restore without mutating the live agent.

        Match prepares both sides before applying either one, which prevents a
        half-restored matchup when only one side of a checkpoint is damaged.
        """
        if not isinstance(state, dict):
            raise ValueError("agent state is not a dict")
        if int(state.get("obsDim", -1)) != int(self.obs_dim):
            raise ValueError("agent observation dimension mismatch")
        if int(state.get("nActions", -1)) != int(self.n_actions):
            raise ValueError("agent action count mismatch")
        if int(state.get("hidden", -1)) != int(self.hidden):
            raise ValueError("agent hidden width mismatch")
        if int(state.get("layers", 2)) != int(self.layers):
            raise ValueError("agent hidden-layer count mismatch")

        q = self.net_cls(self.obs_dim, self.n_actions, self.hidden, self.layers).to(self.device)
        target = self.net_cls(self.obs_dim, self.n_actions, self.hidden, self.layers).to(self.device)
        q.load_state_dict(state["q"], strict=True)
        target.load_state_dict(state["target"], strict=True)
        target.eval()
        opt = torch.optim.Adam(q.parameters(), lr=self._lr(self._alpha))
        opt.load_state_dict(state["optimizer"])
        # Restore Adam's moments/step counters, but the currently selected
        # character/profile owns the live learning rate.
        for group in opt.param_groups:
            group["lr"] = self._lr(self._alpha)

        train_steps = int(state["trainSteps"])
        if train_steps < 0:
            raise ValueError("negative trainSteps")
        diag = state.get("diagnostics", {})
        if not isinstance(diag, dict):
            raise ValueError("agent diagnostics are not a dict")
        return {
            "q": q,
            "target": target,
            "optimizer": opt,
            "trainSteps": train_steps,
            "lossEma": float(diag.get("lossEma", 0.0)),
            "gradEma": float(diag.get("gradEma", 0.0)),
            "predQEma": float(diag.get("predQEma", 0.0)),
            "syncCount": max(0, int(diag.get("syncCount", 0))),
        }

    def apply_checkpoint_state(self, prepared):
        self.q = prepared["q"]
        self.target = prepared["target"]
        self.opt = prepared["optimizer"]
        self.train_steps = prepared["trainSteps"]
        self.loss_ema = prepared["lossEma"]
        self.grad_ema = prepared["gradEma"]
        self.q_pred_ema = prepared["predQEma"]
        self.sync_count = prepared["syncCount"]
        # Replay samples encode an old stream of environment transitions and are
        # intentionally neither saved nor reconstructed.
        self.buf.clear()
        self._nstep = []

    # ------------------------------------------------------------- learning
    def _emit_nstep_from_front(self):
        """Fold up to ``n_step`` pending transitions (starting at the front) into a
        single (s0, a0, n-step return, bootstrap-state, done) tuple and store it.
        Within one episode ``done`` is True only on the very last transition, so a
        window's terminal flag comes straight from its final element."""
        window = self._nstep[:self.n_step]
        ret = 0.0
        for (_s, _a, r, _ns, d) in reversed(window):
            ret = r + self.gamma * ret * (1.0 - d)
        s0, a0 = window[0][0], window[0][1]
        last_ns, last_done = window[-1][3], window[-1][4]
        self.buf.push(s0, a0, ret, last_ns, last_done)

    def learn_step(self, s, a, r, ns, na, done, next_mask=None):
        # next_mask/na are unused (the continuous arenas have an open action space
        # with no wall-bumps to exclude); accepted to match the learner interface.
        self._nstep.append((np.asarray(s, dtype=np.float32), int(a), float(r),
                            np.asarray(ns, dtype=np.float32), bool(done)))
        # Emit every window that has reached full length; end_episode() flushes the
        # short tail so the last few states still get their (shorter) returns.
        while len(self._nstep) >= self.n_step:
            self._emit_nstep_from_front()
            self._nstep.pop(0)
        self._train()

    def _train(self):
        if len(self.buf) < max(self.batch, self.warmup):
            return
        s_np, a_np, r_np, ns_np, d_np = self.buf.sample(self.batch)
        s_b = torch.as_tensor(s_np, device=self.device)
        a_b = torch.as_tensor(a_np, device=self.device).long().unsqueeze(1)
        r_b = torch.as_tensor(r_np, device=self.device).float().unsqueeze(1)
        ns_b = torch.as_tensor(ns_np, device=self.device)
        d_b = torch.as_tensor(d_np, device=self.device).float().unsqueeze(1)
        # discount the bootstrap by gamma^n_step, since the return already spans n rewards
        gamma_n = self.gamma ** self.n_step

        q_sa = self.q(s_b).gather(1, a_b)
        with torch.no_grad():
            if self.double:
                next_a = torch.argmax(self.q(ns_b), dim=1, keepdim=True)
                next_q = self.target(ns_b).gather(1, next_a)
            else:
                next_q = self.target(ns_b).max(dim=1, keepdim=True).values
            target = r_b + gamma_n * next_q * (1.0 - d_b)
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
        # flush the remaining short windows so the final states of the episode get
        # their (shorter-horizon) returns, then clear so the next episode - or a
        # max-steps truncation, where learn_step's done was False - starts clean.
        while self._nstep:
            self._emit_nstep_from_front()
            self._nstep.pop(0)


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
