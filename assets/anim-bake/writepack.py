"""Rewrite the 6 arm rotation tracks for every clip in tracks_new.pkl. -> anim_new.b64

Same as write_anim.py, but keyed off the OUT names in bakepack3.py's ALLCLIPS
(the solve is keyed by the raw export name, the payload by the runtime name).

RE-SPLICE anim_merged.b64 BEFORE running this. write_anim appends to whatever
payload is currently in the HTML, so running it twice over its own output leaves
the previous run's accessors orphaned in the buffer — that silently added 136 KB
per iteration on the 08-04 run.
"""
exec(open('bakepack3.py').read())
import pickle, struct, base64

TR_RAW = pickle.load(open('tracks_new.pkl', 'rb'))
TR = {ALLCLIPS[k][0]: v for k, v in TR_RAW.items()}     # raw name -> payload name
BONES = ['upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l']

j = json.loads(json.dumps(AJ))                          # deep copy of the anim glTF
bin_old = AB[20 + struct.unpack('<I', AB[12:16])[0] + 8:]
bin_old = bin_old[:j['buffers'][0]['byteLength']]
blob = bytearray(bin_old)
anames = [n.get('name') for n in j['nodes']]

have = {a['name'] for a in j['animations']}
missing = [k for k in TR if k not in have]
assert not missing, 'clips not in the payload (run mergepack.py + splice.py first): %s' % missing

def add_acc(arr, typ, comp=5126, mn=None, mx=None):
    global blob
    while len(blob) % 4: blob.append(0)
    off = len(blob); data = np.asarray(arr, dtype=np.float32).tobytes(); blob.extend(data)
    j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    a = {'bufferView': len(j['bufferViews']) - 1, 'componentType': comp,
         'count': int(len(arr)), 'type': typ}
    if mn is not None:
        a['min'] = [float(x) for x in mn]; a['max'] = [float(x) for x in mx]
    j['accessors'].append(a); return len(j['accessors']) - 1

nrep = 0
for anim in j['animations']:
    nm = anim['name']
    if nm not in TR: continue
    times, tracks = TR[nm]
    ti = add_acc(times, 'SCALAR', mn=[times.min()], mx=[times.max()])
    for bone in BONES:
        q = np.asarray(tracks[bone], dtype=np.float32)
        assert len(q) == len(times), '%s/%s key count mismatch' % (nm, bone)
        oi = add_acc(q, 'VEC4')
        node = anames.index(bone)
        hit = False
        for c in anim['channels']:
            if c['target'].get('node') == node and c['target']['path'] == 'rotation':
                anim['samplers'][c['sampler']] = {'input': ti, 'output': oi,
                                                  'interpolation': 'LINEAR'}
                hit = True; nrep += 1
        assert hit, 'no rotation channel for %s in %s' % (bone, nm)
print("replaced %d rotation samplers across %d clips" % (nrep, len(TR)))
print("  re-baked in place :", sorted(ALLCLIPS[k][0] for k in STANCES))
print("  newly appended    :", sorted(ALLCLIPS[k][0] for k in NEWCLIPS))

j['buffers'][0]['byteLength'] = len(blob)
jb = json.dumps(j, separators=(',', ':')).encode('utf-8')
while len(jb) % 4: jb += b' '
while len(blob) % 4: blob.append(0)
glb = (b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + len(blob))
       + struct.pack('<I', len(jb)) + b'JSON' + jb
       + struct.pack('<I', len(blob)) + b'BIN\x00' + bytes(blob))
b64 = base64.b64encode(glb).decode('ascii')
print("new ANIM_B64: %d bytes glb, %d chars base64 (was %d)"
      % (len(glb), len(b64), len(re.search(r'const ANIM_B64="([^"]+)"', S).group(1))))
open('anim_new.b64', 'w').write(b64)
jj = json.loads(glb[20:20 + struct.unpack('<I', glb[12:16])[0]])
print("reparsed ok: %d animations, %d accessors, %d bufferViews"
      % (len(jj['animations']), len(jj['accessors']), len(jj['bufferViews'])))
