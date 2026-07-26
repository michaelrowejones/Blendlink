# SPDX-License-Identifier: GPL-3.0-or-later
"""Real Blender contract for reachability-aware external file evidence."""
from __future__ import annotations

import importlib
import importlib.util
import sys
import tempfile
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
PACKAGE = "blendlink_external_dependency_check"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def load_addon():
    spec = importlib.util.spec_from_file_location(
        PACKAGE, ADDON_DIR / "__init__.py",
        submodule_search_locations=[str(ADDON_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)
    module.register()
    return module


def load_exporter():
    path = ADDON_DIR.parent / "blendlink" / "blender" / "export_scene.py"
    spec = importlib.util.spec_from_file_location(
        "blendlink_external_dependency_exporter", path,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def file_image(name, path):
    image = bpy.data.images.new(name, width=1, height=1)
    image.source = "FILE"
    image.filepath = str(path)
    return image


def image_material(name, image):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    return material


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon = load_addon()
    exporter = load_exporter()
    syncstatus = importlib.import_module(f"{PACKAGE}.syncstatus")
    with tempfile.TemporaryDirectory(prefix="blendlink-external-dependency-") as root:
        root = Path(root)
        mesh = bpy.data.meshes.new("Reachability Mesh")
        mesh.from_pydata(((-1, -1, 0), (1, -1, 0), (0, 1, 0)), (), ((0, 1, 2),))
        obj = bpy.data.objects.new("Reachability Object", mesh)
        bpy.context.scene.collection.objects.link(obj)

        reachable_image = file_image("Reachable Image", root / "reachable.png")
        residue_image = file_image("Old Addon Image", root / "old-addon.png")
        world_image = file_image("World Image", root / "world.exr")
        reachable_material = image_material("Reachable Material", reachable_image)
        residue_material = image_material("Unused Addon Material", residue_image)
        mesh.materials.append(reachable_material)

        world = bpy.data.worlds.new("Dependency World")
        world.use_nodes = True
        environment = world.node_tree.nodes.new("ShaderNodeTexEnvironment")
        environment.image = world_image
        bpy.context.scene.world = world

        dependencies = {
            Path(item["path"]).name: item
            for item in exporter.collect_external_dependencies((obj,))
        }
        expect(
            dependencies["reachable.png"].get("reachable") is not False,
            f"bound material image was classified as residue: {dependencies}",
        )
        expect(
            dependencies["world.exr"].get("reachable") is not False,
            f"active World image was classified as residue: {dependencies}",
        )
        expect(
            dependencies["old-addon.png"].get("reachable") is False
            and dependencies["old-addon.png"].get("reachabilityReason")
            == "unbound-material",
            f"unbound material image did not retain non-impacting evidence: {dependencies}",
        )
        expect(
            syncstatus._verify_external_dependencies({
                "externalDependencies": [dependencies["old-addon.png"]],
            }, force=True) == [],
            "Blender addon disagreed with compiler reachability evidence",
        )

        # One assignment changes the same missing bytes from harmless residue
        # to a loud build dependency. The path must not remain suppressed.
        mesh.materials.append(residue_material)
        rebound = {
            Path(item["path"]).name: item
            for item in exporter.collect_external_dependencies((obj,))
        }
        expect(
            rebound["old-addon.png"].get("reachable") is not False,
            f"newly bound missing material image stayed non-impacting: {rebound}",
        )
        expect(
            any(
                "missing" in failure
                for failure in syncstatus._verify_external_dependencies({
                    "externalDependencies": [rebound["old-addon.png"]],
                }, force=True)
            ),
            "Blender addon stopped reporting a newly reachable missing image",
        )

    addon.unregister()
    print("BLENDLINK_EXTERNAL_DEPENDENCY_CHECK_PASSED")


main()
