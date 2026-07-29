"""Round 2's environment mechanics: the collect-3-tomatoes city course.

On top of the shared grid engine, New Donk City adds the hazards + progression
that make it a long-horizon Monte-Carlo problem:

  * PIRANHA PLANTS: a plant's eight surrounding cells are LETHAL - entering
    one eliminates that racer for the rest of the episode (its trajectory ends
    there; the rival plays on - the engine's independent-racer machinery);
  * PUDDLES (shared ``slip`` cells): a move skids sideways with
    ``r2_slip_prob`` - the risk that prices the short routes;
  * WARP PIPES: deterministic transfers between the course's three parts, each
    LOCKED until that part's tomato is held (the progression gate);
  * TOMATOES ("stars"): 3 per agent (mirror pairs), collected on entry; the
    final goal stays locked until an agent holds all 3.

The state is ``(cell, tomato_mask)`` - the mask keeps the progression Markov,
which is exactly what lets plain tabular MC learn a multi-room tour.
"""

from core.grid_env import GridWorld, MOVE_ACTIONS, PERP
from gymnasium import spaces

from . import world

# --- Round-2 game mechanics (defaults; live-tunable from the panel) ----------
R2_SLIP_PROB = 0.12    # risky-shortcut skid chance (0.06 toward each perpendicular)
STAR_REWARD = 0.35     # reward for collecting a required tomato
                       # (shaping that keeps the multi-room hunt learnable for Monte-Carlo)


class NewDonkCityEnv(GridWorld):
    """The city course: plants + puddles + pipes + tomatoes over the grid engine."""

    r2_slip_prob = R2_SLIP_PROB   # live-tunable skid chance (module constant default)
    star_reward = STAR_REWARD     # live-tunable tomato reward

    def _generate(self, seed):
        return world.generate(seed, **self.gen_cfg)

    # ---------------------------------------------------------------- install
    def _install_features(self, w):
        """Parse the city's hazards (spike traps, piranha plants, warp pipes) and
        the per-agent tomato sets. When all are empty, ``hazardous`` stays False
        and the env degrades to the plain deterministic navigate-to-goal."""
        self.spike_cells = {tuple(s) for s in getattr(w, "spikes", [])}
        self.plant_cells = {tuple(p) for p in getattr(w, "plants", [])}
        # A Piranha Plant occupies its own cell; its ATTACK ZONE is the eight
        # surrounding cells. Entering one of those neighbours kills the racer.
        # The plant cell itself is deliberately not lethal (the generator makes
        # it a wall so an actor cannot stand inside the model).
        self.plant_lethal = {
            (r + dr, c + dc)
            for r, c in self.plant_cells
            for dr in (-1, 0, 1)
            for dc in (-1, 0, 1)
            if (dr or dc)
            and 0 <= r + dr < self.H
            and 0 <= c + dc < self.W
        }
        # Both visible ends of a Pipe are active. Entering its entrance travels
        # to the generated destination; entering that exit again returns to the
        # original entrance. This also prevents actors from walking through the
        # solid exit model as if it were an ordinary floor tile.
        self.pipe_map = {}
        self.pipe_req = {}
        self.pipe_wt = {}
        for p in getattr(w, "pipes", []):
            entry = tuple(p["entry"])
            dests = [tuple(d) for d in p["dests"]]
            required = (
                int(p["requiresStar"])
                if p.get("requiresStar") is not None else None
            )
            self.pipe_map[entry] = dests
            self.pipe_req[entry] = required
            wt = list(p.get("weights") or [])
            n = len(dests)
            if len(wt) != n or sum(wt) <= 0:            # default: uniform over the dests
                wt = [1.0] * n
            self.pipe_wt[entry] = wt
            for dest in dests:
                self.pipe_map.setdefault(dest, []).append(entry)
                self.pipe_req[dest] = required
                self.pipe_wt.setdefault(dest, []).append(1.0)
        self.hazardous = bool(self.spike_cells or self.plant_cells or self.pipe_map)

        # TOMATOES: 3 collectibles PER AGENT (mirror pairs), collected on entry. The
        # final goal stays LOCKED until an agent holds all 3, so the state carries a
        # per-agent star bitmask (cell x star_mask) - Markov for Monte-Carlo.
        self.star_cells = {"red": [tuple(s) for s in getattr(w, "red_stars", [])],
                           "blue": [tuple(s) for s in getattr(w, "blue_stars", [])]}
        self.n_stars = len(self.star_cells["red"])
        self.star_bit = {a: {cell: i for i, cell in enumerate(self.star_cells[a])}
                         for a in ("red", "blue")}
        self.star_full = (1 << self.n_stars) - 1
        self.star_mode = self.hazardous and self.n_stars > 0
        # Keep Gym's declaration aligned with the tuple the tabular agents really
        # receive: (cell index, collected-tomato bitmask).
        if self.star_mode:
            self.observation_space = spaces.MultiDiscrete(
                [self.n_cells, max(1, 1 << self.n_stars)]
            )

    # ------------------------------------------------------------------ reset
    def _reset_round_state(self):
        # per-agent bitmask of tomatoes collected this episode (0..star_full)
        self.stars_collected = {"red": 0, "blue": 0}

    # -------------------------------------------------------- tunable dynamics
    def _set_round_dynamics(self, *, star_reward=None, **_unused):
        self.star_reward = self._pick(self.star_reward, star_reward, 0.0, 2.0)
        return False

    # ------------------------------------------------------------ observation
    def full_state(self, agent, cell):
        # (cell, tomato mask): which tomatoes are held changes both the pipes
        # and the goal, so the mask must be part of the state to stay Markov.
        if not self.star_mode:
            return super().full_state(agent, cell)
        return (self.pos_index[cell], self.stars_collected[agent])

    # ------------------------------------------------------------------ pipes
    def _pipe_unlocked(self, agent, entry, held=None):
        """Whether ``agent`` has the tomato required by this pipe, if any."""
        required = self.pipe_req.get(entry)
        if required is None:
            return True
        if held is None:
            held = getattr(self, "stars_collected", {}).get(agent, 0)
        return bool(held & (1 << required))

    # ------------------------------------------------------------------- step
    def _r2_resolve(self, agent, action):
        """One city move: walk one tile (walls block), then apply hazards. Returns
        ``(final_cell, death, warp_dest, warp_from)``: ``death`` is "spike"/"plant"/None,
        ``warp_dest`` is the tile a pipe teleported the agent onto (else None), and
        ``warp_from`` is the pipe ENTRANCE (dive) cell used for the warp-from FX cue
        (else None). Stepping INTO either end of a pipe applies its fixed transfer;
        a spike or any of the eight cells around a plant is lethal."""
        cur = self._pos(agent)
        move = action
        # SLIP: on a puddle a move may skid to a perpendicular tile (like Round-1 ice).
        if action in MOVE_ACTIONS and cur in self.slip_cells:
            r = self.rng.random()
            if r < self.r2_slip_prob:
                p1, p2 = PERP[action]
                move = p1 if r < self.r2_slip_prob * 0.5 else p2
        self._resolved_action[agent] = move
        self._slipped[agent] = move != action
        landed = self._move(agent, cur, move)          # the tile stepped onto (walls block)
        entry, warp = None, None
        if landed != cur and landed in self.pipe_map:  # stepped INTO a pipe -> warp
            if not self._pipe_unlocked(agent, landed):
                # Locked entries behave exactly like a wall. This is mostly a
                # robustness guard (the generated course also merges through its
                # tomato) but it prevents any future open-plaza variant from
                # skipping a stage collectible.
                nxt = cur
            else:
                entry = landed                          # the pipe ENTRANCE (dive point)
                dests = self.pipe_map[landed]           # sample fixed map weights
                warp = self.rng.choices(
                    dests, weights=self.pipe_wt.get(landed)
                )[0]
                nxt = warp
        else:
            nxt = landed
        death = None
        if nxt in self.spike_cells:
            death = "spike"
        elif nxt in self.plant_lethal:
            death = "plant"
        return nxt, death, warp, entry

    def _advance_agent(self, agent, act, reward, shape, dead, warped, dead_at,
                       warp_from):
        if not self.hazardous:
            return super()._advance_agent(agent, act, reward, shape, dead,
                                          warped, dead_at, warp_from)
        nxt, death, warp, entry = self._r2_resolve(agent, act)
        self._set_pos(agent, nxt)
        dead[agent] = death
        warped[agent] = warp
        warp_from[agent] = entry
        if death:
            dead_at[agent] = nxt               # stays here until the episode resets
        elif self.star_mode and nxt in self.star_bit[agent]:
            bit = self.star_bit[agent][nxt]    # collect a tomato on entry
            if not (self.stars_collected[agent] >> bit) & 1:
                self.stars_collected[agent] |= (1 << bit)
                reward[agent] += self.star_reward
                shape[agent] += self.star_reward

    def _goal_reached(self, agent):
        # the goal only WINS once the full tomato set is held (the progression lock)
        if self.star_mode:
            return (self._pos(agent) in self.goal_set
                    and self.stars_collected[agent] == self.star_full)
        return super()._goal_reached(agent)

    # --------------------------------------------------------------- snapshot
    def snapshot(self):
        """Base frame + hazard FX cues (from the engine) + the tomato progress."""
        snap = super().snapshot()
        if self.star_mode:
            sc = getattr(self, "stars_collected", {}) or {}
            snap["redStars"] = sc.get("red", 0)      # bitmask of collected stars (hide + progress)
            snap["blueStars"] = sc.get("blue", 0)
            snap["nStars"] = self.n_stars
        return snap
