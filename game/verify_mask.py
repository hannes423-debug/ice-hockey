#!/usr/bin/env python3
"""Measure rink_mask.png's OWN markings and compare them to the rulebook.

This is the check that matters: if the picture and the geometry disagree, the
puck crosses a blue line that is not where it is painted.

Note what is compared against what. The mask is measured from scratch, in its
own pixels, against nhl_spec.py -- NOT against the photo it was built from,
which would just be re-measuring the pipeline with itself and would score
perfectly no matter what was wrong.
"""
import numpy as np
from PIL import Image
from scipy import ndimage

import nhl_spec as S

im = np.asarray(Image.open('rink_mask.png').convert('RGB')).astype(np.int32)
OH, OW, _ = im.shape
MM = 1000.0


def z_of_row(r):
    return S.HALF_D - (np.asarray(r, float) + 0.5) / OH * 2 * S.HALF_D


def x_of_col(c):
    return ((np.asarray(c, float) + 0.5) / OW * 2 - 1) * S.HALF_W


def r_of_Z(z):
    return int(round((S.HALF_D - z) / (2 * S.HALF_D) * OH))


def c_of_X(x):
    return int(round((x + S.HALF_W) / (2 * S.HALF_W) * OW))


Rc, Gc, Bc = im[:, :, 0], im[:, :, 1], im[:, :, 2]
red = (Rc - Gc > 45) & (np.abs(Gc - Bc) < 30) & (Rc > 100)
blu = (Bc > 100) & (Bc - Rc > 30) & (Bc - Gc > 10)

fails = []
print('%-24s %10s %10s %9s' % ('', 'mask', 'rulebook', 'error'))
print('%-24s %10s %10s %9s' % ('', 'm', 'm', 'mm'))


def band(mask, want, name, xlo, xhi, tol=25):
    r0, r1 = r_of_Z(want) - 30, r_of_Z(want) + 30
    sub = mask[r0:r1, c_of_X(xlo):c_of_X(xhi)]
    w = sub.sum(1).astype(float)
    if w.max() == 0:
        print('%-24s %10s' % (name, 'NOT FOUND'))
        fails.append(name)
        return
    keep = w >= 0.5 * w.max()
    z = z_of_row((np.arange(r0, r1)[keep] * w[keep]).sum() / w[keep].sum())
    err = (z - want) * MM
    print('%-24s %10.4f %10.4f %+9.1f%s'
          % (name, z, want, err, '' if abs(err) < tol else '   <-- FAIL'))
    if abs(err) >= tol:
        fails.append(name)


def width(mask, at, want, name, xlo, xhi, tol=25):
    """EQUIVALENT width, not a row count.

    Counting rows over a threshold cannot resolve better than one pixel, and
    one pixel here is 25 mm -- so a perfectly drawn 51 mm goal line measures
    76 mm and 'fails' by exactly the measurement's own resolution. Integrate
    how much paint is there instead: sum the darkening across the line and
    divide by the darkening at its core.
    """
    del mask
    r0, r1 = r_of_Z(at) - 30, r_of_Z(at) + 30
    strip = im[r0:r1, c_of_X(xlo):c_of_X(xhi)].mean(2).mean(1)
    bg = np.median(np.r_[strip[:8], strip[-8:]])
    dark = np.maximum(bg - strip, 0)
    got = dark.sum() / dark.max() / OH * 2 * S.HALF_D
    err = (got - want) * MM
    print('%-24s %10.4f %10.4f %+9.1f%s'
          % (name, got, want, err, '' if abs(err) < tol else '   <-- FAIL'))
    if abs(err) >= tol:
        fails.append(name)


for sz, tag in ((+1, 'far'), (-1, 'near')):
    band(red, sz * S.GOAL_Z, 'goal line ' + tag, -8, -3)
    band(blu, sz * S.BLUE_Z, 'blue line ' + tag, -8, 8)
band(red, 0.0, 'centre line', -8, -3)
width(blu, S.BLUE_Z, S.W_WIDE, 'blue line width', -8, 8)
width(red, S.GOAL_Z, S.W_THIN, 'goal line width', -8, -3)

# ------------------------------------------------------------------- the spots
lab, n = ndimage.label(red, np.ones((3, 3)))
dots = []
for i, sl in enumerate(ndimage.find_objects(lab)):
    ys, xs = sl
    h, w = ys.stop - ys.start, xs.stop - xs.start
    m = lab[sl] == i + 1
    if 12 <= w <= 40 and 12 <= h <= 40 and abs(w - h) < 8 and m.sum() > 0.6 * w * h:
        cy, cx = ndimage.center_of_mass(m)
        dots.append((float(x_of_col(xs.start + cx)), float(z_of_row(ys.start + cy))))
dots.sort(key=lambda d: -d[1])
want_dots = [(sx * x, sz * z)
             for sz in (+1, -1) for (x, z) in ((S.FO_X, S.FO_Z), (S.NZ_X, S.NZ_Z))
             for sx in (-1, +1)]
# Group into rows BEFORE sorting by X: the two spots in a row differ by a
# hundredth of a millimetre in Z, which is enough for a plain (-z, x) sort to
# interleave them and pair every spot with the wrong one.
_key = lambda d: (-round(d[1], 1), d[0])
want_dots.sort(key=_key)
dots.sort(key=_key)
if len(dots) != 8:
    print('%-24s found %d red spots, expected 8   <-- FAIL' % ('spots', len(dots)))
    fails.append('spots')
else:
    worst = max(np.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(dots, want_dots))
    print('%-24s %10s %10s %+9.1f%s'
          % ('8 red spots, worst', '', '', worst * MM, '' if worst * MM < 25 else '   <-- FAIL'))
    if worst * MM >= 25:
        fails.append('spots')


def ring(mask, x0, z0, want_r, name, tol=25):
    r0, r1 = r_of_Z(z0 + want_r * 1.25), r_of_Z(z0 - want_r * 1.25)
    c0, c1 = c_of_X(x0 - want_r * 1.25), c_of_X(x0 + want_r * 1.25)
    ys, xs = np.where(mask[r0:r1, c0:c1])
    X, Z = x_of_col(xs + c0), z_of_row(ys + r0)
    sel = np.abs(np.hypot(X - x0, Z - z0) - want_r) < 0.25 * want_r
    X, Z = X[sel], Z[sel]
    keep = np.ones(len(X), bool)
    for t in (0.10, 0.05, 0.02, 0.012, 0.012):
        A = np.c_[X[keep], Z[keep], np.ones(keep.sum())]
        s, *_ = np.linalg.lstsq(A, X[keep] ** 2 + Z[keep] ** 2, rcond=None)
        cx, cz = s[0] / 2, s[1] / 2
        rad = np.sqrt(s[2] + cx * cx + cz * cz)
        d = np.abs(np.hypot(X - cx, Z - cz) - rad)
        keep = d < t * rad
    off = np.hypot(cx - x0, cz - z0)
    err = (rad - want_r) * MM
    bad = abs(err) >= tol or off * MM >= tol
    print('%-24s %10.4f %10.4f %+9.1f   centre off %.1f mm, out-of-round %.1f mm%s'
          % (name, rad, want_r, err, off * MM, d[keep].std() * MM,
             '' if not bad else '   <-- FAIL'))
    if bad:
        fails.append(name)


ring(blu, 0, 0, S.CENTRE_R, 'centre circle')
for sx in (-1, +1):
    for sz, tag in ((+1, 'far'), (-1, 'near')):
        ring(red, sx * S.FO_X, sz * S.FO_Z, S.END_R,
             'circle %s-%s' % (tag, 'L' if sx < 0 else 'R'))

print()
if fails:
    print('FAILURES=%d: %s' % (len(fails), ', '.join(fails)))
else:
    print('FAILURES=0 — every marking is within 25 mm of the rulebook')
