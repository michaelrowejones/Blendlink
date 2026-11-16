# SPDX-License-Identifier: GPL-3.0-or-later
"""Research statistics: exact convex-hull geometry in double precision, staged F32 vertex model.
No native qualification, sampler proof, fallback, or runtime admission follows from these bounds.
"""
import hashlib, importlib.util, json, math, struct, sys
from pathlib import Path
base=Path(__file__).resolve().parent
reference=base.parent/'eevee-tangent-frame-spec/reference.py'
spec=importlib.util.spec_from_file_location('frame',reference);frame=importlib.util.module_from_spec(spec);spec.loader.exec_module(frame)
dot=lambda a,b:sum(x*y for x,y in zip(a,b))
sub=lambda a,b:tuple(x-y for x,y in zip(a,b))
length=lambda a:math.sqrt(dot(a,a))
sha=lambda b:hashlib.sha256(b).hexdigest()
def edge_distance(a,b):
    d=sub(b,a);dd=dot(d,d);t=max(0,min(1,-dot(a,d)/dd)) if dd else 0
    return length(tuple(x+t*y for x,y in zip(a,d)))
def triangle_distance(a,b,c):
    """Distance of origin to closed convex hull; edges also handle degenerate triangles."""
    ab,ac=sub(b,a),sub(c,a);u,v,w=dot(ab,ab),dot(ab,ac),dot(ac,ac);den=u*w-v*v
    best=min(edge_distance(a,b),edge_distance(b,c),edge_distance(c,a))
    if den>1e-25:
        x=(-dot(a,ab)*w+dot(a,ac)*v)/den;y=(-dot(a,ac)*u+dot(a,ab)*v)/den
        if x>=0 and y>=0 and x+y<=1:best=min(best,length(tuple(a[i]+x*ab[i]+y*ac[i] for i in range(3))))
    return best
def correlated_bound(a,b,pairs):
    # qz*a - |qx|*b is concave in RGB: positive convex filtering preserves its lower bound.
    return min(a*(2*frame.f(blue/255)-1)-b*abs(2*frame.f(red/255)-1) for red,blue in enumerate(pairs) if blue is not None)
def tests():
    assert triangle_distance((1,0,0),(-1,0,0),(0,1,0))==0
    assert abs(triangle_distance((1,0,1),(-1,0,1),(0,1,1))-1)<1e-15
    assert abs(triangle_distance((1,0,0),(1,1,0),(1,0,1))-1)<1e-15
    assert triangle_distance((2,0,0),(2,0,0),(2,0,0))==2
    pairs=[None]*256;pairs[128]=255
    assert correlated_bound(1,1,pairs)>0
    pairs[255]=128
    assert correlated_bound(1,1,pairs)<0 # negative cone must not be hidden
    return 6
if __name__=='__main__':
    images=json.loads(Path(sys.argv[1]).read_text());directory=Path(sys.argv[2]);rows=[]
    for name in ['Walls','Plane.021']:
        data_bytes=(directory/(name+'.json')).read_bytes();data=json.loads(data_bytes);attributes={}
        assert data['frame']['normalStorage']=='SNORM10'
        assert data['frame']['normalMap']['space']=='TANGENT' and data['frame']['normalMap']['convention']=='OPENGL'
        assert data['frame']['normalMap']['strength']==1 and not data['frame']['normalMap']['displacementLinked']
        def read(key,width):
            info=data['attributes'][key];b=(directory/info['file']).read_bytes();assert sha(b)==info['sha256'];attributes[key]=info['sha256']
            v=struct.unpack('<'+'f'*(len(b)//4),b);return [v[i:i+width] for i in range(0,len(v),width)]
        ns,ts=read('_STW_FRAME_N',3),read('_STW_FRAME_T',3)
        vertices=[frame.vertex(n,t,1,data['frame']['normalMatrix']) for n,t in zip(ns,ts)]
        metrics=[]
        for index,ids in enumerate(data['triangles']):
            n=[vertices[i][0] for i in ids];t=[vertices[i][1][:3] for i in ids];a=triangle_distance(*n)
            # Ti dot Ni is a quadratic Bernstein polynomial with coefficients:
            # ni dot ti, and (ni dot tj + nj dot ti)/2 for cross terms.
            coeff=[abs(dot(n[i],t[i])) for i in range(3)]
            coeff.extend(abs((dot(n[i],t[j])+dot(n[j],t[i]))/2) for i in range(3) for j in range(i))
            b=min(max(length(v) for v in t),max(coeff)/a) if a>0 else math.inf
            bounds=[correlated_bound(a,b,level['blueMinimumByRed']) for level in images['levels']]
            metrics.append({'triangle':index,'loops':ids,'minimumInterpolatedNLength':a,'maximumAbsTProjectionOnUnitN':b,'boundsByLevel':bounds})
        rows.append({'name':name,'metadataSha256':sha(data_bytes),'attributeSha256':attributes,'frame':data['frame']['normalMatrix'],
            'triangles':len(metrics),'minimumInterpolatedNLength':min(m['minimumInterpolatedNLength'] for m in metrics),
            'levels':[{'level':level['level'],'minimumProjectionBound':min(m['boundsByLevel'][i] for m in metrics),
                'nonPositiveTriangles':sum(m['boundsByLevel'][i]<=0 for m in metrics),
                'below1eMinus4Triangles':sum(m['boundsByLevel'][i]<=1e-4 for m in metrics)} for i,level in enumerate(images['levels'])],
            'worstBaseTriangles':sorted(metrics,key=lambda m:m['boundsByLevel'][0])[:8],
            'unresolvedBaseTriangleIds':[m['triangle'] for m in metrics if m['boundsByLevel'][0]<=0],
            'allTriangleMetricsSha256':sha(json.dumps(metrics,sort_keys=True).encode())})
    result={'status':'CPU_IMAGE_FRAME_CONE_STATISTICS_NOT_QUALIFICATION','supportCredit':0,'checks':tests(),
        'producerSha256':sha(Path(__file__).read_bytes()),
        'imageStatisticsSha256':sha(Path(sys.argv[1]).read_bytes()),'referenceSha256':sha(reference.read_bytes()),'rows':rows,
        'precision':'F32 staged source vertex model, double convex hull/bound math. No driver interpolation, typed-store, sampler, cross-product rounding error certificate.',
        'marginSensitivity':'below1eMinus4 is only sensitivity reporting, not a proved hardware error bound or admission threshold.'}
    Path(sys.argv[3]).write_text(json.dumps(result,indent=2)+'\n')
