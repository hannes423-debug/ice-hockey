"""Measure the IK export: do the authored fists actually ride the `stick` bone?

Reads ik_anim.glb (export_ik.py) standalone -- no payload, no game -- and for
every clip, every frame, reports

  * which local axis of the `stick` node the two hands line up with,
  * the perpendicular distance of each wrist to that shaft line,
  * the wrist-to-wrist spacing,
  * how far the stick travels relative to the pelvis (is it animated at all?).

The bake's own per-key error is a tautology (README), so nothing here is
compared against anything this script computed: the shaft comes from the
`stick` bone and the wrists from the arm chain, two independent parts of the
rig.
"""
import numpy as np
from glb import read_glb, read_accessor

J, B = read_glb('ik_anim.glb')
nodes = J['nodes']
name = [n.get('name') or '' for n in nodes]
idx = {n: i for i, n in enumerate(name)}
parent = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []):
        parent[c] = i
roots = [i for i in range(len(nodes)) if i not in parent]


def quat2mat(q):
    x, y, z, w = q
    n = x*x + y*y + z*z + w*w
    if n < 1e-12:
        return np.eye(3)
    s = 2.0 / n
    return np.array([
        [1-s*(y*y+z*z), s*(x*y-z*w),   s*(x*z+y*w)],
        [s*(x*y+z*w),   1-s*(x*x+z*z), s*(y*z-x*w)],
        [s*(x*z-y*w),   s*(y*z+x*w),   1-s*(x*x+y*y)]])


def trs(t, q, s):
    M = np.eye(4)
    M[:3, :3] = quat2mat(q) * np.array(s)
    M[:3, 3] = t
    return M


def bind_locals():
    return [(np.array(n.get('translation', [0, 0, 0]), float),
             np.array(n.get('rotation', [0, 0, 0, 1]), float),
             np.array(n.get('scale', [1, 1, 1]), float)) for n in nodes]


def world(L):
    W = [None]*len(nodes)

    def rec(i, P):
        M = P @ trs(*L[i])
        W[i] = M
        for c in nodes[i].get('children', []):
            rec(c, M)
    for r in roots:
        rec(r, np.eye(4))
    return W


def clip(nm):
    a = [x for x in J['animations'] if x['name'] == nm][0]
    ch = {}
    for c in a['channels']:
        sm = a['samplers'][c['sampler']]
        ts = np.array(read_accessor(J, B, sm['input']), float)[:, 0]
        vs = np.array(read_accessor(J, B, sm['output']), float)
        ch.setdefault(c['target']['node'], {})[c['target']['path']] = (ts, vs)
    dur = max(t[-1] for v in ch.values() for t, _ in v.values())
    return ch, dur


def sample(ch, t):
    L = bind_locals()
    for i, paths in ch.items():
        tr, ro, sc = L[i]
        for path, (ts, vs) in paths.items():
            if len(ts) == 1:
                v = vs[0]
            else:
                k = max(0, min(int(np.searchsorted(ts, t, 'right'))-1, len(ts)-2))
                f = 0.0 if ts[k+1] == ts[k] else (t-ts[k])/(ts[k+1]-ts[k])
                if path == 'rotation':
                    q0, q1 = vs[k], vs[k+1]
                    if np.dot(q0, q1) < 0:
                        q1 = -q1
                    v = q0 + (q1-q0)*f
                    v = v/np.linalg.norm(v)
                else:
                    v = vs[k] + (vs[k+1]-vs[k])*f
            if path == 'rotation':
                ro = v
            elif path == 'translation':
                tr = v
            else:
                sc = v
        L[i] = (tr, ro, sc)
    return world(L)


STICK, HL, HR = idx['stick'], idx['hand.L'], idx['hand.R']
PELV = idx['spine']
clips = [a['name'] for a in J['animations']]
print('nodes: %d   clips: %d' % (len(nodes), len(clips)))
print('stick node %d, parent %s' % (STICK, name[parent.get(STICK, -1)]))

# ---- 1. which stick axis is the shaft? test all three over every clip -------
axerr = np.zeros(3)
nfr = 0
for nm in clips:
    ch, dur = clip(nm)
    for t in np.linspace(0, dur, 25):
        W = sample(ch, t)
        o = W[STICK][:3, 3]
        pl, pr = W[HL][:3, 3], W[HR][:3, 3]
        for k in range(3):
            d = W[STICK][:3, k]
            d = d/np.linalg.norm(d)
            for p in (pl, pr):
                v = p - o
                axerr[k] += np.linalg.norm(v - np.dot(v, d)*d)
        nfr += 1
axerr /= (2*nfr)
print('mean wrist-to-axis distance by stick local axis: '
      'X %.4f  Y %.4f  Z %.4f  m' % tuple(axerr))
AX = int(np.argmin(axerr))
print('=> shaft axis is local %s\n' % 'XYZ'[AX])

# ---- 2. per clip: wrists on the shaft, spacing, stick travel ---------------
print('%-24s %7s %7s %7s %7s %8s %8s' %
      ('clip', 'dL', 'dR', 'maxd', 'spacMin', 'spacMax', 'stickTrav'))
worst = 0.0
for nm in clips:
    ch, dur = clip(nm)
    dl, dr, sp, rel = [], [], [], []
    for t in np.linspace(0, dur, 60):
        W = sample(ch, t)
        o = W[STICK][:3, 3]
        d = W[STICK][:3, AX]
        d = d/np.linalg.norm(d)
        pl, pr = W[HL][:3, 3], W[HR][:3, 3]
        for p, acc in ((pl, dl), (pr, dr)):
            v = p-o
            acc.append(np.linalg.norm(v - np.dot(v, d)*d))
        sp.append(np.linalg.norm(pl-pr))
        # stick pose in pelvis space -- is it animated relative to the body?
        Pi = np.linalg.inv(W[PELV])
        rel.append((Pi @ np.append(o, 1.0))[:3])
    rel = np.array(rel)
    trav = float(np.linalg.norm(rel.max(0)-rel.min(0)))
    worst = max(worst, max(max(dl), max(dr)))
    print('%-24s %7.4f %7.4f %7.4f %7.3f %8.3f %8.3f' %
          (nm, np.mean(dl), np.mean(dr), max(max(dl), max(dr)),
           min(sp), max(sp), trav))
print('\nworst wrist-off-shaft over the pack: %.4f m' % worst)
