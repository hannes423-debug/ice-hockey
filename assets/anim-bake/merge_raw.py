"""Put the animator's RAW arms back into the stance clips, undoing the bake.

Why this exists. IH_GRIP_FRAMES in ice_hockey.html locks the stick to hand_l
using offsets measured off the animator's own file. Wiring it up and measuring
the result gave a blade 1.56 m in the air, and the reason was not the offsets:
the payload's stance clips do not carry his arms at all. The 08-15 pass re-baked
them onto a synthesised shaft, so in `IdleForeHandPulledBack` the other fist
sits at (0.125, 0.007, +0.449) in hand_l's frame where the blend has
(0.031, 0.016, -0.616) -- opposite side, 0.15 m closer. A grip offset measured
on his hands cannot be applied to somebody else's.

So the arms have to come back before the grip can be used. This is the same
rebuild merge_ik.py does for the nine IK clips, sourced instead from
assets/new_anim.glb -- the raw 31-action export of the non-IK blend, taken
2026-08-15 15:23, hours BEFORE the bake solve at 19:37. Whole clips, not just
the arm tracks: the body motion in the raw export is the same motion the bake
started from, so taking the clip wholesale restores exactly the pre-bake state
and cannot leave arms and body disagreeing about a frame.

ONLY THE SEVEN MEASURED-GOOD STANCE CLIPS. The four transitions that touch
Neutral, and IdleN, are left baked on purpose: Neutral is a stickless
arms-at-the-sides pose, so restoring raw arms there would hand the stick to
hands that are not holding one. Same for the six broken skating clips, which
need the animator (assets/anim-bake/ANIMATOR_ASK.txt).

    python3 merge_raw.py         # -> anim_raw.b64
    python3 splice.py anim_raw.b64
    ../../game/handframe.sh IdleForeHandPulledBack 0.5

Conventions copied from merge_ik.py: runtime node names, rotation on all 63
bones plus translation on `root` only, constant channels collapsed to one key,
whole payload rebuilt into a fresh buffer rather than patched in place.
"""
import base64, json, re, struct
import numpy as np
from glb import read_glb, read_accessor

HTML = '/home/sara/Työpöytä/hoki/game/ice_hockey.html'
SRC = '../new_anim.glb'
OUT = 'anim_raw.b64'
EPS_ROT, EPS_TRA = 1e-6, 1e-7

# payload name -> raw-export action name
STANCE = {
    'IdleForeHandPulledBack': '0IdleForeHandPulledBack',
    'IdleBackHandToForeHand': '0IdleBackHandToForeHand',
    'IdleForeHandToBackHand': '0IdleForeHandToBackHand',
    'WindmillDekeL': '3WindmillDekeL',
    'WindmillDekeR': '3WindmillDekeR',
    'SpinoramaL': '3SpinoramaL',
    'SpinoramaR': '3SpinoramaR',
}

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


html = open(HTML, encoding='utf-8').read()
m = re.search(r'const ANIM_B64="([A-Za-z0-9+/=]+)"', html)
raw = base64.b64decode(m.group(1))
off, PJ, PB = 12, None, b''
while off < len(raw):
    clen, ctype = struct.unpack('<II', raw[off:off+8])
    off += 8
    ch = raw[off:off+clen]
    off += clen
    if ctype == 0x4E4F534A:
        PJ = json.loads(ch.decode('utf-8'))
    elif ctype == 0x004E4942:
        PB = ch

SJ, SB = read_glb(SRC)
pname = [n.get('name') or '' for n in PJ['nodes']]
sname = [remap(n.get('name')) for n in SJ['nodes']]
pidx = {n: i for i, n in enumerate(pname)}
ROOT = pidx['root']
missing = [n for n in pname if n not in sname]
assert not missing, 'raw export is missing payload nodes: %s' % missing
have = {a['name'] for a in SJ['animations']}
assert set(STANCE.values()) <= have, 'raw export is missing: %s' % (set(STANCE.values()) - have)
present = {a['name'] for a in PJ['animations']}
assert set(STANCE) <= present, 'not in payload: %s' % (set(STANCE) - present)


def dur_of(J, B, anim):
    return max(float(np.array(read_accessor(J, B, anim['samplers'][c['sampler']]['input']),
                              dtype=np.float64)[:, 0].max()) for c in anim['channels'])


# RETIME is DERIVED, not assumed. merge_ik hard-codes 30/24 for the IK blend;
# this export may already be at payload rate, and guessing wrong runs the arms
# fast against their own clip's legs (README trap 7).
ratios = []
for pn, sn in STANCE.items():
    pd = dur_of(PJ, PB, [x for x in PJ['animations'] if x['name'] == pn][0])
    sd = dur_of(SJ, SB, [x for x in SJ['animations'] if x['name'] == sn][0])
    ratios.append(pd / sd)
RETIME = float(np.mean(ratios))
print('retime ratios %s -> RETIME %.6f' % (np.round(ratios, 5), RETIME))
assert max(ratios) - min(ratios) < 1e-3, 'clips disagree about the frame rate'

OJ = {'asset': PJ['asset'], 'scene': PJ['scene'], 'scenes': PJ['scenes'],
      'nodes': PJ['nodes'], 'animations': [],
      'accessors': [], 'bufferViews': [], 'buffers': [{'byteLength': 0}]}
blob = bytearray()


def add_acc(arr, typ, minmax=False):
    while len(blob) % 4:
        blob.append(0)
    start = len(blob)
    data = np.asarray(arr, dtype=np.float32).tobytes()
    blob.extend(data)
    OJ['bufferViews'].append({'buffer': 0, 'byteOffset': start, 'byteLength': len(data)})
    a = {'bufferView': len(OJ['bufferViews'])-1, 'componentType': 5126,
         'count': int(len(arr)), 'type': typ}
    if minmax:
        v = np.asarray(arr, dtype=np.float32)
        a['min'] = [float(v.min())]
        a['max'] = [float(v.max())]
    OJ['accessors'].append(a)
    return len(OJ['accessors'])-1


def copy_clip(src):
    samplers, channels = [], []
    for c in src['channels']:
        sm = src['samplers'][c['sampler']]
        ti = np.array(read_accessor(PJ, PB, sm['input']), dtype=np.float64)[:, 0]
        vo = np.array(read_accessor(PJ, PB, sm['output']), dtype=np.float64)
        ii = add_acc(ti, 'SCALAR', minmax=True)
        oi = add_acc(vo, 'VEC4' if c['target']['path'] == 'rotation' else 'VEC3')
        samplers.append({'input': ii, 'output': oi,
                         'interpolation': sm.get('interpolation', 'LINEAR')})
        channels.append({'sampler': len(samplers)-1, 'target': dict(c['target'])})
    return {'name': src['name'], 'samplers': samplers, 'channels': channels}


def raw_clip(out_name, src_name):
    src = [x for x in SJ['animations'] if x['name'] == src_name][0]
    got = {}
    for c in src['channels']:
        sm = src['samplers'][c['sampler']]
        ti = np.array(read_accessor(SJ, SB, sm['input']), dtype=np.float64)[:, 0] * RETIME
        vo = np.array(read_accessor(SJ, SB, sm['output']), dtype=np.float64)
        got[(sname[c['target']['node']], c['target']['path'])] = (ti, vo)
    samplers, channels, nkeys = [], [], 0
    for ni, bn in enumerate(pname):
        wanted = [('rotation', EPS_ROT)]
        if ni == ROOT:
            wanted.append(('translation', EPS_TRA))
        for path, eps in wanted:
            if (bn, path) not in got:
                continue
            ti, vo = got[(bn, path)]
            if len(vo) > 1 and np.abs(vo - vo[0]).max() < eps:
                ti, vo = ti[:1], vo[:1]
            ii = add_acc(ti, 'SCALAR', minmax=True)
            oi = add_acc(vo, 'VEC4' if path == 'rotation' else 'VEC3')
            samplers.append({'input': ii, 'output': oi, 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers)-1,
                             'target': {'node': ni, 'path': path}})
            nkeys += len(ti)
    dur = max(float(t.max()) for (b, p), (t, _) in got.items()
              if p == 'rotation' and b in pidx)
    return {'name': out_name, 'samplers': samplers, 'channels': channels}, dur, nkeys


report = []
for src in PJ['animations']:
    nm = src['name']
    olddur = dur_of(PJ, PB, src)
    if nm in STANCE:
        clip, dur, nkeys = raw_clip(nm, STANCE[nm])
        report.append(('RAW  ' + nm, len(clip['channels']), dur, olddur, nkeys))
    else:
        clip = copy_clip(src)
        report.append(('keep ' + nm, len(clip['channels']), olddur, olddur, 0))
    OJ['animations'].append(clip)

while len(blob) % 4:
    blob.append(0)
OJ['buffers'][0]['byteLength'] = len(blob)
jb = json.dumps(OJ, separators=(',', ':')).encode('utf-8')
while len(jb) % 4:
    jb += b' '
glb = (b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + len(blob))
       + struct.pack('<I', len(jb)) + b'JSON' + jb
       + struct.pack('<I', len(blob)) + b'BIN\x00' + bytes(blob))
b64 = base64.b64encode(glb).decode('ascii')
open(OUT, 'w').write(b64)
json.dump({'raw': sorted(STANCE), 'kept': sorted(present - set(STANCE))},
          open('anim_raw.clips.json', 'w'), indent=1)

print('%-32s %5s %8s %8s %7s' % ('clip', 'chans', 'dur', 'oldDur', 'keys'))
for r in report:
    print('%-32s %5d %8.3f %8.3f %7d' % r)
bad = [r for r in report if r[0].startswith('RAW') and abs(r[2]-r[3]) > 1e-3]
print('\nclips whose duration CHANGED (must be none): %d' % len(bad))
for r in bad:
    print('  ', r[0], r[2], 'vs', r[3])
print('accessors %d -> %d, animations %d, base64 %d -> %d chars'
      % (len(PJ['accessors']), len(OJ['accessors']), len(OJ['animations']),
         len(m.group(1)), len(b64)))
