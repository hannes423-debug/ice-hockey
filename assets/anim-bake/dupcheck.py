exec(open('fk.py').read())
import numpy as np, math, itertools
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
def diff(a,b):
    A,B=tracks(a),tracks(b); mx=0; who=''
    for bn in set(A)|set(B):
        for p in ('rotation','translation'):
            ra=A.get(bn,{}).get(p); rb=B.get(bn,{}).get(p)
            if (ra is None)!=(rb is None): return 999,bn+':'+p+' missing'
            if ra is None: continue
            va,vb=ra[1],rb[1]
            if len(va)!=len(vb):
                # one collapsed to a single constant key
                n=1 if min(len(va),len(vb))==1 else 0
                if n:
                    d=float(np.abs(va[:1]-vb[:1]).max())
                    if d>mx: mx=d; who=bn+':'+p+'(len %d/%d)'%(len(va),len(vb))
                    continue
                return 999,bn+':'+p+' len %d/%d'%(len(va),len(vb))
            d=float(np.abs(va-vb).max())
            if d>mx: mx=d; who=bn+':'+p
    return mx,who
PAIRS=[('0IdleNeutral','1IdleN'),('0IdleForeHand','1IdleL'),('0IdleBackHand','1IdleR'),
       ('0IdleForeHandPulledBack','1IdleL'),('0Idle','0IdleNeutral'),
       ('0IdleNeutralToForeHand','0IdleForeHandToNeutral'),
       ('0IdleNeutralToBackHand','0IdleBackHandToNeutral'),
       ('0IdleForeHandToBackHand','0IdleBackHandToForeHand')]
for a,b in PAIRS:
    m,w=diff(a,b)
    tag='IDENTICAL' if m<1e-5 else ('near-dup' if m<1e-2 else 'DIFFERENT')
    print("%-30s vs %-26s maxabs=%9.6f  %-10s @ %s"%(a,b,m,tag,w))
