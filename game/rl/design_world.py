"""One-time authoring tool: writes the PERMANENT fixed world.txt.

NOT runtime randomness — fixed seeds produce one frozen map that is committed
and never regenerated at play time.

Design goals baked in here:
  * Rooms reach ALL THE WAY to the castle walls: the maze sits on an EVEN-cell
    lattice (corridors on even coords, single-thickness walls on odd), and the
    grid boundary is floor — the castle's curtain wall is the only outer wall,
    so no redundant inner ring and the floor runs flush to the stone.
  * SINGLE-THICKNESS walls only: never two walls stacked. The two bedrooms are
    split by ONE wall column (col 9); the arena/bedroom split is ONE wall row
    (row 9).
  * The two bedroom mazes are DIFFERENT layouts but EQUAL in solve length
    (spawn -> key -> door), chosen by a seed search, so neither agent is handed
    an easier room.

Map legend: # wall, . floor, E escape, r/b colored keys, D/d colored doors,
G gold (pedestal), 1/2 teleporter pads, a/c pad targets, R/B spawns.
"""

import os
import random
from collections import deque

SIZE = 20
DIRS = [(-2, 0), (2, 0), (0, -2), (0, 2)]
ORTHO = [(-1, 0), (1, 0), (0, -1), (0, 1)]

# fixed fixture positions (mirror-placed so the two rooms are fair)
RED_SPAWN, BLUE_SPAWN = (18, 0), (18, 18)
RED_KEY, BLUE_KEY = (10, 8), (10, 10)
RED_DOOR, BLUE_DOOR = (9, 4), (9, 14)        # in the divider row
RED_ENTRY, BLUE_ENTRY = (10, 4), (10, 14)    # room cell just inside each door
GOLD = (4, 9)
ESCAPE = [(0, 9), (0, 10)]
# teleport targets sit low and central (far from the escape at the top), so
# being teleported there is a real setback — and well away from the pads
ALT_A, ALT_C = (8, 6), (8, 12)


def carve(g, r0, r1, c0, c1, seed, braid=0.0):
    rng = random.Random(seed)
    cells = [(r, c) for r in range(r0, r1 + 1, 2) for c in range(c0, c1 + 1, 2)]
    cellset = set(cells)
    for (r, c) in cells:
        g[r][c] = '.'
    seen = {cells[0]}
    stack = [cells[0]]
    while stack:
        r, c = stack[-1]
        opts = [(dr, dc) for dr, dc in DIRS
                if (r + dr, c + dc) in cellset and (r + dr, c + dc) not in seen]
        if not opts:
            stack.pop()
            continue
        dr, dc = rng.choice(opts)
        g[r + dr // 2][c + dc // 2] = '.'
        g[r + dr][c + dc] = '.'
        seen.add((r + dr, c + dc))
        stack.append((r + dr, c + dc))
    if braid > 0:
        for (r, c) in cells:
            if rng.random() < braid:
                closed = [(dr, dc) for dr, dc in DIRS
                          if (r + dr, c + dc) in cellset and g[r + dr // 2][c + dc // 2] == '#']
                if closed:
                    dr, dc = rng.choice(closed)
                    g[r + dr // 2][c + dc // 2] = '.'


def bfs(g, src, dst):
    q = deque([(src, 0)])
    seen = {src}
    while q:
        (r, c), d = q.popleft()
        if (r, c) == dst:
            return d
        for dr, dc in ORTHO:
            nr, nc = r + dr, c + dc
            if 0 <= nr < SIZE and 0 <= nc < SIZE and (nr, nc) not in seen and g[nr][nc] != '#':
                seen.add((nr, nc))
                q.append(((nr, nc), d + 1))
    return None


def room_layout(seed, c0, c1):
    g = [['#'] * SIZE for _ in range(SIZE)]
    carve(g, 10, 18, c0, c1, seed, braid=0.10)
    return g


def room_solve(seed, c0, c1, spawn, key, entry):
    g = room_layout(seed, c0, c1)
    a, b = bfs(g, spawn, key), bfs(g, key, entry)
    return (a + b) if (a is not None and b is not None) else None


def pick_equal_difficulty():
    """Two DIFFERENT bedroom seeds whose solve length is equal (and as long as
    possible, so the rooms are real mazes, not trivial)."""
    red = {s: room_solve(s, 0, 8, RED_SPAWN, RED_KEY, RED_ENTRY) for s in range(400)}
    blue = {s: room_solve(s, 10, 18, BLUE_SPAWN, BLUE_KEY, BLUE_ENTRY) for s in range(400)}
    common = {L for L in red.values() if L} & {L for L in blue.values() if L}
    target = max(common)
    sr = next(s for s, L in red.items() if L == target)
    sb = next(s for s, L in blue.items() if L == target)
    return sr, sb, target


def open_neighbors(g, r, c):
    return [(r + dr, c + dc) for dr, dc in ORTHO if g[r + dr][c + dc] != '#']


def build(seed_red, seed_blue):
    g = [['#'] * SIZE for _ in range(SIZE)]

    carve(g, 0, 8, 0, 18, seed=141, braid=0.22)          # arena maze
    for r in range(2, 7):                                # open central chamber
        for c in range(6, 13):
            g[r][c] = '.'
    carve(g, 10, 18, 0, 8, seed_red, braid=0.10)         # red bedroom
    carve(g, 10, 18, 10, 18, seed_blue, braid=0.10)      # blue bedroom

    # boundary is floor so rooms run flush to the castle wall (col/row 19 are the
    # odd leftover edge — open them up rather than leave a redundant wall line)
    for i in range(SIZE):
        g[19][i] = '.' if g[18][i] != '#' or g[17][i] != '#' else g[19][i]
        g[i][19] = '.' if g[i][18] != '#' or g[i][17] != '#' else g[i][19]

    # escape gate + the throat connecting it to the central chamber
    for (r, c) in ESCAPE:
        g[r][c] = 'E'
    g[1][9] = g[1][10] = '.'

    g[RED_DOOR[0]][RED_DOOR[1]] = 'D'
    g[BLUE_DOOR[0]][BLUE_DOOR[1]] = 'd'
    g[RED_SPAWN[0]][RED_SPAWN[1]] = 'R'
    g[BLUE_SPAWN[0]][BLUE_SPAWN[1]] = 'B'
    g[RED_KEY[0]][RED_KEY[1]] = 'r'
    g[BLUE_KEY[0]][BLUE_KEY[1]] = 'b'
    g[GOLD[0]][GOLD[1]] = 'G'
    g[ALT_A[0]][ALT_A[1]] = 'a'
    g[ALT_C[0]][ALT_C[1]] = 'c'

    # teleporter pads: most dead-end-like cells far from centre, one per side
    chamber = {(r, c) for r in range(2, 7) for c in range(6, 13)}
    protect = chamber | {GOLD, ALT_A, ALT_C, (1, 9), (1, 10), (0, 9), (0, 10),
                         RED_DOOR, BLUE_DOOR}
    cands = [(r, c) for r in range(0, 9) for c in range(0, 19)
             if g[r][c] == '.' and (r, c) not in protect]
    score = lambda rc: (len(open_neighbors(g, *rc)),
                        -((rc[0] - GOLD[0]) ** 2 + (rc[1] - GOLD[1]) ** 2))
    left = sorted((rc for rc in cands if rc[1] <= 7), key=score)
    right = sorted((rc for rc in cands if rc[1] >= 11), key=score)
    g[left[0][0]][left[0][1]] = '1'
    g[right[0][0]][right[0][1]] = '2'
    return g


def assert_single_thickness(g):
    for r in range(SIZE - 1):
        for c in range(SIZE - 1):
            if all(g[r + dr][c + dc] == '#' for dr in (0, 1) for dc in (0, 1)):
                raise AssertionError(f"2x2 wall block at ({r},{c}) — not single-thickness")


def main():
    sr, sb, target = pick_equal_difficulty()
    g = build(sr, sb)
    assert_single_thickness(g)
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "world.txt")
    with open(path, "w") as f:
        for row in g:
            f.write("".join(row) + "\n")
    print(f"wrote {path}")
    print(f"bedroom seeds: red={sr} blue={sb}, equal solve length = {target} steps each")
    for row in g:
        print("".join(row))


if __name__ == "__main__":
    main()
