# The menu backdrop

`img/locker-room.jpg` is the main menu's background: the room you stand in
before a game, with the tunnel door open onto the ice.

## Where it comes from

`reference/locker_room_reference_2026-08-15.png` (1671x941, 1.9 MB) is the
original. The published file is one PIL call away from it:

```python
from PIL import Image
Image.open('reference/locker_room_reference_2026-08-15.png').convert('RGB') \
     .save('img/locker-room.jpg', 'JPEG', quality=88, optimize=True, progressive=True)
```

227 KB out of 1.9 MB, and the room is dark and soft-edged enough that 88
leaves no visible artefacts on it. Progressive because it is the first paint
of the site and a partial render of a dark room reads better than nothing.

The source PNG is tracked for the same reason the rink reference is: it is
irreplaceable, and a repo whose only copy of it sits in someone's `~/Lataukset`
cannot be rebuilt from a clone.

## What the CSS does with it

`.bg-locker` in `style.css` is four stacked layers:

| Layer | Job |
|---|---|
| `.base` | the photo, `center/cover` |
| `.grade` | one cool wash + one darkening pass, so white UI text clears the bright doorway |
| `.bg-props` | **empty on purpose** — the mount point for team and player specific set dressing |
| `.vignette` | pulls the eye to the middle of the room |

It replaced a CSS-only fake of the same room (gradient locker seams, two
painted light shafts, a floor wash). None of that survives: a real photograph
of lockers with drawn seams over the top reads as a rendering bug, not as
detail.

## The props layer, and why it is empty

`#bgProps` is where a jersey on a hook, a stick against the bench, a club
crest on the far wall, a nameplate over a stall go — the things that make the
room YOUR room and this week's opponent's room. Nothing is in it yet, on
purpose: the room ships as an empty template so the props can be added as a
data table without touching the backdrop again.

The contract, so the first prop does not have to invent one:

- Props are children of `#bgProps`, absolutely positioned in **percentages of
  the backdrop**, never pixels. The photo is `cover`, so it crops differently
  at every aspect ratio; a prop pinned in pixels drifts off its hook the
  moment the window changes shape.
- `#bgProps` is inside `.bg-locker`, which is `pointer-events:none`. Props are
  scenery, not controls. Anything clickable belongs in `.app`.
- The anchors that already exist in the photograph, as percentages of the
  image, measured off the source: the empty picture frame on the left wall is
  centred near `25% 41%`; the open doorway is `33%–55%` wide and `14%–69%`
  tall; the locker stalls on the right run from `69%` to `100%` with their
  hook rails at about `35%` height; the near bench top is the band from `68%`
  to `85%` height on the left.
- Keep props behind the `.vignette` so they get the same falloff as the room.

`script.js` has a `setLockerProps()` hook next to the stage code — today it
clears the layer and returns, which is exactly what an empty template should
do.
