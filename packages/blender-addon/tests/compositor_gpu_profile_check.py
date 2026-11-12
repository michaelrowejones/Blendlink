# SPDX-License-Identifier: GPL-3.0-or-later
"""Supported GPU API and bounded legacy GLX identification, without assumed drivers."""
import json
from pathlib import Path
from types import SimpleNamespace
import os
import subprocess
import sys
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blendlink/blender"))
import compositor_gpu
import compositor_math


def unavailable():
    raise RuntimeError("GPU functions for drawing are not available in background mode")


def check(backend, gpu, display, run):
    compositor_gpu.native_gpu_profile.cache_clear()
    fake_bpy = SimpleNamespace(context=SimpleNamespace(preferences=SimpleNamespace(system=SimpleNamespace(gpu_backend=backend))))
    with patch.object(compositor_gpu, "bpy", fake_bpy), patch.dict(sys.modules, {"gpu": gpu}), \
            patch.dict(os.environ, {"DISPLAY": display}), patch.object(compositor_gpu.subprocess, "run", run):
        result = compositor_gpu.native_gpu_profile()
        assert result is compositor_gpu.native_gpu_profile(), "GPU identification was not cached"
        return result


try:
    initialize = Mock()
    platform = SimpleNamespace(backend_type_get=lambda: "OPENGL", vendor_get=lambda: "Mesa",
        renderer_get=lambda: "llvmpipe (LLVM15.0.7)", version_get=lambda: "4.5 (Core Profile) Mesa24.0.9")
    run = Mock(side_effect=AssertionError("Supported gpu.platform must not launch glxinfo"))
    result = check("OPENGL", SimpleNamespace(init=initialize, platform=platform), ":199", run)
    assert result["intrinsicModel"] == "mesa-glsl-v1" and result["source"] == "Blender gpu.platform", result
    initialize.assert_called_once()
    run.assert_not_called()

    platform = SimpleNamespace(backend_type_get=unavailable)
    text = "OpenGL vendor string: Mesa\nOpenGL renderer string: llvmpipe (LLVM15.0.7)\nOpenGL core profile version string:4.5 (Core Profile) Mesa24.0.9\n"
    run = Mock(return_value=SimpleNamespace(stdout=text))
    result = check("OPENGL", SimpleNamespace(platform=platform), ":199", run)
    assert result["intrinsicModel"] == "mesa-glsl-v1" and result["source"] == "glxinfo -B on Blender DISPLAY", result
    run.assert_called_once_with(["glxinfo", "-B"], check=True, capture_output=True, text=True, timeout=10)

    run = Mock(side_effect=AssertionError("No DISPLAY must not launch glxinfo"))
    assert check("OPENGL", SimpleNamespace(platform=platform), "", run)["intrinsicModel"] == "unverified"
    run.assert_not_called()
    run = Mock(side_effect=subprocess.TimeoutExpired("glxinfo", 10))
    result = check("OPENGL", SimpleNamespace(platform=platform), ":199", run)
    assert result["intrinsicModel"] == "unverified" and "GLX identification failed" in result["diagnostic"], result
    run.assert_called_once()
    run = Mock(return_value=SimpleNamespace(stdout=text.replace("Mesa", "UnverifiedVendor")))
    assert check("OPENGL", SimpleNamespace(platform=platform), ":199", run)["intrinsicModel"] == "unverified"
    run = Mock(side_effect=AssertionError("Metal background must not launch GLX"))
    assert check("METAL", SimpleNamespace(platform=platform), ":199", run)["intrinsicModel"] == "metal-native-v1"
    run.assert_not_called()

    # GPU implementation selection is explicit. CPU folding never needs a GPU
    # query, and an unknown OpenGL driver cannot inherit Mesa's approximation.
    node = SimpleNamespace(bl_idname="ShaderNodeMath", operation="ARCSINE", inputs=[object()])
    def refuse(code, socket, message):
        raise ValueError(code)
    profile = Mock(return_value={"intrinsicModel": "mesa-glsl-v1"})
    assert compositor_math.validate_math_domain(node, "GPU", refuse, profile)["math_gpu_intrinsic_model"] == "mesa-glsl-v1"
    profile = Mock(side_effect=AssertionError("CPU folding must not identify a GPU"))
    compositor_math.validate_math_domain(node, "CPU", refuse, profile)
    profile.assert_not_called()
    try:
        compositor_math.validate_math_domain(node, "GPU", refuse, lambda: {"intrinsicModel": "unverified"})
        raise AssertionError("Unknown GPU inverse trigonometry was accepted")
    except ValueError as error:
        assert str(error) == "unverified-gpu-inverse-trig"
finally:
    compositor_gpu.native_gpu_profile.cache_clear()

print("BLENDLINK_COMPOSITOR_GPU_PROFILE_CHECK_PASSED " + json.dumps(compositor_gpu.native_gpu_profile()))
