exec(open('bake.py').read())
import numpy as np, math
for cn in ['IdleL','IdleR']:
    ch,dur=clip(cn)
    for t in (0.0, dur*0.5):
        W=sample(ch,t)
        HR=W[byname['hand_r']]; HL=W[byname['hand_l']]
        gR=(HR@np.append(GRIP_CTR_R,1.0))[:3]; gL=(HL@np.append(GRIP_CTR_L,1.0))[:3]
        u=(gL-gR); sep=np.linalg.norm(u); u/=sep
        axR=HR[:3,:3]@GRIP_AX_R; nR=np.linalg.norm(axR); axR/=nR
        axL=HL[:3,:3]@GRIP_AX_L; nL=np.linalg.norm(axL); axL/=nL
        ang=lambda a,b: math.degrees(math.acos(min(1.0,abs(float(np.dot(a,b))))))
        print("%-7s t=%.2f sep=%.3f m  |axR|raw=%.4f  angle(axR,u)=%6.2f  angle(axL,u)=%6.2f  angle(axR,axL)=%6.2f"
              %(cn,t,sep*SCALE,nR,ang(axR,u),ang(axL,u),ang(axR,axL)))
        # column scales of the hand matrix
        cs=[np.linalg.norm(HR[:3,c]) for c in range(3)]
        print("        hand_r world column norms:", np.round(cs,4), " ARMSCALE=%.4f"%ARMSCALE)
