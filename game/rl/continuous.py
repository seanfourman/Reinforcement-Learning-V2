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
import time

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
MISSILE_R = 0.30
MISSILE_SPAWN_Z = -2.0
MISSILE_MIN_SPEED = 3.2
MISSILE_MAX_SPEED = 6.8
EXPLOSION_HOLD_SECONDS = 1.25
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
MISSILE_OBS_DIM = 40
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
        opponent_pos = self.blue_pos if which == "red" else self.red_pos
        opponent_vel = self.blue_vel if which == "red" else self.red_vel
        opponent_rel = opponent_pos - pos
        rim_clearance = max(
            0.0,
            self.arena / 2 - AGENT_R
            - float(np.linalg.norm(pos - np.array([centre, centre], dtype=np.float32))),
        )
        difficulty = self._difficulty()
        interval = max(0, self.next_missile_step - self.steps)
        out = [
            (float(pos[0]) - centre) / centre,
            (float(pos[1]) - centre) / centre,
            float(vel[0]) / self.vmax,
            float(vel[1]) / self.vmax,
            float(opponent_rel[0]) / self.arena,
            float(opponent_rel[1]) / self.arena,
            float(opponent_vel[0]) / self.vmax,
            float(opponent_vel[1]) / self.vmax,
            rim_clearance / max(centre - AGENT_R, 1e-6),
            difficulty,
            min(1.0, interval / 20.0),
            1.0 if self._next_target == which else -1.0,
            min(1.0, self.steps / max(1, self.max_steps)),
        ]
        # Three stable launch-order slots cover the maximum concurrent threats.
        # Active/age/entered remove hidden missile state; the opponent terms above
        # make an untargeted missile's homing transition observable too.
        threats = {missile["slot"]: missile for missile in self.missiles}
        for slot in range(3):
            if slot in threats:
                missile = threats[slot]
                rel = missile["pos"] - pos
                out.extend([
                    1.0,
                    float(np.clip(rel[0] / self.arena, -2, 2)),
                    float(np.clip(rel[1] / self.arena, -2, 2)),
                    float(missile["vel"][0]) / MISSILE_MAX_SPEED,
                    float(missile["vel"][1]) / MISSILE_MAX_SPEED,
                    1.0 if missile["target"] == which else -1.0,
                    (0.35 + 2.45 * difficulty) / 2.8,
                    min(1.0, missile["age"] / 120.0),
                    1.0 if missile["entered"] else 0.0,
                ])
            else:
                out.extend([0.0] * 9)
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
            else:
                for event in self.explosions:
                    event["carryover"] = True
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

    # ------------------------------------------------------- Round-4 missiles
    def _missile_interval(self):
        # 1.4 s between early launches, falling to 0.6 s at maximum difficulty.
        return max(6, int(round(14 - 8 * self._difficulty())))

    def _missile_limit(self):
        d = self._difficulty()
        return 1 if d < 0.34 else 2 if d < 0.72 else 3

    def _spawn_missile(self):
        target = self._next_target
        self._next_target = "blue" if target == "red" else "red"
        target_pos = self.red_pos if target == "red" else self.blue_pos
        target_vel = self.red_vel if target == "red" else self.blue_vel
        difficulty = self._difficulty()
        spawn = np.array([
            self.arena / 2 + self.rng.uniform(-0.45, 0.45),
            MISSILE_SPAWN_Z,
        ], dtype=np.float32)
        # Early shots lead only a little and are almost straight. Later shots predict
        # the target more aggressively; bounded random aim makes every curve distinct.
        lead = 0.15 + difficulty * 0.55
        aim = target_pos + target_vel * lead
        aim[0] += self.rng.uniform(-0.8, 0.8) * (1.0 - difficulty * 0.55)
        direction = aim - spawn
        direction /= max(float(np.linalg.norm(direction)), 1e-6)
        speed = MISSILE_MIN_SPEED + (MISSILE_MAX_SPEED - MISSILE_MIN_SPEED) * difficulty
        occupied = {missile["slot"] for missile in self.missiles}
        slot = next(slot for slot in range(3) if slot not in occupied)
        self._missile_serial += 1
        self.missiles.append({
            "id": self._missile_serial,
            "slot": slot,
            "pos": spawn,
            "vel": direction.astype(np.float32) * speed,
            "target": target,
            "entered": False,
            "age": 0,
        })

    def _add_explosion(self, pos, hit=None, missile_id=None):
        self._explosion_serial += 1
        event = {
            "id": self._explosion_serial,
            "missileId": missile_id,
            "pos": np.asarray(pos, dtype=np.float32).copy(),
            "hit": hit,
            "expiresAt": time.monotonic() + EXPLOSION_HOLD_SECONDS,
            "carryover": False,
            "survivalTime": round(self.steps * self.dt, 2),
            "difficulty": round(self._difficulty(), 3),
        }
        self.explosions.append(event)
        self.explosions = self.explosions[-16:]

    def _age_explosions(self):
        now = time.monotonic()
        self.explosions = [
            event for event in self.explosions
            if event.get("expiresAt", now + 1) > now
        ]

    def _distance_bonus(self, pos):
        # Farther blasts are safer and therefore worth more. A full arena diameter
        # is the cap so reward stays bounded even for the offscreen launch point.
        return min(1.0, float(np.linalg.norm(pos)) / self.arena) * DISTANCE_REWARD

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
    def _swept_hit(m0, m1, a0, a1, radius):
        """Compatibility boolean used by the small standalone smoke test."""
        return ContinuousArena._swept_hit_time(
            m0, m1, a0, a1, radius) is not None

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

    def _advance_missiles(self, reward, old_red, old_blue):
        """Advance missiles in event-time order; return the first character hit(s)."""
        difficulty = self._difficulty()
        if (self.steps >= self.next_missile_step
                and len(self.missiles) < self._missile_limit()):
            self._spawn_missile()
            # Schedule from the actual launch, so a previously full active set cannot
            # release a multi-missile catch-up volley in one decision.
            self.next_missile_step = self.steps + self._missile_interval()

        centre = np.array([self.arena / 2, self.arena / 2], dtype=np.float32)
        rim = self.arena / 2 - MISSILE_R
        new_red, new_blue = self.red_pos.copy(), self.blue_pos.copy()
        paths = {
            "red": (old_red, new_red),
            "blue": (old_blue, new_blue),
        }
        plans = []
        for missile in self.missiles:
            target_pos = new_red if missile["target"] == "red" else new_blue
            target_vel = self.red_vel if missile["target"] == "red" else self.blue_vel
            missile["age"] += 1

            # Rotate toward a short prediction of the target, with a strict angular
            # speed cap. This produces readable curved arcs instead of aim snapping.
            lead = 0.12 + difficulty * 0.42
            desired = target_pos + target_vel * lead - missile["pos"]
            desired_angle = math.atan2(float(desired[1]), float(desired[0]))
            current_angle = math.atan2(float(missile["vel"][1]), float(missile["vel"][0]))
            delta = math.atan2(
                math.sin(desired_angle - current_angle),
                math.cos(desired_angle - current_angle),
            )
            turn_rate = 0.35 + 2.45 * difficulty
            turn = max(-turn_rate * self.dt, min(turn_rate * self.dt, delta))
            angle = current_angle + turn
            speed = MISSILE_MIN_SPEED + (
                MISSILE_MAX_SPEED - MISSILE_MIN_SPEED) * difficulty
            old_missile = missile["pos"].copy()
            missile["vel"] = np.array(
                [math.cos(angle) * speed, math.sin(angle) * speed],
                dtype=np.float32,
            )
            next_missile = missile["pos"] + missile["vel"] * self.dt

            candidates = []
            for side, (old_agent, new_agent) in paths.items():
                hit_time = self._swept_hit_time(
                    old_missile, next_missile, old_agent, new_agent,
                    MISSILE_R + AGENT_R,
                )
                if hit_time is not None:
                    candidates.append((hit_time, 0, "hit", side))

            old_dist = float(np.linalg.norm(old_missile - centre))
            new_dist = float(np.linalg.norm(next_missile - centre))
            entered_before = bool(missile["entered"]) or old_dist <= rim
            if old_dist <= rim or new_dist <= rim:
                missile["entered"] = True
            if entered_before and new_dist > rim:
                wall_time = self._circle_exit_time(
                    old_missile, next_missile, centre, rim)
                if wall_time is not None:
                    candidates.append((wall_time, 1, "wall", None))
            if missile["age"] > 120:  # safety fuse for an unlikely endless orbit
                candidates.append((1.0, 2, "fuse", None))

            event = None
            if candidates:
                first_time, _, first_kind, first_side = min(candidates)
                if first_kind == "hit":
                    sides = {
                        side for t, _, kind, side in candidates
                        if kind == "hit" and abs(t - first_time) <= 1e-5
                    }
                else:
                    sides = set()
                event = {
                    "time": first_time,
                    "kind": first_kind,
                    "sides": sides,
                    "pos": old_missile + (next_missile - old_missile) * first_time,
                }
            plans.append({
                "missile": missile,
                "old": old_missile,
                "new": next_missile,
                "event": event,
            })

        hit_events = [
            plan["event"] for plan in plans
            if plan["event"] and plan["event"]["kind"] == "hit"
        ]
        terminal_time = min(
            (event["time"] for event in hit_events), default=None)
        hits = set()
        if terminal_time is not None:
            for event in hit_events:
                if abs(event["time"] - terminal_time) <= 1e-5:
                    hits.update(event["sides"])

        cutoff = terminal_time if terminal_time is not None else 1.0
        survivors = []
        for plan in plans:
            missile = plan["missile"]
            event = plan["event"]
            if event is not None and event["time"] <= cutoff + 1e-5:
                hit_label = None
                if event["kind"] == "hit":
                    hit_label = (
                        next(iter(event["sides"]))
                        if len(event["sides"]) == 1 else "both"
                    )
                self._add_explosion(event["pos"], hit_label, missile["id"])
                for side, (old_agent, new_agent) in paths.items():
                    # A character hit by this blast gets the terminal penalty, not
                    # an additional "safe explosion" bonus.
                    if side in event["sides"]:
                        continue
                    agent_at_event = old_agent + (
                        new_agent - old_agent) * event["time"]
                    reward[side] += self._distance_bonus(
                        event["pos"] - agent_at_event)
                continue
            missile["pos"] = plan["old"] + (
                plan["new"] - plan["old"]) * cutoff
            survivors.append(missile)

        if terminal_time is not None:
            self.red_pos = old_red + (new_red - old_red) * terminal_time
            self.blue_pos = old_blue + (new_blue - old_blue) * terminal_time
        self.missiles = survivors
        return hits

    def _step_missile_game(self, a_red, a_blue):
        self._age_explosions()
        reward = {"red": SURVIVAL_REWARD, "blue": SURVIVAL_REWARD}
        old_red = self.red_pos.copy()
        old_blue = self.blue_pos.copy()
        self.red_pos, self.red_vel = self._integrate(self.red_pos, self.red_vel, a_red)
        self.blue_pos, self.blue_vel = self._integrate(self.blue_pos, self.blue_vel, a_blue)
        hits = self._advance_missiles(reward, old_red, old_blue)

        if hits:
            self.done = True
            if hits == {"red"}:
                self.winner = "blue"
                reward["red"] += HIT_PENALTY
                reward["blue"] += HIT_REWARD
            elif hits == {"blue"}:
                self.winner = "red"
                reward["blue"] += HIT_PENALTY
                reward["red"] += HIT_REWARD
            else:
                self.winner = None
                reward["red"] += HIT_PENALTY
                reward["blue"] += HIT_PENALTY

        truncated = False
        if not self.done and self.steps >= self.max_steps:
            self.done = True
            truncated = True
            self.winner = None
        obs = (
            self._observe("red", self.red_pos, self.red_vel),
            self._observe("blue", self.blue_pos, self.blue_vel),
        )
        return obs, reward, self.done, truncated, {
            "winner": self.winner,
            "hit": next(iter(hits)) if len(hits) == 1 else ("both" if hits else None),
        }

    # ------------------------------------------------------------------ step
    def step(self, a_red, a_blue):
        if self.done:
            raise RuntimeError("step() on a finished episode")
        self.steps += 1
        if self.missile_game:
            return self._step_missile_game(a_red, a_blue)

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

    def to_json(self):
        """Arena descriptor for the viewer (/api/world). theme picks the JS scene;
        objective 'arena' tells the frontend this is a continuous round."""
        out = {
            "theme": self.theme,
            "objective": "arena",
            "gameMode": "missileSurvival" if self.missile_game else "race",
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
            "goal": None if self.missile_game else [float(self.goal[0]), float(self.goal[1])],
            "goalR": None if self.missile_game else float(GOAL_R),
            "spawns": {"red": list(self.red_spawn), "blue": list(self.blue_spawn)},
            # no hazards on the skeleton; kept for arena-generic frontend code
            "obstacles": [],
            # empty grid fields so any grid-expecting frontend code stays happy
            "rows": [], "escape": [], "slipCells": [],
        }
        if self.missile_game:
            out["missile"] = {
                "radius": MISSILE_R,
                "entry": [self.arena / 2, MISSILE_SPAWN_Z],
                "minSpeed": MISSILE_MIN_SPEED,
                "maxSpeed": MISSILE_MAX_SPEED,
                "maxConcurrent": 3,
            }
        return out

    # --------------------------------------------------------------- viewer
    def snapshot(self):
        # Also expires live-only carryover while paused or after a target-episode
        # stop, where no further environment step would otherwise age events.
        if self.missile_game:
            self._age_explosions()
        rd = lambda v: [round(float(v[0]), 3), round(float(v[1]), 3)]  # noqa: E731
        out = {
            "continuous": True,
            "gameMode": "missileSurvival" if self.missile_game else "race",
            "red": rd(self.red_pos), "blue": rd(self.blue_pos),
            "redVel": rd(self.red_vel), "blueVel": rd(self.blue_vel),
            "goal": None if self.missile_game else rd(self.goal),
            "obstacles": [],
            "steps": self.steps, "winner": self.winner,
        }
        if self.missile_game:
            out.update({
                "survivalTime": round(self.steps * self.dt, 2),
                "difficulty": round(self._difficulty(), 3),
                "nextMissileIn": max(0, self.next_missile_step - self.steps),
                "missiles": [
                    {
                        "id": missile["id"],
                        "pos": rd(missile["pos"]),
                        "vel": rd(missile["vel"]),
                        "target": missile["target"],
                    }
                    for missile in self.missiles
                ],
                "explosions": [
                    {
                        "id": event["id"],
                        "missileId": event["missileId"],
                        "pos": rd(event["pos"]),
                        "hit": event["hit"],
                        "carryover": bool(event.get("carryover", False)),
                        "survivalTime": event.get("survivalTime"),
                        "difficulty": event.get("difficulty"),
                    }
                    for event in self.explosions
                ],
            })
        return out


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
    env = ContinuousArena(seed=0, round_id=4)
    print(f"Round 4: {env.arena}m {env.shape}, {N_ACTIONS} actions, "
          f"obs dim {env.obs_dim}, Banzai survival")

    # 1) Random dodging: missiles spawn, rewards stay finite, episodes terminate.
    wins, lens = {"red": 0, "blue": 0, None: 0}, []
    saw_missile = saw_blast = False
    for ep in range(100):
        env.reset(seed=ep, regenerate=True)
        done = False
        while not done:
            ar, ab = env.rng.randrange(N_ACTIONS), env.rng.randrange(N_ACTIONS)
            _, rew, done, trunc, info = env.step(ar, ab)
            assert all(math.isfinite(v) for v in rew.values())
            saw_missile |= bool(env.missiles)
            saw_blast |= bool(env.explosions)
        wins[info["winner"]] += 1
        lens.append(env.steps)
    assert saw_missile and saw_blast
    print(f"missiles: wins {wins}, avg survival {sum(lens) / len(lens):.0f} decisions")

    # 2) Round 5 remains the original solvable fly-to-goal race.
    env = ContinuousArena(seed=0, round_id=5, theme="tostarena")
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
    print(f"Round 5 goal reached: {reached}/50, avg steps {sum(glens) / max(1, len(glens)):.0f}")
    print("OK" if reached >= 45 else "WARN: goal hard to reach - tune physics")
