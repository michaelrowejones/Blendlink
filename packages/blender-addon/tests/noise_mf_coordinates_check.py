# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent bounded coordinate evaluator; source copy-on-write and limits."""
import math
import random
import struct
import sys
from pathlib import Path
from fractions import Fraction
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from noise_mf_coordinates import evaluate_mf_coordinate, canonicalize_mf_coordinates

f=lambda value:{'op':'const_float','value':value}
op=lambda operation,a,b:{'op':'math','operation':operation,'a':a,'b':b}
cancellation=op('SUBTRACT',op('SUBTRACT',op('ADD',f(1e8),f(1)),f(1e8)),f(1))
assert evaluate_mf_coordinate(cancellation)==-1
assert evaluate_mf_coordinate(op('ADD',f(1e8),f(1))) is None, 'Final coordinate exceeded the measured band'
for bad in [op('DIVIDE',f(1),f(3)),{**op('MULTIPLY_ADD',f(.5),f(.5)),'c':f(.5)},
            op('MULTIPLY',f(2**-100),f(2**-100)),
            op('SUBTRACT',op('MULTIPLY',f(2**30),f(4)),f(2**31)),
            {'op':'attribute_object','value':0,'exactArithmetic':True}]:
    assert evaluate_mf_coordinate(bad) is None,bad
point={'op':'combine','x':cancellation,'y':f(-.375),'z':f(.625)}
original={'dimensions':3,'input':point,'roughnessNode':{'op':'uv'}}
before=repr(original)
canonical=canonicalize_mf_coordinates(original)
assert canonical['input']=={'op':'const_vec3','value':[-1,-.375,.625]}
assert canonical['mfCoordinateSource']['input'] is point
assert repr(original)==before, 'Certificate modified original IR'
assert canonicalize_mf_coordinates({'dimensions':3,'input':{'op':'const_vec3','value':[0,0,0]}}) is None

# Exact rational rounding, independent from binary64 ADD/SUB/MUL. Select the
# nearest of Float32's adjacent candidates, with bit-parity ties-to-even.
f32=lambda value:struct.unpack('<f',struct.pack('<f',value))[0]
bits=lambda value:struct.unpack('<I',struct.pack('<f',value))[0]
word=lambda value:struct.unpack('<f',struct.pack('<I',value))[0]
def nearest(exact):
    sign=-1 if exact<0 else 1;exact=abs(exact)
    candidate=f32(float(exact));center=bits(candidate)
    candidates=[word(value) for value in range(max(0,center-1),min(0x7f7fffff,center+1)+1)]
    chosen=min(candidates,key=lambda value:(abs(Fraction(value)-exact),bits(value)&1))
    return sign*chosen
rng=random.Random(7353)
for operation in ['ADD','SUBTRACT','MULTIPLY']:
    for _ in range(500):
        a,b=[f32(rng.uniform(-64,64)*2**rng.randrange(-12,6)) for _ in range(2)]
        exact=Fraction(a)+Fraction(b) if operation=='ADD' else Fraction(a)-Fraction(b) if operation=='SUBTRACT' else Fraction(a)*Fraction(b)
        if abs(exact)>1e6:continue
        assert bits(evaluate_mf_coordinate(op(operation,f(a),f(b))))==bits(nearest(exact)),(operation,a,b)
print('BLENDLINK_NOISE_MF_COORDINATES_PASSED 1500 rational stages; bounded grammar, copy-on-write, original IR retained')
