# Terrain notes

## Sources

- `terrain.json`: EU-DEM 25 m sampled by OpenTopoData at a lattice of 0.0010 deg lat x 0.00131 deg lon
  (about 111 m x 86 m), 235 x 229 nodes over the wide bbox. The core (100 x 71 nodes) is the area of roads,
  buildings and nature. Point samples of a 25 m model at a 100 m lattice: the Douro gorge walls
  (60 to 100 m of rise in under 200 m) are smeared over two or three nodes.
- `terrain-fine.bin.gz`: AWS Terrain Tiles (Terrarium PNG, zoom 14, 40 tiles, about 7 m per pixel), resampled
  to a 12 m grid over the core bbox plus a 440 m margin (982 x 725 samples). Built by
  `node scripts/fetch-terrain-fine.mjs`, packed by `src/terrain-fine.js` (Int16 decimetres, 2-D predictor,
  gzip): 256 KB on the wire (budget 3 MB). Loaded with `terrain.json`, no deferral needed (limit was 1 MB).
  Terrarium height = r * 256 + g + b / 256 - 32768.

## Which source is better (`node scripts/fetch-terrain-fine.mjs --compare`)

Reference heights are the approximate figures of the task (spot heights, not a survey). Landmark points
of `data/landmarks.json`. Metres above sea level.

| point                    | ref | EU-DEM lattice | Terrarium z14 |
|--------------------------|----:|---------------:|--------------:|
| Clerigos                 |  80 |           86.6 |          89.0 |
| Ribeira quay             |   4 |           13.3 |          12.3 |
| Serra do Pilar           | 100 |           69.7 |          71.1 |
| Jardim do Morro          |  85 |           66.9 |          67.8 |
| Palacio de Cristal       |  90 |           80.4 |          83.1 |
| Foz (S. Joao Baptista)   |   8 |           17.4 |          21.7 |
| Douro mid-river (Luis I) |   0 |            1.0 |           2.5 |
| mean absolute error      |     |       12.0 m   |       12.4 m  |

At the 7,300 lattice nodes inside the fine area the two sources differ by -0.1 m on average and 2.5 m RMS.
They are the same underlying model (both derive from the 25 to 30 m European DEM): Terrarium is not more
accurate in height. It is far better sampled. A cross-section over the Ribeira slope (lat 41.1405, lon -8.6140
to -8.6040, every 14 m):

    EU-DEM    14.2 10.0 13.5 13.7 14.3  4.9  1.1  1.0  7.1
    Terrarium 15.2  7.8  4.2  4.9  1.8  3.0  3.0  3.0  3.4

The lattice holds the quay at 13 m for 60 m, then drops; the fine grid has the wall where it is. So the
fine grid is used for shape; its heights are the same model as before, with the same errors: hill tops are
10 to 30 m low (Serra do Pilar 70 against 100: a DSM at 25 m smooths a 60 m knoll), the river reads 1 to 2.5 m.

## Datum

`y = 0` is the lattice height at the projection origin (91.0 m). `createTerrain` takes the datum from the
lattice only, so it is the same number with or without the fine core; fits, models, bridge decks and quays
keep their heights. Terrarium holds the Douro at 2.5 to 3 m where the lattice holds it at 1 m: the fetch script
pulls the river band (2.0 to 3.5 m) down by 2 m (smoothstep), so the water level every module reads is where it
was. Mean difference to the lattice per height band after the fix: 0.0 m (0 to 20 m), under 0.4 m elsewhere.

## Blend

Inside the fine bbox minus 360 m the height is the fine grid; across the outer 360 m it eases (smoothstep) into
the lattice, so the streamed ring (lattice only) meets it without a step. The core bbox lies 440 m inside the
fine bbox, so the whole core is fine.

## One height function

`terrain.rawAt` (no pads) and `terrain.heightAt` (with pads) read the fine grid. Workers (tile worker, model
worker) get it in `terrain.grid.fine` and rebuild the same function. The ground mesh lattice inside the fine
bbox is the data's own 12 m grid (`scene.js groundAxes`), so the streamed tiles and MS buildings drape on the
same triangles.
