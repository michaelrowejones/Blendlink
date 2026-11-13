# SPDX-License-Identifier: GPL-3.0-or-later
"""Discover the native vector-width boundary; grants zero numerical coverage."""
import hashlib
import json
from pathlib import Path
import sys
import bpy

root = Path(__file__).resolve().parents[2]
tree = bpy.data.node_groups.new('Vector Width Discovery', 'CompositorNodeTree')
report = {'kind': 'scenetoweb-vector-width-discovery-v1', 'blenderVersion': list(bpy.app.version),
          'blenderBuildHash': bpy.app.build_hash.decode(), 'numericalCases': 0,
          'sourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'nodes': {}, 'groupInterface': {}}
for identifier in ['CompositorNodeImageCoordinates', 'CompositorNodeRelativeToPixel']:
    node = tree.nodes.new(identifier)
    schemas = []
    for settings in ([{}] if identifier == 'CompositorNodeImageCoordinates' else
                     [{'data_type': 'VECTOR', 'reference_dimension': 'PER_DIMENSION'},
                      {'data_type': 'FLOAT', 'reference_dimension': 'PER_DIMENSION'}]):
        for name, value in settings.items():
            setattr(node, name, value)
        schemas.append({'settings': settings, 'sockets': [
            {'direction': direction, 'identifier': socket.identifier, 'nativeType': socket.type,
             'socketClass': socket.bl_rna.identifier,
             'default': list(socket.default_value) if socket.type in {'VECTOR', 'INT_VECTOR'}
                        else socket.default_value if socket.type == 'VALUE' else None,
             'enabled': socket.enabled}
            for direction, sockets in [('INPUT', node.inputs), ('OUTPUT', node.outputs)] for socket in sockets]})
    report['nodes'][identifier] = schemas
for identifier in ['NodeSocketVector2D', 'NodeSocketIntVector2D']:
    try:
        socket = tree.interface.new_socket(name=identifier, in_out='INPUT', socket_type=identifier)
        report['groupInterface'][identifier] = {'accepted': True, 'nativeClass': socket.bl_rna.identifier}
    except (TypeError, RuntimeError) as error:
        report['groupInterface'][identifier] = {'accepted': False, 'error': str(error)}
report['conclusion'] = ('Native float2/int2 socket widths must remain distinct from legacy VECTOR float3. '
    'Public group interfaces reject the two-component socket classes on this build. '
    'Qualify node-output field widths and each native conversion edge before Image Coordinates; '
    'Relative To Pixel vector defaults are a possible bounded native entrypoint. No port is promoted.')
output = Path(sys.argv[sys.argv.index('--') + 1]).resolve() if '--' in sys.argv else root / 'artifacts/verification-vector-width/discovery.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + '\n')
print('SCENETOWEB_VECTOR_WIDTH_DISCOVERY_READY ' + str(output))
