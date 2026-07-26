"""Read-only Blender 5.1 diagnostics for the Pet Projects linked bundle.

Run only with ``--disable-autoexec``. The script never saves the source file.
It identifies missing linked IDs, invalid drivers, and Curve objects whose
evaluated form cannot satisfy Blendlink's current sidecar sampling assumption.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys

import bpy


def output_path() -> str:
    if "--" not in sys.argv:
        raise SystemExit("expected output JSON path after --")
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 1:
        raise SystemExit("expected exactly one output JSON path after --")
    return os.path.abspath(args[0])


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def linked_path(library) -> str:
    return os.path.abspath(bpy.path.abspath(library.filepath))


def id_collections():
    names = (
        "actions",
        "armatures",
        "cameras",
        "collections",
        "curves",
        "images",
        "lattices",
        "lights",
        "materials",
        "meshes",
        "node_groups",
        "objects",
        "scenes",
        "worlds",
    )
    for name in names:
        yield name, getattr(bpy.data, name)


def owner_drivers(collection_name: str, owner):
    animation_data = getattr(owner, "animation_data", None)
    if animation_data is None:
        return []
    result = []
    for fcurve in animation_data.drivers:
        result.append(
            {
                "ownerKind": collection_name,
                "owner": owner.name,
                "dataPath": fcurve.data_path,
                "arrayIndex": int(fcurve.array_index),
                "expression": fcurve.driver.expression,
                "isValid": bool(fcurve.is_valid),
            }
        )
    return result


def main() -> None:
    destination = output_path()
    source_path = os.path.abspath(bpy.data.filepath)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()

    missing_ids = []
    drivers = []
    for collection_name, collection in id_collections():
        for datablock in collection:
            if bool(getattr(datablock, "is_missing", False)):
                library = getattr(datablock, "library", None)
                missing_ids.append(
                    {
                        "kind": collection_name,
                        "name": datablock.name,
                        "library": (
                            linked_path(library) if library is not None else None
                        ),
                    }
                )
            drivers.extend(owner_drivers(collection_name, datablock))

    curve_evaluation = []
    for obj in sorted(bpy.data.objects, key=lambda item: item.name.casefold()):
        if obj.type != "CURVE" or obj.hide_render:
            continue
        record = {
            "object": obj.name,
            "data": obj.data.name if obj.data is not None else None,
            "library": linked_path(obj.library) if obj.library is not None else None,
            "splineTypes": sorted({spline.type for spline in obj.data.splines}),
            "hasNonBezierSpline": any(
                spline.type != "BEZIER" for spline in obj.data.splines
            ),
            "evaluatedMesh": False,
            "vertices": None,
            "error": None,
        }
        evaluated = None
        mesh = None
        try:
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            record["evaluatedMesh"] = mesh is not None
            record["vertices"] = len(mesh.vertices) if mesh is not None else None
        except Exception as error:  # Preserve Blender's exact error text.
            record["error"] = f"{type(error).__name__}: {error}"
        finally:
            if evaluated is not None and mesh is not None:
                evaluated.to_mesh_clear()
        curve_evaluation.append(record)

    linked_libraries = [
        {
            "name": library.name,
            "authoredPath": library.filepath,
            "resolvedPath": linked_path(library),
            "exists": os.path.isfile(linked_path(library)),
        }
        for library in bpy.data.libraries
    ]
    registered_scripts = [
        {"name": text.name, "characters": len(text.as_string())}
        for text in bpy.data.texts
        if bool(getattr(text, "use_module", False))
    ]
    fcurves_flagged_invalid = [driver for driver in drivers if not driver["isValid"]]

    evidence = {
        "schemaVersion": 1,
        "blender": {
            "version": bpy.app.version_string,
            "buildHash": bpy.app.build_hash.decode("ascii"),
            "autoexecEnabled": bool(
                bpy.context.preferences.filepaths.use_scripts_auto_execute
            ),
        },
        "source": {
            "path": source_path.replace("\\", "/"),
            "bytes": os.path.getsize(source_path),
            "sha256": sha256(source_path),
        },
        "linkedLibraries": {
            "total": len(linked_libraries),
            "resolved": sum(1 for library in linked_libraries if library["exists"]),
            "entries": linked_libraries,
        },
        "missingIds": missing_ids,
        "registeredScripts": registered_scripts,
        "drivers": {
            "total": len(drivers),
            # Blender's FCurve flag does not report every restricted
            # auto-execution failure printed while the dependency graph is
            # evaluated. Keep this field narrow and preserve stderr separately.
            "fcurvesFlaggedInvalid": len(fcurves_flagged_invalid),
            "fcurvesFlaggedInvalidEntries": fcurves_flagged_invalid,
        },
        "curves": {
            "totalRenderVisibleDataObjects": len(curve_evaluation),
            "withoutEvaluatedMesh": [
                record
                for record in curve_evaluation
                if not record["evaluatedMesh"]
            ],
            "sidecarMeshAssumptionFailures": [
                record
                for record in curve_evaluation
                if record["hasNonBezierSpline"] and not record["evaluatedMesh"]
            ],
        },
    }

    os.makedirs(os.path.dirname(destination), exist_ok=True)
    with open(destination, "w", encoding="utf-8") as handle:
        json.dump(evidence, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(
        "BLENDLINK_BLENDER_36_LOAD_INTEGRITY_PASSED "
        f"libraries={evidence['linkedLibraries']['resolved']}/"
        f"{evidence['linkedLibraries']['total']} "
        f"missing_ids={len(missing_ids)} "
        f"fcurves_flagged_invalid={len(fcurves_flagged_invalid)}/{len(drivers)} "
        "sidecar_mesh_failures="
        f"{len(evidence['curves']['sidecarMeshAssumptionFailures'])}"
    )


if __name__ == "__main__":
    main()
