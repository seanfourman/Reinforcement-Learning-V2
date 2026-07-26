"""Round 4 - Ruined Kingdom CONTINUOUS arena (DQN vs Double-DQN).

Two agents race across a continuous 2D arena to a goal. Unlike the grid rounds
there are no cells: the state is continuous ``(x, z, Vx, Vz)`` and the value
function must be a function approximator (a neural net), which is the whole point
of this round. Actions are discrete thrusts (8 compass directions + coast)
applied as acceleration; velocity carries momentum with drag and a speed cap and
is integrated at ``DT``. First agent into the goal radius wins; static ruin
obstacles block the way.

Coords match the JS world: x = column, z = row, with the goal NORTH (small z) and
spawns SOUTH (large z), same as the 'cross' grid rounds, so the Ruined Kingdom
diorama drops on top later without remapping.

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

# static ruin obstacles (x, z, radius), symmetric L<->R so the race is fair
OBSTACLES = [
    (ARENA / 2, 9.0, 1.8),     # central pillar between spawns and goal
    (6.0, 13.5, 1.5),          # left rubble
    (14.0, 13.5, 1.5),         # right rubble (mirror)
    (6.0, 5.5, 1.3),           # left upper
    (14.0, 5.5, 1.3),          # right upper (mirror)
]

STEP_COST = 0.006
SHAPE_W = 0.05        # stronger pull toward the goal (still difference-form, unfarmable)
HIT_PENALTY = 0.02
WIN, LOSE = 1.0, -1.0


class ContinuousArena:
    """Two-agent continuous race. Drop-in-ish for the GridWorld match interface."""

    objective = "arena"

    def __init__(self, seed=None, round_id=4, thrust=THRUST, damp=DAMP,
                 vmax=VMAX, obstacle_count=None):
        self.round_id = round_id
        self.rng = random.Random(seed)
        self.max_steps = MAX_STEPS
        # tunable dynamics (panel-driven; module constants are the defaults)
        self.thrust = float(thrust)
        self.damp = float(damp)
        self.vmax = float(vmax)
        self.n_actions = N_ACTIONS          # match.py reads these off the env
        self.obs_dim = OBS_DIM
        self.H = self.W = int(ARENA)        # coarse grid the value field samples on
        self.goal = np.array(GOAL, dtype=np.float32)
        self.obstacles = self._gen_obstacles(obstacle_count)
        self.red_spawn = (ARENA - 3.0, ARENA - 2.5)   # red on the viewer's RIGHT
        self.blue_spawn = (3.0, ARENA - 2.5)           # blue on the viewer's LEFT (matches the HUD)
        self.steps = 0
        self.done = False
        self.winner = None
        self.reset()

    def _gen_obstacles(self, count):
        """Obstacle ruins. None -> the hand-tuned default 5; otherwise generate
        `count` mirror-symmetric ruins (central pillar for odd counts) so the
        race stays fair whatever the panel sets."""
        if count is None:
            base = OBSTACLES
        else:
            count = max(0, min(12, int(count)))
            cx = ARENA / 2
            base, rem = [], count
            if rem % 2 == 1:
                base.append((cx, 9.0, 1.8))
                rem -= 1
            zs = [13.5, 5.5, 11.0, 7.5, 15.5, 3.5]
            dxs = [4.0, 4.0, 6.5, 6.5, 3.0, 3.0]
            for p in range(rem // 2):
                z, dx = zs[p % len(zs)], dxs[p % len(dxs)]
                base.append((cx - dx, z, 1.5))
                base.append((cx + dx, z, 1.5))
        return [(np.array([x, z], dtype=np.float32), r) for (x, z, r) in base]

    # --------------------------------------------------------------- helpers
    def _spawn_pos(self, which):
        x, z = self.red_spawn if which == "red" else self.blue_spawn
        return np.array([x, z], dtype=np.float32)

    def _dist_goal(self, pos):
        return float(np.linalg.norm(pos - self.goal))

    def _potential(self, pos):
        # Φ = -W * distance-to-goal; F = Φ' - Φ rewards closing the gap (dense,
        # un-farmable - same shaping idea as the grid env).
        return -SHAPE_W * self._dist_goal(pos)

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
        """Apply one thrust action: accelerate, drag, cap speed, move, collide.
        Returns (new_pos, new_vel, hit) - hit True if it bumped an obstacle/wall."""
        dx, dz = DIRS[action]
        vel = vel + np.array([dx, dz], dtype=np.float32) * self.thrust * DT
        vel = vel * self.damp
        sp = float(np.linalg.norm(vel))
        if sp > self.vmax:
            vel = vel * (self.vmax / sp)
        npos = pos + vel * DT
        hit = False
        # arena walls: clamp and kill the offending velocity component
        for i in (0, 1):
            if npos[i] < AGENT_R:
                npos[i] = AGENT_R
                vel[i] = 0.0
                hit = True
            elif npos[i] > ARENA - AGENT_R:
                npos[i] = ARENA - AGENT_R
                vel[i] = 0.0
                hit = True
        # circular obstacles: push out along the normal, remove inward velocity
        for c, r in self.obstacles:
            d = npos - c
            dist = float(np.linalg.norm(d))
            mind = r + AGENT_R
            if dist < mind:
                n = d / dist if dist > 1e-6 else np.array([1.0, 0.0], dtype=np.float32)
                npos = c + n * mind
                vn = float(np.dot(vel, n))
                if vn < 0:
                    vel = vel - n * vn      # cancel the into-the-wall component
                hit = True
        # obstacle push-out can shove the agent back past a wall that was clamped
        # earlier this step (a corner squeeze), so re-clamp to the arena bounds
        for i in (0, 1):
            npos[i] = min(max(npos[i], AGENT_R), ARENA - AGENT_R)
        return npos.astype(np.float32), vel.astype(np.float32), hit

    # ------------------------------------------------------------------ step
    def step(self, a_red, a_blue):
        if self.done:
            raise RuntimeError("step() on a finished episode")
        self.steps += 1
        reward = {"red": -STEP_COST, "blue": -STEP_COST}
        phi0 = {"red": self._potential(self.red_pos), "blue": self._potential(self.blue_pos)}

        self.red_pos, self.red_vel, hit_r = self._integrate(self.red_pos, self.red_vel, a_red)
        self.blue_pos, self.blue_vel, hit_b = self._integrate(self.blue_pos, self.blue_vel, a_blue)
        if hit_r:
            reward["red"] -= HIT_PENALTY
        if hit_b:
            reward["blue"] -= HIT_PENALTY

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

        # difference-of-potentials progress shaping
        reward["red"] += self._potential(self.red_pos) - phi0["red"]
        reward["blue"] += self._potential(self.blue_pos) - phi0["blue"]

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
            "theme": "ruined",
            "objective": "arena",
            "roundId": self.round_id,
            "H": self.H, "W": self.W,
            "arena": float(ARENA),
            "goal": [float(self.goal[0]), float(self.goal[1])],
            "goalR": float(GOAL_R),
            "spawns": {"red": list(self.red_spawn), "blue": list(self.blue_spawn)},
            "obstacles": [[float(c[0]), float(c[1]), float(r)] for c, r in self.obstacles],
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
            "obstacles": [[round(float(c[0]), 2), round(float(c[1]), 2), float(r)]
                          for c, r in self.obstacles],
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
    print(f"Arena {ARENA}x{ARENA}, {N_ACTIONS} actions, obs dim {OBS_DIM}, "
          f"{len(OBSTACLES)} obstacles, goal {GOAL}")

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
    reached = 0
    glens = []
    for ep in range(50):
        (or_, _), _ = env.reset(seed=1000 + ep)
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
