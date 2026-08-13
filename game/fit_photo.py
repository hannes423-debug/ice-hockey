#!/usr/bin/env python3
"""Fit a pinhole camera + a rink to the reference photo.

Replaces fit3.py, which had the previous photo's pixel targets baked into its
source and solved for camera and rink in one 22-parameter blind least squares.
That solve is ill-posed: for a camera on the rink's symmetry axis with no roll,
the GROUND-PLANE image is reproduced identically by a whole one-parameter
family of (focal length, pitch, height) -- so "pitch = 65.6 deg" out of such a
fit is one arbitrary member of that family, not a measurement.

This solves it in the order the photo actually constrains things:

  1. BOARDS   the two side boards are straight 3D lines, so their images are
              straight (they fit to 0.37 px rms here). Where they meet is the
              ground vanishing point; their slope is h/cos(pitch); their
              separation at the centre line is the lateral scale. Three of the
              ground homography's five numbers, essentially exactly.
  2. CIRCLES  the remaining number is the Z scale, and it is pinned by the one
              thing that ties Z to X: the five painted circles have to come
              back CIRCULAR when unprojected. One unknown, five constraints.
  3. PITCH    with the ground map known, fixing the principal point at the
              image centre (a render, so it is) breaks the family above and
              hands back focal length, pitch, height and distance.

Only then is anything unprojected to metres. Writes rinkgeo.json.

Units: X and Z in rink half-widths until the anchor at the very end.
"""
import json
import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.optimize import least_squares

import nhl_spec as S


def photo_path(p):
    """Reference paths are stored relative to the project root; older ones and
    any given on the command line are absolute. Accept both."""
    q = pathlib.Path(p)
    return q if q.is_absolute() else pathlib.Path(__file__).resolve().parent.parent / q


M = json.load(open('photo_measurements.json'))
IMG_W, IMG_H = M['img_w'], M['img_h']
PCX, PCY = (IMG_W - 1) / 2.0, (IMG_H - 1) / 2.0     # principal point: centred

V_CENTRE = M["rows"]["centre_line"]
                        # centre dot independently lands at 736.96

# ------------------------------------------------------------------ 1. boards
KV = np.array(M['board_rows'], float)
KL = np.array(M['board_left'], float)
KR = np.array(M['board_right'], float)
straight = (KV > 330) & (KV < 1200)          # exclude both corner arcs
aL, bL = np.polyfit(KV[straight], KL[straight], 1)
aR, bR = np.polyfit(KV[straight], KR[straight], 1)
free_axis = (bR - bL) / (aL - aR)

# Three candidate symmetry axes disagree by 5 px: the boards' own meet at
# u=513.7, the painted markings' mean at 508.0, the image centre at 511.0.
# A camera on the rink's axis would put all three in the same place, so this is
# render slop, and picking either extreme hands the whole 5 px to the other
# feature. Sit on the principal point -- it is the natural choice and it is
# also, here, almost exactly the midpoint: 0.09 m of error each way.
CX = float(PCX)
_v = np.r_[KV[straight], KV[straight]]
_d = np.r_[CX - KL[straight], KR[straight] - CX]     # half-width, both edges
_al, _bl = np.polyfit(_v, _d, 1)
VH = float(-_bl / _al)                        # ground vanishing point
A0 = float(_al * V_CENTRE + _bl)              # half-width in px at Z=0
EA = (V_CENTRE - VH) / A0                     # = h / cos(pitch), half-widths
E = A0 * EA                                   # = V_CENTRE - VH
rms = (_d - (_al * _v + _bl)).std()

print('1. BOARDS')
print('   left  u = %+.6f v %+.2f      right u = %+.6f v %+.2f' % (aL, bL, aR, bR))
print('   they meet at u = %.2f;  painted markings mean u = %.2f;  image centre %.1f'
      % (free_axis, M['cx_from_dots'], PCX))
print('   symmetric fit about u = %.2f:  rms %.3f px over %d edge samples'
      % (CX, rms, len(_v)))
print('   ground vanishing point v = %.2f' % VH)
print('   half-width at the centre line %.2f px   h/cos(pitch) = %.4f half-widths'
      % (A0, EA))


def ground(u, v, b):
    """Image -> ground, in half-widths. Only b is not fixed by the boards."""
    k = E / (np.asarray(v, float) - VH)       # = 1 + b*Z
    return (np.asarray(u, float) - CX) * EA / (np.asarray(v, float) - VH), (k - 1) / b


def v_of_Z(Z, b):
    return VH + E / (1 + b * np.asarray(Z, float))


def u_of_XZ(X, Z, b):
    return CX + A0 * np.asarray(X, float) / (1 + b * np.asarray(Z, float))


# ----------------------------------------------------------------- 2. circles
img = np.asarray(Image.open(photo_path(M['photo'])).convert('RGB')).astype(np.int32)
Rc_, Gc_, Bc_ = img[:, :, 0], img[:, :, 1], img[:, :, 2]
red = (Rc_ - Gc_ > 55) & (np.abs(Gc_ - Bc_) < 28) & (Rc_ > 110)
blu = (Bc_ > 110) & (Bc_ - Rc_ > 35) & (Bc_ - Gc_ > 15)

lab, nlab = ndimage.label(red, structure=np.ones((3, 3)))
sz = ndimage.sum(red, lab, range(1, nlab + 1))
rings = []
for i in np.argsort(sz)[::-1]:
    ys, xs = np.where(lab == i + 1)
    if not (150 < xs.max() - xs.min() < 400) or ys.max() - ys.min() < 100:
        continue
    rings.append((xs.astype(float), ys.astype(float)))
    if len(rings) == 4:
        break
rings.sort(key=lambda r: (r[1].mean() > IMG_H / 2, r[0].mean()))
RING_NAMES = ['far-L', 'far-R', 'near-L', 'near-R']

# the centre circle's widest points are painted over by the centre line, so it
# is two arcs and a connected-component grab returns only one of them
_cc = M['centre_circle']
YY, XX = np.mgrid[0:IMG_H, 0:IMG_W]
_r = np.hypot(XX - _cc['cx'], (YY - V_CENTRE) / max(_cc['b'] / _cc['a'], 0.3))
w = (_r < _cc['a'] * 1.2) & (_r > _cc['a'] * 0.75) & blu
ys, xs = np.where(w)
rings.append((xs.astype(float), ys.astype(float)))
RING_NAMES.append('centre')


def fit_circle(X, Z):
    """Algebraic circle fit, trimmed against its own residual."""
    keep = np.ones(len(X), bool)
    for _ in range(4):
        A = np.c_[X[keep], Z[keep], np.ones(keep.sum())]
        sol, *_ = np.linalg.lstsq(A, X[keep] ** 2 + Z[keep] ** 2, rcond=None)
        x0, z0 = sol[0] / 2, sol[1] / 2
        r = np.sqrt(sol[2] + x0 * x0 + z0 * z0)
        d = np.abs(np.hypot(X - x0, Z - z0) - r)
        keep = d < 0.06 * r
    return x0, z0, r, d[keep].mean() / r


def circ_resid(q):
    b = float(np.exp(q[0]))
    return np.array([fit_circle(*ground(xs, ys, b))[3] * 100 for xs, ys in rings])


sol = least_squares(circ_resid, [np.log(0.11)], xtol=1e-14, ftol=1e-14)
B = float(np.exp(sol.x[0]))
print('\n2. CIRCLES -> Z scale')
print('   b = %.6f' % B)
for nm, (xs, ys) in zip(RING_NAMES, rings):
    x0, z0, r, e = fit_circle(*ground(xs, ys, B))
    print('   %-7s centre (%+.4f, %+.4f)  R %.4f   out-of-round %.2f%% of R'
          % (nm, x0, z0, r, e * 100))

# ------------------------------------------------------------------- 3. camera
SIN = B * (PCY - VH) / A0
TH = float(np.arcsin(min(SIN, 1.0)))
COS = np.cos(TH)
F = A0 * COS / B
Hcam = EA * COS
Q0 = F / A0
ZCAM = (Hcam * SIN - Q0) / COS
print('\n3. CAMERA (principal point pinned to the image centre)')
print('   f = %.1f px   pitch = %.3f deg   vFOV = %.3f deg   hFOV = %.3f deg'
      % (F, np.degrees(TH), 2 * np.degrees(np.arctan(PCY / F)),
         2 * np.degrees(np.arctan(PCX / F))))
print('   height = %.4f half-widths   Zcam = %.4f half-widths' % (Hcam, ZCAM))

# ---------------------------------------------- 4. the photo against itself
dots = M['dots']
ROW = M['rows']


def Z_at(v):
    return float(ground(CX, v, B)[1])


def X_at(u, v):
    return float(ground(u, v, B)[0])


# Ends and corners. The far end's kickplate is measured straight off the photo;
# the near end's is OCCLUDED -- the camera sits 10 m beyond the near boards and
# looks at their outside, so the near ice line is behind the board top and the
# only handle on it is where the two near corner arcs close.
corners = {}
for nm, lo_, hi_, edge in (('far-L', 232, 320, KL), ('far-R', 232, 320, KR),
                           ('near-L', 1215, 1302, KL), ('near-R', 1215, 1302, KR)):
    sel = (KV >= lo_) & (KV <= hi_)
    corners[nm] = fit_circle(*ground(edge[sel], KV[sel], B))
D_far = Z_at(M['far_ice_end_row'])
D_near = float(np.mean([abs(corners['near-L'][1]) + corners['near-L'][2],
                        abs(corners['near-R'][1]) + corners['near-R'][2]]))
# far-L's arc fits 7x worse than the other three, so the corner radius is the
# median rather than the mean
CRad = float(np.median([c[2] for c in corners.values()]))

loose = {
    'end':     (D_far, D_near),
    'goal':    (Z_at(ROW['goal_far']), -Z_at(ROW['goal_near'])),
    'blue':    (Z_at(ROW['blue_far']), -Z_at(ROW['blue_near'])),
    'faceoff': (Z_at(dots[0][1] / 2 + dots[1][1] / 2), -Z_at(dots[6][1] / 2 + dots[7][1] / 2)),
    'neutral': (Z_at(dots[2][1] / 2 + dots[3][1] / 2), -Z_at(dots[4][1] / 2 + dots[5][1] / 2)),
}
fo_X = [abs(X_at(*dots[i])) for i in (0, 1, 6, 7)]
nz_X = [abs(X_at(*dots[i])) for i in (2, 3, 4, 5)]
circ = {nm: fit_circle(*ground(xs, ys, B)) for nm, (xs, ys) in zip(RING_NAMES, rings)}

W = 12.954      # metres per half-width -- the anchor
print('\n4. THE PHOTO AGAINST ITSELF (metres, at the %.3f m half-width anchor)' % W)
print('   %-16s %8s %8s %8s' % ('', 'far', 'near', 'spread'))
for k in ('end', 'goal', 'blue', 'faceoff', 'neutral'):
    f_, n_ = loose[k]
    print('   %-16s %8.3f %8.3f %8.3f' % (k + ' line/row', f_ * W, n_ * W, abs(f_ - n_) * W))
for nm, c in corners.items():
    print('   corner %-9s R %8.3f m   centre (%+.3f, %+.3f) W   out-of-round %.4f'
          % (nm, c[2] * W, c[0], c[1], c[3]))
print('   %-16s %8.3f %8.3f %8.3f' % ('faceoff |X|', np.mean(fo_X[:2]) * W,
                                      np.mean(fo_X[2:]) * W,
                                      abs(np.mean(fo_X[:2]) - np.mean(fo_X[2:])) * W))
print('   %-16s %8.3f %8.3f %8.3f' % ('neutral |X|', np.mean(nz_X[:2]) * W,
                                      np.mean(nz_X[2:]) * W,
                                      abs(np.mean(nz_X[:2]) - np.mean(nz_X[2:])) * W))
print('   %-16s %8.3f %8.3f %8.3f' % ('faceoff R',
                                      np.mean([circ['far-L'][2], circ['far-R'][2]]) * W,
                                      np.mean([circ['near-L'][2], circ['near-R'][2]]) * W,
                                      abs(circ['far-L'][2] - circ['near-L'][2]) * W))
paint_axis = np.mean([X_at(*d) for d in dots])
print('   painted markings sit %+.3f m off the boards\' own symmetry axis'
      % (paint_axis * W))

# --------------------------------------------------------- 5. the rigid rink
sym = {k: 0.5 * (v[0] + v[1]) for k, v in loose.items()}

geo = dict(
    photo=M['photo'],
    ground_map=dict(cx=CX, v_h=VH, a=A0, e=E, b=B, ea=EA),
    camera=dict(f_px=F, pitch_deg=float(np.degrees(TH)), h_W=Hcam, Zcam_W=ZCAM,
                cx=CX, cy=PCY, vfov_deg=float(2 * np.degrees(np.arctan(PCY / F))),
                img_w=IMG_W, img_h=IMG_H),
    rink_W_units=dict(D=sym['end'], CR=CRad, Zb=sym['blue'], Zg=sym['goal'],
                      Xf=float(np.mean(fo_X)), Zf=sym['faceoff'],
                      Rf=float(np.mean([c[2] for k, c in circ.items() if k != 'centre'])),
                      Rc=float(circ['centre'][2]),
                      Xn=float(np.mean(nz_X)), Zn=sym['neutral']),
    loose_W_units={k: {'far': v[0], 'near': v[1]} for k, v in loose.items()},
)
geo['loose_W_units']['circR'] = {
    'far': float(np.mean([circ['far-L'][2], circ['far-R'][2]])),
    'near': float(np.mean([circ['near-L'][2], circ['near-R'][2]]))}
geo['loose_W_units']['cornerR'] = {
    'far': float(np.median([corners['far-L'][2], corners['far-R'][2]])),
    'near': float(np.mean([corners['near-L'][2], corners['near-R'][2]]))}
geo['metres'] = {k: v * W for k, v in geo['rink_W_units'].items()}
geo['metres']['halfW'] = W
geo['metres']['halfD'] = geo['metres'].pop('D')
geo['metres']['corner'] = geo['metres'].pop('CR')
geo['metres']['blueZ'] = geo['metres'].pop('Zb')
geo['metres']['goalZ'] = geo['metres'].pop('Zg')
geo['metres']['foX'] = geo['metres'].pop('Xf')
geo['metres']['foZ'] = geo['metres'].pop('Zf')
geo['metres']['foR'] = geo['metres'].pop('Rf')
geo['metres']['centreR'] = geo['metres'].pop('Rc')
geo['metres']['ndX'] = geo['metres'].pop('Xn')
geo['metres']['ndZ'] = geo['metres'].pop('Zn')

print('\n5. THE RIGID RINK (half-width anchored to NHL %.3f m)' % W)
for k in ('halfW', 'halfD', 'corner', 'blueZ', 'goalZ', 'foX', 'foZ', 'foR',
          'centreR', 'ndX', 'ndZ'):
    print('   %-9s %8.3f m' % (k, geo['metres'][k]))
print('   full rink %.2f x %.2f m   (NHL 60.96 x 25.91)'
      % (2 * geo['metres']['halfD'], 2 * W))
print('   camera %.2f m up, %.2f m behind centre ice, %.2f m away'
      % (Hcam * W, -ZCAM * W, np.hypot(Hcam, ZCAM) * W))

json.dump(geo, open('rinkgeo.json', 'w'), indent=1)

# ------------------------------------------------ 6. the crease and the goal
# Both are things the photo actually shows, so the photo sets them. Their
# HEIGHT is not measurable here: the board height implied by the photo's side
# boards and by its far boards disagree by 38%, so this render is not to be
# trusted about anything vertical. Goal height stays at the NHL 1.22 m.
def v_of_Z(z):
    return VH + E / (1 + B * z)


creases, mouths = [], []
for tag, zc, prows in (('far', loose['goal'][0], range(279, 282)),
                       ('near', -loose['goal'][1], range(1318, 1321))):
    v0 = v_of_Z(zc)
    rr = slice(int(v0 - 70), int(v0 + 70))
    cc = slice(int(CX - 120), int(CX + 120))
    sub = blu[rr, cc]
    l2, n2 = ndimage.label(sub, np.ones((3, 3)))
    s2 = ndimage.sum(sub, l2, range(1, n2 + 1))
    ys, xs = np.where(l2 == int(np.argmax(s2)) + 1)
    Xc, Zc_ = ground(xs + cc.start, ys + rr.start, B)
    creases.append((tag, float(np.abs(Xc).max()), float(Zc_.max() - Zc_.min())))
    wid = []
    for v in prows:
        px = np.where(red[v, cc])[0] + cc.start
        if len(px) > 1:
            wid.append(float((X_at(px.max(), v) - X_at(px.min(), v))))
    # A picture need not have goals in it at all -- the 2026-08-13 reference
    # deliberately has none, which is BETTER for the pipeline, since a 3-D goal
    # cannot be rectified onto flat ice. Without this guard np.median([]) is a
    # nan and a RuntimeWarning, and the report then prints a confident nan.
    mouths.append((tag, float(np.median(wid)) if wid else None))
print('\n6. WHAT THE PHOTO SAYS ABOUT ITS CREASE AND GOAL')
print('   (measured, then NOT used: the rulebook sets these. Kept because it'
      ' shows\n    how far off the picture is -- and because its two ends'
      ' disagree by 8%.)')
for tag, halfw, depth in creases:
    print('   crease %-5s half-width %.3f m, depth %.3f m' % (tag, halfw * W, depth * W))
for tag, wd in mouths:
    if wd is None:
        print('   goal   %-5s not in the picture' % tag)
    else:
        print('   goal   %-5s outer mouth %.3f m' % (tag, wd * W))
CREASE_R = float(creases[0][1])              # far crease: the near one is
POST_R = 0.05 / W                            # partly hidden behind its own net
_m = [m[1] for m in mouths if m[1] is not None]
GOAL_HALFW = (float(np.mean(_m)) / 2 - POST_R) if _m else float('nan')
print('   -> the photo would give creaseR %.3f m, goalHalfW %.3f m;'
      ' the rulebook says 1.829 / 0.914' % (CREASE_R * W, GOAL_HALFW * W))
print('      (neither is used: nhl_spec.py sets both)')

# The GAME rink is the rulebook's, not the photo's. Everything measured above
# still matters -- rectify.py needs the camera and the photo's own footprint to
# resample the ice -- but nothing the photo says about WHERE a marking goes
# survives into the build, because the photo cannot be made consistent and
# cannot be made legal (44 m long against 61, circles 3.73 m against 4.57, no
# trapezoid). See nhl_spec.py.
#
# The camera keeps the picture's ANGLE and LENS and moves back far enough to
# frame the longer sheet at the same angular size, so the locked view is the
# picture's framing of a regulation rink.
DIST = float(np.hypot(Hcam, ZCAM) * W)
DIST_NHL = DIST * (S.HALF_D / (sym['end'] * W))
print('\n7. THE GAME RINK IS THE RULEBOOK\'S (nhl_spec.py)')
print('   rink      %.2f x %.2f m   (the photo said %.2f x %.2f)'
      % (2 * S.HALF_W, 2 * S.HALF_D, 2 * W, 2 * sym['end'] * W))
print('   camera    pitch %.3f deg, vFOV %.3f deg, %.2f m out'
      '  (the photo\'s own rig was %.2f m out, moved back x%.3f to frame the'
      ' longer sheet at the same angular size)'
      % (np.degrees(TH), 2 * np.degrees(np.arctan(PCY / F)), DIST_NHL, DIST,
         DIST_NHL / DIST))

cal = dict(
    _source='markings and dimensions: nhl_spec.py (NHL Official Rules, sec. 1). '
            'Ice appearance and paint colour: %s (%dx%d). Camera angle and lens: '
            'fitted to that photo by measure_photo.py + fit_photo.py.'
            % (M['photo'].rsplit('/', 1)[-1], IMG_W, IMG_H),
    _anchor='The photo sets how the ice LOOKS and where the camera IS. The '
            'rulebook sets every dimension. The photo cannot do the latter: it '
            'disagrees with itself by up to 2.14 m between halves, and its rink '
            'is 44 m long against the regulation 61.',
    camera_image=geo['camera'],
    camera_metres=dict(pitch_deg=float(np.degrees(TH)),
                       vfov_deg=float(2 * np.degrees(np.arctan(PCY / F))),
                       hfov_deg=float(2 * np.degrees(np.arctan(PCX / F))),
                       height=float(np.sin(TH) * DIST_NHL),
                       z=float(-np.cos(TH) * DIST_NHL),
                       dist=DIST_NHL,
                       dist_as_photographed=DIST),
    metres=dict(halfW=S.HALF_W, halfD=S.HALF_D, corner=S.CORNER_R,
                blueZ=S.BLUE_Z, goalZ=S.GOAL_Z,
                foX=S.FO_X, foZ=S.FO_Z, foR=S.END_R, centreR=S.CENTRE_R,
                ndX=S.NZ_X, ndZ=S.NZ_Z,
                goalHalfW=S.GOAL_HALF_W, goalHeight=S.GOAL_HEIGHT,
                creaseR=S.CREASE_R, goalDepth=S.GOAL_DEPTH),
)
json.dump(cal, open('rink_calibration.json', 'w'), indent=1)
print('\nwrote rinkgeo.json and rink_calibration.json')
