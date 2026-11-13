# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only Difference Key controls and measured GPU precision profiles."""
import math


def native_gpu_profile():
    """Actual native context identity; absent context fields stay unknown.

    A software-rendering environment flag or OS is not a renderer certificate.
    Initialize the GPU API when available; failure cannot grant a profile.
    """
    import bpy
    import gpu
    import platform
    import sys
    profile = {'platform': sys.platform, 'architecture': platform.machine(),
               'blenderVersion': list(bpy.app.version), 'blenderHash': bpy.app.build_hash.decode(),
               'requestedBackend': getattr(bpy.context.preferences.system, 'gpu_backend', 'UNKNOWN')}
    # Match Blender's supported context initialization seam. Never infer a
    # profile from requested settings when initialization itself failed.
    try:
        initialize = getattr(gpu, 'init', None)
        if initialize is not None:
            initialize()
    except Exception:
        profile.update({key: None for key in ['renderer', 'vendor', 'version', 'deviceType', 'backend']})
        return profile
    for field, getter in [('renderer', 'renderer_get'), ('vendor', 'vendor_get'), ('version', 'version_get'),
                          ('deviceType', 'device_type_get'), ('backend', 'backend_type_get')]:
        function = getattr(gpu.platform, getter, None)
        try:
            profile[field] = function() if function is not None else None
        except Exception:
            profile[field] = None
    return profile


RNE_MODEL = 'native-difference-key-rne-v1'
UNVERIFIED_GPU_MESSAGE = 'Difference Key GPU OpenGL source precision profile is unverified; use source baking'
# Actual hosted Blender GPU compositor context, not an environment inference.
# The exact renderer/driver/native build remains part of this fresh capability.
MEASURED_RNE_PROFILE = {
    'platform': 'linux', 'architecture': 'x86_64', 'blenderVersion': [5, 2, 0],
    'blenderHash': 'fbe6228777e7', 'requestedBackend': 'OPENGL',
    'renderer': 'llvmpipe (LLVM 20.1.2, 256 bits)', 'vendor': 'Mesa',
    'version': '4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4',
    'deviceType': 'SOFTWARE', 'backend': 'OPENGL',
}


def is_measured_rne_profile(profile):
    if not isinstance(profile, dict) or profile.keys() != MEASURED_RNE_PROFILE.keys():
        return False
    for key, expected in MEASURED_RNE_PROFILE.items():
        actual = profile[key]
        if isinstance(expected, list):
            if not isinstance(actual, list) or len(actual) != len(expected) or any(type(a) is not int or a != b for a, b in zip(actual, expected)):
                return False
        elif not isinstance(actual, str) or actual != expected:
            return False
    return True


def normalize_difference_key(node, socket, op, scene, read, bounds, fail):
    modern = node.inputs.get('Tolerance') is not None
    settings = []
    for name, attribute in [('Tolerance', 'tolerance'), ('Falloff', 'falloff')]:
        incoming = node.inputs.get(name)
        if modern:
            read(incoming)
            interval = bounds(incoming)
            if interval is None or interval[0] != interval[1]:
                fail(incoming, 'Difference Key requires proven fixed scalar Tolerance and Falloff')
            number = interval[0]
        else: number = float(getattr(node, attribute))
        if not math.isfinite(number) or not 0 <= number <= 1:
            fail(incoming or socket, 'Difference Key requires finite Tolerance and Falloff in [0,1]')
        settings.append(number)
    if 0 < settings[1] < 1 / 64:
        fail(socket, 'Difference Key Falloff must be zero or at least 1/64 for live export')
    if socket.identifier not in {'Image', 'Matte'}:
        fail(socket, 'Difference Key requires Image or Matte output')
    op['properties'].update({'difference_key_model': 'native-difference-key-v1',
        'difference_key_schema': 'legacy-cpu' if not modern and getattr(scene.render, 'compositor_device', 'CPU') == 'CPU' else 'modern',
        'difference_key_settings': settings})
    if (getattr(scene.render, 'compositor_device', 'CPU') == 'GPU'
            and op['properties'].get('native_gpu_backend') == 'OPENGL'):
        profile = native_gpu_profile()
        if not is_measured_rne_profile(profile):
            fail(socket, UNVERIFIED_GPU_MESSAGE)
        op['properties']['difference_key_model'] = RNE_MODEL
        op['properties']['difference_key_gpu_profile'] = profile
    for name in ['Image 1', 'Image 2']:
        incoming = node.inputs[name]
        op['inputs'][name] = {'name': name, 'socketType': incoming.type, 'value': read(incoming)}
