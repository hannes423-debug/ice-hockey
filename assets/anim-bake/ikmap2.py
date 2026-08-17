"""Names and the posed/unposed split for the 2026-08-17 IK blend.

The animator's new file is "hasa1992 - 3D Low Poly with IK Rig only.blend"
(30 actions, no FK* conversion copies). It is the FIRST IK-rig delivery that
carries the 2026-08-15 stance pack, so 11 clips that had to be baked or
hand-locked now have the animator's own arms AND his own keyed `stick`.

Two things differ from the Aug-4 blend and both are handled here:

  * the three stance idles were RENAMED. 1IdleL/1IdleN/1IdleR are now
    0IdleForeHand/0IdleNeutral/0IdleBackHand -- verified byte-identical at the
    raw fcurve level (dump_fcurves.py, maxabs 0.000000000), so they are renames
    and nothing else. The payload keeps the old names.
  * clip names carry a different numeric prefix, so merge_ik.py's `name[1:]`
    is not enough on its own.

POSED / UNPOSED is a measurement, not a guess -- stickpose.py evaluates the
stick armature in Blender and reads the blade tip's world height. The six
skating clips named in ANIMATOR_ASK.txt are byte-identical to their Aug-4
versions, so they are STILL unposed and still keep the old bake.
"""

# new action name -> payload clip name
RENAME = {
    '0IdleForeHand': 'IdleL',
    '0IdleBackHand': 'IdleR',
    '0IdleNeutral':  'IdleN',
}


def payload_name(action):
    """'2TurnTightL' -> 'TurnTightL', '0IdleForeHand' -> 'IdleL'."""
    if action in RENAME:
        return RENAME[action]
    return action[1:] if action[:1].isdigit() else action


# stickpose.py on the new blend: blade tip reaches the ice at some frame.
POSED = {
    '0IdleBackHand', '0IdleBackHandToForeHand', '0IdleBackHandToNeutral',
    '0IdleForeHand', '0IdleForeHandPulledBack', '0IdleForeHandToBackHand',
    '0IdleForeHandToNeutral', '0IdleNeutralToBackHand', '0IdleNeutralToForeHand',
    '1Shooting', '1WalkForwardWithPuck', '2SlapShot',
    '2TurnPunchL', '2TurnPunchR', '2TurnTightL', '2TurnTightR',
    '3BackHandShot', '3SpinoramaL', '3SpinoramaR',
    '3WindmillDekeL', '3WindmillDekeR',
}

# `stick` never keyed: the control sits at rest, horizontal at chest height,
# and both fists ride it there (handIK.L/R are CHILD_OF it). Blade 0.55-1.24 m
# off the ice for the whole clip -- shipping these would float the stick on the
# most-used states in the game.
UNPOSED = {
    '0IdleNeutral',      # neutral is stickless in every source, tip 1.04 m
    '1WalkForward', '1WalkBackward', '2Acceleration',
    '2GlideForward', '2Stop', '2StopHockey',   # the six from ANIMATOR_ASK.txt
    '3WindmillDekeN',
}

# posed, and not in the shipped payload under any name -- a genuinely new clip
NEW_CLIPS = {'3BackHandShot'}
