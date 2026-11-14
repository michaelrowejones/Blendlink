# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned CPU source admission; numerical/Final/browser proof is a separate gate.
# blendlink-headless-sentinel: SCENETOWEB_ELLIPSE_CPU_POLICY_PASSED
"""Owned no-render policy controls, actual native sockets and group bindings."""
import bpy,sys,json,hashlib,ast,types,importlib,os,tempfile
from unittest.mock import patch
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import compositor_graph
from compositor_ellipse_mask import normalize_ellipse_mask
from compositor_box_mask import read_box_scalar_words
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.resolution_x=13;scene.render.resolution_y=9
pins={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()for p in[ROOT/'packages/blendlink/blender/compositor_ellipse_mask.py',ROOT/'packages/blendlink/blender/compositor_graph.py',ROOT/'packages/blendlink/blender/compositor_box_mask.py',ROOT/'packages/blendlink/blender/compositor_mask_domains.py',ROOT/'packages/blendlink/blender/source_presentation.py']};rows=[]
tree=bpy.data.node_groups.new('Owned Ellipse policy','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree

def reset():
 tree.nodes.clear();node=tree.nodes.new('CompositorNodeEllipseMask');sink=tree.nodes.new('NodeGroupOutput');tree.links.new(node.outputs['Mask'],sink.inputs[0]);return node,sink

def state(node):
 return(node.as_pointer(),tree.as_pointer(),tree.users,tuple(bpy.data.node_groups.keys()),tuple((s.as_pointer(),s.identifier,len(s.links),str(getattr(s,'default_value',None)))for s in node.inputs),tuple((l.from_node.as_pointer(),l.from_socket.identifier,l.to_node.as_pointer(),l.to_socket.identifier)for l in tree.links))

def check(label,node,accepted):
 before=state(node);program=compositor_graph.extract(scene);assert(program['status']=='extracted')==accepted,(label,program);assert state(node)==before,(label,'source ownership changed')
 if accepted:
  ops=[op for op in program['ops']if op['kind']=='ellipse-mask'];assert len(ops)==1,(label,program);p=ops[0]['properties'];assert p['ellipse_mask_boundary_model']=='separate-fmul-fadd-fsqrt-v1'and p['ellipse_mask_row_model']=='rg32i-fixed-256x32-inclusive-v1';assert p['ellipse_mask_scalar_words']==read_box_scalar_words(node)
 rows.append({'case':label,'accepted':accepted,'diagnostics':program['diagnostics']})
 return program

node,sink=reset();initial=state(node)
for i in range(32):assert read_box_scalar_words(node)==[0,1065353216,0]
assert state(node)==initial
for operation in['Add','Subtract','Multiply','Not']:
 node,sink=reset();node.inputs['Operation'].default_value=operation;node.inputs['Mask'].default_value=.25;node.inputs['Value'].default_value=.75;check('literal-'+operation,node,True)
 for size in[(0,.5),(.5,0),(0,0)]:node.inputs['Size'].default_value=size;check('zero-'+str(size)+'-'+operation,node,True)
# Direct actual native source-policy refusal, without invoking any global GPU profile collection.
node,sink=reset();scene.render.compositor_device='GPU'
try:
 normalize_ellipse_mask(node,node.outputs['Mask'],{'properties':{}},scene,lambda socket,message:(_ for _ in()).throw(ValueError(message)))
except ValueError as error:assert 'native CPU'in str(error);rows.append({'case':'actual-GPU-device-policy','accepted':False})
else:raise AssertionError('GPU source accepted')
scene.render.compositor_device='CPU'
for label,name,value in[('rotation','Rotation',.25),('negative-zero','Mask',-0.0),('small','Value',2**-17),('small-size','Size',(2**-17,.5)),('vector-negative-zero','Position',(-0.0,.5)),('nonfinite','Value',float('inf'))]:
 node,sink=reset();node.inputs[name].default_value=value;check(label,node,False)
node,sink=reset();scene.render.use_border=True;check('border',node,False);scene.render.use_border=False
node,sink=reset();scene.render.pixel_aspect_x=2;check('aspect',node,False);scene.render.pixel_aspect_x=1
node,sink=reset();scene.render.resolution_x=4;scene.render.resolution_percentage=25;check('dimension-one',node,False);scene.render.resolution_x=13;scene.render.resolution_percentage=100
node,sink=reset();constant=tree.nodes.new('ShaderNodeValue');tree.links.new(constant.outputs[0],node.inputs['Mask']);check('linked-Mask',node,False)
node,sink=reset();node.inputs['Value'].keyframe_insert('default_value',frame=1);check('animated-owner',node,False);tree.animation_data_clear()
node,sink=reset();flip=tree.nodes.new('CompositorNodeFlip');tree.links.new(node.outputs['Mask'],flip.inputs['Image']);tree.links.new(flip.outputs['Image'],sink.inputs[0]);check('Flip-domain',node,False)
node,sink=reset();blur=tree.nodes.new('CompositorNodeBlur');tree.links.new(node.outputs['Mask'],blur.inputs['Image']);tree.links.new(blur.outputs['Image'],sink.inputs[0]);check('Blur-domain',node,False)
# One varying row is admitted, the next is not; constants do not spend a sampler.
node,sink=reset();second=tree.nodes.new('CompositorNodeEllipseMask');add=tree.nodes.new('ShaderNodeMath');add.operation='ADD';tree.links.new(node.outputs['Mask'],add.inputs[0]);tree.links.new(second.outputs['Mask'],add.inputs[1]);tree.links.new(add.outputs[0],sink.inputs[0]);check('second-varying-table',node,False)
second.inputs['Mask'].default_value=0;second.inputs['Value'].default_value=0;program=compositor_graph.extract(scene);assert program['status']=='extracted',program;rows.append({'case':'one-varying-plus-constant','accepted':True})
# Real OCIO lowering preserves the authored LUT inventory. Only the composed
# processor is replaced with this owned CPU control; serialize_ops is untouched.
import source_presentation
O=source_presentation.O
for lut_count in[7,8]:
 node,sink=reset();transform=O.GroupTransform()
 for index in range(lut_count):
  lut=O.Lut1DTransform(length=3);lut.setData(source_presentation.np.array([0,0,0,.125,.375,.625,1,1,1],dtype='float32'));transform.appendTransform(lut)
  transform.appendTransform(O.MatrixTransform(matrix=[.875,.125,0,0,0,.75,.25,0,.125,0,.875,0,0,0,0,1]))
 processor=O.Config.CreateRaw().getProcessor(transform);lowered=source_presentation.serialize_ops(processor);assert sum(op['type']in{'Lut1DTransform','Lut3DTransform'}for op in lowered)==lut_count
 with tempfile.TemporaryDirectory(prefix='scenetoweb-owned-ellipse-budget-')as directory:
  with patch.object(source_presentation,'composed_processor',return_value=processor):pointer=source_presentation.export_source_presentation(scene,Path(directory)/'owned.glb')
  authored=json.loads(Path(pointer['path']).read_text());assert(authored['compositor']['status']=='extracted')==(lut_count==7),(lut_count,authored)
  if lut_count==8:assert any(d['code']=='unsupported-ellipse-mask-sampler-budget'for d in authored['compositor']['diagnostics'])
 rows.append({'case':'native-display-budget-'+str(lut_count),'accepted':lut_count==7})
# Actual nested group output/reroute remains a field, not an accidental single value.
node,sink=reset();group=bpy.data.node_groups.new('Owned nested Ellipse','CompositorNodeTree');group.interface.new_socket(name='Mask',in_out='OUTPUT',socket_type='NodeSocketFloat');leaf=group.nodes.new('CompositorNodeEllipseMask');output=group.nodes.new('NodeGroupOutput');group.links.new(leaf.outputs['Mask'],output.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;reroute=tree.nodes.new('NodeReroute');tree.links.new(instance.outputs[0],reroute.inputs[0]);tree.links.new(reroute.outputs[0],sink.inputs[0]);program=check('nested-group-reroute',node,True);assert any(op['source']['node']==leaf.name and len(op['source']['path'])>1 for op in program['ops']if op['kind']=='ellipse-mask')
# Execute the ACTUAL loader and mask dependency-registration statements under
# a source-addon package alias whose folder contains none of the new helpers.
node,sink=reset();prefix='_scenetoweb_owned_mask_source_alias';package=types.ModuleType(prefix);package.__path__=[str(ROOT/'packages/blender-addon')];sys.modules[prefix]=package
source_path=ROOT/'packages/blendlink/blender/compositor_graph.py';parsed=ast.parse(source_path.read_text());names={'_mask_domain_contract','normalize_box_mask','validate_box_mask_graph','normalize_ellipse_mask','validate_ellipse_mask_graph'}
registration=[item for item in parsed.body if isinstance(item,ast.Assign)and any(isinstance(t,ast.Name)and t.id in names for t in item.targets)]
assert [item.targets[0].id for item in registration]==['_mask_domain_contract','normalize_box_mask','validate_box_mask_graph','normalize_ellipse_mask','validate_ellipse_mask_graph']
loader=next(item for item in parsed.body if isinstance(item,ast.FunctionDef)and item.name=='_sibling')
scope={'__package__':prefix,'__file__':str(source_path),'importlib':importlib,'Path':Path,'sys':sys}
try:
 exec(compile(ast.Module(body=[loader,*registration],type_ignores=[]),str(source_path),'exec'),scope)
 assert Path(sys.modules[prefix+'.compositor_ellipse_mask'].__file__).resolve()==(ROOT/'packages/blendlink/blender/compositor_ellipse_mask.py').resolve()
 emitted={'properties':{}};scope['normalize_ellipse_mask'](node,node.outputs['Mask'],emitted,scene,lambda socket,message:(_ for _ in()).throw(ValueError(message)));assert emitted['properties']['ellipse_mask_identity']is False
finally:
 for name in list(sys.modules):
  if name==prefix or name.startswith(prefix+'.'):sys.modules.pop(name)
rows.append({'case':'actual-source-alias-loader-dependency-order','accepted':True})
# No rendering: capture current actual source IR against the original pilot's
# closed settings. Later browser pilot cross-checks are archival, not new CPU proof.
program_count=0
if os.environ.get('SCENETOWEB_ELLIPSE_PROGRAMS'):
 dest=Path(os.environ['SCENETOWEB_ELLIPSE_PROGRAMS']);dest.mkdir(parents=True,exist_ok=True);specs=json.loads(Path(os.environ['SCENETOWEB_ELLIPSE_CASES']).read_text());programs=[]
 for spec in specs:
  node,sink=reset();values=spec['settings'];scene.render.resolution_percentage=100;scene.render.resolution_x=spec['width'];scene.render.resolution_y=spec['height']
  if min(spec['width'],spec['height'])<4:scene.render.resolution_x=spec['width']*2;scene.render.resolution_y=spec['height']*2;scene.render.resolution_percentage=50
  node.inputs['Operation'].default_value=values['operation'].capitalize()
  for name,key in [('Position','position'),('Size','size'),('Mask','mask'),('Value','value')]:node.inputs[name].default_value=values[key]
  program=compositor_graph.extract(scene);assert program['status']=='extracted',(spec['id'],program);p=program['ops'][0]['properties'];assert p['ellipse_mask_identity']==any(n==0 for n in values['size'])
  path=dest/(spec['id']+'.program.json');path.write_text(json.dumps(program,indent=2)+'\n');programs.append({'id':spec['id'],'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
 (dest/'index.json').write_text(json.dumps({'status':'actual-source-IR-only','programs':programs,'renderCalls':0,'supportCredit':0},indent=2)+'\n');program_count=len(programs)
assert pins=={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()for p in pins}
print('SCENETOWEB_ELLIPSE_CPU_POLICY_PASSED '+json.dumps({'cases':len(rows),'sourcePreserved':True,'rawCopyCycles':32,'sourcePrograms':program_count,'renderCalls':0,'bakeCalls':0,'finalCredit':0,'browserCredit':0,'supportCredit':0}))
