"""Rebuild ANIM_B64 with the animator's AUTHORED grip where he authored one.

The 2026-08-01 grip bake exists because the clips we were given did not hold a
stick. They do -- in the IK blend. `handIK.L`/`handIK.R` are CHILD_OF the
metarig's `stick` bone, so the animator's fists ride the authored shaft
exactly; the conversion to the non-IK rig is what threw the stick away, and the
bake has been re-inventing it ever since (measured: 125-180 deg apart, cmp_ik).

ONLY 9 OF THE 16 IK CLIPS ARE TAKEN, and the split is a measurement, not a
guess: `stickpose.py` evaluates the stick armature in Blender and reads the
blade tip's world height. In seven clips -- IdleN, WalkForward, WalkBackward,
Acceleration, GlideForward, Stop, StopHockey, i.e. the earliest batch, before
the stick control existed -- the `stick` bone was never keyed. It sits at its
rest transform, horizontal at chest height, and because both fists are CHILD_OF
it they ride it up there: blade tip 0.75-1.24 m off the ice for the whole clip.
Shipping those would put a floating horizontal stick on the most-used states in
the game. They keep the old bake, which at least pins the blade to the ice.

Everything else -- the 12 stance-pack clips (transitions, windmill, spinorama)
that exist ONLY on the non-IK rig -- is copied through untouched, sampler bytes
and all.

The whole payload is rebuilt into a fresh buffer rather than patched in place:
the shipped one already carries 217 orphaned accessors from earlier in-place
rewrites, and replacing a clip's samplers would orphan 16 clips' worth more.

    blender -b '<IK>.blend' -P export_ik.py -- ik_anim.glb
    python3 cmp_ik.py            # rig compatibility is a measurement
    python3 merge_ik.py          # -> anim_ik.b64
    python3 splice.py anim_ik.b64
    python3 verify_ik.py         # both fists on one shaft, from the fingers

Conventions matched from merge.py: runtime node names, rotation on all 63 bones
plus translation on `root` only, 24 fps, constant channels collapsed to one key.
"""
import base64, json, os, re, struct
import numpy as np
from glb import read_glb, read_accessor

HTML = '/home/sara/Työpöytä/hoki/game/ice_hockey.html'
IK = 'ik_anim.glb'
OUT = 'anim_ik.b64'
RETIME = 30.0 / 24.0          # the IK blend's scene is 30 fps, payload is 24
EPS_ROT, EPS_TRA = 1e-6, 1e-7

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
off = 12
PJ, PB = None, b''
while off < len(raw):
    clen, ctype = struct.unpack('<II', raw[off:off+8])
    off += 8
    ch = raw[off:off+clen]
    off += clen
    if ctype == 0x4E4F534A:
        PJ = json.loads(ch.decode('utf-8'))
    elif ctype == 0x004E4942:
        PB = ch

IJ, IB = read_glb(IK)
pname = [n.get('name') or '' for n in PJ['nodes']]
iname = [remap(n.get('name')) for n in IJ['nodes']]
pidx = {n: i for i, n in enumerate(pname)}
ROOT = pidx['root']

# node lists must agree on the 63 bones the payload carries; the IK export
# additionally carries the 10 rig controls, which are dropped here.
missing = [n for n in pname if n not in iname]
assert not missing, 'IK export is missing payload nodes: %s' % missing

# the animator keyed the `stick` control in these and only these -- stickpose.py
POSED = {'1IdleL', '1IdleR', '1Shooting', '1WalkForwardWithPuck', '2SlapShot',
         '2TurnPunchL', '2TurnPunchR', '2TurnTightL', '2TurnTightR'}
have = {a['name'] for a in IJ['animations']}
assert POSED <= have, 'IK export is missing posed clips: %s' % (POSED - have)
# IKSET=all takes the other seven too, floating stick and all -- an A/B only.
TAKE = have if os.environ.get('IKSET') == 'all' else POSED
IKCLIPS = {a['name'][1:]: a['name'] for a in IJ['animations']   # '1IdleN' -> 'IdleN'
           if a['name'] in TAKE}
present = {a['name'] for a in PJ['animations']}
assert set(IKCLIPS) <= present, 'IK clips not in payload: %s' % (set(IKCLIPS) - present)

OJ = {'asset': PJ['asset'], 'scene': PJ['scene'], 'scenes': PJ['scenes'],
      'nodes': PJ['nodes'], 'animations': [],
      'accessors': [], 'bufferViews': [], 'buffers': [{'byteLength': 0}]}
blob = bytearray()


def add_acc(arr, typ, minmax=False):
    """arr must stay 2-D for VEC types: accessor.count comes from len(arr)."""
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
    """Re-emit a shipped clip's samplers into the fresh buffer, values intact."""
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


def ik_clip(out_name, src_name):
    src = [x for x in IJ['animations'] if x['name'] == src_name][0]
    got = {}
    for c in src['channels']:
        sm = src['samplers'][c['sampler']]
        ti = np.array(read_accessor(IJ, IB, sm['input']), dtype=np.float64)[:, 0] * RETIME
        vo = np.array(read_accessor(IJ, IB, sm['output']), dtype=np.float64)
        got[(iname[c['target']['node']], c['target']['path'])] = (ti, vo)
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
    if nm in IKCLIPS:
        clip, dur, nkeys = ik_clip(nm, IKCLIPS[nm])
        olddur = max(float(np.array(read_accessor(PJ, PB, src['samplers'][c['sampler']]['input']),
                                    dtype=np.float64)[:, 0].max())
                     for c in src['channels'])
        report.append(('IK   ' + nm, len(clip['channels']), dur, olddur, nkeys))
    else:
        clip = copy_clip(src)
        dur = max(float(np.array(read_accessor(PJ, PB, src['samplers'][c['sampler']]['input']),
                                 dtype=np.float64)[:, 0].max())
                  for c in src['channels'])
        report.append(('keep ' + nm, len(clip['channels']), dur, dur, 0))
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
# verify_ik.py reads this so its report can never disagree with what was built
json.dump({'ik': sorted(IKCLIPS), 'kept': sorted(set(present) - set(IKCLIPS))},
          open('anim_ik.clips.json', 'w'), indent=1)

print('%-30s %5s %8s %8s %7s' % ('clip', 'chans', 'dur', 'oldDur', 'keys'))
for r in report:
    print('%-30s %5d %8.3f %8.3f %7d' % r)
bad = [r for r in report if r[0].startswith('IK') and abs(r[2]-r[3]) > 1e-3]
print('\nclips whose duration CHANGED (must be none -- the graph is tuned to them): %d'
      % len(bad))
for r in bad:
    print('  ', r[0], r[2], 'vs', r[3])
print('accessors %d -> %d, animations %d, base64 %d -> %d chars'
      % (len(PJ['accessors']), len(OJ['accessors']), len(OJ['animations']),
         len(m.group(1)), len(b64)))
