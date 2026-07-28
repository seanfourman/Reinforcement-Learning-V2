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
MAX_STEPS = 300       # Round-5 race: optimal run is ~86 steps, so this is ample
# Round-4 survival has no real target length: let a good agent last as long as it
# can. This is only a runaway safety ceiling, not a goal the agents ever approach.
MISSILE_MAX_STEPS = 10_000

# Round-4 Banzai Bill survival game.
MISSILE_R = 0.30
MISSILE_SPAWN_Z = -2.0
MISSILE_MIN_SPEED = 3.2
# Below the agent's own top speed (VMAX 7.0) so a single Bill is always OUTRUNNABLE:
# the difficulty comes from facing MANY at once, not from one unavoidable missile.
MISSILE_MAX_SPEED = 5.4
EXPLOSION_HOLD_SECONDS = 1.25
SURVIVAL_REWARD = 0.02
HIT_REWARD = 0.05        # small: this is a SURVIVAL game, not a "kill the rival" game
HIT_PENALTY = -2.0       # losing a heart hurts a lot: dodging is the whole task
EVADE_REWARD = 0.15      # a missile aimed at you expiring without a hit = you dodged it
REDIRECT_BONUS = 0.0     # baiting the rival is off: it only added variance/noise

# 3 lives (hearts).  A hit costs one heart and grants a brief invincibility IN
# PLACE (the character is NOT teleported back to spawn); the round ends only when
# a character runs OUT of hearts.  This is why episodes are long (both to watch AND
# to learn from): a single mistake no longer ends everything, so the agent keeps
# accumulating dodging experience.  The frontend blinks the character while the
# invincibility lasts (classic post-hit flicker).
HEARTS = 3
HIT_INVULN_SECONDS = 0.9

# Threat-aware dodge shaping.  The comparison uses the same missile state before
# and after the character's movement, so reward comes from changing the projected
# miss distance rather than from a Bill naturally flying past.  The signed,
# aggregate cap prevents left/right oscillation from becoming a reward farm.
DODGE_SHAPING_CAP = 0.025
DODGE_THREAT_HORIZON = 1.4
DODGE_THREAT_MARGIN = 0.25

# The first training episodes deliberately expose only a fraction of Round 4's
# final pressure.  Match supplies the completed-episode count before every reset.
MISSILE_CURRICULUM_EPISODES = 1_000

# Round-4 collectible pickups.  Timings are expressed in simulated seconds and
# converted to integral decision steps by the environment, so training remains
# reproducible at any wall-clock playback speed.
PICKUP_TYPES = ("speed", "invincible", "slow", "freeze")
PICKUP_R = 0.42
PICKUP_MAX_ACTIVE = 2
PICKUP_FIRST_SECONDS = 2.5
PICKUP_INTERVAL_SECONDS = (4.0, 6.0)
PICKUP_GROUND_LIFETIME = 12.0
PICKUP_EVENT_HOLD_SECONDS = 0.9
PICKUP_EFFECT_SECONDS = {
    "speed": 4.0,
    "invincible": 2.5,
    "slow": 3.0,
    "freeze": 1.1,
}
SPEED_MULTIPLIER = 1.7
SLOW_MULTIPLIER = 0.5

# ---- Endless escalation: the arena gets more chaotic the longer you survive ----
# "chaos" grows with survival time WITHOUT an upper bound (gated by the training
# curriculum) and drives the missile + pickup COUNT. "sharpness" = chaos capped at
# 1 and drives how fast / how hard each missile homes. The ramp is deliberately
# gentler early than the old fixed cap (few slow missiles at first, so a run breathes
# before the storm), then keeps climbing: 3 Bills by ~500 steps, 4 by ~750, 5 by
# ~1000, up to the hard cap. So a good agent survives further AND meets real chaos.
CHAOS_RAMP_STEPS = 220.0    # steps for missile SHARPNESS (speed/homing) to peak
MISSILE_HARD_CAP = 3        # hard cap: never more than 3 Bills in the air at once
PICKUP_HARD_CAP = 6         # up from 2
OBS_MISSILE_SLOTS = 3       # the net sees all 3 possible threats (sorted by imminence)
OBS_PICKUP_SLOTS = 3        # + the 3 nearest pickups (grab the good ones, dodge the bad)

# 8 compass thrust directions + coast (index 8). (dx, dz); -z = north (toward goal)
DIRS = [
    (0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0),
    (-0.7071, -0.7071), (0.7071, -0.7071), (-0.7071, 0.7071), (0.7071, 0.7071),
    (0.0, 0.0),
]
N_ACTIONS = len(DIRS)   # 9
RACE_OBS_DIM = 6
# Slim, THREAT-SORTED survival observation:
#   5 own kinematics (pos, vel, rim clearance)
# + 4 own power-up timers + 1 post-hit mercy-invuln timer (altered motion / brief
#   immunity are explained, so the agent can exploit the window instead of fearing it)
# + OBS_MISSILE_SLOTS x 8, SORTED nearest-threat-first (not by spawn slot), each:
#   present, rel x, rel z, vel x, vel z, aimed-at-me, time-to-impact, predicted-miss
# + OBS_PICKUP_SLOTS x 7 nearest pickups: present, rel x, rel z, type one-hot(4)
MISSILE_OBS_DIM = 5 + 5 + OBS_MISSILE_SLOTS * 8 + OBS_PICKUP_SLOTS * 7   # 55
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
        self.max_steps = MISSILE_MAX_STEPS if self.missile_game else MAX_STEPS
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
        self.pickups = []
        self.pickup_events = []
        self.effects = {
            side: {kind: 0 for kind in PICKUP_TYPES}
            for side in ("red", "blue")
        }
        self.hearts = {"red": HEARTS, "blue": HEARTS}
        # post-hit mercy invulnerability (steps), separate from the pickup shield so
        # the frontend can BLINK the character here but show the shield for the pickup.
        self.hit_flash = {"red": 0, "blue": 0}
        self._missile_serial = 0
        self._explosion_serial = 0
        self._pickup_serial = 0
        self._pickup_event_serial = 0
        # Standalone users retain the complete game. Match explicitly sets this to
        # the current training episode (zero for a fresh learner) before reset.
        self.curriculum_episode = MISSILE_CURRICULUM_EPISODES
        self._next_target = self.rng.choice(("red", "blue"))
        self.next_missile_step = 6
        self.next_pickup_step = self._seconds_to_steps(PICKUP_FIRST_SECONDS)
        self.reset()

    # --------------------------------------------------------------- helpers
    def _spawn_pos(self, which):
        x, z = self.red_spawn if which == "red" else self.blue_spawn
        return np.array([x, z], dtype=np.float32)

    def _dist_goal(self, pos):
        return float(np.linalg.norm(pos - self.goal))

    def _seconds_to_steps(self, seconds):
        return max(1, int(round(float(seconds) / self.dt)))

    def _observe_race(self, pos, vel):
        gx, gz = self.goal
        return np.array([
            pos[0] / self.arena, pos[1] / self.arena,
            vel[0] / self.vmax, vel[1] / self.vmax,
            (gx - pos[0]) / self.arena, (gz - pos[1]) / self.arena,
        ], dtype=np.float32)

    def set_curriculum_episode(self, episode):
        """Select one fixed training stage for the next Round-4 episode."""
        if self.missile_game:
            self.curriculum_episode = max(0, int(episode))

    def _curriculum_progress(self):
        if not self.missile_game:
            return 1.0
        return min(
            1.0,
            self.curriculum_episode / float(MISSILE_CURRICULUM_EPISODES),
        )

    def _chaos(self):
        """UNBOUNDED escalation: how chaotic the arena is right now. Grows with
        survival time (no ceiling) and is gated by the training curriculum, so early
        training stays gentle. Drives the missile + pickup COUNT."""
        return (self.steps / CHAOS_RAMP_STEPS) * self._curriculum_progress()

    def _sharpness(self):
        """0..1: how fast and how hard each individual missile homes (chaos capped)."""
        return min(1.0, self._chaos())

    def _difficulty(self):
        """Back-compat 0..1 pressure reading for the snapshot / value heatmap /
        standalone callers. It is the bounded part of chaos (== sharpness)."""
        return self._sharpness()

    # snapshot still reports this; keep it meaning the bounded within-episode ramp.
    def _survival_difficulty(self):
        return self._sharpness()

    @staticmethod
    def _threat_metrics(m_pos, m_vel, a_pos, a_vel):
        """Straight-line closest approach of a missile to an agent.

        Returns (time_to_closest, miss_distance, closing).  ``closing`` is False
        for a receding / relatively-stationary missile, where the time is
        meaningless and the current distance is reported instead.  This is the
        single most decision-relevant quantity for dodging, so it is handed to
        the network directly instead of left to be rediscovered from raw vectors.
        """
        rel_pos = np.asarray(m_pos, dtype=np.float32) - np.asarray(a_pos, dtype=np.float32)
        rel_vel = np.asarray(m_vel, dtype=np.float32) - np.asarray(a_vel, dtype=np.float32)
        dist = float(np.linalg.norm(rel_pos))
        speed_sq = float(np.dot(rel_vel, rel_vel))
        if speed_sq < 1e-8:
            return 999.0, dist, False
        approach = float(np.dot(rel_pos, rel_vel))
        if approach >= 0.0:                 # already moving apart
            return 999.0, dist, False
        t = -approach / speed_sq
        closest = rel_pos + rel_vel * t
        return t, float(np.linalg.norm(closest)), True

    def _threat_key(self, missile, pos, vel):
        """Sort key: genuinely closing missiles first (soonest impact), then the
        rest by raw distance.  Slot 0 of the observation is therefore ALWAYS the
        most imminent threat, which is what makes the vector learnable (the old
        layout keyed missiles by arbitrary spawn slot)."""
        t, miss, closing = self._threat_metrics(
            missile["pos"], missile["vel"], pos, vel)
        return (0, t, miss) if closing else (1, miss, 0.0)

    def _missile_observe(self, which, pos, vel):
        centre = self.arena / 2
        centre_vec = np.array([centre, centre], dtype=np.float32)
        rim_clearance = max(
            0.0, centre - AGENT_R - float(np.linalg.norm(pos - centre_vec)))
        out = [
            (float(pos[0]) - centre) / centre,
            (float(pos[1]) - centre) / centre,
            float(vel[0]) / self.vmax,
            float(vel[1]) / self.vmax,
            rim_clearance / max(centre - AGENT_R, 1e-6),
        ]
        # own power-up timers only: they explain this agent's own altered speed /
        # freeze / shield.  Rival timers, pickup positions and difficulty/step
        # telemetry were pure distractors for a dodging policy and are dropped.
        for kind in PICKUP_TYPES:
            duration_steps = self._seconds_to_steps(PICKUP_EFFECT_SECONDS[kind])
            out.append(min(1.0, self.effects[which][kind] / max(1, duration_steps)))
        # post-hit mercy window: the agent is briefly immune here (used to be folded
        # into "invincible"); exposing it lets a good policy reposition fearlessly.
        out.append(min(
            1.0,
            self.hit_flash[which] / max(1, self._seconds_to_steps(HIT_INVULN_SECONDS)),
        ))

        # the OBS_MISSILE_SLOTS nearest threats, sorted NEAREST-THREAT-FIRST, each
        # carrying its time-to-impact and predicted miss distance.  Absent slots
        # are zeroed; if there are more Bills than slots, the least-imminent are
        # dropped (they are the least urgent to react to).
        threats = sorted(self.missiles, key=lambda m: self._threat_key(m, pos, vel))
        for i in range(OBS_MISSILE_SLOTS):
            if i < len(threats):
                missile = threats[i]
                rel = missile["pos"] - pos
                t, miss, closing = self._threat_metrics(
                    missile["pos"], missile["vel"], pos, vel)
                out.extend([
                    1.0,
                    float(np.clip(rel[0] / self.arena, -2, 2)),
                    float(np.clip(rel[1] / self.arena, -2, 2)),
                    float(missile["vel"][0]) / MISSILE_MAX_SPEED,
                    float(missile["vel"][1]) / MISSILE_MAX_SPEED,
                    1.0 if missile["target"] == which else -1.0,
                    min(1.0, t / 2.0) if closing else 1.0,   # time-to-impact
                    min(1.0, miss / 3.0),                    # predicted miss dist
                ])
            else:
                out.extend([0.0] * 8)

        # the OBS_PICKUP_SLOTS nearest pickups: so the agent can seek the good ones
        # (speed / invincible) and steer clear of the bad ones (slow / freeze) as
        # they multiply.  present, relative x/z, then a 4-way type one-hot.
        type_index = {kind: idx for idx, kind in enumerate(PICKUP_TYPES)}
        near_pickups = sorted(
            self.pickups, key=lambda p: float(np.linalg.norm(p["pos"] - pos)))
        for i in range(OBS_PICKUP_SLOTS):
            if i < len(near_pickups):
                pickup = near_pickups[i]
                rel = pickup["pos"] - pos
                one_hot = [0.0] * len(PICKUP_TYPES)
                one_hot[type_index[pickup["type"]]] = 1.0
                out.extend([
                    1.0,
                    float(np.clip(rel[0] / self.arena, -1, 1)),
                    float(np.clip(rel[1] / self.arena, -1, 1)),
                    *one_hot,
                ])
            else:
                out.extend([0.0] * (3 + len(PICKUP_TYPES)))
        assert len(out) == MISSILE_OBS_DIM
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
            self.pickups = []
            self.pickup_events = []
            self.effects = {
                side: {kind: 0 for kind in PICKUP_TYPES}
                for side in ("red", "blue")
            }
            self.hearts = {"red": HEARTS, "blue": HEARTS}
            self.hit_flash = {"red": 0, "blue": 0}
            self.next_pickup_step = self._seconds_to_steps(PICKUP_FIRST_SECONDS)
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
    def _integrate(self, pos, vel, action, speed_multiplier=1.0, frozen=False):
        """Apply one thrust action: accelerate, drag, cap speed, move, clamp to the
        arena walls. Returns (new_pos, new_vel)."""
        if frozen:
            return pos.copy().astype(np.float32), np.zeros(2, dtype=np.float32)
        speed_multiplier = max(0.0, float(speed_multiplier))
        dx, dz = DIRS[action]
        vel = vel + (
            np.array([dx, dz], dtype=np.float32)
            * self.thrust * speed_multiplier * self.dt
        )
        vel = vel * self.damp
        sp = float(np.linalg.norm(vel))
        effective_vmax = self.vmax * speed_multiplier
        if sp > effective_vmax:
            vel = vel * (effective_vmax / sp)
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

    # -------------------------------------------------------- Round-4 pickups
    def _next_pickup_type(self):
        """Draw IID so the visible state fully describes the transition process."""
        return self.rng.choice(PICKUP_TYPES)

    def _pickup_position_is_valid(self, pos):
        centre = self.arena / 2
        radial_limit = centre - AGENT_R - PICKUP_R - 0.25
        if float(np.linalg.norm(pos - centre)) > radial_limit:
            return False
        # Keep the north opening readable and avoid putting a reward directly in
        # the launch lane through which every Banzai Bill initially travels.
        if pos[1] < centre - 2.35 and abs(float(pos[0]) - centre) < 1.25:
            return False
        for agent_pos in (self.red_pos, self.blue_pos):
            if float(np.linalg.norm(pos - agent_pos)) < 1.50:
                return False
        for pickup in self.pickups:
            if float(np.linalg.norm(pos - pickup["pos"])) < 1.25:
                return False
        return True

    def _spawn_pickup(self):
        centre = self.arena / 2
        usable_radius = centre - AGENT_R - PICKUP_R - 0.25
        pos = None
        # sqrt(U) gives uniform area density instead of crowding the centre.
        for _ in range(64):
            angle = self.rng.random() * math.tau
            radius = math.sqrt(self.rng.random()) * usable_radius
            candidate = np.array([
                centre + math.cos(angle) * radius,
                centre + math.sin(angle) * radius,
            ], dtype=np.float32)
            if self._pickup_position_is_valid(candidate):
                pos = candidate
                break
        if pos is None:
            return False
        occupied = {pickup["slot"] for pickup in self.pickups}
        slot = next(
            slot for slot in range(PICKUP_HARD_CAP)
            if slot not in occupied
        )
        self._pickup_serial += 1
        self.pickups.append({
            "id": self._pickup_serial,
            "slot": slot,
            "type": self._next_pickup_type(),
            "pos": pos,
            "spawnStep": self.steps,
            "expiresStep": (
                self.steps + self._seconds_to_steps(PICKUP_GROUND_LIFETIME)
            ),
        })
        return True

    def _pickup_max_active(self):
        """More pickups can litter the arena the more chaotic it gets (up to a cap)."""
        return min(PICKUP_HARD_CAP, PICKUP_MAX_ACTIVE + int(self._chaos()))

    def _advance_pickup_spawns(self):
        self.pickups = [
            pickup for pickup in self.pickups
            if pickup["expiresStep"] > self.steps
        ]
        if (self.steps < self.next_pickup_step
                or len(self.pickups) >= self._pickup_max_active()):
            return
        if self._spawn_pickup():
            # gaps between drops shrink as chaos climbs, so pickups also multiply
            factor = 1.0 / (1.0 + 0.4 * self._chaos())
            lo = max(1, int(self._seconds_to_steps(PICKUP_INTERVAL_SECONDS[0]) * factor))
            hi = max(lo, int(self._seconds_to_steps(PICKUP_INTERVAL_SECONDS[1]) * factor))
            self.next_pickup_step = self.steps + self.rng.randint(lo, hi)
        else:
            # A crowded instant retries soon rather than placing an invalid pickup.
            self.next_pickup_step = self.steps + self._seconds_to_steps(1.0)

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

    def _add_pickup_event(self, pickup, side):
        self._pickup_event_serial += 1
        self.pickup_events.append({
            "id": self._pickup_event_serial,
            "pickupId": pickup["id"],
            "type": pickup["type"],
            "side": side,
            # ``collector`` is a harmless compatibility alias for early viewers.
            "collector": side,
            "pos": pickup["pos"].copy(),
            "stepsLeft": self._seconds_to_steps(PICKUP_EVENT_HOLD_SECONDS),
            "expiresAt": time.monotonic() + PICKUP_EVENT_HOLD_SECONDS,
        })
        self.pickup_events = self.pickup_events[-16:]

    def _age_pickup_events(self, advance=True):
        now = time.monotonic()
        if advance:
            for event in self.pickup_events:
                event["stepsLeft"] = max(0, event.get("stepsLeft", 0) - 1)
            self.pickup_events = [
                event for event in self.pickup_events
                if event.get("stepsLeft", 0) > 0
                or event.get("expiresAt", 0.0) > now
            ]
        else:
            # A paused simulation has no step aging, so wall time prevents a stale
            # collection burst from living forever in the live snapshot.
            self.pickup_events = [
                event for event in self.pickup_events
                if event.get("expiresAt", 0.0) > now
            ]

    def _collect_pickups(self, reward, paths):
        """Resolve each collectible once; the first swept-circle contact wins."""
        collected_ids = set()
        fresh_effects = set()
        reach = AGENT_R + PICKUP_R
        for pickup in sorted(self.pickups, key=lambda item: item["id"]):
            candidates = []
            preferred = "red" if pickup["slot"] % 2 == 0 else "blue"
            for side, (old_pos, new_pos) in paths.items():
                contact_time = self._segment_circle_entry_time(
                    old_pos, new_pos, pickup["pos"], reach)
                if contact_time is not None:
                    # Slot parity is used only for an exact contact-time tie.
                    tie = 0 if side == preferred else 1
                    candidates.append((contact_time, tie, side))
            if not candidates:
                continue
            _, _, side = min(candidates)
            kind = pickup["type"]
            self.effects[side][kind] = self._seconds_to_steps(
                PICKUP_EFFECT_SECONDS[kind])
            fresh_effects.add((side, kind))
            if kind == "freeze":
                if side == "red":
                    self.red_vel = np.zeros(2, dtype=np.float32)
                else:
                    self.blue_vel = np.zeros(2, dtype=np.float32)
            # No direct pickup reward: a good pickup helps only via better survival
            # (a bad one hurts only via getting hit).  Paying for the touch itself
            # was noise that competed with the dodging signal.
            self._add_pickup_event(pickup, side)
            collected_ids.add(pickup["id"])
        if collected_ids:
            self.pickups = [
                pickup for pickup in self.pickups
                if pickup["id"] not in collected_ids
            ]
        return fresh_effects

    def _movement_effect(self, side):
        multiplier = 1.0
        if self.effects[side]["speed"] > 0:
            multiplier *= SPEED_MULTIPLIER
        if self.effects[side]["slow"] > 0:
            multiplier *= SLOW_MULTIPLIER
        return multiplier, self.effects[side]["freeze"] > 0

    def _grant_hit_invuln(self, side, invuln_steps):
        """After a non-fatal hit, leave the character exactly where it was struck
        (no teleport) and give it a brief mercy invulnerability so an in-flight Bill
        cannot instantly re-hit it. Tracked apart from the pickup shield so the
        frontend blinks the character here (rather than drawing the shield bubble)."""
        self.hit_flash[side] = max(self.hit_flash[side], invuln_steps)

    def _immune(self, side):
        """A character cannot be hit while shielded by the pickup OR during the
        brief post-hit mercy window."""
        return self.effects[side]["invincible"] > 0 or self.hit_flash[side] > 0

    def _tick_effects(self, fresh_effects=()):
        fresh_effects = set(fresh_effects)
        for side in ("red", "blue"):
            for kind in PICKUP_TYPES:
                if (side, kind) not in fresh_effects:
                    self.effects[side][kind] = max(
                        0, self.effects[side][kind] - 1)

    # ------------------------------------------------------- Round-4 missiles
    def _missile_interval(self):
        # Gap between launches: ~1.2 s early, tightening to ~0.4 s as it sharpens, so
        # even the single early Bill keeps coming and there is no dead air.
        return max(4, int(round(12 - 8 * self._sharpness())))

    def _missile_limit(self):
        # Fixed step schedule, hard-capped at 3: 1 Bill to start, 2 from 100 steps,
        # 3 from 200 steps on (never more than 3 at once).
        if self.steps < 100:
            return 1
        if self.steps < 200:
            return 2
        return 3

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
        slot = next(slot for slot in range(MISSILE_HARD_CAP) if slot not in occupied)
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

    def _add_explosion(self, pos, hit=None, missile_id=None, blocked=None,
                       redirected=None):
        self._explosion_serial += 1
        event = {
            "id": self._explosion_serial,
            "missileId": missile_id,
            "pos": np.asarray(pos, dtype=np.float32).copy(),
            "hit": hit,
            "blocked": blocked,
            "redirected": redirected,
            # fatal = this blast took a character's LAST heart (round over). Set
            # afterwards, once hearts are resolved; a non-fatal hit stays False so
            # the frontend blinks the victim instead of playing the death pose.
            "fatal": False,
            "step": self.steps,
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

    @staticmethod
    def _dodge_potential(missile_pos, missile_vel, agent_pos, agent_vel):
        """0..1 projected safety for a genuinely closing near-term threat.

        A value of 1 means the current straight-line closest approach is safely
        outside the collision corridor (or the missile is receding / too far into
        the future). Lower values mean a more direct projected collision.
        """
        rel_pos = np.asarray(missile_pos, dtype=np.float32) - np.asarray(
            agent_pos, dtype=np.float32)
        rel_vel = np.asarray(missile_vel, dtype=np.float32) - np.asarray(
            agent_vel, dtype=np.float32)
        speed_sq = float(np.dot(rel_vel, rel_vel))
        if speed_sq < 1e-8:
            return 1.0
        approach = float(np.dot(rel_pos, rel_vel))
        if approach >= 0.0:
            return 1.0
        closest_t = -approach / speed_sq
        if closest_t <= 0.0 or closest_t > DODGE_THREAT_HORIZON:
            return 1.0
        closest = rel_pos + rel_vel * closest_t
        miss_distance = float(np.linalg.norm(closest))
        danger_radius = MISSILE_R + AGENT_R + DODGE_THREAT_MARGIN
        return min(1.0, max(0.0, miss_distance / danger_radius))

    def _dodge_shaping(self, old_paths, new_paths):
        """Signed, bounded action credit for improving projected miss distance."""
        shaping = {"red": 0.0, "blue": 0.0}
        for side in ("red", "blue"):
            # An immune character (shield or post-hit mercy window) is not under a
            # lethal threat, so it cannot collect avoidance credit just by moving.
            if self._immune(side):
                continue
            old_pos, old_vel = old_paths[side]
            new_pos, new_vel = new_paths[side]
            potential_delta = 0.0
            for missile in self.missiles:
                # Only credit dodging the missiles actually aimed at THIS agent;
                # reacting to a Bill hunting the rival was noise.
                if missile["target"] != side:
                    continue
                before = self._dodge_potential(
                    missile["pos"], missile["vel"], old_pos, old_vel)
                after = self._dodge_potential(
                    missile["pos"], missile["vel"], new_pos, new_vel)
                potential_delta += after - before
            shaping[side] = max(
                -DODGE_SHAPING_CAP,
                min(DODGE_SHAPING_CAP, potential_delta * DODGE_SHAPING_CAP),
            )
        return shaping

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
            # Refill the arena FAST toward the current limit (a quick top-up every few
            # steps) so there is never dead air; only pause a full interval once the
            # limit is met. This kills the "long time with no missile" gaps.
            if len(self.missiles) < self._missile_limit():
                self.next_missile_step = self.steps + 3
            else:
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
            # Straight at the start, widening to a gentle 0.5 rad/s home. Its turn
            # radius stays larger than the arena, so a well-timed juke always makes
            # a single Bill overshoot - surviving many at once is the real skill.
            turn_rate = 0.5 * difficulty
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
                    contact_sides = {
                        side for t, _, kind, side in candidates
                        if kind == "hit" and abs(t - first_time) <= 1e-5
                    }
                    blocked_sides = {
                        side for side in contact_sides
                        if self._immune(side)
                    }
                    sides = contact_sides - blocked_sides
                    first_kind = "hit" if sides else "shield"
                else:
                    sides = set()
                    blocked_sides = set()
                event = {
                    "time": first_time,
                    "kind": first_kind,
                    "sides": sides,
                    "blockedSides": blocked_sides,
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

        redirects = {"red": 0, "blue": 0}
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
                elif event["kind"] == "shield":
                    # A truthy non-character hit asks the theme for the full contact
                    # explosion without triggering live.js's victim animation.
                    hit_label = "shield"
                blocked_label = None
                if event["blockedSides"]:
                    blocked_label = (
                        next(iter(event["blockedSides"]))
                        if len(event["blockedSides"]) == 1 else "both"
                    )
                redirected_side = None
                if (event["kind"] == "hit"
                        and terminal_time is not None
                        and abs(event["time"] - terminal_time) <= 1e-5):
                    target = missile["target"]
                    other = "blue" if target == "red" else "red"
                    # Reward a genuine bait only when this target's missile kills
                    # the rival and the baiting target survives the entire terminal
                    # instant. This excludes shields, self-hits, multi-hit draws and
                    # a simultaneous second Bill that kills the would-be recipient.
                    if (target not in hits
                            and target not in event["blockedSides"]
                            and other in event["sides"]):
                        redirected_side = target
                        redirects[target] += 1
                        reward[target] += REDIRECT_BONUS
                self._add_explosion(
                    event["pos"], hit_label, missile["id"], blocked_label,
                    redirected_side)
                # A missile aimed at someone that expires on the rim or fuses out
                # without a kill means that target genuinely DODGED it: pay the
                # evade bonus (unless they were hit by something else this step).
                if event["kind"] in ("wall", "fuse"):
                    tgt = missile["target"]
                    if tgt not in hits:
                        reward[tgt] += EVADE_REWARD
                continue
            missile["pos"] = plan["old"] + (
                plan["new"] - plan["old"]) * cutoff
            survivors.append(missile)

        if terminal_time is not None:
            self.red_pos = old_red + (new_red - old_red) * terminal_time
            self.blue_pos = old_blue + (new_blue - old_blue) * terminal_time
        self.missiles = survivors
        return hits, redirects

    def _step_missile_game(self, a_red, a_blue):
        self._age_explosions()
        self._age_pickup_events()
        self._advance_pickup_spawns()
        # age the post-hit mercy window from prior steps (a fresh hit below re-arms it)
        for side in ("red", "blue"):
            self.hit_flash[side] = max(0, self.hit_flash[side] - 1)
        reward = {"red": SURVIVAL_REWARD, "blue": SURVIVAL_REWARD}
        old_red = self.red_pos.copy()
        old_blue = self.blue_pos.copy()
        old_red_vel = self.red_vel.copy()
        old_blue_vel = self.blue_vel.copy()
        red_speed, red_frozen = self._movement_effect("red")
        blue_speed, blue_frozen = self._movement_effect("blue")
        self.red_pos, self.red_vel = self._integrate(
            self.red_pos, self.red_vel, a_red, red_speed, red_frozen)
        self.blue_pos, self.blue_vel = self._integrate(
            self.blue_pos, self.blue_vel, a_blue, blue_speed, blue_frozen)
        dodge_shaping = self._dodge_shaping(
            {
                "red": (old_red, old_red_vel),
                "blue": (old_blue, old_blue_vel),
            },
            {
                "red": (self.red_pos, self.red_vel),
                "blue": (self.blue_pos, self.blue_vel),
            },
        )
        hits, redirects = self._advance_missiles(reward, old_red, old_blue)
        for side in ("red", "blue"):
            # A lethal transition is already explained by HIT_PENALTY. Do not let
            # an optimistic pre-impact projection soften that terminal signal.
            if side in hits:
                dodge_shaping[side] = 0.0
            reward[side] += dodge_shaping[side]
        fresh_effects = set()
        if not hits:
            # Missiles use only effects that were active at tick start. A collectible
            # reached during this movement becomes active on the following decision,
            # so a late shield can never retroactively cancel an earlier impact.
            fresh_effects = self._collect_pickups(reward, {
                "red": (old_red, self.red_pos),
                "blue": (old_blue, self.blue_pos),
            })
        self._tick_effects(fresh_effects)

        if hits:
            # Every hit costs the struck character a heart and hurts a lot. The
            # round only ENDS when someone runs out of hearts; otherwise the
            # victim respawns (briefly shielded) and the episode keeps going.
            for side in hits:
                reward[side] += HIT_PENALTY
                self.hearts[side] = max(0, self.hearts[side] - 1)
            out = {side for side in hits if self.hearts[side] <= 0}
            if out:
                self.done = True
                if out == {"red"}:
                    self.winner = "blue"
                    reward["blue"] += HIT_REWARD
                elif out == {"blue"}:
                    self.winner = "red"
                    reward["red"] += HIT_REWARD
                else:                       # both emptied on the same instant
                    self.winner = None
                # tag THIS step's fatal blast(s) so the frontend plays the death /
                # win choreography only for a real death (non-fatal hits just blink).
                for event in reversed(self.explosions):
                    if event.get("step") != self.steps:
                        break               # older step (appended in order) -> stop
                    if event.get("hit") in ("red", "blue", "both"):
                        event["fatal"] = True
            else:
                invuln = self._seconds_to_steps(HIT_INVULN_SECONDS)
                for side in hits:
                    self._grant_hit_invuln(side, invuln)

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
            "redirects": dict(redirects),
            "redirectBonus": {
                side: round(redirects[side] * REDIRECT_BONUS, 3)
                for side in ("red", "blue")
            },
            "dodgeShaping": {
                side: round(dodge_shaping[side], 5)
                for side in ("red", "blue")
            },
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
                "maxConcurrent": MISSILE_HARD_CAP,
                "maxHearts": HEARTS,
                "curriculumEpisodes": MISSILE_CURRICULUM_EPISODES,
                "dodgeShapingCap": DODGE_SHAPING_CAP,
            }
            out["pickupConfig"] = {
                "types": list(PICKUP_TYPES),
                "radius": PICKUP_R,
                "maxActive": PICKUP_HARD_CAP,
                "firstSpawn": PICKUP_FIRST_SECONDS,
                "spawnInterval": list(PICKUP_INTERVAL_SECONDS),
                "groundLifetime": PICKUP_GROUND_LIFETIME,
                "durations": dict(PICKUP_EFFECT_SECONDS),
                "speedMultiplier": SPEED_MULTIPLIER,
                "slowMultiplier": SLOW_MULTIPLIER,
            }
        return out

    # --------------------------------------------------------------- viewer
    def snapshot(self):
        # Also expires live-only carryover while paused or after a target-episode
        # stop, where no further environment step would otherwise age events.
        if self.missile_game:
            self._age_explosions()
            self._age_pickup_events(advance=False)
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
                "hearts": dict(self.hearts),
                "maxHearts": HEARTS,
                "survivalTime": round(self.steps * self.dt, 2),
                "difficulty": round(self._difficulty(), 3),
                # the escalation level (unbounded): drives how many Bills / pickups
                "chaos": round(self._chaos(), 3),
                "missileLimit": self._missile_limit(),
                "pickupLimit": self._pickup_max_active(),
                "survivalDifficulty": round(
                    self._survival_difficulty(), 3),
                "curriculumEpisode": int(self.curriculum_episode),
                "curriculumProgress": round(
                    self._curriculum_progress(), 3),
                "nextMissileIn": max(0, self.next_missile_step - self.steps),
                "nextPickupIn": round(
                    max(0, self.next_pickup_step - self.steps) * self.dt, 2),
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
                        "fatal": bool(event.get("fatal", False)),
                        "blocked": event.get("blocked"),
                        "redirected": event.get("redirected"),
                        "carryover": bool(event.get("carryover", False)),
                        "survivalTime": event.get("survivalTime"),
                        "difficulty": event.get("difficulty"),
                    }
                    for event in self.explosions
                ],
                "pickups": [
                    {
                        "id": pickup["id"],
                        "slot": pickup["slot"],
                        "type": pickup["type"],
                        "pos": rd(pickup["pos"]),
                        "radius": PICKUP_R,
                        "remaining": round(
                            max(0, pickup["expiresStep"] - self.steps) * self.dt,
                            2,
                        ),
                    }
                    for pickup in sorted(
                        self.pickups, key=lambda item: item["id"])
                ],
                "effects": {
                    side: {
                        "speed": round(
                            self.effects[side]["speed"] * self.dt, 2),
                        "invincible": round(
                            self.effects[side]["invincible"] * self.dt, 2),
                        "slow": round(
                            self.effects[side]["slow"] * self.dt, 2),
                        "frozen": round(
                            self.effects[side]["freeze"] * self.dt, 2),
                        # post-hit blink window (seconds); the pickup shield uses
                        # "invincible" above, so the frontend can tell them apart.
                        "hitFlash": round(self.hit_flash[side] * self.dt, 2),
                        "speedMultiplier": round(
                            self._movement_effect(side)[0], 3),
                    }
                    for side in ("red", "blue")
                },
                "pickupEvents": [
                    {
                        "id": event["id"],
                        "pickupId": event["pickupId"],
                        "type": event["type"],
                        "side": event["side"],
                        "collector": event["collector"],
                        "pos": rd(event["pos"]),
                    }
                    for event in self.pickup_events
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
