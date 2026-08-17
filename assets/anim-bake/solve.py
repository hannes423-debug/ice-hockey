exec(open('fk.py').read())
CL=['IdleN','IdleL','IdleR','WalkForward','WalkBackward','WalkForwardWithPuck','Shooting']
Wb=world(locals_bind())
fwd=(Wb[byname['toeR']][:3,3]-Wb[byname['heel02R']][:3,3])*SCALE; fwd[1]=0; fwd/=np.linalg.norm(fwd)
left=(Wb[byname['upperarm_l']][:3,3]-Wb[byname['upperarm_r']][:3,3])*SCALE; left[1]=0; left/=np.linalg.norm(left)
print("model FORWARD %s   LEFT %s   dot %.3f"%(np.round(fwd,3),np.round(left,3),np.dot(fwd,left)))
UP=np.array([0.,1.,0.])
# animated shoulder + pelvis heights (the clips carry a crouch in the root track)
print("\nanimated joint heights (mean over clip):")
print("%-22s %7s %7s %7s %7s"%("clip","shL.y","shR.y","pelvis.y","armLen"))
SH={}
armlen=None
for cn in CL:
    ch,dur=clip(cn); a=[]
    for t in np.linspace(0,max(dur,1e-6),12):
        W=sample(ch,t)
        sL=W[byname['upperarm_l']][:3,3]*SCALE; sR=W[byname['upperarm_r']][:3,3]*SCALE
        pv=W[byname['root']][:3,3]*SCALE
        u=np.linalg.norm(W[byname['lowerarm_l']][:3,3]-W[byname['upperarm_l']][:3,3])*SCALE
        f=np.linalg.norm(W[byname['hand_l']][:3,3]-W[byname['lowerarm_l']][:3,3])*SCALE
        a.append([sL,sR,pv,[u+f,0,0]])
    m=np.mean(np.array(a),0); SH[cn]=m
    armlen=m[3][0]
    print("%-22s %7.3f %7.3f %7.3f %7.3f"%(cn,m[0][1],m[1][1],m[2][1],m[3][0]))

STICK=1.45; SNAP=0.06; G2T=STICK-SNAP; ICE=0.02
print("\nMinimum arm scale k for a feasible two-handed grip (blade on the ice, tip 0.85-1.00 m ahead):")
print("%-22s %8s %8s %10s"%("clip","best k","spacing","tip fwd"))
worst=0
for cn in CL:
    sL,sR,pv,_=SH[cn]
    best=None
    for kk in np.arange(1.00,2.01,0.01):
        R=armlen*kk*0.97
        ok=None
        for tf in np.arange(0.80,1.10,0.05):
          for tl in np.arange(-0.10,0.45,0.05):
            tip=pv+fwd*tf+left*tl; tip[1]=ICE
            for gx in np.arange(-0.30,0.10,0.05):
             for gy in np.arange(0.85,1.30,0.05):
              for gz in np.arange(-0.05,0.45,0.05):
                top=pv+left*gx+UP*(gy-pv[1])+fwd*gz
                v=tip-top; L=np.linalg.norm(v)
                if abs(L-G2T)>0.05: continue
                d=v/L
                if np.linalg.norm(top-sR)>R: continue
                for sp in np.arange(0.25,0.50,0.05):
                    low=top+d*sp
                    if np.linalg.norm(low-sL)<=R:
                        ok=(sp,tf); break
                if ok: break
              if ok: break
             if ok: break
            if ok: break
          if ok: break
        if ok: best=(kk,)+ok; break
    if best: print("%-22s %8.2f %8.2f %10.2f"%(cn,best[0],best[1],best[2])); worst=max(worst,best[0])
    else:    print("%-22s   INFEASIBLE even at k=2.0"%cn)
print("\n=> arm scale needed across all clips: k = %.2f  (arms %.3f -> %.3f m)"%(worst,armlen,armlen*worst))
