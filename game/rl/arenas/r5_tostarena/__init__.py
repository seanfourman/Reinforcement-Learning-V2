"""Round 5 - "Tostarena" (Dry Dry Desert): the POLICY-GRADIENT arena.

Actor-Critic (Red) vs PPO (Blue), with REINFORCE as an alternate pick, play
CAPTURE THE FLAG: grab the centre flag, haul it home while the rival tries to
tag-steal it, and fire Mario-Kart weapons from smashed crates. Where Round 4
learned Q-VALUES and acted greedily, these agents learn the POLICY directly -
and a stochastic policy is exactly what an unpredictable juke needs.

NOTE: the algorithm modules import PyTorch. They are imported LAZILY (by
``core/registry.py`` factories), so the server still boots and runs the
tabular rounds on a Python without torch installed.

    world.py           round metadata (the env is continuous; no grid World)
    arena.py           the Round-5 CTF mechanics on the shared engine
    weapons.py         the crate weapons + Bowser airship subsystems
    pg_base.py         the base policy-gradient agent (policy net, rollouts)
    reinforce.py       Monte-Carlo policy gradient (whitened returns)
    actor_critic.py    bootstrapping critic + n-step advantages
    ppo.py             clipped-ratio multi-epoch updates over GAE advantages
"""

TITLE = "Dry Dry Desert"
