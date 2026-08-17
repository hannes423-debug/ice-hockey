"""Do the stance transitions still LAND on the stance loops they hand over to?

The stance graph's whole premise (ice_hockey.html, attachSkaterClips) is that
"each transition is a 20-frame one-shot whose first and last frame sit on the
stance poses to within 0.05 deg", so stanceTick can play one without a pop at
either end. That was true when every clip came from the same bake. It stops
being true the moment SOME of the graph's nodes are re-sourced and others are
not: an authored ForeHand loop and a baked N->F transition disagree in the arms
by whatever the bake was wrong by, and the disagreement is a POP on screen at
the exact frame control passes between them.

    python3 stancepop.py [path/to/ice_hockey.html]

Reports, per transition, the worst ARM-bone angle between its first frame and
the source stance's pose, and its last frame and the target stance's pose.
Non-arm bones are reported too: they are the control, and they should stay tiny
whatever the arms do.
"""
import base64, json, re, struct, sys
import numpy as np

HTML = sys.argv[1] if len(sys.argv) > 1 else '/home/sara/Työpöytä/hoki/game/ice_hockey.html'
ARMS = {'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r'}

# transition -> (source stance clip, target stance clip)
XFER = {
    'IdleNeutralToForeHand':  ('IdleN', 'IdleL'),
    'IdleNeutralToBackHand':  ('IdleN', 'IdleR'),
    'IdleForeHandToNeutral':  ('IdleL', 'IdleN'),
    'IdleBackHandToNeutral':  ('IdleR', 'IdleN'),
    'IdleForeHandToBackHand': ('IdleL', 'IdleR'),
    'IdleBackHandToForeHand': ('IdleR', 'IdleL'),
}


def payload(path):
    s = open(path, encoding='utf-8').read()
    raw = base64.b64decode(re.search(r'const ANIM_B64="([A-Za-z0-9+/=]+)"', s).group(1))
    off, js, bn = 12, None, b''
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


J, B = payload(HTML)
NAMES = [n.get('name') or '' for n in J['nodes']]
CT = {5126: 'f4', 5123: 'u2', 5125: 'u4', 5121: 'u1'}
NC = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}


def acc(i):
    a = J['accessors'][i]
    bv = J['bufferViews'][a['bufferView']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count'] * NC[a['type']]
    v = np.frombuffer(B, dtype=np.dtype('<' + CT[a['componentType']]), count=n, offset=o)
    return v.reshape(a['count'], NC[a['type']]).astype(np.float64)


def rot_at(clip, end):
    """{bone: quat} at the clip's first (end=0) or last (end=-1) key."""
    a = [x for x in J['animations'] if x['name'] == clip][0]
    out = {}
    for c in a['channels']:
        if c['target']['path'] != 'rotation':
            continue
        q = acc(a['samplers'][c['sampler']]['output'])
        out[NAMES[c['target']['node']]] = q[0] if end == 0 else q[-1]
    return out


def worst(pa, pb, bones):
    w, wb = 0.0, ''
    for b in bones:
        if b not in pa or b not in pb:
            continue
        d = abs(float(np.dot(pa[b], pb[b])))
        e = float(np.degrees(2 * np.arccos(min(1.0, d))))
        if e > w:
            w, wb = e, b
    return w, wb


have = {a['name'] for a in J['animations']}
allb = set(NAMES) - {''}
print(HTML)
print('%-24s %10s %10s %10s %10s   %s'
      % ('transition', 'startArm', 'endArm', 'startBody', 'endBody', 'worst body bone'))
bad = 0
for x, (src, dst) in XFER.items():
    if not {x, src, dst} <= have:
        print('%-24s  MISSING' % x)
        continue
    a0, a1 = rot_at(x, 0), rot_at(x, -1)
    s0, d0 = rot_at(src, 0), rot_at(dst, 0)
    sa, _ = worst(a0, s0, ARMS)
    ea, _ = worst(a1, d0, ARMS)
    sb, sbb = worst(a0, s0, allb - ARMS)
    eb, ebb = worst(a1, d0, allb - ARMS)
    flag = '  <-- POP' if max(sa, ea) > 5.0 else ''
    if max(sa, ea) > 5.0:
        bad += 1
    print('%-24s %10.3f %10.3f %10.3f %10.3f   %s%s'
          % (x, sa, ea, sb, eb, ebb if eb > sb else sbb, flag))
print('\ntransitions whose ARMS pop against the stance they hand over to: %d' % bad)
