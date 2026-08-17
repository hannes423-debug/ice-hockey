exec(open('fk.py').read())
import numpy as np, math
from glb import read_glb, read_accessor
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
    return ch,max(t[-1] for v in ch.values() for t,_ in v.values())
ARM={'upperarm_r','lowerarm_r','hand_r','upperarm_l','lowerarm_l','hand_l'}
def qang(a,b):
    if np.dot(a,b)<0: b=-b
    return math.degrees(2*math.acos(min(1.0,abs(float(np.dot(a,b))))))
PAIRS=[('IdleN','1IdleN'),('IdleL','1IdleL'),('IdleR','1IdleR'),('Shooting','1Shooting'),
       ('GlideForward','2GlideForward'),('SlapShot','2SlapShot'),('StopHockey','2StopHockey'),
       ('TurnPunchL','2TurnPunchL'),('WalkForward','1WalkForward')]
print("%-22s %14s %14s"%("clip","ARM bones deg","OTHER bones deg"))
for sh,rw in PAIRS:
    cs,ds=clip(sh); cr,dr=nclip(rw)
    arm=0; oth=0
    for t01 in np.linspace(0,1,25):
        Ws=sample(cs,ds*t01); Wr=sample(cr,dr*t01)
        for bn,i in byname.items():
            j=byname.get(bn)
            if j is None: continue
            # compare LOCAL rotations via world->local is messy; compare world orientation
            a=Ws[i][:3,:3].copy(); b=Wr[i][:3,:3].copy()
            for M in (a,b):
                for c in range(3): M[:,c]/=max(1e-12,np.linalg.norm(M[:,c]))
            d=math.degrees(math.acos(min(1.0,max(-1.0,(np.trace(a.T@b)-1)/2))))
            if bn in ARM: arm=max(arm,d)
            elif bn.startswith(('f_','palm','thumb')): pass
            else: oth=max(oth,d)
    print("%-22s %14.2f %14.2f"%(sh,arm,oth))
