# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual EEVEE field images and untouched saved sources for Final replay."""
from array import array
from pathlib import Path
import hashlib
import json
import os
import sys
import bpy

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(ROOT/'packages/blender-addon'))
import material_compiler as compiler
assert Path(compiler.__file__).resolve()==ROOT/'packages/blender-addon/material_compiler.py'
OUT=Path(os.environ['SCENETOWEB_VERTEX_ALPHA_REFERENCES']).resolve()
PLAN=json.loads((OUT/'plan.json').read_text());GEOMETRY=json.loads((ROOT/'experiments/vertex-color-alpha/fixture-geometry.json').read_text());sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
files=sorted({Path(__file__),ROOT/'experiments/vertex-color-alpha/cases.json',ROOT/'experiments/vertex-color-alpha/attribute-cases.json',ROOT/'experiments/vertex-color-alpha/protocol.mjs',ROOT/'experiments/vertex-color-alpha/fixture-geometry.json',
    *(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json'),*(ROOT/'packages/blendlink/blender').glob('*.py')})
source_hashes={str(p.relative_to(ROOT)):sha(p)for p in files}
assert tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'

def setup(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.name='Artist '+name;scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1
    scene.world=None;scene.render.resolution_x=scene.render.resolution_y=64;scene.render.resolution_percentage=100
    scene.render.film_transparent=False;scene.render.use_compositing=False;scene.render.use_sequencer=False
    scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.exr_codec='NONE'
    camera_data=bpy.data.cameras.new('Artist Camera');camera_data.type='ORTHO';camera_data.ortho_scale=2
    camera=bpy.data.objects.new('Artist Camera',camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
    mesh=bpy.data.meshes.new('Artist Field Mesh');mesh.from_pydata(GEOMETRY['nodeVertices'],[],GEOMETRY['triangles'])
    owner=bpy.data.objects.new('Artist Field Owner',mesh);scene.collection.objects.link(owner)
    return scene,mesh,owner

def render(scene,name,size):
    scene.render.resolution_x=scene.render.resolution_y=size
    exr=OUT/(name+'-'+str(size)+'.exr');scene.render.filepath=str(exr);bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(str(exr),check_existing=False)
    try:
        pixels=array('f',[0])*(size*size*4);image.pixels.foreach_get(pixels)
    finally:bpy.data.images.remove(image)
    target=OUT/(name+'-'+str(size)+'.rgba32f');target.write_bytes(pixels.tobytes())
    assert all(pixels[i]==1 for i in range(3,len(pixels),4))
    return {'width':size,'height':size,'pixelFile':target.name,'pixelSha256':sha(target),'exrFile':exr.name,'exrSha256':sha(exr)},pixels

# Independent geometric ramp establishes sample centers BEFORE any node image.
scene,mesh,owner=setup('Independent calibration')
# Keep ALL FOUR independent calibration vertices at the original ±2 square;
# node-case geometry independently gives half-pixel seam clearance.
for vertex,position in zip(mesh.vertices,GEOMETRY['calibrationVertices']):vertex.co=position
mesh.update()
material=bpy.data.materials.new('Independent geometry ramp');material.use_nodes=True;mesh.materials.append(material)
tree=material.node_tree;tree.nodes.clear();output=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(emission.outputs[0],output.inputs[0])
geometry=tree.nodes.new('ShaderNodeNewGeometry');separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(geometry.outputs['Position'],separate.inputs[0]);combine=tree.nodes.new('ShaderNodeCombineXYZ');combine.inputs['Z'].default_value=.5
for axis in ('X','Y'):
    add=tree.nodes.new('ShaderNodeMath');add.operation='ADD';add.inputs[1].default_value=1
    mul=tree.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=.5
    tree.links.new(separate.outputs[axis],add.inputs[0]);tree.links.new(add.outputs[0],mul.inputs[0]);tree.links.new(mul.outputs[0],combine.inputs[axis])
tree.links.new(combine.outputs[0],emission.inputs['Color'])
calibration,pixels=render(scene,'independent-ramp',64)
for y in range(64):
    for x in range(64):assert tuple(pixels[4*(y*64+x):4*(y*64+x)+4])==((x+.5)/64,(y+.5)/64,.5,1)
calibration.update({'maxAbs':0,'pixelOffset':[0,0],'samples':1,'filterSize':scene.render.filter_size,'cameraAdjusted':False,
    'camera':{'type':'ORTHO','scale':2,'location':[0,0,2],'rotation':[0,0,0],'shift':[0,0]}})
import gpu
backend={'backend':gpu.platform.backend_type_get(),'vendor':gpu.platform.vendor_get(),'renderer':gpu.platform.renderer_get()}

def alpha_node(tree,spec,vertex_layer):
    kind=spec.get('sourceNode','ShaderNodeVertexColor')
    assert kind in {'ShaderNodeVertexColor','ShaderNodeAttribute'}
    node=tree.nodes.new(kind)
    if kind=='ShaderNodeAttribute':
        assert spec['layer'] and spec['layer']!='temperature'
        node.attribute_type='GEOMETRY';node.attribute_name=spec['layer']
        assert node.attribute_type=='GEOMETRY'and node.attribute_name==spec['layer']
    else:node.layer_name=vertex_layer
    assert node.outputs['Alpha'].identifier=='Alpha'
    return node

rows=[]
for spec in PLAN['cases']:
    scene,mesh,owner=setup(spec['case'])
    paint=mesh.color_attributes.new(name=spec.get('layer','Render Paint'),type='FLOAT_COLOR',domain=spec['domain'])
    paint.data.foreach_set('color',array('f',[lane for value in spec['alpha']for lane in(.125,.25,.5,value)]))
    editor=mesh.color_attributes.new(name='Editor Paint',type='FLOAT_COLOR',domain='POINT');editor.data.foreach_set('color',array('f',[.125,.25,.5,1]*4))
    mesh.color_attributes.render_color_index=1 if spec.get('sourceNode')=='ShaderNodeAttribute'else 0;mesh.color_attributes.active_color_index=1
    owners=[owner]
    if spec.get('shared'):
        owner.location.x=-1;owner.scale.x=.5
        other=bpy.data.objects.new('Artist Shared Field Owner',mesh);scene.collection.objects.link(other);other.location.x=1;other.scale.x=.5;owners.append(other)
    materials=[]
    for index in range(spec['materials']):
        material=bpy.data.materials.new('Artist Vertex Alpha'+(' '+str(index)if spec['materials']>1 else''));material.use_nodes=True;materials.append(material);mesh.materials.append(material)
        tree=material.node_tree;tree.nodes.clear();surface=tree.nodes.new('ShaderNodeBsdfPrincipled');output=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(surface.outputs[0],output.inputs[0])
        surface.inputs['Base Color'].default_value=(0,0,0,1);surface.inputs['Specular IOR Level'].default_value=0;surface.inputs['Emission Strength'].default_value=1
        if spec.get('group'):
            group=bpy.data.node_groups.new('Artist Alpha Group','ShaderNodeTree');group.interface.new_socket(name='Artist Alpha',in_out='OUTPUT',socket_type='NodeSocketFloat')
            field=alpha_node(group,spec,'Render Paint');result=group.nodes.new('NodeGroupOutput');reroute=group.nodes.new('NodeReroute')
            group.links.new(field.outputs['Alpha'],reroute.inputs[0]);group.links.new(reroute.outputs[0],result.inputs[0]);instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;alpha=instance.outputs[0]
        else:
            field=alpha_node(tree,spec,''if index else'Render Paint');alpha=field.outputs['Alpha']
        tree.links.new(alpha,surface.inputs['Emission Color'])
        if spec.get('rgb'):
            rgb=tree.nodes.new('ShaderNodeVertexColor');rgb.layer_name='Editor Paint';tree.links.new(rgb.outputs['Color'],surface.inputs['Base Color'])
    if spec['materials']>1:mesh.polygons[0].material_index=1
    for obj in owners:obj.select_set(True)
    bpy.context.view_layer.objects.active=owner
    scene.camera['blendlink_id']='vertex-alpha-camera'
    scene['blendlink_recipe']=json.dumps({'schemaVersion':1,'presentation':'realtime',
        'atlases':[{'id':'main','name':'Main','size':128,'targetDensity':1,'margin':4,'fitPolicy':'block','bakeOutput':'appearance'}],
        'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},
        'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'states':[{'name':'default'}],
        'optimization':{'geometry':'meshopt','textures':'none'},
        'camera':{'objectId':'vertex-alpha-camera','objectName':scene.camera.name,'behavior':'fixed','framing':'authored',
            'compositions':[{'name':'Field proof','width':64,'height':64,'safeMargin':0}]}})
    source=OUT/(spec['case']+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source));source_pin=sha(source)
    frames=[render(scene,spec['case'],size)[0]for size in PLAN['sizes']]
    scene.render.resolution_x=scene.render.resolution_y=64
    plan=compiler.plan_materials(owners,purpose='final',automatic_programs=True)
    assert not plan.errors,compiler.format_plan_errors(plan)
    assert len(plan.lowerings)==spec['materials'],plan.as_dict()
    programs={'schemaVersion':1,'model':'blendlink-material-programs-v1','materials':{}}
    for decision in plan.lowerings:
        programs['materials'][decision.material_name]={'channels':{item['channel']:{key:item[key]for key in('tslIr','tslIrHash','tslIrBytes')if key in item}
            for item in decision.channel_plan['channels']if item.get('tslIr')},'skipped':[{'channel':item.get('channel'),'reason':item['tslIrRefusal']}for item in decision.channel_plan['channels']if item.get('tslIrRefusal')]}
    program_file=OUT/(spec['case']+'.raw.materials.json');program_file.write_text(json.dumps(programs,sort_keys=True,separators=(',',':')))
    raw_glb=OUT/(spec['case']+'.raw.glb')
    def emit(path):
        # Selection limits this raw transport fixture to its owned meshes;
        # include the actual authored camera and restore source selection.
        selected=scene.camera.select_get();scene.camera.select_set(True)
        try:return bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_extras=True,export_cameras=True,
            export_animations=False,**compiler.exporter_overrides(plan))
        finally:scene.camera.select_set(selected)
    compiler.with_compiled_materials(plan,str(raw_glb),emit)
    assert sha(source)==source_pin
    rows.append({**spec,'sourceFile':source.name,'sourceSha256':source_pin,'rawGlbFile':raw_glb.name,'rawGlbSha256':sha(raw_glb),
        'rawProgramFile':program_file.name,'rawProgramSha256':sha(program_file),'rawProgramBytes':program_file.stat().st_size,'frames':frames})
assert source_hashes=={str(p.relative_to(ROOT)):sha(p)for p in files}
qualification={'schemaVersion':1,'status':'CAPTURED_VERTEX_COLOR_ALPHA','nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),
    'sourceBackend':backend,'sourceHashes':source_hashes,'calibration':calibration,'cases':rows,
    'sourceStage':'actual EEVEE Principled Emission from native '+('named Attribute GEOMETRY Alpha'if PLAN['cases'][0].get('sourceNode')=='ShaderNodeAttribute'else'Vertex Color Alpha')+'; half-film reference, not exact Float32 raster oracle'}
(OUT/'qualification.json').write_text(json.dumps(qualification,indent=2)+'\n')
print('SCENETOWEB_VERTEX_ALPHA_NATIVE_CAPTURED '+json.dumps({'cases':len(rows),'frames':len(rows)*len(PLAN['sizes']),'saved':len(rows)}))
