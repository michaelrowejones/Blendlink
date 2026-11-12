# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent normalized-Noise amplitude and actual-coordinate certificates."""
import math
if __package__:
    from . import geometry_ir
else:
    import geometry_ir


def amplitude(expression):
    finite=lambda value:isinstance(value,(float,int)) and math.isfinite(value)
    if (expression.get('op')!='noise_normalized' or expression.get('normalize') is not True
            or expression.get('noiseType')!='FBM' or 'roughnessNode' in expression
            or expression.get('perlinModel') not in {'native-standard-f32','mf-periodic-f32','eevee-metal-periodic-f32'}
            or expression.get('dimensions') not in {1,2,3,4}
            or expression.get('output') not in {'fac','color'}):
        raise ValueError('Normal Map Noise inputs require the verified static native normalized FBM model')
    for key,low,high in [('detail',-16,6),('roughness',-16,1),('lacunarity',-2,2),('distortion',-1,1)]:
        value=expression.get(key,0 if key=='distortion' else 2 if key=='lacunarity' else None)
        if not finite(value) or not low<=value<=high:
            raise ValueError('Normal Map Noise inputs exceed their verified finite static controls')
    scale=expression.get('scale',{})
    if scale.get('op')!='const_float' or not finite(scale.get('value')) or abs(scale['value'])>80:
        raise ValueError('Normal Map Noise inputs need finite static Scale within magnitude80')
    # Native signed gradient maxima after normalization are2,1.9848,1.964,
    # 2.5032 for1D..4D. Convex fades and float32 headroom keep every octave
    # within[-3,3]. Nonnegative normalized FBM weights then map to[-1,2].
    # This conservative bound is not an assertion of observed extrema/[0,1].
    return [(-1.01,2.01)]*3


def requirements(value,result):
    if isinstance(value,dict):
        if value.get('op')=='noise_normalized':result.append(value)
        for key,child in value.items():
            if key not in {'pixels','values','colorOffsets','distortionOffsets'}:requirements(child,result)
    elif isinstance(value,(tuple,list)):
        for child in value:requirements(child,result)


def object_ranges(owner):
    mesh=owner.data;cache=geometry_ir._validation_cache.get();key=('normal-noise-coordinates',mesh.as_pointer())
    if cache is not None and key in cache:return cache[key]
    result=[(min(vertex.co[axis] for vertex in mesh.vertices),max(vertex.co[axis] for vertex in mesh.vertices)) for axis in range(3)]
    if cache is not None:cache[key]=result
    return result


def coordinate_ranges(expression,owner):
    op=expression.get('op')
    child=lambda key:coordinate_ranges(expression.get(key,{}),owner)
    if op=='const_float':result=[(expression.get('value'),)*2]*3
    elif op=='const_vec3':result=[(value,value) for value in expression.get('value',[])]
    elif op in {'object_coords','generated'}:
        mesh=owner.data;result=object_ranges(owner)
        if op=='generated':
            result=[tuple((value-mesh.texspace_location[axis])/(2*(mesh.texspace_size[axis] or 1))+.5 for value in pair) for axis,pair in enumerate(result)]
            result=[(min(pair),max(pair)) for pair in result]
    elif op=='combine':result=[child(key)[0] for key in ['x','y','z']]
    elif op=='separate' and expression.get('channel') in {'x','y','z'}:
        result=[child('input')[{'x':0,'y':1,'z':2}[expression['channel']]]]*3
    elif op=='vector_math' and expression.get('operation') in {'ADD','SUBTRACT','MULTIPLY'}:
        result=[]
        for a,b in zip(child('a'),child('b')):
            values=[x+y if expression['operation']=='ADD' else x-y if expression['operation']=='SUBTRACT' else x*y for x in a for y in b]
            result.append((min(values),max(values)))
    elif op=='vector_scale':
        scales=child('scale');result=[(min(x*y for x in pair for y in scales[axis]),max(x*y for x in pair for y in scales[axis])) for axis,pair in enumerate(child('input'))]
    else:raise ValueError('Normal Map Noise coordinates need proved object/generated or static coordinate arithmetic')
    if len(result)!=3 or any(not isinstance(item,(int,float)) or not math.isfinite(item) or abs(item)>1e20 for pair in result for item in pair):
        raise ValueError('Normal Map Noise coordinates have no actual finite range')
    return [(lo-max(1,abs(lo),abs(hi))*2**-20,hi+max(1,abs(lo),abs(hi))*2**-20) for lo,hi in result]


def coordinate_slope(expression,owner):
    op=expression.get('op');child=lambda key:coordinate_slope(expression.get(key,{}),owner)
    if op in {'const_float','const_vec3'}:return 0
    if op=='object_coords':return 1
    if op=='generated':return max(1/(2*abs(value or 1)) if object_ranges(owner)[axis][0]!=object_ranges(owner)[axis][1] else 0 for axis,value in enumerate(owner.data.texspace_size))
    if op=='combine':return max(child(key) for key in ['x','y','z'])
    if op=='separate':return child('input')
    if op=='vector_math' and expression.get('operation') in {'ADD','SUBTRACT'}:return child('a')+child('b')
    if op=='vector_scale' or op=='vector_math' and expression.get('operation')=='MULTIPLY':
        a,b=('input','scale') if op=='vector_scale' else ('a','b')
        magnitude=lambda key:max(abs(item) for pair in coordinate_ranges(expression[key],owner) for item in pair)
        return magnitude(a)*child(b)+magnitude(b)*child(a)
    raise ValueError('Normal Map Noise coordinates have no proved affine frequency bound')


def validate(value,owner):
    noises=[];requirements(value,noises)
    for expression in noises:
        amplitude(expression);dimensions=expression['dimensions']
        ranges=coordinate_ranges(expression['input'],owner)[:dimensions]
        if dimensions==4:ranges.append(coordinate_ranges(expression.get('w',{}),owner)[0])
        slope=coordinate_slope(expression['input'],owner)
        if dimensions==4:slope=max(slope,coordinate_slope(expression.get('w',{}),owner))
        scale=abs(expression['scale']['value'])
        ratio=max(0,expression['roughness']);count=math.ceil(max(0,expression['detail']))
        weight=sum(ratio**index for index in range(count+1))
        frequency=max(1,sum(ratio**index*abs(expression.get('lacunarity',2))**index for index in range(count+1))/weight)
        if slope and (scale>1 or expression['detail']>2 or expression.get('distortion',0)!=0 or scale*slope*frequency>.2500025):
            raise ValueError('Normal Map live Noise needs Scale magnitude<=1, Detail<=2, zero Distortion and actual coordinate frequency<=0.25; higher frequencies need native coordinate transport proof')
        input_max=max(abs(item) for pair in ranges for item in pair)
        def offsets(key,count):
            values=expression.get(key,[])
            if not isinstance(values,list) or len(values)!=count or any(not isinstance(row,list) or len(row)!=dimensions for row in values):
                raise ValueError('Normal Map Noise needs its exact finite seed-offset vectors')
            if any(not isinstance(item,(float,int)) or not math.isfinite(item) or abs(item)>200.001 for row in values for item in row):
                raise ValueError('Normal Map Noise seed offsets exceed their finite native range')
            return max((abs(item) for row in values for item in row),default=0)
        color=offsets('colorOffsets',2) if expression['output']=='color' else 0
        distortion=abs(expression.get('distortion',0));distortion_offset=offsets('distortionOffsets',dimensions) if 'distortion' in expression else 0
        scaled=input_max*scale
        octave=max(1,abs(expression.get('lacunarity',2)))**(math.ceil(max(0,expression['detail']))+1)
        if max(scaled+distortion_offset,(scaled+3*distortion+color)*octave)>=90000:
            raise ValueError('Normal Map Noise coordinates exceed the proved non-periodic native range below90000')
