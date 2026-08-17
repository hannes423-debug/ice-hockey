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
BONES=[n for n in names if n and not n.startswith('Cube') and not n.startswith('Plane')]
def pose(cn, first=True):
    ch=tracks(cn); v=[]
    for b in BONES:
        q=ch.get(b,{}).get('rotation')
        if q is None: v.append(np.array([0,0,0,1.0])); continue
        x=q[1][0] if first else q[1][-1]
        v.append(x if x[3]>=0 else -x)
    return np.concatenate(v)
def dist(a,b):
    n=len(a)//4; m=0
    for k in range(n):
        q0,q1=a[4*k:4*k+4],b[4*k:4*k+4]
        if np.dot(q0,q1)<0: q1=-q1
        m=max(m,math.degrees(2*math.acos(min(1.0,abs(float(np.dot(q0,q1)))))))
    return m
CL=['0IdleNeutral','0IdleForeHand','0IdleBackHand','0IdleForeHandPulledBack',
    '0IdleNeutralToForeHand','0IdleNeutralToBackHand','0IdleForeHandToNeutral',
    '0IdleForeHandToBackHand','0IdleBackHandToNeutral','0IdleBackHandToForeHand',
    '3SpinoramaL','3SpinoramaR','3WindmillDekeL','3WindmillDekeR',
    '1IdleN','2GlideForward','1WalkForwardWithPuck']
P={}
for cn in CL: P[cn+'|in']=pose(cn,True); P[cn+'|out']=pose(cn,False)
anchors=['0IdleNeutral|in','0IdleForeHand|in','0IdleBackHand|in','0IdleForeHandPulledBack|in']
print("Nearest anchor (max per-bone deg) for each clip's FIRST and LAST frame:")
print("%-30s %-8s %-26s %7s"%("clip","end","nearest stance","deg"))
for cn in CL:
    for e in ('in','out'):
        best=sorted((dist(P[cn+'|'+e],P[a]),a) for a in anchors)[0]
        print("%-30s %-8s %-26s %7.2f"%(cn,e,best[1].split('|')[0],best[0]))
