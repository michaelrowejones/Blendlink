# SPDX-License-Identifier: GPL-3.0-or-later
"""EEVEE no-height Bump identity, distinct from derivative height sampling."""
if __package__:
    from . import geometry_ir
else:
    import geometry_ir


def emit(node, *, emit_vector, refuse, engine):
    if engine != 'EEVEE':
        refuse('Bump live passthrough currently uses EEVEE; Cycles appearance uses its separate bake route')
    if node.inputs['Height'].is_linked:
        refuse('Bump with a linked Height needs native height-function derivative sampling; only unlinked Height is verified')
    value = emit_vector(node.inputs['Normal']) if node.inputs['Normal'].is_linked else geometry_ir.primary_context('normal', engine)
    # Blender's unlinked-Height branch copies the linked vector verbatim. Do
    # not normalize it, inspect inactive controls or treat linked constants as
    # an unlinked Height input.
    return {"op": "bump_passthrough_native", 'model': 'eevee-no-height-v1',
            'sourceEngine': engine, 'input': value}


def contains(value):
    if isinstance(value, dict):
        return value.get('op') == 'bump_passthrough_native' or any(contains(child) for child in value.values())
    return isinstance(value, (list, tuple)) and any(contains(child) for child in value)


def unit_normal(value):
    if not isinstance(value, dict): return False
    if value.get('op') in {'normal_map_native', 'tangent_native', 'normal_map_tangent_native'}: return True
    if value.get('op') == 'geometry_context': return value.get('output') == 'normal'
    return (value.get('op') == 'bump_passthrough_native' and value.get('model') == 'eevee-no-height-v1'
            and value.get('sourceEngine') == 'EEVEE' and unit_normal(value.get('input')))
