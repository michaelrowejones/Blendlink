# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual (needs a synced project directory and the
# INSTALLED extension; it takes `-- <project_dir> <blend_name>` arguments the
# discovered-suite runner does not supply)
"""End-to-end sync-status check against a real synced blendlink project.

Run:  blender --background --python tests/sync_status_check.py --python-exit-code 1 -- <project_dir> <blend_name>

Opens the project's .blend with the INSTALLED extension enabled, expects
IN_SYNC, then edits + saves and expects NEEDS_SYNC.
"""
import sys
from pathlib import Path

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
project = Path(args[0])
blend = project / (args[1] if len(args) > 1 else "vocab.blend")

module_name = "bl_ext.user_default.blendlink"
bpy.ops.wm.open_mainfile(filepath=str(blend))
if module_name not in sys.modules:
    raise SystemExit(f"{module_name} not loaded — is the extension installed and enabled?")
syncstatus = sys.modules[f"{module_name}.syncstatus"]

syncstatus.refresh(force=True)
status = syncstatus.status()[0]
if status != "IN_SYNC":
    raise SystemExit(f"expected IN_SYNC after fresh sync, got {status}")
print("sync check 1/2: IN_SYNC after fresh sync")

# Edit and save — the saved bytes now differ from the manifest hash.
# (bpy.data.is_dirty only flips in the GUI, so UNSAVED_EDITS is untestable here.)
bpy.data.objects[0].location.x += 0.25
bpy.ops.wm.save_mainfile()
syncstatus.refresh(force=True)
status = syncstatus.status()[0]
if status != "NEEDS_SYNC":
    raise SystemExit(f"expected NEEDS_SYNC after save, got {status}")
print("sync check 2/2: NEEDS_SYNC after edit + save")
print("BLENDLINK_SYNC_STATUS_OK")
