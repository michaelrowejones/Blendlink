# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent exact-rational nearest-even float32 FMA controls."""
from fractions import Fraction
from pathlib import Path
import json, math, random, struct, sys
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
f32 = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
bits = lambda value: struct.unpack('<I', struct.pack('<f', value))[0]
number = lambda value: struct.unpack('<f', struct.pack('<I', value))[0]
def fused(a, b, c):
    exact = Fraction(a) * Fraction(b) + Fraction(c)
    approximate = bits(f32(float(exact)))
    candidates = [value for value in range(max(0, approximate-2), min(0xffffffff, approximate+2)+1)
                  if math.isfinite(number(value))]
    selected = min(candidates, key=lambda value: (abs(Fraction(number(value))-exact), value & 1))
    return number(selected)
rng = random.Random(0xF32A)
records = []
for group in ['fade-first', 'fade-second', 'mix', 'coordinate-modulo']:
    pixels, expected = [], []
    for index in range(4096):
        t = f32(index / 4095) if index < 2048 else f32(rng.random())
        if group == 'fade-first': a, b, c = t, 6., -15.
        elif group == 'fade-second': a, b, c = t, fused(t, 6., -15.), 10.
        elif group == 'mix': a, b, c = t, f32(rng.uniform(-6, 6)), f32(rng.uniform(-3, 3))
        else:
            # Metal compatible_mod lowers division to an f32 reciprocal and
            # contracts the integer-quotient product/subtraction. Preserve
            # that cancellation over its measured finite int32 domain.
            c = f32([1074099968.,1074100096.,-1074099968.,-1074100096.,
                     ((1<<31)-4096)*100000.,-((1<<31)-4096)*100000.,2**40,-(2**40)][index]) if index < 8 else f32(
                (-1 if index & 1 else 1) * (rng.randrange(1, (1 << 31)-256) * 100000 + rng.randrange(-200000, 200001)))
            quotient = int(f32(c * f32(1 / 100000)))
            a, b = -f32(quotient), 100000.

        pixels.extend([a, b, c, 1.]); expected.extend([fused(a,b,c)] * 3)
    image = {'op':'tex_image','width':64,'height':64,'pixels':pixels,'interpolation':'Closest',
             'extension':'REPEAT','output':'color','vector':{'op':'uv'}}
    document = {'schemaVersion':1,'model':'blendlink-tsl-ir-v1','output':{'op':'test_fma', **{
        key:{'op':'separate','channel':channel,'input':image} for key,channel in zip(['a','b','c'],['x','y','z'])}}}
    (out/(group+'.json')).write_text(json.dumps(document))
    (out/(group+'.f32')).write_bytes(struct.pack('<'+str(len(expected))+'f',*expected))
    records.append(group)
(out/'index.json').write_text(json.dumps({'oracle':'exact rational product+sum, nearest-even float32 via adjacent candidates','cases':records,'size':64}))
