"""Per-round themed worlds.

Each round module exposes ``generate(seed=None) -> World`` and the metadata
constants ``THEME`` / ``ROUND_ID`` / ``TITLE``. ``ROUNDS`` is the tournament
running order; the tournament manager walks it. Rounds 2-5 are added in later
phases — until then only Round 1 (medieval) is registered.
"""

from .grid import (  # re-exported for convenience / back-compat
    World, validate, SIZE, ORTHO,
    WALL, FLOOR, ESCAPE, RED_KEY, BLUE_KEY, RED_DOOR, BLUE_DOOR,
    GOLD_HOME, RED_SPAWN, BLUE_SPAWN, GOLD_TRAP,
)
from . import medieval

# round_id -> module (must expose generate / THEME / ROUND_ID / TITLE)
ROUND_MODULES = {
    1: medieval,
}
# tournament running order
ROUNDS = [1]

# default head-to-head matchup per round (Red algo, Blue algo). Panel-overridable.
ROUND_ALGOS = {
    1: ("value_iteration", "policy_iteration"),
    # 2: ("sarsa", "qlearning"),       # added in Phase B
    # 3: ("qlearning", "monte_carlo"), # added in Phase C
    # 4: ("dqn", "double_dqn"),        # added in Phase D
    # 5: ("dqn", "dueling_dqn"),       # added in Phase E
}

# human-readable algorithm names (for the HUD matchup label)
ALGO_LABELS = {
    "value_iteration": "Value Iteration",
    "policy_iteration": "Policy Iteration",
    "qlearning": "Q-Learning",
    "sarsa": "SARSA",
    "expected_sarsa": "Expected-SARSA",
    "monte_carlo": "Monte-Carlo",
    "dqn": "DQN",
    "double_dqn": "Double-DQN",
    "dueling_dqn": "Dueling-DQN",
}


def make_world(round_id=1, seed=None):
    mod = ROUND_MODULES.get(round_id, medieval)
    return mod.generate(seed)


def round_algos(round_id):
    return ROUND_ALGOS.get(round_id, ("qlearning", "qlearning"))


def round_meta(round_id):
    mod = ROUND_MODULES.get(round_id, medieval)
    ar, ab = round_algos(round_id)
    return {
        "roundId": mod.ROUND_ID, "theme": mod.THEME, "title": mod.TITLE,
        "index": ROUNDS.index(round_id) if round_id in ROUNDS else 0,
        "total": len(ROUNDS),
        "algoRed": ar, "algoBlue": ab,
        "labelRed": ALGO_LABELS.get(ar, ar), "labelBlue": ALGO_LABELS.get(ab, ab),
        "matchup": f"{ALGO_LABELS.get(ar, ar)} vs {ALGO_LABELS.get(ab, ab)}",
    }
