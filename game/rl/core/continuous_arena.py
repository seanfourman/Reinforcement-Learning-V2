"""The shared CONTINUOUS engine behind the deep rounds (4 and 5).

Positions and velocities are real-valued vectors, so the observation is a
float32 numpy vector (a neural network's input), not a table key - which is
exactly why Rounds 4/5 need function approximation. This module owns what the
two continuous rounds share:

  * the discrete-thrust action alphabet (8 compass directions + coast);
  * one physics integrator (momentum + drag, or direct velocity), with both
    square-wall and circular-rim collision handling;
  * swept-circle collision geometry (segment/circle entry + exit times) used
    for missiles, pickups and shells;
  * the action-repeat commit window (Round 4 holds a heading for several
    fine 0.02 s steps);
  * the reset / step / snapshot / to_json skeleton the tournament drives.

Round mechanics live in the arena subclasses: Round 4's Banzai-Bill survival
in ``arenas/r4_ruined_kingdom/arena.py`` and Round 5's Capture the Flag in
``arenas/r5_tostarena/arena.py``. The base class by itself plays the plain
fly-to-goal RACE the deep rounds grew from; the subclasses override
``_observe`` / ``step`` / ``snapshot`` / ``to_json`` and the ``_init_round_state``
/ ``_reset_round_state`` hooks.

Interface mirrors the grid engine so the tournament can drive either:
    (obs_red, obs_blue), info = reset()
    obs, reward, done, truncated, info = step(a_red, a_blue)   # info['winner']
    frame = snapshot()

Coords match the JS world: x = column and z = row; screen-up is small z.
"""

import math
import random

import numpy as np

ARENA = 20.0          # default square arena side (metres); Round 4 overrides
DT = 0.05             # default integration timestep; Round 4 uses a finer one
THRUST = 16.0         # acceleration magnitude applied by a thrust action
DAMP = 0.90           # velocity retained per step (drag); momentum but not forever
VMAX = 7.0            # speed cap (units/sec)
GOAL_R = 1.4          # race capture radius
AGENT_R = 0.55
MAX_STEPS = 300       # race cap: an optimal run is ~86 steps, so this is ample

# 8 thrust directions + coast (index 8). (dx, dz); -z = screen-up (toward goal)
DIRS = [
    (0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0),
    (-0.7071, -0.7071), (0.7071, -0.7071), (-0.7071, 0.7071), (0.7071, 0.7071),
    (0.0, 0.0),
]
N_ACTIONS = len(DIRS)   # 9
RACE_OBS_DIM = 6

STEP_COST = 0.006
WIN, LOSE = 1.0, -1.0


class ContinuousArena:
    """The continuous engine; each deep arena subclasses this with its game."""

    objective = "arena"

    # ---- mode flags + per-round geometry; the arena subclasses override these
    missile_game = False    # Round 4: Banzai Bill survival
    ctf_game = False        # Round 5: Capture the Flag
    arena = ARENA           # board size in metres (side / diameter)
    shape = "square"        # "square" walls or a "circle" rim
    dt = DT                 # decision timestep (Round 4 uses the spec's 0.02 s)
    momentum = True         # thrust+drag physics (False = direct discrete velocity)
    action_repeat = 1       # heading commit window (Round 4 holds for 4 steps)
    max_steps = MAX_STEPS   # per-episode cap (each arena sets its own)
    n_actions = N_ACTIONS   # CTF adds a 10th "use weapon" action
    obs_dim = RACE_OBS_DIM  # each arena sets its observation width

    def __init__(self, seed=None, round_id=4, theme="ruined",
                 thrust=THRUST, damp=DAMP, vmax=VMAX):
        self.round_id = round_id
        self.theme = theme
        self._committed = {"red": N_ACTIONS - 1, "blue": N_ACTIONS - 1}  # default: stay
        self._commit_left = {"red": 0, "blue": 0}
        self._executed = {"red": N_ACTIONS - 1, "blue": N_ACTIONS - 1}
        self.rng = random.Random(seed)
        # movement physics (module constants are the defaults)
        self.thrust = float(thrust)
        self.damp = float(damp)
        self.vmax = float(vmax)
        self.H = self.W = int(self.arena)   # coarse grid the value field samples on
        self.goal = np.array((self.arena / 2, 2.5), dtype=np.float32)
        self.red_spawn = (self.arena - 3.0, self.arena - 2.5)  # viewer's RIGHT
        self.blue_spawn = (3.0, self.arena - 2.5)               # viewer's LEFT
        self._init_round_state()
        self.steps = 0
        self.done = False
        self.winner = None
        # Historical quirk kept for seeded reproducibility: the engine has always
        # burned ONE rng sample here (the missile round's first-target coin flip)
        # on EVERY round. Removing it on the other rounds would shift their entire
        # seeded random stream, so the draw stays shared; only Round 4 reads it.
        self._next_target = self.rng.choice(("red", "blue"))
        self.reset()

    def _init_round_state(self):
        """Arena hook: one-time construction of the round's own state
        (bases/flag/weapons for CTF; missiles/pickups/hearts for survival)."""

    # --------------------------------------------------------------- helpers
    def _spawn_pos(self, which):
        x, z = self.red_spawn if which == "red" else self.blue_spawn
        return np.array([x, z], dtype=np.float32)

    def _dist_goal(self, pos):
        return float(np.linalg.norm(pos - self.goal))

    def _seconds_to_steps(self, seconds):
        return max(1, int(round(float(seconds) / self.dt)))

    def _game_mode(self):
        """The frontend's mode string; each arena overrides."""
        return "race"

    def _observe_race(self, pos, vel):
        gx, gz = self.goal
        return np.array([
            pos[0] / self.arena, pos[1] / self.arena,
            vel[0] / self.vmax, vel[1] / self.vmax,
            (gx - pos[0]) / self.arena, (gz - pos[1]) / self.arena,
        ], dtype=np.float32)

    def _observe(self, which, pos, vel):
        """The per-agent observation vector; each arena overrides with its own."""
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
        self._commit_left = {"red": 0, "blue": 0}          # fresh action-repeat window
        self._committed = {"red": N_ACTIONS - 1, "blue": N_ACTIONS - 1}
        self._executed = {"red": N_ACTIONS - 1, "blue": N_ACTIONS - 1}
        self._reset_round_state(regenerate)
        return (self._observe("red", self.red_pos, self.red_vel),
                self._observe("blue", self.blue_pos, self.blue_vel)), {}

    def _reset_round_state(self, regenerate):
        """Arena hook: per-episode reset of the round's own state."""

    # ------------------------------------------------------------- dynamics
    def _integrate(self, pos, vel, action, speed_multiplier=1.0, frozen=False):
        """Apply one thrust action: accelerate, drag, cap speed, move, clamp to the
        arena walls. Returns (new_pos, new_vel)."""
        if frozen:
            return pos.copy().astype(np.float32), np.zeros(2, dtype=np.float32)
        speed_multiplier = max(0.0, float(speed_multiplier))
        dx, dz = DIRS[action]
        direction = np.array([dx, dz], dtype=np.float32)
        if self.momentum:
            # Round-5 physics: thrust accelerates, drag bleeds off, speed is capped,
            # so velocity ACCUMULATES across steps (real inertia).
            vel = vel + direction * self.thrust * speed_multiplier * self.dt
            vel = vel * self.damp
            sp = float(np.linalg.norm(vel))
            effective_vmax = self.vmax * speed_multiplier
            if sp > effective_vmax:
                vel = vel * (effective_vmax / sp)
        else:
            # Round-4 (spec): velocity is SET DIRECTLY from the chosen discrete
            # direction each step - no momentum, no drag. v = direction x speed.
            vel = direction * (self.vmax * speed_multiplier)
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

    # ------------------------------------------------- swept-circle geometry
    @staticmethod
    def _segment_circle_entry_time(p0, p1, centre, radius):
        """Return the first 0..1 time a moving point enters a fixed circle."""
        delta = p1 - p0
        rel = p0 - centre
        c = float(np.dot(rel, rel)) - radius * radius
        if c <= 0:
            return 0.0
        a = float(np.dot(delta, delta))
        if a < 1e-9:
            return None
        b = 2.0 * float(np.dot(rel, delta))
        disc = b * b - 4.0 * a * c
        if disc < 0:
            return None
        root = math.sqrt(max(0.0, disc))
        enter = (-b - root) / (2.0 * a)
        leave = (-b + root) / (2.0 * a)
        if leave < 0.0 or enter > 1.0:
            return None
        return max(0.0, min(1.0, enter))

    @staticmethod
    def _swept_hit_time(m0, m1, a0, a1, radius):
        """Earliest 0..1 contact time for two linearly moving circles."""
        rel0 = m0 - a0
        relv = (m1 - m0) - (a1 - a0)
        c = float(np.dot(rel0, rel0)) - radius * radius
        if c <= 0:
            return 0.0
        a = float(np.dot(relv, relv))
        if a < 1e-9:
            return None
        b = 2.0 * float(np.dot(rel0, relv))
        disc = b * b - 4.0 * a * c
        if disc < 0:
            return None
        root = math.sqrt(max(0.0, disc))
        enter = (-b - root) / (2.0 * a)
        leave = (-b + root) / (2.0 * a)
        if leave < 0.0 or enter > 1.0:
            return None
        return max(0.0, min(1.0, enter))

    @staticmethod
    def _circle_exit_time(p0, p1, centre, radius):
        """Earliest segment time that leaves a circle, assuming p0 is inside."""
        delta = p1 - p0
        rel = p0 - centre
        a = float(np.dot(delta, delta))
        if a < 1e-9:
            return None
        b = 2.0 * float(np.dot(rel, delta))
        c = float(np.dot(rel, rel)) - radius * radius
        disc = b * b - 4.0 * a * c
        if disc < 0:
            return None
        root = math.sqrt(max(0.0, disc))
        times = sorted(((-b - root) / (2.0 * a), (-b + root) / (2.0 * a)))
        return next((max(0.0, t) for t in times if -1e-7 <= t <= 1.0 + 1e-7), None)

    # ---------------------------------------------------------- action repeat
    def _commit_action(self, side, a):
        """Action-repeat: hold the chosen direction for `action_repeat` steps, so the
        EXECUTED motion commits instead of flip-flopping every fine step. Returns (and
        records in self._executed) the action actually applied this step, so the learner
        trains on the real transition, not a picked action that never took effect."""
        if self._commit_left[side] <= 0:
            self._committed[side] = a
            self._commit_left[side] = self.action_repeat
        self._commit_left[side] -= 1
        self._executed[side] = self._committed[side]
        return self._committed[side]

    # ------------------------------------------------------------------ step
    def step(self, a_red, a_blue):
        """The base engine's game: the plain fly-to-goal race. The arenas
        override this with their own step (survival / CTF)."""
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

        obs = (self._observe("red", self.red_pos, self.red_vel),
               self._observe("blue", self.blue_pos, self.blue_vel))
        return obs, reward, self.done, truncated, {"winner": self.winner}

    # --------------------------------------------------------------- viewer
    def to_json(self):
        """Arena descriptor for the viewer (/api/world). theme picks the JS scene;
        objective 'arena' tells the frontend this is a continuous round. Each
        arena's override appends its own config block."""
        return {
            "theme": self.theme,
            "objective": "arena",
            "gameMode": self._game_mode(),
            "roundId": self.round_id,
            "H": self.H, "W": self.W,
            "arena": float(self.arena),
            "shape": self.shape,
            "decisionDt": self.dt,
            # arenas whose art was authored around another origin override these
            "sceneCenter": None,
            "sceneScale": 1.0,
            "goal": (None if (self.missile_game or self.ctf_game)
                     else [float(self.goal[0]), float(self.goal[1])]),
            "goalR": None if (self.missile_game or self.ctf_game) else float(GOAL_R),
            "spawns": {"red": list(self.red_spawn), "blue": list(self.blue_spawn)},
            # no static obstacles in either arena; kept for arena-generic frontend code
            "obstacles": [],
            # empty grid fields so any grid-expecting frontend code stays happy
            "rows": [], "escape": [], "slipCells": [],
        }

    def snapshot(self):
        """Live render state for the viewer; each arena's override appends its
        round's entities (missiles / flags / weapons / ...)."""
        rd = lambda v: [round(float(v[0]), 3), round(float(v[1]), 3)]  # noqa: E731
        return {
            "continuous": True,
            "gameMode": self._game_mode(),
            "red": rd(self.red_pos), "blue": rd(self.blue_pos),
            "redVel": rd(self.red_vel), "blueVel": rd(self.blue_vel),
            "goal": None if (self.missile_game or self.ctf_game) else rd(self.goal),
            "obstacles": [],
            "steps": self.steps, "winner": self.winner,
        }
