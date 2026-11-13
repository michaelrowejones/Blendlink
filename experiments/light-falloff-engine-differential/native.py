"""Independent same-graph EEVEE/Cycles observation; no live-port admission."""
from pathlib import Path
import bpy, hashlib, json, os
import numpy as np

output = Path(os.environ['BLENDLINK_FALLOFF_EVIDENCE']).resolve()
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x = scene.render.resolution_y = 8
scene.render.resolution_percentage = 100
scene.render.use_compositing = False
scene.render.dither_intensity = 0
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '32'
scene.view_settings.view_transform = 'Raw'
scene.view_settings.look = 'None'
scene.world = None
scene.cycles.device = 'CPU'
scene.cycles.samples = 1
scene.cycles.use_denoising = False
import _cycles
_cycles.set_device_override('CPU')
bpy.ops.mesh.primitive_plane_add(size=2)
owner = bpy.context.object
camera_data = bpy.data.cameras.new('Native Falloff Camera')
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2
camera = bpy.data.objects.new('Native Falloff Camera', camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 2)
scene.camera = camera
material = bpy.data.materials.new('Same authored Light Falloff graph')
material.use_nodes = True
owner.data.materials.append(material)
tree = material.node_tree
tree.nodes.clear()
sink = tree.nodes.new('ShaderNodeOutputMaterial')
emit = tree.nodes.new('ShaderNodeEmission')
falloff = tree.nodes.new('ShaderNodeLightFalloff')
falloff.inputs['Strength'].default_value = 2
tree.links.new(emit.outputs[0], sink.inputs['Surface'])
eevee = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in {p.identifier for p in scene.render.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE_NEXT'
rows = []
for smooth in [0, 1]:
    falloff.inputs['Smooth'].default_value = smooth
    for socket in falloff.outputs:
        tree.links.new(socket, emit.inputs['Color'])
        graph = repr([(n.bl_idname, n.name) for n in tree.nodes]) + repr([(l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier) for l in tree.links])
        values = {}
        for engine in [eevee, 'CYCLES']:
            scene.render.engine = engine
            if engine != 'CYCLES': scene.eevee.taa_render_samples = 1
            name = socket.identifier + '-' + str(smooth) + '-' + engine
            path = output / (name + '.exr')
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(str(path), check_existing=False)
            pixels = np.asarray(image.pixels[:], dtype=np.float32).reshape(8, 8, 4)
            bpy.data.images.remove(image)
            assert np.isfinite(pixels).all()
            values[engine] = {'center': pixels[4, 4].tolist(), 'minimum': float(pixels[:, :, :3].min()), 'maximum': float(pixels[:, :, :3].max()), 'exrSha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            assert graph == repr([(n.bl_idname, n.name) for n in tree.nodes]) + repr([(l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier) for l in tree.links])
        rows.append({'output': socket.identifier, 'strength': 2, 'smooth': smooth, 'engines': values})
try:
    import gpu
    gpu_profile = {'backend': gpu.platform.backend_type_get(), 'renderer': gpu.platform.renderer_get(), 'vendor': gpu.platform.vendor_get()}
except Exception as error:
    gpu_profile = {'status': 'SOURCE_ATTESTATION_NA', 'reason': str(error)}
report = {'version': list(bpy.app.version), 'build': bpy.app.build_hash.decode(), 'gpu': gpu_profile, 'cyclesDevice': 'CPU override; not GPU evidence', 'rows': rows, 'graphPreserved': True, 'productionAdmissionCases': 0}
(output / 'observations.json').write_text(json.dumps(report, indent=2))
print('BLENDLINK_LIGHT_FALLOFF_ENGINE_OBSERVATIONS', json.dumps(report))
