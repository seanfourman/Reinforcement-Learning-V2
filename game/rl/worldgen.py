"""Back-compat shim - the world layouts now live in the ``worlds/`` package.

Historically this module *was* the single fixed castle. It has been split into
``worlds/grid.py`` (shared core) + ``worlds/medieval.py`` (the castle) + the
other themed rounds. This module re-exports the grid alphabet, the ``World``
class, and a ``generate()`` that builds Round 1, so existing
``import worldgen`` / ``from worldgen import WALL, ...`` call sites keep working.
"""

from worlds.grid import (  # noqa: F401  (re-exported)
    World, validate, SIZE, ORTHO,
    WALL, FLOOR, ESCAPE, RED_KEY, BLUE_KEY, RED_DOOR, BLUE_DOOR,
    GOLD_HOME, RED_SPAWN, BLUE_SPAWN, GOLD_TRAP,
)
from worlds import make_world, round_meta, ROUNDS  # noqa: F401


def generate(seed=None, round_id=1):
    """Build a round's world (default Round 1 = the medieval castle)."""
    return make_world(round_id, seed)


if __name__ == "__main__":
    w = generate()
    print(f"round {w.round_id} ({w.theme}): {w.H}x{w.W}, {len(w.slip_cells)} slip cells")
