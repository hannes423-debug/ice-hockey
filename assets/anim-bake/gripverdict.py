"""Calibrate the grip fit against ground truth, then judge the six.

The chain so far:
  handrigid.py  the two fists hold a rigid relative transform in 24 of 30 clips
  knob.py       the shaft is welded to hand.L (the LOWER fist); hand.R pivots
  gripfit.py    the offset, fitted per grip, leave-one-out to 0.011 m / 0.03 deg
  sticklock.py  transplanted onto the non-IK pack: reproduces every clip that
                exists in both blends, and puts the six broken clips 0.55-1.24 m up
  gripsolve*.py a rigid lock CAN graze the ice on the six -- but the six fits
                disagree with each other by up to 110 deg

This script settles it the only way that is not circular: run the SAME fitting
procedure on clips where the animator posed a stick, and compare each fit to
THAT clip's own authored grip. gripsolve3 compared everything to the neutral
grip, so forehand clips scored 44 deg for holding a forehand stick correctly --
a bookkeeping error, not a finding.

If the fit recovers a known grip to a few degrees, the fit is trustworthy, and
then the six clips' mutual disagreement is a statement about the ARMS, not about
the method.

    blender -b '<nonIK>.blend' -P gripverdict.py

Also reports where a REAL blade sits (from the authored offsets, not from any
fit), so the six can be judged against a measured band instead of an opinion.
"""
import json
import bpy
import numpy as np

sc = bpy.context.scene
mr = bpy.data.objects['metarig']
G = json.load(open('gripfit.json'))
ENDS = G['ends']
LEN = ENDS['2TurnTightL']['len']
ICE = 0.03

# which non-IK clip corresponds to which authored grip, by name where the clip
# exists in both blends. Ground truth only -- nothing inferred.
SAME = {'1IdleL': '1IdleL', '1IdleR': '1IdleR', '1Shooting': '1Shooting',
        '1WalkForwardWithPuck': '1WalkForwardWithPuck', '2SlapShot': '2SlapShot',
        '2TurnPunchL': '2TurnPunchL', '2TurnPunchR': '2TurnPunchR',
        '2TurnTightL': '2TurnTightL', '2TurnTightR': '2TurnTightR'}
BROKEN = ['1WalkForward', '1WalkBackward', '2Acceleration', '2GlideForward',
          '2Stop', '2StopHockey']


def sample(cn):
    act = bpy.data.actions[cn]
    mr.animation_data.action = act
    f0, f1 = [int(round(x)) for x in act.frame_range]
    HL, ORG, FWD = [], [], []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        me = mr.evaluated_get(dg)
        MW = me.matrix_world
        HL.append(np.array(MW @ me.pose.bones['hand.L'].matrix))
        heel = np.array(MW @ me.pose.bones['heel.02.R'].head)
        toe = np.array(MW @ me.pose.bones['toe.R'].head)
        d = toe - heel
        d[2] = 0.0
        n = np.linalg.norm(d)
        FWD.append(d/n if n > 1e-6 else np.array([0.0, 1.0, 0.0]))
        ORG.append(np.array((MW @ me.pose.bones['spine'].matrix).translation))
    return np.array(HL), np.array(ORG), np.array(FWD)


def sphere(n_theta=240, n_phi=480):
    th = np.linspace(0, np.pi, n_theta)
    ph = np.linspace(0, 2*np.pi, n_phi, endpoint=False)
    T, P = np.meshgrid(th, ph, indexing='ij')
    return np.stack([np.sin(T)*np.cos(P), np.sin(T)*np.sin(P), np.cos(T)],
                    -1).reshape(-1, 3)


U = sphere()


def place(H, ORG, FWD, tipL):
    tipW = np.einsum('fij,j->fi', H[:, :3, :3], tipL) + H[:, :3, 3]
    rel = tipW - ORG
    side = np.cross(FWD, np.array([0.0, 0.0, 1.0]))
    return (float(np.mean(np.einsum('fi,fi->f', rel, FWD))),
            float(np.mean(np.einsum('fi,fi->f', rel, side))),
            tipW[:, 2])


print('=== CALIBRATION: fit vs the animator\'s OWN grip, same clip ===')
print('%-24s %9s %9s %8s %8s' % ('clip', 'fitVsAuth', 'bestMax', 'authFwd',
                                 'authTipZ'))
cal = []
for cn, src in SAME.items():
    if cn not in bpy.data.actions:
        continue
    H, ORG, FWD = sample(cn)
    bL = np.array(ENDS[src]['butt'])
    tL = np.array(ENDS[src]['tip'])
    auth = (tL - bL)/np.linalg.norm(tL - bL)
    TIPS = bL[None, :] + LEN * U
    Z = TIPS @ H[:, 2, :3].T + H[:, 2, 3][None, :]
    worst = np.abs(Z - ICE).max(1)
    u = U[int(np.argmin(worst))]
    ang = float(np.degrees(np.arccos(np.clip(u @ auth, -1, 1))))
    fwd, lat, tz = place(H, ORG, FWD, tL)
    cal.append((cn, ang, fwd, tz.min(), tz.max()))
    print('%-24s %9.1f %9.4f %8.3f %8.3f'
          % (cn, ang, worst.min(), fwd, tz.min()))

angs = [c[1] for c in cal]
fwds = [c[2] for c in cal]
print('\nthe fit recovers a KNOWN grip to %.1f-%.1f deg (median %.1f)'
      % (min(angs), max(angs), float(np.median(angs))))
print('a REAL blade sits %.2f..%.2f m in front of the pelvis'
      % (min(fwds), max(fwds)))

print('\n=== THE SIX: no authored grip exists, so fit and compare each other ===')
print('%-24s %9s %8s %8s   %s' % ('clip', 'bestMax', 'fwd', 'lat', 'blade'))
bL = np.array(ENDS['2TurnTightL']['butt'])
TIPS = bL[None, :] + LEN * U
dirs = {}
for cn in BROKEN:
    H, ORG, FWD = sample(cn)
    Z = TIPS @ H[:, 2, :3].T + H[:, 2, 3][None, :]
    worst = np.abs(Z - ICE).max(1)
    u = U[int(np.argmin(worst))]
    dirs[cn] = u
    fwd, lat, tz = place(H, ORG, FWD, bL + LEN*u)
    print('%-24s %9.4f %8.3f %8.3f   %s'
          % (cn, worst.min(), fwd, lat,
             'in front' if fwd > 0.10 else
             ('BEHIND the skater' if fwd < -0.10 else 'at the feet')))

P = [np.degrees(np.arccos(np.clip(dirs[a] @ dirs[b], -1, 1)))
     for i, a in enumerate(BROKEN) for b in BROKEN[i+1:]]
print('\nthe six fitted grips disagree with each other by %.0f-%.0f deg '
      '(median %.0f)' % (min(P), max(P), float(np.median(P))))
print('the same fit reproduces a real grip to %.1f deg. The six are not one '
      'stick.' % float(np.median(angs)))
json.dump({'calibration': [[c[0], c[1], c[2]] for c in cal],
           'six_pairwise_deg': P}, open('gripverdict.json', 'w'), indent=1)
print('-> gripverdict.json')
