# Ice Hockey

A single-file Three.js ice hockey game with EA-NHL-style skating and shooting
physics, on a regulation NHL rink.

**Play it:** https://hannes423-debug.github.io/ice-hockey/

## Features

- AI goalie built on real goaltending technique: angle play on the puck-to-net
  line, shuffle/T-push movement, butterfly with committed drop, RVH post seals
  on sharp angles, poke checks, rare baitable desperation dives, live rebounds
  and puck covers, goalie stamina that slows recoveries when gassed, and a hard
  rule that a goalie already blocking the shot line never moves out of the way
- Stance-gated wrist / backhand / slap / pass shots with swipe-gesture release
  (curve depth controls saucer and chip loft)
- NHL 25 style energy model: only sprint/hustle drains stamina, normal skating
  slowly regenerates, gliding recovers faster, standing still refills very fast
- Pivot / backskate, puck protect, dives
- Glass and over-the-boards puck physics
- Locked 2.5D camera: the reference picture is the ice and the boards, the 3-D
  arena hides behind it, and only the skaters, puck and goals are real geometry
  on top

## This repository

It holds **both** the published site and the source that builds it.

| At the root | The website. `index.html` is the menu, `game.html` is the game. GitHub Pages serves from here. |
|---|---|
| `game/` | The game source and the pipeline that builds it. |
| `customizer/` | The Locker Room equipment editor. Its HTML needs its three sibling `.js` files in the same folder. |
| `reference/` | The rink reference picture and the prompt used to generate it. |
| `assets/`, `legacy/`, `tools/`, `armtest/` | Models, the fork parent, and side rigs. Not tracked; they live on disk only. |

`game.html` is **generated**, not written. It is `game/ice_hockey_25d.html`,
which `make25d.py` re-derives from `game/ice_hockey.html` through 30 named
patches, dying if any one of them fails to match.

## Building

```bash
cd game
python3 measure_photo.py     # picture  -> pixel measurements
python3 fit_photo.py         #          -> camera + calibration
python3 rectify.py           #          -> the ice texture
python3 boards.py            #          -> the board texture
python3 make25d.py           # ice_hockey.html -> ice_hockey_25d.html
python3 verify_mask.py       # must print FAILURES=0
```

Every marking is drawn from `nhl_spec.py`, which cites the NHL rulebook rule
for each figure; `verify_mask.py` measures the result back out of the pixels
and fails if anything is more than 25 mm off. The picture supplies how the ice
and the boards LOOK, and nothing else. Full notes, and why it works that way,
are in `game/TWOFIVED_PROTOTYPE.md`.

## Publishing

```bash
./deploy.sh                    # what is stale? copies nothing
./deploy.sh sync               # copy, then hash-verify every file
./deploy.sh ship -m "subject"  # the above, then commit and push
```

Never copy a built file to the root by hand. Three separate times a finished
feature was reported as missing from the site when the code was fine and the
published copy was simply behind, and the failure is invisible: the stale file
is committed, so `git status` is clean and nothing says the source moved on.
`deploy.sh` hashes every published file against its source, which is the only
signal that catches it.

## Running locally

```bash
python3 -m http.server 8000
# http://localhost:8000/index.html          the site as published
# http://localhost:8000/game/ice_hockey_25d.html   the build, before publishing
```
