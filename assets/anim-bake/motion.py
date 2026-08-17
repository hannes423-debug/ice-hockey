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
def rng(q):
    # max pairwise-ish: angle from first key
    q0=q[0]; m=0
    for x in q:
        d=x if np.dot(q0,x)>=0 else -x
        m=max(m, math.degrees(2*math.acos(min(1.0,abs(float(np.dot(q0,d)))))))
    return m
GROUPS={'arms':['upperarm_l','lowerarm_l','hand_l','upperarm_r','lowerarm_r','hand_r','shoulderL','shoulderR'],
        'spine':['spine_01','spine_02','spine_03','neck','neck_01','head'],
        'legs':['thigh_l','calf_l','foot_l','thigh_r','calf_r','foot_r'],
        'root':['root']}
names=[a['name'] for a in NJ['animations']]
print("%-26s %6s %8s %8s %8s %8s"%("clip","keys","arms","spine","legs","rootMove"))
for cn in names:
    ch=tracks(cn)
    nk=max(len(v['rotation'][0]) for v in ch.values() if 'rotation' in v)
    out={}
    for g,bs in GROUPS.items():
        m=0
        for b in bs:
            if b in ch and 'rotation' in ch[b]: m=max(m,rng(ch[b]['rotation'][1]))
        out[g]=m
    rt=ch.get('root',{}).get('translation')
    rm=float(np.linalg.norm(rt[1]-rt[1][0],axis=1).max()*SCALE) if rt is not None else 0.0
    print("%-26s %6d %8.2f %8.2f %8.2f %8.3f"%(cn,nk,out['arms'],out['spine'],out['legs'],rm))
