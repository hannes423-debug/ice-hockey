"""Append the clips the 2026-08-17 IK blend ADDS to the payload.

What that blend actually changes is narrower than it looks, and every part of
this was measured before anything was written (see ikmap2.py for the sources):

  * 16 payload clips already carry the animator's arms EXACTLY -- cmp_ik2.py
    reports armMax 0.000 deg against the new export, including all seven that
    the 08-17 pass restored through merge_raw.py + IH_GRIP_FRAMES. Re-sourcing
    them would rewrite bytes and change nothing, so they are copied through.
  * the six skating clips from ANIMATOR_ASK.txt are byte-identical to their
    Aug-4 versions at the raw fcurve level (dump_fcurves.py) and their `stick`
    is still unkeyed (stickpose.py). They keep the old bake. The ask stands.
  * IdleN and the four transitions that touch Neutral have an authored version
    now, but Neutral is still a stickless arms-at-the-sides pose there (blade
    1.04 m up), so taking them would trade the pop stancepop.py measures for a
    stick floating on the most-used idle in the game. Left baked, same reason
    merge_raw.py left them baked. This needs the animator, not a bake.

That leaves exactly one thing to do: BackHandShot is a NEW authored clip with a
posed stick (blade reaches -0.061 m, i.e. the ice) and the payload has no clip
under that name. `type==='backhand'` has been a first-class shot in the sim for
a long time -- its own speed range, follow duration and HUD label -- and it has
been playing the forehand wrist-shot clip for want of anything better.

    blender -b '<IK>.blend' -P export_ik.py -- ik_anim2.glb
    python3 cmp_ik2.py           # rig compatibility is a measurement
    python3 merge_ik2.py         # -> anim_ik2.b64
    python3 splice.py anim_ik2.b64

Conventions copied from merge_ik.py: runtime node names, rotation on all 63
bones plus translation on `root` only, 24 fps, constant channels collapsed to
one key, whole payload rebuilt into a fresh buffer rather than patched.
"""
import base64, json, re, struct
import numpy as np
from glb import read_glb, read_accessor
from ikmap2 import payload_name, POSED

HTML = '/home/sara/Työpöytä/hoki/game/ice_hockey.html'
IK = 'ik_anim2.glb'
OUT = 'anim_ik2.b64'
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

missing = [n for n in pname if n not in iname]
assert not missing, 'IK export is missing payload nodes: %s' % missing

present = {a['name'] for a in PJ['animations']}
have = {a['name'] for a in IJ['animations']}

# every posed clip that the payload does NOT already have, under its payload name
ADD = {}
for a in sorted(have):
    out = payload_name(a)
    if a in POSED and out not in present:
        ADD[out] = a
assert ADD, 'nothing new to add -- the payload already has every posed clip'
print('ADDING:', ', '.join('%s (%s)' % (k, v) for k, v in sorted(ADD.items())))

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
    clip = copy_clip(src)
    dur = max(float(np.array(read_accessor(PJ, PB, src['samplers'][c['sampler']]['input']),
                             dtype=np.float64)[:, 0].max())
              for c in src['channels'])
    report.append(('keep ' + src['name'], len(clip['channels']), dur, 0))
    OJ['animations'].append(clip)

for out_name, src_name in sorted(ADD.items()):
    clip, dur, nkeys = ik_clip(out_name, src_name)
    report.append(('NEW  ' + out_name, len(clip['channels']), dur, nkeys))
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
json.dump({'added': sorted(ADD), 'kept': sorted(present)},
          open('anim_ik2.clips.json', 'w'), indent=1)

print('\n%-34s %5s %8s %7s' % ('clip', 'chans', 'dur', 'keys'))
for r in report:
    print('%-34s %5d %8.3f %7d' % r)
print('\nanimations %d -> %d, accessors %d -> %d, base64 %d -> %d chars'
      % (len(PJ['animations']), len(OJ['animations']),
         len(PJ['accessors']), len(OJ['accessors']), len(m.group(1)), len(b64)))
