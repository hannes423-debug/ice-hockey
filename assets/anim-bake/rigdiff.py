exec(open('fk.py').read())
import numpy as np, math, sys
from glb import read_glb, read_accessor
NJ,NB = read_glb('/home/sara/Työpöytä/hoki/assets/new_anim.glb')
nan=[remap(n.get('name') or '') for n in NJ['nodes']]
print("new glb nodes:", len(NJ['nodes']))
print("new anims:", [a['name'] for a in NJ['animations']])
print()
# node name set diff
pset=set(names); nset=set(nan)
print("in payload not in new:", sorted(pset-nset))
print("in new not in payload:", sorted(nset-pset))
print()
# rest pose diff (node local TRS)
print("=== REST POSE DIFF (bind local translation/rotation) ===")
nbn={n:i for i,n in enumerate(nan)}
worst=[]
for bn,i in byname.items():
    j=nbn.get(bn)
    if j is None: continue
    pt=np.array(nodes[i].get('translation',[0,0,0]),float)
    nt=np.array(NJ['nodes'][j].get('translation',[0,0,0]),float)
    pq=np.array(nodes[i].get('rotation',[0,0,0,1]),float)
    nq=np.array(NJ['nodes'][j].get('rotation',[0,0,0,1]),float)
    if np.dot(pq,nq)<0: nq=-nq
    dt=np.linalg.norm(pt-nt)
    dq=math.degrees(2*math.acos(min(1.0,abs(float(np.dot(pq,nq))))))
    worst.append((dt,dq,bn))
worst.sort(reverse=True)
for dt,dq,bn in worst[:8]:
    print(f"  {bn:16s} dtrans={dt*1000:8.4f} mm   drot={dq:8.4f} deg")
print(f"  max dtrans={max(w[0] for w in worst)*1000:.4f} mm  max drot={max(w[1] for w in worst):.4f} deg")
