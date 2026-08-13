#!/usr/bin/env python3
"""The NHL rink, in metres. One source of truth for geometry AND markings.

Everything here is the NHL rulebook figure, converted from feet, EXCEPT the
three items marked FROM THE PHOTO at the bottom — details the reference
picture shows but the rulebook figure for which I could not pin down. Those
are called out so they are easy to correct in one place.

Rule references are NHL Official Rules, Section 1 (Rink).
"""

FT = 0.3048
IN = 0.0254

# ---------------------------------------------------------------- the surface
HALF_W = 85 * FT / 2          # 1.2  200 x 85 ft
HALF_D = 200 * FT / 2
CORNER_R = 28 * FT            # 1.2  corner radius

# ------------------------------------------------------------------ the lines
GOAL_Z = HALF_D - 11 * FT     # 1.5  goal line 11 ft from the end boards
BLUE_Z = 25 * FT              # 1.3  neutral zone 50 ft long
W_WIDE = 12 * IN              # 1.3/1.4  blue lines and the centre line
W_THIN = 2 * IN               # 1.4/1.5  goal lines, circles, hash, crease

# ---------------------------------------------------- circles, spots, marks
CENTRE_R = 15 * FT            # 1.5
CENTRE_SPOT_R = 12 * IN / 2   # 1.5  12 in diameter, blue
END_R = 15 * FT               # 1.5
SPOT_R = 2 * FT / 2           # 1.5  2 ft diameter, red
FO_X = 22 * FT                # 1.5  end-zone spots 22 ft off the centreline
FO_Z = GOAL_Z - 20 * FT       # 1.5  and 20 ft out from the goal line
NZ_X = 22 * FT                # 1.5  neutral-zone spots
NZ_Z = BLUE_Z - 5 * FT        # 1.5  5 ft from the blue line
HASH_LEN = 2 * FT             # 1.5  two lines, 2 ft long, 2 in wide,
HASH_GAP = 3 * FT             # 1.5  3 ft apart, at the outer edge of the circle

# ------------------------------------------------------------------ the crease
# 1.7  Lines one foot outside each post (posts at +/-3 ft, so +/-4 ft), at right
# angles to the goal line; a 6 ft radius semicircle from the goal line's centre.
# The straight sides run out to where they meet that arc.
CREASE_R = 6 * FT
CREASE_HALF_W = 4 * FT
CREASE_STRAIGHT = (CREASE_R ** 2 - CREASE_HALF_W ** 2) ** 0.5   # 1.363 m

# ------------------------------------------------------------------- the goal
GOAL_HALF_W = 6 * FT / 2      # 1.6  6 ft wide inside the posts
GOAL_HEIGHT = 4 * FT          # 1.6  4 ft high
GOAL_DEPTH = 40 * IN          # 1.6  frame depth at the base
POST_R = 2.375 * IN / 2       # 1.6  posts 2 3/8 in in diameter

# --------------------------------------------------------------- the trapezoid
# 1.8  Goalkeeper's restricted area: 22 ft wide at the goal line, 28 ft at the
# end boards. Present on every NHL sheet; the reference picture does not show
# one, so this is the one marking that is in the build because the RULES say so
# rather than because the picture does. Set False to match the picture instead.
TRAPEZOID = True
TRAP_X_GOAL = 22 * FT / 2
TRAP_X_BOARD = 28 * FT / 2

# ------------------------------------------------------------------ the paint
# Sampled from the reference photo's own paint (the darkest sixth of each
# marking's pixels, so antialiased edges do not wash the reading out), so the
# rink keeps the picture's colour even though it no longer keeps its geometry.
RED = (178, 70, 66)
BLUE = (42, 96, 164)
CREASE_FILL = (108, 168, 214)
CREASE_FILL_ALPHA = 0.62

# The picture's centre line is broken by white dashes. The rulebook says only
# "a red line, twelve inches in width" -- it does not forbid the dashes and
# they are common, so the picture's styling is kept. Set False for solid.
CENTRE_LINE_DASHED = True
DASH_ON = 0.62                # metres of red
DASH_OFF = 0.30               # metres of white

# ------------------------------------------------------------ FROM THE PHOTO
# The four L-shaped alignment marks inside each end-zone circle. Measured off
# the reference photo's near-left circle (the best-resolved of the four) and
# scaled by END_R / (the photo's own circle radius), so they keep the same
# relationship to the circle they have in the picture. The rulebook figure for
# these is the one I could not pin down; every other number above is the rule.
L_ARM_X = 0.81                # length of the arm running across the rink
L_ARM_Z = 0.95                # length of the arm running along the rink
L_INNER_X = 0.23              # the arm across starts this far off the spot
L_OUTER_X = 1.04              # the arm along sits this far off the spot
L_INNER_Z = 0.54              # the arm across sits this far off the spot
L_SCALE_FROM_PHOTO_R = 3.730  # what those numbers were measured against

_s = END_R / L_SCALE_FROM_PHOTO_R
L_ARM_X *= _s
L_ARM_Z *= _s
L_INNER_X *= _s
L_OUTER_X *= _s
L_INNER_Z *= _s

# The hash marks outside the circle run ACROSS the rink (in X), off the circle's
# left and right, which is how the picture draws them; their length, width and
# spacing are the rulebook's.

if __name__ == '__main__':
    for k, v in sorted(globals().items()):
        if k.isupper() and isinstance(v, (int, float)):
            print('%-18s %10.4f m  (%7.3f ft)' % (k, v, v / FT))
