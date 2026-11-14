# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned CPU mono Switch View: transparent selection, never a view runtime."""
import platform
import sys
import bpy

MODEL = 'native-mono-switch-view-cpu-53-v1'
NODES = {'CompositorNodeSwitchView'}
MAX_INPUTS = 64
MAX_SELECTIONS = 64

class ViewSelectionUnsupported(ValueError):
    pass

def select_mono_view(node, output, scene):
    if (tuple(bpy.app.version)!=(5,3,0) or bpy.app.build_hash!=b'02f0899d78e3'
            or sys.platform!='darwin' or platform.machine()!='arm64'):
        raise ViewSelectionUnsupported('Switch View has no qualified mono CPU source profile for this Blender build/platform')
    if bpy.context.scene!=scene or scene.render.compositor_device!='CPU' or scene.render.use_multiview:
        raise ViewSelectionUnsupported('Switch View requires the current explicit mono CPU compositor context; named/stereo views are unqualified')
    animation=scene.animation_data
    if animation and (animation.action or len(animation.drivers) or len(animation.nla_tracks)):
        raise ViewSelectionUnsupported('Switch View requires a static scene view configuration; scene animation, drivers and NLA need live view selection')
    if (node.bl_idname not in NODES or node.id_data.bl_idname!='CompositorNodeTree'
            or len(node.outputs)!=1 or node.outputs[0]!=output or not output.is_output
            or output.identifier!='Image' or output.type!='RGBA' or not output.enabled or output.is_unavailable):
        raise ViewSelectionUnsupported('Switch View native RGBA Image output schema changed')
    count=len(node.inputs)
    if not 1<=count<=MAX_INPUTS:
        raise ViewSelectionUnsupported('Switch View requires one to64 actual native view inputs')
    identifiers=tuple(socket.identifier for socket in node.inputs)
    if (any(not name for name in identifiers) or len(set(identifiers))!=count
            or any(socket.type!='RGBA' or not socket.enabled or socket.is_unavailable for socket in node.inputs)):
        raise ViewSelectionUnsupported('Switch View ordered native RGBA view input schema is stale or unqualified')
    selected=node.inputs[0]
    # The hidden native Scene ID has no RNA property. Its view list must never
    # be guessed from another owner: empty native view context uses input0.
    metadata={'model':MODEL,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),
              'sourceContext':'current-mono-CPU','sourceScene':scene.name_full,
              'selectedInput':selected.identifier,'inputIdentifiers':list(identifiers),
              'selectionKind':'actual-native-input0','preservesSelectedDomain':True}
    return {'input':selected,'metadata':metadata}

def selection_snapshot(node, output, scene):
    selected=select_mono_view(node,output,scene)
    socket=selected['input']
    links=tuple((link.as_pointer(),link.from_socket.as_pointer(),link.to_socket.as_pointer(),link.is_valid,getattr(link,'is_muted',False))for link in socket.links)
    literal=None if links else tuple(socket.default_value)
    return (node.as_pointer(),node.id_data.as_pointer(),output.as_pointer(),socket.as_pointer(),links,literal,selected['metadata'])
