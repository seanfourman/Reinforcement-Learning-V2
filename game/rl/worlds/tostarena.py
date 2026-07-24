"""Round 5 - Tostarena (Sand Kingdom): the SEQUENTIAL continuous arena.

Metadata + env factory. Like Round 4 there is no tabular ``World`` - the
environment is ``rl/sequential.SequentialArena`` (a continuous checkpoint RALLY:
oasis -> far-side ruin gate -> the Inverted Pyramid, with roaming dust tornados
and quicksand), which ``match.py`` builds via ``make_env()``. ``generate()`` is
never used for this round.
"""

THEME = "tostarena"
ROUND_ID = 5
TITLE = "Dry Dry Desert"
CONTINUOUS = True


def make_env(seed=None, **kwargs):
    # kwargs (thrust/damp/vmax/sand_damp/tornado_count/quicksand_count) are the
    # panel-tunable dynamics + hazard counts threaded through by match.py.
    from sequential import SequentialArena
    return SequentialArena(seed, round_id=ROUND_ID, **kwargs)


def generate(seed=None):
    raise NotImplementedError(
        "Round 5 is continuous; its env is rl/sequential.SequentialArena, "
        "not a grid World built via generate()."
    )
