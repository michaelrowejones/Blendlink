# SPDX-License-Identifier: GPL-3.0-or-later
"""A native identity Generator maps a driver value, not the scene timeline."""
from pathlib import Path
import sys
import bpy

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'packages/blender-addon'))
sys.path.insert(0, str(ROOT / 'packages/blendlink/blender'))
import procedural

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
owner = bpy.context.object
owner['Source thickness'] = .2
owner['Driven thickness'] = .2
curve = owner.driver_add('["Driven thickness"]')
variable = curve.driver.variables.new()
variable.name = 'thickness'
variable.type = 'SINGLE_PROP'
variable.targets[0].id = owner
variable.targets[0].data_path = '["Source thickness"]'
curve.driver.expression = 'thickness'
if not curve.modifiers:
    curve.modifiers.new('GENERATOR')
modifier = curve.modifiers[0]
assert modifier.type == 'GENERATOR' and tuple(modifier.coefficients) == (0, 1)

start_frame = bpy.context.scene.frame_current
settings = (modifier.type, modifier.mode, modifier.poly_order, modifier.use_additive,
            tuple(modifier.coefficients), modifier.mute, modifier.influence)
def native_values():
    values = []
    try:
        for frame in (0, 1, 17, 10000):
            bpy.context.scene.frame_set(frame)
            # Arbitrary Python does not declare a depsgraph time dependency.
            # Force evaluation so this probe witnesses its actual result.
            owner.update_tag()
            bpy.context.view_layer.update()
            evaluated = owner.evaluated_get(bpy.context.evaluated_depsgraph_get())
            values.append(float(evaluated['Driven thickness']))
    finally:
        bpy.context.scene.frame_set(start_frame)
    return values

values = native_values()
assert len(set(values)) == 1 and abs(values[0] - .2) < 1e-7, values
assert not procedural._time_dependent_local_geometry(owner), 'Static property became timeline animation'
assert settings == (modifier.type, modifier.mode, modifier.poly_order, modifier.use_additive,
                    tuple(modifier.coefficients), modifier.mute, modifier.influence)

# Non-simple Python can read time without a frame/time name or driver target.
# Keep this private fixture's namespace and script permission state unchanged.
namespace_key = 'blendlink_read_current_frame'
missing = object()
previous_namespace = bpy.app.driver_namespace.get(namespace_key, missing)
previous_autoexec = bpy.context.preferences.filepaths.use_scripts_auto_execute
try:
    bpy.context.preferences.filepaths.use_scripts_auto_execute = True
    bpy.app.driver_namespace[namespace_key] = lambda: bpy.context.scene.frame_current
    for expression in ('bpy.context.scene.frame_current', namespace_key + '()'):
        curve.driver.expression = expression
        assert not curve.driver.is_simple_expression, expression
        observed = native_values()
        assert observed == [0, 1, 17, 10000], (expression, observed)
        assert curve.driver.is_valid, expression
        assert procedural._time_dependent_local_geometry(owner), expression
        # The same unknown Python escape is unsafe without any modifier too.
        modifier.mute = True
        assert procedural._time_dependent_local_geometry(owner), expression
        modifier.mute = False
    curve.driver.expression = 'sin(0.5)'
    assert curve.driver.is_simple_expression
    assert len(set(native_values())) == 1
    assert not procedural._time_dependent_local_geometry(owner)
finally:
    curve.driver.expression = 'thickness'
    bpy.context.preferences.filepaths.use_scripts_auto_execute = previous_autoexec
    if previous_namespace is missing:
        bpy.app.driver_namespace.pop(namespace_key, None)
    else:
        bpy.app.driver_namespace[namespace_key] = previous_namespace

# Non-scripted drivers ignore their dormant Python expression. A conservative
# SCRIPTED guard must not turn ordinary static variable aggregation into time.
try:
    curve.driver.expression = 'bpy.context.scene.frame_current'
    for driver_type in ('SUM', 'AVERAGE'):
        curve.driver.type = driver_type
        assert not curve.driver.is_simple_expression
        assert len(set(native_values())) == 1
        assert not procedural._time_dependent_local_geometry(owner), driver_type
finally:
    curve.driver.type = 'SCRIPTED'
    curve.driver.expression = 'thickness'

# The same identity modifier must not hide actual frame or property animation.
curve.driver.expression = 'frame'
assert len(set(native_values())) == 4
assert procedural._time_dependent_local_geometry(owner)
curve.driver.expression = 'thickness'
owner.keyframe_insert(data_path='["Source thickness"]', frame=1)
owner['Source thickness'] = .4
owner.keyframe_insert(data_path='["Source thickness"]', frame=17)
assert procedural._time_dependent_local_geometry(owner)
owner.animation_data.action = None

# Unknown/nonidentity mappings remain conservative rather than extending this proof.
modifier.coefficients = (.125, 2)
assert procedural._time_dependent_local_geometry(owner)
modifier.mute = True
assert not procedural._time_dependent_local_geometry(owner)
print('BLENDLINK_DRIVER_STATIC_MODIFIER_PASSED', bpy.app.version_string)
