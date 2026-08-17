exec(open('fk.py').read())
import numpy as np, math
from glb import read_glb, read_accessor
def load(p):
    J,B=read_glb(p); nm=[remap(n.get('name') or '') for n in J['nodes']]
    return J,B,nm
OJ,OB,ON=load('/home/sara/Työpöytä/hoki/assets/old_anim.glb')
NJ,NB,NN=load('/home/sara/Työpöytä/hoki/assets/new_anim.glb')
print("=== REST POSE: old blend vs new blend ===")
oi={n:i for i,n in enumerate(ON)}; ni={n:i for i,n in enumerate(NN)}
worst=[]
for bn in oi:
    if bn not in ni: continue
    a,b=OJ['nodes'][oi[bn]], NJ['nodes'][ni[bn]]
    pt=np.array(a.get('translation',[0,0,0]),float); nt=np.array(b.get('translation',[0,0,0]),float)
    pq=np.array(a.get('rotation',[0,0,0,1]),float);  nq=np.array(b.get('rotation',[0,0,0,1]),float)
    if np.dot(pq,nq)<0: nq=-nq
    worst.append((np.linalg.norm(pt-nt), math.degrees(2*math.acos(min(1.0,abs(float(np.dot(pq,nq)))))), bn))
worst.sort(reverse=True)
for dt,dq,bn in worst[:6]: print(f"  {bn:16s} dtrans={dt*1000:8.4f} mm  drot={dq:8.4f} deg")
print()
def clipch(J,B,NMS,name):
    a=[x for x in J['animations'] if x['name']==name][0]
    ch={}
    for c in a['channels']:
        sm=a['samplers'][c['sampler']]
        ti=np.array(read_accessor(J,B,sm['input']),float)[:,0]
        vo=np.array(read_accessor(J,B,sm['output']),float)
        ch.setdefault(NMS[c['target']['node']],{})[c['target']['path']]=(ti,vo)
    return ch, max(t[-1] for v in ch.values() for t,_ in v.values())
print("=== SHARED CLIPS: old vs new export, per-bone max rotation delta (deg) ===")
for cn in [a['name'] for a in OJ['animations']]:
    if not any(x['name']==cn for x in NJ['animations']): print(f"  {cn}: MISSING in new"); continue
    co,do=clipch(OJ,OB,ON,cn); cnn,dn=clipch(NJ,NB,NN,cn)
    mx=0; who=''
    keys=set(co)|set(cnn)
    for bn in keys:
        ro=co.get(bn,{}).get('rotation'); rn=cnn.get(bn,{}).get('rotation')
        if ro is None or rn is None: mx=999; who=bn+'(missing)'; continue
        n=min(len(ro[1]),len(rn[1]))
        for k in range(n):
            q0,q1=ro[1][k],rn[1][k]
            if np.dot(q0,q1)<0: q1=-q1
            d=math.degrees(2*math.acos(min(1.0,abs(float(np.dot(q0,q1))))))
            if d>mx: mx=d; who=bn
        if len(ro[1])!=len(rn[1]): who+=f' LEN{len(ro[1])}/{len(rn[1])}'
    print(f"  {cn:24s} dur {do:.3f}/{dn:.3f}  maxdrot={mx:8.3f} deg @ {who}")
