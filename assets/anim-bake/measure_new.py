"""Do the NEW clips already hold a stick, as delivered?

Control group: '1IdleN' from the same export is the RAW version of a clip whose
baked twin is in the shipped payload, so it is a known-BAD sample. If the 2*
clips measure like 1IdleN, the animator again did not place the arms on a shaft
and they need the same bake. If they measure like a real grip, they do not.
"""
exec(open('fk.py').read())
import numpy as np, math, sys
sys.path.insert(0, '..')
from glb import read_glb, read_accessor

AX = np.load('gripaxis.npy')
GRIP_AX_R, GRIP_CTR_R, GRIP_AX_L, GRIP_CTR_L = AX[0], AX[1], AX[2], AX[3]

NJ, NB = read_glb('../new_anim.glb')
nanames = [remap(n.get('name') or '') for n in NJ['nodes']]

def nclip(name):
    a = [x for x in NJ['animations'] if x['name'] == name][0]
    ch = {}
    for c in a['channels']:
        sm = a['samplers'][c['sampler']]
        ti = np.array(read_accessor(NJ, NB, sm['input']), float)[:, 0]
        vo = np.array(read_accessor(NJ, NB, sm['output']), float)
        ch.setdefault(nanames[c['target']['node']], {})[c['target']['path']] = (ti, vo)
    dur = max(t[-1] for v in ch.values() for t, _ in v.values())
    return ch, dur

def gripworld(W):
    out = {}
    for side, hb, ctr, ax in (('r', 'hand_r', GRIP_CTR_R, GRIP_AX_R),
                              ('l', 'hand_l', GRIP_CTR_L, GRIP_AX_L)):
        H = W[byname[hb]]
        out[side] = ((H @ np.append(ctr, 1.0))[:3], (H[:3, :3] @ ax))
    return out

print("%-16s %8s %8s %8s %8s" % ("clip", "sep_min", "sep_max", "axis_err", "verdict"))
print("  sep = distance between the two grip tunnels (a real two-hand grip: 0.26-0.44 m)")
print("  axis_err = angle between the right hand's own tunnel axis and the line")
print("             joining the two grips, in degrees (a real grip: ~0)")
print()
for cn in ['1IdleN', '1Shooting', '2Acceleration', '2GlideForward', '2SlapShot',
           '2Stop', '2StopHockey', '2TurnPunchL', '2TurnPunchR',
           '2TurnTightL', '2TurnTightR']:
    ch, dur = nclip(cn)
    seps, errs = [], []
    n = 24
    for k in range(n):
        t = dur * k / (n - 1 if n > 1 else 1)
        W = sample(ch, t)
        g = gripworld(W)
        d = g['l'][0] - g['r'][0]
        L = np.linalg.norm(d)
        seps.append(L * SCALE)
        if L > 1e-9:
            u = d / L
            c = abs(np.dot(u, g['r'][1] / np.linalg.norm(g['r'][1])))
            errs.append(math.degrees(math.acos(min(1.0, c))))
    ok = (min(seps) > 0.20 and max(seps) < 0.55 and max(errs) < 8.0)
    tag = 'HOLDS A STICK' if ok else 'no stick'
    mark = '   <-- known-BAD control' if cn in ('1IdleN', '1Shooting') else ''
    print("%-16s %8.3f %8.3f %8.2f  %-14s%s" % (cn, min(seps), max(seps), max(errs), tag, mark))
