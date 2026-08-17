"""IK both arms onto the solved shaft and build the 6 arm tracks. -> tracks_new.pkl

Same as bake4.py, against sol_new.pkl and the 6-parameter shaft (free elevation).
The loop classification is MEASURED, never guessed from the name — see CYCLIC
below and the 08-04 lesson about TurnPunch being pinned to frame 0's arm pose
while its body ended 15 deg elsewhere.
"""
exec(open('bakepack3.py').read())
import pickle

SOL = pickle.load(open('sol_new.pkl', 'rb'))

def smooth(a, cyc, w=5):
    a = np.asarray(a, float)
    if w <= 1 or len(a) < w + 1:
        return a
    k = np.ones(w) / w
    out = np.empty_like(a)
    for c in range(a.shape[1]):
        col = a[:, c]
        pad = (np.concatenate([col[-(w // 2):], col, col[:w // 2]]) if cyc else
               np.concatenate([np.repeat(col[0], w // 2), col, np.repeat(col[-1], w // 2)]))
        out[:, c] = np.convolve(pad, k, 'valid')
    return out

# A 5-frame box filter makes the shaft lag a fast body reversal, and that lag —
# not the hand spacing — is what puts a wrist out of reach. The four fast clips
# are solved at 240 Hz and smoothed lightly.
SMOOTH_W = {'3WindmillDekeL': 1, '3WindmillDekeR': 1,
            '3SpinoramaL': 1, '3SpinoramaR': 1}

BONES = ['upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l']
OUT = {}
REP = []
for cn, (ts, xs, ctx, tgts) in SOL.items():
    out, src, dst, cyc = ALLCLIPS[cn]
    xs = smooth(xs, cyc, SMOOTH_W.get(cn, 3))
    tracks = {b: [] for b in BONES}
    errs = []
    reach_fail = 0
    pstate = {'r': {}, 'l': {}}          # elbow-pole continuity, per side, per clip
    rollref = {'r': None, 'l': None}     # hand-roll continuity, same rule as the solve
    dt = float(ts[1] - ts[0]) if len(ts) > 1 else 0.0
    slew = math.radians(POLE_SLEW_DPS) * dt
    for i, t in enumerate(ts):
        W, sR, sL, eR, eL, pel = ctx[i]
        T = xs[i][:3]; d = shaft_dir(xs[i][3], xs[i][4]); sp = xs[i][5]
        gp = {'r': T, 'l': T + d * sp}
        sh = {'r': sR, 'l': sL}
        eh = {'r': eR, 'l': eL}
        ctr = {'r': GRIP_CTR_R, 'l': GRIP_CTR_L}
        gax = {'r': GRIP_AX_R, 'l': GRIP_AX_L}
        for side in ('r', 'l'):
            qHw, wrist, awy = hand_frame_and_wrist(gp[side], sh[side], d, ctr[side],
                                                   gax[side], rollref[side])
            rollref[side] = awy
            Pu = W[parent[byname['upperarm_' + side]]]
            if np.linalg.norm(wrist - sh[side]) > LU[side] + LF[side]:
                reach_fail += 1
            qU, elbow, restF = ik_arm(side, sh[side], wrist, eh[side], W, Pu, pstate[side], slew)
            Mu = Pu @ trs(np.array(nodes[byname['upperarm_' + side]].get('translation', [0, 0, 0]), float),
                          qU, np.ones(3))
            des = wrist - elbow; des /= np.linalg.norm(des)
            dl = np.linalg.inv(Mu[:3, :3]) @ des; dl /= np.linalg.norm(dl)
            v = np.cross(restF, dl); c = np.dot(restF, dl)
            qF = np.array([v[0], v[1], v[2], 1.0 + c]); qF /= np.linalg.norm(qF)
            Mf = Mu @ trs(np.array(nodes[byname['lowerarm_' + side]].get('translation', [0, 0, 0]), float),
                          qF, np.ones(3))
            qHl = qmul(qinv(mat2quat(Mf)), qHw); qHl /= np.linalg.norm(qHl)
            Mh = Mf @ trs(np.array(nodes[byname['hand_' + side]].get('translation', [0, 0, 0]), float),
                          qHl, np.ones(3))
            got = (Mh @ np.append(ctr[side], 1.0))[:3]
            errs.append(np.linalg.norm(np.cross(got - T, d)) * SCALE)
            tracks['upperarm_' + side].append(qU)
            tracks['lowerarm_' + side].append(qF)
            tracks['hand_' + side].append(qHl)
    times = list(ts)
    if cyc:                       # close the loop: repeat frame 0 at t=duration
        dur = float(ts[-1] + (ts[1] - ts[0])) if len(ts) > 1 else 0.0
        times = list(ts) + [dur]
        for b in BONES:
            tracks[b].append(tracks[b][0])
    # RETIME — the solve sampled the 30 fps export, the payload runs at 24. The
    # body tracks these arms sit next to have already been retimed (by the merge
    # for the new clips, and long ago for the three stances), so without this the
    # arms run 25 % fast against their own clip's legs. See bakepack3.py.
    times = [t * RETIME for t in times]
    for b in BONES:               # keep quaternions in one hemisphere for slerp
        q = np.array(tracks[b])
        for i in range(1, len(q)):
            if np.dot(q[i - 1], q[i]) < 0:
                q[i] = -q[i]
        tracks[b] = q
    OUT[cn] = (np.array(times, dtype=np.float32), tracks)
    REP.append((cn, len(times), np.mean(errs) * 1000, np.max(errs) * 1000, reach_fail))

print("%-26s %5s %12s %12s %10s" % ("clip", "keys", "mean err mm", "max err mm", "unreachable"))
for r in REP:
    print("%-26s %5d %12.4f %12.4f %10d" % r)
print("\n'err' = how far each hand's grip tunnel sits off the shaft line. Both hands")
print("are on one shaft BY CONSTRUCTION here, so this is a tautology check and reads")
print("~0 even when a clip is visibly broken (08-04 lesson). The real verification")
print("resamples the FINAL PAYLOAD BETWEEN the keys — see bakepack_verify.py.")
pickle.dump(OUT, open('tracks_new.pkl', 'wb'))
print("\nsaved tracks_new.pkl")
