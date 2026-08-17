exec(open('bake.py').read())
import base64 as _b64
# swap in the freshly baked payload and re-derive everything from scratch
nb=_b64.b64decode(open('anim_new.b64').read())
jl=struct.unpack('<I',nb[12:16])[0]
AJ2=json.loads(nb[20:20+jl]); OFF2=20+jl+8
acc2=mkacc(AJ2,nb,OFF2)
an2=[n.get('name') for n in AJ2['nodes']]
def clip2(name):
    a=[x for x in AJ2['animations'] if x['name']==name][0]
    ch={}
    for c in a['channels']:
        sm=a['samplers'][c['sampler']]
        ch.setdefault(an2[c['target']['node']],{})[c['target']['path']]=(acc2(sm['input'])[:,0],acc2(sm['output']))
    return ch,max(t[-1] for v in ch.values() for t,_ in v.values())
CL=['IdleN','Shooting','Acceleration','GlideForward','SlapShot','Stop','StopHockey','TurnPunchL','TurnPunchR','TurnTightL','TurnTightR']
print("BAKED payload — do both hands now sit on one shaft?")
print("%-22s %13s %11s %10s %9s"%("clip","L off shaft","hand sep","tip y","tip fwd"))
Wb=world(locals_bind())
FWD2=(Wb[byname['toeR']][:3,3]-Wb[byname['heel02R']][:3,3]); FWD2[1]=0; FWD2/=np.linalg.norm(FWD2)
worst=0
for cn in CL:
    ch,dur=clip2(cn); D=[];S=[];TY=[];TF=[]
    for t in np.linspace(0,dur,25):
        W=sample(ch,t)
        HR=W[byname['hand_r']]; HL=W[byname['hand_l']]
        gR=(HR@np.append(GRIP_CTR_R,1.0))[:3]; gL=(HL@np.append(GRIP_CTR_L,1.0))[:3]
        d=gL-gR; sep=np.linalg.norm(d); d/=sep
        # the shaft is the line through both grips; check the L grip really is on it
        # (trivially true) -> instead check the hands' own tunnel AXES agree with it
        axR=HR[:3,:3]@GRIP_AX_R; axR/=np.linalg.norm(axR)
        D.append(np.degrees(np.arccos(np.clip(abs(np.dot(axR,d)),0,1))))
        S.append(sep*SCALE)
        tip=gR+d*(G2T); TY.append(tip[1]*SCALE)
        TF.append(np.dot(tip-W[byname['root']][:3,3],FWD2)*SCALE)
    worst=max(worst,np.max(D))
    print("%-22s %10.3f deg %9.3f m %8.3f m %7.2f m"%(cn,np.mean(D),np.mean(S),np.mean(TY),np.mean(TF)))
print("\n'L off shaft' = angle between the RIGHT hand's own grip-tunnel axis and the")
print("line joining the two grip points. 0 deg means one straight shaft through both")
print("fists. worst frame across all clips: %.4f deg"%worst)
