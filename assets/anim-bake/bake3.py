exec(open('bake.py').read())
from scipy.optimize import minimize
FPS=60.0
# clips whose arms swing fast enough that 60 Hz still corner-cuts between keys
FPS_CLIP={'SlapShot':240.0,'StopHockey':240.0,'TurnPunchL':240.0,'TurnPunchR':240.0,'Acceleration':240.0}
CYCLIC={'GlideForward','TurnTightL','TurnTightR'}
CLIPS=['Acceleration', 'GlideForward', 'SlapShot', 'Stop', 'StopHockey', 'TurnPunchL', 'TurnPunchR', 'TurnTightL', 'TurnTightR']
TRUST_RATE={'T':6.0,'psi':900.0,'sp':2.5}  # m/s, deg/s, m/s
TIP_FWD=G(0.90); TIP_LAT=G(0.12)          # blade ~0.9 m ahead, a touch to the forehand (left) side
def dirv(T,psi):
    dy=np.clip((ICE-T[1])/G2T,-1,1); h=math.sqrt(max(0.0,1-dy*dy))
    return np.array([h*math.cos(psi),dy,h*math.sin(psi)])
def solve_frame(pel,sR,sL,aR,aL,seed,rollref=None,trust=None):
    def unpack(x):
        T=x[:3]; d=dirv(T,x[3]); return T,d,T+d*x[4],T+d*G2T
    def obj(x):
        T,d,Lg,tip=unpack(x)
        rel=tip-pel
        return (np.dot(T-aR,T-aR)*1.0 + np.dot(Lg-aL,Lg-aL)*0.55
                + (np.dot(rel,FWD)-TIP_FWD)**2*0.9 + (np.dot(rel,LEFT)-TIP_LAT)**2*0.5)
    # constrain the WRIST, not the grip point: the wrist sits |GRIP_CTR| (~0.15)
    # away from the point on the shaft, so constraining the grip point lets the
    # solver hand the IK a target it cannot reach.
    def wr(x,side):
        T,d,Lg,tip=unpack(x)
        g,sh,c,ax=(T,sR,GRIP_CTR_R,GRIP_AX_R) if side=='r' else (Lg,sL,GRIP_CTR_L,GRIP_AX_L)
        rf=(rollref or {}).get(side)
        return np.linalg.norm(hand_frame_and_wrist(g,sh,d,c,ax,rf)[1]-sh)
    cons=[{'type':'ineq','fun':lambda x: REACH['r']-wr(x,'r')},
          {'type':'ineq','fun':lambda x: REACH['l']-wr(x,'l')},
          # the arm cannot fold through itself — see MINREACH in bake.py
          {'type':'ineq','fun':lambda x: wr(x,'r')-MINREACH['r']},
          {'type':'ineq','fun':lambda x: wr(x,'l')-MINREACH['l']}]
    bnds=[(None,None)]*3+[(-4*math.pi,4*math.pi),(SP_MIN,SP_MAX)]
    def cold():
        return [np.array([sR[0],sR[1]-G(0.18),sR[2]+G(0.14),psi0,(SP_MIN+SP_MAX)/2])
                for psi0 in np.linspace(0,2*math.pi,6,endpoint=False)]
    def attempt(x0,cs):
        r=minimize(obj,x0,method='SLSQP',bounds=bnds,constraints=cs,
                   options={'maxiter':160,'ftol':1e-9})
        if not r.success: return None
        v=max(wr(r.x,'r')-REACH['r'],wr(r.x,'l')-REACH['l'],
              MINREACH['r']-wr(r.x,'r'),MINREACH['l']-wr(r.x,'l'))
        return None if v>1e-4 else (r.fun,r.x.copy())
    def sweep():
        best=None
        for x0 in cold():
            c=attempt(x0,cons)
            if c and (best is None or c[0]<best[0]): best=c
        return best
    if seed is None:                       # first frame: nothing to be near
        b=sweep(); return b[1] if b else None
    # TRUST REGION — the fix for the solver changing its mind between adjacent
    # frames. The objective has several basins (the shaft can reach the same
    # authored hands from more than one azimuth), and two things let the solve
    # hop between them: nothing tied a frame to its predecessor, and when the
    # warm start FAILED the old code fell back to a cold 6-way psi sweep, which
    # simply takes whichever basin scores best. Measured on SlapShot: the grip
    # moved 0.203 m in 8.3 ms (24 m/s) and psi swung 19.1 deg, against p99
    # figures of 0.038 m and 3.5 deg.
    # So: bound the step, relax the bound in stages if that is infeasible, and
    # only cold-sweep when every relaxation has failed — losing continuity is
    # now the last resort instead of the first. Rates are per second so the
    # bound means the same thing at 60 and 120 Hz.
    for mul in (1.0,2.0,4.0,8.0):
        tr={k:trust[k]*mul for k in trust}
        c=attempt(seed,cons+[
            {'type':'ineq','fun':lambda x,t=tr: t['T']-np.linalg.norm(x[:3]-seed[:3])},
            {'type':'ineq','fun':lambda x,t=tr: t['psi']-abs(x[3]-seed[3])},
            {'type':'ineq','fun':lambda x,t=tr: t['sp']-abs(x[4]-seed[4])}])
        if c is not None: return c[1]
    c=attempt(seed,cons)                   # unbounded, but still from the seed
    if c is not None: return c[1]
    b=sweep(); return b[1] if b else None  # last resort: continuity abandoned

SOL={}
print("solving grips...")
for cn in CLIPS:
    ch,dur=clip(cn)
    fps=FPS_CLIP.get(cn,FPS)
    n=max(1,int(round(dur*fps))+1) if dur>0 else 1
    ts=np.linspace(0,dur,n) if dur>0 else np.array([0.0])
    if cn in CYCLIC and n>2: ts=ts[:-1]
    dtc=float(ts[1]-ts[0]) if len(ts)>1 else 1/60.
    trust={'T':G(TRUST_RATE['T']*dtc),'psi':math.radians(TRUST_RATE['psi'])*dtc,
           'sp':G(TRUST_RATE['sp']*dtc)}
    xs=[];seed=None;ctx=[];rollref={'r':None,'l':None}
    for t in ts:
        W=sample(ch,t)
        pel=W[byname['root']][:3,3]
        sR=W[byname['upperarm_r']][:3,3]; sL=W[byname['upperarm_l']][:3,3]
        aR=W[byname['hand_r']][:3,3];     aL=W[byname['hand_l']][:3,3]
        eR=W[byname['lowerarm_r']][:3,3]; eL=W[byname['lowerarm_l']][:3,3]
        x=solve_frame(pel,sR,sL,aR,aL,seed,rollref,trust)
        assert x is not None,'no grip: %s @ %.3f'%(cn,t)
        # keep psi continuous frame to frame so smoothing/looping behaves
        if seed is not None:
            while x[3]-seed[3]> math.pi: x[3]-=2*math.pi
            while x[3]-seed[3]<-math.pi: x[3]+=2*math.pi
        # store the roll this frame actually settled on, for the next frame
        Tf=x[:3]; df=dirv(Tf,x[3]); Lgf=Tf+df*x[4]
        rollref['r']=hand_frame_and_wrist(Tf,sR,df,GRIP_CTR_R,GRIP_AX_R,rollref['r'])[2]
        rollref['l']=hand_frame_and_wrist(Lgf,sL,df,GRIP_CTR_L,GRIP_AX_L,rollref['l'])[2]
        seed=x.copy(); xs.append(x); ctx.append((W,sR,sL,eR,eL,pel))
    SOL[cn]=(ts,np.array(xs),ctx)
    tips=np.array([xs[i][:3]+dirv(xs[i][:3],xs[i][3])*G2T for i in range(len(xs))])
    rel=tips-np.array([c[5] for c in ctx])
    print("  %-22s %3d keys  tip fwd %.2f m  lat %+.2f m  y %.3f  spacing %.2f m"%(
        cn,len(ts),(rel@FWD).mean()*SCALE,(rel@LEFT).mean()*SCALE,tips[:,1].mean()*SCALE,
        np.mean([x[4] for x in xs])*SCALE))
import pickle; pickle.dump(SOL,open('sol.pkl','wb'))
print("saved sol.pkl")
