exec(open('fk.py').read())
import numpy as np, math
from glb import read_glb, read_accessor
NJ,NB=read_glb('../new_anim.glb')
nan=[remap(n.get('name') or '') for n in NJ['nodes']]
def tracks(name):
    a=[x for x in NJ['animations'] if x['name']==name][0]
    ch={}
    for c in a['channels']:
        sm=a['samplers'][c['sampler']]
        ch.setdefault(nan[c['target']['node']],{})[c['target']['path']]=(
            np.array(read_accessor(NJ,NB,sm['input']),float)[:,0],
            np.array(read_accessor(NJ,NB,sm['output']),float))
    return ch
KEY=['spine_01','spine_03','head','upperarm_l','upperarm_r','thigh_l','thigh_r','calf_l','calf_r','foot_l','foot_r']
CL=['0IdleNeutral','0IdleForeHandPulledBack','0IdleNeutralToForeHand','0IdleNeutralToBackHand',
    '0IdleForeHandToNeutral','0IdleForeHandToBackHand','0IdleBackHandToNeutral','0IdleBackHandToForeHand',
    '3SpinoramaL','3SpinoramaR','3WindmillDekeL','3WindmillDekeR','2GlideForward','2TurnPunchL']
print("%-28s %10s %10s  %s"%("clip","maxdrot(deg)","rootd(mm)","loops?"))
for cn in CL:
    ch=tracks(cn); mx=0; who=''
    for b in KEY:
        q=ch.get(b,{}).get('rotation')
        if q is None: continue
        v=q[1]
        if len(v)<2: continue
        q0,q1=v[0],v[-1]
        if np.dot(q0,q1)<0: q1=-q1
        d=math.degrees(2*math.acos(min(1.0,abs(float(np.dot(q0,q1))))))
        if d>mx: mx=d; who=b
    rt=ch.get('root',{}).get('translation')
    rd=float(np.linalg.norm(rt[1][-1]-rt[1][0])*SCALE*1000) if rt is not None and len(rt[1])>1 else 0.0
    print("%-28s %10.2f %10.1f  %s  (@%s)"%(cn,mx,rd,'LOOPS' if mx<3.0 else 'no',who))
