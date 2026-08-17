"""One grip for the six, or six grips? And does the blade land in FRONT?

gripsolve.py answered the yes/no: a rigid stick locked to hand.L CAN be kept on
the ice through all six clips that still carry the 08-01 bake (worst 3-103 mm).
So the animator's hands do hold a stick there -- just not at the neutral grip
TurnTight uses, which is why transplanting that one put the blade 1 m up.

Three things still decide whether this is shippable, and none of them are
answered by a z-residual:

 1. WHERE the blade lands. z=0 is satisfied just as well by a blade dragging
    behind the player or out to the left. Reported here in PELVIS space:
    forward (+ = in front), lateral, and the toe is at ~0.10 for scale.
 2. WHETHER THE SIX AGREE. A per-clip grip that differs between clips swings
    the stick on every crossfade -- visible, and worse than the defect being
    fixed. Reported as the pairwise angle between fitted shaft directions and
    as the residual of ONE offset fitted jointly to all six.
 3. HOW FAR the fit sits from the animator's own neutral grip, in degrees. That
    number is the size of the wrist-roll drift in the clips he authored before
    the stick control existed.

    blender -b '<nonIK>.blend' -P gripsolve2.py
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
ICE = 0.03
BROKEN = ['1WalkForward', '1WalkBackward', '2Acceleration', '2GlideForward',
          '2Stop', '2StopHockey']
CONTROL = ['1IdleL', '1WalkForwardWithPuck', '2TurnTightL', '0IdleForeHand']


def sample(cn):
    """hand.L matrices and the pelvis frame, per frame"""
    act = bpy.data.actions[cn]
    mr.animation_data.action = act
    f0, f1 = [int(round(x)) for x in act.frame_range]
    HL, PV = [], []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        me = mr.evaluated_get(dg)
        HL.append(np.array(me.matrix_world @ me.pose.bones['hand.L'].matrix))
        PV.append(np.array(me.matrix_world @ me.pose.bones['spine'].matrix))
    return np.array(HL), np.array(PV)


def sphere(n_theta=180, n_phi=360):
    th = np.linspace(0, np.pi, n_theta)
    ph = np.linspace(0, 2*np.pi, n_phi, endpoint=False)
    T, P = np.meshgrid(th, ph, indexing='ij')
    return np.stack([np.sin(T)*np.cos(P), np.sin(T)*np.sin(P), np.cos(T)],
                    -1).reshape(-1, 3)


U = sphere()
TIPS = bL[None, :] + LEN * U


def fit(Hs):
    """direction minimising the worst |tipZ-ICE| over a LIST of clips' frames"""
    R2 = np.concatenate([H[:, 2, :3] for H in Hs])
    o2 = np.concatenate([H[:, 2, 3] for H in Hs])
    Z = TIPS @ R2.T + o2[None, :]
    worst = np.abs(Z - ICE).max(1)
    k = int(np.argmin(worst))
    return U[k], float(worst[k])


data = {}
for cn in BROKEN + CONTROL:
    data[cn] = sample(cn)

print('%-24s %8s   %8s %8s   %8s  %s'
      % ('clip', 'bestMax', 'fwd', 'lat', 'vsNeutral', 'blade sits'))
dirs = {}
for cn in BROKEN + CONTROL:
    H, PV = data[cn]
    u, mx = fit([H])
    dirs[cn] = u
    tipL = bL + LEN * u
    # blade tip in world, then into pelvis space, per frame
    tipW = np.einsum('fij,j->fi', H[:, :3, :3], tipL) + H[:, :3, 3]
    rel = np.einsum('fji,fj->fi', PV[:, :3, :3], tipW - PV[:, :3, 3])
    fwd, lat = rel[:, 1].mean(), rel[:, 0].mean()
    ang = np.degrees(np.arccos(np.clip(
        u @ ((tL_auth - bL)/np.linalg.norm(tL_auth - bL)), -1, 1)))
    where = 'in front' if fwd > 0.15 else ('BEHIND' if fwd < -0.05 else 'at the feet')
    print('%-24s %8.4f   %8.3f %8.3f   %8.1f  %s%s'
          % (cn, mx, fwd, lat, ang, where,
             '' if cn in BROKEN else '   (control)'))

print('\n--- do the six agree with each other? pairwise angle, degrees ---')
print('%-24s %s' % ('', ' '.join('%7s' % c[:7] for c in BROKEN)))
for a in BROKEN:
    row = []
    for b in BROKEN:
        row.append('%7.1f' % np.degrees(np.arccos(np.clip(dirs[a] @ dirs[b],
                                                          -1, 1))))
    print('%-24s %s' % (a, ' '.join(row)))

u_j, mx_j = fit([data[c][0] for c in BROKEN])
print('\nONE offset fitted jointly to all six: worst |tipZ-ice| = %.4f m' % mx_j)
print('  per clip under that one offset:')
for cn in BROKEN:
    H, PV = data[cn]
    tipL = bL + LEN * u_j
    Z = np.einsum('fj,j->f', H[:, 2, :3], tipL) + H[:, 2, 3]
    tipW = np.einsum('fij,j->fi', H[:, :3, :3], tipL) + H[:, :3, 3]
    rel = np.einsum('fji,fj->fi', PV[:, :3, :3], tipW - PV[:, :3, 3])
    print('    %-22s tipZ %.3f..%.3f   fwd %.3f  lat %.3f'
          % (cn, Z.min(), Z.max(), rel[:, 1].mean(), rel[:, 0].mean()))
print('  that joint grip is %.1f deg off the animator\'s neutral grip'
      % np.degrees(np.arccos(np.clip(
          u_j @ ((tL_auth - bL)/np.linalg.norm(tL_auth - bL)), -1, 1))))

json.dump({'joint_dir': list(map(float, u_j)), 'joint_worst': mx_j,
           'butt': list(map(float, bL)), 'len': LEN, 'ice': ICE,
           'per_clip_dir': {k: list(map(float, v)) for k, v in dirs.items()}},
          open('gripsolve.json', 'w'), indent=1)
print('-> gripsolve.json')
