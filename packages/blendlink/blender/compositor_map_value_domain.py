# SPDX-License-Identifier: GPL-3.0-or-later
"""Closed Map Value input grammar and Float32 normal-or-zero certification."""
import math
import struct

MODEL = 'finite-normal-or-zero-v1'


def certify_domain(incoming, operations, controls, use_min, use_max, device):
    by_id = {entry['id']: entry for entry in operations}
    budget = [256]
    def f(value):
        try:return struct.unpack('<f',struct.pack('<f',value))[0]
        except (OverflowError,struct.error):return math.copysign(math.inf,value)
    def point(value):
        return (f(value),f(value),True) if isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) else None
    def normal(value):
        return math.isfinite(value) and (value == 0 or abs(value) >= 2**-126)
    def interval(pair):
        lo,hi=pair[:2]
        return math.isfinite(lo) and math.isfinite(hi) and ((lo==hi==0) or lo>=2**-120 or hi<=-2**-120)
    def gate():
        budget[0]-=1
        return budget[0]>=0
    def scalar(value):
        if not gate() or not isinstance(value,dict):return None
        if value.get('kind')=='constant' and value.get('type')=='VALUE':return point(value.get('value'))
        if value.get('kind')=='convert' and value.get('type')=='VALUE':
            if value.get('fromType')=='VALUE':return scalar(value.get('input'))
            if value.get('fromType') not in {'RGBA','VECTOR'}:return None
            parts=components(value.get('input'))
            if parts is None:return None
            a,b,c=parts
            sums=[(f(a[0]+b[0]),f(a[1]+b[1])),None]
            sums[1]=(f(sums[0][0]+c[0]),f(sums[0][1]+c[1]))
            fixed=all(part[2] for part in parts)
            if fixed:
                if not all(normal(part[0]) for part in parts) or not all(normal(pair[0]) for pair in sums):return None
            elif not all(interval(part) for part in parts) or not all(interval(pair) for pair in sums):return None
            result=tuple(f(number/3) if device=='CPU' else f(number*f(1/3)) for number in sums[1])
            if fixed and not normal(result[0]) or not fixed and not interval(result):return None
            return result+(fixed,)
        if value.get('kind')!='ref' or value.get('type')!='VALUE':return None
        source=by_id.get(value.get('node'),{})
        if source.get('type')!='VALUE':return None
        if source.get('kind')=='value' and source.get('type')=='VALUE':return point(source.get('value'))
        if source.get('kind')=='map-value':
            p=source.get('properties',{});v=source.get('inputs',{}).get('Value',{}).get('value')
            if p.get('evaluation_device')!=device:return None
            proof=mapping(v,p.get('map_value_controls'),p.get('map_value_use_min'),p.get('map_value_use_max'))
            return tuple(proof['output'])+(proof['kind']=='fixed',) if proof else None
        if source.get('kind')!='math' or source.get('properties',{}).get('operation') not in {'MINIMUM','MAXIMUM'}:return None
        inputs=source.get('inputs',{});a=scalar(inputs.get('Value',{}).get('value'));b=scalar(inputs.get('Value_001',{}).get('value'))
        if a is None and b is None:return None
        a,b=a or (-math.inf,math.inf,False),b or (-math.inf,math.inf,False)
        select=min if source['properties']['operation']=='MINIMUM' else max
        low,high=select(a[0],b[0]),select(a[1],b[1])
        if source['properties'].get('use_clamp'):low,high=min(max(low,0),1),min(max(high,0),1)
        return low,high,a[2] and b[2]
    def components(value):
        if not gate() or not isinstance(value,dict):return None
        if value.get('kind')=='constant' and value.get('type') in {'RGBA','VECTOR'}:
            numbers=value.get('value')
            if not isinstance(numbers,list) or len(numbers)!=(4 if value['type']=='RGBA' else 3):return None
            result=[point(number) for number in numbers[:3]]
            return result if all(result) else None
        if value.get('kind')=='convert':
            if value.get('fromType')=='VALUE':
                item=scalar(value.get('input'));return [item]*3 if item else None
            if value.get('fromType') in {'RGBA','VECTOR'}:return components(value.get('input'))
        if value.get('kind')!='ref':return None
        source=by_id.get(value.get('node'),{})
        if source.get('kind')=='rgb':return components({'kind':'constant','type':'RGBA','value':source.get('value')})
        if source.get('kind')=='combine-color' and source.get('properties',{}).get('mode')=='RGB':
            result=[scalar(source.get('inputs',{}).get(name,{}).get('value')) for name in ('Red','Green','Blue')]
            return result if all(result) else None
        return None
    def mapping(value,settings,minimum,maximum):
        if not isinstance(settings,list) or len(settings)!=4 or not all(isinstance(x,bool) for x in (minimum,maximum)):return None
        offset,size,low,high=settings
        if not all(isinstance(x,(int,float)) and math.isfinite(x) and abs(x)<=1000 for x in (offset,size)):return None
        source=scalar(value)
        if source is None or not all(math.isfinite(x) for x in source[:2]):return None
        added=(f(source[0]+offset),f(source[1]+offset))
        product=tuple(sorted((f(added[0]*size),f(added[1]*size))))
        if source[2]:
            if not all(normal(x) for x in (source[0],added[0],product[0])):return None
        else:
            if not interval(source) or not all(math.isfinite(x) for x in added+product):return None
            # Cancellation of normal Float32 operands near a magnitude >=2^-50
            # is either zero or at least2^-77. With |Size|>=2^-40 the product
            # remains well above the Float32 subnormal boundary. Otherwise use
            # the stronger interval lower bound, never amplitude alone.
            cancellation=min(abs(source[0]),abs(source[1]))>=2**-50 or abs(offset)>=2**-50
            if not interval(added) and not cancellation:return None
            if not interval(product) and not (cancellation and (size==0 or abs(size)>=2**-40)):return None
        result=product
        for active,limit,select in [(minimum,low,max),(maximum,high,min)]:
            if active:
                if not isinstance(limit,(int,float)) or not normal(limit):return None
                result=tuple(select(number,limit) for number in result)
        return {'kind':'fixed' if source[2] else 'bounded-field','input':list(source[:2]),'sum':list(added),'product':list(product),'output':list(result)}
    proof=mapping(incoming,controls,use_min,use_max)
    return proof if budget[0]>=0 else None
