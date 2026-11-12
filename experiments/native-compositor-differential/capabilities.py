# SPDX-License-Identifier: GPL-3.0-or-later
"""Report native offline compositor capability without substituting a device."""
import json
from pathlib import Path
import sys

import bpy

property_ = bpy.context.scene.render.bl_rna.properties.get("compositor_device")
devices = [item.identifier for item in property_.enum_items] if property_ else []
available = "GPU" in devices and hasattr(bpy.context.scene.render, "compositor_device")
report = {"blenderVersion": bpy.app.version_string, "blenderHash": bpy.app.build_hash.decode(),
          "offlineCompositorDevices": devices, "offlineGpuAvailable": available,
          "gpuParityVersionSupported": bpy.app.version >= (4, 2, 0),
          "nativeGpuBackend": getattr(bpy.context.preferences.system, "gpu_backend", None),
          "availabilityReason": "Native offline GPU compositor is selectable; rendering must still pass"
              if available else "This Blender exposes no selectable offline GPU compositor"}
if not report["gpuParityVersionSupported"]:
    report["gpuParityReason"] = "The native GPU parity corpus requires Blender 4.2 or newer"


def shared_utility_available(tree_type):
    tree = bpy.data.node_groups.new("Blendlink Capability Probe", tree_type)
    failures = []
    try:
        for node_type in ("FunctionNodeInputBool", "FunctionNodeInputInt"):
            try:
                tree.nodes.new(node_type)
            except RuntimeError as error:
                failures.append({"nodeType": node_type, "reason": str(error)})
    finally:
        bpy.data.node_groups.remove(tree)
    return not failures, failures


for context, tree_type in (("Shader", "ShaderNodeTree"), ("Compositor", "CompositorNodeTree")):
    supported, failures = shared_utility_available(tree_type)
    report["sharedUtility" + context + "Available"] = supported
    report["sharedUtility" + context + "Diagnostics"] = failures
try:
    import gpu
    report["gpuPlatform"] = {"backend": gpu.platform.backend_type_get(),
                             "renderer": gpu.platform.renderer_get(), "vendor": gpu.platform.vendor_get()}
except Exception as error:
    report["gpuPlatformDiagnostic"] = str(error)
destination = Path(sys.argv[sys.argv.index("--") + 1])
destination.write_text(json.dumps(report, indent=2))
print("BLENDLINK_NATIVE_COMPOSITOR_CAPABILITIES " + json.dumps(report))
