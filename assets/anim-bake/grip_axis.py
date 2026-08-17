exec(open('fk.py').read())
# A gripped shaft runs ACROSS the palm, parallel to the knuckle line, through the
# tunnel the curled fingers make. Measure that tunnel in HAND-LOCAL space.
ch,dur=clip('IdleN'); W=sample(ch,0.0)
out={}
for side,hb in (('R','hand_r'),('L','hand_l')):
    H=W[byname[hb]]; Hi=np.linalg.inv(H)
    def loc(n):
        p=(Hi@np.append(W[byname[n]][:3,3],1.0))[:3]
        return p
    prox=[loc('f_%s01%s'%(g,side)) for g in ('index','middle','ring','pinky')]
    mid =[loc('f_%s02%s'%(g,side)) for g in ('index','middle','ring','pinky')]
    tip =[loc('f_%s03%s'%(g,side)) for g in ('index','middle','ring','pinky')]
    th  = loc('thumb02%s'%side)
    ax=np.array(prox[3])-np.array(prox[0]); ax/=np.linalg.norm(ax)   # index MCP -> pinky MCP
    # tunnel centre: midway between the proximal row and the fingertip row,
    # i.e. the axis the curled fingers wrap around
    centre=(np.mean(prox,0)+np.mean(tip,0))/2.0
    # radius check: how far the finger bones sit from that axis
    rad=[np.linalg.norm(np.cross(np.array(p)-centre,ax)) for p in prox+mid+tip]
    out[side]=(ax,centre,np.mean(rad))
    print("hand_%s  grip axis (hand-local) %s"%(side.lower(),np.round(ax,3)))
    print("        tunnel centre (hand-local, m) %s   thumb at %s"%(np.round(centre,3),np.round(th,3)))
    print("        finger bones sit %.3f m from that axis (a stick shaft is ~0.015-0.025 m)"%np.mean(rad))
    d=np.abs(ax); nm=['X','Y','Z'][int(np.argmax(d))]
    print("        -> dominant local axis: %s%s (%.0f%% aligned)\n"%('+' if ax[np.argmax(d)]>0 else '-',nm,100*d.max()/np.linalg.norm(ax)))
np.save('gripaxis.npy',np.array([out['R'][0],out['R'][1],out['L'][0],out['L'][1]]))
