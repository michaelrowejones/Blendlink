# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only identification of native compositor GPU numerical implementations."""
from functools import lru_cache
import os
import re
import subprocess

import bpy


@lru_cache(maxsize=1)
def native_gpu_profile():
    backend = getattr(bpy.context.preferences.system, "gpu_backend", "UNKNOWN")
    result = {"backend": backend}
    try:
        import gpu
        if hasattr(gpu, "init"):
            gpu.init()
        result.update({"backend": gpu.platform.backend_type_get(), "vendor": gpu.platform.vendor_get(),
                       "renderer": gpu.platform.renderer_get(), "version": gpu.platform.version_get(),
                       "source": "Blender gpu.platform"})
    except Exception as error:
        result["diagnostic"] = str(error)
        # Blender4.2 explicitly disables gpu.platform in background mode. Query
        # the same DISPLAY through GLX, preserving the driver/offload environment.
        # Failure leaves an unknown model and must not imply Mesa.
        if backend == "OPENGL" and os.environ.get("DISPLAY"):
            try:
                probe = subprocess.run(["glxinfo", "-B"], check=True, capture_output=True,
                                       text=True, timeout=10)
                for name, expression in (("vendor", r"^OpenGL vendor string:\s*(.+)$"),
                    ("renderer", r"^OpenGL renderer string:\s*(.+)$"),
                    ("version", r"^OpenGL (?:core profile )?version string:\s*(.+)$")):
                    match = re.search(expression, probe.stdout, re.MULTILINE)
                    if match:
                        result[name] = match.group(1).strip()
                if all(name in result for name in ("vendor", "renderer", "version")):
                    result["source"] = "glxinfo -B on Blender DISPLAY"
            except (OSError, subprocess.SubprocessError) as probe_error:
                result["diagnostic"] += "; GLX identification failed: " + str(probe_error)
    if result["backend"] == "METAL":
        result["intrinsicModel"] = "metal-native-v1"
    elif result["backend"] == "OPENGL" and "mesa" in result.get("version", "").lower():
        result["intrinsicModel"] = "mesa-glsl-v1"
    else:
        result["intrinsicModel"] = "unverified"
    return result
