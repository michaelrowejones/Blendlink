# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual Blender5.3 socket policy; numerical GPU qualification is separate."""
from pathlib import Path
import json, sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
from shader_vector2_ir import MODEL, is_vector2
bpy.ops.wm.read_factory_settings(use_empty=True)
tree = bpy.data.node_groups.new('Vector2 policy', 'ShaderNodeTree')

def evaluate(expr):
    op = expr['op']
    if op == 'const_float': return expr['value']
    if op == 'const_vec3': return expr['value']
    if op == 'combine': return [evaluate(expr[k]) for k in ('x','y','z')]
    if op == 'native_vector2':
        assert expr['model'] == MODEL
        value = evaluate(expr['input']); return [value[0], value[1], 0.0]
    if op == 'separate': return evaluate(expr['input'])['xyz'.index(expr['channel'])]
    raise AssertionError(expr)

def output(node, socket=0): return tsl_ir.emit_output(node, node.outputs[socket])
def group(name, in_width, out_width):
    g = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    for direction, width in [('INPUT',in_width),('OUTPUT',out_width)]:
        s = g.interface.new_socket(name='V', in_out=direction, socket_type='NodeSocketVector')
        s.dimensions = width
    i,o = g.nodes.new('NodeGroupInput'),g.nodes.new('NodeGroupOutput')
    g.links.new(i.outputs[0],o.inputs[0])
    n = tree.nodes.new('ShaderNodeGroup'); n.node_tree = g
    return n

combine = tree.nodes.new('ShaderNodeCombineXYZ')
for key,value in zip('XYZ',(.125,-.75,9)): combine.inputs[key].default_value=value
radial = tree.nodes.new('ShaderNodeRadialTiling')
assert is_vector2(radial.inputs['Vector']) and len(radial.inputs['Vector'].default_value) == 2
assert not is_vector2(radial.outputs['Segment Coordinates'])
assert len(radial.outputs['Segment Coordinates'].default_value) == 3
assert evaluate(tsl_ir.emit_input(radial.inputs['Vector'])) == [0,0,0]
radial.inputs['Vector'].default_value=(.25,-.5)
assert evaluate(tsl_ir.emit_input(radial.inputs['Vector'])) == [.25,-.5,0]
tree.links.new(combine.outputs[0],radial.inputs['Vector'])
assert evaluate(tsl_ir.emit_input(radial.inputs['Vector'])) == [.125,-.75,0]

# Reused actual group instances retain their own independent defaults.
g = group('2D to 3D',2,3); h = tree.nodes.new('ShaderNodeGroup');h.node_tree=g.node_tree
for n,values in [(g,(.25,.5)),(h,(-.5,.75))]:
    n.inputs[0].default_value=values
    assert evaluate(output(n)) == [*values,0]
tree.links.new(combine.outputs[0],g.inputs[0]); assert evaluate(output(g)) == [.125,-.75,0]
# Reverse group boundary: native3D to native2D output, then 3D consumer.
r = group('3D to 2D',3,2); r.inputs[0].default_value=(.5,.75,11)
assert is_vector2(r.outputs[0]) and evaluate(output(r)) == [.5,.75,0]
sep = tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(r.outputs[0],sep.inputs[0])
assert evaluate(output(sep,'Z')) == 0
reroute=tree.nodes.new('NodeReroute');tree.links.new(r.outputs[0],reroute.inputs[0])
tree.links.new(reroute.outputs[0],sep.inputs[0]); assert evaluate(output(sep,'Z')) == 0
# RGBA->2D drops B/alpha via exact native xy. No color arithmetic.
rgb=tree.nodes.new('ShaderNodeRGB');rgb.outputs[0].default_value=(.25,.75,6,.125)
tree.links.new(rgb.outputs[0],g.inputs[0]);assert evaluate(output(g))==[.25,.75,0]
# Native bypass tables remain authoritative: Radial has no width2->3 bypass.
radial.mute=True
try:output(radial,'Segment Coordinates')
except Exception as error:assert 'no internal bypass' in str(error),str(error)
else:raise AssertionError('invented muted Radial bypass')
muted=group('Muted width2',2,2);muted.inputs[0].default_value=(.5,.25);muted.mute=True
assert evaluate(output(muted))==[.5,.25,0]
# Scalar, int and bool consumers never receive padded3D mean semantics.
math=tree.nodes.new('ShaderNodeMath');tree.links.new(r.outputs[0],math.inputs[0])
try:tsl_ir.emit_input(math.inputs[0])
except Exception as error:assert 'scalar/INT/BOOLEAN casts remain unqualified' in str(error),str(error)
else:raise AssertionError('float2 scalar cast accepted')
value=tree.nodes.new('ShaderNodeValue');tree.links.new(value.outputs[0],radial.inputs['Vector'])
try:tsl_ir.emit_input(radial.inputs['Vector'])
except Exception as error:assert 'scalar/INT/BOOLEAN casts remain unqualified' in str(error),str(error)
else:raise AssertionError('scalar float2 broadcast accepted')
# Effective target context wins over the scene; Cycles has no new credit.
for engine, admitted in [('EEVEE',True),('CYCLES',False)]:
    with tsl_ir.emission_context(evaluation_engine=engine):
        try: output(r)
        except Exception as error:
            assert not admitted and 'Cycles socket conversions remain unqualified' in str(error),str(error)
        else: assert admitted
print('SCENETOWEB_SHADER_VECTOR2_POLICY_PASSED '+json.dumps({'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'radialInputWidth':2,'radialOutputWidth':3,'gpuRenders':0}))
