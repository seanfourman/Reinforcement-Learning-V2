"""Round 5 - Tostarena (Sand Kingdom): CAPTURE THE FLAG, a CONTINUOUS arena.

Metadata only. Like Round 4 there is no tabular ``World`` - the environment is
``rl/continuous.ContinuousArena`` (continuous state, NN policy), which ``match.py``
instantiates directly for any round flagged ``CONTINUOUS``, passing this module's
``THEME`` so the browser draws the Tostarena scene. ``generate()`` is never used.

The game (see ``ContinuousArena._step_ctf_game``): one flag sits on the centre pole;
both agents SEE each other. Grab it to become the CARRIER (haul it to your own corner
base, but you move slower while carrying); the other is the CHASER (tag the carrier
to INSTANTLY STEAL the flag - the robbed carrier is briefly stunned). Delivering the
flag home CAPTURES it; first to 3 captures wins (a timeout awards whoever captured
more). Breakable CRATES spawn around the board: smash one for a random POWER-UP
(speed / chain-pull-stun / shield / flag-bomb). This is the POLICY round's showcase:
the same agent must EVADE while carrying and PURSUE while chasing, and the best
evasion is UNPREDICTABLE - exactly where a stochastic policy-gradient policy
(REINFORCE / Actor-Critic / PPO) beats a deterministic one.
"""

THEME = "tostarena"
ROUND_ID = 5
TITLE = "Dry Dry Desert"
CONTINUOUS = True


def generate(seed=None):
    raise NotImplementedError(
        "Round 5 is continuous; its env is rl/continuous.ContinuousArena "
        "(Capture the Flag), not a grid World built via generate()."
    )
