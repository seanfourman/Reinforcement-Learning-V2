# Rival Minds - the complete guide (English)

This guide explains the whole project **from zero**: what reinforcement
learning is, what each of the five arenas asks the agents to do, exactly what
they see and what they are rewarded for, how every algorithm works (intuition
first, mechanism second), and what every tunable knob means. After reading it
you should be able to teach the project to someone who has never heard of RL.

The Hebrew version of this guide, `GUIDE_HE.md`, has the same content.

---

## 0. Reinforcement learning in five minutes

A **reinforcement-learning agent** is a program that learns to act by trial and
error. It lives inside an **environment** (here: a game arena). Life proceeds
in ticks. At every tick the agent:

1. observes the **state** `s` - everything it is allowed to know right now;
2. chooses an **action** `a` - one of a fixed menu of moves;
3. the environment reacts: it hands back a **reward** `r` (a number, positive
   or negative) and the next state `s'`.

A full run from start to finish (spawn to goal, or to death, or to a timeout)
is an **episode**. The agent's goal is not the next reward but the **return**:
the total reward collected until the episode ends, with later rewards
multiplied down by a **discount factor** `gamma` (a number just below 1). With
`gamma = 0.98`, a reward 35 steps in the future is worth about half of one
now; the closer `gamma` is to 1, the more far-sighted the agent.

The agent's behavior is its **policy** `pi(s)`: which action it takes in each
state. Most algorithms here get their policy indirectly, by learning an
**action-value function** `Q(s, a)`: "if I stand in `s`, do `a`, and behave
well afterwards, what return do I expect?" Once `Q` is decent, a good policy
is simply "take the action with the biggest Q" (**greedy**). The **state
value** `V(s)` is the value of the best action there - the game's heatmaps
show exactly this number per tile.

The tension the whole field revolves around is **exploration vs exploitation**:
always taking the currently-best-looking action means never discovering better
ones. The classic fix is **epsilon-greedy**: with probability `epsilon` do a
random move, otherwise the greedy one, and shrink `epsilon` on a schedule as
the agent matures. (The policy-gradient agents of Round 5 explore differently -
by sampling from a probability distribution over actions.)

Formally, each arena is a **Markov Decision Process (MDP)**: states, actions,
transition probabilities `P(s'|s, a)`, rewards, and `gamma`. "Markov" means
the state carries everything needed to predict what happens next - that is why
several arenas fold extra facts into the state (which tomatoes you hold, the
Goomba patrol phase): without them, the future would depend on hidden history.

The tournament's five rounds walk the classic curriculum in order:

| Round | Family | The idea |
| --- | --- | --- |
| 1 | Dynamic Programming | the model is KNOWN, so plan; no learning |
| 2 | Monte Carlo | learn from complete-episode returns |
| 3 | Temporal Difference | learn one step at a time by bootstrapping |
| 4 | Deep value-based (DQN) | Q becomes a neural network over continuous state |
| 5 | Policy gradient | learn the policy itself, not values |

In every round, **Blue is the player's model and Red is the CPU**, whose
strength comes from a per-character hyperparameter ladder (see section 6).
Both are real, independent Python learners; the browser only renders them.

---

## 1. Round 1 - Peach's Castle (Value Iteration vs Policy Iteration)

### The game

A mirror-symmetric stochastic maze race across the castle floor. Both models
spawn in opposite corners of an identical maze and race to the **Power Moon**
at the centre of the mirror axis; first one there wins, a simultaneous arrival
is a draw. Three mechanics make it more than a shortest-path search:

* **Coins** (each side owns its own mirrored set): +0.2 each, a detour
  trade-off against the per-step time cost.
* **Ice tiles** (shared): a move across ice slips sideways with probability
  0.30 (0.15 to each perpendicular direction).
* **"?" Mystery Blocks** (one per side): a one-time gamble - 50% **Ghost**
  (phase through maze walls for up to 4 floor tiles, plus a +0.15 bonus), 50%
  **Freeze** (stuck in place for 3 turns).

### The state

Plainly: *where you stand, what you have already collected, and whether you
are currently ghosting or frozen.* Precisely: the tuple
`(cell, collected_mask, status)` - the position index (floor cells, plus
interior wall cells reachable only while ghosting), a bitmask of your own
coins/blocks already claimed, and a status counter (0 normal, +k = k ghost
tiles left, -k = k frozen turns left). At the defaults this is roughly 23,000
states (the briefing card computes the exact number live).

### The rewards

| Event | Reward | Why |
| --- | --- | --- |
| every step | -0.01 | time pressure: faster solutions score higher |
| pick up one of your coins | +0.2 | optional value that forces a detour-vs-speed decision |
| Ghost roll on a "?" block | +0.15 | keeps the gamble worth taking, so the power-up actually appears |
| reach the Power Moon first | +1.0 | the win |
| rival reaches it first | -1.0 | the loss |

### The algorithms - Dynamic Programming, from zero

Round 1 is special: the transition model `P(s'|s,a)` is **known** (the env
exposes it via `state_transition`, and the planners consume exactly that
function - the value field is the true dynamics, not an estimate). When you
know the model you do not need to learn from experience; you can **plan**.
The tool is the **Bellman equation**, which says the value of a state is the
best expected "one step of reward plus the discounted value of wherever you
land":

    V(s) = max_a  sum_{s'} P(s'|s,a) * [ r(s,a,s') + gamma * V(s') ]

* **Value Iteration (VI)** turns that equation into an update rule: sweep over
  all states, replace `V(s)` by the right-hand side, repeat until the biggest
  change in a sweep falls below the threshold `theta`. The policy is read off
  greedily from the current V. Watch the propagation animation: value spreads
  outward from the Moon one ring per sweep, because each sweep pushes
  information one step further back.
* **Policy Iteration (PI)** alternates two phases: **evaluate** the current
  policy (sweeps that compute "how good is THIS policy", with no max), then
  **improve** it (make it greedy against those values), and repeat until the
  policy stops changing. This build uses *truncated* PI - 8 evaluation sweeps
  per improvement - because full evaluation between improvements would take
  hundreds of sweeps at gamma near 1.

Both converge to the SAME optimal policy; the contest is *how fast*. Instead
of solving before playing, each planner advances `plan_speed` Bellman sweeps
per game tick and acts on its current, half-baked plan - so early on both
wander, and whoever converges first starts beelining. Once both have
converged they play identical optima and every race is a draw: the round is
literally a **convergence race**.

### The knobs (with sensible ranges)

| Knob | Default | Range | Meaning |
| --- | --- | --- | --- |
| gamma | 0.98 | 0.90-0.999 | far-sightedness; near 1 because the only big reward is at the goal |
| dpTheta | 1e-5 | 1e-9-1e-2 | convergence threshold; smaller = more exact, more sweeps |
| dpMaxIters | 2000 | 100-100000 | safety cap on sweeps per plan |
| dpPlanning | 0.6 | 0-10 | Blue's sweeps per tick - the race knob |
| slipProb | 0.30 | 0-0.9 | ice slip chance; higher = plan must respect risk more |
| blockGhostProb | 0.5 | 0-1 | P(Ghost) on a "?" block |
| ghostLen / freezeLen | 4 / 3 | 1-8 | power-up / penalty durations (changes the state space) |
| coinReward / blockReward | 0.2 / 0.15 | 0-2 | how much a detour is worth |

---

## 2. Round 2 - New Donk City (Every-visit MC vs First-visit MC)

### The game

A seeded, mirror-symmetric city course of **three rooms** connected only by
warp Pipes. Each racer must collect its own three **tomatoes** (one per room)
and then reach the shared goal at the top; the goal stays locked until all
three are held. Piranha Plants make the eight cells around them **lethal** - a
racer that steps there is eliminated for the rest of the episode (the rival
plays on). Puddles skid a move sideways with probability 0.12, and every room
offers the same deliberate dilemma: a short wet/risky route vs a longer dry
safe route. Each room's Pipe is locked by that room's tomato, so the course
enforces collect-then-advance.

### The state

Plainly: *where you stand and which tomatoes you already hold.* Precisely
`(cell, tomato_mask)` - about 261 floor cells times 8 mask values, roughly
2,100 states. The mask is what keeps the problem Markov: the value of a tile
depends on what you still need to collect.

### The rewards

| Event | Reward | Why |
| --- | --- | --- |
| every step | -0.01 | time pressure |
| collect a tomato (first time) | +0.35 | shaping: breaks a very long task into three learnable legs |
| all 3 tomatoes + reach the goal | +1.0 | the win |
| enter a plant's attack zone | -1.0 | death; ends only YOUR trajectory |

### The algorithms - Monte Carlo, from zero

Nobody knows the model here, so the agents learn **from experience**. Monte
Carlo is the most literal way to do that: play a WHOLE episode, then, for each
`(state, action)` pair you passed through, look at the discounted return `G`
that actually followed it and nudge `Q(s, a)` toward `G`:

    Q(s,a) <- Q(s,a) + step * (G - Q(s,a))

No bootstrapping, no model - just measured outcomes. The price is patience
(nothing updates until the episode ends) and **variance** (one lucky run can
swing G a lot), which is why this arena keeps epsilon high for a long time and
applies the learning rate gently (the MC step is `alpha x 0.25`; raw alpha
made Q wobble off the optimal path).

* **Every-visit MC** (Red's default) updates a pair at EVERY occurrence
  inside the episode.
* **First-visit MC** (Blue's default) updates only the FIRST occurrence per
  episode - the textbook contrast; each update is then an unbiased sample of
  the return from that pair.

One training detail worth teaching: the tournament uses **exploring starts**,
the classic MC recipe for coverage. Seven of every ten episodes are genuine
bottom-spawn races; the other three start at a random mirrored cell of a later
room with the earlier tomatoes already "held", so the Q slices for
mid-progress states keep getting visits. Only full races count in the contest
statistics.

### The knobs

| Knob | Default | Range | Meaning |
| --- | --- | --- | --- |
| alpha | 0.19 | 0.05-0.4 | learning rate (applied x0.25 inside MC) |
| gamma | 0.98 | 0.9-0.999 | must be near 1: the win arrives ~40+ steps after the start |
| epsStart -> epsEnd | 0.90 -> 0.05 | - | exploration schedule |
| epsEpisodes | 7200 | 3000-12000 | LONG decay: full-return updates arrive rarely, so exploration must persist |
| r2SlipProb | 0.12 | 0-0.9 | puddle skid risk (prices the shortcuts) |
| r2TomatoReward | 0.35 | 0-2 | shaping size; too high and tomato-farming beats finishing |

---

## 3. Round 3 - Fossil Falls (SARSA vs Q-Learning, plus Expected-SARSA)

### The game

A random **perfect maze** (regenerated per seed, mirror-fair) racing to a
shared top-centre exit, patrolled by six **Goombas** that walk fixed routes
back and forth deterministically. Sharing a Goomba's cell - or swapping
through one - is death. A 5th action, **Stay**, lets a racer wait a beat so a
patrol clears. Wet cells skid moves 20% of the time; each side has an
off-route **cage pickup** (grab yours to freeze the rival for 6 steps - the
comeback tool), and some mazes add a **boulder / pressure-plate puzzle** that
opens a private shortcut door.

### The state

Plainly: *where you stand, where the patrols are in their cycle, how you stand
relative to the rival, and whether your shortcut is open.* Precisely
`(cell, steps mod P, rival_flag, door_bit)` where `P` is the shared patrol
period (the least common multiple of the individual patrol cycles) and
`rival_flag` packs ahead/level/behind x cage-still-available into 6 values.
The patrol phase is the Markov trick: with it, the "moving" Goombas become a
predictable function of the state, so timing them is learnable by a table.

### The rewards

| Event | Reward | Why |
| --- | --- | --- |
| every step | -0.01 | time pressure |
| reach the exit first | +1.0 | the win |
| grab your cage while BEHIND | +0.2 | paid only when behind, so the detour is learned as a catch-up move, not a habit |
| caught by a Goomba | -1.0 | death |
| rival finishes first | -1.0 | the loss |

### The algorithms - Temporal Difference, from zero

Monte Carlo waits for the real return; **TD learning** does not. After ONE
step it forms a target from the reward plus its own current estimate of the
next state - it **bootstraps**:

* **SARSA** (on-policy; the name is the quintuple it uses:
  State-Action-Reward-State-Action):

      target = r + gamma * Q(s', a')        where a' is the action it ACTUALLY takes next

  It learns the value of the policy it is really following, exploration slips
  included - which makes it naturally cautious near cliffs and Goombas (its
  values already price in "I might do something random next step").

* **Q-Learning** (off-policy):

      target = r + gamma * max_a' Q(s', a')

  It evaluates the BEST next action regardless of what it actually does next,
  so it learns the optimal greedy policy directly while still exploring.

* **Expected-SARSA** replaces both with the policy's EXPECTED next value
  (a weighted mix of max and mean under epsilon-greedy) - SARSA's realism with
  most of the sampling noise averaged out.

In all three, the update is `Q(s,a) += alpha * (target - Q(s,a))`; the single
line that differs is the target - that one-line diff IS the on-policy vs
off-policy distinction.

### The knobs

| Knob | Default | Range | Meaning |
| --- | --- | --- | --- |
| alpha | 0.20 | 0.1-0.5 | one-step targets are low-variance, so TD tolerates a much bigger step than MC |
| gamma | 0.98 | 0.9-0.999 | far-sighted routing |
| epsStart -> epsEnd | 1.0 -> 0.05 | - | exploration schedule |
| epsEpisodes | 3000 | 300-5000 | TD propagates value fast, so decay can be much shorter than MC's |
| r3SlipProb | 0.20 | 0-0.9 | wet-cell skid (the round's luck factor) |
| r3CageReward | 0.2 | 0-2 | cage shaping bonus (paid only when behind) |
| r3CageLen | 6 | 1-15 | how long the rival stays frozen |

---

## 4. Round 4 - Ruined Kingdom (DQN vs Double-DQN, plus Dueling-DQN)

### The game

A survival duel on a circular 10 m tower. **Banzai Bills** fly in through the
north opening and home in on a target with a capped turn rate; they explode on
a character or the rim. Each character has **3 hearts**; a hit costs one and
grants a brief mercy-invulnerability; the round ends when someone runs out -
the survivor wins. Pickups litter the floor: **speed** and **shield** (seek),
**slow** and **freeze** (avoid). The barrage escalates with survival time,
and a 1,000-episode **curriculum** eases fresh learners in gently. Movement
follows the course spec: a decision every **0.02 s**, DISCRETE velocity per
axis with no momentum; stability comes from **action-repeat** (the chosen
heading is held for 4 steps).

### The state - and why a table no longer works

Positions and velocities are real numbers now; there is no finite list of
states to index a table with. The observation is a **55-dimensional vector**:
5 own kinematics (position, velocity, rim clearance) + 5 own effect timers +
the 3 nearest missiles x 8 numbers each (present, relative position,
velocity, aimed-at-me, time-to-impact, predicted miss distance), sorted
most-imminent-first + the 3 nearest pickups x 7 (position + type one-hot).
The threat sorting matters: slot 0 always means "the Bill about to hit you",
so the network can learn one dodge rule instead of one per spawn slot.

### The rewards

| Event | Reward | Why |
| --- | --- | --- |
| staying alive | +0.2 / second | survival IS the task (scaled by dt so it is per-second, not per-tick) |
| a Bill aimed at you expires without a hit | +0.15 | credit for a completed dodge |
| actively changing a closing Bill's projected miss distance | up to +/-0.25 / s | dense, potential-based dodge shaping (capped so wiggling cannot farm it) |
| lose a heart | -2.0 | the mistake signal that dominates everything |
| rival loses its last heart | +0.05 | deliberately tiny: this is a survival game, not a combat game |

### The algorithms - DQN, from zero

The idea of **DQN** (Deep Q-Network): keep everything from Q-Learning, but
replace the table with a small neural network `Q(s, a; w)` - here a
multi-layer perceptron, default **2 hidden layers x 128 neurons** with ReLU,
taking the 55-vector in and emitting 9 action-values out. Networks generalize
(nearby states share value estimates), which is the whole point - and also the
danger, because updating one state now nudges many. Three stabilizers make it
work:

1. **Experience replay.** Transitions go into a ring buffer (50,000 here);
   training samples random minibatches from it, breaking the correlation
   between consecutive steps that would otherwise let the net chase itself.
2. **A target network.** The bootstrap target `r + gamma * max Q_target(s')`
   uses a FROZEN copy of the net, re-synced every 500 training steps - so the
   regression target holds still between syncs.
3. **n-step returns** (n = 3 here): fold three real rewards into each target,
   so a heart-loss penalty reaches three decisions back at once.

* **Double-DQN** fixes a known bias. Vanilla DQN's `max` both SELECTS and
  SCORES the next action with the same noisy estimator, so overestimated
  actions win the max - values drift optimistic. Double-DQN decouples them:
  the ONLINE net selects (`argmax`), the TARGET net evaluates. One line of
  code; watch the predicted-Q chart to see vanilla drift higher.
* **Dueling-DQN** changes the network HEAD instead: a shared trunk splits
  into a state-value head `V(s)` and an advantage head `A(s, a)`, recombined
  as `Q = V + A - mean(A)`. In a missile storm most of the value is "where
  you stand", not tiny action differences - the split lets the net learn that
  directly (the panel's V/A probe shows it live).

### The knobs

| Knob | Default | Range | Meaning |
| --- | --- | --- | --- |
| alpha | 0.30 | 0.05-0.6 | maps to the Adam learning rate (`max(2e-4, alpha x 5e-3)`) |
| gamma | 0.99 | 0.95-0.999 | survival horizons are long: hundreds of steps |
| epsStart -> epsEnd | 1.0 -> 0.05 | - | epsilon still drives exploration (values, not policies) |
| epsEpisodes | 1000 (capped) | 200-2500 | decay span |
| dqnHidden / dqnLayers | 128 / 2 | 16-1024 / 1-6 | network width / depth |
| dqnBatch | 64 | 1-1024 | minibatch size per training step |
| dqnBuffer | 50,000 | 1k-2M | replay memory capacity |
| dqnWarmup | 500 | 0+ | samples collected before training starts |
| dqnTargetSync | 500 | 1+ | steps between target-net copies |
| dqnNstep | 3 | 1-10 | multi-step return length |
| r4MissileSpeed / r4MissileHoming | 5.4 / 0.5 | 2-10 / 0-1.5 | Bill top speed / max turn rate |
| r4Hearts | 3 | 1-9 | lives per round |
| r4HitPenalty | -2.0 | -5..-0.1 | the mistake signal |
| r4ActionRepeat | 4 | 1-8 | heading commit window |

---

## 5. Round 5 - Tostarena / Dry Dry Desert (Actor-Critic vs PPO, plus REINFORCE)

### The game

**Capture the Flag.** One flag on the centre pole; grab it to become the
carrier (you move at 0.72x speed), haul it to your corner base to **capture**
(+1); first to 3 captures wins. The chaser can TAG the carrier to **steal the
flag instantly** (the victim is stunned 1.5 s). Breakable **crates** drop a
random Mario-Kart weapon into a one-slot inventory, fired with the 10th
action, **USE**: a Chain Chomp (reels the rival in), a homing red shell, a
bouncing green shell, a banana trap, or an oil slick. Overhead, **Bowser's
airship** periodically hurls objects at random spots - the blast stuns, so
both agents must dodge. Unlike every earlier round, each agent SEES its rival:
this is a genuinely adversarial game, and unpredictable evasion is exactly
where a stochastic policy shines.

### The state

A **66-dimensional vector**: own position/velocity (4) + rival relative
position/velocity (4) + flag direction and holder flags (5) + vectors to both
bases (4) + status (carrying, both stun timers, capture lead: 4) + 2 nearest
crates (6) + held-weapon one-hot + rival-armed (6) + 2 nearest shells (10) +
2 nearest traps (8) + 3 nearest thrown Bowser objects within the sight radius
(15).

### The rewards

| Event | Reward | | Event | Reward |
| --- | --- | --- | --- | --- |
| grab the loose flag | +0.15 | | smash a crate | +0.10 |
| steal (tag the carrier) | +0.40 | | chain-yank the rival | +0.08 |
| lose the flag to a tag | -0.40 | | shell hit | +0.30 |
| capture at your base | +1.0 | | banana / oil snare | +0.25 |
| rival captures | -0.30 | | get stunned by anything | -0.05 |
| win the round | +2.0 / -2.0 | | every step | -0.002 |

Plus a small **potential-based shaping** term (coefficient 0.02) toward the
current objective - the flag when it is free, your base while carrying, the
carrier while chasing. Potential-based means it telescopes over a path and
cannot be farmed by circling.

### The algorithms - policy gradients, from zero

Everything so far learned VALUES and derived the policy from them. Policy
gradient methods learn the **policy itself**: a network maps the observation
to a probability for each action (via logits and a softmax), the action is a
SAMPLE from that distribution, and learning nudges probabilities of
good-outcome actions up. Sampling is the exploration - there is no epsilon -
and an **entropy bonus** keeps the distribution from collapsing to one action
too early.

* **REINFORCE** is the foundation: play a full episode, compute each step's
  actual return `G_t`, then push `log pi(a_t|s_t)` up in proportion to
  (whitened) `G_t`. Unbiased but high-variance - the Monte Carlo of policies.
* **Actor-Critic** adds a second head, the **critic** `V(s)`, and updates
  every 64 steps instead of every episode. The critic *bootstraps* the tail
  of each short rollout (that is what makes it a true actor-critic, not just
  a baseline), and the actor is judged by the **advantage**
  `A = R_nstep - V(s)`: "was that action better than expected from here?" -
  which slashes variance. Advantages are estimated with **GAE(lambda)**, a
  knob (0.95) that trades bias against variance in that bootstrap.
* **PPO** is the modern workhorse: collect a 512-step rollout, compute GAE
  advantages, then run FOUR epochs of minibatch updates over it. Reusing data
  that hard would normally let the policy run away from the data it was
  collected with, so PPO **clips** the probability ratio
  `pi_new / pi_old` into `[1 - 0.2, 1 + 0.2]` inside the loss: once an action's
  probability has moved 20% away from the behavior policy, its gradient
  switches off. Stable AND sample-efficient.

### The knobs

| Knob | Default | Range | Meaning |
| --- | --- | --- | --- |
| alpha | 0.20 | 0.05-0.5 | maps to Adam lr (`max(1e-4, alpha x 1.5e-3)`) - policies need gentler steps than values |
| gamma | 0.98 | 0.95-0.999 | capture chains are long |
| pgEntropy | 0.01 | 0-0.2 | exploration pressure; too low collapses early, too high never commits |
| pgLambda | 0.95 | 0-1 | GAE bias/variance dial |
| pgValueCoef | 0.5 | 0-2 | critic loss weight |
| pgHorizon | 512 (PPO) / 64 (AC) | 8-2048 | rollout length between updates |
| pgClip | 0.2 | 0.02-0.6 | PPO's trust region width |
| pgEpochs | 4 | 1-20 | optimization passes per rollout |
| pgMinibatch | 128 | 8-512 | minibatch size within an epoch |
| pgHidden | 128 | 16-1024 | policy network width (2 Tanh layers) |
| r5BowserCount / Speed / Interval | 1 / 10 / 2.5s | 0-6 / 1-14 / 0.5-30 | airship pressure |
| r5AgentSight | 6 m | 1-20 | how far ahead thrown objects are seen |

---

## 6. The CPU ladder - how Red gets its strength

Red never uses the panel; its hyperparameters come from the chosen character,
level 0 (Mario, weakest) to level 9 (Parabones, strongest), one ladder per
arena (`core/ladders.py`; the full tables are in `README.md`). The design
logic per family:

* **Round 1 (DP):** strength = `plan_speed`, from 0.15 sweeps/tick (Mario) to
  3.40 (Parabones). Everyone reaches the same optimum; the strong just get
  there sooner.
* **Rounds 2-3 (tabular):** stronger characters hold a LOWER final epsilon
  (less lingering randomness), decay it faster, and use a higher alpha. In
  Round 3 every character learns a working policy; the difficulty is the
  random-move rate it keeps forever (Mario ~0.40, Parabones ~0.02).
* **Round 4 (DQN):** final epsilon falls 0.30 -> 0.03, gamma rises 0.980 ->
  0.995, alpha rises - a strong character dodges deliberately instead of
  wandering into Bills.
* **Round 5 (PG):** there is no epsilon, so strength = learning rate (0.10 ->
  0.46), gamma (0.970 -> 0.990) and ENTROPY (0.050 -> 0.004): a weak character
  stays dithery forever; a strong one commits to sharp, decisive play.

---

## 7. Running and poking it

```sh
python game/serve.py
```

opens the game in a browser (Python 3.10+, `numpy` + `gymnasium`; `torch`
needed only when Rounds 4-5 build their agents). The C panel edits every knob
above live; `README.md` documents each arena's parameter tables and the
measured best settings; `CODE_MAP.md` maps every concept in this guide to the
exact file and function that implements it.
