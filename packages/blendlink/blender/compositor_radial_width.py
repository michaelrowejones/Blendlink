# SPDX-License-Identifier: GPL-3.0-or-later
"""Regular full-roundness Radial Width; independent of the Vector domain."""
import platform
import sys
import bpy

MODEL = 'regular-full-roundness-segment-width-v1'
PROFILE = 'darwin-arm64-53-radial-width-v1'


def normalize_radial_width(node, socket, op, read, operations, fail, literal):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        fail(socket, 'Radial Tiling Segment Width requires the measured Blender 5.3 macOS arm64 source profile')
    if socket.identifier != 'Segment Width' or socket.type != 'VALUE':
        fail(socket, 'Radial Tiling currently qualifies Segment Width only; Coordinates, ID and Rotation require independent branch-domain proof')
    if op['properties'].get('evaluation_device') not in {'CPU', 'GPU'} or op['properties'].get('single_value_device') != 'CPU':
        fail(socket, 'Radial Tiling Segment Width requires the modern compositor CPU single-value evaluator')
    if op['properties'].get('evaluation_device') == 'GPU' and op['properties'].get('native_gpu_backend') != 'METAL':
        fail(socket, 'Radial Tiling Segment Width GPU source requires measured native Metal staging')
    values = {}
    for name in ['Sides', 'Roundness']:
        incoming = read(node.inputs[name]); values[name] = literal(incoming, operations, 'VALUE')
        op['inputs'][name] = {'name': name, 'socketType': 'VALUE', 'value': incoming}
    sides, roundness = values['Sides'], values['Roundness']
    if sides is None or not 2 <= sides <= 64 or sides != int(sides) or roundness != 1:
        fail(socket, 'Radial Tiling Segment Width requires literal integer Sides2..64 and Roundness exactly1; fractional/rounded branches remain unqualified')
    # Vector is not read by either native regular/full-roundness Width output.
    # Keeping it out of IR preserves that real output dependency; it is not a
    # substituted Image Coordinates producer or a sampled/baked result.
    op['properties'].update(radial_width_model=MODEL, radial_width_profile=PROFILE,
                            radial_width_version=list(bpy.app.version),
                            radial_width_dependency='width-independent-of-vector-and-normalize-v1')
