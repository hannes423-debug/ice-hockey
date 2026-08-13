#!/usr/bin/env python3
"""Draw the fitted rink back onto the reference photo.

The one check that cannot be gamed by the thing being checked: project the
RIGID rink (what the game will build) through the fitted camera and see it
land on the paint. Writes overlay_check.png -- green is the rigid rink,
magenta is where the photo's own far/near halves disagree with it.
"""
import json

import numpy as np
from PIL import Image, ImageDraw

g = json.load(open('rinkgeo.json'))
gm = g['ground_map']
CX, VH, A0, E, B, EA = gm['cx'], gm['v_h'], gm['a'], gm['e'], gm['b'], gm['ea']
r = g['rink_W_units']
L = g['loose_W_units']

im = Image.open(g['photo']).convert('RGB')
d = ImageDraw.Draw(im)
GREEN, MAG = (0, 255, 60), (255, 0, 200)


def P(X, Z):
    k = 1 + B * np.asarray(Z, float)
    return CX + A0 * np.asarray(X, float) / k, VH + E / k


def line(X, Z, col, w=2):
    u, v = P(np.asarray(X, float), np.asarray(Z, float))
    d.line(list(zip(u, v)), fill=col, width=w)


D, CR = r['D'], r['CR']
t = np.linspace(0, np.pi / 2, 60)
# rink outline
for sz in (+1, -1):
    for sx in (+1, -1):
        line(sx * (1 - CR + CR * np.cos(t)), sz * (D - CR + CR * np.sin(t)), GREEN)
for sx in (+1, -1):
    line([sx, sx], [-(D - CR), D - CR], GREEN)
for sz in (+1, -1):
    line([-(1 - CR), 1 - CR], [sz * D, sz * D], GREEN)
# markings, rigid
line([-1, 1], [0, 0], GREEN)
for sz in (+1, -1):
    for k, wid in (('Zb', 2), ('Zg', 2)):
        line([-1, 1], [sz * r[k], sz * r[k]], GREEN)
th = np.linspace(0, 2 * np.pi, 181)
line(r['Rc'] * np.cos(th), r['Rc'] * np.sin(th), GREEN)
for sx in (+1, -1):
    for sz in (+1, -1):
        line(sx * r['Xf'] + r['Rf'] * np.cos(th), sz * r['Zf'] + r['Rf'] * np.sin(th), GREEN)
        u, v = P(sx * r['Xn'], sz * r['Zn'])
        d.ellipse([u - 5, v - 5, u + 5, v + 5], outline=GREEN, width=2)
# where the photo's own halves disagree with the rigid rink
for k, key in (('goal', 'Zg'), ('blue', 'Zb'), ('faceoff', 'Zf')):
    for half, sz in (('far', +1), ('near', -1)):
        line([-1, 1], [sz * L[k][half], sz * L[k][half]], MAG, 1)

im.save('overlay_check.png')
print('wrote overlay_check.png')
