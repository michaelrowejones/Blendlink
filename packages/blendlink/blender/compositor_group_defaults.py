# SPDX-License-Identifier: GPL-3.0-or-later
"""Native 5.3 compositor group-edge schema; no implicit-input evaluation."""
import bpy

MAX_INTERFACE_ITEMS = 256

class GroupDefaultUnsupported(ValueError):
    pass


def _applies(node):
    return tuple(bpy.app.version)[:2] == (5, 3) and node.bl_idname == 'CompositorNodeGroup'


def interface_signature(node):
    """Flat bounded interface snapshot, including defaults not stored on sockets."""
    if not _applies(node):
        return None
    tree = node.node_tree
    if tree is None or tree.bl_idname != 'CompositorNodeTree':
        raise GroupDefaultUnsupported('Compositor group has no native compositor interface')
    items = tree.interface.items_tree
    if len(items) > MAX_INTERFACE_ITEMS:
        raise GroupDefaultUnsupported('Compositor group exceeds256 interface items')
    return tuple((item.as_pointer(), item.identifier, item.in_out, item.socket_type,
                  getattr(item, 'default_input', None), getattr(item, 'structure_type', None))
                 for item in items if item.item_type == 'SOCKET')


def validate_input(socket):
    """Check an actual used input; links override implicit defaults, not schema."""
    node = socket.node
    if not _applies(node):
        return
    interface_signature(node)
    if socket.is_output:
        raise GroupDefaultUnsupported('Compositor group input direction changed')
    matches = [item for item in node.node_tree.interface.items_tree
               if item.item_type == 'SOCKET' and item.in_out == 'INPUT'
               and item.identifier == socket.identifier]
    if len(matches) != 1:
        raise GroupDefaultUnsupported('Compositor group input has no unique native interface binding')
    item = matches[0]
    # Native RNA sockets with UI subtypes still share their base interface type.
    bases = {'VALUE': 'NodeSocketFloat', 'INT': 'NodeSocketInt', 'BOOLEAN': 'NodeSocketBool',
             'VECTOR': 'NodeSocketVector', 'RGBA': 'NodeSocketColor', 'STRING': 'NodeSocketString',
             'MENU': 'NodeSocketMenu', 'MATRIX': 'NodeSocketMatrix', 'ROTATION': 'NodeSocketRotation',
             'INT_VECTOR': 'NodeSocketIntVector'}
    if item.socket_type not in {socket.bl_idname, bases.get(socket.type)}:
        raise GroupDefaultUnsupported('Compositor group input interface type changed')
    if getattr(item, 'structure_type', None) not in {'AUTO', 'SINGLE'}:
        raise GroupDefaultUnsupported('Compositor group input structure is not a qualified AUTO/SINGLE value')
    linked = any(link.is_valid and not getattr(link, 'is_muted', False) for link in socket.links)
    if not linked and getattr(item, 'default_input', None) != 'VALUE':
        raise GroupDefaultUnsupported('Compositor group implicit default is not a qualified literal VALUE')
