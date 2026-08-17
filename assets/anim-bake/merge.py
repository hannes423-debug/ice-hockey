"""Append the 9 new clips to ANIM_B64, leaving the 8 existing (grip-baked) clips
byte-for-byte alone.

Conventions of the shipped payload, matched exactly here:
  * node names are the game's RUNTIME names (sanitize dots, then remapBoneNames)
  * one channel set per clip: rotation on all 63 bones + translation on 'root'
    only. No scale channels, no per-bone translation.
  * 24 fps. The blend's scene is 30 fps, but the shipped 8 clips were built at
    24 (IdleN: 80 frames -> 3.333 s), and the graph's crossfade/dwell constants
    are tuned against those durations. Mixing rates inside one payload would
    make the new clips run 25% faster than the old ones, so the export is
    retimed to the payload's rate.
  * channels whose value never changes collapse to a single key (this is what
    mixerUpdateClean in the game exists to cope with).
"""
import base64, json, re, struct, sys
import numpy as np
from glb import read_glb, read_accessor

HTML = '/home/sara/Työpöytä/hoki/game/ice_hockey.html'
RETIME = 30.0 / 24.0          # export is 30 fps, payload convention is 24 fps
EPS_ROT, EPS_TRA = 1e-6, 1e-7

NEW = ['2Acceleration', '2GlideForward', '2SlapShot', '2Stop', '2StopHockey',
       '2TurnPunchL', '2TurnPunchR', '2TurnTightL', '2TurnTightR']

_RES = re.compile(r'[.\[\]:/]')
EXACT = {'spine': 'spine_01', 'spine1': 'spine_02', 'spine2': 'spine_03', 'neck1': 'neck_01'}
SIDED = {'upper_arm': 'upperarm', 'forearm': 'lowerarm', 'hand': 'hand',
         'thigh': 'thigh', 'shin': 'calf', 'foot': 'foot'}

def remap(n):
    n = _RES.sub('', re.sub(r'\s', '_', n or ''))
    if n in EXACT: return EXACT[n]
    for base, out in SIDED.items():
        if n == base + 'L': return out + '_l'
        if n == base + 'R': return out + '_r'
    return n

html = open(HTML, encoding='utf-8').read()
m = re.search(r'const ANIM_B64="([A-Za-z0-9+/=]+)"', html)
cur_raw = base64.b64decode(m.group(1))
J, BIN = read_glb_bytes = None, None

def read_glb_buf(buf):
    off = 12; js = None; b = b''
    while off < len(buf):
        clen, ctype = struct.unpack('<II', buf[off:off+8]); off += 8
        chunk = buf[off:off+clen]; off += clen
        if ctype == 0x4E4F534A: js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942: b = chunk
    return js, b

J, BIN = read_glb_buf(cur_raw)
NJ, NB = read_glb('new_anim.glb')

cur_names = [n.get('name') for n in J['nodes']]
new_names = [remap(n.get('name')) for n in NJ['nodes']]
assert cur_names == new_names, "node name/order mismatch:\n%s\n%s" % (cur_names, new_names)
print("node lists identical after remap: %d nodes" % len(cur_names))

existing = {a['name'] for a in J['animations']}
blob = bytearray(BIN)

def add_acc(arr, typ, minmax=False):
    while len(blob) % 4: blob.append(0)
    off = len(blob)
    data = np.asarray(arr, dtype=np.float32).tobytes()
    blob.extend(data)
    J['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    a = {'bufferView': len(J['bufferViews']) - 1, 'componentType': 5126,
         'count': int(len(arr)), 'type': typ}
    if minmax:
        arr2 = np.asarray(arr, dtype=np.float32)
        a['min'] = [float(arr2.min())]; a['max'] = [float(arr2.max())]
    J['accessors'].append(a)
    return len(J['accessors']) - 1

ROOT = cur_names.index('root')
report = []
for cn in NEW:
    src = [x for x in NJ['animations'] if x['name'] == cn][0]
    out_name = cn[1:]                      # '2Acceleration' -> 'Acceleration'
    assert out_name not in existing, 'clip %s already in payload' % out_name

    # gather the export's channels by (node, path)
    got = {}
    for c in src['channels']:
        sm = src['samplers'][c['sampler']]
        ti = np.array(read_accessor(NJ, NB, sm['input']), dtype=np.float64)[:, 0] * RETIME
        vo = np.array(read_accessor(NJ, NB, sm['output']), dtype=np.float64)
        got[(c['target']['node'], c['target']['path'])] = (ti, vo)

    samplers, channels = [], []
    nkeys = 0
    for ni in range(len(cur_names)):
        wanted = [('rotation', EPS_ROT)]
        if ni == ROOT: wanted.append(('translation', EPS_TRA))
        for path, eps in wanted:
            if (ni, path) not in got:
                continue
            ti, vo = got[(ni, path)]
            # collapse a channel that never moves to one key
            if len(vo) > 1 and np.abs(vo - vo[0]).max() < eps:
                ti, vo = ti[:1], vo[:1]
            # NOTE: pass the 2D (n,4)/(n,3) array, never a flattened one —
            # add_acc takes accessor.count from len(arr), so a flattened array
            # claims 4x its own data. Reads then run into the NEXT accessor's
            # bytes and only the last one in the buffer is short enough to raise.
            ii = add_acc(ti, 'SCALAR', minmax=True)
            oi = add_acc(vo, 'VEC4' if path == 'rotation' else 'VEC3')
            samplers.append({'input': ii, 'output': oi, 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1,
                             'target': {'node': ni, 'path': path}})
            nkeys += len(ti)
    dur = max(float(np.asarray(got[(ni, p)][0]).max())
              for (ni, p) in got if p == 'rotation')
    J['animations'].append({'name': out_name, 'samplers': samplers, 'channels': channels})
    report.append((out_name, len(channels), dur, nkeys))

J['buffers'][0]['byteLength'] = len(blob)
while len(blob) % 4: blob.append(0)
jb = json.dumps(J, separators=(',', ':')).encode('utf-8')
while len(jb) % 4: jb += b' '
glb = (b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + len(blob))
       + struct.pack('<I', len(jb)) + b'JSON' + jb
       + struct.pack('<I', len(blob)) + b'BIN\x00' + bytes(blob))
b64 = base64.b64encode(glb).decode('ascii')
open('anim_merged.b64', 'w').write(b64)

print("\n%-22s %5s %8s %7s" % ("clip", "chans", "dur", "keys"))
for r in report: print("%-22s %5d %8.3f %7d" % r)
print("\npayload: %d -> %d animations, %d -> %d chars base64"
      % (len(J['animations']) - len(NEW), len(J['animations']), len(m.group(1)), len(b64)))
