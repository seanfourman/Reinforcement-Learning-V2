"""Round 5 - Tostarena (Sand Kingdom): a CONTINUOUS arena (SKELETON).

Metadata only. Like Round 4 there is no tabular ``World`` - the environment is
``rl/continuous.ContinuousArena`` (continuous state, NN value function), which
``match.py`` instantiates directly for any round flagged ``CONTINUOUS``, passing
this module's ``THEME`` so the browser draws the Tostarena scene. ``generate()`` is
never used for this round. (The real Round 5 game is TBD; this is a bare fly-to-goal
shell.)
"""

THEME = "tostarena"
ROUND_ID = 5
TITLE = "Dry Dry Desert"
CONTINUOUS = True


def generate(seed=None):
    raise NotImplementedError(
        "Round 5 is continuous; its env is rl/continuous.ContinuousArena, "
        "not a grid World built via generate()."
    )
