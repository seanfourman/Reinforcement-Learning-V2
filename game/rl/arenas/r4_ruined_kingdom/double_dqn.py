"""Double-DQN - Round 4's Blue default.

Differs from vanilla DQN in the BOOTSTRAP TARGET only. Vanilla uses

    max_a' Q_target(s', a')

which over-estimates: the same noisy network both PICKS the best next action
and SCORES it, so any action whose value is overestimated by noise wins the
max. Double-DQN decouples the two roles - the ONLINE net selects, the TARGET
net evaluates:

    Q_target(s', argmax_a' Q_online(s', a'))

One line of difference (see ``DQNAgent._train``, gated on ``self.double``),
visible live in the dashboard's predicted-Q chart: vanilla's estimate drifts
optimistic, Double's stays honest.
"""

from .dqn import DQNAgent


class DoubleDQNAgent(DQNAgent):
    name = "Double-DQN"
    double = True


# --------------------------------------------------------------------- self-test
if __name__ == "__main__":
    # Round-4 learnability smoke test: one Double-DQN agent vs a coasting rival.
    import os
    import sys
    from collections import deque

    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
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
