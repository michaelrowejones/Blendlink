# Showcase fidelity routing: opt every Principled-rooted material into
# the per-channel Material bake (+ TSL IR evidence) on THIS COPY of the
# scene. Blocked materials are reported so the remaining route choices
# stay explicit.
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

# The bundle ships with the furniture layer toggled off — include it.
def include_collection(layer_collection, name):
    if layer_collection.name == name:
        layer_collection.exclude = False
        return True
    return any(
        include_collection(child, name)
        for child in layer_collection.children
    )


if include_collection(
    bpy.context.view_layer.layer_collection, "Demo Assets",
):
    print("INCLUDED Demo Assets")

marked = []
skipped = []
for material in bpy.data.materials:
    if not material.use_nodes or material.node_tree is None:
        continue
    tree = material.node_tree
    routing = procedural.material_channel_routing(
        tree, procedural.reachable_surface_nodes(tree),
    )
    # Materials whose bindings hit the first-materialization constraints
    # (multi-slot receivers, shared bindings, unapplied modifiers,
    # view-dependent channels) ride the appearance atlas instead. The
    # second group carries the compiler's own refusals from the final
    # plan (a single erroring decision blocks the whole bake plan, and
    # the hybrid presentation then silently atlases EVERYTHING — these
    # five marks previously made the '15 bakes' claim untrue):
    # Brush (4 slots + Subdivision), Easel.Canvas (2 slots),
    # Easel.Wood (Base Color captures AO lighting), Rug (Subdivision),
    # Wooden Bars (7 shared bindings).
    constrained = {
        "Blanket", "Book Cover", "Book_Pages", "Cat_Head",
        "bluebell", "plants.leaf", "bluebell_center",
        "Brush", "Easel.Canvas", "Easel.Wood", "Rug", "Wooden Bars",
    }
    if material.name in constrained:
        compiler.set_material_bake(material, False)
        compiler.set_tsl_ir(material, False)
        skipped.append(material.name)
    elif routing and routing.get("surfaceRoot") == "principled":
        compiler.set_material_bake(material, True)
        compiler.set_tsl_ir(material, True)
        marked.append(material.name)
    else:
        skipped.append(material.name)

print(f"MARKED {len(marked)}: {sorted(marked)[:8]}...")
print(f"SKIPPED {len(skipped)}: {sorted(skipped)}")

# Appearance baking owns the COMPLETE active surface of every static
# render mesh (render_meshes in export_scene.py), so per-material bake
# routes only run for objects the atlas does not claim. Hosts of the
# marked materials therefore go Realtime (blendlink_dynamic): their
# appearance ships through the per-channel Material bake + TSL IR and
# live lights, while everything else stays frozen into the atlas.
for obj in bpy.data.objects:
    if "blendlink_dynamic" in obj.keys():
        del obj["blendlink_dynamic"]
marked_names = set(marked)


def portable_principled(material):
    """A Realtime slot the gate accepts without a bake route: a
    Principled-rooted surface (live PBR exports as stock glTF)."""
    if not material.use_nodes or material.node_tree is None:
        return True
    tree = material.node_tree
    routing = procedural.material_channel_routing(
        tree, procedural.reachable_surface_nodes(tree),
    )
    return bool(routing) and routing.get("surfaceRoot") == "principled"


# A host goes Realtime only when EVERY slot is either bake-marked or
# portable live PBR — one non-portable procedural slot (curtains'
# Voronoi/Translucent) keeps the whole object in the atlas, and its
# marked materials demote back to the atlas route with it.
dynamic_hosts = []
hosted_marked = set()
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    slots = [
        slot.material for slot in obj.material_slots
        if slot.material is not None
    ]
    if not slots or not any(m.name in marked_names for m in slots):
        continue
    if all(
        m.name in marked_names or portable_principled(m) for m in slots
    ):
        obj["blendlink_dynamic"] = True
        dynamic_hosts.append(obj.name)
        hosted_marked.update(
            m.name for m in slots if m.name in marked_names
        )
demoted = sorted(marked_names - hosted_marked)
for name in demoted:
    material = bpy.data.materials.get(name)
    if material is not None:
        compiler.set_material_bake(material, False)
        compiler.set_tsl_ir(material, False)
print(f"DYNAMIC_HOSTS {len(dynamic_hosts)}: {sorted(dynamic_hosts)}")
print(f"DEMOTED {len(demoted)}: {demoted}")

CURATED_OUT = (
    "Book", "Book.001", "Book.002", "Book.003", "Book.004", "Book.005",
    "Book.006",
    "Cat in a Blanket", "Display Case", "Ladder",
    "Picture Frame - 1 Apple Imitation",
    "Picture Frame - 2 Mountains Spring",
    "Picture Frame - 3 Windmill X",
    "Picture Frame - 4 Shells in the Sand",
    "Picture Frame - 5 Francks Razor",
    "Potted Plant - Bluebell", "Table", "Tea Cup", "Tea Pot",
)
# The books are animated props; freezing them on this copy lets the
# appearance atlas carry them as part of the still diorama.
frozen = 0
for obj in bpy.data.objects:
    if obj.name.startswith("Book"):
        if obj.animation_data is not None:
            obj.animation_data_clear()
        for constraint in list(obj.constraints):
            obj.constraints.remove(constraint)
        frozen += 1
print(f"FROZEN_BOOKS {frozen}")

hidden = 0
for name in CURATED_OUT:
    obj = bpy.data.objects.get(name)
    if obj is not None:
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        hidden += 1
print(f"CURATED_OUT {hidden}/{len(CURATED_OUT)}")

# The hybrid presentation: one Appearance atlas carries every surface
# the per-material routes don't, flattened by Cycles — the supported
# route for the group-wrapped/procedural/glass materials.
import json

bpy.context.scene["blendlink_recipe"] = json.dumps({
    "schemaVersion": 1,
    "presentation": "hybrid",
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
