# SPDX-License-Identifier: GPL-3.0-or-later
"""Static axis-aligned Box Mask, evaluated against the pinned CPU F32 profile."""
from array import array
import math
import platform
import struct
import sys
import bpy
if __package__:
    from .compositor_mask_domains import validate_mask_domains
else:
    from compositor_mask_domains import validate_mask_domains

MODEL = 'cpu-f32-axis-integer-intervals-v1'
PROFILE = 'darwin-arm64-53-box-mask-cpu-v1'
OPERATIONS = {'Add': 'ADD', 'Subtract': 'SUBTRACT', 'Multiply': 'MULTIPLY', 'Not': 'NOT'}

def read_box_scalar_words(node):
    """Read existing scalar storage through native copies, without Python promotion.

    Never initialize/modify the original sockets. In particular init_socket is
    not part of this reader. Both private datablocks are removed on all paths.
    """
    private = None
    owner = None
    try:
        private = bpy.data.node_groups.new('.SceneToWeb scalar copy', 'CompositorNodeTree')
        for name in ('Mask', 'Value', 'Rotation'):
            interface = private.interface.new_socket(name=name, in_out='INPUT', socket_type='NodeSocketFloat')
            interface.from_socket(node, node.inputs[name])
        owner = bpy.data.node_groups.new('.SceneToWeb scalar copy owner', 'CompositorNodeTree')
        instance = owner.nodes.new('CompositorNodeGroup')
        instance.node_tree = private
        # from_socket also copies numeric subtypes (Factor/Angle). These share
        # scalar FLOAT RNA storage; unlike the authored Menu-first collection,
        # every element here has the same raw property type and width.
        if len(instance.inputs) != 3 or any(item.type != 'VALUE'
                or item.bl_rna.properties['default_value'].type != 'FLOAT'
                or item.bl_rna.properties['default_value'].is_array for item in instance.inputs):
            raise ValueError('Native scalar copy did not produce three homogeneous Float sockets')
        stored = array('f', [0, 0, 0])
        instance.inputs.foreach_get('default_value', stored)
        return list(struct.unpack('=3I', stored.tobytes()))
    finally:
        if owner is not None:
            bpy.data.node_groups.remove(owner, do_unlink=True)
        if private is not None:
            bpy.data.node_groups.remove(private, do_unlink=True)

def _number(number):
    if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
        return False
    word = struct.unpack('<I', struct.pack('<f', number))[0]
    return word != 0x80000000 and not (0 < (word & 0x7fffffff) < 0x00800000) and struct.unpack('<f', struct.pack('<f', number))[0] == number

def _pair(socket, fail):
    if socket.type != 'VECTOR' or socket.bl_idname != 'NodeSocketVectorFactor2D' or len(socket.default_value) != 2:
        fail(socket, 'Box Mask requires its native two-component Position/Size schema')
    # Public RNA bulk access preserves stored F32 bits even after GPU initialization
    # changes the host's treatment of subnormals during scalar promotion.
    stored = array('f', [0, 0]); socket.default_value.foreach_get(stored)
    words = struct.unpack('=2I', stored.tobytes())
    if any(word == 0x80000000 or 0 < (word & 0x7fffffff) < 0x00800000 for word in words):
        fail(socket, 'Box Mask negative-zero/subnormal stored vector inputs remain unqualified')
    result = list(stored)
    if not all(_number(value) for value in result):
        fail(socket, 'Box Mask requires finite exact normal-or-positive-zero Float32 inputs')
    return result

def normalize_box_mask(node, socket, op, scene, fail):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        fail(socket, 'Box Mask has no qualified CPU source profile for this Blender build/platform')
    if (node.bl_idname != 'CompositorNodeBoxMask' or socket.identifier != 'Mask' or socket.type != 'VALUE'
            or [item.identifier for item in node.inputs] != ['Operation', 'Mask', 'Value', 'Position', 'Size', 'Rotation']):
        fail(socket, 'Box Mask requires its pinned native socket schema')
    if getattr(scene.render, 'compositor_device', None) != 'CPU':
        fail(socket, 'Box Mask currently supports the native CPU compositor only; GPU-authored boundary arithmetic needs independent proof')
    if (scene.render.use_border or scene.render.use_crop_to_border or scene.render.pixel_aspect_x != 1 or scene.render.pixel_aspect_y != 1):
        fail(socket, 'Box Mask requires zero-offset full-frame context domains with square pixels')
    width = scene.render.resolution_x * scene.render.resolution_percentage // 100
    height = scene.render.resolution_y * scene.render.resolution_percentage // 100
    if not (2 <= width <= 8192 and 2 <= height <= 8192):
        fail(socket, 'Box Mask requires physical full-frame extents in [2,8192]')
    if any(item.is_linked for item in node.inputs):
        fail(socket, 'Box Mask currently requires unlinked static literal sockets; field/computed inputs remain unqualified')
    operation = OPERATIONS.get(node.inputs['Operation'].default_value)
    if operation is None:
        fail(socket, 'Box Mask requires Add/Subtract/Multiply/Not')
    position = _pair(node.inputs['Position'], fail); size = _pair(node.inputs['Size'], fail)
    try:
        scalar_words = read_box_scalar_words(node)
    except Exception as error:
        fail(socket, 'Box Mask native raw scalar copy failed: ' + str(error))
    if scalar_words[2] != 0 or any(word == 0x80000000 or 0 < (word & 0x7fffffff) < 0x00800000 for word in scalar_words):
        fail(socket, 'Box Mask requires raw rotation positive zero and no negative-zero/subnormal stored scalar inputs')
    mask, value, rotation = struct.unpack('=3f', struct.pack('=3I', *scalar_words))
    if not all(_number(item) for item in (rotation, mask, value)):
        fail(socket, 'Box Mask requires rotation positive zero and finite normal-or-positive-zero Float32 scalar inputs')
    if (not all(-2 <= item <= 2 for item in position) or not all(0 <= item <= 2 for item in size) or not (0 <= mask <= 1 and 0 <= value <= 1)
            or any(item != 0 and abs(item) < 2**-16 for item in (*position, *size, mask, value))):
        fail(socket, 'Box Mask requires Position[-2,2], Size[0,2], Mask/Value[0,1], each positive/negative component zero or magnitude >=2^-16')
    f32 = lambda number: struct.unpack('<f', struct.pack('<f', number))[0]
    if not all(_number(f32(item/2)) for item in size):
        fail(socket, 'Box Mask subnormal half-size remains unqualified')
    inside = max(mask, value) if operation == 'ADD' else min(1, max(0, f32(mask-value))) if operation == 'SUBTRACT' else f32(mask*value) if operation == 'MULTIPLY' else 0 if mask > 0 else value
    if not _number(inside):
        fail(socket, 'Box Mask subnormal or negative-zero output remains unqualified')
    op['properties'].update(box_mask_model=MODEL, box_mask_source_profile=PROFILE, box_mask_native_version=list(bpy.app.version),
        box_mask_reference_model='full-frame-context-zero-offset-v1', box_mask_precision='CPU_FLOAT32',
        box_mask_scalar_storage='native-interface-copy-f32-v1', box_mask_scalar_words=scalar_words,
        box_mask_literal_model='zero-or-2^-16-bounded-f32-v1',
        box_mask_requested_precision=scene.render.compositor_precision, box_mask_export_extent=[width, height],
        box_mask_operation=operation, box_mask_position=position, box_mask_size=size, box_mask_mask=mask, box_mask_value=value)

def validate_box_mask_graph(result):
    return validate_mask_domains(result, 'CompositorNodeBoxMask')
