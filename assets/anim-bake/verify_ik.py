"""Does the IK-grip payload actually put both fists on one shaft?

Same non-tautological test verify_new.py uses: the shaft is the line joining
the two grip points, so measuring the grip points against it always returns 0
(README). What is measured instead is the angle between each hand's own
grip-TUNNEL axis -- the knuckle line, derived from the curled fingers, which
nothing in this pipeline ever touched -- and that line.

READ THE TWO COLUMNS DIFFERENTLY. `axL` is the lower hand and is the honest
test: it should be near 0. `axR` is the TOP hand, and in the animator's clips
it sits 30-45 deg off, because a top hand on the knob is rotated relative to
the shaft -- that is anatomy, not error. It reads ~0 on the baked clips only
because bake4 constructed the shaft along GRIP_AX_R in the first place, which
makes it a tautology there ([[feedback-tautological-verification]]). The
independent proof for the IK clips is in measure_ik.py, against the animator's
own `stick` bone: both fists within 0.02-0.06 m of it, shaft line 2-7 deg off.

Reads anim_ik.b64 directly, so it can be run BEFORE splicing.
"""
exec(open('bake.py').read())
import base64 as _b64

nb = _b64.b64decode(open('anim_ik.b64').read())
jl = struct.unpack('<I', nb[12:16])[0]
AJ2 = json.loads(nb[20:20+jl])
OFF2 = 20+jl+8
acc2 = mkacc(AJ2, nb, OFF2)
an2 = [n.get('name') for n in AJ2['nodes']]

IK = set(json.load(open('anim_ik.clips.json'))['ik'])   # written by merge_ik.py


def clip2(name):
    a = [x for x in AJ2['animations'] if x['name'] == name][0]
    ch = {}
    for c in a['channels']:
        sm = a['samplers'][c['sampler']]
        ch.setdefault(an2[c['target']['node']], {})[c['target']['path']] = (
            acc2(sm['input'])[:, 0], acc2(sm['output']))
    return ch, max(t[-1] for v in ch.values() for t, _ in v.values())


Wb = world(locals_bind())
FWD2 = (Wb[byname['toeR']][:3, 3] - Wb[byname['heel02R']][:3, 3])
FWD2[1] = 0
FWD2 /= np.linalg.norm(FWD2)

print("%-24s %4s %9s %9s %9s %9s %8s" %
      ("clip", "src", "axL(low)", "axR(top)", "handSep", "tip y", "tip fwd"))
worst_ik = worst_old = 0.0
sep_ik = []
for a in AJ2['animations']:
    cn = a['name']
    ch, dur = clip2(cn)
    if dur <= 0:
        print("%-24s %4s   (static pose, 1 key)" % (cn, 'keep'))
        continue
    D, DR, S, TY, TF = [], [], [], [], []
    for t in np.linspace(0, dur, 40):
        W = sample(ch, t)
        HR, HL = W[byname['hand_r']], W[byname['hand_l']]
        gR = (HR @ np.append(GRIP_CTR_R, 1.0))[:3]
        gL = (HL @ np.append(GRIP_CTR_L, 1.0))[:3]
        d = gL - gR
        sep = np.linalg.norm(d)
        d /= sep
        axR = HR[:3, :3] @ GRIP_AX_R
        axR /= np.linalg.norm(axR)
        axL = HL[:3, :3] @ GRIP_AX_L
        axL /= np.linalg.norm(axL)
        DR.append(np.degrees(np.arccos(np.clip(abs(np.dot(axR, d)), 0, 1))))
        D.append(np.degrees(np.arccos(np.clip(abs(np.dot(axL, d)), 0, 1))))
        S.append(sep*SCALE)
        tip = gR + d*G2T
        TY.append(tip[1]*SCALE)
        TF.append(np.dot(tip - W[byname['root']][:3, 3], FWD2)*SCALE)
    src = 'IK' if cn in IK else 'keep'
    if cn in IK:
        worst_ik = max(worst_ik, max(D))
        sep_ik += S
    else:
        worst_old = max(worst_old, max(D))
    print("%-24s %4s %8.2f° %8.2f° %8.3fm %8.3fm %7.2fm" %
          (cn, src, np.mean(D), np.mean(DR), np.mean(S), np.mean(TY), np.mean(TF)))

print("\n'axL/axR' = angle between that fist's own knuckle line and the line joining")
print("the two grip points. axL near 0 = the lower fist is wrapped round one straight")
print("shaft. axR is expected to be 30-45 deg on the authored clips (top hand on the")
print("knob is rotated); it is ~0 on baked clips only because the bake built it that way.")
print("worst LOWER-fist frame, IK clips  : %7.3f deg" % worst_ik)
print("worst LOWER-fist frame, kept clips: %7.3f deg" % worst_old)
if sep_ik:
    print("hand separation over the IK clips: %.3f - %.3f m (bake's window was %.2f-%.2f)"
          % (min(sep_ik), max(sep_ik), SP_MIN*SCALE, SP_MAX*SCALE))
