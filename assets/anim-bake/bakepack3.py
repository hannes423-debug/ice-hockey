"""Shared setup for the 2026-08-15 pack (the 3-stance graph + dekes/spinoramas).

WHAT IS DIFFERENT FROM bake3.py/bake4.py (the ones that produced the shipped
payload, preserved here as *.shipped):

 1. THE BLADE IS NO LONGER PINNED TO THE ICE AT A FIXED FOREHAND OFFSET.
    The old `dirv(T,psi)` solved the shaft elevation FROM the requirement that
    tip.y == ICE, so the blade was on the ice on every frame of every clip, and
    `TIP_FWD/TIP_LAT` pulled it to one fixed spot ahead and to the forehand
    side. That was survivable for skating clips. It is wrong for this pack:
      * ForeHand and BackHand are the SAME stance under it (one fixed TIP_LAT),
        which is the entire distinction the stance graph exists to express;
      * WindmillDeke lifts the blade to 0.83-0.90 m over the puck, and pinning
        it flattens the move the same way it already flattens the SlapShot
        windup (a known, documented defect of the old bake);
      * Spinorama sweeps the blade a full turn around the skater.
    So the shaft now carries a free elevation (psi, theta) and the tip is
    pulled to a PER-FRAME target with a hard `tip.y >= ICE` floor.

 2. THE TARGET COMES FROM THE AUTHORED HANDS, PER FRAME.
    `authored_tip()` reads the two hands' measured grip tunnels out of the RAW
    export and extends the line through them to blade length. The hands are not
    on a common shaft (that is what this bake is for: separation 0.55-0.64 m
    against a real grip's 0.26-0.44, tunnel axes 20-48 deg apart) but the LINE
    they define still carries the animator's intent, and for this pack it is
    demonstrably good: ForeHand reads tip y 0.00-0.02 / lat +0.71, BackHand
    y 0.00-0.05 / lat -0.34..-0.29, PulledBack fwd -0.50, Windmill y 0.00->0.85.
    Measured with authored_tip.py before any of this was written.

    It is NOT good on the old pack (IdleN reads tip y 0.91, arms at the sides)
    which is why the old bake used constants instead. Only the 11 clips in
    NEWCLIPS are baked here; nothing already in the payload is touched.

 3. ENDPOINT PINNING (see PIN_MODE). Every transition clip has to hand over to
    a stance clip that is ALREADY in the payload, so its first and last frame
    have to agree with what that stance clip actually holds, or the handover
    pops. See the note on PIN_MODE below - this is the one thing the shipped
    payload makes genuinely awkward.
"""
exec(open('bake.py').read())
import numpy as np, math
from glb import read_glb, read_accessor

RAW = '../new_anim.glb'

# ---- the 11 genuinely new clips -------------------------------------------
# 0IdleNeutral/0IdleForeHand/0IdleBackHand are BYTE-IDENTICAL to the shipped
# IdleN/IdleL/IdleR (verified: maxabs 0.000000 over every track) and 0Idle is
# the shipped static 'Idle'. They are renames, not new clips, and re-importing
# them would duplicate them AND throw away the grip bake they already carry.
#
# src/dst name the SHIPPED stance clip each end has to meet, measured by
# clustering every clip's first and last frame against the stance poses: every
# one lands within 0.05 deg, so this table is measured, not assumed.
NEWCLIPS = {
    #  raw name in new_anim.glb    out name                 src     dst    cyclic
    '0IdleForeHandPulledBack': ('IdleForeHandPulledBack', None,   None,   True),
    '0IdleNeutralToForeHand':  ('IdleNeutralToForeHand',  'IdleN', 'IdleL', False),
    '0IdleNeutralToBackHand':  ('IdleNeutralToBackHand',  'IdleN', 'IdleR', False),
    '0IdleForeHandToNeutral':  ('IdleForeHandToNeutral',  'IdleL', 'IdleN', False),
    '0IdleForeHandToBackHand': ('IdleForeHandToBackHand', 'IdleL', 'IdleR', False),
    '0IdleBackHandToNeutral':  ('IdleBackHandToNeutral',  'IdleR', 'IdleN', False),
    '0IdleBackHandToForeHand': ('IdleBackHandToForeHand', 'IdleR', 'IdleL', False),
    '3WindmillDekeL':          ('WindmillDekeL',          'IdleL', 'IdleR', False),
    '3WindmillDekeR':          ('WindmillDekeR',          'IdleR', 'IdleL', False),
    # The spinoramas are NOT cyclic, and this cost a bake to find out. Their
    # BODY loops — start and end cluster on the BackHand stance within 0.05 deg,
    # end-to-end rotation 0.03 deg — so a loop test on the authored clip says
    # "cyclic". But `cyclic` here means "repeat frame 0's ARM pose at t=dur",
    # and the solved arms do NOT come back: the shaft sweeps a full turn, and
    # the hand roll and elbow pole legitimately end somewhere else. Measured on
    # the first bake: every solved key moved <= 3.75 deg, and then the appended
    # closure jumped upperarm_l 122.9 and hand_l 176.1 deg in one key, which the
    # between-keys verify caught as a 350 m/s blade jump.
    # They are one-shot moves played through playOnce, never looped, so the
    # closure has no reason to exist. MEASURE THE THING THE FLAG CONTROLS.
    '3SpinoramaL':             ('SpinoramaL',             'IdleR', 'IdleR', False),
    '3SpinoramaR':             ('SpinoramaR',             'IdleR', 'IdleR', False),
}

# The three stance clips are RE-BAKED (user decision, 2026-08-15) so the whole
# graph is consistent: a transition solved to the authored blade path has to
# land on a stance clip solved the same way, or the join pops. They already
# exist in the payload, so write_anim rewrites their 6 arm tracks in place —
# they are NOT appended by the merge step.
#
# This is a GRIP re-bake. It is not the arm-lengthening re-bake that was played
# and rejected on 08-04 ("even more dismorphed"); that one moved the bones, this
# one only re-solves where the hands hold the shaft.
STANCES = {
    '1IdleN': ('IdleN', None, None, True),
    '1IdleL': ('IdleL', None, None, True),
    '1IdleR': ('IdleR', None, None, True),
}
ALLCLIPS = dict(NEWCLIPS); ALLCLIPS.update(STANCES)

# Clips whose arms swing fast enough that 60 Hz corner-cuts between keys. The
# ordering lesson from the 08-04 run applies: fix CONTINUITY first, then raise
# density - subdividing a true discontinuity just samples it more finely.
FPS = 60.0
FPS_CLIP = {'3WindmillDekeL': 240.0, '3WindmillDekeR': 240.0,
            '3SpinoramaL': 240.0, '3SpinoramaR': 240.0}

# THE EXPORT IS 30 fps, THE PAYLOAD IS 24. The shipped 8 clips were built at 24
# (IdleN: 80 frames -> 3.333 s) and the graph's crossfade/dwell constants are
# tuned against those durations, so merge.py retimes every clip it appends.
# The bake samples the RAW export, which is still in the 30 fps base, so the
# solved arm tracks MUST be retimed by the same factor before they are written
# next to body tracks that already have been — otherwise the arms run 25 %
# fast against their own clip's legs. bake3.py never had to do this because it
# sampled the PAYLOAD, which was already retimed.
RETIME = 30.0 / 24.0

TRUST_RATE = {'T': 6.0, 'psi': 900.0, 'th': 900.0, 'sp': 2.5}   # m/s, deg/s, deg/s, m/s

# PIN_MODE decides what the first and last frame of a transition are solved to.
#   'shipped' - meet the shipped stance clip exactly. Continuous with what is on
#               screen today, but the shipped stances are NOT a clean grip
#               (measured: IdleL hands 0.630 m apart with their tunnel axes
#               69 deg apart, IdleR blade 0.27 m BELOW the ice, IdleN blade
#               0.56 m in the air) so the new clips inherit that at the joins.
#   'authored'- solve purely to the authored blade path, clamped to y >= ICE.
#               The new clips come out clean and self-consistent; the handover
#               to the shipped idles steps by whatever the two disagree by.
#   'blend'   - authored path, but affinely corrected so the endpoints land on
#               the shipped stance tips. Keeps the authored SHAPE (the windmill
#               lift, the spinorama sweep, the pulled-back reach) and still
#               joins cleanly. Endpoints inherit the shipped tips' problems.
PIN_MODE = 'authored'

NJ, NB = read_glb(RAW)
_nan = [remap(n.get('name') or '') for n in NJ['nodes']]

def rawclip(name):
    a = [x for x in NJ['animations'] if x['name'] == name][0]
    ch = {}
    for c in a['channels']:
        sm = a['samplers'][c['sampler']]
        ch.setdefault(_nan[c['target']['node']], {})[c['target']['path']] = (
            np.array(read_accessor(NJ, NB, sm['input']), float)[:, 0],
            np.array(read_accessor(NJ, NB, sm['output']), float))
    return ch, max(t[-1] for v in ch.values() for t, _ in v.values())

def grips(W):
    """the two hands' measured grip-tunnel centres, in world/model units."""
    gR = (W[byname['hand_r']] @ np.append(GRIP_CTR_R, 1.0))[:3]
    gL = (W[byname['hand_l']] @ np.append(GRIP_CTR_L, 1.0))[:3]
    return gR, gL

def authored_tip(W):
    """extend the line through the two authored grips out to blade length."""
    gR, gL = grips(W)
    v = gL - gR
    n = np.linalg.norm(v)
    if n < 1e-9:
        return gR + np.array([0., -1., 0.]) * G2T
    return gR + (v / n) * G2T

def shipped_tip(clipname):
    """where the SHIPPED (already grip-baked) stance clip puts the blade, at its
       frame 0, expressed relative to that clip's own root so it can be moved
       onto the new clip's root."""
    ch, dur = clip(clipname)
    W = sample(ch, 0.0)
    return authored_tip(W) - W[byname['root']][:3, 3]

# ---- shaft direction: azimuth + elevation, no ice pin ----------------------
def shaft_dir(psi, th):
    ct = math.cos(th)
    return np.array([ct * math.cos(psi), math.sin(th), ct * math.sin(psi)])

# ---- the one stance with no valid stick pose in either source ---------------
# The authored Neutral hands put the blade 0.91 m in the air (the animator has
# the arms hanging at the sides: it is the same pose the 08-01 bake note calls
# out) and the shipped IdleN bake puts it 0.56 m up and behind the hip. Neither
# is a blade. Neutral is the graph node BETWEEN ForeHand and BackHand, so its
# blade is DERIVED as their midpoint dropped onto the ice, rather than being a
# magic constant — measured off the authored stances at import time.
_NEUTRAL_TIP = None
def neutral_tip():
    """HORIZONTAL root-relative blade offset for the Neutral stance. The height
       is NOT carried here: ICE is an absolute height and the root rides up and
       down through a clip, so the y is applied after the root is added on (see
       resolve_endpoint) rather than baked into a root-relative vector."""
    global _NEUTRAL_TIP
    if _NEUTRAL_TIP is None:
        acc = []
        for c in ('0IdleForeHand', '0IdleBackHand'):
            raw, dur = rawclip(c)
            W = sample(raw, 0.0)
            acc.append(authored_tip(W) - W[byname['root']][:3, 3])
        t = (acc[0] + acc[1]) / 2.0
        t[1] = 0.0
        _NEUTRAL_TIP = t
    return _NEUTRAL_TIP

# Endpoint overrides. Only Neutral needs one; the ForeHand and BackHand ends are
# solved straight to their authored blade path, and the stance clips themselves
# are re-baked to the same path, so every join is consistent by construction
# rather than by correction.
def endpoint_override(stance):
    return neutral_tip() if stance == 'IdleN' else None

def resolve_endpoint(stance, root, fallback):
    """world-space blade target for one end of a clip."""
    ov = endpoint_override(stance)
    if ov is None:
        return fallback
    e = root + ov
    e[1] = ICE                     # absolute: the neutral blade is ON the ice
    return e

def tip_targets(cn, ts, ctxroots):
    """the per-frame blade target for one clip, in world/model units."""
    raw, dur = rawclip(cn)
    P = np.array([authored_tip(sample(raw, t)) for t in ts])
    out, src, dst, cyc = ALLCLIPS[cn]
    if cn in STANCES:
        # a stance loop is its own endpoint; only Neutral is overridden
        E = resolve_endpoint(out, ctxroots[0], None)
        tgt = P if E is None else P + (E - P[0])
    elif PIN_MODE == 'shipped':
        E0 = shipped_tip(src) + ctxroots[0]
        E1 = shipped_tip(dst) + ctxroots[-1]
        u = np.linspace(0, 1, len(ts))[:, None]
        tgt = E0 * (1 - u) + E1 * u
    else:
        # 'authored' — the authored blade path, with the Neutral end (and only
        # the Neutral end) corrected onto the derived neutral blade. The
        # correction is affine in t so the authored SHAPE survives: the windmill
        # lift, the spinorama sweep and the pulled-back reach are all in P.
        E0 = resolve_endpoint(src, ctxroots[0], P[0])
        E1 = resolve_endpoint(dst, ctxroots[-1], P[-1])
        u = np.linspace(0, 1, len(ts))[:, None]
        tgt = P + (E0 - P[0]) * (1 - u) + (E1 - P[-1]) * u
    tgt = tgt.copy()
    tgt[:, 1] = np.maximum(tgt[:, 1], ICE)      # a blade cannot go under the ice
    return tgt
