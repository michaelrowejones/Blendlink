# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned no-render probe of real World Output engine-target selection."""
from pathlib import Path
import json,os,sys
import bpy
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import export_scene
scene=bpy.context.scene;prior=scene.world;engine=scene.render.engine
world=bpy.data.worlds.new('.SceneToWeb target probe');world.use_nodes=True;scene.world=world;tree=world.node_tree;tree.nodes.clear();rows=[]
try:
 for target in ['ALL','EEVEE','CYCLES']:
  tree.nodes.clear();background=tree.nodes.new('ShaderNodeBackground');output=tree.nodes.new('ShaderNodeOutputWorld');output.target=target;output.is_active_output=True;tree.links.new(background.outputs['Background'],output.inputs['Surface'])
  for render_engine in ['BLENDER_EEVEE','CYCLES']:
   scene.render.engine=render_engine
   selected={name:(tree.get_output_node(name).name if tree.get_output_node(name) else None)for name in ['ALL','EEVEE','CYCLES']}if hasattr(tree,'get_output_node')else None
   classified,reason=export_scene.analyze_authoring_preview_world(scene)
   rows.append({'scenario':'single','outputTarget':target,'isActive':output.is_active_output,'engine':render_engine,'nativeGetOutputNode':selected,'classified':classified,'reason':reason})
 tree.nodes.clear()
 for target in ['ALL','EEVEE','CYCLES']:
  background=tree.nodes.new('ShaderNodeBackground');output=tree.nodes.new('ShaderNodeOutputWorld');output.name='Artist '+target;output.target=target;output.is_active_output=True;tree.links.new(background.outputs['Background'],output.inputs['Surface'])
 rows.append({'scenario':'mixed','actualOutputs':[{'name':n.name,'target':n.target,'active':n.is_active_output}for n in tree.nodes if n.bl_idname=='ShaderNodeOutputWorld'],'nativeGetOutputNode':{name:(tree.get_output_node(name).name if tree.get_output_node(name)else None)for name in ['ALL','EEVEE','CYCLES']}if hasattr(tree,'get_output_node')else None})
finally:scene.world=prior;scene.render.engine=engine;bpy.data.worlds.remove(world)
Path(os.environ['SCENETOWEB_WORLD_TARGET_REPORT']).write_text(json.dumps({'schemaVersion':1,'supportCredit':0,'renders':0,'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'rows':rows},indent=2)+'\n')
