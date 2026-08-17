"""Solve the shaft, per frame, for the 11 new clips.  -> sol_new.pkl

Same skeleton as bake3.py (trust region, warm start, cold sweep as last resort)
with the two changes described at the top of bakepack3.py: the shaft carries a
free elevation instead of being pinned to the ice, and the tip is pulled to a
PER-FRAME target derived from the authored hands instead of two constants.
"""
exec(open('bakepack3.py').read())
from scipy.optimize import minimize
import pickle

W_HAND_R, W_HAND_L = 1.0, 0.55     # stay near the authored hands (as bake3)
W_TIP = 1.6                        # ...but the authored BLADE PATH outranks them

def solve_frame(tgt, sR, sL, aR, aL, seed, rollref=None, trust=None):
    def unpack(x):
        T = x[:3]; d = shaft_dir(x[3], x[4])
        return T, d, T + d * x[5], T + d * G2T
    def obj(x):
        T, d, Lg, tip = unpack(x)
        return (np.dot(T - aR, T - aR) * W_HAND_R
                + np.dot(Lg - aL, Lg - aL) * W_HAND_L
                + np.dot(tip - tgt, tip - tgt) * W_TIP)
    # constrain the WRIST, not the grip point — they differ by |GRIP_CTR| (~0.15)
    # which is enough to hand the IK a target it cannot reach.
    def wr(x, side):
        T, d, Lg, tip = unpack(x)
        g, sh, c, ax = ((T, sR, GRIP_CTR_R, GRIP_AX_R) if side == 'r'
                        else (Lg, sL, GRIP_CTR_L, GRIP_AX_L))
        rf = (rollref or {}).get(side)
        return np.linalg.norm(hand_frame_and_wrist(g, sh, d, c, ax, rf)[1] - sh)
    cons = [{'type': 'ineq', 'fun': lambda x: REACH['r'] - wr(x, 'r')},
            {'type': 'ineq', 'fun': lambda x: REACH['l'] - wr(x, 'l')},
            # the arm cannot fold through itself — see MINREACH in bake.py
            {'type': 'ineq', 'fun': lambda x: wr(x, 'r') - MINREACH['r']},
            {'type': 'ineq', 'fun': lambda x: wr(x, 'l') - MINREACH['l']},
            # and the blade cannot go under the ice
            {'type': 'ineq', 'fun': lambda x: unpack(x)[3][1] - ICE}]
    bnds = ([(None, None)] * 3 + [(-4 * math.pi, 4 * math.pi),
                                  (-math.pi / 2 * 0.98, math.pi / 2 * 0.98),
                                  (SP_MIN, SP_MAX)])

    def cold():
        out = []
        for psi0 in np.linspace(0, 2 * math.pi, 8, endpoint=False):
            for th0 in (-0.9, -0.4, 0.0, 0.4):
                # start with the top grip a blade-length back up the shaft from
                # the target tip, which is where it has to end up anyway
                d0 = shaft_dir(psi0, th0)
                out.append(np.array([*(tgt - d0 * G2T), psi0, th0,
                                     (SP_MIN + SP_MAX) / 2]))
        return out

    def attempt(x0, cs):
        r = minimize(obj, x0, method='SLSQP', bounds=bnds, constraints=cs,
                     options={'maxiter': 200, 'ftol': 1e-9})
        if not r.success:
            return None
        v = max(wr(r.x, 'r') - REACH['r'], wr(r.x, 'l') - REACH['l'],
                MINREACH['r'] - wr(r.x, 'r'), MINREACH['l'] - wr(r.x, 'l'),
                ICE - unpack(r.x)[3][1])
        return None if v > 1e-4 else (r.fun, r.x.copy())

    def sweep():
        best = None
        for x0 in cold():
            c = attempt(x0, cons)
            if c and (best is None or c[0] < best[0]):
                best = c
        return best

    if seed is None:
        b = sweep()
        return b[1] if b else None
    # TRUST REGION — bound the per-frame step so the solver cannot hop between
    # basins (the shaft can reach the same authored hands from more than one
    # azimuth), relax it in stages, and only cold-sweep as a true last resort.
    for mul in (1.0, 2.0, 4.0, 8.0):
        tr = {k: trust[k] * mul for k in trust}
        c = attempt(seed, cons + [
            {'type': 'ineq', 'fun': lambda x, t=tr: t['T'] - np.linalg.norm(x[:3] - seed[:3])},
            {'type': 'ineq', 'fun': lambda x, t=tr: t['psi'] - abs(x[3] - seed[3])},
            {'type': 'ineq', 'fun': lambda x, t=tr: t['th'] - abs(x[4] - seed[4])},
            {'type': 'ineq', 'fun': lambda x, t=tr: t['sp'] - abs(x[5] - seed[5])}])
        if c is not None:
            return c[1]
    c = attempt(seed, cons)
    if c is not None:
        return c[1]
    b = sweep()
    return b[1] if b else None


import sys, os
ONLY = sys.argv[1:]
SOL = {}
if ONLY and os.path.exists('sol_new.pkl'):
    SOL = pickle.load(open('sol_new.pkl', 'rb'))     # keep the clips we are not re-solving
TODO = [c for c in ALLCLIPS if not ONLY or c in ONLY]
print("PIN_MODE = %s\nsolving grips for %d clip(s)...\n" % (PIN_MODE, len(TODO)))
print("%-26s %4s %11s %11s %11s %8s %8s" % (
    "clip", "keys", "tip fwd", "tip lat", "tip y", "spacing", "tiperr"))
for cn in TODO:
    raw, dur = rawclip(cn)
    out, src, dst, cyc = ALLCLIPS[cn]
    fps = FPS_CLIP.get(cn, FPS)
    n = max(1, int(round(dur * fps)) + 1) if dur > 0 else 1
    ts = np.linspace(0, dur, n) if dur > 0 else np.array([0.0])
    if cyc and n > 2:
        ts = ts[:-1]
    dtc = float(ts[1] - ts[0]) if len(ts) > 1 else 1 / 60.
    trust = {'T': G(TRUST_RATE['T'] * dtc),
             'psi': math.radians(TRUST_RATE['psi']) * dtc,
             'th': math.radians(TRUST_RATE['th']) * dtc,
             'sp': G(TRUST_RATE['sp'] * dtc)}

    ctx = []
    for t in ts:
        W = sample(raw, t)
        ctx.append((W, W[byname['upperarm_r']][:3, 3], W[byname['upperarm_l']][:3, 3],
                    W[byname['lowerarm_r']][:3, 3], W[byname['lowerarm_l']][:3, 3],
                    W[byname['root']][:3, 3]))
    tgts = tip_targets(cn, ts, [c[5] for c in ctx])

    xs = []; seed = None; rollref = {'r': None, 'l': None}; tiperr = []
    for i, t in enumerate(ts):
        W, sR, sL, eR, eL, pel = ctx[i]
        aR, aL = W[byname['hand_r']][:3, 3], W[byname['hand_l']][:3, 3]
        x = solve_frame(tgts[i], sR, sL, aR, aL, seed, rollref, trust)
        assert x is not None, 'no grip: %s @ %.3f' % (cn, t)
        if seed is not None:                       # keep psi continuous
            while x[3] - seed[3] > math.pi: x[3] -= 2 * math.pi
            while x[3] - seed[3] < -math.pi: x[3] += 2 * math.pi
        Tf = x[:3]; df = shaft_dir(x[3], x[4]); Lgf = Tf + df * x[5]
        rollref['r'] = hand_frame_and_wrist(Tf, sR, df, GRIP_CTR_R, GRIP_AX_R, rollref['r'])[2]
        rollref['l'] = hand_frame_and_wrist(Lgf, sL, df, GRIP_CTR_L, GRIP_AX_L, rollref['l'])[2]
        tiperr.append(np.linalg.norm((Tf + df * G2T) - tgts[i]) * SCALE)
        seed = x.copy(); xs.append(x)

    xs = np.array(xs)
    SOL[cn] = (ts, xs, ctx, tgts)
    tips = np.array([xs[i][:3] + shaft_dir(xs[i][3], xs[i][4]) * G2T for i in range(len(xs))])
    rel = tips - np.array([c[5] for c in ctx])
    f = lambda a: "%5.2f..%-5.2f" % (a.min(), a.max())
    print("%-26s %4d %11s %11s %11s %8.2f %8.3f" % (
        cn, len(ts), f(rel @ FWD * SCALE), f(rel @ LEFT * SCALE),
        f(tips[:, 1] * SCALE), np.mean(xs[:, 5]) * SCALE, float(np.mean(tiperr))))

pickle.dump(SOL, open('sol_new.pkl', 'wb'))
print("\nsaved sol_new.pkl   ('tiperr' = mean distance from the solved blade tip")
print("to the per-frame authored target, in game metres)")
