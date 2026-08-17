"""Compare the IK export against the SHIPPED payload, bone by bone.

Rig compatibility is a measurement, not an assumption (README). This answers
two questions before anything is spliced:

  1. Do the two rigs share a rest pose?  (bind translation per shared bone)
  2. Per clip, per bone, how far apart are the local rotations?

Expected shape of the answer: everything that is not an arm agrees to a small
fraction of a degree (same underlying animation, exported twice), and the six
arm/hand bones disagree by tens of degrees -- that difference IS the grip, and
it is the reason for the swap: the IK export's version of it is the animator's,
the payload's is ours.
"""
import base64, json, re, struct, sys
import numpy as np
from glb import read_glb, read_accessor

HTML = '/home/sara/Työpöytä/hoki/game/ice_hockey.html'
IK = 'ik_anim.glb'

_RES = re.compile(r'[.\[\]:/]')
EXACT = {'spine': 'spine_01', 'spine1': 'spine_02', 'spine2': 'spine_03', 'neck1': 'neck_01'}
SIDED = {'upper_arm': 'upperarm', 'forearm': 'lowerarm', 'hand': 'hand',
         'thigh': 'thigh', 'shin': 'calf', 'foot': 'foot'}


def remap(n):
    n = _RES.sub('', re.sub(r'\s', '_', n or ''))
    if n in EXACT:
        return EXACT[n]
    for base, out in SIDED.items():
        if n == base + 'L':
            return out + '_l'
        if n == base + 'R':
            return out + '_r'
    return n


def payload():
    s = open(HTML, encoding='utf-8').read()
    raw = base64.b64decode(re.search(r'const ANIM_B64="([A-Za-z0-9+/=]+)"', s).group(1))
    off = 12
    js = None
    bn = b''
    while off < len(raw):
        clen, ctype = struct.unpack('<II', raw[off:off+8])
        off += 8
        ch = raw[off:off+clen]
        off += clen
        if ctype == 0x4E4F534A:
            js = json.loads(ch.decode('utf-8'))
        elif ctype == 0x004E4942:
            bn = ch
    return js, bn


PJ, PB = payload()
IJ, IB = read_glb(IK)
pname = [n.get('name') or '' for n in PJ['nodes']]
iname = [remap(n.get('name')) for n in IJ['nodes']]
pidx = {n: i for i, n in enumerate(pname)}

shared = [n for n in iname if n in pidx]
print('payload nodes %d, ik nodes %d, shared %d' % (len(pname), len(iname), len(shared)))
print('ik-only :', sorted(set(iname) - set(pname)))
print('payload-only:', sorted(set(pname) - set(iname)))

# ---- 1. rest pose ---------------------------------------------------------
worst = ('', 0.0)
for n in shared:
    a = np.array(PJ['nodes'][pidx[n]].get('translation', [0, 0, 0]), float)
    b = np.array(IJ['nodes'][iname.index(n)].get('translation', [0, 0, 0]), float)
    d = float(np.linalg.norm(a-b))
    if d > worst[1]:
        worst = (n, d)
print('worst rest-pose bone offset: %s %.6f m' % worst)


def tracks(J, B, nm, names):
    a = [x for x in J['animations'] if x['name'] == nm][0]
    out = {}
    for c in a['channels']:
        if c['target']['path'] != 'rotation':
            continue
        sm = a['samplers'][c['sampler']]
        ts = np.array(read_accessor(J, B, sm['input']), float)[:, 0]
        vs = np.array(read_accessor(J, B, sm['output']), float)
        out[names[c['target']['node']]] = (ts, vs)
    return out


def at(tr, t):
    ts, vs = tr
    if len(ts) == 1:
        return vs[0]
    k = max(0, min(int(np.searchsorted(ts, t, 'right'))-1, len(ts)-2))
    f = 0.0 if ts[k+1] == ts[k] else (t-ts[k])/(ts[k+1]-ts[k])
    q0, q1 = vs[k], vs[k+1]
    if np.dot(q0, q1) < 0:
        q1 = -q1
    q = q0 + (q1-q0)*f
    return q/np.linalg.norm(q)


def ang(q0, q1):
    d = abs(float(np.dot(q0, q1)))
    return float(np.degrees(2*np.arccos(min(1.0, d))))


ARMS = {'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r'}
print('\n%-24s %10s %10s   %s' % ('clip', 'nonArmMax', 'armMax', 'worst non-arm bone'))
for nm in [a['name'] for a in IJ['animations']]:
    out = nm[1:]
    if out not in {a['name'] for a in PJ['animations']}:
        print('%-24s  (not in payload)' % out)
        continue
    ti = tracks(IJ, IB, nm, iname)
    tp = tracks(PJ, PB, out, pname)
    di = max(t[-1] for t, _ in ti.values())
    dp = max(t[-1] for t, _ in tp.values())
    na, am, wb = 0.0, 0.0, ''
    for u in np.linspace(0, 1, 61):
        for b in shared:
            if b not in ti or b not in tp:
                continue
            e = ang(at(ti[b], u*di), at(tp[b], u*dp))
            if b in ARMS:
                am = max(am, e)
            elif e > na:
                na, wb = e, b
    print('%-24s %10.4f %10.3f   %s' % (out, na, am, wb))
