# SPDX-License-Identifier: GPL-3.0-or-later
"""Research hypotheses, not a production implementation or a native oracle.

The source-staging hypothesis follows the pinned BLI noise.cc expressions,
including their unsuffixed double constants. The shader hypothesis follows
our existing staged F32 MF kernel. Compiler contraction is NOT assumed away;
actual native counterexamples and all word/class differences are retained.
"""
import math,struct,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'compositor-white-noise'))
from hash_reference import hash_words,f32,word
F=f32

def offset(seed):
    return [F(100+F(F(F(hash_words([word(seed),word(lane)]))/F(0xffffffff))*100))for lane in [0,1]]

def fade(t,model):
    cube=F(F(t*t)*t)
    if model=='source-unsuffixed-double-staging':return F(cube*(t*(t*6.0-15.0)+10.0))
    return F(cube*F(F(t*F(F(t*6)-15))+10))

def signed_noise(p,model):
    # Every default/Color octave stays well below the periodic correction
    # threshold. fmod preserves the negative-coordinate sign, as BLI mod does.
    p=[F(math.fmod(v,100000.0))for v in p]
    ix,iy=[math.floor(v)for v in p];x,y=[F(v-i)for v,i in zip(p,[ix,iy])]
    u,v=fade(x,model),fade(y,model);xm=F(1-u)
    def grad(i,j):
        h=hash_words([(ix+i)&0xffffffff,(iy+j)&0xffffffff])&7
        a,b=(F(x-i),F(y-j))if h<4 else(F(y-j),F(x-i));b=F(2*b)
        return F((-a if h&1 else a)+(-b if h&2 else b))
    row0=F(F(grad(0,0)*xm)+F(grad(1,0)*u));row1=F(F(grad(0,1)*xm)+F(grad(1,1)*u))
    if model=='source-unsuffixed-double-staging':value=F((1.0-v)*row0+F(v*row1))
    else:value=F(F(F(1-v)*row0)+F(v*row1))
    return F(value*F(.6616))

def fbm(p,model):
    total=F(0);amplitude=F(1);maximum=F(0);frequency=F(1)
    for octave in range(3):
        total=F(total+F(signed_noise([F(frequency*v)for v in p],model)*amplitude))
        maximum=F(maximum+amplitude);amplitude=F(amplitude*.5);frequency=F(frequency*2)
    return F(F(F(.5*total)/maximum)+.5)

def rgba(x,y,route,model):
    p=[F(x*(0 if route.startswith('scale-zero')else 5)),F(y*(0 if route.startswith('scale-zero')else 5))]
    red=fbm(p,model)
    if route.endswith('fac'):return[red,red,red,F(1)]
    lanes=[red]+[fbm([F(v+o)for v,o in zip(p,offset(seed))],model)for seed in [2,3]]
    return lanes+[F(1)]

def ordered(w):return 0x80000000-w if w&0x80000000 else 0x80000000+w

def compare(actual,coordinates,route,model,contract):
    differences=violations=alpha=0;maximum=0;ulps=0;examples=[]
    for pixel in range(len(actual)//4):
        x,y=coordinates[pixel*4:pixel*4+2];expected=rgba(x,y,route,model)
        for lane,wanted in enumerate(expected):
            i=pixel*4+lane;got=actual[i];a,b=word(got),word(wanted);delta=abs(got-wanted);u=abs(ordered(a)-ordered(b));maximum=max(maximum,delta);ulps=max(ulps,u)
            differences+=a!=b
            bad=not math.isfinite(got)or not 0<=got<=1 or(lane==3 and a!=word(1))or(lane<3 and(delta>contract['researchGateAbsoluteMax']or u>contract['researchGateUlpsMax']))
            alpha+=lane==3 and a!=word(1);violations+=bad
            if a!=b and len(examples)<8:examples.append({'pixel':pixel,'lane':lane,'nativeWord':hex(a),'modelWord':hex(b),'absoluteError':delta,'ulps':u})
    return{'comparedWords':len(actual),'wordDifferences':differences,'contractViolations':violations,'alphaDifferences':alpha,'maxAbs':maximum,'maxUlps':ulps,'firstDifferences':examples}
