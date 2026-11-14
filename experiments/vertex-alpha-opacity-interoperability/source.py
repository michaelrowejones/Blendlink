# SPDX-License-Identifier: GPL-3.0-or-later
"""Untouched authored Color+Alpha sources; no transparency/dither render claim."""
from array import array
from pathlib import Path
import hashlib,json,os,sys
import bpy
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(ROOT/'packages/blender-addon'))
import material_compiler as compiler
import export_scene
OUT=Path(os.environ['SCENETOWEB_ALPHA_OWNERSHIP']).resolve()
sha=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
files=sorted({Path(__file__),ROOT/'experiments/vertex-alpha-opacity-interoperability/cases.json',*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json'),*(ROOT/'packages/blendlink/blender').glob('*.py')})
pins={str(path.relative_to(ROOT)):sha(path)for path in files}
assert tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
rows=[]
for spec in json.loads((ROOT/'experiments/vertex-alpha-opacity-interoperability/cases.json').read_text())['cases']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.world=None
    mesh=bpy.data.meshes.new('Artist plane');mesh.from_pydata([(-2,-2,0),(2,-2,0),(2,2,0),(-2,2,0)],[],[(0,1,2),(0,2,3)])
    layer=mesh.color_attributes.new(name='Paint',type='FLOAT_COLOR',domain=spec['domain'])
    layer.data.foreach_set('color',array('f',[v for _ in layer.data for v in(.125,.25,.5,spec['alpha'])]))
    mesh.color_attributes.active_color_index=mesh.color_attributes.render_color_index=0
    owner=bpy.data.objects.new('Artist plane',mesh);scene.collection.objects.link(owner);owner.select_set(True);bpy.context.view_layer.objects.active=owner
    material=bpy.data.materials.new('Artist');material.use_nodes=True;material.surface_render_method='DITHERED';mesh.materials.append(material)
    tree=material.node_tree;surface=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled')
    field=tree.nodes.new('ShaderNodeVertexColor');field.layer_name='Paint';tree.links.new(field.outputs['Alpha'],surface.inputs['Alpha'])
    if spec['kind']=='color':tree.links.new(field.outputs['Color'],surface.inputs['Base Color'])
    else:
        image=bpy.data.images.new('Artist magenta RGBA',width=2,height=2,alpha=True,float_buffer=True)
        image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(array('f',[1,0,1,.125]*4));image.pack()
        raw_image=array('f',[0])*16;image.pixels.foreach_get(raw_image);assert raw_image.tobytes()==array('f',[1,0,1,.125]*4).tobytes()
        assert image.is_float and image.alpha_mode=='STRAIGHT' and image.colorspace_settings.name=='Non-Color' and tuple(image.size)==(2,2)
        texture=tree.nodes.new('ShaderNodeTexImage');texture.image=image;texture.interpolation='Closest';tree.links.new(texture.outputs['Color'],surface.inputs['Base Color'])
        uv=mesh.uv_layers.new(name='UVMap');uv.data.foreach_set('uv',array('f',[0,0,1,0,1,1,0,0,1,1,0,1]))
    camera_data=bpy.data.cameras.new('Artist Camera');camera_data.type='ORTHO';camera_data.ortho_scale=2
    camera=bpy.data.objects.new('Artist Camera',camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera;camera['blendlink_id']='ownership-camera'
    scene['blendlink_recipe']=json.dumps({'schemaVersion':1,'presentation':'realtime','atlases':[{'id':'main','name':'Main','size':128,'targetDensity':1,'margin':4,'fitPolicy':'block','bakeOutput':'appearance'}], 'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'states':[{'name':'default'}],'optimization':{'geometry':'meshopt','textures':'none'},'camera':{'objectId':'ownership-camera','objectName':camera.name,'behavior':'fixed','framing':'authored','compositions':[{'name':'Ownership','width':16,'height':16,'safeMargin':0}]}})
    source=OUT/(spec['case']+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source));source_pin=sha(source)
    before=array('f',[0])*(len(layer.data)*4);layer.data.foreach_get('color',before);pointer=owner.data.as_pointer();users=mesh.users
    plan=compiler.plan_materials([owner],purpose='final',automatic_programs=True);assert not plan.errors,compiler.format_plan_errors(plan)
    assert len(plan.lowerings)==1 and compiler.vertex_color_alpha.opacity_ownership(plan.lowerings[0].channel_plan,'Artist')['completeColor']
    raw=OUT/(spec['case']+'.raw.glb')
    def emit(path):return bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_extras=True,export_animations=False,**compiler.exporter_overrides(plan))
    compiler.with_compiled_materials(plan,str(raw),emit)
    sidecar=export_scene.publish_material_programs(plan,str(raw));program=json.loads(Path(sidecar['path']).read_text())
    assert program['materials']['Artist']['vertexAlphaOpacity']['completeColor'] is True
    after=array('f',[0])*(len(layer.data)*4);layer.data.foreach_get('color',after)
    assert before.tobytes()==after.tobytes() and pointer==owner.data.as_pointer() and users==mesh.users and sha(source)==source_pin
    rows.append({**spec,'sourceFile':source.name,'sourceSha256':source_pin,'rawGlbFile':raw.name,'rawGlbSha256':sha(raw),'rawProgramFile':Path(sidecar['path']).name,'rawProgramSha256':sha(sidecar['path']),'sourceRestored':True,**({'imageSource':{'width':2,'height':2,'rgb':[1,0,1],'alpha':.125,'colorSpace':'Non-Color','storage':'float','alphaMode':'STRAIGHT'}}if spec['kind']=='texture'else{})})
assert pins=={path:sha(ROOT/path)for path in pins}
(OUT/'qualification.json').write_text(json.dumps({'schemaVersion':1,'status':'VERTEX_ALPHA_OPACITY_SOURCE_READY','nativeShaderCredit':0,'transparencyParityCredit':0,'cases':rows,'sourceHashes':pins},indent=2)+'\n')
