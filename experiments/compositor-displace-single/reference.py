# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Matrix-owned same-pixel CPU Displace references.
"""Actual native Displace on pinned Final scene-pass words, not a new Image port."""
from array import array
from pathlib import Path
import hashlib,json,struct,sys
import bpy,gpu,numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'packages/blender-addon/tests'),str(ROOT/'packages/blendlink/blender')]
from compositor_reference import NativeCompositorReference
import compositor_graph,source_presentation
OUT=Path(sys.argv[sys.argv.index('--')+1]).resolve()
sources=json.loads((OUT/'final.json').read_text());baselines=json.loads((OUT/'baselines.json').read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
blocked=[0]
def no_gpu(*args,**kwargs):
 blocked[0]+=1
 raise RuntimeError('Displace CPU reference forbids GPU initialization')
gpu.init=no_gpu
try:gpu.init()
except RuntimeError:pass
else:raise AssertionError('Missing GPU guard')
assert blocked==[1];blocked[0]=0
oracle=NativeCompositorReference(OUT/'native',device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False)
config,config_path=source_presentation.config_from_install()
processor=source_presentation.composed_processor(oracle.scene,config);cpu=processor.getDefaultCPUProcessor()
assert cpu.isNoOp()and source_presentation.serialize_ops(processor)==[]
rows=[]
for profile in baselines['profiles']:
 for api in profile['apis']:
  for frame in api['rows']:
   definition=next(row for row in sources['rows']if row['case']==frame['case'])
   for role in ('source','program'):assert sha(OUT/definition[role+'File'])==definition[role+'Sha256']
   program=json.loads((OUT/definition['programFile']).read_text())
   native=next(op for op in program['ops']if op['source']['nodeType']=='CompositorNodeDisplace')
   assert native['properties']['displace_words']==definition['displacementWords']
   width,height=frame['width'],frame['height'];baseline=OUT/frame['baselineFile']
   assert sha(baseline)==frame['baselineSha256'];data=np.frombuffer(baseline.read_bytes(),np.float32).copy()
   assert len(data)==width*height*4 and np.isfinite(data).all()
   oracle.scene.render.resolution_x=width;oracle.scene.render.resolution_y=height
   image=bpy.data.images.new('Owned actual Final scene-pass words',width=width,height=height,alpha=True,float_buffer=True)
   image.alpha_mode='PREMUL';image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(data)
   stored=np.empty_like(data);image.pixels.foreach_get(stored)
   assert np.array_equal(stored.view(np.uint32),data.view(np.uint32))
   def source(tree):
    node=tree.nodes.new('CompositorNodeImage');node.image=image;return node.outputs['Image']
   def render(label,output,sink):
    tree=oracle.tree;tree.links.new(output,sink.inputs[0])
    assert oracle.scene.render.engine=='CYCLES'and oracle.scene.cycles.device=='CPU'
    assert oracle.scene.render.compositor_device=='CPU'and oracle.scene.render.compositor_precision=='FULL'
    for node in tree.nodes:node.show_preview=False
    path=OUT/'native'/(frame['id']+'.'+label+'.exr');oracle.scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
    loaded=bpy.data.images.load(str(path),check_existing=False)
    try:
     loaded.alpha_mode='PREMUL';actual=array('f',[0])*(width*height*4);loaded.pixels.foreach_get(actual)
    finally:bpy.data.images.remove(loaded)
    raw=OUT/'native'/(frame['id']+'.'+label+'.rgba32f');raw.write_bytes(actual.tobytes())
    return raw,np.frombuffer(actual.tobytes(),np.float32).copy()
   sink,_=oracle.reset();copyfile,copied=render('copy',source(oracle.tree),sink)
   assert np.array_equal(copied.view(np.uint32),data.view(np.uint32))
   sink,_=oracle.reset();node=oracle.tree.nodes.new('CompositorNodeDisplace')
   delta=array('f');delta.frombytes(struct.pack('=2I',*definition['displacementWords']))
   node.inputs['Displacement'].default_value.foreach_set(delta)
   actual=array('f',[0,0]);node.inputs['Displacement'].default_value.foreach_get(actual);assert actual.tobytes()==delta.tobytes()
   node.inputs['Interpolation'].default_value=definition['interpolation']
   for name in ('Extension X','Extension Y'):node.inputs[name].default_value='Clip'
   if definition['source']=='render-layer':oracle.tree.links.new(source(oracle.tree),node.inputs['Image'])
   else:
    color=array('f');color.frombytes(struct.pack('=4I',*definition['colorWords']))
    node.inputs['Image'].default_value.foreach_set(color)
   oracle.tree.links.new(node.outputs['Image'],sink.inputs[0])
   extraction=compositor_graph.extract(oracle.scene)['status']
   assert extraction==('unsupported'if definition['source']=='render-layer'else'extracted')
   linearfile,linear=render('linear',node.outputs['Image'],sink)
   if definition['setting']=='origin':assert np.array_equal(linear.view(np.uint32),data.view(np.uint32))
   if definition['setting']=='maximum':assert linear.tobytes()==bytes(len(linear)*4)
   if definition['source']=='constant-rgba':assert np.array_equal(linear.view(np.uint32).reshape((-1,4)),np.tile(np.array(definition['colorWords'],np.uint32),(width*height,1)))
   display=linear.reshape((-1,4)).copy()
   for pixel in display:
    if pixel[3]!=0 and pixel[3]!=1:
     inverse=np.float32(np.float32(1)/pixel[3]);pixel[:3]=np.asarray(pixel[:3]*inverse,dtype=np.float32)
   before=display.view(np.uint32).copy();cpu.applyRGBA(display);assert np.array_equal(before,display.view(np.uint32))
   for pixel in display:
    if pixel[3]!=0 and pixel[3]!=1:pixel[:3]=np.asarray(pixel[:3]*pixel[3],dtype=np.float32)
   displayfile=OUT/'native'/(frame['id']+'.display.rgba32f');displayfile.write_bytes(display.tobytes())
   row={key:frame[key]for key in ('id','case','width','height','pixelRatio','baselineFile','baselineSha256')}
   for role,path in [('copy',copyfile),('linear',linearfile),('display',displayfile)]:row[role+'File']=str(path.relative_to(OUT));row[role+'Sha256']=sha(path)
   row.update(words=width*height*4,copyDifferences=0,sourceExtractionStatus=extraction);rows.append(row)
   bpy.data.images.remove(image)
assert blocked==[0]
report={'status':'CAPTURED_DISPLACE_CPU_SAME_PIXEL_REFERENCES','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'rows':rows,'nativeRenders':len(rows)*2,'sourcePreserved':all(sha(OUT/row['sourceFile'])==row['sourceSha256']for row in sources['rows']),'rawDisplayAudit':{'model':'cpu-reciprocal-f32-identity-ocio-audit-v1','primarySourcesSha256':sha(ROOT/'experiments/compositor-ellipse-scene-mix/raw-display-sources.json'),'ocioProcessorIsNoOp':True,'configPath':str(config_path),'configSha256':sha(config_path)},'gpuInitializations':0,'sourceImageProducerCredit':0}
(OUT/'native.json').write_text(json.dumps(report,indent=2)+'\n')
print(report['status'],len(rows),report['nativeRenders'])
