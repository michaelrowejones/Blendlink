# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires the pinned Blender5.3 source-addon curve/preview context; run the focused guarded import regression before the current-version union build.
# blendlink-headless-sentinel: BLENDLINK_SOURCE_ADDON_IMPORT_PASSED
"""Real source-addon registration and preview material planning, no rendering."""
import importlib.util
import json
from pathlib import Path
import sys
import bpy

if tuple(bpy.app.version) != (5, 3, 0):
    raise SystemExit('Source-addon curve preview import regression requires Blender5.3.0; other-version loader support is unchanged and not qualified by this focused test')

ROOT=Path(__file__).resolve().parents[3]
ADDON=ROOT/'packages/blender-addon'
BACKEND=ROOT/'packages/blendlink/blender'
PACKAGE='blendlink_addon'
paths_before=tuple(sys.path)
bare_names={'bakelib','uvgeometry','compositor_graph','compositor_map_value','compositor_map_value_domain'}
bare_before={name:sys.modules.get(name)for name in bare_names}
rows=[]
for cycle in range(2):
    spec=importlib.util.spec_from_file_location(PACKAGE,ADDON/'__init__.py',submodule_search_locations=[str(ADDON)])
    addon=importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE]=addon
    registered=False
    material=None
    mesh=None
    obj=None
    try:
        spec.loader.exec_module(addon)
        addon.register()
        registered=True
        assert all(cls.is_registered for cls in addon._classes)
        assert tuple(sys.path)==paths_before,'Source loader must not inject bare-module search paths'
        material=bpy.data.materials.new('Owned Source Curve Import '+str(cycle))
        material.use_nodes=True
        tree=material.node_tree
        bsdf=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled')
        curve=tree.nodes.new('ShaderNodeRGBCurve')
        curve.inputs['Color'].default_value=(.25,.5,.75,1)
        tree.links.new(curve.outputs['Color'],bsdf.inputs['Base Color'])
        ir=sys.modules[PACKAGE+'.tsl_ir']
        document=ir.emit_channel(bsdf.inputs['Base Color'],evaluation_engine='EEVEE')
        assert document['output']['op']=='curve_native',document
        graph=sys.modules[PACKAGE+'.compositor_graph']
        domain=sys.modules[PACKAGE+'.compositor_map_value_domain']
        assert Path(graph.__file__).resolve()==(BACKEND/'compositor_graph.py').resolve()
        assert Path(domain.__file__).resolve()==(BACKEND/'compositor_map_value_domain.py').resolve()
        # Use the real preview planning entrypoint, not just an artificial helper import.
        mesh=bpy.data.meshes.new('Owned Source Preview Mesh '+str(cycle))
        mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)])
        obj=bpy.data.objects.new('Owned Source Preview Object '+str(cycle),mesh)
        bpy.context.scene.collection.objects.link(obj)
        mesh.materials.append(material)
        compiler=sys.modules[PACKAGE+'.material_compiler']
        plan=compiler.plan_materials([obj],purpose='preview',automatic_programs=True)
        assert len(plan.decisions)==1
        decision=plan.decisions[0]
        assert decision.outcome=='lowered',(decision.outcome,[issue.message for issue in decision.issues])
        assert decision.channel_plan and 'curve_native' in json.dumps(decision.channel_plan)
        assert {name:sys.modules.get(name)for name in bare_names}==bare_before,'Canonical helpers leaked bare cache entries'
        rows.append({'cycle':cycle,'registeredClasses':len(addon._classes),'sourceModule':graph.__file__,'transitiveModule':domain.__file__,'previewOutcome':decision.outcome,'curveOp':document['output']['op']})
    finally:
        if registered:
            classes=addon._classes
            addon.unregister()
            assert not any(getattr(cls,'is_registered',False)for cls in classes)
        if obj:bpy.data.objects.remove(obj,do_unlink=True)
        if mesh:bpy.data.meshes.remove(mesh)
        if material:bpy.data.materials.remove(material)
        for name in list(sys.modules):
            if name==PACKAGE or name.startswith(PACKAGE+'.'):
                del sys.modules[name]
assert tuple(sys.path)==paths_before
assert {name:sys.modules.get(name)for name in bare_names}==bare_before
print('BLENDLINK_SOURCE_ADDON_IMPORT_PASSED '+json.dumps({'cycles':rows,'sourceRestored':True,'renderCalls':0,'bakeCalls':0}))
