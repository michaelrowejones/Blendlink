# SPDX-License-Identifier: GPL-3.0-or-later
# Owned actual-CPU image oracle. Original saved scenes/RenderLayers remain byte-identical.
import bpy,json,sys,hashlib,os
from pathlib import Path
import numpy as np
FAMILIES=json.loads((Path(__file__).parent/'mask-families.json').read_text());FAMILY=FAMILIES[os.environ.get('SCENETOWEB_SCENE_MIX_FAMILY','ellipse')]
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import source_presentation
OUT=Path(sys.argv[sys.argv.index('--')+1]);sources=json.loads((OUT/'final.json').read_text());baseline=json.loads((OUT/'baselines.json').read_text());sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();rows=[];raw_sources=json.loads((Path(__file__).parent/'raw-display-sources.json').read_text());oracle=NativeCompositorReference(OUT/'native',device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False)
config,config_path=source_presentation.config_from_install();processor=source_presentation.composed_processor(oracle.scene,config);cpu=processor.getDefaultCPUProcessor();assert cpu.isNoOp();assert source_presentation.serialize_ops(processor)==[]
for profile in baseline['profiles']:
 for api in profile['apis']:
  for frame in api['rows']:
   source=next(r for r in sources['rows']if r['case']==frame['case']);assert sha(OUT/source['sourceFile'])==source['sourceSha256'];program=json.loads((OUT/source['programFile']).read_text());mask_spec=next(op['properties']for op in program['ops']if op['kind']==FAMILY['kind']);w,h=frame['width'],frame['height'];pixels=OUT/frame['baselineFile'];assert sha(pixels)==frame['baselineSha256'];data=np.frombuffer(pixels.read_bytes(),np.float32).copy();assert len(data)==w*h*4;oracle.scene.render.resolution_x=w;oracle.scene.render.resolution_y=h;oracle.scene.render.resolution_percentage=100
   image=bpy.data.images.new('Owned captured Three frame',width=w,height=h,alpha=True,float_buffer=True);image.alpha_mode='PREMUL';image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(data);stored=np.empty_like(data);image.pixels.foreach_get(stored);assert np.array_equal(stored.view(np.uint32),data.view(np.uint32))
   def node_image():
    node=oracle.tree.nodes.new('CompositorNodeImage');node.image=image;return node.outputs['Image']
   def render(label,output,sink):
    oracle.tree.links.new(output,sink.inputs[0]);path=OUT/'native'/(frame['id']+'.'+label+'.exr');oracle.scene.render.filepath=str(path)
    for n in oracle.tree.nodes:n.show_preview=False
    bpy.ops.render.render(write_still=True);loaded=bpy.data.images.load(str(path),check_existing=False);loaded.alpha_mode='PREMUL';result=np.empty(w*h*4,np.float32);loaded.pixels.foreach_get(result);bpy.data.images.remove(loaded);target=OUT/'native'/(frame['id']+'.'+label+'.rgba32f');target.write_bytes(result.tobytes());return target,result
   sink,_=oracle.reset();copyfile,copied=render('copy',node_image(),sink);assert np.array_equal(copied.view(np.uint32),data.view(np.uint32))
   sink,_=oracle.reset();mask=oracle.tree.nodes.new(FAMILY['nativeClass']);mask.inputs['Mask'].default_value=0;mask.inputs['Value'].default_value=1;mask.inputs['Position'].default_value=mask_spec[FAMILY['prefix']+'position'];mask.inputs['Size'].default_value=mask_spec[FAMILY['prefix']+'size'];scene_input=node_image()
   if source['route']=='Alpha':
    sep=oracle.tree.nodes.new('CompositorNodeSeparateColor');sep.mode='RGB';oracle.tree.links.new(scene_input,sep.inputs['Image']);scene_input=sep.outputs['Alpha']
   mix=oracle.tree.nodes.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MIX';mix.clamp_factor=True;mix.clamp_result=False;active=lambda n:next(s for s in mix.inputs if s.identifier==n);active('B_Color'if source['side']=='A'else'A_Color').default_value=source['background'];oracle.tree.links.new(mask.outputs['Mask'],active('Factor_Float'));oracle.tree.links.new(scene_input,active(source['side']+'_Color'));mixed=next(s for s in mix.outputs if s.identifier=='Result_Color');mixfile,mixdata=render('mix',mixed,sink)
   # Legacy component-division roundtrip diagnostic from the rejected r3
   # contract; retained separately, never used as the Raw-display oracle.
   straight=oracle.tree.nodes.new('CompositorNodePremulKey');straight.inputs['Type'].default_value='To Straight';oracle.tree.links.new(mixed,straight.inputs['Image']);sep=oracle.tree.nodes.new('CompositorNodeSeparateColor');sep.mode='RGB';oracle.tree.links.new(mixed,sep.inputs['Image']);equal=oracle.tree.nodes.new('ShaderNodeMath');equal.operation='COMPARE';equal.inputs[1].default_value=0;equal.inputs[2].default_value=0;oracle.tree.links.new(sep.outputs['Alpha'],equal.inputs[0]);scale=oracle.tree.nodes.new('ShaderNodeMath');scale.operation='ADD';oracle.tree.links.new(sep.outputs['Alpha'],scale.inputs[0]);oracle.tree.links.new(equal.outputs[0],scale.inputs[1]);multiply=oracle.tree.nodes.new('CompositorNodeSetAlpha');multiply.inputs['Type'].default_value='Apply Mask';oracle.tree.links.new(straight.outputs['Image'],multiply.inputs['Image']);oracle.tree.links.new(scale.outputs[0],multiply.inputs['Alpha']);restore=oracle.tree.nodes.new('CompositorNodeSetAlpha');restore.inputs['Type'].default_value='Replace Alpha';oracle.tree.links.new(multiply.outputs['Image'],restore.inputs['Image']);oracle.tree.links.new(sep.outputs['Alpha'],restore.inputs['Alpha']);divisionfile,_=render('division-diagnostic',restore.outputs['Image'],sink)
   # Source-derived Blender CPU wrapper staging around the actual identity
   # OCIO processor. This is not a direct call to its C++ display wrapper.
   display=mixdata.reshape((-1,4)).copy()
   for pixel in display:
    if pixel[3]!=0 and pixel[3]!=1:
     inverse=np.float32(np.float32(1)/pixel[3]);pixel[:3]=np.asarray(pixel[:3]*inverse,dtype=np.float32)
   before=display.view(np.uint32).copy();cpu.applyRGBA(display);assert np.array_equal(before,display.view(np.uint32))
   for pixel in display:
    if pixel[3]!=0 and pixel[3]!=1:pixel[:3]=np.asarray(pixel[:3]*pixel[3],dtype=np.float32)
   displayfile=OUT/'native'/(frame['id']+'.display.rgba32f');displayfile.write_bytes(display.tobytes())
   rows.append({**{k:frame[k]for k in ['id','case','width','height','pixelRatio','baselineFile','baselineSha256']},'copyFile':str(copyfile.relative_to(OUT)),'copySha256':sha(copyfile),'mixFile':str(mixfile.relative_to(OUT)),'mixSha256':sha(mixfile),'displayFile':str(displayfile.relative_to(OUT)),'displaySha256':sha(displayfile),'divisionWitnessFile':str(divisionfile.relative_to(OUT)),'divisionWitnessSha256':sha(divisionfile),'copyDifferences':0,'words':w*h*4});bpy.data.images.remove(image)
report={'status':FAMILY['nativeStatus'],'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'rows':rows,'nativeRenders':len(rows)*3,'rawDisplayAudit':{'model':raw_sources['model'],'primarySourcesSha256':sha(Path(__file__).parent/'raw-display-sources.json'),'ocioProcessorIsNoOp':True,'configPath':str(config_path),'configSha256':sha(config_path)},'sourcePreserved':all(sha(OUT/r['sourceFile'])==r['sourceSha256']for r in sources['rows'])};(OUT/'native.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows),report['nativeRenders'])
