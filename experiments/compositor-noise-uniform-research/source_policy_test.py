# SPDX-License-Identifier: GPL-3.0-or-later
"""Host schema controls only; no bpy/RNA/native numerical or support credit."""
import copy,importlib.util,sys,unittest
from pathlib import Path
from types import SimpleNamespace as NS
ROOT=Path(__file__).resolve().parents[2]
sys.modules['bpy']=NS(app=NS(version=(5,3,0),build_hash=b'02f0899d78e3'))
spec=importlib.util.spec_from_file_location('candidate_noise',ROOT/'packages/blendlink/blender/compositor_noise.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
helper.platform.machine=lambda:'arm64'
helper.sys=NS(platform='darwin')

class Refusal(ValueError):pass

def fixture():
 inputs=[NS(identifier='Vector',type='VECTOR',enabled=True,is_unavailable=False,is_linked=False,links=[])]
 inputs += [NS(identifier=name,type='VALUE',enabled=True,is_unavailable=False,is_linked=False,links=[])for name in helper.DEFAULTS]
 inputs += [NS(identifier='W',type='VALUE',enabled=True,is_unavailable=True,is_linked=False,links=[])]
 node=NS(bl_idname='ShaderNodeTexNoise',mute=False,noise_dimensions='2D',noise_type='FBM',normalize=True,inputs=inputs,as_pointer=lambda:100,id_data=NS(as_pointer=lambda:200),texture_mapping=NS(translation=[0,0,0],rotation=[0,0,0],scale=[1,1,1],use_min=False,use_max=False))
 socket=NS(identifier='Fac',type='VALUE')
 render=NS(use_compositing=True,engine='CYCLES',compositor_device='CPU',compositor_precision='FULL',resolution_x=13,resolution_y=9,resolution_percentage=100,use_border=False,use_crop_to_border=False,pixel_aspect_x=1,pixel_aspect_y=1)
 op={'inputs':{},'properties':{'evaluation_device':'CPU','single_value_device':'CPU'}}
 scene=NS(render=render,compositing_node_group=NS(as_pointer=lambda:17),as_pointer=lambda:1,frame_current=1,frame_subframe=0)
 calls=[];values=list(helper.DEFAULTS.values())
 def raw(sockets,stack):calls.append(([s.identifier for s in sockets],stack));return list(values),[{'node':'Actual source','nodeType':'ShaderNodeTexNoise'}]
 def fail(socket,message):raise Refusal(message)
 def run():helper.normalize_noise(node,socket,op,scene,('instance',),fail,raw)
 return NS(scene=scene,node=node,socket=socket,render=render,op=op,calls=calls,values=values,run=run,raw=raw,fail=fail)

class SourcePolicy(unittest.TestCase):
 def test_original_default_schema_and_copy_order(self):
  for precision in ['AUTO','FULL']:
   f=fixture();f.render.compositor_precision=precision;f.run();self.assertEqual(f.calls,[([*helper.DEFAULTS],('instance',))]);self.assertEqual(f.op['properties']['noise_model'],helper.MODEL);self.assertEqual(f.op['properties']['noise_export_extent'],[13,9]);self.assertEqual(f.op['properties']['noise_requested_precision'],precision)
   self.assertEqual({k:v['value']['value']for k,v in f.op['inputs'].items()},helper.DEFAULTS)
 def test_each_linked_dependency_refuses_before_raw_copy_even_a_linked_default(self):
  for source in ['Vector',*helper.DEFAULTS]:
   f=fixture();next(s for s in f.node.inputs if s.identifier==source).links=[NS(is_valid=True,is_muted=False)]
   with self.assertRaisesRegex(Refusal,'ALL five unlinked'):f.run()
   self.assertEqual(f.calls,[])
 def test_inactive_dependencies_are_not_traversed_but_muted_active_links_refuse(self):
  f=fixture();f.node.inputs[-1].links=[NS(is_valid=True,is_muted=False)];f.run();self.assertEqual(len(f.calls),1)
  for socket_name in ['Vector',*helper.DEFAULTS]:
   f=fixture();next(s for s in f.node.inputs if s.identifier==socket_name).links=[NS(is_valid=True,is_muted=True)]
   with self.assertRaisesRegex(Refusal,'ALL five unlinked'):f.run()
   self.assertEqual(f.calls,[])
 def test_native_modes_and_context_boundaries_refuse(self):
  for target,key,value in [('node','noise_dimensions','3D'),('node','noise_type','RIDGED_MULTIFRACTAL'),('node','normalize',False),('node','mute',True),('render','use_compositing',False),('render','compositor_device','GPU'),('render','compositor_precision','HALF'),('render','use_border',True),('render','use_crop_to_border',True),('render','pixel_aspect_y',2),('render','resolution_x',3),('render','resolution_y',8193)]:
   f=fixture();setattr(getattr(f,target),key,value)
   with self.assertRaises(Refusal):f.run()
   self.assertEqual(f.calls,[])
 def test_native_active_schema_mapping_and_exact_default_values(self):
  for mutation in [lambda f:setattr(f.node.texture_mapping,'use_min',True),lambda f:f.node.inputs.append(NS(identifier='Unknown',type='VALUE',enabled=True,is_unavailable=False,is_linked=False,links=[])),lambda f:setattr(f.socket,'type','RGBA'),lambda f:setattr(f.node.inputs[0],'type','FLOAT_VECTOR2')]:
   f=fixture();mutation(f)
   with self.assertRaises(Refusal):f.run()
   self.assertEqual(f.calls,[])
  for i in range(5):
   for value in [-0.,2**-149,float('inf'),float('nan'),True,.1]:
    f=fixture();f.values[i]=value
    with self.assertRaises(Refusal):f.run()
 def test_raw_policy_refusal_is_named_and_never_becomes_literal_fallback(self):
  f=fixture()
  def unsupported(*args):raise ValueError('raw subnormal/animated source')
  with self.assertRaisesRegex(Refusal,'Noise raw fixed-input source'):helper.normalize_noise(f.node,f.socket,f.op,f.scene,(),f.fail,unsupported)
  self.assertEqual(f.op['inputs'],{})

class GraphPolicy(unittest.TestCase):
 def test_closed_family_source_and_display_cost(self):
  def op(output='Color'):return {'kind':'noise-texture','source':{'output':output},'properties':{'noise_model':helper.MODEL}}
  p={'status':'extracted','ops':[op(),op()],'passes':[]};self.assertIsNone(helper.validate_noise_graph(p));p['ops'].append(op());self.assertRegex(helper.validate_noise_graph(p)[1],'eighteen')
  p['ops']=[op()];p['passes']=[{}];self.assertRegex(helper.validate_noise_graph(p)[1],'scene-pass');p['passes']=[]
  for kind in ['white-noise-texture','wave-texture','box-mask','image-input','render-pass','image-info','flip']:
   p['ops']=[op(),{'kind':kind,'properties':{}}];self.assertRegex(helper.validate_noise_graph(p)[1],'pointwise')
  p['ops']=[op()];presentation={'compositor':p,'display':{'ops':[{'type':'Lut3DTransform'}]*7}};self.assertIsNone(helper.validate_noise_presentation(presentation));presentation['display']['ops'].append({'type':'Lut1DTransform'});self.assertRegex(helper.validate_noise_presentation(presentation)[1],'eight')
 def test_mutation_inside_copy_and_later_source_evaluation_refuses(self):
  f=fixture()
  def mutate(*args):f.node.noise_dimensions='3D';return f.raw(*args)
  with self.assertRaisesRegex(Refusal,'changed during raw'):helper.normalize_noise(f.node,f.socket,f.op,f.scene,(),f.fail,mutate)
  f=fixture();f.run();f.values[-1]=2**-149
  with self.assertRaises(Refusal):f.run()
  f=fixture();f.run();f.render.pixel_aspect_y=2
  with self.assertRaises(Refusal):f.run()

if __name__=='__main__':unittest.main()
