# SPDX-License-Identifier: GPL-3.0-or-later
"""Research-only mathematical CPU oracle. No Blender shader implementation copied.
Staged Float32 algebra is diagnostic, not a GPU floating-point parity claim.
"""
import math,struct,json
f=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
def add(a,b):return tuple(f(x+y)for x,y in zip(a,b))
def mul(a,s):return tuple(f(x*s)for x in a)
def dot(a,b):
 p=[f(x*y)for x,y in zip(a,b)];return f(f(p[0]+p[1])+p[2])
def cross(a,b):return tuple(f(f(a[i]*b[j])-f(a[j]*b[i]))for i,j in [(1,2),(2,0),(0,1)])
def normalized(v,safe=False):
 d=dot(v,v)
 if safe and not d>f(1e-35):return(1.,0.,0.)
 if not d>0 or not math.isfinite(d):return None # Ordinary normalize is not given an invented fallback.
 return mul(v,f(1/math.sqrt(d)))
def transform(m,v):return tuple(dot(row,v)for row in m)
def packed(v,bits=10):
 scale=511 if bits==10 else 32767
 return tuple(f(max(-1,min(1,math.trunc(f(x*scale))/scale)))for x in v)
def vertex(normal,tangent,sign,normal_matrix):
 return(normalized(transform(normal_matrix,packed(normal))),(*normalized(transform(normal_matrix,packed(tangent)),True),float(sign)))
def interpolate(values,screen_bary,clip_w):
 weights=[b/w for b,w in zip(screen_bary,clip_w)];total=sum(weights);weights=[w/total for w in weights]
 result=(0.,)*len(values[0])
 for value,weight in zip(values,weights):result=add(result,mul(value,f(weight)))
 return result

def resolve(base_n,tangent4,rgb,strength=1.,front=True,negative_scale=False,directx=False):
 # Inputs are fragment varying values; caller supplies front-flipped base N.
 if tangent4==(0.,0.,0.,1.):return{'normal':base_n,'sentinel':True,'undefined':False}
 tangent4=mul(tangent4,1 if front else -1);t=tangent4[:3]
 b=mul(cross(base_n,t),tangent4[3]*(-1 if negative_scale else 1))
 q=tuple(f(f(2*x)-1)for x in rgb)
 if directx:q=(q[0],-q[1],q[2])
 a=max(0.,min(1.,strength));q=(f(q[0]*strength),f(q[1]*strength),f(f(1-a)+f(q[2]*a)))
 combined=add(add(mul(t,q[0]),mul(b,q[1])),mul(base_n,q[2]))
 n=normalized(combined)
 return{'normal':n,'sentinel':False,'undefined':n is None,'combined':combined,'B':b}

def tests():
 checks=0
 def check(condition):
  nonlocal checks;assert condition;checks+=1
 def close(a,b,tol=1e-6):return a is not None and max(abs(x-y)for x,y in zip(a,b))<tol
 identity=((1.,0.,0.),(0.,1.,0.),(0.,0.,1.))
 n,t=vertex((0.,0.,1.),(1.,0.,0.),1,identity)
 check(resolve(n,t,(.5,.5,1.))['normal']==(0.,0.,1.))
 check(close(resolve(n,t,(.8,.7,.9))['normal'],normalized((.6,.4,.8))))
 front=resolve(n,t,(.8,.7,.9))['normal'];back=resolve(mul(n,-1),t,(.8,.7,.9),front=False)['normal']
 check(close(back,mul(front,-1)))
 check(close(resolve(n,t,(.8,.7,.9),negative_scale=True)['normal'],resolve(n,t,(.8,.7,.9),directx=True)['normal']))
 check(resolve(n,t,(.8,.7,.9),strength=0)['normal']==n)
 check(normalized((0.,1e-18,0.),True)==(1.,0.,0.))
 check(normalized((0.,0.,0.),True)==(1.,0.,0.))
 check(normalized((math.nan,0.,0.),True)==(1.,0.,0.))
 check(close(normalized((0.,1e-17,0.),True),(0.,1.,0.)))
 # Inverse-transpose tangent transform differs from ordinary vector transform.
 _,actual=vertex((0.,0.,1.),(math.sqrt(.5),math.sqrt(.5),0.),1,((.5,0.,0.),(0.,1.,0.),(0.,0.,1.)))
 check(close(actual[:3],normalized((.5,1.,0.))))
 check(max(abs(x-y)for x,y in zip(actual[:3],normalized((2.,1.,0.))))>.4)
 # Perspective-correct interpolation is performed before fragment node use.
 values=[(0.,0.,1.),(0.,.8,.6),(0.,0.,1.)]
 raw=interpolate(values,(.25,.5,.25),(1.,1.,1.))
 source=resolve(raw,t,(.8,.7,.9))['normal'];wrong=resolve(normalized(raw),t,(.8,.7,.9))['normal']
 check(max(abs(x-y)for x,y in zip(source,wrong))>.01)
 raw_t=interpolate([(1.,0.,0.,1.),(.6,.8,0.,1.),(1.,0.,0.,1.)],(.25,.5,.25),(1.,1.,1.))
 source_t=resolve(n,raw_t,(.8,.7,.9))['normal'];wrong_t=resolve(n,(*normalized(raw_t[:3]),1.),(.8,.7,.9))['normal']
 check(max(abs(x-y)for x,y in zip(source_t,wrong_t))>.01)
 varying=interpolate(values,(.25,.5,.25),(1.,2.,4.));linear=interpolate(values,(.25,.5,.25),(1.,1.,1.))
 check(varying!=linear)
 # Exact fragment sentinel bypasses final normalization, unlike a real zero-UV Mikk fallback.
 sentinel=resolve(raw,(0.,0.,0.,1.),(.8,.7,.9),strength=0)
 check(sentinel['sentinel'] and sentinel['normal']==raw and abs(dot(raw,raw)-1)>.1)
 parallel=resolve((1.,0.,0.),(1.,0.,0.,-1.),(.5,1.,.5))
 check(not parallel['sentinel'] and parallel['undefined'] and parallel['B']==(0.,0.,0.))
 check(resolve((1.,0.,0.),(1.,0.,0.,-1.),(.5,.5,1.))['normal']==(1.,0.,0.))
 check(resolve((1.,0.,0.),(1.,0.,0.,-1.),(1.,.5,0.))['undefined'])
 check(resolve(n,(1.,0.,0.,0.),(.5,1.,.5))['undefined'])
 # Packing truncates after Float32 multiplication; no rounding or Gram-Schmidt step.
 check(packed((.5,-.5,1.))==(f(255/511),f(-255/511),1.))
 check(packed((.5,-.5,1.),16)==(f(16383/32767),f(-16383/32767),1.))
 return{'checks':checks,'status':'CPU_MATH_BOUNDARIES_PASSED','ordinaryZeroNormalize':'UNQUALIFIED_NOT_REPLACED','gpuQualification':False,'supportCredit':0,'rawNormalControl':{'interpolated':raw,'source':source,'incorrectFragmentRenormalization':wrong},'rawTangentControl':{'interpolated':raw_t,'source':source_t,'incorrectFragmentRenormalization':wrong_t}}
if __name__=='__main__':print(json.dumps(tests(),indent=2))
