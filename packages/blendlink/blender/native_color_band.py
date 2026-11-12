# SPDX-License-Identifier: GPL-3.0-or-later
"""Native material GPUColorBand upload and sampling metadata.

Shader and compositor GPU nodes share this table mechanism. Native references
cover Metal on 4.2/5.2/5.3 and software OpenGL on Linux 4.2/5.2.
"""
import bpy
import numpy as np


def native_color_band(values):
    source = np.asarray(values, dtype=np.float32)
    if not np.isfinite(source).all():
        raise ValueError("Native color band contains nonfinite values")
    half = bpy.app.version < (5, 3, 0)
    backend = getattr(bpy.context.preferences.system, "gpu_backend", "OPENGL")
    if half:
        if np.any(np.abs(source) > 65504):
            raise ValueError("Native half-float color band exceeds its finite range")
        encoded = source.astype(np.float16)
        # Legacy native texture conversion truncates on both verified backends.
        # From 5.0 Blender explicitly converts on CPU with nearest-even rounding.
        truncate = bpy.app.version < (5, 0, 0)
        if truncate:
            away = np.abs(encoded.astype(np.float32)) > np.abs(source)
            encoded = np.where(away, np.nextafter(encoded, np.float16(0)), encoded)
        source = encoded.astype(np.float32)
    if backend not in {'METAL', 'OPENGL'}:
        raise ValueError('Native color-band sampling has no verified model for GPU backend ' + backend)
    # Metal's typed half texture returns a rounded half after fixed8 filtering.
    # GLSL samples return full floats; the native software OpenGL gate proves
    # full-fraction interpolation before the scene target's own conversion.
    return {"values": source.ravel().tolist(), "tableStorage": "rgba16f" if half else "rgba32f",
            "sampleStorage": "rgba16f" if half and backend == 'METAL' else "rgba32f",
            "filterFractionBits": 8 if backend == 'METAL' else 0,
            "sampleRounding": 'nearest-away' if half and backend == 'METAL' else 'none',
            "nativeGpuBackend": backend,
            "tableSampling": "native normalized linear sampler, clamp-to-edge"}
