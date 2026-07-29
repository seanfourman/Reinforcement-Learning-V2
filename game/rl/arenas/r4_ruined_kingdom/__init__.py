"""Round 4 - "Ruined Kingdom": the DEEP VALUE-BASED arena (function approximation).

DQN (Red) vs Double-DQN (Blue), with Dueling-DQN as an alternate pick, survive
an escalating Banzai Bill barrage on a circular tower with continuous positions
and velocities. A tabular Q is impossible over real-valued state, so a small
neural network approximates Q(s, a) - trained from a replay buffer against a
periodically-synced target network.

NOTE: the algorithm modules import PyTorch. They are imported LAZILY (by
``core/registry.py`` factories), so the server still boots and runs the
tabular rounds on a Python without torch installed.

    world.py         round metadata (the env is continuous; no grid World)
    arena.py         the Round-4 missile-survival mechanics on the shared engine
    dqn.py           the base deep Q-network agent (replay buffer, target net)
    double_dqn.py    decoupled action selection / evaluation in the target
    dueling_dqn.py   the V(s) + A(s,a) two-head network
"""

TITLE = "Ruined Kingdom"
