"""Round 2 - "New Donk City": the MONTE-CARLO arena.

Every-visit MC (Red) vs First-visit MC (Blue) race to collect three tomatoes
across a seeded three-part city course (puddle skids, lethal Piranha Plants,
warp Pipes) and then reach the goal. Nobody knows the model here: both sides
learn purely from COMPLETE EPISODE RETURNS, the defining Monte-Carlo idea.

    world.py            the three-part city course generator (mirror-symmetric)
    course_tools.py     board constants + the carving/geometry toolbox
    course_checks.py    the per-seed course design validator
    env.py              the Round-2 mechanics on top of the shared grid engine
    monte_carlo.py      every-visit Monte-Carlo control
    first_visit_mc.py   first-visit Monte-Carlo control
"""

TITLE = "New Donk City"
