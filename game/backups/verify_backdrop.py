#!/usr/bin/env python3
"""Does the backdrop line up with the 3-D world it is hiding?

The whole 2.5D trick fails silently if it does not: a skater standing on the
blue line has to LOOK like he is standing on the painted blue line, and the
painted one is now a picture rather than geometry.

So: take world points whose marking is known (the eight faceoff spots, points
on each line), project them through the GAME's camera with three.js's own
lookAt convention, and read the pixel the backdrop actually put there. If the
paint is not under the point, the illusion is broken.

  python3 verify_backdrop.py [screenshot.png]

With no argument it checks rink_backdrop.png directly in its own tangent frame,
which isolates the generator; give it a game screenshot to check the whole
chain including the quad and the window aspect.
"""
import json
import sys

import numpy as np
from PIL import Image

import nhl_spec as S

cal = json.load(open('rink_calibration.json'))
BD = json.load(open('rink_backdrop.json'))
CAM = cal['camera_metres']
P = np.radians(CAM['pitch_deg'])
D = CAM['dist']
TY = np.tan(np.radians(CAM['vfov_deg']) / 2)

# three.js lookAt: zAxis = normalize(pos - target); xAxis = normalize(up x z)
C = np.array([0.0, np.sin(P) * D, -np.cos(P) * D])
zA = np.array([0.0, np.sin(P), -np.cos(P)])
xA = np.array([-1.0, 0.0, 0.0])
yA = np.cross(zA, xA)


def project(X, Z):
    d = np.array([X, 0.0, Z]) - C
    vx, vy, vz = d @ xA, d @ yA, d @ zA
    return vx / -vz, vy / -vz            # tangent coords off the camera axis


src = sys.argv[1] if len(sys.argv) > 1 else 'rink_backdrop.png'
im = np.asarray(Image.open(src).convert('RGB')).astype(int)
H, W, _ = im.shape

if len(sys.argv) > 1:
    # a game screenshot: vertical is the camera vFOV, horizontal follows aspect
    TXf = TY * (W / H)

    def to_px(tx, ty):
        return (0.5 + tx / (2 * TXf)) * W, (0.5 - ty / (2 * TY)) * H
else:
    def to_px(tx, ty):
        return (0.5 + tx / (2 * BD['tan_x'])) * W, (0.5 - ty / (2 * BD['tan_y'])) * H


def classify(u, v, r=3):
    """Is there paint under this point?

    By TINT, not by absolute colour. At the far end a 2-inch goal line is about
    half a pixel tall after foreshortening, so the reddest pixel on it is
    (209,170,170) — unmistakably the line, and nothing like the (178,70,66) the
    paint is at the near end. Asking "is this pixel red" fails it; asking "is
    this pixel redder than ice" does not.
    """
    u, v = int(round(u)), int(round(v))
    if not (r <= u < W - r and r <= v < H - r):
        return 'OFF-FRAME', (0, 0, 0)
    p = im[v - r:v + r + 1, u - r:u + r + 1].reshape(-1, 3).astype(float)
    redness = p[:, 0] - 0.5 * (p[:, 1] + p[:, 2])
    blueness = p[:, 2] - 0.5 * (p[:, 0] + p[:, 1])
    ir, ib = int(np.argmax(redness)), int(np.argmax(blueness))
    if blueness[ib] > 14:
        return 'blue', tuple(int(x) for x in p[ib])
    if redness[ir] > 14:
        return 'red', tuple(int(x) for x in p[ir])
    if p.mean(1).min() > 170:
        return 'ice', tuple(int(x) for x in p[int(np.argmin(p.mean(1)))])
    return 'other', tuple(int(x) for x in p[int(np.argmin(p.mean(1)))])


targets = []
for sx in (-1, 1):
    for sz in (-1, 1):
        targets.append(('faceoff spot %+d%+d' % (sx, sz), sx * S.FO_X, sz * S.FO_Z, 'red'))
        targets.append(('neutral spot %+d%+d' % (sx, sz), sx * S.NZ_X, sz * S.NZ_Z, 'red'))
for sz in (-1, 1):
    targets.append(('goal line %+d' % sz, -4.0, sz * S.GOAL_Z, 'red'))
    targets.append(('blue line %+d' % sz, 4.0, sz * S.BLUE_Z, 'blue'))
targets.append(('centre line', -6.0, 0.0, 'red'))
targets.append(('centre spot', 0.0, 0.0, 'blue'))
targets.append(('centre circle rim', 0.0, S.CENTRE_R, 'blue'))
for sx in (-1, 1):
    targets.append(('circle rim %+d far' % sx, sx * S.FO_X, S.FO_Z + S.END_R, 'red'))
targets.append(('blank ice', 0.0, S.HALF_D * 0.62, 'ice'))
targets.append(('blank ice wide', 9.5, -S.BLUE_Z * 0.5, 'ice'))

print('checking %s  (%dx%d)\n' % (src, W, H))
print('%-22s %9s %9s   %-10s %-10s %s' % ('point', 'u', 'v', 'want', 'got', 'pixel'))
bad = 0
for name, X, Z, want in targets:
    tx, ty = project(X, Z)
    u, v = to_px(tx, ty)
    got, px = classify(u, v)
    ok = got == want
    if not ok:
        bad += 1
    print('%-22s %9.1f %9.1f   %-10s %-10s %-16s %s'
          % (name, u, v, want, got, str(px), '' if ok else '<-- FAIL'))
print()
print('FAILURES=%d / %d' % (bad, len(targets)))
