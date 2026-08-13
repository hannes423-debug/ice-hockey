#!/usr/bin/env python3
"""Reference photo -> rink_mask.png, a true top-down NHL ice texture.

The picture supplies the ICE. The rulebook supplies the MARKINGS.

That split is the whole design, and it is what makes the sheet consistent. The
earlier version warped the photo's own painted markings onto the rink, and it
could never be exact, because the photo is a render that disagrees with itself:
measured under one camera its far half is longer than its near half by up to
2.14 m, its two far corners differ in radius by 1.7 m, and its centre circle
sits 0.18 m off its own centre line. Every one of those had to be absorbed by
stretching the picture, which left the markings a few centimetres out and the
circles a couple of per cent oval. And none of it could ever be made NHL
LEGAL, because the photo's rink is 44 m long against the rulebook's 61, its
circles are 3.73 m against 4.57, and it has no trapezoid at all.

So: strip the paint out of the photo, keep the ice, stretch that onto the
regulation footprint, and draw the regulation markings back on analytically.
The result is exact by construction — verify_mask.py measures it against
nhl_spec.py and the error is a fraction of a pixel — and it still looks like
the picture, because the ice, its grain, its shading and its paint colours are
all still the picture's.

Markings are drawn from signed DISTANCE FIELDS rather than rasterised, so a
2-inch line is correctly antialiased at any output resolution instead of
aliasing into a dotted mess (39 px/m here means it is 2 px wide).
"""
import json
import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.interpolate import PchipInterpolator

import nhl_spec as S


def photo_path(p):
    """Reference paths are stored relative to the project root; older ones and
    any given on the command line are absolute. Accept both."""
    q = pathlib.Path(p)
    return q if q.is_absolute() else pathlib.Path(__file__).resolve().parent.parent / q


g = json.load(open('rinkgeo.json'))
gm = g['ground_map']
CX, VH, A0, E, B, EA = gm['cx'], gm['v_h'], gm['a'], gm['e'], gm['b'], gm['ea']
L = g['loose_W_units']
PW = 12.954                      # metres per half-width in the PHOTO's fit

src = np.asarray(Image.open(photo_path(g['photo'])).convert('RGB')).astype(np.float32)
SH, SW, _ = src.shape

OW = 1024
OH = int(round(OW * S.HALF_D / S.HALF_W))
MPP = (2 * S.HALF_W) / OW        # metres per pixel
print('output %d x %d   %.1f px/m   rink %.2f x %.2f m'
      % (OW, OH, 1 / MPP, 2 * S.HALF_W, 2 * S.HALF_D))

X = ((np.arange(OW) + 0.5) / OW * 2 - 1) * S.HALF_W
Z = S.HALF_D - (np.arange(OH) + 0.5) / OH * 2 * S.HALF_D     # row 0 = +Z (far)
XX, ZZ = np.meshgrid(X, Z)


def rounded_rect(hw, hd, r):
    """Signed distance to the rink footprint: positive inside."""
    ax = np.abs(XX) - (hw - r)
    az = np.abs(ZZ) - (hd - r)
    return np.where((ax > 0) & (az > 0), r - np.hypot(ax, az),
                    np.minimum(hw - np.abs(XX), hd - np.abs(ZZ)))


# ============================================================ 1. the ice
# Strip the paint. A source pixel is usable ice only if it is inside the
# photo's own ice footprint AND is unpainted, unshadowed white; everything else
# (paint, the kickplate, the near boards' glass posts standing over the ice,
# both goals) takes the colour of the nearest pixel that is. Painted markings
# are thin and creases are small, so nearest-neighbour fill over blank white
# ice is invisible -- and it has to happen BEFORE the stretch, or the photo's
# own lines would show through underneath the regulation ones at the wrong
# place, which is exactly the doubled-marking failure this replaces.
pv, pu = np.mgrid[0:SH, 0:SW]
pk = E / (pv - VH)
pZ = (pk - 1) / B
pX = (pu - CX) * EA / (pv - VH)
CRp = 0.5 * (L['cornerR']['far'] + L['cornerR']['near'])
Dp = np.where(pZ >= 0, L['end']['far'], L['end']['near'])
tt = np.abs(pZ) - (Dp - CRp)
phw = np.where(tt <= 0, 1.0,
               1.0 - CRp + np.sqrt(np.maximum(CRp ** 2 - np.minimum(tt, CRp) ** 2, 0)))
footprint = (pv > VH + 1) & (np.abs(pX) < phw - 0.004) & (np.abs(pZ) < Dp - 0.004)

slum = src.mean(2)
ssat = src.max(2) - src.min(2)
# The upper bound and the dilation are both load-bearing. Every painted marking
# in this render carries a BRIGHT specular halo a pixel or two wide either side
# (247,240,237 against ice at 232,231,233) which passes any "is it clean white
# ice" test on its own — leaving a white ghost of every line and circle exactly
# where the marking used to be. Cut anything brighter than the ice, then grow
# the reject mask past the rest of the falloff.
good = footprint & (slum > 195) & (slum < 240) & (ssat < 16)
# and the goals: 3-D objects on the ice, whose smear is far wider than a halo
goal_box = (np.abs(pX) < 0.30) & (np.abs(pZ) > np.abs(
    np.where(pZ >= 0, L['goal']['far'], -L['goal']['near'])) - 0.02)
good &= ~goal_box
# The near boards themselves. Their white panels are 204-219 and unsaturated,
# i.e. they pass any "is this clean ice" brightness test, and they sit INSIDE
# the photo's geometric ice footprint because the footprint is where the ice
# is, not where the ice is VISIBLE — the camera is ~10 m beyond the near boards
# and the last stretch of ice is behind their top edge. Untreated they tile
# into the near corners as rows of grey panels. Cut everything below the seam:
# per column, the first dark, desaturated row under the near circles. The
# saturation guard keeps the red goal line from reading as the seam; the net's
# grey mesh is cut out and interpolated across.
nonice = (slum < 205) & (ssat < 30)
seam = np.full(SW, np.nan)
for x in range(SW):
    idx = np.where(nonice[1240:, x])[0]
    if len(idx):
        seam[x] = 1240 + idx[0]
ok = ~np.isnan(seam) & ~((np.arange(SW) >= 452) & (np.arange(SW) <= 568))
seam = np.interp(np.arange(SW), np.arange(SW)[ok], seam[ok])
good &= pv < seam[None, :]
good = ndimage.binary_erosion(good, np.ones((9, 9)))
sdist, (iy, ix) = ndimage.distance_transform_edt(~good, return_indices=True)
ice_src = src[iy, ix]
# Where the nearest clean ice is FAR away there is nothing to copy: behind the
# near goal line the photo has no ice at all (boards and glass), so the fill
# degenerates into blocky Voronoi patches of whatever shade happened to be
# closest. Those regions get synthesised instead, below.
far_src = (sdist > 4).astype(np.float32)
print('paint + obstruction stripped: %.2f%% of the photo\'s ice footprint'
      ' (%.2f%% of it too far from any clean ice to copy)'
      % (100 * (footprint & ~good).sum() / footprint.sum(),
         100 * (footprint & (sdist > 4)).sum() / footprint.sum()))

# Stretch the photo's ice onto the regulation footprint. Now that no marking
# has to land anywhere, this is just a smooth per-half rescale of Z -- the
# photo's two halves are different lengths, so they get different scales.
knots_game = np.array([S.HALF_D, S.HALF_D / 2, 0.0, -S.HALF_D / 2, -S.HALF_D])
knots_photo = np.array([L['end']['far'], L['end']['far'] / 2, 0.0,
                        -L['end']['near'] / 2, -L['end']['near']]) * PW
remap = PchipInterpolator(knots_game[::-1], knots_photo[::-1])
ZZs = remap(ZZ) / PW
print('ice stretched %.2fx (far half) / %.2fx (near half) along Z'
      % (S.HALF_D / (L['end']['far'] * PW), S.HALF_D / (L['end']['near'] * PW)))

# and clamp the sample inside the photo's own ice, so the regulation corners
# (8.53 m radius) never reach past the photo's (6.35 m) onto the boards
Dp2 = np.where(ZZs >= 0, L['end']['far'], L['end']['near'])
t2 = np.abs(ZZs) - (Dp2 - CRp)
hw2 = np.where(t2 <= 0, 1.0,
               1.0 - CRp + np.sqrt(np.maximum(CRp ** 2 - np.minimum(t2, CRp) ** 2, 0)))
XXs = np.clip(XX / S.HALF_W, -(hw2 - 0.004), hw2 - 0.004)

k = 1.0 + B * ZZs
U = CX + A0 * XXs / k
V = VH + E / k
u0 = np.clip(np.floor(U).astype(int), 0, SW - 2)
v0 = np.clip(np.floor(V).astype(int), 0, SH - 2)
fu = np.clip(U - u0, 0, 1)[..., None]
fv = np.clip(V - v0, 0, 1)[..., None]
out = (ice_src[v0, u0] * (1 - fu) * (1 - fv) + ice_src[v0, u0 + 1] * fu * (1 - fv)
       + ice_src[v0 + 1, u0] * (1 - fu) * fv + ice_src[v0 + 1, u0 + 1] * fu * fv)

# ------------------------------------------- synthesise the unrecoverable ice
# Model the ice's own slow shading as a quadratic in (X, Z) fitted to every
# pixel that IS real ice, then put the photo's fine grain back on top from a
# blank patch of the neutral zone. Fitting a constant instead reads as a
# plastic panel: this ice is a couple of per cent brighter down the middle than
# at the boards and the eye finds the seam immediately.
need = ndimage.gaussian_filter(far_src[v0, u0], 4.0)
need = np.clip((need - 0.12) / 0.30, 0, 1)
real = (need < 0.02) & (rounded_rect(S.HALF_W, S.HALF_D, S.CORNER_R) > 0.3)
bx, bz = XX[real] / S.HALF_W, ZZ[real] / S.HALF_D
basis = np.c_[np.ones_like(bx), bx, bz, bx * bx, bz * bz, bx * bz]
gx, gz = XX.ravel() / S.HALF_W, ZZ.ravel() / S.HALF_D
full = np.c_[np.ones_like(gx), gx, gz, gx * gx, gz * gz, gx * gz]
base = np.empty_like(out)
for ch in range(3):
    coef, *_ = np.linalg.lstsq(basis, out[..., ch][real], rcond=None)
    base[..., ch] = (full @ coef).reshape(OH, OW)


def row_of(z):
    return int(round((S.HALF_D - z) / (2 * S.HALF_D) * OH))


def col_of(x):
    return int(round((x + S.HALF_W) / (2 * S.HALF_W) * OW))


# Take the grain patch by GEOMETRY, off to one side of the neutral zone. A
# patch picked as a fraction of the image straddles the centre line and tiles a
# ghost of it across everything the fill touches.
patch = out[row_of(S.NZ_Z * 0.8):row_of(0.6 * S.CENTRE_R),
            col_of(-S.HALF_W * 0.88):col_of(-S.CENTRE_R - 1.2)]
assert patch.shape[0] > 32 and patch.shape[1] > 32, 'grain patch too small'
grain = patch - patch.mean(axis=(0, 1))
grain = np.concatenate([grain, grain[:, ::-1]], axis=1)      # mirror-tile, or a
grain = np.concatenate([grain, grain[::-1]], axis=0)         # seam shows per tile
grain = np.tile(grain, (OH // grain.shape[0] + 1, OW // grain.shape[1] + 1, 1))[:OH, :OW]
out = out * (1 - need[..., None]) + np.clip(base + grain, 0, 255) * need[..., None]
print('ice synthesised over %.1f%% of the sheet (fitted to %d real pixels)'
      % (100 * (need > 0.5).mean(), real.sum()))

# ==================================================== 2. the markings
# Signed distance fields, in metres, composited in painter's order.
AA = MPP * 0.8                   # antialias width: a little under one pixel


def paint(dist, half_width, colour, alpha=1.0, clip=None):
    """Lay `colour` where |dist| < half_width, antialiased over one pixel."""
    cov = np.clip((half_width - np.abs(dist)) / AA + 0.5, 0, 1) * alpha
    if clip is not None:
        cov = cov * clip
    global out
    out = out * (1 - cov[..., None]) + np.array(colour, np.float32) * cov[..., None]


def fill(dist, colour, alpha=1.0, clip=None):
    """Lay `colour` where dist > 0."""
    cov = np.clip(dist / AA + 0.5, 0, 1) * alpha
    if clip is not None:
        cov = cov * clip
    global out
    out = out * (1 - cov[..., None]) + np.array(colour, np.float32) * cov[..., None]


def seg_dist(x0, z0, x1, z1):
    """Distance to the segment (x0,z0)-(x1,z1)."""
    dx, dz = x1 - x0, z1 - z0
    ll = dx * dx + dz * dz
    t = np.clip(((XX - x0) * dx + (ZZ - z0) * dz) / ll, 0, 1) if ll else 0
    return np.hypot(XX - (x0 + t * dx), ZZ - (z0 + t * dz))


inside = rounded_rect(S.HALF_W, S.HALF_D, S.CORNER_R)
on_ice = np.clip(inside / AA + 0.5, 0, 1)

# --- goal lines and blue lines: full width, so clipped by the footprint
for sz in (+1, -1):
    paint(ZZ - sz * S.GOAL_Z, S.W_THIN / 2, S.RED, clip=on_ice)
    paint(ZZ - sz * S.BLUE_Z, S.W_WIDE / 2, S.BLUE, clip=on_ice)

# --- centre line
if S.CENTRE_LINE_DASHED:
    period = S.DASH_ON + S.DASH_OFF
    phase = np.abs(np.mod(XX + period / 2, period) - period / 2)
    dash = np.clip((S.DASH_ON / 2 - phase) / AA + 0.5, 0, 1)
    # the picture keeps solid rails top and bottom with the dashes between
    rail = S.W_WIDE / 2 - S.W_WIDE * 0.22
    band = np.clip((S.W_WIDE / 2 - np.abs(ZZ)) / AA + 0.5, 0, 1)
    core = np.clip((rail - np.abs(ZZ)) / AA + 0.5, 0, 1)
    cov = band * np.maximum(1 - core, dash) * on_ice
    out = out * (1 - cov[..., None]) + np.array(S.RED, np.float32) * cov[..., None]
else:
    paint(ZZ, S.W_WIDE / 2, S.RED, clip=on_ice)

# --- the trapezoid (1.8), drawn before the creases so the crease sits on top
if S.TRAPEZOID:
    for sz in (+1, -1):
        for sx in (+1, -1):
            paint(seg_dist(sx * S.TRAP_X_GOAL, sz * S.GOAL_Z,
                           sx * S.TRAP_X_BOARD, sz * S.HALF_D),
                  S.W_THIN / 2, S.RED, clip=on_ice)

# --- creases (1.7): straight sides out to the arc, then the arc over the top
for sz in (+1, -1):
    zg = sz * S.GOAL_Z
    r = np.hypot(XX, ZZ - zg)
    # INWARD, toward centre ice: the crease is the goalkeeper's area in FRONT
    # of the goal line, not the space behind it where the net and the
    # trapezoid live.
    inward = -sz * (ZZ - zg)
    body = (inward >= 0) & (r <= S.CREASE_R) & (np.abs(XX) <= S.CREASE_HALF_W)
    d_body = np.where(body, np.minimum(np.minimum(S.CREASE_HALF_W - np.abs(XX),
                                                  S.CREASE_R - r), inward), -1.0)
    fill(d_body, S.CREASE_FILL, S.CREASE_FILL_ALPHA)
    # outline: the two straight sides, then the arc between them
    for sx in (+1, -1):
        paint(seg_dist(sx * S.CREASE_HALF_W, zg,
                       sx * S.CREASE_HALF_W, zg - sz * S.CREASE_STRAIGHT),
              S.W_THIN / 2, S.RED)
    arc = np.abs(r - S.CREASE_R)
    arc = np.where((inward >= S.CREASE_STRAIGHT - S.W_THIN) &
                   (np.abs(XX) <= S.CREASE_HALF_W + S.W_THIN), arc, 9.0)
    paint(arc, S.W_THIN / 2, S.RED)

# --- circles
paint(np.hypot(XX, ZZ) - S.CENTRE_R, S.W_THIN / 2, S.BLUE)
for sx in (+1, -1):
    for sz in (+1, -1):
        cx, cz = sx * S.FO_X, sz * S.FO_Z
        r = np.hypot(XX - cx, ZZ - cz)
        paint(r - S.END_R, S.W_THIN / 2, S.RED)
        # hash marks (1.5): 2 ft long, 2 in wide, 3 ft apart, off both sides
        for hx in (+1, -1):
            for hz in (+1, -1):
                z = cz + hz * S.HASH_GAP / 2
                paint(seg_dist(cx + hx * S.END_R, z,
                               cx + hx * (S.END_R + S.HASH_LEN), z),
                      S.W_THIN / 2, S.RED)
        # the four L marks inside the circle
        for lx in (+1, -1):
            for lz in (+1, -1):
                paint(seg_dist(cx + lx * S.L_INNER_X, cz + lz * S.L_INNER_Z,
                               cx + lx * (S.L_INNER_X + S.L_ARM_X), cz + lz * S.L_INNER_Z),
                      S.W_THIN / 2, S.RED)
                paint(seg_dist(cx + lx * S.L_OUTER_X, cz + lz * S.L_INNER_Z,
                               cx + lx * S.L_OUTER_X, cz + lz * (S.L_INNER_Z + S.L_ARM_Z)),
                      S.W_THIN / 2, S.RED)

# --- spots
fill(S.CENTRE_SPOT_R - np.hypot(XX, ZZ), S.BLUE)
for sx in (+1, -1):
    for sz in (+1, -1):
        fill(S.SPOT_R - np.hypot(XX - sx * S.FO_X, ZZ - sz * S.FO_Z), S.RED)
        fill(S.SPOT_R - np.hypot(XX - sx * S.NZ_X, ZZ - sz * S.NZ_Z), S.RED)

# ============================================== 3. footprint and the void
# The build's ice floor is a full RECTANGLE, so its corners stick out white
# past the rounded boards. The mask covers the same rectangle, so rather than
# leaving those corners transparent, paint them the scene's own void colour and
# keep alpha at 1 -- the sheet then ends exactly at the boards, as in the
# picture, with no second floor showing through behind them.
VOID = np.array([10, 20, 32], np.float32)
A = np.clip(inside / 0.16, 0, 1)
out = out * A[..., None] + VOID * (1 - A[..., None])

Image.fromarray(np.dstack([np.clip(out, 0, 255),
                           np.full_like(A, 255)]).astype(np.uint8), 'RGBA').save('rink_mask.png')
print('wrote rink_mask.png')
