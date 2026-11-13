# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual RNA node, profile routing and refusal; no native Linux claim on Mac."""
import copy
import ast
import itertools
import math
import numpy as np
import sys
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'blendlink/blender'))
import compositor_difference_key as model
from compositor_math import numeric_socket_bounds

# Actual captured hosted source identity. Every field is part of admission.
profile={'platform':'linux','architecture':'x86_64','blenderVersion':[5,2,0], 'blenderHash':'fbe6228777e7',
    'requestedBackend':'OPENGL','renderer':'llvmpipe (LLVM 20.1.2, 256 bits)','vendor':'Mesa',
    'version':'4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4','deviceType':'SOFTWARE','backend':'OPENGL'}
assert model.is_measured_rne_profile(profile)
for key in profile:
    assert not model.is_measured_rne_profile({**profile,key:[5,3,0] if key=='blenderVersion' else 'unmeasured'})
for bad in [None,[],{'backend':'OPENGL','software':True},{**profile,'certified':True},
            {**profile,'blenderVersion':[5,2,False]},{**profile,'blenderVersion':[5,2,0,0]}]:
    assert not model.is_measured_rne_profile(bad)

# A failed headless initialization cannot reuse a requested backend as proof.
def failed_init():raise RuntimeError('No GPU context')
with patch.dict(sys.modules,{'gpu':SimpleNamespace(init=failed_init)}):
    unknown=model.native_gpu_profile()
    assert all(unknown[key] is None for key in ['renderer','vendor','version','deviceType','backend'])
    assert not model.is_measured_rne_profile(unknown)

# The supplement is selected by independent F32 arithmetic, never native pixels.
fixture=Path(__file__).with_name('compositor_difference_key_check.py')
constructor=next(item for item in ast.parse(fixture.read_text()).body if isinstance(item,ast.FunctionDef) and item.name=='association_probe_pixels')
namespace={'np':np,'itertools':itertools}
exec(compile(ast.fix_missing_locations(ast.Module(body=[constructor],type_ignores=[])),str(fixture),'exec'),namespace)
pixels,association=namespace['association_probe_pixels']()
assert pixels.shape==(8,16,4) and np.isfinite(pixels).all() and np.all(pixels[...,3]==2)
assert len(association['triples'])==16 and sum(row['leftOpaque'] for row in association['triples'])==8
for row in association['triples']:
    a,b,c=np.asarray(row['rgb'],np.float32)
    left=np.float32(np.float32(a+b)+c);right=np.float32(a+np.float32(b+c))
    assert left!=right and (np.float32(left/np.float32(3))>association['threshold'])!=(np.float32(right/np.float32(3))>association['threshold'])
    assert len(set(row['rgb']))==3

tree=bpy.data.node_groups.new('Artist Difference Key profile routing','CompositorNodeTree')
node=tree.nodes.new('CompositorNodeDiffMatte');scene=bpy.context.scene
previous=scene.render.compositor_device;scene.render.compositor_device='GPU'
# The guard captures values, including literal outputs used by key colors.
fingerprint_definition=next(item for item in ast.parse(fixture.read_text()).body if isinstance(item,ast.FunctionDef) and item.name=='fingerprint')
fingerprint_namespace={'bpy':bpy,'math':math}
exec(compile(ast.fix_missing_locations(ast.Module(body=[fingerprint_definition],type_ignores=[])),str(fixture),'exec'),fingerprint_namespace)
fingerprint_tree=fingerprint_namespace['fingerprint']
value_node=tree.nodes.new('ShaderNodeValue' if node.inputs.get('Tolerance') is not None else 'CompositorNodeValue')
before_fingerprint=fingerprint_tree(tree)
old_color=list(node.inputs['Image 2'].default_value)
node.inputs['Image 2'].default_value=(.123,.234,.345,.456)
assert fingerprint_tree(tree)!=before_fingerprint
node.inputs['Image 2'].default_value=old_color
old_output=value_node.outputs[0].default_value;value_node.outputs[0].default_value=.375
assert fingerprint_tree(tree)!=before_fingerprint
value_node.outputs[0].default_value=old_output
assert fingerprint_tree(tree)==before_fingerprint
class Refused(Exception):pass
def refuse(_socket,message):raise Refused(message)
def fingerprint():
    return ([(s.identifier,str(getattr(s,'default_value',None))) for s in node.inputs],
            [(name,getattr(node,name)) for name in ['tolerance','falloff'] if hasattr(node,name)],len(tree.nodes),len(tree.links))
def normalize(backend='OPENGL',device='GPU',output='Image'):
    scene.render.compositor_device=device
    op={'properties':{'evaluation_device':device,'native_gpu_backend':backend},'inputs':{}}
    before=fingerprint()
    try:
        model.normalize_difference_key(node,node.outputs[output],op,scene,
            lambda socket:list(socket.default_value) if hasattr(socket.default_value,'__len__') else socket.default_value,
            numeric_socket_bounds,refuse)
        return op
    finally:assert fingerprint()==before, 'Profile selection changed source RNA/links'
try:
    for output in ['Image','Matte']:
        with patch.object(model,'native_gpu_profile',return_value=copy.deepcopy(profile)):
            op=normalize(output=output);assert op['properties']['difference_key_model']==model.RNE_MODEL
            assert op['properties']['difference_key_gpu_profile']==profile
    for field in profile:
        with patch.object(model,'native_gpu_profile',return_value={**profile,field:None}):
            try:normalize();raise AssertionError('An unmeasured OpenGL profile acquired the new capability')
            except Refused as error:assert str(error)==model.UNVERIFIED_GPU_MESSAGE
    for backend,device in [('OPENGL','CPU'),('METAL','GPU')]:
        with patch.object(model,'native_gpu_profile',side_effect=AssertionError('Unrelated evaluator sampled the profile')):
            op=normalize(backend,device)
            assert op['properties']['difference_key_model']=='native-difference-key-v1'
            assert 'difference_key_gpu_profile' not in op['properties']
finally:
    scene.render.compositor_device=previous;bpy.data.node_groups.remove(tree)
print('BLENDLINK_DIFFERENCE_PROFILE_PASSED actual source RNA, exact recorded profile, unknown refusal, old CPU/Metal unchanged')
