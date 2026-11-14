# SPDX-License-Identifier: GPL-3.0-or-later
"""Output-invariant full-roundness regular Radial Segment Width only."""
import math
import platform
import sys
import bpy

MODEL = 'regular-full-roundness-segment-width-v1'
PROFILE = 'darwin-arm64-53-radial-width-v1'


def require_profile(refuse):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        refuse('Radial Tiling Segment Width requires the measured Blender 5.3 macOS arm64 source profile')


def literal_scalar(expression):
    # RNA, Value, reroute and bound group sockets emit this same literal leaf.
    # Do not accept a rounded computation merely because it folds to an integer.
    return expression.get('value') if isinstance(expression, dict) and expression.get('op') == 'const_float' else None


def admitted(sides, roundness):
    return (isinstance(sides, (int, float)) and not isinstance(sides, bool)
            and math.isfinite(sides) and 2 <= sides <= 64 and sides == int(sides)
            and isinstance(roundness, (int, float)) and not isinstance(roundness, bool) and roundness == 1)


def emit_radial_width(node, socket, *, scalar, refuse, evaluation_engine):
    require_profile(refuse)
    if evaluation_engine != 'EEVEE' or bpy.context.preferences.system.gpu_backend != 'METAL':
        refuse('Radial Tiling Segment Width shader source requires the measured EEVEE Metal profile; Cycles uses baking')
    if socket.identifier != 'Segment Width' or socket.type != 'VALUE':
        refuse('Radial Tiling currently qualifies Segment Width only; Coordinates, ID and Rotation require independent branch-domain proof')
    sides, roundness = scalar(node.inputs['Sides']), scalar(node.inputs['Roundness'])
    if not admitted(literal_scalar(sides), literal_scalar(roundness)):
        refuse('Radial Tiling Segment Width requires literal integer Sides2..64 and Roundness exactly1; fractional/rounded branches remain unqualified')
    # Both pinned regular full-roundness evaluators return PI_F / Sides for
    # Width. Vector and Normalize cannot affect this selected output. Prune
    # only this proven output dependency, never arbitrary Radial branches.
    return {'op': 'radial_segment_width', 'model': MODEL, 'sourceProfile': PROFILE,
            'nativeVersion': list(bpy.app.version), 'sourceEngine': 'EEVEE', 'nativeGpuBackend': 'METAL',
            'dependencyModel': 'width-independent-of-vector-and-normalize-v1',
            'sides': sides, 'roundness': roundness}
