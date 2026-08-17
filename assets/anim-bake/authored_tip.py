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
CL=['1IdleN','2GlideForward','2SlapShot',
    '0IdleNeutral','0IdleForeHand','0IdleBackHand','0IdleForeHandPulledBack',
    '0IdleNeutralToForeHand','0IdleForeHandToBackHand','0IdleBackHandToNeutral',
    '3SpinoramaL','3SpinoramaR','3WindmillDekeL','3WindmillDekeR']
print("Authored-hand shaft: u = normalize(gripL - gripR); tip = gripR + u*G2T")
print("all in GAME metres, relative to root (fwd/lat), y absolute. ice = 0.020")
print()
print("%-26s %14s %14s %14s %7s"%("clip","tip fwd","tip lat","tip y","sep"))
for cn in CL:
    ch,dur=nclip(cn); F=[];L_=[];Y=[];S=[]
    for t in np.linspace(0,dur,33):
        W=sample(ch,t)
        pel=W[byname['root']][:3,3]
        HR=W[byname['hand_r']]; HL=W[byname['hand_l']]
        gR=(HR@np.append(GRIP_CTR_R,1.0))[:3]; gL=(HL@np.append(GRIP_CTR_L,1.0))[:3]
        v=gL-gR; s=np.linalg.norm(v); u=v/s
        tip=gR+u*G2T; rel=tip-pel
        F.append(np.dot(rel,FWD)*SCALE); L_.append(np.dot(rel,LEFT)*SCALE)
        Y.append(tip[1]*SCALE); S.append(s*SCALE)
    f=lambda a:"%6.2f..%-6.2f"%(min(a),max(a))
    print("%-26s %14s %14s %14s %7.2f"%(cn,f(F),f(L_),f(Y),np.mean(S)))
