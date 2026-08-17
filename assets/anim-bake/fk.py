import re,base64,json,struct,io,numpy as np
S=io.open('/home/sara/Työpöytä/hoki/game/ice_hockey.html',encoding='utf-8').read()
def glb(name):
    b=base64.b64decode(re.search(r'const '+name+r'="([^"]+)"',S).group(1))
    jl=struct.unpack('<I',b[12:16])[0]
    return json.loads(b[20:20+jl]), b, 20+jl+8
def mkacc(j,b,binoff):
    def acc(i):
        a=j['accessors'][i];bv=j['bufferViews'][a['bufferView']]
        off=binoff+bv.get('byteOffset',0)+a.get('byteOffset',0)
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        ct={5126:np.float32,5123:np.uint16,5125:np.uint32,5121:np.uint8}[a['componentType']]
        return np.frombuffer(b,dtype=ct,count=a['count']*n,offset=off).reshape(a['count'],n).astype(np.float64)
    return acc

# ---------- remapBoneNames(), verbatim from the game ----------
import re as _re
# three.js PropertyBinding.sanitizeNodeName, applied by GLTFLoader at load time:
# whitespace -> '_', reserved chars stripped.  'thumb.01.R' -> 'thumb01R'
_RES=_re.compile(r'[.\[\]:/]')
def SAN(n): return _RES.sub('', _re.sub(r'\s','_',n))
EXACT={'spine':'spine_01','spine1':'spine_02','spine2':'spine_03','neck1':'neck_01'}
SIDED={'upper_arm':'upperarm','forearm':'lowerarm','hand':'hand','thigh':'thigh','shin':'calf','foot':'foot'}
def remap(n):
    n=SAN(n)
    if n in EXACT: return EXACT[n]
    for base,out in SIDED.items():
        if n==base+'L' or n==base+'.L': return out+'_l'
        if n==base+'R' or n==base+'.R': return out+'_r'
    return n

def quat2mat(q):
    x,y,z,w=q; n=x*x+y*y+z*z+w*w
    if n<1e-12: return np.eye(3)
    s=2.0/n
    return np.array([
      [1-s*(y*y+z*z), s*(x*y-z*w),   s*(x*z+y*w)],
      [s*(x*y+z*w),   1-s*(x*x+z*z), s*(y*z-x*w)],
      [s*(x*z-y*w),   s*(y*z+x*w),   1-s*(x*x+y*y)]])
def trs(t,q,s):
    M=np.eye(4); M[:3,:3]=quat2mat(q)*np.array(s); M[:3,3]=t; return M

PJ,PB,POFF=glb('PLAYER_B64'); pacc=mkacc(PJ,PB,POFF)
AJ,AB,AOFF=glb('ANIM_B64');  aacc=mkacc(AJ,AB,AOFF)
nodes=PJ['nodes']
names=[remap(n.get('name') or '') for n in nodes]
parent={}
for i,n in enumerate(nodes):
    for c in n.get('children',[]): parent[c]=i
roots=[i for i in range(len(nodes)) if i not in parent]
byname={n:i for i,n in enumerate(names)}

def locals_bind():
    L=[]
    for n in nodes:
        L.append((np.array(n.get('translation',[0,0,0]),float),
                  np.array(n.get('rotation',[0,0,0,1]),float),
                  np.array(n.get('scale',[1,1,1]),float)))
    return L
def world(L):
    W=[None]*len(nodes)
    def rec(i,P):
        M=P@trs(*L[i]); W[i]=M
        for c in nodes[i].get('children',[]): rec(c,M)
    for r in roots: rec(r,np.eye(4))
    return W

# ---------- the game's uniform scale: 1.75 / bind-pose bbox height ----------
Wb=world(locals_bind())
lo=np.full(3,1e9); hi=np.full(3,-1e9)
for i,n in enumerate(nodes):
    if n.get('mesh') is None: continue
    for prim in PJ['meshes'][n['mesh']]['primitives']:
        a=PJ['accessors'][prim['attributes']['POSITION']]
        mn,mx=np.array(a['min'],float),np.array(a['max'],float)
        for cx in [(x,y,z) for x in (mn[0],mx[0]) for y in (mn[1],mx[1]) for z in (mn[2],mx[2])]:
            p=(Wb[i]@np.array([*cx,1.0]))[:3]; lo=np.minimum(lo,p); hi=np.maximum(hi,p)
SCALE=1.75/(hi[1]-lo[1])
print("bind bbox height %.4f -> game scale %.4f (character 1.75 m)\n"%(hi[1]-lo[1],SCALE))

# ---------- clip sampling ----------
anames=[n.get('name') for n in AJ['nodes']]
def clip(name):
    a=[x for x in AJ['animations'] if x['name']==name][0]
    ch={}
    for c in a['channels']:
        sm=a['samplers'][c['sampler']]
        ch.setdefault(anames[c['target']['node']],{})[c['target']['path']]=(aacc(sm['input'])[:,0],aacc(sm['output']))
    dur=max(t[-1] for v in ch.values() for t,_ in v.values())
    return ch,dur
def sample(ch,t):
    L=locals_bind()
    for bn,paths in ch.items():
        i=byname.get(bn)
        if i is None: continue
        tr,ro,sc=L[i]
        for path,(ts,vs) in paths.items():
            if len(ts)==1: v=vs[0]
            else:
                k=int(np.searchsorted(ts,t,'right'))-1; k=max(0,min(k,len(ts)-2))
                f=0.0 if ts[k+1]==ts[k] else (t-ts[k])/(ts[k+1]-ts[k])
                if path=='rotation':
                    q0,q1=vs[k],vs[k+1]
                    if np.dot(q0,q1)<0: q1=-q1
                    v=q0+(q1-q0)*f; v=v/np.linalg.norm(v)
                else: v=vs[k]+(vs[k+1]-vs[k])*f
        	    # (translation/scale linear)
            if path=='rotation': ro=v
            elif path=='translation': tr=v
            elif path=='scale': sc=v
        L[i]=(tr,ro,sc)
    return world(L)
