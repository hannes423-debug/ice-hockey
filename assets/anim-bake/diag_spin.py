exec(open('bakepack3.py').read())
import pickle, numpy as np, math
SOL=pickle.load(open('sol_new.pkl','rb'))
TR=pickle.load(open('tracks_new.pkl','rb'))
def qang(a,b):
    if np.dot(a,b)<0: b=-b
    return math.degrees(2*math.acos(min(1.0,abs(float(np.dot(a,b))))))
for cn in ('3SpinoramaL','3SpinoramaR','3WindmillDekeR'):
    ts,xs,ctx,tgts=SOL[cn]
    times,tracks=TR[cn]
    print("=== %s  solved=%d  written=%d  cyclic=%s"%(cn,len(ts),len(times),ALLCLIPS[cn][3]))
    # biggest per-frame jump in the SOLVED parameters
    dT=np.linalg.norm(np.diff(xs[:,:3],axis=0),axis=1)*SCALE
    dpsi=np.degrees(np.abs(np.diff(xs[:,3])))
    dth=np.degrees(np.abs(np.diff(xs[:,4])))
    dsp=np.abs(np.diff(xs[:,5]))*SCALE
    for nm,a in (('T m',dT),('psi deg',dpsi),('th deg',dth),('sp m',dsp)):
        i=int(np.argmax(a)); print("   max d%-8s %8.4f at key %d/%d"%(nm,a.max(),i,len(a)))
    # biggest per-key jump in the WRITTEN arm quaternions
    for b in ('upperarm_r','hand_r','upperarm_l','hand_l'):
        q=tracks[b]; d=[qang(q[i-1],q[i]) for i in range(1,len(q))]
        i=int(np.argmax(d)); print("   max d%-12s %8.3f deg at key %d/%d"%(b,max(d),i,len(d)))
    # does the cyclic closure actually close?
    if ALLCLIPS[cn][3]:
        print("   CLOSURE: last solved sample vs frame 0:")
        for b in ('upperarm_r','hand_r','upperarm_l','hand_l'):
            q=tracks[b]; print("      %-12s %8.3f deg"%(b,qang(q[-2],q[0])))
    print()
