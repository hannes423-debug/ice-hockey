"""Verify the FINAL payload, resampled BETWEEN the keys.  (run after splice.py)

bake4's per-key error is a TAUTOLOGY: the grip is constructed at each solved key,
so it reads ~0 even when a clip is visibly broken. Every real defect found in the
08-04 pack was invisible to it and only showed up when the final payload was
resampled between keys. This does that, on whatever is currently in the HTML.

Reported per clip:
  gripsep   distance between the two grip tunnels. A real two-handed grip is
            0.26-0.44 m; the bake constrains it to exactly that range AT the
            keys, so anything outside it here is interpolation damage.
  axerr     angle between each hand's own grip-tunnel axis and the line joining
            the two grips. 0 = one straight shaft through both fists. This is
            NOT tautological (the hand's roll about the shaft is free) and it is
            the number that exposed the shipped payload's loose grip.
  tipjump   largest blade movement between adjacent SAMPLES, as m/s. A solver
            branch jump or a hand-roll flip shows up here as a spike; smooth
            motion stays near the clip's real blade speed.
  bladeY    blade height range, to confirm the windmill lifts and the stances sit
            on the ice (0.020).
"""
exec(open('bake.py').read())
import numpy as np, math, sys

DENSE = 12          # samples per authored key
CL = sys.argv[1:] or [
    'IdleN', 'IdleL', 'IdleR', 'IdleForeHandPulledBack',
    'IdleNeutralToForeHand', 'IdleNeutralToBackHand',
    'IdleForeHandToNeutral', 'IdleForeHandToBackHand',
    'IdleBackHandToNeutral', 'IdleBackHandToForeHand',
    'WindmillDekeL', 'WindmillDekeR', 'SpinoramaL', 'SpinoramaR',
]

print("%-24s %6s %14s %14s %9s %14s" % (
    "clip", "n", "gripsep m", "axerr deg", "tipjump", "bladeY m"))
worstax = 0.0
worstsep = ''
for cn in CL:
    try:
        ch, dur = clip(cn)
    except IndexError:
        print("%-24s  NOT IN PAYLOAD" % cn); continue
    nk = max(len(v['rotation'][0]) for v in ch.values() if 'rotation' in v)
    n = max(8, nk * DENSE)
    ts = np.linspace(0, dur, n)
    seps, errs, tips, ys = [], [], [], []
    for t in ts:
        W = sample(ch, t)
        HR = W[byname['hand_r']]; HL = W[byname['hand_l']]
        gR = (HR @ np.append(GRIP_CTR_R, 1.0))[:3]
        gL = (HL @ np.append(GRIP_CTR_L, 1.0))[:3]
        v = gL - gR; s = np.linalg.norm(v); u = v / s
        seps.append(s * SCALE)
        for H, ax in ((HR, GRIP_AX_R), (HL, GRIP_AX_L)):
            a = H[:3, :3] @ ax; a /= np.linalg.norm(a)
            errs.append(math.degrees(math.acos(min(1.0, abs(float(np.dot(a, u)))))))
        tip = gR + u * G2T
        tips.append(tip * SCALE); ys.append(tip[1] * SCALE)
    tips = np.array(tips)
    dt = dur / (n - 1) if n > 1 else 1.0
    jump = float(np.linalg.norm(np.diff(tips, axis=0), axis=1).max() / dt) if n > 1 else 0.0
    worstax = max(worstax, max(errs))
    f = lambda a: "%5.2f..%-5.2f" % (min(a), max(a))
    flag = '' if (min(seps) > 0.24 and max(seps) < 0.46) else '  <-- SEP'
    print("%-24s %6d %14s %14s %9.2f %14s%s" % (
        cn, n, f(seps), "%5.2f..%-5.2f" % (min(errs), max(errs)), jump, f(ys), flag))

print("\nworst grip-axis error across every clip and sample: %.3f deg" % worstax)
print("(the SHIPPED payload measures 52-89 deg here — that is the loose grip the")
print(" 08-15 re-bake exists to fix, not a defect introduced by it)")
