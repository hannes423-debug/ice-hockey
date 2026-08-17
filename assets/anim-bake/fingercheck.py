exec(open('bake.py').read())
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
FING=[]
for side in 'RL':
    for g in ('index','middle','ring','pinky'):
        for j in ('01','02','03'):
            FING.append(('f_%s%s%s'%(g,j,side), side))
def measure(ch,dur,label):
    R=[]
    ts=np.linspace(0,dur,25) if dur>0 else np.array([0.0])
    for t in ts:
        W=sample(ch,t)
        gR=(W[byname['hand_r']]@np.append(GRIP_CTR_R,1.0))[:3]
        gL=(W[byname['hand_l']]@np.append(GRIP_CTR_L,1.0))[:3]
        u=gL-gR; u/=np.linalg.norm(u)
        for bn,side in FING:
            i=byname.get(bn)
            if i is None: continue
            p=W[i][:3,3]-gR
            R.append(np.linalg.norm(np.cross(p,u))*SCALE)
    R=np.array(R)
    print("%-34s finger-to-shaft  mean %6.3f m  p90 %6.3f  max %6.3f   (a real grip: ~0.02)"%(label,R.mean(),np.percentile(R,90),R.max()))
print("SHIPPED payload:")
for cn in ['IdleN','IdleL','IdleR','GlideForward','SlapShot']:
    ch,dur=clip(cn); measure(ch,dur,cn)
print("\nRAW new export (never baked):")
for cn in ['1IdleN','1IdleL','1IdleR','2GlideForward','2SlapShot']:
    ch,dur=nclip(cn); measure(ch,dur,cn)
