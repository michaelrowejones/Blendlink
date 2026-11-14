# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Focused pinned Blender5.3 World source classification and presentation ownership regression; no renders.
# blendlink-headless-sentinel: BLENDLINK_WORLD_BACKGROUND_POLICY_PASSED
"""Native direct World Surface classification; Volume never becomes a color."""
from pathlib import Path
import sys
import bpy
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import export_scene as exporter
assert Path(exporter.__file__).resolve()==ROOT/'packages/blendlink/blender/export_scene.py'
assert tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
scene=bpy.context.scene;prior=scene.world;transparent=scene.render.film_transparent;engine=scene.render.engine
before=(len(bpy.data.worlds),len(bpy.data.node_groups),bpy.context.view_layer.objects.active,tuple(bpy.context.selected_objects))
world=bpy.data.worlds.new('.SceneToWeb World policy');world.use_nodes=True
try:
    scene.world=world;scene.render.engine='BLENDER_EEVEE';tree=world.node_tree;tree.nodes.clear()
    output=tree.nodes.new('ShaderNodeOutputWorld');background=tree.nodes.new('ShaderNodeBackground')
    background.inputs['Color'].default_value=(.125,.25,.5,1);background.inputs['Strength'].default_value=2.75
    surface=tree.links.new(background.outputs['Background'],output.inputs['Surface'])
    expected={'color':[.125,.25,.5],'strength':2.75,'exact':True,'source':'background'}
    assert exporter.analyze_authoring_preview_world(scene)==(expected,None)
    # An inactive volume node has no contribution. The actual selected output
    # link, rather than mere presence of a node, is the rejection boundary.
    absorption=tree.nodes.new('ShaderNodeVolumeAbsorption');absorption.inputs['Density'].default_value=.25
    assert exporter.analyze_authoring_preview_world(scene)==(expected,None)
    volume=tree.links.new(absorption.outputs['Volume'],output.inputs['Volume'])
    value,reason=exporter.analyze_authoring_preview_world(scene)
    assert value is None and 'World Volume is connected' in reason
    scene.render.film_transparent=False
    preview=exporter.collect_authoring_preview(scene)
    assert 'world' not in preview and 'World Volume is connected' in preview['worldWarning']
    assert exporter.authoring_preview_warning_messages(preview,None)
    scene.render.film_transparent=True;preview=exporter.collect_authoring_preview(scene)
    assert 'world' not in preview and preview['worldBackgroundVisible'] is False
    owned={'look':{'toneMapping':'none','background':'color'},'environment':{'source':'image','lighting':'image','background':'image'}}
    assert exporter.authoring_preview_warning_messages(preview,owned)==[]
    tree.links.remove(volume)
    visible=exporter.collect_authoring_preview(scene)
    assert visible['world']=={**expected,'backgroundVisible':False}
    scene.render.film_transparent=False
    assert exporter.collect_authoring_preview(scene)['world']['backgroundVisible'] is True
    value_node=tree.nodes.new('ShaderNodeValue');linked=tree.links.new(value_node.outputs['Value'],background.inputs['Strength'])
    assert exporter.analyze_authoring_preview_world(scene)[0] is None and 'Strength is linked' in exporter.analyze_authoring_preview_world(scene)[1]
    tree.links.remove(linked);background.mute=True
    assert exporter.analyze_authoring_preview_world(scene)[0] is None
    background.mute=False;assert exporter.analyze_authoring_preview_world(scene)==(expected,None)
    # Native target selection, not a guessed is_active_output filter.
    output.target='CYCLES'
    assert exporter.analyze_authoring_preview_world(scene)[0] is None
    scene.render.engine='CYCLES';assert exporter.analyze_authoring_preview_world(scene)==(expected,None)
    output.target='EEVEE';assert exporter.analyze_authoring_preview_world(scene)[0] is None
    scene.render.engine='BLENDER_EEVEE';assert exporter.analyze_authoring_preview_world(scene)==(expected,None)
    output.target='ALL';assert exporter.analyze_authoring_preview_world(scene)==(expected,None)
    alternate=tree.nodes.new('ShaderNodeOutputWorld');alternate.target='CYCLES';alternate.is_active_output=True
    alternate_background=tree.nodes.new('ShaderNodeBackground');alternate_background.inputs['Color'].default_value=(.75,.5,.25,1)
    tree.links.new(alternate_background.outputs['Background'],alternate.inputs['Surface'])
    assert not output.is_active_output and alternate.is_active_output
    assert tree.get_output_node('EEVEE')==output
    assert exporter.analyze_authoring_preview_world(scene)==(expected,None)
    scene.render.engine='CYCLES'
    assert exporter.analyze_authoring_preview_world(scene)[0]['color']==[.75,.5,.25]
    tree.links.new(absorption.outputs['Volume'],alternate.inputs['Volume'])
    assert exporter.analyze_authoring_preview_world(scene)[0] is None
    scene.render.engine='BLENDER_EEVEE';assert exporter.analyze_authoring_preview_world(scene)==(expected,None)
    # World Output declares no_muting; actual RNA refuses an authored mute.
    output.mute=True;assert output.mute is False
    assert exporter.analyze_authoring_preview_world(scene)==(expected,None)
    scene.render.engine='BLENDER_WORKBENCH';assert exporter.analyze_authoring_preview_world(scene)[0] is None
finally:
    scene.world=prior;scene.render.film_transparent=transparent;scene.render.engine=engine;bpy.data.worlds.remove(world)
assert before==(len(bpy.data.worlds),len(bpy.data.node_groups),bpy.context.view_layer.objects.active,tuple(bpy.context.selected_objects))
print('BLENDLINK_WORLD_BACKGROUND_POLICY_PASSED')
