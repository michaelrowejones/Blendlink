# Ellie showcase fidelity routing (the Phase 4 acceptance scene): opt
# every material whose plan LOWERS into the per-channel Material bake
# (+ TSL IR programs) on THIS COPY. The character is armature-deformed,
# so there is no Appearance atlas — everything unmarked ships Realtime.
# Self-validating: mark all, plan, unmark anything the fidelity gate
# blocks (each refusal is compiler-named), plan again to prove clean.
import sys
from pathlib import Path

import bpy

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "packages" / "blendlink" / "blender"))
sys.path.insert(0, str(REPO / "packages" / "blender-addon"))

import importlib.util


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


ADDON = REPO / "packages" / "blender-addon"
procedural = load_module("procedural", ADDON / "procedural.py")
tsl_ir = load_module("tsl_ir", ADDON / "tsl_ir.py")
compiler = load_module("material_compiler", ADDON / "material_compiler.py")

# The artist saved this file with a 128x128 render resolution, which the
# selected-field density model reads as the authored quality reference —
# every bake ceiling collapses to 128px and large receivers (the denim
# jacket targets ~717 projected pixels) cannot reach their coverage
# target. Restore a real presentation resolution on THIS COPY before any
# plan runs, since ceilings and density targets derive from it.
render = bpy.context.scene.render
render.resolution_x = 1920
render.resolution_y = 1080
render.resolution_percentage = 100

for material in bpy.data.materials:
    if material.use_nodes and material.node_tree is not None:
        compiler.set_material_bake(material, True)
        compiler.set_tsl_ir(material, True)

objects = [o for o in bpy.context.view_layer.objects if o.type == "MESH"]
plan = compiler.plan_materials(objects, purpose="final")
blocked = sorted({
    decision.material_name for decision in plan.decisions
    if decision.intent == "materialBake" and decision.outcome == "blocked"
})
for name in blocked:
    material = bpy.data.materials.get(name)
    if material is not None:
        compiler.set_material_bake(material, False)
        compiler.set_tsl_ir(material, False)
print(f"UNMARKED {len(blocked)}: {blocked}")

verify = compiler.plan_materials(objects, purpose="final")
lowered = [
    d for d in verify.decisions
    if d.intent == "materialBake" and d.outcome == "lowered"
]
still_blocked = [
    d.material_name for d in verify.decisions
    if d.intent == "materialBake" and d.outcome == "blocked"
]
print(f"MARKED_LOWERED {len(lowered)}")
if still_blocked:
    raise SystemExit(f"still blocked after unmark: {still_blocked}")

import json

# Shader-tree property animation cannot ship to standard Three
# (KHR_animation_pointer is unbound), so the still-material showcase
# freezes it on THIS COPY — the knit shimmer on ellie.socks becomes its
# rest frame. Object and armature animation are untouched.
frozen_trees = 0
for group in bpy.data.node_groups:
    if group.animation_data is not None:
        group.animation_data_clear()
        frozen_trees += 1
for material in bpy.data.materials:
    tree = material.node_tree if material.use_nodes else None
    if tree is not None and tree.animation_data is not None:
        tree.animation_data_clear()
        frozen_trees += 1
print(f"FROZEN_SHADER_ANIMATION {frozen_trees}")

# Realtime presentation: the character deforms, so no Appearance atlas
# runs — the schema still requires the structural Main atlas stanza and
# quality profiles.
bpy.context.scene["blendlink_recipe"] = json.dumps({
    "schemaVersion": 1,
    "presentation": "realtime",
    "atlases": [{
        "id": "main", "name": "Main", "size": 1024,
        "targetDensity": 24, "margin": 8, "fitPolicy": "block",
    }],
    "preview": {
        "samples": 2, "supersample": 1,
        "denoise": False, "resolutionScale": 1,
    },
    "final": {
        "samples": 16, "supersample": 1,
        "denoise": True, "resolutionScale": 1,
    },
    "optimization": {"geometry": "meshopt"},
}, separators=(",", ":"))

bpy.ops.wm.save_mainfile()
print("SHOWCASE_FIDELITY_MARKED")
