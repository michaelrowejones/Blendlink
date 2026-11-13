# SPDX-License-Identifier: GPL-3.0-or-later
"""Exact Float32 words independent of the host's ambient denormal mode."""
import math,struct

def word(value):return struct.unpack('<I',struct.pack('<f',value))[0]
def from_word(bits):
 sign=-1.0 if bits>>31 else 1.0;exponent=(bits>>23)&255;fraction=bits&0x7fffff
 if exponent==255:return math.copysign(math.nan if fraction else math.inf,sign)
 if exponent==0:return sign*fraction*2.0**-149
 return sign*(1+fraction/2.0**23)*2.0**(exponent-127)
def controls():
 result=[];seen=set()
 def add(name,bits):
  if bits in seen:return
  seen.add(bits);value=from_word(bits)
  defined=math.isfinite(value) and -2147483648<=value<=2147483520
  result.append({'name':name,'value':value,'word':f'{bits:08x}','domain':'finite-int32-conversion' if defined else 'undefined-int32-conversion'})
 for value in [-10.75,-3.75,-2.5,-1.5,-.5,-0.,0.,.5,1.5,2.5,3.75,10.75]:add('ordinary-'+str(value),word(value))
 for value in [-2.5,-1.5,-.5,.5,1.5,2.5]:
  bits=word(value)
  for direction in [-1,1]:add('half-neighbor-'+str(value)+'-'+str(direction),bits+direction*(-1 if value<0 else 1))
 for bits in [1,0x80000001,0x007fffff,0x807fffff,0x00800000,0x80800000,0x00800001,0x80800001]:add('zero-normal-word-'+f'{bits:08x}',bits)
 for value in [-16777216,-16777215,16777215,16777216,-2147483648,2147483648]:
  bits=word(value);add('integer-limit-'+str(value),bits)
  for direction in [-1,1]:add('integer-neighbor-'+str(value)+'-'+str(direction),bits+direction*(-1 if value<0 else 1))
 for bits in [0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0x7fc00000,0xffc00000]:add('undefined-word-'+f'{bits:08x}',bits)
 return result

def json_controls():return [{key:value for key,value in item.items() if key!='value'} for item in controls()]
