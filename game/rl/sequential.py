"""Round 5 - Tostarena SEQUENTIAL arena (DQN vs Dueling-DQN).

The desert rally: unlike every other round there is no single goal - each agent
must clear an ORDERED SEQUENCE of waypoints. Leg 1 is its own near-side oasis,
leg 2 the ruin gate on the FAR side (mirrored per agent, so the two racing lines
cross in the middle of the desert), leg 3 the Inverted Pyramid at the north end.
First agent to finish the whole tour wins.

The state is continuous like Round 4 - ``(x, z, Vx, Vz)`` plus where the CURRENT
target is and how far along the tour the agent is - so the value function must
again be a neural net; the round's teaching contrast is vanilla DQN vs a
Dueling-DQN head (V(s) + advantages) on the same experience.

On top of the sequence, two DYNAMIC obstacles roam the arena: dust tornados
dancing on a deterministic, always mirror-symmetric orbit (fair to both sides),
which shove and penalise any agent they catch. Static QUICKSAND pools slow
whoever cuts through them (extra drag + a trickle of cost) without blocking.

Coords match the JS world: x = column, z = row, goal side NORTH (small z),
spawns SOUTH (large z), so the Tostarena diorama drops on top unchanged.

Interface mirrors continuous.ContinuousArena so match.py drives it unchanged:
    (obs_red, obs_blue), info = reset()
    obs, reward, done, truncated, info = step(a_red, a_blue)   # info['winner']
    frame = snapshot()
"""

import math
import random

import numpy as np

ARENA = 20.0          # square arena [0, ARENA]^2 (matches the board footprint)
DT = 0.05             # integration timestep
THRUST = 16.0         # acceleration magnitude applied by a thrust action
DAMP = 0.90           # velocity retained per step (drag)
SAND_DAMP = 0.72      # much heavier drag while wading through quicksand
VMAX = 7.0            # speed cap (units/sec)
AGENT_R = 0.55
MAX_STEPS = 450       # the 3-leg tour is ~3x Round 4's single sprint

# 8 compass thrust directions + coast (index 8). (dx, dz); -z = north
DIRS = [
    (0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0),
    (-0.7071, -0.7071), (0.7071, -0.7071), (-0.7071, 0.7071), (0.7071, 0.7071),
    (0.0, 0.0),
]
N_ACTIONS = len(DIRS)   # 9
# obs: pos(2) vel(2) to-target(2) progress(1) to-nearest-tornado(2)
OBS_DIM = 9

# ---- the tour (mirror-symmetric about x = ARENA/2, so the race is fair) ----
# Each agent's ordered waypoints: near-side OASIS -> far-side RUIN GATE -> the
# shared PYRAMID finish. (x, z, capture radius)
FINISH = (ARENA / 2, 2.6, 1.5)
# red starts on the viewer's RIGHT, blue on the LEFT (matches the HUD); each
# color's spawn + tour move together, so the race stays mirror-fair.
RED_TOUR = [(16.0, 12.5, 1.3), (4.0, 8.0, 1.3), FINISH]
BLUE_TOUR = [(4.0, 12.5, 1.3), (16.0, 8.0, 1.3), FINISH]
RED_SPAWN = (13.0, 17.5)
BLUE_SPAWN = (7.0, 17.5)

# static quicksand pools (x, z, radius): heavy drag + a trickle of cost inside.
# One guards the midfield crossing, two flank the pyramid approach.
QUICKSAND = [
    (ARENA / 2, 10.2, 1.6),
    (6.5, 5.2, 1.2),
    (13.5, 5.2, 1.2),
]

# dust tornados: a MIRRORED PAIR dancing about the centre line, deterministic in
# the step count so both sides can in principle predict them. West twin at
# (cx - d, z), east twin at (cx + d, z) - symmetric at every instant, so neither
# side is ever blocked more than the other.
TORNADO_R = 1.0
TORNADO_D0, TORNADO_D1 = 2.2, 1.8     # d(t) = D0 + D1*sin(w_d * t)
TORNADO_Z0, TORNADO_Z1 = 9.0, 3.5     # z(t) = Z0 + Z1*sin(w_z * t + phase)
TORNADO_WD, TORNADO_WZ = 0.055, 0.031

STEP_COST = 0.006
SHAPE_W = 0.05        # potential shaping toward the CURRENT target
CHECKPOINT_BONUS = 0.4
HIT_PENALTY = 0.02    # walls
TORNADO_PENALTY = 0.06
SAND_COST = 0.01      # per step spent wading in quicksand
WIN, LOSE = 1.0, -1.0


class SequentialArena:
    """Two-agent continuous CHECKPOINT RALLY. Same match interface as Round 4."""

    objective = "arena"

    def __init__(self, seed=None, round_id=5, thrust=THRUST, damp=DAMP, vmax=VMAX,
                 sand_damp=SAND_DAMP, tornado_count=2, quicksand_count=None):
        self.round_id = round_id
        # kept for interface parity, but this env is fully DETERMINISTIC (tornado
        # orbits, quicksand, spawns and integration are all fixed), so self.rng is
        # never consulted - the seed does not change env behaviour here. Run-to-run
        # variety comes entirely from the agents' epsilon exploration.
        self.rng = random.Random(seed)
        self.max_steps = MAX_STEPS
        # tunable dynamics + hazard counts (panel-driven; constants are defaults)
        self.thrust = float(thrust)
        self.damp = float(damp)
        self.vmax = float(vmax)
        self.sand_damp = float(sand_damp)
        self.tornado_count = max(0, min(8, int(tornado_count)))
        self.n_actions = N_ACTIONS
        self.obs_dim = OBS_DIM
        self.H = self.W = int(ARENA)        # coarse grid for the blank overlays
        self.tours = {
            "red": [np.array([x, z], dtype=np.float32) for (x, z, _r) in RED_TOUR],
            "blue": [np.array([x, z], dtype=np.float32) for (x, z, _r) in BLUE_TOUR],
        }
        self.tour_r = {
            "red": [r for (_x, _z, r) in RED_TOUR],
            "blue": [r for (_x, _z, r) in BLUE_TOUR],
        }
        self.n_legs = len(RED_TOUR)
        self.quicksand = self._gen_quicksand(quicksand_count)
        self.red_spawn = RED_SPAWN
        self.blue_spawn = BLUE_SPAWN
        self.steps = 0
        self.done = False
        self.winner = None
        self.reset()

    # --------------------------------------------------------------- helpers
    def _gen_quicksand(self, count):
        """Quicksand pools. None -> the hand-placed default (1 midfield + 2
        flanking the pyramid); a count -> symmetric pools about the centre line
        (odd -> a central pool first, then mirrored flanking pairs)."""
        if count is None:
            base = QUICKSAND
        else:
            count = max(0, min(10, int(count)))
            cx = ARENA / 2
            base = []
            rem = count
            if rem % 2 == 1:                       # central midfield pool
                base.append((cx, 10.2, 1.6))
                rem -= 1
            zs = [5.2, 13.5, 8.0, 3.5]             # flanking rows (pyramid approach first)
            dxs = [6.5, 5.0, 7.0, 4.0]
            for p in range(rem // 2):
                z = zs[p % len(zs)]
                dx = dxs[p % len(dxs)]
                base.append((cx - dx, z, 1.2))
                base.append((cx + dx, z, 1.2))
        return [(np.array([x, z], dtype=np.float32), r) for (x, z, r) in base]

    def _spawn_pos(self, which):
        x, z = self.red_spawn if which == "red" else self.blue_spawn
        return np.array([x, z], dtype=np.float32)

    def _target(self, which, k):
        k = min(k, self.n_legs - 1)
        return self.tours[which][k], self.tour_r[which][k]

    def _dist_target(self, which, pos, k):
        t, _r = self._target(which, k)
        return float(np.linalg.norm(pos - t))

    def _potential(self, which, pos, k):
        # Φ rewards closing on the CURRENT waypoint; the checkpoint bonus (a real
        # reward, not shaping) bridges the potential jump when the target swaps.
        return -SHAPE_W * self._dist_target(which, pos, k)

    def _tornado_pos(self, steps=None):
        # Tornados roam in MIRRORED PAIRS about the centre line (fair to both
        # sides). tornado_count sets how many twisters; each pair gets its own
        # phase offset so they don't stack. count=2 -> the original single pair.
        t = self.steps if steps is None else steps
        cx = ARENA / 2
        out = []
        for i in range(max(0, self.tornado_count // 2)):
            d = TORNADO_D0 + TORNADO_D1 * math.sin(TORNADO_WD * t + i * 0.7)
            z = TORNADO_Z0 + TORNADO_Z1 * math.sin(TORNADO_WZ * t + 1.1 + i * 2.0)
            out.append(np.array([cx - d, z], dtype=np.float32))
            out.append(np.array([cx + d, z], dtype=np.float32))
        return out

    def _in_sand(self, pos):
        for c, r in self.quicksand:
            if float(np.linalg.norm(pos - c)) < r:
                return True
        return False

    def _observe(self, which, pos, vel, k):
        t, _r = self._target(which, k)
        tor = self._tornado_pos()
        near = min(tor, key=lambda c: float(np.linalg.norm(pos - c))) if tor else pos
        return np.array([
            pos[0] / ARENA, pos[1] / ARENA,
            vel[0] / self.vmax, vel[1] / self.vmax,
            (t[0] - pos[0]) / ARENA, (t[1] - pos[1]) / ARENA,
            k / (self.n_legs - 1) if self.n_legs > 1 else 0.0,
            (near[0] - pos[0]) / ARENA, (near[1] - pos[1]) / ARENA,
        ], dtype=np.float32)

    def field_obs(self, which, x, z):
        """Observation for a STILL probe at (x,z), aimed at the agent's CURRENT
        checkpoint - drives the value/policy field overlay."""
        k = self.red_cp if which == "red" else self.blue_cp
        return self._observe(which, np.array([x, z], dtype=np.float32),
                             np.zeros(2, dtype=np.float32), k)

    # ----------------------------------------------------------------- reset
    def reset(self, *, seed=None, options=None, regenerate=False):
        if seed is not None:
            self.rng = random.Random(seed)
        self.red_pos = self._spawn_pos("red")
        self.blue_pos = self._spawn_pos("blue")
        self.red_vel = np.zeros(2, dtype=np.float32)
        self.blue_vel = np.zeros(2, dtype=np.float32)
        self.red_cp = 0                    # index of the NEXT waypoint to tag
        self.blue_cp = 0
        self.steps = 0
        self.done = False
        self.winner = None
        return (self._observe("red", self.red_pos, self.red_vel, self.red_cp),
                self._observe("blue", self.blue_pos, self.blue_vel, self.blue_cp)), {}

    def set_round(self, round_id):
        # unused: match.py rebuilds the env object on a round change rather than
        # calling this. Kept for parity with the other env classes' interface.
        self.round_id = round_id
        self.reset(regenerate=True)

    # ------------------------------------------------------------- dynamics
    def _integrate(self, pos, vel, action, tornados):
        """One thrust step: accelerate, drag (heavier in quicksand), cap speed,
        move, collide with walls + tornados. Returns (pos, vel, hit_wall,
        hit_tornado, in_sand)."""
        dx, dz = DIRS[action]
        vel = vel + np.array([dx, dz], dtype=np.float32) * self.thrust * DT
        in_sand = self._in_sand(pos)
        vel = vel * (self.sand_damp if in_sand else self.damp)
        sp = float(np.linalg.norm(vel))
        if sp > self.vmax:
            vel = vel * (self.vmax / sp)
        npos = pos + vel * DT
        hit = False
        for i in (0, 1):
            if npos[i] < AGENT_R:
                npos[i] = AGENT_R
                vel[i] = 0.0
                hit = True
            elif npos[i] > ARENA - AGENT_R:
                npos[i] = ARENA - AGENT_R
                vel[i] = 0.0
                hit = True
        # tornados: hard shove out along the normal + kill inward velocity
        hit_tor = False
        for c in tornados:
            d = npos - c
            dist = float(np.linalg.norm(d))
            mind = TORNADO_R + AGENT_R
            if dist < mind:
                n = d / dist if dist > 1e-6 else np.array([1.0, 0.0], dtype=np.float32)
                npos = c + n * mind
                vn = float(np.dot(vel, n))
                if vn < 0:
                    vel = vel - n * vn
                vel = vel + n * 1.2          # the shove: flung outward
                hit_tor = True
        return npos.astype(np.float32), vel.astype(np.float32), hit, hit_tor, in_sand

    # ------------------------------------------------------------------ step
    def step(self, a_red, a_blue):
        if self.done:
            raise RuntimeError("step() on a finished episode")
        self.steps += 1
        tornados = self._tornado_pos()
        reward = {"red": -STEP_COST, "blue": -STEP_COST}
        phi0 = {"red": self._potential("red", self.red_pos, self.red_cp),
                "blue": self._potential("blue", self.blue_pos, self.blue_cp)}

        self.red_pos, self.red_vel, hw_r, ht_r, sand_r = self._integrate(
            self.red_pos, self.red_vel, a_red, tornados)
        self.blue_pos, self.blue_vel, hw_b, ht_b, sand_b = self._integrate(
            self.blue_pos, self.blue_vel, a_blue, tornados)
        if hw_r:
            reward["red"] -= HIT_PENALTY
        if hw_b:
            reward["blue"] -= HIT_PENALTY
        if ht_r:
            reward["red"] -= TORNADO_PENALTY
        if ht_b:
            reward["blue"] -= TORNADO_PENALTY
        if sand_r:
            reward["red"] -= SAND_COST
        if sand_b:
            reward["blue"] -= SAND_COST

        # tag the current waypoint -> advance the tour (both may advance in one step)
        for which in ("red", "blue"):
            pos = self.red_pos if which == "red" else self.blue_pos
            k = self.red_cp if which == "red" else self.blue_cp
            t, r = self._target(which, k)
            if float(np.linalg.norm(pos - t)) <= r:
                k += 1
                if which == "red":
                    self.red_cp = k
                else:
                    self.blue_cp = k
                if k < self.n_legs:            # a mid-tour checkpoint
                    reward[which] += CHECKPOINT_BONUS

        # tour complete -> win. The arena is mirror-symmetric, so a dead heat is
        # structurally possible - a photo finish is an honest DRAW (both still
        # collect the finish reward; the race pressure comes from decided runs).
        r_done = self.red_cp >= self.n_legs
        b_done = self.blue_cp >= self.n_legs
        if r_done or b_done:
            self.done = True
            if r_done and b_done:
                self.winner = None
                reward["red"] += WIN
                reward["blue"] += WIN
            else:
                self.winner = "red" if r_done else "blue"
                loser = "blue" if self.winner == "red" else "red"
                reward[self.winner] += WIN
                reward[loser] += LOSE

        # difference-of-potentials shaping toward each agent's CURRENT target.
        # On a checkpoint step phi is measured against the NEW target, so the
        # jump is absorbed by CHECKPOINT_BONUS rather than farmed via shaping.
        reward["red"] += self._potential("red", self.red_pos, self.red_cp) - phi0["red"]
        reward["blue"] += self._potential("blue", self.blue_pos, self.blue_cp) - phi0["blue"]

        truncated = False
        if not self.done and self.steps >= self.max_steps:
            self.done = True
            truncated = True
            # timeout: whoever is further along the tour takes it; tie -> draw
            if self.red_cp != self.blue_cp:
                self.winner = "red" if self.red_cp > self.blue_cp else "blue"
            else:
                self.winner = None

        obs = (self._observe("red", self.red_pos, self.red_vel, self.red_cp),
               self._observe("blue", self.blue_pos, self.blue_vel, self.blue_cp))
        return obs, reward, self.done, truncated, {"winner": self.winner}

    def to_json(self):
        """Arena descriptor for the viewer (/api/world). theme picks the JS scene;
        objective 'arena' tells the frontend this is a continuous round."""
        return {
            "theme": "tostarena",
            "objective": "arena",
            "roundId": self.round_id,
            "H": self.H, "W": self.W,
            "arena": float(ARENA),
            # the shared finish doubles as the 'goal' for arena-generic frontend code
            "goal": [float(FINISH[0]), float(FINISH[1])],
            "goalR": float(FINISH[2]),
            "spawns": {"red": list(self.red_spawn), "blue": list(self.blue_spawn)},
            # the ordered tours (checkpoints incl. the shared finish), per side
            "tours": {
                "red": [[float(x), float(z), float(r)] for (x, z, r) in RED_TOUR],
                "blue": [[float(x), float(z), float(r)] for (x, z, r) in BLUE_TOUR],
            },
            "quicksand": [[float(c[0]), float(c[1]), float(r)] for (c, r) in self.quicksand],
            "tornadoR": float(TORNADO_R),
            # no static blockers in this round; kept for arena-code parity
            "obstacles": [],
            # empty grid fields so any grid-expecting frontend code stays happy
            "rows": [], "escape": [], "slipCells": [],
        }

    # --------------------------------------------------------------- viewer
    def snapshot(self):
        rd = lambda v: [round(float(v[0]), 3), round(float(v[1]), 3)]  # noqa: E731
        return {
            "continuous": True,
            "red": rd(self.red_pos), "blue": rd(self.blue_pos),
            "redVel": rd(self.red_vel), "blueVel": rd(self.blue_vel),
            "redCp": int(self.red_cp), "blueCp": int(self.blue_cp),
            "goal": [float(FINISH[0]), float(FINISH[1])],
            "tornados": [rd(c) + [float(TORNADO_R)] for c in self._tornado_pos()],
            "obstacles": [],
            # parity flags so the existing viewer hides grid-round props
            "redKey": True, "blueKey": True,
            "gold": {"holder": None, "pos": None}, "trapArmed": False,
            "steps": self.steps, "winner": self.winner,
        }


# --------------------------------------------------------------------- self-test
def _greedy_to_target(env, which, pos):
    to, _r = env._target(which, env.red_cp if which == "red" else env.blue_cp)
    to = to - pos
    best, bestdot = 8, -1e9
    for a in range(8):
        dx, dz = DIRS[a]
        dot = dx * to[0] + dz * to[1]
        if dot > bestdot:
            bestdot, best = dot, a
    return best


if __name__ == "__main__":
    env = SequentialArena(seed=0)
    print(f"Arena {ARENA}x{ARENA}, {N_ACTIONS} actions, obs dim {OBS_DIM}, "
          f"{env.n_legs}-leg tour, {len(QUICKSAND)} quicksand pools, 2 tornados")

    # 1) random policy: episodes terminate, rewards finite, obs in range
    wins, lens = {"red": 0, "blue": 0, None: 0}, []
    for ep in range(200):
        env.reset(seed=ep)
        done = False
        while not done:
            ar, ab = env.rng.randrange(N_ACTIONS), env.rng.randrange(N_ACTIONS)
            (or_, ob_), rew, done, trunc, info = env.step(ar, ab)
            assert all(math.isfinite(v) for v in rew.values())
            assert np.all(np.abs(or_) <= 2.0) and np.all(np.abs(ob_) <= 2.0)
        wins[info["winner"]] += 1
        lens.append(env.steps)
    print(f"random: wins {wins}, avg len {sum(lens) / len(lens):.0f}")

    # 2) greedy-to-target red vs coasting blue: red should finish the whole tour
    reached = 0
    glens = []
    for ep in range(50):
        env.reset(seed=1000 + ep)
        done = False
        while not done:
            ar = _greedy_to_target(env, "red", env.red_pos)
            _, _, done, trunc, info = env.step(ar, 8)
        if info["winner"] == "red" and env.red_cp >= env.n_legs:
            reached += 1
            glens.append(env.steps)
    print(f"greedy red finished the tour: {reached}/50, avg steps {sum(glens) / max(1, len(glens)):.0f}")

    # 3) fairness: two identical greedy agents should split wins roughly evenly
    fair = {"red": 0, "blue": 0, None: 0}
    for ep in range(100):
        env.reset(seed=2000 + ep)
        done = False
        while not done:
            ar = _greedy_to_target(env, "red", env.red_pos)
            ab = _greedy_to_target(env, "blue", env.blue_pos)
            _, _, done, trunc, info = env.step(ar, ab)
        fair[info["winner"]] += 1
    print(f"mirror-greedy fairness: {fair} (dead heats are draws)")
    ok = reached >= 45
    print("OK" if ok else "WARN: tour hard to finish - tune physics/layout")
