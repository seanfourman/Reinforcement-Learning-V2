"""Put the game root and the ``rl`` package dir on sys.path so the tests import the
same way the app does: ``from rl.env import ...`` while ``env.py`` still does the
bare ``import worldgen`` (rl/ is on the path at runtime)."""

import sys
from pathlib import Path

GAME = Path(__file__).resolve().parent.parent
for p in (GAME, GAME / "rl"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
