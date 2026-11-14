# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual No-render mono Switch View dependency policy.
import bpy,sys,json,os,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import compositor_graph
from compositor_view_selection import select_mono_view,ViewSelectionUnsupported,MAX_SELECTIONS
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.use_compositing=True;scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.use_multiview=False
assert scene.render.bl_rna.properties['use_multiview'].is_animatable and not scene.render.views[0].bl_rna.properties['use'].is_animatable
rows=[]
def setup():
 old=scene.compositing_node_group
 if old:bpy.data.node_groups.remove(old)
 scene.render.use_multiview=False;scene.render.compositor_device='CPU';scene.render.views['left'].use=True;scene.render.views['right'].use=True
 tree=bpy.data.node_groups.new('Owned mono view policy','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree;sink=tree.nodes.new('NodeGroupOutput');node=tree.nodes.new('CompositorNodeSwitchView');node.inputs[0].default_value=(.125,.25,.5,1);node.inputs[1].default_value=(.875,.75,.625,1);tree.links.new(node.outputs['Image'],sink.inputs[0]);return tree,node,sink

def capture(label,change=lambda _:None,expected='extracted'):
 tree,node,sink=setup();change((tree,node,sink));before=(len(tree.nodes),len(tree.links),len(bpy.data.node_groups));q=compositor_graph.extract(scene);assert before==(len(tree.nodes),len(tree.links),len(bpy.data.node_groups));assert q['status']==expected,(label,q)
 if expected=='extracted':assert len(q.get('compileTimeViews',[]))>=1
 rows.append({'case':label,'status':q['status'],'diagnostics':q['diagnostics']});return q
q=capture('literal');assert q['output']=={'kind':'constant','type':'RGBA','value':[.125,.25,.5,1]}and not q['ops']
def time_branch(parts,selected=False):
 tree,node,_=parts;time=tree.nodes.new('CompositorNodeSceneTime');tree.links.new(time.outputs['Frame'],node.inputs[0 if selected else 1])
capture('inactive-time',time_branch);capture('selected-time',lambda p:time_branch(p,True),'unsupported')
def reroute(parts):
 tree,node,_=parts;rgb=tree.nodes.new('CompositorNodeRGB');rgb.outputs[0].default_value=(.125,.25,.5,1);route=tree.nodes.new('NodeReroute');tree.links.new(rgb.outputs[0],route.inputs[0]);tree.links.new(route.outputs[0],node.inputs[0])
capture('selected-reroute',reroute)
def group(parts):
 tree,node,_=parts;sub=bpy.data.node_groups.new('Owned selected branch','CompositorNodeTree');sub.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');out=sub.nodes.new('NodeGroupOutput');rgb=sub.nodes.new('CompositorNodeRGB');sub.links.new(rgb.outputs[0],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=sub;tree.links.new(instance.outputs[0],node.inputs[0])
capture('selected-group',group)
def render_pass(parts,info=False):
 tree,node,sink=parts;source=tree.nodes.new('CompositorNodeRLayers');source.layer=bpy.context.view_layer.name;tree.links.new(source.outputs['Image'],node.inputs[0])
 if info:
  metadata=tree.nodes.new('CompositorNodeImageInfo');tree.links.new(node.outputs['Image'],metadata.inputs['Image']);tree.links.new(metadata.outputs['Dimensions'],sink.inputs[0])
q=capture('selected-render-pass',render_pass);assert q['output']['kind']=='ref'and len(q['passes'])==1 and [op['kind']for op in q['ops']]==['render-pass']
q=capture('selected-render-pass-image-info',lambda p:render_pass(p,True));assert sorted(op['kind']for op in q['ops'])==['image-info','render-pass']
def single_info(parts):
 tree,node,sink=parts;info=tree.nodes.new('CompositorNodeImageInfo');tree.links.new(node.outputs['Image'],info.inputs['Image']);tree.links.new(info.outputs['Dimensions'],sink.inputs[0])
capture('single-image-info-stays-unqualified',single_info,'unsupported')

capture('nonmono',lambda p:setattr(scene.render,'use_multiview',True),'unsupported');capture('GPU',lambda p:setattr(scene.render,'compositor_device','GPU'),'unsupported')
def animated(parts):parts[1].inputs[0].keyframe_insert('default_value',frame=1)
capture('animated-owner',animated,'unsupported')
def scene_animated(parts):scene.render.keyframe_insert('use_multiview',frame=1)
capture('animated-scene-view-context',scene_animated,'unsupported');scene.animation_data_clear()
def cycle(parts):parts[0].links.new(parts[1].outputs['Image'],parts[1].inputs[0])
capture('selected-cycle',cycle,'unsupported')
def too_many(parts):
 tree,first,_=parts;current=first
 for i in range(MAX_SELECTIONS):
  another=tree.nodes.new('CompositorNodeSwitchView');tree.links.new(another.outputs['Image'],current.inputs[0]);current=another
capture('chain-budget',too_many,'unsupported')
# Interface contains only enabled views, including renamed identifiers.
for label,rename in [('disabled-first',False),('renamed-first',True)]:
 tree,node,sink=setup();tree.nodes.remove(node);scene.render.views['left'].use=False
 if rename:scene.render.views['right'].name='Artist right'
 node=tree.nodes.new('CompositorNodeSwitchView');node.inputs[0].default_value=(.125,.25,.5,1);tree.links.new(node.outputs['Image'],sink.inputs[0]);q=compositor_graph.extract(scene);assert q['status']=='extracted'and q['compileTimeViews'][0]['selectedInput']==('Artist right'if rename else'right');rows.append({'case':label,'status':q['status']})
 if rename:scene.render.views['Artist right'].name='right'
# Current-context check is named even when a foreign tree has native inputs.
tree,node,sink=setup();other=bpy.data.scenes.new('Owned foreign context')
try:select_mono_view(node,node.outputs[0],other)
except ViewSelectionUnsupported as error:assert 'current explicit mono CPU' in str(error)
else:raise AssertionError('foreign context admitted')
bpy.data.scenes.remove(other)
report={'status':'PASSED_MONO_SWITCH_VIEW_POLICY','cases':len(rows),'rows':rows,'nativeRenders':0,'supportCredit':0};out=Path(os.environ.get('SCENETOWEB_SWITCH_VIEW_POLICY',tempfile.mkdtemp(prefix='switch-view-policy-')));out.mkdir(parents=True,exist_ok=True);(out/'policy.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'])
