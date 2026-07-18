# SPDX-License-Identifier: GPL-3.0-or-later
#
# blendlink export script. This file imports bpy and is therefore licensed
# GPL-3.0-or-later, unlike the rest of the blendlink package (MIT). It runs
# inside the user's Blender via:
#
#   blender -b <file.blend> --factory-startup --python-exit-code 13 \
#     --python export_scene.py -- <out.glb> <settings.json> <result.json>
#
# Contract with the Node invoker:
# - The ONLY trusted outputs are the process exit code, the result JSON file,
#   and the single sentinel line "BLENDLINK_OK <sha-unused>" on stdout.
# - Unknown exporter kwargs are dropped via RNA introspection and reported in
#   the result JSON (the glTF exporter's signature churns across versions;
#   passing a stale kwarg raises TypeError and aborts the export).

import json
import sys

import bpy


def parse_argv() -> tuple[str, str, str]:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) != 3:
        raise SystemExit("expected: -- <out.glb> <settings.json> <result.json>")
    return args[0], args[1], args[2]


def missing_libraries() -> list[str]:
    return sorted(
        library.filepath
        for library in bpy.data.libraries
        if any(getattr(block, "is_missing", False) for block in library.users_id)
    )


def main() -> None:
    out_path, settings_path, result_path = parse_argv()
    with open(settings_path, "r", encoding="utf-8") as handle:
        settings = json.load(handle)

    desired = {
        "filepath": out_path,
        "export_format": "GLB",
        "export_apply": True,
        "export_yup": True,
        "export_texcoords": True,
        "export_normals": True,
        "export_materials": "EXPORT",
        "export_extras": True,
        "export_cameras": True,
        "export_lights": True,
        "export_animations": True,
        "export_skins": True,
        "export_morph": True,
        # Compression happens post-export in Node where the library version is
        # controlled; the exporter's Draco path has a history of UV corruption.
        "export_draco_mesh_compression_enable": False,
        "export_image_format": settings.get("imageFormat", "AUTO"),
    }
    collection = settings.get("collection")
    if collection:
        desired["collection"] = collection
    desired.update(settings.get("exporterOverrides", {}))

    supported = {
        prop.identifier
        for prop in bpy.ops.export_scene.gltf.get_rna_type().properties
    }
    kwargs = {key: value for key, value in desired.items() if key in supported}
    dropped = sorted(set(desired) - supported)

    warnings = []
    missing = missing_libraries()
    if missing:
        warnings.append(f"missing linked libraries: {', '.join(missing)}")

    bpy.ops.export_scene.gltf(**kwargs)

    result = {
        "ok": True,
        "blenderVersion": bpy.app.version_string,
        "exporterKwargsDropped": dropped,
        "warnings": warnings,
        "collection": collection,
    }
    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle)
    print("BLENDLINK_OK export")


if __name__ == "__main__":
    main()
