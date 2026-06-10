# Texture overrides

Every texture in the game is generated procedurally as a placeholder.
To replace one, just drop a PNG with the matching name into this folder
and refresh the page — no code changes needed.

| File name            | Used on                                      | Suggested size |
| -------------------- | -------------------------------------------- | -------------- |
| `floor.png`          | top of each floor tile                       | 256×256        |
| `floor_side.png`     | sides of floor tiles                         | 128×64         |
| `wall.png`           | sides of interior room walls + gate posts    | 256×256        |
| `wall_top.png`       | tops/caps of interior walls, battlements     | 128×128        |
| `outer_wall.png`     | castle perimeter wall + corner towers        | 256×256 (tiles) |
| `ground.png`         | grout/moss layer visible between tiles       | 1024×1024 (covers whole 20×20 board) |
| `outside_ground.png` | terrain beyond the castle walls              | 512×512 (tiles) |
| `roof.png`           | teal cone roofs on the corner towers         | 128×128        |
| `banner.png`         | hanging wall banners (keep near-white — it gets tinted per banner; alpha = shape) | 64×128 |
| `decal.png`          | gold star decals on random tiles (alpha)     | 128×128        |

Notes:

- Tile tops, walls and banners are tinted per-instance, so textures that are
  too saturated will shift color. Keep them fairly neutral/bright.
- `banner.png` and `decal.png` need an alpha channel (transparent background).
