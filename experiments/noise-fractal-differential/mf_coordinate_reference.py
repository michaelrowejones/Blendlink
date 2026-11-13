# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent authored MF coordinate graphs and NumPy Float32 oracle.

No emitter/helper evaluation is used to choose the literal control. Every Math
or Vector Math operation corresponds to one native node and one NumPy stage.
"""
import numpy as np


def expression(variant):
    f = lambda value: {'literal': float(np.float32(value))}
    v = lambda values: {'literal': [float(np.float32(value)) for value in values]}
    op = lambda name, a, b, vector=False: {'operation': name, 'a': a, 'b': b, 'vector': vector}
    if variant in {'cancel-positive','cancel-negative'}:
        direction = 1 if variant == 'cancel-positive' else -1
        return op('SUBTRACT', op('SUBTRACT', op('ADD', f(1e8), f(direction)), f(1e8)), f(direction))
    if variant == 'scalar-multiply': return op('MULTIPLY', f(1.3), f(.7))
    if variant == 'scalar-tie': return op('SUBTRACT', op('ADD', f(1), f(2**-24)), f(1))
    if variant == 'vector-add-subtract':
        return op('SUBTRACT', op('ADD', v([1e8,-1e8,1]), v([1,-1,2**-24]), True), v([1e8,-1e8,.875]), True)
    if variant == 'vector-multiply': return op('MULTIPLY', v([1.3,-.7,.173]), v([.7,1.3,-.37]), True)
    if variant == 'vector-scale': return {'operation':'SCALE','a':v([1.3,-.7,.173]),'b':f(.37),'vector':True}
    raise AssertionError(variant)


def value(node):
    if 'literal' in node: return np.asarray(node['literal'], dtype=np.float32)
    a, b = value(node['a']), value(node['b'])
    return np.asarray(a+b if node['operation']=='ADD' else a-b if node['operation']=='SUBTRACT' else a*b, dtype=np.float32)


def socket(tree, node):
    if 'literal' in node:
        data = node['literal']
        if isinstance(data, list):
            result = tree.nodes.new('ShaderNodeCombineXYZ')
            for target, item in zip(result.inputs, data): target.default_value = item
        else:
            result = tree.nodes.new('ShaderNodeValue'); result.outputs[0].default_value = data
        return result.outputs[0]
    result = tree.nodes.new('ShaderNodeVectorMath' if node['vector'] else 'ShaderNodeMath')
    result.operation = node['operation']
    tree.links.new(socket(tree,node['a']),result.inputs[0])
    tree.links.new(socket(tree,node['b']),result.inputs[3] if node['operation']=='SCALE' else result.inputs[1])
    return result.outputs[0]


def install(tree, noise, case):
    expr = expression(case['mfCoordinateVariant'])
    if case.get('mfCoordinateLiteral'): expr = {'literal':value(expr).tolist()}
    source = socket(tree,expr)
    target_w = case['dimensions']=='1D' or case.get('mfCoordinateAxis')=='w'
    if target_w: tree.links.new(source,noise.inputs['W'])
    elif case['mfCoordinateVariant'].startswith('vector-'): tree.links.new(source,noise.inputs['Vector'])
    else:
        point=tree.nodes.new('ShaderNodeCombineXYZ');point.inputs[1].default_value=-.375;point.inputs[2].default_value=.625
        tree.links.new(source,point.inputs[0]);tree.links.new(point.outputs[0],noise.inputs['Vector'])
    return value(expression(case['mfCoordinateVariant'])).tolist()


def cases(engine):
    settings=[(d,'Color',v,'x') for d in ['1D','2D','3D','4D'] for v in ['cancel-positive','cancel-negative']]
    settings += [(d,'Fac','scalar-multiply','x') for d in ['1D','2D','3D','4D']]
    settings += [(d,'Color','scalar-tie','w') for d in ['1D','4D']]
    settings += [('4D','Color',v,'w') for v in ['cancel-positive','cancel-negative','scalar-multiply']]
    settings += [(d,'Color','vector-add-subtract','x') for d in ['2D','3D','4D']]
    settings += [(d,'Fac','vector-multiply','x') for d in ['2D','3D','4D']]
    settings += [(d,'Color','vector-scale','x') for d in ['3D','4D']]
    result=[]
    for dimensions,output,variant,axis in settings:
        for literal in [False,True]:
            result.append({'id':f'{engine.lower()}-mf-coordinate-{dimensions.lower()}-{variant}-{axis}-'+('literal' if literal else 'authored'),
                'kind':'noise','type':'FBM','normalize':True,'Roughness':1,'dimensions':dimensions,'output':output,'stage':'constant',
                'roughnessStage':'constant-function','Detail':2,'Scale':1,'Lacunarity':1.7,'Distortion':.37,
                'mfCoordinateVariant':variant,'mfCoordinateAxis':axis,'mfCoordinateLiteral':literal})
    return result
