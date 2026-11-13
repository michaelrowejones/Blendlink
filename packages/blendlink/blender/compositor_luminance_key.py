# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only, bounded luminance-key thresholds and source schema."""
import math
import struct
import platform
import sys

import bpy


def _cpu_coefficients():
    if __package__:
        from .source_presentation import config_from_install
    else:
        from source_presentation import config_from_install
    config, _path = config_from_install()
    return [struct.unpack('f', struct.pack('f', value))[0] for value in config.getDefaultLumaCoefs()]


def _cpu_profile():
    """Read actual Float32 underflow/input/RNE mode, never infer it from version."""
    import numpy as np
    def words(values):
        return np.asarray(values, np.uint32).view(np.float32)
    with np.errstate(all='ignore'):
        underflow = int(np.multiply(words([0x00800000]), words([0x3f000000])).view(np.uint32)[0])
        denormal = int(np.multiply(words([0x00400000]), words([0x40000000])).view(np.uint32)[0])
        ties = np.add(words([0x3f800000, 0x3f800001]), words([0x33800000, 0x33800000])).view(np.uint32).tolist()
    mode = ('gradual-rne' if (underflow, denormal) == (0x00400000, 0x00800000)
            else 'ftz-daz-rne' if (underflow, denormal) == (0, 0) else None)
    if mode is None or ties != [0x3f800000, 0x3f800002]:
        raise ValueError(f'unmeasured Float32 underflow/input/rounding combination: underflow={underflow:#x}, input={denormal:#x}, ties={ties}, platform={sys.platform}/{platform.machine()}')
    return {'schemaVersion': 1, 'mode': mode, 'underflowWord': underflow,
        'denormalInputWord': denormal, 'tieWords': ties,
        'sourcePlatform': sys.platform, 'sourceArchitecture': platform.machine()}


# Exact Linux binary qualified by retained native production-path receipts.
_LINUX52_BUILD = 'fbe6228777e7'
# Actual win32/AMD64 native trial packets, not hashes inferred from another OS.
# These remain admission candidates until the untouched production path passes.
_WINDOWS_BUILDS = {(4, 2, 0): 'a51f293548ad', (5, 2, 0): 'fbe6228777e7'}


def _cpu_source_allowed(version, source_platform, architecture, build_hash):
    if source_platform == 'darwin' and architecture == 'arm64':
        return version in {(4, 2, 0), (5, 2, 0), (5, 3, 0)}
    if source_platform == 'win32':
        return architecture == 'AMD64' and version in _WINDOWS_BUILDS and _WINDOWS_BUILDS[version] == build_hash
    return (version == (5, 2, 0) and source_platform == 'linux'
        and architecture == 'x86_64' and build_hash == _LINUX52_BUILD)


def normalize_luminance_key(node, socket, op, scene, read, bounds, fail, single=None):
    if socket.identifier not in {"Image", "Matte"}:
        fail(socket, "Luminance Key requires Image or Matte output")
    modern = node.inputs.get("Minimum") is not None
    limits = []
    for name, attribute in (("Minimum", "limit_min"), ("Maximum", "limit_max")):
        incoming = node.inputs.get(name)
        if modern:
            op['inputs'][name] = {'name': incoming.name, 'socketType': incoming.type, 'value': read(incoming)}
            interval = bounds(incoming)
            if interval is None or interval[0] != interval[1]:
                fail(incoming, "Luminance Key thresholds require proven fixed scalar inputs")
            number = interval[0]
        else:
            number = float(getattr(node, attribute))
        if not math.isfinite(number) or not 0 <= number <= 1:
            fail(incoming or socket, "Luminance Key thresholds require finite values in [0,1]")
        limits.append(number)
    if abs(limits[1] - limits[0]) < 1 / 64:
        fail(socket, "Luminance Key threshold separation must be at least 1/64; collapsed/narrow ramps need source evaluation")
    device = getattr(scene.render, "compositor_device", "CPU")
    op["properties"].update({"luminance_key_model": "native-luminance-key-v1",
        "luminance_key_schema": "legacy-branch" if not modern and device == "CPU" else "linear-ramp",
        "luminance_key_limits": limits})
    incoming = node.inputs["Image"]
    op["inputs"]["Image"] = {"name": incoming.name, "socketType": incoming.type, "value": read(incoming)}
    effective_cpu = device == 'CPU' or (bpy.app.version >= (5, 0, 0) and single is not None
        and all(single(incoming['value']) for incoming in op['inputs'].values()))
    if effective_cpu:
        # Ordinary unqualified workflows retain the serialized v1 contract.
        # Only the measured source profile may claim the new exact arithmetic.
        version = tuple(bpy.app.version)
        build_hash = bpy.app.build_hash.decode()
        source_platform, architecture = sys.platform, platform.machine()
        reason = None
        if version == (4, 2, 0) and limits[0] >= limits[1]:
            reason = 'unmeasured legacy reversed CPU ramp'
        elif version not in {(4, 2, 0), (5, 2, 0), (5, 3, 0)}:
            reason = 'unmeasured source version'
        elif not _cpu_source_allowed(version, source_platform, architecture, build_hash):
            reason = 'unmeasured CPU/compiler profile'
        elif source_platform == 'win32' and device != 'CPU':
            reason = 'unmeasured Windows GPU single-value CPU fold'
        else:
            try:
                coefficients = _cpu_coefficients()
                profile = _cpu_profile()
                measured_mode = 'ftz-daz-rne' if version == (5, 3, 0) else 'gradual-rne'
                if profile['mode'] != measured_mode:
                    reason = 'unmeasured source version/Float32 mode combination'
                known = [struct.unpack('f', struct.pack('f', value))[0] for value in [.2126, .7152, .0722]]
                if coefficients != known:
                    reason = 'unmeasured source Rec.709 luminance coefficients'
            except Exception as error:
                reason = 'unmeasured OCIO/Float32 profile: ' + str(error)
        if reason is not None:
            op['properties'].update(luminance_key_precision='legacy-unqualified-cpu-v1',
                luminance_key_exact_qualification={'status': 'SOURCE_ADMISSION_NA', 'reason': reason,
                    'sourceVersion': list(version), 'sourcePlatform': sys.platform,
                    'sourceArchitecture': platform.machine()})
            return
        op['properties'].update(luminance_key_model='native-luminance-key-cpu-rne-v1',
            luminance_key_precision='native-cpu-rne-v1',
            luminance_key_source_version=list(version), luminance_key_coefficients=coefficients,
            luminance_key_cpu_profile=profile)
        if source_platform in {'linux', 'win32'}:
            op['properties']['luminance_key_source_build'] = build_hash
