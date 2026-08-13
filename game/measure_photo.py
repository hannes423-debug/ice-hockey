#!/usr/bin/env python3
"""Measure the reference photo's rink markings in pixels.

Everything fit3.py fits against comes from here, so a new reference photo
means re-running this and pasting the numbers -- never hand-eyeballing them.
Writes photo_measurements.json.

Contamination matters: the faceoff circles' hash marks touch the ring in this
render, so a plain conic fit on the connected component is pulled several
pixels sideways (far-R bbox centre 695.5 vs its own dot at 701.1). The ellipse
fits below are trimmed iteratively against their own residual.
"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

# The reference lives IN the tree, not in ~/Lataukset. A pipeline whose input
# sits in the user's Downloads folder cannot be rebuilt from a clone, and the
# picture is the one input nothing else can regenerate.
DEFAULT_PHOTO = pathlib.Path(__file__).resolve().parent.parent / \
    'reference' / 'rink_reference_2026-08-13.png'
PHOTO = sys.argv[1] if len(sys.argv) > 1 else str(DEFAULT_PHOTO)

a = np.asarray(Image.open(PHOTO).convert('RGB')).astype(np.int32)
H, W, _ = a.shape
R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]

# yellow kickplate has R-G ~ 50 and G-B ~ 120; red paint has R-G ~ 110, G-B ~ 0
red = (R - G > 55) & (np.abs(G - B) < 28) & (R > 110)
yel = (R > 150) & (G > 110) & (R - B > 60) & (G - B > 45)
blu = (B > 110) & (B - R > 35) & (B - G > 15)

# Record it RELATIVE to the project root when it lives there. An absolute
# path is both a wrong answer in a clone and a needless disclosure of whose
# machine generated the file.
_root = pathlib.Path(__file__).resolve().parent.parent
try:
    _rec = str(pathlib.Path(PHOTO).resolve().relative_to(_root))
except ValueError:
    _rec = PHOTO
out = {'photo': _rec, 'img_w': W, 'img_h': H}


def runs(mask_row, gap=4):
    xs = np.where(mask_row)[0]
    if not len(xs):
        return []
    seg, s, prev = [], xs[0], xs[0]
    for x in xs[1:]:
        if x > prev + gap:
            seg.append((int(s), int(prev)))
            s = x
        prev = x
    seg.append((int(s), int(prev)))
    return seg


def band_centre(mask, y0, y1, xlo, xhi, minfrac=0.5):
    """Sub-pixel row of a horizontal painted line, weighted by coverage."""
    sub = mask[y0:y1, xlo:xhi]
    w = sub.sum(1).astype(float)
    keep = w >= minfrac * w.max()
    ys = np.arange(y0, y1)[keep]
    ww = w[keep]
    return float((ys * ww).sum() / ww.sum()), int(keep.sum())


def fit_ellipse(xs, ys, trim=3):
    """Conic least squares, iteratively trimmed against its own residual."""
    xs, ys = xs.astype(float), ys.astype(float)
    keep = np.ones(len(xs), bool)
    for _ in range(trim + 1):
        x, y = xs[keep], ys[keep]
        mx, my = x.mean(), y.mean()
        x, y = x - mx, y - my
        D = np.c_[x * x, x * y, y * y, x, y, np.ones_like(x)]
        _, _, V = np.linalg.svd(D, full_matrices=False)
        A, Bc, C, Dd, E, F = V[-1]
        M = np.array([[A, Bc / 2], [Bc / 2, C]])
        cen = np.linalg.solve(2 * M, [-Dd, -E])
        Fc = F + 0.5 * (Dd * cen[0] + E * cen[1])
        ev, evec = np.linalg.eigh(M / (-Fc))
        if np.any(ev <= 0):
            break
        axes = 1 / np.sqrt(ev)
        cx, cy = cen[0] + mx, cen[1] + my
        # normalised radial residual of EVERY point against this ellipse
        u = np.c_[xs - cx, ys - cy] @ evec
        rr = np.hypot(u[:, 0] / axes[0], u[:, 1] / axes[1])
        keep = np.abs(rr - 1) < 0.06
    i = int(np.argmax(axes))
    j = 1 - i
    ang = np.degrees(np.arctan2(evec[1, i], evec[0, i]))
    # axis-aligned half-extents of the fitted ellipse (what fit3 compares to)
    t = np.linspace(0, 2 * np.pi, 721)
    px = cx + axes[0] * np.cos(t) * evec[0, i] + axes[1] * np.sin(t) * evec[0, j]
    py = cy + axes[0] * np.cos(t) * evec[1, i] + axes[1] * np.sin(t) * evec[1, j]
    return dict(cx=float(cx), cy=float(cy), a=float(axes[i]), b=float(axes[j]),
                ang=float(ang), n=int(keep.sum()), n_all=int(len(xs)),
                ex_x=float((px.max() - px.min()) / 2), ex_y=float((py.max() - py.min()) / 2),
                mid_x=float((px.max() + px.min()) / 2), mid_y=float((py.max() + py.min()) / 2))


# ---------------------------------------------------------------- faceoff dots
lab, n = ndimage.label(red, structure=np.ones((3, 3)))
dots = []
for i, sl in enumerate(ndimage.find_objects(lab)):
    ys, xs = sl
    h, w = ys.stop - ys.start, xs.stop - xs.start
    m = lab[sl] == i + 1
    if 8 <= w <= 60 and 5 <= h <= 40 and m.sum() > 0.5 * w * h:
        cy, cx = ndimage.center_of_mass(m)
        dots.append((float(xs.start + cx), float(ys.start + cy)))
dots.sort(key=lambda d: d[1])
out['dots'] = dots
print('faceoff/neutral dots (x, y), far to near:')
for d in dots:
    print('   %8.2f %8.2f' % d)
cx_img = float(np.mean([d[0] for d in dots]))
out['cx_from_dots'] = cx_img
print('image centreline from dots: x = %.2f' % cx_img)

# ---------------------------------------------------------------- end circles
sz = ndimage.sum(red, lab, range(1, n + 1))
rings = []
for i in np.argsort(sz)[::-1]:
    ys, xs = np.where(lab == i + 1)
    w, h = xs.max() - xs.min(), ys.max() - ys.min()
    if w < 150 or h < 100 or w > 400:
        continue
    rings.append((i + 1, xs, ys))
    if len(rings) == 4:
        break
rings.sort(key=lambda r: (r[2].mean() > H / 2, r[1].mean()))
out['circles'] = {}
print('\nend faceoff circles:')
for (cid, xs, ys), nm in zip(rings, ['far-L', 'far-R', 'near-L', 'near-R']):
    e = fit_ellipse(xs, ys)
    out['circles'][nm] = e
    print('  %-7s c=(%7.2f,%8.2f) a=%6.2f b=%6.2f ratio %.3f  ang %+6.1f  kept %d/%d'
          % (nm, e['cx'], e['cy'], e['a'], e['b'], e['b'] / e['a'], e['ang'], e['n'], e['n_all']))
    print('           axis-aligned half-extent  x %6.2f  y %6.2f   mid (%7.2f,%8.2f)'
          % (e['ex_x'], e['ex_y'], e['mid_x'], e['mid_y']))

# ---------------------------------------------------------------- centre circle
# The centre line crosses the centre circle, so the circle is TWO ARCS, not one
# component -- and each arc is shorter than the circle is tall, so any single
# component grab either misses it or returns half of it. Merge every blue
# component that is circle-shaped and sits on the rink's axis. The blue LINES
# and the board caps are excluded by width: they run the full sheet.
labb, nb = ndimage.label(blu, structure=np.ones((3, 3)))
arcs = []
for i, sl in enumerate(ndimage.find_objects(labb)):
    ys, xs = sl
    w = xs.stop - xs.start
    if not (150 < w < 400):
        continue
    if abs((xs.start + xs.stop) / 2 - cx_img) > 60:
        continue
    if (labb[sl] == i + 1).sum() < 150:
        continue
    arcs.append(np.where(labb == i + 1))
if arcs:
    _ys = np.concatenate([a[0] for a in arcs])
    _xs = np.concatenate([a[1] for a in arcs])
    e = fit_ellipse(_xs, _ys)
    out['centre_circle'] = e
    print('\ncentre circle: %d arc(s), %d px  c=(%.2f,%.2f) a=%.2f b=%.2f ratio %.3f'
          % (len(arcs), len(_xs), e['cx'], e['cy'], e['a'], e['b'], e['b'] / e['a']))
else:
    print('\nWARNING: no centre circle found')
# ---------------------------------------------------------------- board profile
# A row is usable only where the kickplate reads as two SIDE edges. Across the
# far-end straight the same yellow is one long horizontal run, and taking
# "rightmost pixel left of centre" there returns a half-width of half a pixel —
# 1040 rows of profile with the first four of them garbage, which is enough to
# drag a least-squares camera 10 degrees off.
KV, KH, KL, KR = [], [], [], []
for y in range(1, H):
    seg = runs(yel[y])
    seg = [s for s in seg if s[1] - s[0] < 40]          # drop end-straight runs
    left = [s for s in seg if s[1] < cx_img]
    right = [s for s in seg if s[0] > cx_img]
    if not left or not right:
        continue
    KV.append(y)
    KL.append(float(max(s[1] for s in left)))
    KR.append(float(min(s[0] for s in right)))
    KH.append((KR[-1] - KL[-1]) / 2.0)
out['board_rows'] = KV
out['board_half'] = KH
out['board_left'] = KL
out['board_right'] = KR
print('\nboard (yellow kickplate) profile: %d rows, y %d..%d, half-width %.1f..%.1f px'
      % (len(KV), KV[0], KV[-1], min(KH), max(KH)))

# far end straight: the long horizontal run of yellow
far_rows = [y for y in range(KV[0] - 8, KV[0] + 12)
            if len(runs(yel[y])) and max(b - s for s, b in runs(yel[y])) > 250]
if far_rows:
    wsum = np.array([yel[y].sum() for y in far_rows], float)
    out['far_ice_end_row'] = float((np.array(far_rows) * wsum).sum() / wsum.sum())
    print('far-end kickplate row: %.2f  (rows %s)' % (out['far_ice_end_row'], far_rows))

# near end: the kickplate is OCCLUDED by the boards' own top edge, so the near
# ice line cannot be measured. Record where the ice visually stops instead.
col = a[:, int(cx_img) - 220:int(cx_img) - 180].mean(axis=(1, 2))
ycut = next(y for y in range(1330, H - 2) if col[y] < 200)
out['near_ice_occluded_row'] = int(ycut)
print('near-end ice disappears behind the board top at row %d (NOT the ice line)' % ycut)

# ---------------------------------------------------------------- painted rows
# Found, not hardcoded. The previous version carried the FIRST reference
# photo's row windows in its source, so pointing it at any other picture
# returned nan for every line and the fit then ran on the circles alone.
# Scan for horizontal bands of paint instead, and reject the ones outside the
# ice: the board caps are blue and run the full width, so they read exactly
# like a blue line to anything that only looks at colour.
ICE_TOP = out['far_ice_end_row'] + 4
ICE_BOT = out['near_ice_occluded_row'] - 2
XLO, XHI = int(cx_img - 0.42 * max(KH)), int(cx_img + 0.42 * max(KH))


def bands(mask, minfrac=0.35):
    cov = mask[:, XLO:XHI].sum(1).astype(float)
    peak = cov.max()
    hits = [y for y in range(int(ICE_TOP), int(ICE_BOT))
            if cov[y] > minfrac * peak]
    if not hits:
        return []
    groups, cur = [], [hits[0]]
    for y in hits[1:]:
        if y - cur[-1] <= 6:
            cur.append(y)
        else:
            groups.append(cur)
            cur = [y]
    groups.append(cur)
    out_ = []
    for gp in groups:
        w = cov[gp]
        out_.append((float((np.array(gp) * w).sum() / w.sum()), len(gp)))
    return out_


rb, bb = bands(red), bands(blu)
lines = {}
if len(rb) == 3:
    lines['goal_far'], lines['centre_line'], lines['goal_near'] = rb
else:
    print('  WARNING: expected 3 red bands (2 goal lines + centre), got %d' % len(rb))
if len(bb) == 2:
    lines['blue_far'], lines['blue_near'] = bb
else:
    print('  WARNING: expected 2 blue bands, got %d' % len(bb))
out['rows'] = {k: v[0] for k, v in lines.items()}
print('\npainted horizontal lines (found between rows %d and %d):' % (ICE_TOP, ICE_BOT))
for k, (v, cnt) in lines.items():
    print('  %-12s %8.2f  (%d rows thick)' % (k, v, cnt))

json.dump(out, open('photo_measurements.json', 'w'), indent=1)
print('\nwrote photo_measurements.json')
