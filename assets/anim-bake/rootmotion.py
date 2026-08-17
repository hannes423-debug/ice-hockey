exec(open('bakepack3.py').read())
import numpy as np
def rep(label, tr):
    p=tr-tr[0]
    horiz=np.linalg.norm(p[:,[0,2]],axis=1)*SCALE
    vert=p[:,1]*SCALE
    print("%-26s horiz %5.3f m   vert %+.3f..%+.3f m"%(label,horiz.max(),vert.min(),vert.max()))
print("SHIPPED payload clips:")
for cn in ['IdleN','IdleL','IdleR','GlideForward','StopHockey','SlapShot','TurnPunchL','WalkForward','Acceleration']:
    ch,dur=clip(cn); tr=ch.get('root',{}).get('translation')
    if tr is None or len(tr[1])<2: print("%-26s (no translation track)"%cn); continue
    rep(cn,tr[1])
print("\nNEW clips (raw export):")
for cn in ALLCLIPS:
    raw,dur=rawclip(cn); tr=raw.get('root',{}).get('translation')
    if tr is None or len(tr[1])<2: print("%-26s (constant)"%cn); continue
    rep(cn,tr[1])
