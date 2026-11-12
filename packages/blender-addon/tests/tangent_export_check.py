# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual GLB Mikk tangent bytes, explicit UV basis and adapter restoration."""
import importlib
import itertools
import json
from pathlib import Path
import struct
import sys
import tempfile
import bpy
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'blendlink/blender'))
import tangent_export

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('Artist tangent source')
mesh.from_pydata([(0,0,0),(1,.1,.25),(1.2,1,.5),(.2,.9,.25)],[],[(0,1,2,3)]);mesh.update()
mesh.polygons[0].use_smooth=True
mesh.normals_split_custom_set([(-.15,-.24,.958),(-.2,-.21,.957),(-.18,-.26,.948),(-.16,-.23,.96)])
uv_a=mesh.uv_layers.new(name='EditUV');uv_b=mesh.uv_layers.new(name='RenderUV')
for uv,xy in zip(uv_a.data,[(0,0),(1,0),(1,1),(0,1)]):uv.uv=xy
for uv,xy in zip(uv_b.data,[(.1,.2),(-.55,-.4),(-1.15,.25),(-.5,.85)]):uv.uv=xy
mesh.uv_layers.active_index=0;uv_b.active_render=True
mesh.calc_tangents();edit=np.asarray([tuple(loop.tangent) for loop in mesh.loops],np.float32)
mesh.calc_tangents(uvmap='RenderUV')
expected=np.asarray([tuple(loop.tangent)+(loop.bitangent_sign,) for loop in mesh.loops],np.float32)
assert np.max(np.abs(edit-expected[:,:3]))>.1
assert np.max(np.abs(expected[:,:3]-np.round(expected[:,:3],4)))>1e-5

def authored_snapshot():
    return json.dumps({'vertices':[list(v.co) for v in mesh.vertices],
        'normals':[list(n.vector) for n in mesh.corner_normals],
        'uvs':[[list(uv.uv) for uv in layer.data] for layer in mesh.uv_layers],
        'edit':mesh.uv_layers.active_index,'render':[layer.name for layer in mesh.uv_layers if layer.active_render],
        'users':mesh.users},sort_keys=True)

before=authored_snapshot()
private=mesh.copy();owner=bpy.data.objects.new('Private tangent export',private);bpy.context.scene.collection.objects.link(owner)
owner.select_set(True);bpy.context.view_layer.objects.active=owner
module=importlib.import_module('io_scene_gltf2.blender.exp.'+('gltf2_blender_gather_primitives_extract' if bpy.app.version[:2]==(4,2) else 'primitive_extract'))
creator=module.PrimitiveCreator
methods=['_PrimitiveCreator__get_tangents','_PrimitiveCreator__get_bitangent_signs']
originals=[getattr(creator,name) for name in methods]

def accessor(gltf,binary,index):
    item=gltf['accessors'][index];view=gltf['bufferViews'][item['bufferView']]
    assert item['componentType']==5126 and item['type'] in {'VEC3','VEC4'}
    columns={'VEC3':3,'VEC4':4}[item['type']]
    return np.ndarray((item['count'],columns),np.float32,buffer=binary,
        offset=view.get('byteOffset',0)+item.get('byteOffset',0),strides=(view.get('byteStride',columns*4),4)).copy()

with tempfile.TemporaryDirectory(prefix='blendlink-exact-tangents-') as directory:
    for uv_name,yup in itertools.product(('EditUV','RenderUV'),(False,True)):
        mesh.calc_tangents(uvmap=uv_name)
        expected=np.asarray([tuple(loop.tangent)+(loop.bitangent_sign,) for loop in mesh.loops],np.float32)
        path=Path(directory)/('yup.glb' if yup else 'raw.glb')
        with tangent_export.exact_tangents({private.name:uv_name}):
            bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
                export_yup=yup,export_normals=True,export_tangents=True,export_texcoords=True,
                export_materials='NONE',export_animations=False,export_skins=False,export_morph=False)
        payload=path.read_bytes();length=struct.unpack_from('<I',payload,12)[0]
        gltf=json.loads(payload[20:20+length]);binary=payload[28+length:]
        primitives=[p for node in gltf['nodes'] if 'mesh' in node for p in gltf['meshes'][node['mesh']]['primitives']]
        assert primitives
        positions={tuple(mesh.vertices[loop.vertex_index].co):expected[loop.index] for loop in mesh.loops}
        for primitive in primitives:
            points=accessor(gltf,binary,primitive['attributes']['POSITION'])
            tangents=accessor(gltf,binary,primitive['attributes']['TANGENT'])
            if yup:
                points=points[:,[0,2,1]];points[:,1]*=-1
                tangents=tangents[:,[0,2,1,3]];tangents[:,1]*=-1
            assert np.array_equal(tangents,np.asarray([positions[tuple(point)] for point in points],np.float32)),(yup,tangents,expected)
        assert all(getattr(creator,name) is original for name,original in zip(methods,originals))
        assert private.uv_layers.active_index==0 and private.uv_layers['RenderUV'].active_render
        assert authored_snapshot()==before

for bypass in (False,True):
    try:
        with tangent_export.exact_tangents({private.name:'RenderUV'}):
            if not bypass:raise RuntimeError('intentional exporter failure')
    except RuntimeError:assert not bypass
    except ValueError as error:assert bypass and 'did not bind' in str(error)
    else:raise AssertionError('An exporter bypass silently accepted rounded tangents')
    assert all(getattr(creator,name) is original for name,original in zip(methods,originals))
try:
    with tangent_export.exact_tangents({private.name:'MissingUV'}):pass
except ValueError as error:assert 'actual named UV basis' in str(error)
else:raise AssertionError('A missing UV basis was silently replaced')
assert authored_snapshot()==before
print('BLENDLINK_TANGENT_EXPORT_PASSED '+bpy.app.version_string)
