"""Round 5's weapon subsystems: crates, Mario-Kart weapons, and Bowser's airship.

Split out of ``arena.py`` purely by size and concern; ``CtfArena`` mixes this
class in, so every method here runs on the arena instance (self.red_pos,
self.stun, self._add_ctf_event, ... all come from the arena / engine).

The loop: breakable CRATES spawn around the board; smashing one drops a random
WEAPON into a 1-slot inventory, fired later with the USE action:

    chain        a thrown Chain Chomp head - flies out, and on contact reels
                 the rival in point-blank and stuns it (dodgeable in flight)
    red_shell    a homing projectile; stuns on hit
    green_shell  a straight projectile that bounces off walls; stuns on hit
                 (and can boomerang into its owner after a grace period)
    banana       a trap laid behind you; stuns whoever drives over it
    oil          a trap that throws the rival backwards and briefly dazes it

Overhead, BOWSER'S AIRSHIP cruises the top edge and periodically hurls
objects at RANDOM board spots (never aimed at an agent); the blast stuns
anyone close, so both agents must dodge. All object speeds are in units/second
(dt-independent).
"""

import math

import numpy as np

from core.continuous_arena import AGENT_R

# ---- breakable crates (the weapon delivery) --------------------------------
CRATE_R = 0.55                          # crate half-extent; smashed on contact
CRATE_MAX_ACTIVE = 3
CRATE_FIRST_SECONDS = 2.0
CRATE_INTERVAL_SECONDS = (3.0, 5.0)     # gap between crate spawns
WEAPONS = ("chain", "red_shell", "green_shell", "banana", "oil")

# ---- weapon durations / geometry -------------------------------------------
STUN_SECONDS_WEAPON = 1.1               # stun from a shell / banana / chain hit
CHAIN_STUN_SECONDS = 1.1
CHAIN_PULL_DIST = 1.3                   # rival is reeled to this range from you
CHAIN_PULL_SECONDS = 0.5               # reel-in takes this long (a visible drag, not a teleport)
CHAIN_PULL_EASE = 0.4                  # fraction of the remaining gap closed each step
CHAIN_PULL_MIN_STEP = 0.16            # ... but at least this much, so it always arrives
CHAIN_SPEED = 9.0                      # the thrown chomp head FLIES OUT at this speed (units/s)
CHAIN_HEAD_R = 0.45                    # contact radius of the flying chomp head
CHAIN_MAX_REACH = 16.0                 # if it travels this far without connecting, it fizzles
SHELL_SPEED = 8.0                       # projectile speed (faster than the agents)
SHELL_R = 0.35                          # projectile radius
SHELL_LIFETIME = 3.0                    # seconds before a missed shell fizzles
SHELL_TURN_RATE = 4.0                   # red-shell homing turn (rad/s)
TRAP_R = 0.7                            # a laid banana/oil triggers within this of a rival
TRAP_LIFETIME = 12.0                    # seconds a laid trap persists
TRAP_PLACE_BACK = 0.9                   # dropped this far BEHIND the placer
OIL_KNOCKBACK = 2.5                     # oil throws the rival back this far (units)

# ---- weapon rewards ---------------------------------------------------------
CRATE_REWARD = 0.10         # smashing a crate (picking up a weapon)
CHAIN_HIT_REWARD = 0.08     # landing a chain-pull on the rival
SHELL_HIT_REWARD = 0.30     # a shell hitting the rival
TRAP_HIT_REWARD = 0.25      # the rival running into your banana / oil
STUNNED_PENALTY = -0.05     # a small ding for getting stunned by any weapon

# --- Bowser's Airship: a neutral hazard-thrower cruising the north edge --------
# It slides side to side, pausing to HURL objects at RANDOM board spots (never
# aimed at an agent). An object that flies into an agent stuns it - so agents must
# DODGE, which is why they sense nearby objects up to `agent_sight` metres away.
BOWSER_THROW_COUNT = 1                  # objects hurled per throw (tunable 0..4)
BOWSER_OBJ_SPEED = 10.0                 # object travel speed, units/s (tunable)
BOWSER_OBJ_R = 0.45                     # object radius (contact + draw)
BOWSER_BLAST_R = 1.7                    # explosion radius: an agent within this is stunned
BOWSER_THROW_INTERVAL = 2.5           # seconds between throws (default; tunable)
BOWSER_FIRST_THROW = 2.0               # first throw after this many seconds
BOWSER_OBJ_STUN_SECONDS = 1.0          # stun when an object hits an agent
BOWSER_OBJ_LIFETIME = 4.0              # seconds before a thrown object despawns
BOWSER_SHIP_SPEED = 0.7                # ship side-to-side angular speed (rad/s)
BOWSER_SHIP_AMPLITUDE = 2.5            # ship drifts only a LITTLE, +/- this from centre
AGENT_SIGHT = 6.0                      # how far an agent SENSES thrown objects (units)


class CtfWeaponsMixin:
    """Crate / weapon / airship behaviour, mixed into ``CtfArena``."""

    # Bowser dials, live-tunable from the panel (class defaults; see the arena's
    # ``set_ctf_dynamics``)
    bowser_throw_count = BOWSER_THROW_COUNT
    bowser_obj_speed = BOWSER_OBJ_SPEED
    bowser_interval = BOWSER_THROW_INTERVAL
    agent_sight = AGENT_SIGHT

    # ---- breakable crates -------------------------------------------------
    def _crate_pos_valid(self, pos):
        A = self.arena
        if pos[0] < 2.0 or pos[0] > A - 2.0 or pos[1] < 2.0 or pos[1] > A - 2.0:
            return False
        if float(np.linalg.norm(pos - np.array([A / 2, A / 2],
                                               dtype=np.float32))) < 1.8:
            return False                                  # keep the pole clear
        for base in (self.red_base, self.blue_base):
            if float(np.linalg.norm(pos - base)) < 3.0:
                return False                              # keep the home bases clear
        for ap in (self.red_pos, self.blue_pos):
            if float(np.linalg.norm(pos - ap)) < 1.5:
                return False
        for c in self.crates:
            if float(np.linalg.norm(pos - c["pos"])) < 2.2:
                return False
        return True

    def _spawn_crate(self):
        A = self.arena
        for _ in range(40):
            pos = np.array([self.rng.uniform(2.0, A - 2.0),
                            self.rng.uniform(2.0, A - 2.0)], dtype=np.float32)
            if self._crate_pos_valid(pos):
                self._crate_serial += 1
                self.crates.append({"id": self._crate_serial, "pos": pos})
                return True
        return False

    def _advance_crate_spawns(self):
        if len(self.crates) >= CRATE_MAX_ACTIVE or self.steps < self.next_crate_step:
            return
        if self._spawn_crate():
            lo = self._seconds_to_steps(CRATE_INTERVAL_SECONDS[0])
            hi = self._seconds_to_steps(CRATE_INTERVAL_SECONDS[1])
            self.next_crate_step = self.steps + self.rng.randint(lo, hi)
        else:
            self.next_crate_step = self.steps + self._seconds_to_steps(1.0)

    def _resolve_crates(self, reward):
        """Each crate an agent reaches this step is SMASHED and ALWAYS drops a random
        WEAPON into the breaker's single inventory slot (replacing any weapon already
        held). A stunned agent cannot break one; both in reach -> the nearer one wins."""
        if not self.crates:
            return
        reach = CRATE_R + AGENT_R
        smashed = set()
        for crate in sorted(self.crates, key=lambda c: c["id"]):
            contenders = []
            for side, p in (("red", self.red_pos), ("blue", self.blue_pos)):
                if self.stun[side] > 0:
                    continue
                d = float(np.linalg.norm(p - crate["pos"]))
                if d <= reach:
                    contenders.append((d, side))
            if not contenders:
                continue
            contenders.sort()
            breaker = contenders[0][1]
            weapon = self.rng.choice(WEAPONS)
            self.weapon[breaker] = weapon
            reward[breaker] += CRATE_REWARD
            self._add_ctf_event("crate", breaker, crate["pos"], {"weapon": weapon})
            smashed.add(crate["id"])
        if smashed:
            self.crates = [c for c in self.crates if c["id"] not in smashed]

    # ---- firing -----------------------------------------------------------
    def _use_weapon(self, side, reward):
        """Fire the held weapon (triggered by USE_ACTION). Chain THROWS a chomp head that
        flies out to the rival (dodgeable) and only reels + stuns on contact; shells
        become in-flight projectiles; banana/oil become laid traps. No-op with a small
        time-waste cost if the slot is empty."""
        w = self.weapon[side]
        if w is None:
            return
        self.weapon[side] = None                        # consume the one-slot inventory
        opp = "blue" if side == "red" else "red"
        me = self.red_pos if side == "red" else self.blue_pos
        other = self.red_pos if opp == "red" else self.blue_pos
        if w == "chain":
            # Chain Chomp: THROW the chomp head out from you toward the rival. It travels
            # (phase "out", dodgeable); only when it REACHES the rival does the reel-in +
            # stun begin (phase "reel"). All handled in _advance_chains, no teleport.
            self._chain_serial += 1
            self.chains.append({
                "id": self._chain_serial, "owner": side, "target": opp,
                "head": me.copy(), "origin": me.copy(),
                "phase": "out", "reel_left": 0,
            })
            self._add_ctf_event("chain", side, me, {"target": opp})
        elif w in ("red_shell", "green_shell"):
            if w == "red_shell":                        # homing: launch toward the rival
                d = other - me
                dist = float(np.linalg.norm(d))
                direction = (d / dist if dist > 1e-6
                             else np.array([1.0, 0.0], dtype=np.float32))
            else:                                       # straight: launch along heading
                direction = np.array([math.cos(self.facing[side]),
                                      math.sin(self.facing[side])], dtype=np.float32)
            spawn = (me + direction * (AGENT_R + SHELL_R + 0.1)).astype(np.float32)
            self._shell_serial += 1
            self.shells.append({
                "id": self._shell_serial, "owner": side,
                "kind": "red" if w == "red_shell" else "green",
                "pos": spawn, "vel": (direction * SHELL_SPEED).astype(np.float32),
                "age": 0,
            })
            self._add_ctf_event("fire", side, spawn, {"weapon": w})
        elif w in ("banana", "oil"):
            # laid on the ground a bit BEHIND the placer; triggers on the rival's touch
            back = np.array([math.cos(self.facing[side]), math.sin(self.facing[side])],
                            dtype=np.float32)
            place = np.clip(me - back * TRAP_PLACE_BACK,
                            AGENT_R, self.arena - AGENT_R).astype(np.float32)
            self._trap_serial += 1
            self.traps.append({"id": self._trap_serial, "owner": side, "kind": w,
                               "pos": place, "age": 0})
            self._add_ctf_event("drop", side, place, {"weapon": w})

    # ---- in-flight weapons ------------------------------------------------
    def _advance_chains(self, reward):
        """Two-phase Chain Chomp. Phase "out": the thrown head flies toward the (live)
        rival at CHAIN_SPEED - dodgeable, no effect yet; if it travels past CHAIN_MAX_REACH
        it fizzles. On CONTACT it flips to phase "reel": the rival is stunned and the head
        latches to it while it is dragged toward the owner (ease-in) - a visible slide, not
        a teleport. The chain is removed once the rival is reeled in or the reel times out."""
        if not self.chains:
            return
        survivors = []
        for ch in self.chains:
            owner, target = ch["owner"], ch["target"]
            opos = self.red_pos if owner == "red" else self.blue_pos
            tpos = self.red_pos if target == "red" else self.blue_pos
            if ch["phase"] == "out":
                d = tpos - ch["head"]
                dist = float(np.linalg.norm(d))
                if dist <= CHAIN_HEAD_R + AGENT_R:          # CONTACT -> start the reel + stun
                    ch["phase"] = "reel"
                    ch["reel_left"] = max(1, self._seconds_to_steps(CHAIN_PULL_SECONDS))
                    self.stun[target] = max(self.stun[target],
                                            self._seconds_to_steps(CHAIN_STUN_SECONDS))
                    reward[owner] += CHAIN_HIT_REWARD
                    reward[target] += STUNNED_PENALTY
                    self._add_ctf_event("chainhit", owner, ch["head"], {"target": target})
                    survivors.append(ch)
                    continue
                step = CHAIN_SPEED * self.dt
                ch["head"] = (ch["head"] + (d / dist if dist > 1e-6
                              else np.zeros(2, dtype=np.float32)) * step).astype(np.float32)
                if float(np.linalg.norm(ch["head"] - ch["origin"])) > CHAIN_MAX_REACH:
                    continue                                # never connected -> fizzle
                survivors.append(ch)
            else:                                           # phase "reel"
                ch["reel_left"] -= 1
                d = opos - tpos
                dist = float(np.linalg.norm(d))
                ch["head"] = tpos.copy()                    # head stays latched on the rival
                if dist <= CHAIN_PULL_DIST or ch["reel_left"] <= 0:
                    continue                                # done -> drop the chain
                step = min(dist - CHAIN_PULL_DIST,
                           max((dist - CHAIN_PULL_DIST) * CHAIN_PULL_EASE,
                               CHAIN_PULL_MIN_STEP))
                newpos = np.clip(tpos + (d / dist) * step,
                                 AGENT_R, self.arena - AGENT_R).astype(np.float32)
                if target == "red":
                    self.red_pos, self.red_vel = newpos, np.zeros(2, dtype=np.float32)
                else:
                    self.blue_pos, self.blue_vel = newpos, np.zeros(2, dtype=np.float32)
                ch["head"] = newpos.copy()
                survivors.append(ch)
        self.chains = survivors

    def _advance_shells(self, reward):
        """Move each in-flight shell (red homes with a capped turn rate; green flies
        straight and bounces off the walls), stun the rival on contact, and fizzle after
        SHELL_LIFETIME. A green shell can also boomerang into its owner after a grace."""
        if not self.shells:
            return
        A = self.arena
        survivors = []
        for sh in self.shells:
            sh["age"] += 1
            owner = sh["owner"]
            target = "blue" if owner == "red" else "red"
            tpos = self.blue_pos if target == "blue" else self.red_pos
            if sh["kind"] == "red":                     # steer toward the target
                desired = tpos - sh["pos"]
                da = math.atan2(float(desired[1]), float(desired[0]))
                ca = math.atan2(float(sh["vel"][1]), float(sh["vel"][0]))
                delta = math.atan2(math.sin(da - ca), math.cos(da - ca))
                lim = SHELL_TURN_RATE * self.dt
                ang = ca + max(-lim, min(lim, delta))
                sh["vel"] = np.array([math.cos(ang) * SHELL_SPEED,
                                      math.sin(ang) * SHELL_SPEED], dtype=np.float32)
            newpos = sh["pos"] + sh["vel"] * self.dt
            if sh["kind"] == "green":                   # bounce off the square walls
                for i in (0, 1):
                    if newpos[i] < SHELL_R:
                        newpos[i] = SHELL_R
                        sh["vel"][i] *= -1
                    elif newpos[i] > A - SHELL_R:
                        newpos[i] = A - SHELL_R
                        sh["vel"][i] *= -1
            else:
                newpos = np.clip(newpos, SHELL_R, A - SHELL_R)
            sh["pos"] = newpos.astype(np.float32)
            grace = sh["age"] * self.dt < 0.25
            hit_side = None
            for cs, cp in (("red", self.red_pos), ("blue", self.blue_pos)):
                if cs == owner and (sh["kind"] == "red" or grace):
                    continue                            # red never hits owner; green has grace
                if float(np.linalg.norm(sh["pos"] - cp)) <= SHELL_R + AGENT_R:
                    hit_side = cs
                    break
            if hit_side is not None:
                self.stun[hit_side] = max(self.stun[hit_side],
                                          self._seconds_to_steps(STUN_SECONDS_WEAPON))
                if hit_side != owner:
                    reward[owner] += SHELL_HIT_REWARD
                reward[hit_side] += STUNNED_PENALTY
                self._add_ctf_event("shellhit", owner, sh["pos"],
                                    {"target": hit_side, "kind": sh["kind"]})
                continue                                # shell consumed on impact
            if sh["age"] * self.dt <= SHELL_LIFETIME:
                survivors.append(sh)
        self.shells = survivors

    def _advance_traps(self, reward):
        """A laid banana/oil triggers when the RIVAL drives over it: banana stuns it in
        place; oil throws it backwards + briefly dazes it. Traps fizzle after
        TRAP_LIFETIME; a trap is consumed when it triggers."""
        if not self.traps:
            return
        survivors = []
        for tr in self.traps:
            tr["age"] += 1
            owner = tr["owner"]
            target = "blue" if owner == "red" else "red"
            tpos = self.blue_pos if target == "blue" else self.red_pos
            tvel = self.blue_vel if target == "blue" else self.red_vel
            if float(np.linalg.norm(tpos - tr["pos"])) <= TRAP_R + AGENT_R:
                if tr["kind"] == "banana":
                    self.stun[target] = max(self.stun[target],
                                            self._seconds_to_steps(STUN_SECONDS_WEAPON))
                else:                                   # oil: throw the rival backwards
                    sp = float(np.linalg.norm(tvel))
                    if sp > 0.3:
                        back = -tvel / sp
                    else:
                        d = tpos - tr["pos"]
                        dn = float(np.linalg.norm(d))
                        back = (d / dn if dn > 1e-6
                                else np.array([1.0, 0.0], dtype=np.float32))
                    newpos = np.clip(tpos + back * OIL_KNOCKBACK,
                                     AGENT_R, self.arena - AGENT_R).astype(np.float32)
                    if target == "red":
                        self.red_pos, self.red_vel = newpos, np.zeros(2, dtype=np.float32)
                    else:
                        self.blue_pos, self.blue_vel = newpos, np.zeros(2, dtype=np.float32)
                    self.stun[target] = max(self.stun[target],
                                            self._seconds_to_steps(0.4))
                reward[owner] += TRAP_HIT_REWARD
                reward[target] += STUNNED_PENALTY
                self._add_ctf_event("traphit", owner, tr["pos"],
                                    {"kind": tr["kind"], "target": target})
                continue                                # trap consumed on trigger
            if tr["age"] * self.dt <= TRAP_LIFETIME:
                survivors.append(tr)
        self.traps = survivors

    # ---- Bowser's airship --------------------------------------------------
    def _advance_bowser(self, reward):
        """Bowser's airship cruises the top edge and, every `bowser_interval`,
        HURLS `bowser_throw_count` objects at RANDOM board spots (NOT aimed at an agent).
        A thrown object flies straight at `bowser_obj_speed`; whichever agent it flies
        into is stunned (agents must DODGE), then it despawns. Objects also expire off
        the board or after BOWSER_OBJ_LIFETIME. Set bowser_throw_count = 0 to disable."""
        A = self.arena
        ship_z = 0.4                                        # the board-facing cannon line
        # drift the ship a LITTLE side to side; ship_x is the throw origin + drives
        # the frontend ship (and Bowser rides along with it)
        self.ship_phase += BOWSER_SHIP_SPEED * self.dt
        self.ship_x = A / 2 + BOWSER_SHIP_AMPLITUDE * math.sin(self.ship_phase)
        if self.bowser_throw_count > 0 and self.steps >= self.next_throw_step:
            for _ in range(int(self.bowser_throw_count)):
                tx = self.rng.uniform(2.0, A - 2.0)         # a RANDOM board target
                tz = self.rng.uniform(2.0, A - 2.0)
                d = np.array([tx - self.ship_x, tz - ship_z], dtype=np.float32)
                dist = float(np.linalg.norm(d))
                vel = (d / dist * self.bowser_obj_speed if dist > 1e-6
                       else np.array([0.0, self.bowser_obj_speed], dtype=np.float32))
                self._hazard_serial += 1
                self.hazards.append({
                    "id": self._hazard_serial,
                    "pos": np.array([self.ship_x, ship_z], dtype=np.float32),
                    "vel": vel.astype(np.float32),
                    "target": np.array([tx, tz], dtype=np.float32),  # where it lands
                    "age": 0,
                    "kind": self._hazard_serial % 3,        # a few different object looks
                })
            self._add_ctf_event("throw", "red",
                                np.array([self.ship_x, ship_z], dtype=np.float32))
            self.next_throw_step = self.steps + self._seconds_to_steps(
                self.bowser_interval)
        if not self.hazards:
            return
        survivors = []
        for hz in self.hazards:
            hz["age"] += 1
            hz["pos"] = (hz["pos"] + hz["vel"] * self.dt).astype(np.float32)
            p = hz["pos"]
            # IMPACT only when it REACHES its (uniformly random) target spot, leaves
            # the board, or times out -> it EXPLODES there. It does NOT detonate on an
            # agent it merely flies OVER in transit: every bomb funnels out of the
            # north-edge ship, so punishing fly-overs would unfairly pepper the
            # north/blue corner. The blast at the landing point is the only threat, and
            # landing points are uniform across the whole arena -> fair to both sides.
            reached = float(np.dot(hz["target"] - p, hz["vel"])) <= 0.0
            off = (p[0] < -3 or p[0] > A + 3 or p[1] < -3 or p[1] > A + 3)
            timeout = hz["age"] * self.dt > BOWSER_OBJ_LIFETIME
            if reached or off or timeout:
                # the blast STUNS any agent within BOWSER_BLAST_R of the impact point
                for cs, cp in (("red", self.red_pos), ("blue", self.blue_pos)):
                    if float(np.linalg.norm(p - cp)) <= BOWSER_BLAST_R + AGENT_R:
                        self.stun[cs] = max(self.stun[cs],
                                            self._seconds_to_steps(BOWSER_OBJ_STUN_SECONDS))
                        reward[cs] += STUNNED_PENALTY
                self._add_ctf_event("bombhit", "red", p)    # -> the explosion FX
                continue                                    # bomb consumed on impact
            survivors.append(hz)
        self.hazards = survivors
