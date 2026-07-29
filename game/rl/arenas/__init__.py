"""The five tournament arenas, one package per round.

Each arena package bundles everything specific to that round in one obvious
place: its world generator (``world.py``), its environment mechanics
(``env.py`` for the grid rounds, ``arena.py`` for the continuous rounds), and
the algorithm implementations that round showcases:

    r1_peach_castle    Value Iteration vs Policy Iteration   (Dynamic Programming)
    r2_new_donk_city   Every-visit MC vs First-visit MC      (Monte Carlo)
    r3_fossil_falls    SARSA vs Q-Learning (+Expected-SARSA) (Temporal Difference)
    r4_ruined_kingdom  DQN vs Double-DQN (+Dueling-DQN)      (Deep value-based)
    r5_tostarena       Actor-Critic vs PPO (+REINFORCE)      (Policy gradient)

The DP -> MC -> TD -> DQN -> PG running order IS the course arc: from planning
with a known model, to learning from complete episodes, to bootstrapping, to
neural value functions, to learning the policy directly.
"""
