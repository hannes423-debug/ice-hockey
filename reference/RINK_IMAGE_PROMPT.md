# Prompt for a usable rink reference image

## What the image is actually for

It is a **backdrop**, not a texture. The build locks the camera, draws this one
picture in front of everything, and hides the 3D arena behind it. Only the
skaters, the puck and the goals are real geometry on top. Classic pre-rendered
background, smoke and mirrors.

That changes what matters about the picture, completely:

- **The boards are the payload.** The ice can be regenerated. Dasher boards,
  glass, kickplate, the arena floor around the rink: those only ever come from
  the picture, and they are the reason it is worth having one.
- **It must be one consistent camera.** The build fits a camera to the picture
  and re-projects it. It cannot fit a camera that does not exist. The current
  reference has a far half 2.1 m longer than its near half, which is not any
  real camera looking at any real rink.
- **Exact rink dimensions do not matter much.** The build re-projects onto the
  regulation footprint, so being off by a few feet is absorbed. Being
  asymmetric is not.
- **Nothing may overhang the ice.** In the current reference the near boards
  and their glass posts are drawn over the last 1.5 m of the ice, because the
  camera sits below the height where the near ice line clears the boards. That
  ice is unrecoverable.

## The prompt

> A photorealistic empty ice hockey rink in an arena, photographed from high
> above and behind one end, looking down at a steep angle of about 59 degrees
> below horizontal, with the entire rink and all of its boards inside the
> frame. Portrait orientation. The camera is exactly on the rink's long
> centreline and exactly level, with no roll and no tilt-shift, so the left and
> right halves of the picture are mirror images of each other. A normal lens,
> no fisheye, no wide-angle distortion, no perspective exaggeration. One single
> consistent camera: the near end and the far end of the rink must be drawn as
> the same rink seen from one place, perfectly symmetric front to back about
> the centre line.
>
> Regulation NHL proportions: 200 feet long by 85 feet wide, so 2.35 times as
> long as it is wide, with 28 foot rounded corners. Full standard markings, all
> symmetric: two blue lines 12 inches wide a quarter of the rink's length
> either side of centre, a red centre line 12 inches wide with a blue centre
> spot and a blue centre circle, two thin red goal lines near each end, four
> red end zone faceoff circles with their spots and hash marks, four red
> neutral zone faceoff spots, two light blue goal creases with red outlines,
> and the red trapezoid behind each goal line.
>
> White dasher boards all the way round with a blue top cap and a yellow
> kickplate strip at ice level, and clear glass above them with thin dark
> posts. The camera is high enough that the boards nearest the camera do not
> hide any of the ice behind them: the ice must be visible right up to the
> kickplate at both ends and down both sides, with no board, glass, post or
> reflection overlapping the ice surface anywhere. Plain dark grey arena floor
> visible around the outside of the boards.
>
> No goals, no nets, no players, no officials, no benches, no logos, no
> advertising, no scoreboard.
>
> Even flat lighting across the whole sheet. No glare, no bloom, no lens flare,
> no vignette, no shadows cast across the ice, and above all no bright specular
> sheen or highlight along the edges of the painted lines. Matte white ice with
> a fine realistic surface texture. Sharp focus everywhere, no depth of field,
> no motion blur.

## What to do with it

Drop it in `~/Lataukset/`, point `measure_photo.py` at it, then run the chain
in `game/TWOFIVED_PROTOTYPE.md`:

```
measure_photo.py -> fit_photo.py -> rectify.py -> backdrop.py -> make25d.py
```

and check both acceptance tests still pass:

```
python3 verify_mask.py        # markings vs the rulebook, expects FAILURES=0
python3 verify_backdrop.py    # backdrop vs the 3D world, expects FAILURES=0
```

`fit_photo.py` fits the camera from the straight board lines plus the painted
circles being circular, so **keep the markings in**: a blank sheet of ice has
nothing to fit a camera to. That is why this prompt asks for a fully marked
rink even though the build redraws every marking itself.

## What will still be wrong, and why that is now fine

An image model draws what a rink looks like, not what it measures. Expect the
next one to be off on dimensions too. Measured off the current reference:

| | drawn | should be |
|---|---|---|
| rink | 145 x 85 ft | 200 x 85 ft |
| far half vs near half | differ by up to 7 ft | identical |
| the two far corners | radii 22.4 ft and 16.9 ft | both 28 ft |
| faceoff circles | 12.2 ft radius | 15 ft |
| crease | 4.5 ft radius, no straight sides | 6 ft radius, 8 ft wide |
| trapezoid | absent | required |

None of that matters any more. The build measures the picture, throws away its
geometry, and keeps its ice and its boards. What it cannot work around is a
picture that is not a single camera, or boards that cover the ice. Those two
lines in the prompt are the ones worth checking the result against.
