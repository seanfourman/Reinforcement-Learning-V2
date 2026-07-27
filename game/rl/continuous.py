"""Continuous environments for the deep rounds (4 and 5).

Round 4 is a two-agent survival duel on the circular Ruined Kingdom tower. Banzai
Bills enter through the north opening, curve toward a target, and explode on a
character or the tower rim. Agents earn reward for every moment survived and for
missiles detonating far away; the survivor wins when the other character is hit.

Round 5 retains the original continuous fly-to-goal race. Both environments use
discrete thrust actions with continuous position and velocity, so their DQN / policy
networks approximate functions over real-valued state rather than grid tables.

``theme`` picks which 3D scene the browser draws (ruined / tostarena / ...), so one
arena class backs several rounds.

Coords match the JS world: x = column and z = row; north is small z.

Interface mirrors env.GridWorld so the match loop can drive it:
    (obs_red, obs_blue), info = reset()
    obs, reward, done, truncated, info = step(a_red, a_blue)   # info['winner']
    frame = snapshot()
Observations are float32 numpy vectors (NN input), not tuples.
"""

import math
import random

import numpy as np

ARENA = 20.0          # default square arena used by the later continuous rounds
ROUND4_ARENA = 10.0   # Ruined Kingdom's playable room is exactly 10 x 10 metres
DT = 0.05             # integration timestep
THRUST = 16.0         # acceleration magnitude applied by a thrust action
DAMP = 0.90           # velocity retained per step (drag); momentum but not forever
VMAX = 7.0            # speed cap (units/sec)
GOAL_R = 1.4          # capture radius
AGENT_R = 0.55
MAX_STEPS = 300       # optimal run is ~86 steps, so this is ample + cheap timeouts

# Round-4 Banzai Bill survival game.
MISSILE_R = 0.46
MISSILE_SPAWN_Z = -2.0
MISSILE_MIN_SPEED = 3.2
MISSILE_MAX_SPEED = 6.8
MISSILE_TTL_STEPS = 8
SURVIVAL_REWARD = 0.015
DISTANCE_REWARD = 0.12
HIT_REWARD = 1.0
HIT_PENALTY = -1.25

# 8 compass thrust directions + coast (index 8). (dx, dz); -z = north (toward goal)
DIRS = [
    (0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0),
    (-0.7071, -0.7071), (0.7071, -0.7071), (-0.7071, 0.7071), (0.7071, 0.7071),
    (0.0, 0.0),
]
N_ACTIONS = len(DIRS)   # 9
RACE_OBS_DIM = 6
MISSILE_OBS_DIM = 16
# Backwards-compatible module export used by dqn.py's standalone Round-4 test.
OBS_DIM = MISSILE_OBS_DIM

STEP_COST = 0.006
WIN, LOSE = 1.0, -1.0


class ContinuousArena:
    """Round-4 missile survival / Round-5 race, with one shared match interface."""

    objective = "arena"

    def __init__(self, seed=None, round_id=4, theme="ruined",
                 thrust=THRUST, damp=DAMP, vmax=VMAX):
        self.round_id = round_id
        self.theme = theme
        # Round 4 is a compact 10 m room. Keep the shared Round-5 skeleton at its
        # original size so changing this arena cannot silently alter another game.
        self.arena = ROUND4_ARENA if round_id == 4 else ARENA
        self.shape = "circle" if round_id == 4 else "square"
        self.missile_game = round_id == 4
        # At the viewer's slow 3 decisions/sec, the original 50 ms integration
        # produced tiny shuffles. Round 4 advances a meaningful tenth of a second
        # per DQN action; the later shared arena keeps its original dynamics.
        self.dt = 0.10 if round_id == 4 else DT
        self.rng = random.Random(seed)
        self.max_steps = MAX_STEPS
        # movement physics (module constants are the defaults)
        self.thrust = float(thrust)
        self.damp = float(damp)
        self.vmax = float(vmax)
        self.n_actions = N_ACTIONS          # match.py reads these off the env
        self.obs_dim = MISSILE_OBS_DIM if self.missile_game else RACE_OBS_DIM
        self.H = self.W = int(self.arena)   # coarse grid the value field samples on
        self.goal = np.array((self.arena / 2, 2.5), dtype=np.float32)
        self.red_spawn = (self.arena - 3.0, self.arena - 2.5)  # viewer's RIGHT
        self.blue_spawn = (3.0, self.arena - 2.5)               # viewer's LEFT
        self.steps = 0
        self.done = False
        self.winner = None
        self.missiles = []
        self.explosions = []
        self._missile_serial = 0
        self._explosion_serial = 0
        self._next_target = self.rng.choice(("red", "blue"))
        self.next_missile_step = 6
        self.reset()

    # --------------------------------------------------------------- helpers
    def _spawn_pos(self, which):
        x, z = self.red_spawn if which == "red" else self.blue_spawn
        return np.array([x, z], dtype=np.float32)

    def _dist_goal(self, pos):
        return float(np.linalg.norm(pos - self.goal))

    def _observe_race(self, pos, vel):
        gx, gz = self.goal
        return np.array([
            pos[0] / self.arena, pos[1] / self.arena,
            vel[0] / self.vmax, vel[1] / self.vmax,
            (gx - pos[0]) / self.arena, (gz - pos[1]) / self.arena,
        ], dtype=np.float32)

    def _difficulty(self):
        """0..1 difficulty ramp over the first 24 simulated seconds."""
        return min(1.0, self.steps / 240.0)

    def _missile_observe(self, which, pos, vel):
        centre = self.arena / 2
        out = [
            (float(pos[0]) - centre) / centre,
            (float(pos[1]) - centre) / centre,
            float(vel[0]) / self.vmax,
            float(vel[1]) / self.vmax,
        ]
        # Two closest threats keep the input fixed-size while later difficulty can
        # put several missiles in flight. Each slot: relative position, velocity,
        # and whether this missile is explicitly homing on the observing agent.
        threats = sorted(
            self.missiles,
            key=lambda m: float(np.linalg.norm(m["pos"] - pos)),
        )[:2]
        for slot in range(2):
            if slot < len(threats):
                missile = threats[slot]
                rel = missile["pos"] - pos
                out.extend([
                    float(np.clip(rel[0] / self.arena, -2, 2)),
                    float(np.clip(rel[1] / self.arena, -2, 2)),
                    float(missile["vel"][0]) / MISSILE_MAX_SPEED,
                    float(missile["vel"][1]) / MISSILE_MAX_SPEED,
                    1.0 if missile["target"] == which else -1.0,
                ])
            else:
                out.extend([0.0] * 5)
        interval = max(1, self.next_missile_step - self.steps)
        out.extend([self._difficulty(), min(1.0, interval / 20.0)])
        return np.asarray(out, dtype=np.float32)

    def _observe(self, which, pos, vel):
        if self.missile_game:
            return self._missile_observe(which, pos, vel)
        return self._observe_race(pos, vel)

    def field_obs(self, which, x, z):
        """A still-state probe used by the sampled continuous Value/Policy fields."""
        return self._observe(
            which,
            np.array([x, z], dtype=np.float32),
            np.zeros(2, dtype=np.float32),
        )

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
        if self.missile_game:
            self.missiles = []
            self.next_missile_step = 6
            self._next_target = self.rng.choice(("red", "blue"))
            # Keep recent explosions through the automatic episode reset long
            # enough for the browser to receive and animate the terminal blast.
            if regenerate:
                self.explosions = []
        return (self._observe("red", self.red_pos, self.red_vel),
                self._observe("blue", self.blue_pos, self.blue_vel)), {}

    def set_round(self, round_id):
        self.round_id = round_id
        self.reset(regenerate=True)

    # ------------------------------------------------------------- dynamics
    def _integrate(self, pos, vel, action):
        """Apply one thrust action: accelerate, drag, cap speed, move, clamp to the
        arena walls. Returns (new_pos, new_vel)."""
        dx, dz = DIRS[action]
        vel = vel + np.array([dx, dz], dtype=np.float32) * self.thrust * self.dt
        vel = vel * self.damp
        sp = float(np.linalg.norm(vel))
        if sp > self.vmax:
            vel = vel * (self.vmax / sp)
        npos = pos + vel * self.dt
        if self.shape == "circle":
            # Project onto the circular tower rim and remove only outward velocity,
            # so an agent naturally slides along the edge instead of hitting an
            # invisible square wall.
            centre = np.array([self.arena / 2, self.arena / 2], dtype=np.float32)
            radial = npos - centre
            dist = float(np.linalg.norm(radial))
            limit = self.arena / 2 - AGENT_R
            if dist > limit:
                normal = radial / max(dist, 1e-6)
                npos = centre + normal * limit
                outward = float(np.dot(vel, normal))
                if outward > 0:
                    vel = vel - normal * outward
        else:
            # square arena walls: clamp and kill the offending velocity component
            for i in (0, 1):
                if npos[i] < AGENT_R:
                    npos[i] = AGENT_R
                    vel[i] = 0.0
                elif npos[i] > self.arena - AGENT_R:
                    npos[i] = self.arena - AGENT_R
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
            "arena": float(self.arena),
            "shape": self.shape,
            "decisionDt": self.dt,
            # Round 4's art and camera were authored around world centre (10, 10).
            # Its 10 m simulation is rendered there rather than moving the whole
            # established composition to (5, 5).
            "sceneCenter": [10.0, 10.0] if self.round_id == 4 else None,
            # Fill the round tower's usable top (30 scene units across) while the
            # actual continuous environment remains a 10 m diameter circle.
            "sceneScale": 3.0 if self.round_id == 4 else 1.0,
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
    print(f"Arena {env.arena}x{env.arena}, {N_ACTIONS} actions, "
          f"obs dim {OBS_DIM}, goal {tuple(env.goal)}")

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
