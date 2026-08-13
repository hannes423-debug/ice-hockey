#!/usr/bin/env python3
"""Build rink_boards.png — the boards, as a strip texture for the board ring.

This replaces carrying the photo's boards across by warping them in IMAGE space
around a differently shaped rink, which is what deformed them: a
distance-transform warp smears, and it was smearing a 42 m rink onto a 61 m one.

Unwrapping them properly was tried first and abandoned for a measured reason.
Rectifying the board band through the photo's own camera works, but the render
disagrees with itself about vertical scale so badly that the blue cap, tracked
all the way round, lands anywhere between 0.53 m and 2.78 m above the ice — a
5.3x spread. There is no calibration that fixes that, because there is no
consistent rink there to calibrate to.

So the boards get the same treatment the ice markings got: **the picture
supplies the palette and the proportions, the spec supplies the geometry.** The
colours below are sampled off the photo, the panel pitch is measured off it, and
the result is generated to fit the regulation footprint exactly. Nothing can
deform, because nothing is being stretched.

  u  distance round the rink's perimeter, 1 texture repeat per lap
  v  0 at the top of the glass, 1 at the ice

Output is RGBA: the glass is genuinely translucent, so the arena behind it shows
through the way it does in the picture.
"""
import json
import pathlib

import numpy as np
from PIL import Image

import nhl_spec as S


def photo_path(p):
    """Reference paths are stored relative to the project root; older ones and
    any given on the command line are absolute. Accept both."""
    q = pathlib.Path(p)
    return q if q.is_absolute() else pathlib.Path(__file__).resolve().parent.parent / q


geo = json.load(open('rinkgeo.json'))
cam = geo['camera']
L = geo['loose_W_units']
PW = 12.954
F, TH = cam['f_px'], np.radians(cam['pitch_deg'])
HC, ZC, CX, CY = cam['h_W'], cam['Zcam_W'], cam['cx'], cam['cy']
SIN, COS = np.sin(TH), np.cos(TH)

photo = np.asarray(Image.open(photo_path(geo['photo'])).convert('RGB')).astype(np.float32)
PH, PWID, _ = photo.shape

GLASS_TOP = 2.87        # CONFIG.glassTop
BOARD_H = 1.07          # CONFIG.boardH
KICK_H = 0.22           # kickplate strip
CAP_H = 0.10            # the coloured cap along the top of the dashers


def proj_u(X, Y, Z):
    x, y, z = X / PW, Y / PW, Z / PW
    return CX + F * x / ((HC - y) * SIN + (z - ZC) * COS)


def proj_v(X, Y, Z):
    x, y, z = X / PW, Y / PW, Z / PW
    zc = (HC - y) * SIN + (z - ZC) * COS
    yc = -(HC - y) * COS + (z - ZC) * SIN
    return CY - F * yc / zc


# ------------------------------------------------------- palette, off the photo
# The far boards are the ones seen face-on, so the bands are unambiguous there.
Zf = L['end']['far'] * PW
v_ice = float(proj_v(0.0, 0.0, Zf))
col = int(round(float(proj_u(0.0, 0.0, Zf))))
strip_px = photo[:, col - 60:col + 60].mean(1)


def band(y0, y1):
    return strip_px[int(y0):int(y1)].mean(0)


def find_up(pred, start, limit=90):
    for k in range(1, limit):
        if pred(strip_px[start - k]):
            return start - k
    return None


blue_row = find_up(lambda p: p[2] - 0.5 * (p[0] + p[1]) > 40, int(v_ice))
kick_row = find_up(lambda p: p[0] - p[2] > 60, int(v_ice) + 3, 12)
def purest(rows, key):
    """The most saturated pixel in a band, not its mean.

    These bands are two or three pixels tall, so averaging them mixes in the
    antialiased edge against the white dasher either side: the cap came out
    (120,146,178), a washed-out grey-blue, when the paint is actually
    (13,74,137)."""
    seg = strip_px[rows[0]:rows[1]]
    return seg[int(np.argmax([key(p) for p in seg]))]


KICK = purest((int(v_ice) - 6, int(v_ice) + 2), lambda p: p[0] - p[2])
CAP = purest((blue_row - 3, blue_row + 4), lambda p: p[2] - 0.5 * (p[0] + p[1]))
DASH = band(blue_row + 4, v_ice - 5)
GLASS = band(blue_row - 34, blue_row - 6)
print('sampled off the photo at the far boards (ice edge row %.1f):' % v_ice)
for nm, c in (('kickplate', KICK), ('dasher', DASH), ('cap', CAP), ('glass', GLASS)):
    print('   %-10s (%3.0f,%3.0f,%3.0f)' % ((nm,) + tuple(c)))

# ------------------------------------------------------ panel pitch, off the photo
# By autocorrelation, not by counting dark columns: the render's posts are
# irregular enough that peak-finding returned a 15 px mean with a 7 px spread,
# which is noise, not a pitch.
gl = photo[blue_row - 30:blue_row - 8, 300:730].mean(axis=(0, 2))
gl = gl - np.convolve(gl, np.ones(41) / 41, mode='same')
gl[:20] = gl[-20:] = 0
ac = np.correlate(gl, gl, 'full')[len(gl) - 1:]
lag = int(np.argmax(ac[6:60]) + 6)
mpp = 1.0 / (proj_u(1.0, 0.6, Zf) - proj_u(0.0, 0.6, Zf))
PITCH = float(lag * mpp)
print('panel pitch: %d px at %.2f px/m -> %.2f m' % (lag, 1 / mpp, PITCH))
if not 0.6 < PITCH < 3.5:
    PITCH = 2.44
    print('   out of range, using the 8 ft standard instead: %.2f m' % PITCH)

# --------------------------------------------------------------------- generate
PERIM = 2 * (2 * S.HALF_D - 2 * S.CORNER_R) + 2 * (2 * S.HALF_W - 2 * S.CORNER_R) \
    + 2 * np.pi * S.CORNER_R
SW = 4096
SH = 256
PPM_U = SW / PERIM
print('perimeter %.1f m -> %d px  (%.1f px/m), %.0f panels' % (PERIM, SW, PPM_U, PERIM / PITCH))

u_m = (np.arange(SW) + 0.5) / PPM_U
y_m = (1.0 - (np.arange(SH) + 0.5) / SH) * GLASS_TOP      # row 0 = glass top
UU, YY = np.meshgrid(u_m, y_m)

rgb = np.zeros((SH, SW, 3), np.float32)
alpha = np.zeros((SH, SW), np.float32)


def soft(edge, x, w=0.012):
    return np.clip((x - edge) / w + 0.5, 0, 1)


# glass: translucent, with the photo's own tint, fading very slightly to the top
gl_t = soft(BOARD_H, YY)
rgb += GLASS * gl_t[..., None]
alpha += 0.30 * gl_t
# posts
ph = np.abs(((UU / PITCH + 0.5) % 1.0) - 0.5) * PITCH
post = (1 - soft(0.035, ph)) * gl_t
rgb = rgb * (1 - post[..., None]) + (GLASS * 0.45) * post[..., None]
alpha = np.maximum(alpha, 0.85 * post)
# dashers: opaque
dash = (1 - gl_t) * soft(KICK_H, YY)
rgb = rgb * (1 - dash[..., None]) + DASH * dash[..., None]
alpha = np.maximum(alpha, dash)
# cap along the top of the dashers
cap = (1 - soft(BOARD_H, YY)) * soft(BOARD_H - CAP_H, YY)
rgb = rgb * (1 - cap[..., None]) + CAP * cap[..., None]
alpha = np.maximum(alpha, cap)
# kickplate at the bottom
kick = 1 - soft(KICK_H, YY)
rgb = rgb * (1 - kick[..., None]) + KICK * kick[..., None]
alpha = np.maximum(alpha, kick)

Image.fromarray(np.dstack([np.clip(rgb, 0, 255),
                           np.clip(alpha * 255, 0, 255)]).astype(np.uint8),
                'RGBA').save('rink_boards.png')
json.dump({'w': SW, 'h': SH, 'perimeter_m': PERIM, 'glass_top': GLASS_TOP,
           'board_h': BOARD_H, 'panel_pitch_m': PITCH,
           'palette': {'kickplate': [float(x) for x in KICK],
                       'dasher': [float(x) for x in DASH],
                       'cap': [float(x) for x in CAP],
                       'glass': [float(x) for x in GLASS]}},
          open('rink_boards.json', 'w'), indent=1)
print('wrote rink_boards.png %dx%d' % (SW, SH))
