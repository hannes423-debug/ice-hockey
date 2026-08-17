"""Does ANY rigid stick lock put the blade on the ice in a given clip?

sticklock.py carried the animator's own neutral grip onto the non-IK pack and it
reproduced every clip that exists in both blends exactly -- and put the blade
0.55-1.24 m in the air on the six clips that still carry the 08-01 bake. That
rules out THAT grip. It does not yet rule out every grip: maybe those six hold a
stick at some other offset.

This decides it. The rigid-lock hypothesis says the blade tip is

    tip(t) = HL(t) @ tL          with tL CONSTANT in hand.L's frame

so "blade on the ice for the whole clip" means (HL(t) @ tL).z = ICE for every
frame. With the butt pinned at the measured fist offset and the shaft length
fixed at the animator's 1.594 m, tL has just two free angles. Sweeping the whole
sphere and reporting the BEST achievable residual answers the question outright:

  * small residual  -> a rigid grip exists, we can build the stick ourselves and
                       never touch the arms
  * large residual  -> the hands do not hold any stick that reaches the ice, and
                       no lock, bake or solver can change that. The arms are the
                       thing that is wrong.

    blender -b '<nonIK>.blend' -P gripsolve.py

Nothing is fitted to hand.R here, and the best case is deliberately generous:
the butt is free to sit anywhere within a fist of the measured point.
"""
import json
import bpy
import numpy as np
from mathutils import Vector

sc = bpy.context.scene
mr = bpy.data.objects['metarig']
G = json.load(open('gripfit.json'))
NEUTRAL = G['ends']['2TurnTightL']
bL = np.array(NEUTRAL['butt'])
LEN = NEUTRAL['len']
ICE = 0.03          # the posed clips measure 0.016-0.063 with the toe at ~0.10
BROKEN = ['1WalkForward', '1WalkBackward', '2Acceleration', '2GlideForward',
          '2Stop', '2StopHockey']
CONTROL = ['1IdleL', '1IdleR', '1WalkForwardWithPuck', '2TurnTightL',
           '0IdleForeHand', '0IdleBackHand', '3SpinoramaL']


def handmats(cn):
    act = bpy.data.actions[cn]
    mr.animation_data.action = act
    f0, f1 = [int(round(x)) for x in act.frame_range]
    out = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        me = mr.evaluated_get(dg)
        out.append(np.array(me.matrix_world @ me.pose.bones['hand.L'].matrix))
    return np.array(out)


# unit sphere, ~2 deg resolution, refined around the winner
def sphere(n_theta=90, n_phi=180):
    th = np.linspace(0, np.pi, n_theta)
    ph = np.linspace(0, 2*np.pi, n_phi, endpoint=False)
    T, P = np.meshgrid(th, ph, indexing='ij')
    return np.stack([np.sin(T)*np.cos(P), np.sin(T)*np.sin(P), np.cos(T)],
                    -1).reshape(-1, 3)


U = sphere()


def best_lock(H):
    """worst |tipZ - ICE| over the clip, minimised over every shaft direction"""
    tips = bL[None, :] + LEN * U                       # (U,3) candidate tips
    # world tip z for every frame and every candidate:  z = R[2,:] . t + o[2]
    R2 = H[:, 2, :3]                                   # (F,3)
    o2 = H[:, 2, 3]                                    # (F,)
    Z = tips @ R2.T + o2[None, :]                      # (U,F)
    err = np.abs(Z - ICE)
    worst = err.max(1)
    k = int(np.argmin(worst))
    return float(worst[k]), float(np.sqrt((err[k]**2).mean())), U[k]


print('%-30s %9s %9s %8s  %s'
      % ('clip', 'bestMax', 'bestRms', 'meanTipZ', 'verdict'))
res = {}
for cn in sorted(a.name for a in bpy.data.actions):
    act = bpy.data.actions[cn]
    if act.frame_range[1] - act.frame_range[0] < 0.5:
        continue
    if cn not in BROKEN and cn not in CONTROL:
        continue
    H = handmats(cn)
    mx, rms, u = best_lock(H)
    tip = bL + LEN * u
    Z = (H[:, 2, :3] @ tip) + H[:, 2, 3]
    tag = 'BROKEN' if cn in BROKEN else 'control'
    ok = mx < 0.10
    res[cn] = mx
    print('%-30s %9.4f %9.4f %8.3f  %-7s %s'
          % (cn, mx, rms, Z.mean(), tag,
             'a rigid grip reaches the ice' if ok
             else 'NO rigid grip reaches the ice'))

print('\nbest achievable worst-error, six broken clips: %.3f - %.3f m'
      % (min(res[c] for c in BROKEN), max(res[c] for c in BROKEN)))
print('best achievable worst-error, controls          : %.3f - %.3f m'
      % (min(res[c] for c in CONTROL if c in res),
         max(res[c] for c in CONTROL if c in res)))
