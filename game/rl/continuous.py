"""Continuous arena - the live env for the deep rounds (4 and 5).

SKELETON round (no real game yet): two agents fly across a continuous 2D arena to
a goal. Unlike the grid rounds there are no cells: the state is continuous
``(x, z, Vx, Vz)`` and the value function must be a function approximator (a neural
net), which is the whole point of the deep rounds. Actions are discrete thrusts
(8 compass directions + coast) applied as acceleration; velocity carries momentum
with drag and a speed cap and is integrated at ``DT``. First agent into the goal
radius wins. No obstacles, hazards, or reward shaping - a bare fly-to-goal shell
that each round's real game will be built on top of.

``theme`` picks which 3D scene the browser draws (ruined / tostarena / ...), so one
arena class backs several rounds.

Coords match the JS world: x = column, z = row, with the goal NORTH (small z) and
spawns SOUTH (large z), same as the grid rounds, so the diorama drops on top.

Interface mirrors env.GridWorld so the match loop can drive it:
    (obs_red, obs_blue), info = reset()
    obs, reward, done, truncated, info = step(a_red, a_blue)   # info['winner']
    frame = snapshot()
Observations are float32 numpy vectors (NN input), not tuples.
"""

import math
import random

import numpy as np

ARENA = 20.0          # square arena [0, ARENA]^2 (matches the board footprint)
DT = 0.05             # integration timestep
THRUST = 16.0         # acceleration magnitude applied by a thrust action
DAMP = 0.90           # velocity retained per step (drag); momentum but not forever
VMAX = 7.0            # speed cap (units/sec)
GOAL = (ARENA / 2, 2.5)
GOAL_R = 1.4          # capture radius
AGENT_R = 0.55
MAX_STEPS = 300       # optimal run is ~86 steps, so this is ample + cheap timeouts

# 8 compass thrust directions + coast (index 8). (dx, dz); -z = north (toward goal)
DIRS = [
    (0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0),
    (-0.7071, -0.7071), (0.7071, -0.7071), (-0.7071, 0.7071), (0.7071, 0.7071),
    (0.0, 0.0),
]
N_ACTIONS = len(DIRS)   # 9
OBS_DIM = 6

STEP_COST = 0.006
WIN, LOSE = 1.0, -1.0


class ContinuousArena:
    """Two-agent continuous race to a goal. Drop-in for the GridWorld match interface."""

    objective = "arena"

    def __init__(self, seed=None, round_id=4, theme="ruined",
                 thrust=THRUST, damp=DAMP, vmax=VMAX):
        self.round_id = round_id
        self.theme = theme
        self.rng = random.Random(seed)
        self.max_steps = MAX_STEPS
        # movement physics (module constants are the defaults)
        self.thrust = float(thrust)
        self.damp = float(damp)
        self.vmax = float(vmax)
        self.n_actions = N_ACTIONS          # match.py reads these off the env
        self.obs_dim = OBS_DIM
        self.H = self.W = int(ARENA)        # coarse grid the value field samples on
        self.goal = np.array(GOAL, dtype=np.float32)
        self.red_spawn = (ARENA - 3.0, ARENA - 2.5)   # red on the viewer's RIGHT
        self.blue_spawn = (3.0, ARENA - 2.5)           # blue on the viewer's LEFT (matches the HUD)
        self.steps = 0
        self.done = False
        self.winner = None
        self.reset()

    # --------------------------------------------------------------- helpers
    def _spawn_pos(self, which):
        x, z = self.red_spawn if which == "red" else self.blue_spawn
        return np.array([x, z], dtype=np.float32)

    def _dist_goal(self, pos):
        return float(np.linalg.norm(pos - self.goal))

    def _observe(self, pos, vel):
        gx, gz = self.goal
        return np.array([
            pos[0] / ARENA, pos[1] / ARENA,
            vel[0] / self.vmax, vel[1] / self.vmax,
            (gx - pos[0]) / ARENA, (gz - pos[1]) / ARENA,
        ], dtype=np.float32)

    def field_obs(self, which, x, z):
        """Observation for a STILL probe at (x,z) - drives the value/policy field."""
        return self._observe(np.array([x, z], dtype=np.float32), np.zeros(2, dtype=np.float32))

    # ----------------------------------------------------------------- reset
    def reset(self, *, seed=None, options=None, regenerate=False):
        if seed is not None:
            self.rng = random.Random(seed)
        self.red_pos = self._spawn_pos("red")
        self.blue_pos = self._spawn_pos("blue")
        self.red_vel = np.zeros(2, dtype=np.float32)
        self.blue_vel = np.zeros(2, dtype=np.float32)
        self.steps = 0
        self.done = False
        self.winner = None
        return (self._observe(self.red_pos, self.red_vel),
                self._observe(self.blue_pos, self.blue_vel)), {}

    def set_round(self, round_id):
        self.round_id = round_id
        self.reset(regenerate=True)

    # ------------------------------------------------------------- dynamics
    def _integrate(self, pos, vel, action):
        """Apply one thrust action: accelerate, drag, cap speed, move, clamp to the
        arena walls. Returns (new_pos, new_vel)."""
        dx, dz = DIRS[action]
        vel = vel + np.array([dx, dz], dtype=np.float32) * self.thrust * DT
        vel = vel * self.damp
        sp = float(np.linalg.norm(vel))
        if sp > self.vmax:
            vel = vel * (self.vmax / sp)
        npos = pos + vel * DT
        # arena walls: clamp and kill the offending velocity component
        for i in (0, 1):
            if npos[i] < AGENT_R:
                npos[i] = AGENT_R
                vel[i] = 0.0
            elif npos[i] > ARENA - AGENT_R:
                npos[i] = ARENA - AGENT_R
                vel[i] = 0.0
        return npos.astype(np.float32), vel.astype(np.float32)

    # ------------------------------------------------------------------ step
    def step(self, a_red, a_blue):
        if self.done:
            raise RuntimeError("step() on a finished episode")
        self.steps += 1
        reward = {"red": -STEP_COST, "blue": -STEP_COST}

        self.red_pos, self.red_vel = self._integrate(self.red_pos, self.red_vel, a_red)
        self.blue_pos, self.blue_vel = self._integrate(self.blue_pos, self.blue_vel, a_blue)

        # reach the goal -> win; both entering on the SAME step is a genuine DRAW
        r_in = self._dist_goal(self.red_pos) <= GOAL_R
        b_in = self._dist_goal(self.blue_pos) <= GOAL_R
        if r_in or b_in:
            self.done = True
            if r_in and b_in:
                self.winner = None
                reward["red"] += WIN
                reward["blue"] += WIN
            else:
                self.winner = "red" if r_in else "blue"
                loser = "blue" if self.winner == "red" else "red"
                reward[self.winner] += WIN
                reward[loser] += LOSE

        truncated = False
        if not self.done and self.steps >= self.max_steps:
            self.done = True
            truncated = True
            self.winner = None

        obs = (self._observe(self.red_pos, self.red_vel),
               self._observe(self.blue_pos, self.blue_vel))
        return obs, reward, self.done, truncated, {"winner": self.winner}

    def to_json(self):
        """Arena descriptor for the viewer (/api/world). theme picks the JS scene;
        objective 'arena' tells the frontend this is a continuous round."""
        return {
            "theme": self.theme,
            "objective": "arena",
            "roundId": self.round_id,
            "H": self.H, "W": self.W,
            "arena": float(ARENA),
            "goal": [float(self.goal[0]), float(self.goal[1])],
            "goalR": float(GOAL_R),
            "spawns": {"red": list(self.red_spawn), "blue": list(self.blue_spawn)},
            # no hazards on the skeleton; kept for arena-generic frontend code
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
            "goal": rd(self.goal),
            "obstacles": [],
            "steps": self.steps, "winner": self.winner,
        }


# --------------------------------------------------------------------- self-test
def _greedy_to_goal(env, pos, vel):
    """A hand policy that thrusts roughly toward the goal - sanity-checks that the
    physics let an agent actually reach it (so a learner can too)."""
    to = env.goal - pos
    best, bestdot = 8, -1e9
    for a in range(8):
        dx, dz = DIRS[a]
        dot = dx * to[0] + dz * to[1]
        if dot > bestdot:
            bestdot, best = dot, a
    return best


if __name__ == "__main__":
    env = ContinuousArena(seed=0)
    print(f"Arena {ARENA}x{ARENA}, {N_ACTIONS} actions, obs dim {OBS_DIM}, goal {GOAL}")

    # 1) random policy: episodes should terminate (win or timeout), rewards finite
    wins, lens = {"red": 0, "blue": 0, None: 0}, []
    for ep in range(200):
        env.reset(seed=ep)
        done = False
        while not done:
            ar, ab = env.rng.randrange(N_ACTIONS), env.rng.randrange(N_ACTIONS)
            _, rew, done, trunc, info = env.step(ar, ab)
            assert all(math.isfinite(v) for v in rew.values())
        wins[info["winner"]] += 1
        lens.append(env.steps)
    print(f"random: wins {wins}, avg len {sum(lens) / len(lens):.0f}")

    # 2) greedy-to-goal: red should reliably reach the goal (physics are solvable)
    reached, glens = 0, []
    for ep in range(50):
        env.reset(seed=1000 + ep)
        done = False
        while not done:
            ar = _greedy_to_goal(env, env.red_pos, env.red_vel)
            _, _, done, trunc, info = env.step(ar, 8)  # blue coasts
            if info["winner"] == "red":
                reached += 1
                glens.append(env.steps)
                break
    print(f"greedy-to-goal red reached: {reached}/50, avg steps {sum(glens) / max(1, len(glens)):.0f}")
    print("OK" if reached >= 45 else "WARN: goal hard to reach - tune physics")
