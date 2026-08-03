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

# Phase 3 blocker, excluded by standing decision: this mesh's animated
# LATTICE deformers cannot ship until the runtime LATTICE route exists
# (plan doc section 5, Phase 3), and HEAD's Geometry Fidelity gate
# correctly refuses the WHOLE export while it is present (its
# SurfaceDeform branch alone is provably resolvable, but the lattices are
# not -- see the plan doc's Phase 1 residue note). The showcase ships
# without the zippers until Phase 3; fidelity-gate scope is view-layer
# membership, so exclusion means unlinking from every collection.
zipper = bpy.data.objects.get("GEO-ellie_fannypack_zippers.001")
if zipper is not None:
    for collection in list(zipper.users_collection):
        collection.objects.unlink(zipper)
    print("EXCLUDED_PHASE3_BLOCKER GEO-ellie_fannypack_zippers.001")

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

# TSL runtime extras are PER MESH, but their needs are per material: a
# multi-material mesh (the 9-slot boots) whose bindings demand different
# uv/texspace contracts refuses at export, and a binding whose entry
# cannot be built at all (watch_metal samples vertex-color layer 'Edges',
# which is not the active COLOR_0 layer) refuses the same way. Both are
# INSTALL-time refusals the plan-time self-validation below cannot see,
# and each failed compile costs hours -- so resolve them here: compute
# every lowered material's runtime entry per mesh, keep the largest
# agreeing set on each shared mesh, and drop TSL (bake keeps carrying the
# material) from the rest by name. The compiler improvements that would
# dissolve this -- merging non-conflicting extras, COLOR_n layer mapping
# -- are filed separately.
import collections
import json


def resolve_tsl_extras_conflicts(plan):
    mesh_entries = collections.defaultdict(dict)
    failed = set()
    for decision in plan.lowerings:
        channels = (decision.channel_plan or {}).get("channels", ())
        if not any("tslIr" in channel for channel in channels):
            continue
        for binding in decision.bindings:
            obj = bpy.data.objects.get(binding.object_name)
            if obj is None:
                continue
            try:
                entry = compiler._tsl_runtime_mesh_entry(decision, obj)
            except compiler.MaterialCompileError as error:
                failed.add(decision.material_name)
                print(f"TSL_ENTRY_FAILED {decision.material_name}: {error}")
                continue
            if entry is None:
                continue
            mesh_entries[obj.data.as_pointer()].setdefault(
                decision.material_name,
                json.dumps(entry, sort_keys=True),
            )
    dropped = set(failed)
    for _mesh, by_material in mesh_entries.items():
        variants = collections.Counter(by_material.values())
        if len(variants) <= 1:
            continue
        keep, _count = variants.most_common(1)[0]
        for material_name, encoded in by_material.items():
            if encoded != keep:
                dropped.add(material_name)
    for material_name in dropped:
        material = bpy.data.materials.get(material_name)
        if material is not None:
            compiler.set_tsl_ir(material, False)
    return dropped

verify = compiler.plan_materials(objects, purpose="final")
tsl_dropped = resolve_tsl_extras_conflicts(verify)
print(f"UNMARKED_TSL_CONFLICTS {len(tsl_dropped)}: {sorted(tsl_dropped)}")
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
