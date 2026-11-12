# SPDX-License-Identifier: GPL-3.0-or-later
"""Source-backend precision metadata and isolated extension color-band imports."""
import importlib
from pathlib import Path
import shutil
import sys
import tempfile
import types

ADDON = Path(__file__).resolve().parents[1]
CANONICAL = ADDON.parent / 'blendlink/blender'
sys.path.insert(0, str(ADDON))
import shader_color_band
import native_color_band

native_bpy = native_color_band.bpy
try:
    for version in [(4, 2, 0), (5, 2, 0), (5, 3, 0)]:
        for backend in ['METAL', 'OPENGL']:
            native_color_band.bpy = types.SimpleNamespace(app=types.SimpleNamespace(version=version),
                context=types.SimpleNamespace(preferences=types.SimpleNamespace(system=types.SimpleNamespace(gpu_backend=backend))))
            result = shader_color_band.native_color_band([1.0008, .2, .4, 1])
            assert result['tableStorage'] == ('rgba16f' if version < (5, 3, 0) else 'rgba32f')
            assert result['sampleStorage'] == ('rgba16f' if version < (5, 3, 0) and backend == 'METAL' else 'rgba32f')
            assert result['filterFractionBits'] == (8 if backend == 'METAL' else 0)
            assert result['sampleRounding'] == ('nearest-away' if version < (5, 3, 0) and backend == 'METAL' else 'none')
            if version < (5, 3, 0):
                assert result['values'][0] == (1.0 if version < (5, 0, 0) else 1.0009765625)
                negative = shader_color_band.native_color_band([-1.0008, 0, 0, 1])
                assert negative['values'][0] == (-1.0 if version < (5, 0, 0) else -1.0009765625)
            else:
                assert abs(result['values'][0] - 1.0008) < 1e-7
            try:
                shader_color_band.native_color_band([float('nan'), 0, 0, 1])
                raise AssertionError('Nonfinite color band was admitted')
            except ValueError as error: assert 'nonfinite' in str(error)
    native_color_band.bpy.context.preferences.system.gpu_backend = 'VULKAN'
    try:
        shader_color_band.native_color_band([0, 0, 0, 1])
        raise AssertionError('Unknown native backend inherited a sampler model')
    except ValueError as error: assert 'no verified model' in str(error)
finally:
    native_color_band.bpy = native_bpy

with tempfile.TemporaryDirectory(prefix='blendlink-isolated-colorband-') as temporary:
    package = Path(temporary) / 'band_extension'
    package.mkdir()
    shutil.copy2(ADDON / 'shader_color_band.py', package)
    shutil.copy2(CANONICAL / 'native_color_band.py', package)
    wrapper = types.ModuleType('band_extension')
    wrapper.__path__ = [str(package)]
    sys.modules[wrapper.__name__] = wrapper
    qualified = importlib.import_module('band_extension.shader_color_band')
    assert qualified.native_color_band.__module__ == 'band_extension.native_color_band'
    assert len(qualified.native_color_band([0, .5, 1, 1])['values']) == 4
print('BLENDLINK_NATIVE_COLOR_BAND_PASSED source backend models, finite data and isolated package imports')
