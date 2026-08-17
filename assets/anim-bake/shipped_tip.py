exec(open('bake.py').read())
import numpy as np, math
CL=['Idle','IdleN','IdleL','IdleR','Shooting','GlideForward','WalkForwardWithPuck','SlapShot','StopHockey']
print("SHIPPED payload (already grip-baked). Shaft = line through the two baked grips.")
print("%-22s %14s %14s %14s %7s %8s"%("clip","tip fwd","tip lat","tip y","sep","axerr"))
for cn in CL:
    ch,dur=clip(cn); F=[];L_=[];Y=[];S=[];E=[]
    ts=np.linspace(0,dur,33) if dur>0 else np.array([0.0])
    for t in ts:
        W=sample(ch,t)
        pel=W[byname['root']][:3,3]
        HR=W[byname['hand_r']]; HL=W[byname['hand_l']]
        gR=(HR@np.append(GRIP_CTR_R,1.0))[:3]; gL=(HL@np.append(GRIP_CTR_L,1.0))[:3]
        v=gL-gR; s=np.linalg.norm(v); u=v/s
        axR=HR[:3,:3]@GRIP_AX_R; axR/=np.linalg.norm(axR)
        E.append(math.degrees(math.acos(min(1.0,abs(float(np.dot(axR,u)))))))
        tip=gR+u*G2T; rel=tip-pel
        F.append(np.dot(rel,FWD)*SCALE); L_.append(np.dot(rel,LEFT)*SCALE)
        Y.append(tip[1]*SCALE); S.append(s*SCALE)
    f=lambda a:"%6.2f..%-6.2f"%(min(a),max(a))
    print("%-22s %14s %14s %14s %7.2f %8.2f"%(cn,f(F),f(L_),f(Y),np.mean(S),max(E)))
