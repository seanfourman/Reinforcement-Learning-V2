"""Round 3 - "Fossil Falls": the TEMPORAL-DIFFERENCE arena.

SARSA (Red) vs Q-Learning (Blue), with Expected-SARSA as an alternate pick,
race through a random perfect maze patrolled by Goombas (plus wet skid cells,
a rival-freezing cage pickup, and a boulder / pressure-plate secret door).
Both sides learn ONE STEP AT A TIME by bootstrapping - the TD idea - and the
on-policy vs off-policy contrast is the round's whole story.

    world.py            the random-perfect-maze generator (recursive backtracker)
    env.py              the Round-3 mechanics on top of the shared grid engine
    qlearning.py        off-policy TD control (bootstraps on max_a Q)
    sarsa.py            on-policy TD control (bootstraps on the action taken)
    expected_sarsa.py   bootstraps on the policy's EXPECTED next value
"""

TITLE = "Fossil Falls"
