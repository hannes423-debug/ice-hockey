exec(open('fk.py').read())
import numpy as np, math

def mat2quat(M):
    # STRIP SCALE FIRST. The PLAYER_B64 armature root ('metarig') carries a
    # uniform 0.90137 scale that every bone inherits, so world matrices are
    # scaled, and the trace formula below is only valid for an orthonormal
    # basis. Feeding it a scaled matrix returns a quaternion a couple of
    # degrees off -- measured as a constant 16 mm of hand-off-shaft error.
    m=M[:3,:3].astype(float).copy()
    for c in range(3):
        n=np.linalg.norm(m[:,c])
        if n>1e-12: m[:,c]/=n
    tr=m[0,0]+m[1,1]+m[2,2]
    if tr>0:
        s=math.sqrt(tr+1.0)*2; w=0.25*s
        x=(m[2,1]-m[1,2])/s; y=(m[0,2]-m[2,0])/s; z=(m[1,0]-m[0,1])/s
    elif m[0,0]>m[1,1] and m[0,0]>m[2,2]:
        s=math.sqrt(1.0+m[0,0]-m[1,1]-m[2,2])*2
        w=(m[2,1]-m[1,2])/s; x=0.25*s; y=(m[0,1]+m[1,0])/s; z=(m[0,2]+m[2,0])/s
    elif m[1,1]>m[2,2]:
        s=math.sqrt(1.0+m[1,1]-m[0,0]-m[2,2])*2
        w=(m[0,2]-m[2,0])/s; x=(m[0,1]+m[1,0])/s; y=0.25*s; z=(m[1,2]+m[2,1])/s
    else:
        s=math.sqrt(1.0+m[2,2]-m[0,0]-m[1,1])*2
        w=(m[1,0]-m[0,1])/s; x=(m[0,2]+m[2,0])/s; y=(m[1,2]+m[2,1])/s; z=0.25*s
    q=np.array([x,y,z,w]); return q/np.linalg.norm(q)
def qmul(a,b):
    ax,ay,az,aw=a; bx,by,bz,bw=b
    return np.array([aw*bx+ax*bw+ay*bz-az*by, aw*by-ax*bz+ay*bw+az*bx,
                     aw*bz+ax*by-ay*bx+az*bw, aw*bw-ax*bx-ay*by-az*bz])
def qinv(q): return np.array([-q[0],-q[1],-q[2],q[3]])
def frame_from(Zw,Yw):
    Z=Zw/np.linalg.norm(Zw)
    Y=Yw-Z*np.dot(Yw,Z)
    if np.linalg.norm(Y)<1e-6:
        Y=np.array([0,1.,0])-Z*np.dot(np.array([0,1.,0]),Z)
    Y/=np.linalg.norm(Y); X=np.cross(Y,Z)
    M=np.eye(4); M[:3,0]=X; M[:3,1]=Y; M[:3,2]=Z; return M

# ---- constants, in MODEL units (game metres / SCALE) ----
G=lambda v: v/SCALE
STICK=G(1.45); SNAP=G(0.06); G2T=STICK-SNAP; ICE=G(0.02)
SP_MIN,SP_MAX=G(0.26),G(0.44)
AX_R=np.load('gripaxis.npy')
GRIP_AX_R,GRIP_CTR_R,GRIP_AX_L,GRIP_CTR_L=AX_R[0],AX_R[1],AX_R[2],AX_R[3]

Wb=world(locals_bind())
FWD=(Wb[byname['toeR']][:3,3]-Wb[byname['heel02R']][:3,3]); FWD[1]=0; FWD/=np.linalg.norm(FWD)
LEFT=(Wb[byname['upperarm_l']][:3,3]-Wb[byname['upperarm_r']][:3,3]); LEFT[1]=0; LEFT/=np.linalg.norm(LEFT)
UP=np.array([0.,1.,0.])
def seglen(a,b): return np.linalg.norm(Wb[byname[b]][:3,3]-Wb[byname[a]][:3,3])
LU={s:seglen('upperarm_'+s,'lowerarm_'+s) for s in 'rl'}
LF={s:seglen('lowerarm_'+s,'hand_'+s)     for s in 'rl'}
REACH={s:(LU[s]+LF[s])*0.985 for s in 'rl'}
# ...and a FLOOR, which is just as real a limit as the ceiling. A two-bone arm
# cannot fold the wrist closer to the shoulder than |lu-lf|; ik_arm clamps at
# exactly that, and a clamped triangle no longer has |wrist-elbow| == lf, so the
# forearm overshoots and the fist leaves the shaft. Measured on StopHockey: the
# solver parked the right wrist 17.3 mm from the shoulder against a 31.2 mm
# fold limit, and the 16.4 mm forearm residual WAS the off-shaft error.
# 1.2x that limit keeps the IK exact with margin, and still sits below the
# closest approach on any frame that was already solving clean (55.8 mm).
# The pure fold limit is NOT a tight enough floor. `ik_arm` divides by that
# distance to get the shoulder->wrist axis, so as the wrist approaches the
# shoulder the axis becomes ill-conditioned and a sub-millimetre wrist move
# swings the whole arm: measured on StopHockey with the wrist pinned at 10% of
# full reach, the shaft perfectly smooth (0.025 m/frame, psi < 1.7 deg) and the
# right arm still flipping 66-80 deg in one 4 ms key. A quarter of all frames
# want to sit here, because the objective pulls the top grip toward an authored
# hand that is in the REST pose (arms at the sides) and carries no information.
# 0.28 of full reach is a normal folded elbow and is numerically stable.
MINREACH={s:max((abs(LU[s]-LF[s])+1e-4)*1.2,(LU[s]+LF[s])*0.28) for s in 'rl'}

def nearest_on_sphere_in_ball(aim,ctr,rad,bc,br):
    """closest point to `aim` on sphere(ctr,rad) that also lies inside ball(bc,br).
       Sphere n ball is a circle; the feasible set is a spherical cap. Projecting
       onto the sphere and THEN clamping into the ball breaks the sphere
       constraint (that is the shaft length), so solve the cap directly."""
    v=aim-ctr; n=np.linalg.norm(v)
    P=ctr+(v/n if n>1e-9 else np.array([0,1.,0]))*rad
    if np.linalg.norm(P-bc)<=br: return P
    u=bc-ctr; D=np.linalg.norm(u)
    if D<1e-9 or D>rad+br or D<abs(rad-br): return None      # no intersection
    u=u/D
    a=(D*D+rad*rad-br*br)/(2*D)
    h2=rad*rad-a*a
    if h2<=0: return None
    C=ctr+u*a; r=math.sqrt(h2)
    w=aim-C; w=w-u*np.dot(w,u)
    if np.linalg.norm(w)<1e-9:
        w=np.cross(u,np.array([0,1.,0]))
        if np.linalg.norm(w)<1e-9: w=np.cross(u,np.array([1.,0,0]))
    w/=np.linalg.norm(w)
    return C+w*r

def solve_grip(pelvis,sR,sL,aR,aL):
    """pick the shaft: blade on the ice ahead, both grips reachable, hands as
       close to their authored positions as the constraints allow."""
    best=None
    for tf in np.arange(G(0.72),G(1.06),G(0.03)):
        for tl in np.arange(G(-0.12),G(0.42),G(0.04)):
            tip=pelvis+FWD*tf+LEFT*tl; tip[1]=ICE
            T=nearest_on_sphere_in_ball(aR,tip,G2T,sR,REACH['r'])
            if T is None: continue
            v=tip-T; L=np.linalg.norm(v)
            if L<1e-6: continue
            d=v/L
            sp=float(np.clip(np.dot(aL-T,d),SP_MIN,SP_MAX))
            Lg=T+d*sp
            if np.linalg.norm(Lg-sL)>REACH['l']:
                b=np.dot(sL-T,d); h2=max(0.0,np.dot(sL-T,sL-T)-b*b)
                disc=REACH['l']**2-h2
                if disc<0: continue
                r=math.sqrt(disc)
                lo,hi=max(SP_MIN,b-r),min(SP_MAX,b+r)
                if lo>hi: continue
                sp=float(np.clip(np.dot(aL-T,d),lo,hi)); Lg=T+d*sp
            cost=(np.dot(T-aR,T-aR)*1.0+np.dot(Lg-aL,Lg-aL)*0.55)
            if best is None or cost<best[0]: best=(cost,T.copy(),d.copy(),sp,tip.copy())
    return best

POLE_MIN,POLE_HI=0.35,0.60
POLE_SLEW_DPS=360.0     # how fast the elbow may orbit, degrees per second
def ik_arm(side,shoulder,wrist,elbow_hint,Wcur,parentq_upper,state=None,slew=None):
    """analytic 2-bone IK; elbow_hint keeps the animator's elbow orientation.

       POLE DEGENERACY (fixed 2026-08-04). The elbow's orbit is decided by the
       component of (elbow_hint-shoulder) PERPENDICULAR to the shoulder->wrist
       axis. When the authored elbow passes near that axis the perpendicular
       cancels and the direction is left to numerical leftovers: measured on
       StopHockey/SlapShot, sin(angle) fell to 0.37 and the pole swung 65-78
       degrees in ONE frame, snapping the elbow to the other side. Both hands
       stay ON the shaft at every solved key (the grip is constructed there), so
       this never showed up in the per-key error — it only appeared when the
       payload was sampled BETWEEN keys, as a 26-39 degree spike a few ms wide.
       Same failure the in-game IK already guards with _ikPoleMin; same fix:
       carry the last well-conditioned perpendicular, re-orthogonalise it
       against the current axis, blend it in across the marginal band, and never
       let the elbow change sides. `state` is per clip per side."""
    lu,lf=LU[side],LF[side]
    to=wrist-shoulder; dist=np.linalg.norm(to)
    dist=min(max(dist,abs(lu-lf)+1e-4),lu+lf-1e-4)
    a=to/np.linalg.norm(to)
    p=(dist*dist+lu*lu-lf*lf)/(2*dist); h=math.sqrt(max(0.0,lu*lu-p*p))
    # conditioning as sin(angle between the hint and the axis) — scale-free, so
    # the threshold means the same thing on any rig
    hint=elbow_hint-shoulder; hn=np.linalg.norm(hint)
    u=hint/hn if hn>1e-12 else -UP
    pole=u-a*np.dot(u,a); s=np.linalg.norm(pole)
    prev=(state or {}).get('pole')
    if prev is not None:
        pv=prev-a*np.dot(prev,a); pn=np.linalg.norm(pv)
        if pn>1e-6:
            pv/=pn
            if s<1e-6 or np.dot(pole/max(s,1e-12),pv)<0:
                want=pv                          # crossed sides / dead: hold
            else:
                w=min(1.0,max(0.0,(s-POLE_MIN)/(POLE_HI-POLE_MIN)))
                want=(pole/s)*w+pv*(1.0-w)
            wn=np.linalg.norm(want)
            want=want/wn if wn>1e-9 else pv
            # SLEW LIMIT. Conditioning alone is not enough: the authored hint can
            # sit 90+ deg off the held pole while staying perfectly well
            # conditioned, and then the blend above snaps to it the moment it
            # crosses the hold test — measured as a 150 deg upper-arm jump in ONE
            # 8 ms key on StopHockey, with the hand's world orientation smooth to
            # 0.14 deg. Capping the orbit rate makes a snap impossible while
            # still tracking any real elbow motion. The pole only chooses which
            # way the elbow points; the grip stays exact either way, so lagging
            # it costs nothing physical.
            if slew:
                c=float(np.clip(np.dot(pv,want),-1.0,1.0))
                ang=math.acos(c)
                if ang>slew:
                    perp=want-pv*c; pn2=np.linalg.norm(perp)
                    if pn2>1e-9:
                        want=pv*math.cos(slew)+(perp/pn2)*math.sin(slew)
            pole=want; s=np.linalg.norm(pole)
    if s<1e-6:
        pole=-UP-a*np.dot(-UP,a); s=np.linalg.norm(pole)
    pole/=s
    if state is not None: state['pole']=pole.copy()
    elbow=shoulder+a*p+pole*h
    # upper arm: rest direction (bind local +child) -> desired
    ub=byname['upperarm_'+side]; fb=byname['lowerarm_'+side]; hb=byname['hand_'+side]
    restU=np.array(nodes[fb].get('translation',[0,0,0]),float); restU/=np.linalg.norm(restU)
    restF=np.array(nodes[hb].get('translation',[0,0,0]),float); restF/=np.linalg.norm(restF)
    pq=mat2quat(parentq_upper)
    def aim(rest,desW,pqm):
        des=(np.linalg.inv(pqm[:3,:3])@desW); des/=np.linalg.norm(des)
        v=np.cross(rest,des); c=np.dot(rest,des)
        if c<-0.999999:
            axis=np.cross(rest,np.array([1.,0,0]))
            if np.linalg.norm(axis)<1e-6: axis=np.cross(rest,np.array([0,1.,0]))
            axis/=np.linalg.norm(axis); return np.array([axis[0],axis[1],axis[2],0.0])
        q=np.array([v[0],v[1],v[2],1.0+c]); return q/np.linalg.norm(q)
    qU=aim(restU,(elbow-shoulder)/np.linalg.norm(elbow-shoulder),parentq_upper)
    return qU,elbow,restF
print("baker helpers ready: reach R %.3f L %.3f (model units), stick %.3f"%(REACH['r'],REACH['l'],STICK))

# the whole bone chain inherits the metarig node's uniform scale, so a
# hand-LOCAL offset becomes scale*R*offset in world. Derive it, never assume 1.
ARMSCALE=LU['r']/np.linalg.norm(np.array(nodes[byname['lowerarm_r']].get('translation',[0,0,0]),float))
AWAY_MIN,AWAY_HI=0.35,0.60
def hand_frame_and_wrist(grip,sh,d,ctr,gax,ref=None):
    """Orient the hand so its MEASURED grip-tunnel axis (gax, from where the
       animator's curled fingers actually wrap - about 4 deg off pure -Z) lies
       along the shaft, and its +Y (wrist -> fingers) points from the shoulder
       side toward the shaft, which puts the WRIST between shoulder and shaft.
       Getting that sign backwards pushes the wrist 2*|ctr| further out and the
       IK clamps (measured: 32-72 mm of hand-off-shaft error)."""
    """ROLL CONTINUITY (state, added 2026-08-04): `away` fixes the hand's roll
       ABOUT the shaft, and rolling the fist around the shaft leaves the grip
       perfectly valid — so a roll flip costs nothing at a key and is invisible
       to the per-key error. Between keys it is a disaster: measured on
       SlapShot, adjacent 8.3 ms keys 168.6 deg apart in roll while the shoulder
       moved 7.9 deg, i.e. the grip point crossed the shoulder-shaft plane and
       `away` changed sign. Interpolating through that swings the hand off the
       stick. Carry the previous direction and never flip, same as ik_arm.

       `ref` is the PREVIOUS FRAME's away, and is read-only: the roll it implies
       moves the wrist by up to 2*|ctr|, so bake3's reach constraint and bake4's
       final pass MUST assume the same one or the solve is checked against a
       wrist the bake never builds (measured: 19 unreachable frames, 66 mm).
       Returns the away it settled on so the caller can carry it forward."""
    raw=grip-sh; rn=np.linalg.norm(raw)
    away=raw-d*np.dot(raw,d)
    s=np.linalg.norm(away)/max(rn,1e-12)          # sin(angle off the shaft)
    if ref is not None:
        pv=ref-d*np.dot(ref,d); pn=np.linalg.norm(pv)
        if pn>1e-6:
            pv/=pn
            if s<1e-6 or np.dot(away/max(np.linalg.norm(away),1e-12),pv)<0:
                away=pv
            else:
                w=min(1.0,max(0.0,(s-AWAY_MIN)/(AWAY_HI-AWAY_MIN)))
                away=(away/np.linalg.norm(away))*w+pv*(1.0-w)
    if np.linalg.norm(away)<1e-6: away=UP-d*np.dot(UP,d)
    away=away/np.linalg.norm(away)
    Lf=frame_from(-gax/np.linalg.norm(gax),np.array([0.,1.,0.]))[:3,:3]
    Wf=frame_from(-d,away)[:3,:3]
    M=np.eye(4); M[:3,:3]=Wf@Lf.T
    qHw=mat2quat(M)
    return qHw,grip-quat2mat(qHw)@(ctr*ARMSCALE),away
