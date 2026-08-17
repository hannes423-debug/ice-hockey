exec(open('bake.py').read())
import pickle
SOL=pickle.load(open('sol.pkl','rb'))
CYCLIC={'GlideForward','TurnTightL','TurnTightR'}
def dirv(T,psi):
    dy=np.clip((ICE-T[1])/G2T,-1,1); h=math.sqrt(max(0.0,1-dy*dy))
    return np.array([h*math.cos(psi),dy,h*math.sin(psi)])
def smooth(a,cyc,w=5):
    a=np.asarray(a,float)
    if w<=1 or len(a)<w+1: return a
    k=np.ones(w)/w; out=np.empty_like(a)
    for c in range(a.shape[1]):
        col=a[:,c]
        pad=np.concatenate([col[-(w//2):],col,col[:w//2]]) if cyc else \
            np.concatenate([np.repeat(col[0],w//2),col,np.repeat(col[-1],w//2)])
        out[:,c]=np.convolve(pad,k,'valid')
    return out
SMOOTH_W={'SlapShot':1,'StopHockey':1}
BONES=['upperarm_r','lowerarm_r','hand_r','upperarm_l','lowerarm_l','hand_l']
OUT={}; REP=[]
for cn,(ts,xs,ctx) in SOL.items():
    cyc=cn in CYCLIC
    xs=smooth(xs,cyc,SMOOTH_W.get(cn,3))
    tracks={b:[] for b in BONES}; errs=[]; reach_fail=0
    pstate={'r':{},'l':{}}   # elbow-pole continuity, per side, per clip
    rollref={'r':None,'l':None}  # hand-roll continuity, same rule as bake3
    dt=float(ts[1]-ts[0]) if len(ts)>1 else 0.0
    slew=math.radians(POLE_SLEW_DPS)*dt      # max elbow orbit per key
    for i,t in enumerate(ts):
        W,sR,sL,eR,eL,pel=ctx[i]
        T=xs[i][:3]; d=dirv(T,xs[i][3]); sp=xs[i][4]
        gp={'r':T,'l':T+d*sp}; sh={'r':sR,'l':sL}; eh={'r':eR,'l':eL}
        ctr={'r':GRIP_CTR_R,'l':GRIP_CTR_L}; gax={'r':GRIP_AX_R,'l':GRIP_AX_L}
        for side in ('r','l'):
            qHw,wrist,awy=hand_frame_and_wrist(gp[side],sh[side],d,ctr[side],gax[side],rollref[side])
            rollref[side]=awy
            Pu=W[parent[byname['upperarm_'+side]]]
            if np.linalg.norm(wrist-sh[side])>LU[side]+LF[side]: reach_fail+=1
            qU,elbow,restF=ik_arm(side,sh[side],wrist,eh[side],W,Pu,pstate[side],slew)
            Mu=Pu@trs(np.array(nodes[byname['upperarm_'+side]].get('translation',[0,0,0]),float),qU,np.ones(3))
            des=wrist-elbow; des/=np.linalg.norm(des)
            dl=np.linalg.inv(Mu[:3,:3])@des; dl/=np.linalg.norm(dl)
            v=np.cross(restF,dl); c=np.dot(restF,dl)
            qF=np.array([v[0],v[1],v[2],1.0+c]); qF/=np.linalg.norm(qF)
            Mf=Mu@trs(np.array(nodes[byname['lowerarm_'+side]].get('translation',[0,0,0]),float),qF,np.ones(3))
            qHl=qmul(qinv(mat2quat(Mf)),qHw); qHl/=np.linalg.norm(qHl)
            Mh=Mf@trs(np.array(nodes[byname['hand_'+side]].get('translation',[0,0,0]),float),qHl,np.ones(3))
            got=(Mh@np.append(ctr[side],1.0))[:3]
            errs.append(np.linalg.norm(np.cross(got-T,d))*SCALE)
            tracks['upperarm_'+side].append(qU); tracks['lowerarm_'+side].append(qF); tracks['hand_'+side].append(qHl)
    times=list(ts)
    if cyc:                       # close the loop: repeat frame 0 at t=duration
        dur=float(ts[-1]+(ts[1]-ts[0]) if len(ts)>1 else 0)
        times=list(ts)+[dur]
        for b in BONES: tracks[b].append(tracks[b][0])
    for b in BONES:               # keep quaternions in one hemisphere for slerp
        q=np.array(tracks[b])
        for i in range(1,len(q)):
            if np.dot(q[i-1],q[i])<0: q[i]=-q[i]
        tracks[b]=q
    OUT[cn]=(np.array(times,dtype=np.float32),tracks)
    REP.append((cn,len(times),np.mean(errs)*1000,np.max(errs)*1000,reach_fail))
print("%-22s %5s %12s %12s %10s"%("clip","keys","mean err mm","max err mm","unreachable"))
for r in REP: print("%-22s %5d %12.4f %12.4f %10d"%r)
print("\n'err' = how far each hand's grip tunnel sits off the shaft line. Both hands")
print("on one shaft by construction; anything above ~1 mm would mean the IK clamped.")
pickle.dump(OUT,open('tracks.pkl','wb')); print("\nsaved tracks.pkl")
