"""Research only: can an owned empty scene attest 4.2 GPU without source edits?"""
import bpy, gpu, json, time
bpy.ops.wm.read_factory_settings(use_empty=True)
original = bpy.context.scene
original.render.engine = 'BLENDER_EEVEE_NEXT'
original['artist_owned'] = 'unchanged'
bpy.ops.mesh.primitive_cube_add()
owner = bpy.context.object
owner.location = (1, 2, 3)
owner['artist_owned'] = 'unchanged'
def state():
    return (bpy.context.scene.as_pointer(), bpy.context.view_layer.objects.active.as_pointer(),
        tuple(o.as_pointer() for o in bpy.context.selected_objects), tuple(owner.location),
        tuple((k, repr(v)) for k, v in original.items()), original.render.engine,
        original.render.resolution_x, original.render.resolution_y,
        tuple((name, tuple(x.as_pointer() for x in getattr(bpy.data, name))) for name in ['objects', 'meshes', 'scenes', 'cameras', 'materials', 'images']))
def platform():
    try: return {'backend':gpu.platform.backend_type_get(), 'renderer':gpu.platform.renderer_get(), 'vendor':gpu.platform.vendor_get()}
    except Exception as error: return {'error':str(error)}
before = state()
start_platform = platform()
assert bpy.data.images.get('Render Result') is None
temporary = bpy.data.scenes.new('Owned empty context probe')
camera_data = bpy.data.cameras.new('Owned context camera')
camera = bpy.data.objects.new('Owned context camera', camera_data)
temporary.collection.objects.link(camera)
temporary.camera = camera
temporary.render.engine = 'BLENDER_EEVEE_NEXT'
temporary.eevee.taa_render_samples = 1
temporary.render.resolution_x = temporary.render.resolution_y = 1
temporary.render.resolution_percentage = 100
temporary.render.use_compositing = False
temporary.camera = None
render_error = None
started = time.perf_counter()
try:
    try:
        bpy.ops.render.render(scene=temporary.name, write_still=False)
    except RuntimeError as error:
        render_error = str(error)
    assert render_error and 'camera' in render_error.lower(), render_error
    end_platform = platform()
finally:
    if bpy.context.window is not None: bpy.context.window.scene = original
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)
    bpy.data.scenes.remove(temporary)
    result = bpy.data.images.get('Render Result')
    if result is not None: bpy.data.images.remove(result)
elapsed = (time.perf_counter() - started) * 1000
assert state() == before, (before, state())
assert platform() == end_platform
print('BLENDLINK_42_CONTEXT_RESEARCH', json.dumps({'before':start_platform,'after':end_platform,'milliseconds':elapsed,'sourceStateAndDatablocksPreserved':True,'nativeFailure':render_error,'productionAdmissionCases':0}))
