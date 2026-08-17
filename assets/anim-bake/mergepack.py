"""Append the 11 NEW clips to ANIM_B64, leaving every clip already in the
payload byte-for-byte alone.  -> anim_merged.b64

Same conventions as merge.py (which appended the 08-04 pack): runtime node
names, rotation on all 63 bones + translation on 'root' only, 24 fps, constant
channels collapsed to one key.

The three stance clips are NOT here. IdleN/IdleL/IdleR already exist in the
payload; they are re-baked in place by writepack.py, which rewrites their 6 arm
samplers and leaves their body tracks untouched.
"""
import base64, json, re, struct, sys
import numpy as np
from glb import read_glb, read_accessor

HTML = '/home/sara/Työpöytä/hoki/game/ice_hockey.html'
RETIME = 30.0 / 24.0
EPS_ROT, EPS_TRA = 1e-6, 1e-7

# raw name -> payload name. Deliberately NOT cn[1:]: the mapping is data, and
# 0IdleNeutral/0IdleForeHand/0IdleBackHand are excluded on purpose (they are
# byte-identical renames of the shipped IdleN/IdleL/IdleR — verified maxabs
# 0.000000 across every track — so importing them would duplicate the clips
# and throw away the grip bake they already carry).
NEW = {
    '0IdleForeHandPulledBack': 'IdleForeHandPulledBack',
    '0IdleNeutralToForeHand':  'IdleNeutralToForeHand',
    '0IdleNeutralToBackHand':  'IdleNeutralToBackHand',
    '0IdleForeHandToNeutral':  'IdleForeHandToNeutral',
    '0IdleForeHandToBackHand': 'IdleForeHandToBackHand',
    '0IdleBackHandToNeutral':  'IdleBackHandToNeutral',
    '0IdleBackHandToForeHand': 'IdleBackHandToForeHand',
    '3WindmillDekeL':          'WindmillDekeL',
    '3WindmillDekeR':          'WindmillDekeR',
    '3SpinoramaL':             'SpinoramaL',
    '3SpinoramaR':             'SpinoramaR',
}

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

def read_glb_buf(buf):
    off = 12; js = None; b = b''
    while off < len(buf):
        clen, ctype = struct.unpack('<II', buf[off:off+8]); off += 8
        chunk = buf[off:off+clen]; off += clen
        if ctype == 0x4E4F534A: js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942: b = chunk
    return js, b

J, BIN = read_glb_buf(cur_raw)
NJ, NB = read_glb('../new_anim.glb')

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
for cn, out_name in NEW.items():
    src = [x for x in NJ['animations'] if x['name'] == cn][0]
    assert out_name not in existing, 'clip %s already in payload' % out_name

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
            if len(vo) > 1 and np.abs(vo - vo[0]).max() < eps:
                ti, vo = ti[:1], vo[:1]
            # pass the 2D (n,4)/(n,3) array, never a flattened one — add_acc takes
            # accessor.count from len(arr), so a flattened array claims 4x its own
            # data and reads run into the NEXT accessor's bytes.
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

print("\n%-24s %5s %8s %7s" % ("clip", "chans", "dur", "keys"))
for r in report: print("%-24s %5d %8.3f %7d" % r)
print("\npayload: %d -> %d animations, %d -> %d chars base64"
      % (len(J['animations']) - len(NEW), len(J['animations']), len(m.group(1)), len(b64)))
