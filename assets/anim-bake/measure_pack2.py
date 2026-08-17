exec(open('fk.py').read())
import numpy as np, math
from glb import read_glb, read_accessor
AX=np.load('gripaxis.npy'); GRIP_AX_R,GRIP_CTR_R,GRIP_AX_L,GRIP_CTR_L=AX[0],AX[1],AX[2],AX[3]
NJ,NB=read_glb('../new_anim.glb')
nan=[remap(n.get('name') or '') for n in NJ['nodes']]
def nclip(name):
    a=[x for x in NJ['animations'] if x['name']==name][0]
    ch={}
    for c in a['channels']:
        sm=a['samplers'][c['sampler']]
        ch.setdefault(nan[c['target']['node']],{})[c['target']['path']]=(
            np.array(read_accessor(NJ,NB,sm['input']),float)[:,0],
            np.array(read_accessor(NJ,NB,sm['output']),float))
    return ch, max(t[-1] for v in ch.values() for t,_ in v.values())
def gw(W):
    o={}
    for s,hb,ctr,ax in (('r','hand_r',GRIP_CTR_R,GRIP_AX_R),('l','hand_l',GRIP_CTR_L,GRIP_AX_L)):
        H=W[byname[hb]]; o[s]=((H@np.append(ctr,1.0))[:3], H[:3,:3]@ax)
    return o
NEWC=['0IdleNeutral','0IdleForeHand','0IdleForeHandPulledBack','0IdleBackHand',
 '0IdleNeutralToForeHand','0IdleNeutralToBackHand','0IdleForeHandToNeutral',
 '0IdleForeHandToBackHand','0IdleBackHandToNeutral','0IdleBackHandToForeHand',
 '3SpinoramaL','3SpinoramaR','3WindmillDekeL','3WindmillDekeR']
CTRL=['1IdleN','2SlapShot']
print("%-26s %8s %8s %8s %9s  %s"%("clip","sep_min","sep_max","axiserr","rootY_rng","verdict"))
for cn in CTRL+NEWC:
    ch,dur=nclip(cn); seps=[];errs=[];ry=[]
    n=32
    for k in range(n):
        t=dur*k/(n-1)
        W=sample(ch,t); g=gw(W)
        d=g['l'][0]-g['r'][0]; L=np.linalg.norm(d); seps.append(L*SCALE)
        u=d/L; c=abs(np.dot(u,g['r'][1]/np.linalg.norm(g['r'][1])))
        errs.append(math.degrees(math.acos(min(1.0,c))))
        ry.append(W[byname['root']][1,3]*SCALE)
    ok = min(seps)>0.20 and max(seps)<0.55 and max(errs)<8.0
    mark='   <-- known-BAD control' if cn in CTRL else ''
    print("%-26s %8.3f %8.3f %8.2f %9.3f  %-14s%s"%(cn,min(seps),max(seps),max(errs),max(ry)-min(ry),'HOLDS A STICK' if ok else 'no stick',mark))
