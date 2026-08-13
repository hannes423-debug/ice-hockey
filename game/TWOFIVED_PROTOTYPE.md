# 2.5D prototype — `ice_hockey_25d.html`

A separate build: the reference picture drawn as TEXTURES on the ice and on a
board ring, with the 3-D arena hidden behind them, a regulation NHL rink
underneath, and possession that only breaks on contact.

**It is generated, never edited.** `ice_hockey_25d.html` is derived from
`ice_hockey.html` every time:

```bash
cd ~/Työpöytä/hoki/game
python3 measure_photo.py   # photo -> photo_measurements.json   (only after a new photo)
python3 fit_photo.py       # -> rinkgeo.json + rink_calibration.json
python3 rectify.py         # -> rink_mask.png       (the regulation sheet)
python3 boards.py          # -> rink_boards.png     (the board ring strip)
python3 make25d.py         # ice_hockey.html -> ice_hockey_25d.html
python3 verify_mask.py     # acceptance: markings vs the rulebook
python3 -m http.server 8000     # http://localhost:8000/ice_hockey_25d.html
```

`make25d.py` applies 30 named patches and **dies if any one of them fails to
match exactly once** — a half-applied build reads exactly like a broken
feature. Edit `ih25_pre.js` / `ih25_post.js` / `make25d.py`, never the output.

| File | Role |
|------|------|
| `make25d.py` | the patch list + injector |
| `ih25_pre.js` | loaded BEFORE the game: the contact rule (`IH25.contested`) |
| `ih25_post.js` | loaded AFTER: mask, locked camera, puck collision, HUD |
| `measure_photo.py` | photo → pixel measurements of every marking |
| `nhl_spec.py` | **the regulation rink — every dimension and marking** |
| `fit_photo.py` | the camera solve, and what the photo says about itself |
| `rectify.py` | photo → top-down `rink_mask.png` |
| `boards.py` | → `rink_boards.png`, the board ring strip |
| `rink_calibration.json` | the fitted numbers the game reads |
| `overlay_check.py` | draws the fitted rink back onto the photo |
| `verify_mask.py` | measures the MASK's markings against the rulebook |
| `ih25_shot.sh` | screenshots the locked view (`OVERLAY=1` for the line check) |
| `ih25_probe.sh` | runs one acceptance probe |
| `ih25_contact_probe.js`, `ih25_collide_probe.js`, `ih25_aim_probe.js` | the acceptance tests |

Controls: **wheel** = zoom (angle never changes), **M** = mask 100/50/0 %.

## The picture hides the geometry, as a texture on it

The picture is **not a texture in the ordinary sense and not a poster either**.
It is the thing you see; the 3-D arena underneath is never drawn. It stays
exactly where it is and keeps doing collision, scoring and every zone test.

That was built once as a screen-locked backdrop, a single image parented to the
camera with the arena hidden behind it, and it was wrong for one decisive
reason: **a poster is only true from one camera.** It had to be dropped the
moment you zoomed, so the picture vanished exactly when you leaned in to look
at it. A texture is true from every camera. Two of them do the whole job:

| | what it is |
|---|---|
| the ice | `rink_mask.png` on the ice plane |
| the boards and glass | `rink_boards.png` on a ring of quads standing on the rink outline |

The arena is hidden **once**, at wire time, and stays hidden. Doing it exactly
rather than by heuristic matters: `buildRoom()` adds all 103 of its meshes
straight onto `scene` with no group and no names, so `make25d.py` patches the
one call site to `IH25.tagArena(buildRoom)`, which swaps `scene.add` for the
duration and tags everything it makes. Guessing at the arena by size or height
is the kind of heuristic that quietly starts hiding a player.

### The boards are generated, not carried across

Carrying the photo's boards over by warping them in IMAGE space is what
deformed them: a distance-transform warp smears, and it was smearing a 42 m
rink onto a 61 m one.

Unwrapping them properly was tried next and abandoned for a measured reason.
Rectifying the board band through the photo's own camera works, but the render
disagrees with itself about vertical scale so badly that the blue cap, tracked
all the way round, lands anywhere between **0.53 m and 2.78 m** above the ice, a
5.3x spread. No calibration fixes that, because there is no consistent rink
there to calibrate to.

So the boards get exactly the treatment the ice markings got: **the picture
supplies the palette and the proportions, the spec supplies the geometry.**
Sampled off the far boards, which are the ones seen face-on:

```
kickplate (180,123,  6)     dasher (213,213,217)
cap       ( 52,113,182)     glass  ( 96, 95, 93)     panel pitch 1.49 m
```

Take the *purest* pixel in each band, not its mean. These bands are two or three
pixels tall, so averaging mixes in the antialiased edge against the white dasher
either side and the cap comes out (120,146,178), a washed-out grey-blue, when
the paint is (13,74,137). The panel pitch is by autocorrelation, not by counting
dark columns: the render's posts are irregular enough that peak-finding returned
a 15 px mean with a 7 px spread, which is noise, not a pitch.

The strip is RGBA and the glass is genuinely translucent, so the arena behind it
shows through the way it does in the picture.

### Two things that will bite

- **Row 0 of the strip is the GLASS TOP**, and `flipY` is off, so the ice vertex
  takes `v = 1` and the top vertex `v = 0`. Getting this the natural way round
  hangs the kickplate in the sky.
- **`setArenaVisible` is called every frame** from the render wrapper, so it
  early-outs on no change. Without that it is a full scene traverse per frame.

## The picture supplies the ICE; the rulebook supplies the MARKINGS

That split is the whole design and it is what makes the sheet consistent.

`~/Lataukset/ChatGPT Image 12.8.2026 klo 17.19.38.png` (1023×1538) is a render,
and it disagrees with itself. Measured under one fitted camera:

| | far | near | spread |
|---|---|---|---|
| end boards from centre | 23.213 | 21.222 | **1.99 m** |
| goal line from centre | 20.397 | 18.639 | **1.76 m** |
| faceoff row from centre | 15.148 | 13.006 | **2.14 m** |
| blue line from centre | 6.786 | 6.743 | 0.04 m |
| neutral dots from centre | 5.081 | 5.021 | 0.06 m |

Its two far corners differ in radius by 1.7 m (6.84 vs 5.16) while its two near
corners agree to 2 cm. Its centre circle sits 0.18 m off its own centre line.
**No rigid rink under any single camera can sit on all of that at once.**

An earlier version warped the photo's own painted markings onto the rink, and
it could never be exact — every disagreement above had to be absorbed by
stretching the picture, which left markings a few centimetres out and circles a
couple of per cent oval. And none of it could ever be made NHL LEGAL: the
photo's rink is 44.4 m long against the rulebook's 61, its faceoff circles are
3.73 m against 4.57, its goal mouth 2.02 m against 1.83, and it has no
trapezoid at all.

So the paint is stripped out of the photo, the ICE is kept and stretched onto
the regulation footprint, and the regulation markings are drawn back on
analytically from `nhl_spec.py`. Exact by construction, and it still looks like
the picture: the ice, its grain, its shading and its paint colours are all
still the picture's.

### What is regulation and what is not

`nhl_spec.py` is the single source of truth and cites the rule for each figure.
Three things in it are NOT straight out of the rulebook, and they are marked
there:

- **The trapezoid is in because the rules say so, not because the picture does**
  (1.8, 22 ft at the goal line, 28 ft at the end boards). The reference picture
  has no trapezoid. `TRAPEZOID = False` matches the picture instead.
- **The centre line keeps the picture's white dashes.** The rulebook (1.4) says
  only "a red line, twelve inches in width" and does not forbid them.
  `CENTRE_LINE_DASHED = False` for solid.
- **The four L-shaped alignment marks inside each end-zone circle come from the
  picture**, scaled by the ratio of the regulation circle to the photo's, so
  they keep the same relationship to the circle they have in the picture. This
  is the one figure I could not pin down in the rulebook. Everything else — the
  hash marks (1.5: 2 ft long, 2 in wide, 3 ft apart at the outer edge of both
  sides), the spots, the circles, the lines and their widths, the crease shape
  — is the rule. The hash marks\' ORIENTATION is the picture\'s: they run
  across the rink off the circle\'s left and right.

### Acceptance

`verify_mask.py` measures the mask's own pixels against `nhl_spec.py` — never
against the photo it came from, which would be re-measuring the pipeline with
itself and would score perfectly no matter what was wrong.

```
goal lines            27.1271 m   vs   27.1272    -0.1 mm
blue lines             7.6168 m   vs    7.6200    -3.2 mm
centre line            0.0000 m   vs    0.0000    +0.0 mm
blue line width        0.3056 m   vs    0.3048    +0.8 mm
goal line width        0.0552 m   vs    0.0508    +4.4 mm
8 red spots, worst                                +0.9 mm
all five circles       4.5724 m   vs    4.5720    +0.4 mm,
                                        centre off <= 0.3 mm, out-of-round <= 8.8 mm
FAILURES=0
```

Two of those checks had to be fixed before they meant anything. Counting rows
over a threshold cannot resolve better than one pixel, and one pixel here is
25 mm — so a perfectly drawn 51 mm goal line measured 76 mm and "failed" by
exactly the measurement's own resolution; it now integrates the darkening
across the line instead. And the spot check paired every spot with the wrong
one, because the two spots in a row differ by a hundredth of a millimetre in Z
and a plain `(-z, x)` sort interleaves them.

### Stripping the paint out of the photo

Three things bite, in order of how much time they cost:

- **Every marking carries a bright specular halo** a pixel or two wide either
  side — (247,240,237) against ice at (232,231,233). It passes any "is this
  clean white ice" test on its own, so a naive strip leaves a **white ghost of
  every line and circle** exactly where the marking used to be. Cut anything
  brighter than the ice, then erode the keep-mask past the rest of the falloff.
- **The near boards' white panels are 204-219 and unsaturated**, i.e. they also
  pass, and they sit INSIDE the photo's geometric ice footprint because the
  footprint is where the ice IS, not where it is VISIBLE — the camera is ~10 m
  beyond the near boards and the last stretch of ice is behind their top edge.
  Untreated they tile into the near corners as rows of grey panels. Cut
  everything below the seam (per column, the first dark desaturated row under
  the near circles).
- **Where the nearest clean ice is far away there is nothing to copy** and the
  fill degenerates into blocky Voronoi patches. Those regions (19 % of the
  sheet) are synthesised: a quadratic shading model fitted to the ice that IS
  real, plus the photo's own grain from a blank patch. Fit a *constant* and it
  reads as a plastic panel — this ice is a couple of per cent brighter down the
  middle than at the boards and the eye finds the seam immediately. Take the
  grain patch by GEOMETRY, not as a fraction of the image: a patch centred on
  the output's middle row straddles the centre line and tiles a ghost of it
  across everything the fill touches.

Markings are drawn from signed **distance fields**, not rasterised, so a 2-inch
line is correctly antialiased at 39 px/m (where it is 2 px wide) instead of
aliasing into a dotted mess.

## The camera

The photo still sets the camera. Solving it needs care, because the ground
plane alone does not determine it — for a camera on the rink's symmetry axis
with no roll, a whole one-parameter family of (focal length, pitch, height)
reproduces the ground image *identically*. The old `fit3.py` (now in
`backups/`) threw 22 parameters at one least squares and returned an arbitrary
member of that family; its "pitch 65.6°, ~112 m out" was never a measurement.
For this photo, 45°, 60° and 78° all draw the same ice.

`fit_photo.py` takes the constraints in order of how well the photo supports
them:

1. **Boards.** The side boards are straight 3-D lines, so their images are
   straight — they fit to **0.49 px rms** over 1736 edge samples. Where the two
   meet is the ground vanishing point (v = −2342); their slope is
   h/cos(pitch) = 7.67 half-widths; their separation at the centre line is the
   lateral scale.
2. **Circles.** The one remaining number is the Z scale, and the only thing
   that ties Z to X is that the five painted circles must come back CIRCULAR
   when unprojected. One unknown against five constraints; they land
   **0.5–1.6 % out of round**.
3. **Pitch.** Fixing the principal point at the image centre (it is a render)
   collapses the family and hands back focal length, pitch, height, distance.

```
pitch 58.565°   vFOV 44.020°   hFOV 30.089°
```

The rink is now 61 m long instead of the photo's 44.4, so the rig moves back by
that ratio — 61.37 m as photographed, **84.19 m** in the build — which frames
the longer sheet at the same angular size. The angle and the lens are the
picture's; only the distance is not.

The picture is portrait and a game window is not, so expect empty margins left
and right rather than a crop: a 61 × 26 m sheet at 58.6° projects about 1:2, so
filling the height of a 16:9 window uses about a quarter of its width. The
wheel zooms in for play.

### Gotcha: the mask was being rendered 15 % dark

`buildMask` declared the texture sRGB. This build is three **r128** with a
default `WebGLRenderer`, i.e. `outputEncoding = LinearEncoding` — no colour
management at all. Marking the texture sRGB decodes it to linear and nothing
ever encodes it back, so the whole sheet rendered dark and the mask's own void
corners came out **(1,2,4) against a (10,20,32) background**: a black gash
around the rink that reads like a geometry bug and is a gamma bug. Every other
material in the build is a raw hex colour that passes through untouched, so
passing the photo through untouched is also what MATCHES. The texture is now
declared sRGB only if the renderer actually re-encodes on output.

### Gotcha: the fog was tuned for a 14 m chase camera

`scene.fog` is `Fog(0x0a1420, 45, 110)`, so on the first run of the old rig the
**entire sheet rendered as flat dark blue** — which reads exactly like a broken
build, not like a fog range. `ih25_post.js` scales `fog.near/far` and
`camera.far` off the rig's own distance every frame.

The build's own painted lines are **hidden** (`hidePaintedMarkings`, 1 Hz
sweep) because the mask carries the regulation set. The positions still exist
in `CONFIG` and still drive gameplay — they just are not drawn. `puck.shadow`
sits in the same y-band and is explicitly spared. `OVERLAY=1 ./ih25_shot.sh`
puts them back over a half-strength mask.

## The goals

Three separate things were wrong with the nets from a top-down camera, and only
the second was the one first reported.

1. **There is no near goal at all outside a match.** `buildGoalB()` is called
   only from `startMatch()`, so in free skate the −Z end has a crease and
   nothing standing on it. What looked like a faint near net in the older build
   was the reference photo's own PAINTED net in the mask, not geometry. A
   locked camera that shows the whole sheet has to have both, so `ih25_post.js`
   builds it. Scoring at goal B stays gated on `GAME.mode === 'match'` and this
   build's puck-vs-post collision was already two-ended, so this changes what
   you SEE, not what scores.
2. **The net planes are white `0xe8f4ff` at 0.22 opacity.** Against the dark
   background beyond the FAR boards that reads as a net; against the bright
   white ice behind the NEAR one it is invisible. Darkened to `0x8fa8c4` at
   0.5.
3. **Neither goal has a top panel.** Looking down, you were looking through the
   open top of the goal at the ice underneath. A net seen from above is mostly
   its roof, so the roof has to exist — plus a darkened pocket, because the roof
   alone still lets ice through and the goal reads as a smudge rather than a
   hole.

The net is also **40 in deep** now (1.6) instead of the build's 0.55 m, which is
46 % short — and from above, depth is most of what you see of a goal.

## The fitted rink

```
rink        25.91 x 60.96 m      corner R 8.5344
blue ±7.62    goal line ±27.1272    lines 12 in / 2 in
faceoff     ±6.7056 X, ±21.0312 Z, R 4.572    centre circle R 4.572
neutral dots ±6.7056 X, ±6.096 Z    spots 2 ft, centre spot 12 in
crease      6 ft radius, 8 ft wide, straight sides 4.472 ft
goal        6 x 4 ft, 40 in deep    trapezoid 22 ft -> 28 ft
```

## The old camera rig is retired (and why aim was broken)

First playable build had two reported faults with **one cause**: the rig was
applied in a `renderer.render` wrapper, i.e. at the END of the frame, while
the build's chase camera still wrote `camera` mid-frame.

- **"aim and puck jump to a completely different place."** The aim ray is
  unprojected mid-frame by `setFromCamera(ndc, camera)`, and `camYaw` sets the
  aim's UV frame. So the shot was aimed through the chase camera — and
  `camYaw` was still the player's heading, so the input frame was rotated
  against the screen too.
- **"purple bar moving randomly around the ice."** That is the goalie stamina
  bar (`gStamWrap`), DOM anchored by `projectToScreen()` through the same stale
  camera. Now hidden — it is a chase-cam HUD, unreadable from this height.

Fixed by setting the camera **once, on the first line of `tick()`**, and
retiring everything that fought it: the chase rig, the `,`/`.` orbit,
`faceAimNow`, first-person, and the boot yaw. `camYaw` is pinned to 0 so the
input/aim frame matches the screen.

Measured after: `camGap_rayVsRender_m` **0.0000** over 80 aim raycasts
(`ih25_aim_probe.js`), `camYaw` 0.

Note: there is **no camera shake anywhere in this build** — nothing to remove.

A first attempt at this probe compared the on-screen direction of
`player.stickTip` against the cursor and reported 114° of error — but the
UNFIXED original scored the same, because `stickTip` is clamped to the reach
envelope and was never a proxy for the aim. Measure the camera, not the blade.

## Possession only breaks on contact

`updatePuck`'s two break conditions are now gated on `IH25.contested()`:
an opponent's blade within 0.62 m of the puck, an opponent's body within
1.35 m of the carrier, or a bump inside the last 0.35 s. Uncontested, control
is floored just above `ctrlMin`, so a hard carve still loosens the carry (the
puck lags and swings wide) but cannot hand it over.

Every scripted strip already in the build (goalie poke, bot poke, AI steal,
the player's own jab/sweep) sets `possessed=false` directly and is unaffected
— those *are* contact.

### Acceptance — measured against the UNFIXED build

A first attempt at this probe carved hard at speed and reported "0 losses" —
but the original scored 0 losses too (control only fell to 0.625), so it never
reached either break condition and proved nothing. The probe now drives the
conditions directly.

| | original | 25d, alone | 25d, opponent on you |
|---|---|---|---|
| puck 2.5 m off the blade | lost | **held** | lost |
| control pinned to 0 | lost | **held** (floored 0.120) | lost |

## Puck indicator

At this range the puck is a couple of pixels of dark grey on white ice.
`ih25_post.js` draws a presentation-only marker at its ground point — the puck
mesh keeps its true 0.11 m radius, so the sim stays honest about how big the
puck is.

- **token** dark disc + bright gold rim, ~4x the puck's radius. This is the
  bit that is actually legible; it reads as a puck rather than a blob.
- **ring + halo** gold annulus and a soft pool, dark at the rim so it separates
  from white ice.
- **loose vs carried** loose runs bright and pulses; carried sits calm and
  dimmer, so "where is the loose puck" is answerable at a glance.
- **altitude ring** expands with air height.

Two things that had to be corrected by eye, not by reasoning:

1. The first glow filled its centre at 0.95 alpha and **the puck vanished
   inside its own indicator**. The gradient is now a donut with a clear centre.
2. The first height cue was a vertical beacon, which at this pitch foreshortens
   to a couple of pixels — an airborne puck looked identical to one on the ice.
   Replaced with the expanding ring, which reads from above.

The marker scales with rig distance so it holds a roughly constant screen size
instead of swamping the skater when zoomed in.

## The puck's own collision

**Skater bodies** (0.34 m cylinder, restitution 0.35, resolved against the
skater's own velocity). Verified against the original, which passes straight
through:

| | original | 25d |
|---|---|---|
| closest approach to a skater | 0.063 m, **passed through** | **0.450 m**, bounced (vz +14 → −4.1) |

Goal posts were **already** solid in the base build (0.160 m, vz +10 → −6.8 in
both) — the post code in `ih25_post.js` is belt-and-braces, not the fix.
