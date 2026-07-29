"""Round 1 - "Peach's Castle": the DYNAMIC-PROGRAMMING arena.

Value Iteration (Red) vs Policy Iteration (Blue) race through a mirror-symmetric
stochastic castle maze (coins, slippery ice, "?" ghost/freeze Mystery Blocks).
The transition model is KNOWN, so nobody learns from experience here: each side
PLANS with Bellman sweeps, and the faster planner reaches the Power Moon first.

    world.py             the maze generator (mirror-symmetric, seeded)
    env.py               the Round-1 mechanics on top of the shared grid engine
    dp_base.py           the incremental DP planner shared by both methods
    value_iteration.py   V(s) <- max_a Q(s,a) sweeps
    policy_iteration.py  evaluate-then-improve sweeps
"""

TITLE = "Peach's Castle"
