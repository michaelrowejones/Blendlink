# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_VECTOR_TRANSFORM_CONTEXT_PASSED
"""Native Vector Transform contexts and optional actual-scene pixel references."""
import json
import os
import sys
import tempfile
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector

addon = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(addon)); sys.path.insert(0, str(addon.parent / "blendlink/blender"))
import material_compiler as compiler
import vector_transform_ir
import tsl_ir
import bakelib


def unit_check():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    tree = bpy.data.node_groups.new("Native vector transform schema", "ShaderNodeTree")
    node = tree.nodes.new("ShaderNodeVectorTransform")
    node.inputs["Vector"].default_value = (.31, -.43, .57)
    for kind in ("POINT", "VECTOR", "NORMAL"):
        node.vector_type = kind
        for source in ("WORLD", "OBJECT", "CAMERA"):
            node.convert_from = source
            for target in ("WORLD", "OBJECT", "CAMERA"):
                node.convert_to = target
                ir = tsl_ir.emit_output(node, node.outputs[0])
                assert (ir["op"], ir["kind"], ir["from"], ir["to"]) == ("vector_transform", kind, source, target), ir
    node.vector_type = "NORMAL"; node.convert_from = "OBJECT"; node.convert_to = "WORLD"
    node.inputs["Vector"].default_value = (0, 0, 0)
    try: tsl_ir.emit_output(node, node.outputs[0])
    except tsl_ir.TslIrRefusal as error: assert "nonzero" in str(error)
    else: raise AssertionError("Native undefined normal normalization must refuse")
    node.convert_from = node.convert_to = "WORLD"
    with tsl_ir.emission_context(evaluation_engine="CYCLES"):
        assert tsl_ir.emit_output(node, node.outputs[0])["normalDomain"] == "not-normalized"
    with tsl_ir.emission_context(evaluation_engine="EEVEE"):
        try: tsl_ir.emit_output(node, node.outputs[0])
        except tsl_ir.TslIrRefusal as error: assert "nonzero" in str(error)
        else: raise AssertionError("EEVEE normalizes even an identity Normal transform")
    obj = bpy.data.objects.new("Singular vector owner", bpy.data.meshes.new("Singular mesh")); bpy.context.scene.collection.objects.link(obj)
    obj.scale = (0, 1, 1); bpy.context.view_layer.update()
    for kind, source, target in [("POINT", "WORLD", "OBJECT"), ("NORMAL", "OBJECT", "WORLD")]:
        try: vector_transform_ir.validate_owner(obj, [{"kind":kind,"from":source,"to":target}])
        except ValueError as error: assert "invertible" in str(error)
        else: raise AssertionError("Required inverse object matrix was not checked")
    vector_transform_ir.validate_owner(obj, [{"kind":"POINT","from":"OBJECT","to":"WORLD"}])
    print("BLENDLINK_VECTOR_TRANSFORM_CONTEXT_PASSED " + bpy.app.version_string)


def references(directory):
    from bpy_extras.object_utils import world_to_camera_view
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene; scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = 1
    import _cycles
    _cycles.set_device_override("CPU"); bakelib._CYCLES_GPU_BACKENDS = ()
    scene.frame_start, scene.frame_end = 1, 3; scene.render.fps = 24
    scene.render.resolution_x, scene.render.resolution_y = 1024, 512; scene.render.resolution_percentage = 100
    scene.render.use_compositing = False; scene.render.dither_intensity = 0; scene.render.film_transparent = True
    scene.view_settings.view_transform = "Raw"; scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "OPEN_EXR"; scene.render.image_settings.color_mode = "RGBA"; scene.render.image_settings.color_depth = "32"
    if hasattr(scene.cycles, "use_denoising"): scene.cycles.use_denoising = False
    cases = [{"kind":kind,"from":source,"to":target,"scale":.1 if kind == "NORMAL" else .02 if kind == "VECTOR" else .002}
             for kind in ("POINT","VECTOR","NORMAL") for source in ("WORLD","OBJECT","CAMERA") for target in ("WORLD","OBJECT","CAMERA")]
    cases.append({"kind":"CONTROL","from":"NONE","to":"NONE","scale":1})
    vertices, faces = [], []
    for index, case in enumerate(cases):
        col, row = index % 7, index // 7
        x, y = 3 + col * 2, -9 + row * 2
        offset = len(vertices); vertices += [(x,y,.5),(x+2,y,.5),(x+2,y+2,.5),(x,y+2,.5)]
        faces.append(tuple(range(offset, offset+4)))
        case["center"] = [x+1,y+1,.5]; case["name"] = "Vector " + " ".join((case["kind"],case["from"],case["to"]))
    mesh = bpy.data.meshes.new("Noncentered shared vector geometry"); mesh.from_pydata(vertices, [], faces)
    uv = mesh.uv_layers.new(name="UVMap")
    materials, oracles = [], []
    for index, case in enumerate(cases):
        material = bpy.data.materials.new(case["name"]); material.use_nodes = True; tree = material.node_tree; tree.nodes.clear()
        output = tree.nodes.new("ShaderNodeOutputMaterial"); root = tree.nodes.new("ShaderNodeBsdfPrincipled")
        tree.links.new(root.outputs[0], output.inputs["Surface"])
        root.inputs["Metallic"].default_value = 0; root.inputs["Roughness"].default_value = .5
        if case["kind"] == "CONTROL":
            value = tree.nodes.new("ShaderNodeRGB"); value.outputs[0].default_value = (.3333333,.1234567,1.234567,1)
            field = value.outputs[0]
        else:
            transform = tree.nodes.new("ShaderNodeVectorTransform"); transform.vector_type = case["kind"]; transform.convert_from = case["from"]; transform.convert_to = case["to"]
            transform.inputs["Vector"].default_value = (.31,-.43,.57)
            encode = tree.nodes.new("ShaderNodeVectorMath"); encode.operation = "MULTIPLY_ADD"
            encode.inputs[1].default_value = (case["scale"],)*3; encode.inputs[2].default_value = (.5,)*3
            tree.links.new(transform.outputs[0], encode.inputs[0]); field = encode.outputs[0]
        tree.links.new(field, root.inputs["Base Color"]); compiler.set_tsl_ir(material, True)
        mesh.materials.append(material); mesh.polygons[index].material_index = index; materials.append(material)
        for corner, loop_index in enumerate(mesh.polygons[index].loop_indices):
            u,v = [(0,0),(1,0),(1,1),(0,1)][corner]
            uv.data[loop_index].uv = ((index%7+u)/7,(index//7+v)/4)
        oracle = material.copy(); oracle.name = "Private oracle " + case["name"]
        oracle_tree = oracle.node_tree; private_output = next(node for node in oracle_tree.nodes if node.type == "OUTPUT_MATERIAL")
        private_root = next(node for node in oracle_tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
        emission = oracle_tree.nodes.new("ShaderNodeEmission")
        oracle_tree.links.new(private_root.inputs["Base Color"].links[0].from_socket, emission.inputs["Color"])
        oracle_tree.links.new(emission.outputs[0], private_output.inputs["Surface"]); oracles.append(oracle)
    owners = []
    for index in range(2):
        parent = bpy.data.objects.new("Vector Parent " + str(index), None); scene.collection.objects.link(parent)
        parent.location = ((-12,2,1) if index == 0 else (12,-3,2)); parent.scale = (1.4,.8,1.2); parent.rotation_euler = (.15,-.2,.25)
        obj = bpy.data.objects.new("Vector Owner " + str(index), mesh); scene.collection.objects.link(obj); obj.parent = parent
        for frame, location, rotation, scale in [(1,(0,1,.5),(.2,-.1,.3),(-1.1,.7,1.3) if index == 0 else (.9,1.2,.8)),
                                                 (3,(1.5,-.5,1),(-.1,.25,-.15),(-.8,1.1,.9) if index == 0 else (1.2,.8,1.1))]:
            obj.location, obj.rotation_euler, obj.scale = location, rotation, scale
            for path in ("location","rotation_euler","scale"): obj.keyframe_insert(data_path=path, frame=frame)
        obj["blendlink_id"] = "vector-owner-" + str(index); parent["blendlink_id"] = "vector-parent-" + str(index)
        owners.append(obj)
    camera_parent = bpy.data.objects.new("Vector Camera Rig", None); scene.collection.objects.link(camera_parent)
    camera_parent.scale = (1.1,.85,1.25); camera_parent.rotation_euler = (.1,.15,-.2); camera_parent["blendlink_id"] = "vector-camera-rig"
    camera = bpy.data.objects.new("Vector Camera", bpy.data.cameras.new("Vector Camera")); scene.collection.objects.link(camera); camera.parent = camera_parent; scene.camera = camera
    camera.data.type = "ORTHO"; camera.data.ortho_scale = 120; camera.data.clip_start = .01; camera.data.clip_end = 1000
    for frame, location, scale in [(1,(35,-65,55),(-1.2,2,.6)),(3,(30,-60,50),(-.9,1.5,1.3))]:
        camera.location = location; camera.rotation_euler = (Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler(); camera.scale = scale
        for path in ("location","rotation_euler","scale"): camera.keyframe_insert(data_path=path, frame=frame)
    camera["blendlink_id"] = "vector-camera"
    engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
    eevee = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
    source_before = [(material.name,len(material.node_tree.nodes),len(material.node_tree.links)) for material in materials]
    rows = []
    with tempfile.TemporaryDirectory(prefix="vector-reference-") as temporary:
        for engine in ("CYCLES", eevee):
            scene.render.engine = engine
            if engine != "CYCLES": scene.eevee.taa_render_samples = 1
            for frame in (1,3):
                scene.frame_set(frame)
                for owner_index, obj in enumerate(owners):
                    for other in owners: other.hide_render = True
                    private = obj.copy(); private.data = obj.data.copy(); private.name = "Private vector oracle owner"
                    scene.collection.objects.link(private); private.hide_render = False
                    # Clearing a Blender mesh's material list resets every
                    # polygon to slot0. Replace slots in place so each native
                    # transform case remains bound to its actual face.
                    for index,oracle in enumerate(oracles): private.data.materials[index] = oracle
                    assert [polygon.material_index for polygon in private.data.polygons] == list(range(len(cases)))
                    bpy.context.view_layer.update()
                    assert max(abs(a-b) for source_row,private_row in zip(obj.matrix_world,private.matrix_world) for a,b in zip(source_row,private_row)) < 1e-6, "Private native oracle lost its authored owner transform"
                    try:
                        if engine == "CYCLES":
                            raw = np.asarray(bakelib.bake_channel_field_pixels([private],size=128,margin_px=0,uv_layer="UVMap",label="Vector owner reference",allow_hdr=True,view_from="ACTIVE_CAMERA")["pixels"],np.float32).reshape(128,128,3)
                        else:
                            scene.render.filepath = str(Path(temporary)/"native.exr"); bpy.ops.render.render(write_still=True)
                            image = bpy.data.images.load(scene.render.filepath,check_existing=False)
                            raw = np.asarray(image.pixels[:],np.float32).reshape(512,1024,4); bpy.data.images.remove(image)
                        values = []
                        for index,case in enumerate(cases):
                            if engine == "CYCLES": x,y = int((index%7+.5)/7*128),int((index//7+.5)/4*128)
                            else:
                                point = world_to_camera_view(scene,camera,obj.matrix_world @ Vector(case["center"]))
                                x,y = int(point.x*1024),int(point.y*512)
                                assert 0<=x<1024 and 0<=y<512 and raw[y,x,3]>.95,(engine,frame,owner_index,case,point[:])
                            value = raw[y,x,:3].tolist(); assert all(np.isfinite(value)), case
                            if case["kind"] == "CONTROL":
                                assert max(abs(a-b) for a,b in zip(value,(.3333333,.1234567,1.234567))) < (2e-6 if engine == "CYCLES" else .001), "Independent native constant-color calibration failed"
                            values.append(value)
                        rows.append({"engine":engine,"frame":frame,"owner":obj.name,"values":values,
                                     "objectMatrix":[list(row) for row in obj.matrix_world],"cameraMatrix":[list(row) for row in camera.matrix_world]})
                    finally:
                        private_mesh = private.data; bpy.data.objects.remove(private,do_unlink=True); bpy.data.meshes.remove(private_mesh)
                        for other in owners: other.hide_render = False
        for oracle in oracles: bpy.data.materials.remove(oracle)
        for engine in ("CYCLES",eevee):
            scene.render.engine = engine; scene.frame_set(1)
            scene["blendlink_recipe"] = json.dumps({"schemaVersion":1,"presentation":"realtime","atlases":[{"id":"main","name":"Main","size":256,"targetDensity":8,"margin":4,"fitPolicy":"block","bakeOutput":"lighting"}],"states":[{"name":"default"}],"preview":{"samples":1,"supersample":1,"denoise":False,"resolutionScale":1},"final":{"samples":1,"supersample":1,"denoise":False,"resolutionScale":1}})
            path = directory / ("Vector " + ("Cycles" if engine == "CYCLES" else "EEVEE") + ".blend")
            bpy.ops.wm.save_as_mainfile(filepath=str(path))
    assert source_before == [(material.name,len(material.node_tree.nodes),len(material.node_tree.links)) for material in materials]
    assert tuple(mesh.materials) == tuple(materials), "Native oracle changed shared authored material slots"
    (directory/"native-reference.json").write_text(json.dumps({"blender":bpy.app.version_string,"hash":bpy.app.build_hash.decode(),"cases":cases,"owners":[obj.name for obj in owners],"rows":rows},indent=2))
    print("BLENDLINK_VECTOR_TRANSFORM_REFERENCE_PASSED " + bpy.app.version_string)


unit_check()
if os.environ.get("BLENDLINK_VECTOR_TRANSFORM_REFERENCES"): references(os.environ["BLENDLINK_VECTOR_TRANSFORM_REFERENCES"])
