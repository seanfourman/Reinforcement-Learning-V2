"""Round 5 - Tostarena (Sand Kingdom): the MOON HEIST, a CONTINUOUS arena.

Metadata only. Like Round 4 there is no tabular ``World`` - the environment is
``rl/continuous.ContinuousArena`` (continuous state, NN policy), which ``match.py``
instantiates directly for any round flagged ``CONTINUOUS``, passing this module's
``THEME`` so the browser draws the Tostarena scene. ``generate()`` is never used.

The game (see ``ContinuousArena._step_heist_game``): one Power Moon spawns dead
centre; both agents SEE each other. Grab it to become the CARRIER (haul it to your
own corner base, but you move slower while carrying); the other is the CHASER (tag
the carrier to INSTANTLY STEAL the moon - the robbed carrier is briefly stunned).
Banking at your base scores; first to 3 banks wins (a timeout awards whoever banked
more). This is the POLICY round's showcase: the same agent must learn to EVADE while
carrying and PURSUE while chasing, and the best evasion is UNPREDICTABLE - exactly
where a stochastic policy-gradient policy (REINFORCE / Actor-Critic / PPO) beats a
deterministic one.
"""

THEME = "tostarena"
ROUND_ID = 5
TITLE = "Dry Dry Desert"
CONTINUOUS = True


def generate(seed=None):
    raise NotImplementedError(
        "Round 5 is continuous; its env is rl/continuous.ContinuousArena "
        "(Moon Heist), not a grid World built via generate()."
    )
