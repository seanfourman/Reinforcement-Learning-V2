"""Round 4 - Ruined Kingdom: the CONTINUOUS, function-approximation arena.

Metadata only. Unlike the grid rounds there is no tabular ``World`` here - the
environment is ``rl/continuous.ContinuousArena`` (continuous state, NN value
function), which ``match.py`` instantiates directly for any round flagged
``CONTINUOUS``. So ``generate()`` is never used to build this round's env.
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
