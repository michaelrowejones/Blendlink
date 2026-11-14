# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned direct World scenes and native EEVEE half-film background references."""
from array import array
from pathlib import Path
import hashlib,json,math,os,platform,struct,sys
import bpy
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import export_scene as exporter
SETUP_ONLY=os.environ.get('SCENETOWEB_WORLD_SETUP_ONLY')=='1'
OUT=Path(os.environ['SCENETOWEB_WORLD_BACKGROUND_REFERENCES']).resolve();PLAN=json.loads((ROOT/'experiments/constant-world-background/cases.json').read_text());sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();word=lambda value:struct.unpack('=I',struct.pack('=f',value))[0];f32=lambda value:struct.unpack('=f',struct.pack('=f',value))[0]
assert tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3' and sys.platform=='darwin' and platform.machine()=='arm64'
files=sorted({Path(__file__).resolve(),ROOT/'experiments/constant-world-background/cases.json',ROOT/'experiments/constant-world-background/protocol.mjs',ROOT/'experiments/constant-world-background/sources.json',ROOT/'packages/blender-addon/tests/world_background_check.py',*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json'),*(ROOT/'packages/blendlink/blender').glob('*.py')});pins={str(p.relative_to(ROOT)):sha(p)for p in files};rows=[];native_backend=None
for spec in PLAN['cases']+PLAN['controlCases']:
    bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1
    scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100;scene.render.use_compositing=False;scene.render.use_sequencer=False;scene.render.film_transparent=spec.get('controlKind')=='film-transparent'
    scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.exr_codec='NONE'
    world=bpy.data.worlds.new('Artist constant World');world.use_nodes=True;scene.world=world;tree=world.node_tree
    if spec['setup']!='initialized':
        tree.nodes.clear();background=tree.nodes.new('ShaderNodeBackground');output=tree.nodes.new('ShaderNodeOutputWorld');tree.links.new(background.outputs['Background'],output.inputs['Surface'])
    else:background=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBackground');output=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeOutputWorld')
    if spec['setup']=='explicit':background.inputs['Color'].default_value=(*spec['color'],1);background.inputs['Strength'].default_value=spec['strength']
    actual_color=list(background.inputs['Color'].default_value)[:3];actual_strength=float(background.inputs['Strength'].default_value)
    assert [word(v)for v in actual_color]==[word(v)for v in spec['color']],(spec,actual_color)
    assert word(actual_strength)==word(spec['strength'])
    radiance=[f32(value*actual_strength)for value in actual_color];assert all(0<=v<=1 for v in radiance)
    expected_world={'color':actual_color,'strength':actual_strength,'exact':True,'source':'background','backgroundVisible':not scene.render.film_transparent}
    assert exporter.collect_authoring_preview(scene)['world']==expected_world
    mesh=bpy.data.meshes.new('Authored off-camera carrier');mesh.from_pydata([(99,-1,0),(101,-1,0),(100,1,0)],[],[(0,1,2)])
    owner=bpy.data.objects.new('Authored off-camera carrier',mesh);scene.collection.objects.link(owner);owner.select_set(True);bpy.context.view_layer.objects.active=owner
    material=bpy.data.materials.new('Artist ordinary material');material.use_nodes=True;mesh.materials.append(material)
    camera_data=bpy.data.cameras.new('Artist Camera');camera_data.type='ORTHO';camera_data.ortho_scale=2;camera=bpy.data.objects.new('Artist Camera',camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera;camera['blendlink_id']='world-background-camera'
    scene['blendlink_recipe']=json.dumps({'schemaVersion':1,'presentation':'realtime','atlases':[{'id':'main','name':'Main','size':128,'targetDensity':1,'margin':4,'fitPolicy':'block','bakeOutput':'appearance'}],'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'states':[{'name':'default'}],'optimization':{'geometry':'meshopt','textures':'none'},'camera':{'objectId':'world-background-camera','objectName':camera.name,'behavior':'fixed','framing':'authored','compositions':[{'name':'World','width':13,'height':9,'safeMargin':0}]}})
    if spec.get('controlKind')=='website-background':
        recipe=json.loads(scene['blendlink_recipe']);recipe['look']={'toneMapping':'application','exposure':0,'background':'color','backgroundColor':[.25,.5,.75]};recipe['environment']={'source':'application','lighting':'none','background':'application','lightingIntensity':1,'lightingRotation':0,'backgroundIntensity':1,'backgroundRotation':0,'backgroundBlur':0,'groundHeight':1,'groundRadius':10};scene['blendlink_recipe']=json.dumps(recipe)
    # Exercise the REAL native Final recipe validator before any render.
    exporter.resolve_scene_recipe({'draft':False})
    source=OUT/(spec['case']+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source));source_pin=sha(source);frames=[];prior_path=scene.render.filepath
    for width,height in ([]if SETUP_ONLY or spec.get('controlKind')else PLAN['sizes']):
        scene.render.resolution_x=width;scene.render.resolution_y=height;exr=OUT/(spec['case']+f'-{width}x{height}.exr');scene.render.filepath=str(exr);bpy.ops.render.render(write_still=True)
        image=bpy.data.images.load(str(exr),check_existing=False)
        try:pixels=array('f',[0])*(width*height*4);image.pixels.foreach_get(pixels)
        finally:bpy.data.images.remove(image)
        assert all(math.isfinite(v)for v in pixels)
        max_abs=max(abs(pixels[i]-radiance[i%4])for i in range(len(pixels))if i%4!=3)
        assert max_abs<=PLAN['numericContract']['rgbAbsoluteMax'],(spec['case'],max_abs)
        assert all(word(pixels[i])==word(1)for i in range(3,len(pixels),4))
        if spec['exactRGB']:assert all(word(v)==word(radiance[i%4])for i,v in enumerate(pixels)if i%4!=3)
        pixel=exr.with_suffix('.rgba32f');pixel.write_bytes(pixels.tobytes());frames.append({'width':width,'height':height,'pixelFile':pixel.name,'pixelSha256':sha(pixel),'exrFile':exr.name,'exrSha256':sha(exr),'maximumAbsoluteRGBFromSourceRadiance':max_abs})
    scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.filepath=prior_path
    assert sha(source)==source_pin and exporter.collect_authoring_preview(scene)['world']==expected_world and scene.world==world and owner.data==mesh
    if frames:
        import gpu
        native_backend=gpu.platform.backend_type_get();assert native_backend=='METAL'
    rows.append({**spec,'sourceFile':source.name,'sourceSha256':source_pin,'world':expected_world,'radiance':radiance,'radianceWords':[word(v)for v in radiance],'sourceWords':[word(v)for v in(*actual_color,actual_strength)],'frames':frames,'sourceRestored':True})
assert pins=={p:sha(ROOT/p)for p in pins}
(OUT/('setup-policy.json'if SETUP_ONLY else'qualification.json')).write_text(json.dumps({'schemaVersion':1,'status':'CONSTANT_WORLD_SETUP_PASSED'if SETUP_ONLY else'CONSTANT_WORLD_NATIVE_REFERENCE_READY','sourceProfile':{'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'host':sys.platform+'-'+platform.machine(),'engine':'BLENDER_EEVEE','backend':native_backend,'referenceStage':'no rendering requested'if SETUP_ONLY else'native EEVEE half-film in EXR32'},'cases':[row for row in rows if not row.get('controlKind')],'controls':[row for row in rows if row.get('controlKind')],'sourceHashes':pins,'numericContract':PLAN['numericContract'],'iblCredit':0,'wholeSceneLightingCredit':0},indent=2)+'\n')
