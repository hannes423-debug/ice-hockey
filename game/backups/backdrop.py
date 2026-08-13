#!/usr/bin/env python3
"""Build rink_backdrop.png — the 2.5D backdrop, in the fixed camera's frame.

This is the smoke and mirrors. The picture is NOT a texture on the ice: it is a
single image locked to the fixed camera, drawn in front of the 3-D rink, with
the geometry hiding behind it. Only the actors (skaters, puck, goals) are real
3-D on top.

Which means the backdrop has to depict the SAME rink the geometry is, or a
skater standing on the blue line will not be standing on the painted blue line.
The reference photo depicts a 44.4 x 25.9 m rink; the geometry is regulation
60.96 x 25.91. So the backdrop is re-projected rather than pasted:

  the ice     from rink_mask.png, the regulation sheet, ray-cast through the
              fixed camera. Exact, because that sheet is exact.
  the boards  from the PHOTO, warped around the regulation footprint. This is
              the part a flat ice texture can never give: real dasher boards,
              glass, the kickplate, the dark surround. The photo's boards are
              carried across by matching perimeter position on the two rinks'
              outlines and stepping outward along the photo's own normal.
  outside     the scene's own void colour, so the quad's edge is invisible.

Output is in TANGENT space: x and y are tan(angle) off the camera axis, so the
game can map it to any window aspect with no fitting. Vertical extent is exactly
the camera's vFOV, so the quad fills the frame height at zoom 0.
"""
import json

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

import nhl_spec as S

geo = json.load(open('rinkgeo.json'))
cal = json.load(open('rink_calibration.json'))
gm = geo['ground_map']
CX, VH, A0, E, B, EA = gm['cx'], gm['v_h'], gm['a'], gm['e'], gm['b'], gm['ea']
L = geo['loose_W_units']
PW = 12.954

CAM = cal['camera_metres']
PITCH = np.radians(CAM['pitch_deg'])
DIST = CAM['dist']
TY = np.tan(np.radians(CAM['vfov_deg']) / 2)

photo = np.asarray(Image.open(geo['photo']).convert('RGB')).astype(np.float32)
PH, PWID, _ = photo.shape
mask = np.asarray(Image.open('rink_mask.png').convert('RGB')).astype(np.float32)
MH, MW, _ = mask.shape
VOID = np.array([10, 20, 32], np.float32)

# ------------------------------------------------------------- the two outlines
N = 3000


def outline(hw, hd, cr, n=N):
    """Rounded-rectangle footprint resampled to n points at constant arc length.

    Both rinks are resampled the same way from the same start point and in the
    same direction, so index i means "the same fraction of the way round the
    boards" on either. That correspondence is the whole warp.
    """
    seg = []
    d = 400
    a = np.linspace(0, np.pi / 2, d)
    seg.append(np.stack([np.full(d, hw), np.linspace(-(hd - cr), hd - cr, d)], -1))
    seg.append(np.stack([hw - cr + cr * np.cos(a), hd - cr + cr * np.sin(a)], -1))
    seg.append(np.stack([np.linspace(hw - cr, -(hw - cr), d), np.full(d, hd)], -1))
    seg.append(np.stack([-(hw - cr) + cr * np.cos(a + np.pi / 2),
                         hd - cr + cr * np.sin(a + np.pi / 2)], -1))
    seg.append(np.stack([np.full(d, -hw), np.linspace(hd - cr, -(hd - cr), d)], -1))
    seg.append(np.stack([-(hw - cr) + cr * np.cos(a + np.pi),
                         -(hd - cr) + cr * np.sin(a + np.pi)], -1))
    seg.append(np.stack([np.linspace(-(hw - cr), hw - cr, d), np.full(d, -hd)], -1))
    seg.append(np.stack([hw - cr + cr * np.cos(a + 1.5 * np.pi),
                         -(hd - cr) + cr * np.sin(a + 1.5 * np.pi)], -1))
    poly = np.concatenate(seg)
    poly = np.vstack([poly, poly[:1]])
    step = np.hypot(*np.diff(poly, axis=0).T)
    arc = np.concatenate([[0], np.cumsum(step)])
    want = np.linspace(0, arc[-1], n, endpoint=False)
    return np.interp(want, arc, poly[:, 0]), np.interp(want, arc, poly[:, 1])


gX, gZ = outline(S.HALF_W, S.HALF_D, S.CORNER_R)
# the photo's own footprint: its two halves are different lengths, so take the
# mean here -- the outline only has to be a correspondence, not a measurement
pD = 0.5 * (L['end']['far'] + L['end']['near']) * PW
pCR = 0.5 * (L['cornerR']['far'] + L['cornerR']['near']) * PW
pX, pZ = outline(PW, pD, pCR, n=len(gX))
print('outlines: %d samples each   game %.1f x %.1f m   photo %.1f x %.1f m'
      % (len(gX), 2 * S.HALF_W, 2 * S.HALF_D, 2 * PW, 2 * pD))

# ------------------------------------------------- project into the two frames
FWD = np.array([0.0, -np.sin(PITCH), np.cos(PITCH)])
UP = np.array([0.0, np.cos(PITCH), np.sin(PITCH)])
# three.js builds a lookAt basis as xAxis = normalize(cross(up, pos - target)).
# For a camera behind the rink looking toward +Z that comes out as (-1, 0, 0):
# world +X appears on the LEFT of the screen. Using (+1,0,0) here silently
# mirrors the whole backdrop, which an X-symmetric rink hides completely except
# in the photo's own asymmetric board features.
RIGHT = np.array([-1.0, 0.0, 0.0])
C = np.array([0.0, np.sin(PITCH) * DIST, -np.cos(PITCH) * DIST])


def to_tangent(X, Y, Z):
    X = np.asarray(X, float)
    d = np.stack([X - C[0], np.full_like(X, Y) - C[1], np.asarray(Z, float) - C[2]], -1)
    f = d @ FWD
    return (d @ RIGHT) / f, (d @ UP) / f


gtx, gty = to_tangent(gX, 0.0, gZ)
TX = float(np.abs(gtx).max() * 1.55)          # room for the boards and surround
OH = 1600
OW = int(round(OH * TX / TY))
print('backdrop %d x %d   tangent extent +-%.4f x +-%.4f  (vFOV %.2f deg)'
      % (OW, OH, TX, TY, CAM['vfov_deg']))


def tangent_to_px(tx, ty):
    return (tx / TX * 0.5 + 0.5) * OW, (0.5 - ty / TY * 0.5) * OH


def photo_px(X, Z):
    k = 1.0 + B * (Z / PW)
    return CX + A0 * (X / PW) / k, VH + E / k


qu, qv = tangent_to_px(gtx, gty)
pu, pv = photo_px(pX, pZ)

# outward normals along each outline, in its own pixel frame
def normals(u, v):
    du = np.gradient(u)
    dv = np.gradient(v)
    n = np.stack([dv, -du], -1)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    # point them away from the rink centre
    r = np.stack([u - u.mean(), v - v.mean()], -1)
    flip = np.sign((n * r).sum(1))
    flip[flip == 0] = 1
    return n * flip[:, None]


npho = normals(pu, pv)
# global scale between the two frames: the backdrop camera is further out, so
# the same boards subtend fewer pixels. Take it from the outlines themselves.
sq = np.median(np.hypot(np.gradient(qu), np.gradient(qv)))
sp = np.median(np.hypot(np.gradient(pu), np.gradient(pv)))
K = sq / sp
print('board scale photo -> backdrop: %.4f  (camera %.2f m -> %.2f m)'
      % (K, cal['camera_metres']['dist_as_photographed'], DIST))

# ------------------------------------------------------------------ ray cast
ix, iy = np.meshgrid(np.arange(OW), np.arange(OH))
tx = (ix + 0.5) / OW * 2 * TX - TX
ty = TY - (iy + 0.5) / OH * 2 * TY
D = FWD[None, None, :] + tx[..., None] * RIGHT + ty[..., None] * UP
tt = np.where(D[..., 1] < -1e-9, -C[1] / np.where(D[..., 1] < -1e-9, D[..., 1], -1), -1.0)
hitX = C[0] + tt * D[..., 0]
hitZ = C[2] + tt * D[..., 2]
hit = tt > 0

ax = np.abs(hitX) - (S.HALF_W - S.CORNER_R)
az = np.abs(hitZ) - (S.HALF_D - S.CORNER_R)
sd = np.where((ax > 0) & (az > 0), S.CORNER_R - np.hypot(ax, az),
              np.minimum(S.HALF_W - np.abs(hitX), S.HALF_D - np.abs(hitZ)))
on_ice = hit & (sd > 0)

out = np.tile(VOID, (OH, OW, 1))

# --- the ice, from the regulation sheet
mu = (hitX / S.HALF_W * 0.5 + 0.5) * MW
mv = (0.5 - hitZ / S.HALF_D * 0.5) * MH
m0 = np.clip(np.floor(mu).astype(int), 0, MW - 2)
n0 = np.clip(np.floor(mv).astype(int), 0, MH - 2)
fu = np.clip(mu - m0, 0, 1)[..., None]
fv = np.clip(mv - n0, 0, 1)[..., None]
ice = (mask[n0, m0] * (1 - fu) * (1 - fv) + mask[n0, m0 + 1] * fu * (1 - fv)
       + mask[n0 + 1, m0] * (1 - fu) * fv + mask[n0 + 1, m0 + 1] * fu * fv)
out[on_ice] = ice[on_ice]

# --- the boards and the surround, warped off the photo
tree = cKDTree(np.stack([qu, qv], -1))
oy, ox = np.where(~on_ice)
dist, idx = tree.query(np.stack([ox + 0.5, oy + 0.5], -1), workers=-1)
su = pu[idx] + npho[idx, 0] * dist * K
sv = pv[idx] + npho[idx, 1] * dist * K
# How far outside the photo's own frame the sample fell, as a soft weight —
# a hard cut here carves the surround into angular slabs, because the photo is
# a rectangle and the rink is not.
MARG = 24.0
inph = np.clip(np.minimum.reduce([su, sv, PWID - 2 - su, PH - 2 - sv]) / MARG + 1.0, 0, 1)
su_i = np.clip(np.floor(su).astype(int), 0, PWID - 2)
sv_i = np.clip(np.floor(sv).astype(int), 0, PH - 2)
a = np.clip(su - su_i, 0, 1)[:, None]
b = np.clip(sv - sv_i, 0, 1)[:, None]
samp = (photo[sv_i, su_i] * (1 - a) * (1 - b) + photo[sv_i, su_i + 1] * a * (1 - b)
        + photo[sv_i + 1, su_i] * (1 - a) * b + photo[sv_i + 1, su_i + 1] * a * b)
# Fade the arena floor out to the scene's own background over a fixed band, so
# the quad has no visible edge and no rounded-rectangle halo. Thresholds are in
# backdrop pixels, measured outward from the ice edge: the boards and glass are
# about 30 px, everything past FADE0 is just floor.
# Finish the fade while the photo still HAS content in every direction,
# otherwise the surround inherits the shape of the photo's rectangular frame
# and the rink sits in a lopsided dark wedge. The usable radius is set by the
# worst direction, so take a low percentile of how far out the samples are
# still inside the photo.
usable = dist[inph > 0.99]
FADE1 = float(np.percentile(usable, 88)) if usable.size else 0.30 * OH
FADE1 = min(FADE1, 0.30 * OH)
FADE0 = 0.45 * FADE1
band = np.clip((FADE1 - dist) / (FADE1 - FADE0), 0, 1) * inph
print('surround fades from %.0f to %.0f px out from the ice edge' % (FADE0, FADE1))
col = samp * band[:, None] + VOID * (1 - band[:, None])
out[oy, ox] = col

Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save('rink_backdrop.png')
json.dump({'tan_x': TX, 'tan_y': TY, 'w': OW, 'h': OH,
           'pitch_deg': CAM['pitch_deg'], 'vfov_deg': CAM['vfov_deg'],
           'dist': DIST}, open('rink_backdrop.json', 'w'), indent=1)
print('wrote rink_backdrop.png + rink_backdrop.json   ice %.1f%% of the frame'
      % (100 * on_ice.mean()))
