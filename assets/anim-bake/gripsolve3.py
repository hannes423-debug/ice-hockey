"""Is the fitted grip DETERMINED, or is the solver just exploiting slack?

gripsolve.py found a rigid lock that keeps the blade within 3-103 mm of the ice
for all six broken clips, which looked like good news. gripsolve2.py then showed
those six fitted grips disagree with each other by up to 110 deg and that one
joint offset fails at 0.263 m. Both cannot be true of a real stick.

The resolution is that "blade on the ice" is ONE equation per frame against TWO
free angles, so on arms that hold no stick the optimiser can always find some
direction that grazes z=0. That is the tautology trap wearing a new coat: the
residual measures the constraint it was handed, not whether a stick is there.

So measure the thing that actually distinguishes them -- how BIG the near-
optimal set is:

    slack% = share of all shaft directions that keep the blade within 5 cm of
             the ice for the whole clip

On a clip that really holds a stick, only the true grip qualifies and slack% is
a sliver. On arms swinging free, a whole band of the sphere qualifies and the
winner among them is arbitrary. The controls are clips the animator POSED, so
they calibrate the scale rather than merely illustrating it.

Also fixes gripsolve2's body frame. It read the tip in the `spine` bone's axes,
but a Blender spine bone points UP its own length, so "fwd" there was not
forward and every clip -- controls included -- came out BEHIND. Forward is taken
from the skater's own feet instead: heel.02.R -> toe.R, projected on the ice.

    blender -b '<nonIK>.blend' -P gripsolve3.py
"""
import json
import bpy
import numpy as np

sc = bpy.context.scene
mr = bpy.data.objects['metarig']
G = json.load(open('gripfit.json'))
NEUTRAL = G['ends']['2TurnTightL']
bL = np.array(NEUTRAL['butt'])
tL_auth = np.array(NEUTRAL['tip'])
LEN = NEUTRAL['len']
ICE, TOL = 0.03, 0.05
BROKEN = ['1WalkForward', '1WalkBackward', '2Acceleration', '2GlideForward',
          '2Stop', '2StopHockey']
CONTROL = ['1IdleL', '1IdleR', '1WalkForwardWithPuck', '2TurnTightL',
           '2TurnTightR', '0IdleForeHand', '0IdleBackHand']


def sample(cn):
    act = bpy.data.actions[cn]
    mr.animation_data.action = act
    f0, f1 = [int(round(x)) for x in act.frame_range]
    HL, ORG, FWD = [], [], []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        me = mr.evaluated_get(dg)
        HL.append(np.array(me.matrix_world @ me.pose.bones['hand.L'].matrix))
        MW = me.matrix_world
        heel = np.array(MW @ me.pose.bones['heel.02.R'].head)
        toe = np.array(MW @ me.pose.bones['toe.R'].head)
        pel = np.array((MW @ me.pose.bones['spine'].matrix).translation)
        d = toe - heel
        d[2] = 0.0
        n = np.linalg.norm(d)
        FWD.append(d/n if n > 1e-6 else np.array([0.0, 1.0, 0.0]))
        ORG.append(pel)
    return np.array(HL), np.array(ORG), np.array(FWD)


def sphere(n_theta=180, n_phi=360):
    th = np.linspace(0, np.pi, n_theta)
    ph = np.linspace(0, 2*np.pi, n_phi, endpoint=False)
    T, P = np.meshgrid(th, ph, indexing='ij')
    U = np.stack([np.sin(T)*np.cos(P), np.sin(T)*np.sin(P), np.cos(T)],
                 -1).reshape(-1, 3)
    W = np.repeat(np.sin(th), n_phi)          # solid-angle weight per sample
    return U, W/W.sum()


U, W = sphere()
TIPS = bL[None, :] + LEN * U
auth = (tL_auth - bL)/np.linalg.norm(tL_auth - bL)

print('%-24s %8s %7s %8s %8s %8s  %s'
      % ('clip', 'bestMax', 'slack%', 'vsAuth', 'fwd', 'lat', 'blade sits'))
out = {}
for cn in BROKEN + CONTROL:
    H, ORG, FWD = sample(cn)
    Z = TIPS @ H[:, 2, :3].T + H[:, 2, 3][None, :]
    worst = np.abs(Z - ICE).max(1)
    k = int(np.argmin(worst))
    slack = float(W[worst < TOL].sum()) * 100.0
    u = U[k]
    tipW = np.einsum('fij,j->fi', H[:, :3, :3], bL + LEN*u) + H[:, :3, 3]
    rel = tipW - ORG
    fwd = float(np.mean(np.einsum('fi,fi->f', rel, FWD)))
    side = np.cross(np.column_stack([FWD[:, 0], FWD[:, 1], np.zeros(len(FWD))]),
                    np.array([0.0, 0.0, 1.0]))
    lat = float(np.mean(np.einsum('fi,fi->f', rel, side)))
    ang = float(np.degrees(np.arccos(np.clip(u @ auth, -1, 1))))
    out[cn] = dict(best=float(worst[k]), slack=slack, ang=ang, fwd=fwd)
    print('%-24s %8.4f %7.2f %8.1f %8.3f %8.3f  %s%s'
          % (cn, worst[k], slack, ang, fwd, lat,
             'in front' if fwd > 0.10 else
             ('behind' if fwd < -0.10 else 'at the feet'),
             '' if cn in BROKEN else '   (control)'))

b = [out[c]['slack'] for c in BROKEN]
c = [out[c]['slack'] for c in CONTROL]
print('\nslack%% (share of ALL shaft directions that keep the blade within '
      '%.0f cm of the ice):' % (TOL*100))
print('  six broken clips : %.2f - %.2f  (median %.2f)'
      % (min(b), max(b), float(np.median(b))))
print('  posed controls   : %.2f - %.2f  (median %.2f)'
      % (min(c), max(c), float(np.median(c))))
print('\nratio of medians: %.1fx more directions qualify on the broken clips'
      % (np.median(b)/max(np.median(c), 1e-9)))
json.dump(out, open('gripsolve3.json', 'w'), indent=1)
print('-> gripsolve3.json')
