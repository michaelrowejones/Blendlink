# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only warnings for authored camera optics without a web translation."""


def depth_of_field_warning(scene, *, explicit_website_effect=False):
    camera = scene.camera
    if camera is None or camera.type != 'CAMERA' or not camera.data.dof.use_dof:
        return None
    data = camera.data
    dof = data.dof
    target = dof.focus_object
    focus = (f'object "{target.name}"' if target is not None
             else f'{dof.focus_distance:g} Blender units')
    if target is not None and dof.focus_subtarget:
        focus += f', bone "{dof.focus_subtarget}"'
    problem = (f'Active Blender camera "{camera.name}" uses depth of field '
               f'({data.lens:g} mm, f/{dof.aperture_fstop:g}, focus {focus}). '
               'Its native focus, lens and aperture are not automatically translated; '
               'the website may appear sharp or blur differently.')
    if explicit_website_effect:
        problem += (' An enabled website Depth of Field effect is present, but its '
                    'independent settings do not establish Blender optics parity.')
    fix = ('For an intentional web approximation, manually tune the separate Preview Depth of Field scene effect with a perspective '
           'website camera, then compare Preview and Final; it is not a qualified Blender DOF port. Its focus range/blur strength '
           'do not map directly to Blender lens/f-stop, and transparent surfaces may differ. '
           'For an intentionally sharp website, disable camera DOF in Blender and compare again.')
    return {
        'code': 'camera.depth-of-field-untransported', 'severity': 'WARNING',
        'camera': camera.name, 'problem': problem, 'fix': fix,
        'message': problem + ' ' + fix,
        'source': {
            'frame': scene.frame_current, 'cameraType': data.type,
            'lensMillimeters': float(data.lens), 'sensorFit': data.sensor_fit,
            'sensorWidthMillimeters': float(data.sensor_width),
            'sensorHeightMillimeters': float(data.sensor_height),
            'apertureFStop': float(dof.aperture_fstop),
            'apertureBlades': int(dof.aperture_blades),
            'apertureRotationRadians': float(dof.aperture_rotation),
            'apertureRatio': float(dof.aperture_ratio),
            'focusDistanceBlenderUnits': float(dof.focus_distance),
            'focusObject': target.name if target is not None else None,
            'focusBone': dof.focus_subtarget,
        },
        'explicitWebsiteEffectPresent': bool(explicit_website_effect),
        'nativeOpticsTranslated': False, 'equivalenceClaim': False,
    }
