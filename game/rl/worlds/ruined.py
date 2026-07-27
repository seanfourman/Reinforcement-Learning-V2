"""Round 4 - Ruined Kingdom: continuous Banzai Bill survival.

Metadata only. Unlike the grid rounds there is no tabular ``World`` here - the
environment is ``rl/continuous.ContinuousArena``: two DQN agents dodge increasingly
fast homing missiles on a circular tower, using continuous positions/velocities and
a neural value function. ``match.py`` instantiates it directly for this round.
"""

THEME = "ruined"
ROUND_ID = 4
TITLE = "Ruined Kingdom"
CONTINUOUS = True


def generate(seed=None):
    raise NotImplementedError(
        "Round 4 is continuous; its env is rl/continuous.ContinuousArena, "
        "not a grid World built via generate()."
    )
