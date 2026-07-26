"""Inspect the real Splash DPM.002 marker and candidate without saving it.

Run from the repository root:

    blender.exe --background <splash.blend> --python \
      experiments/splash-material-response-factorization/inspect_dpm_plan.py
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

import bpy


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[2]
ADDON_DIR = REPO_ROOT / "packages" / "blender-addon"
OUTPUT_PATH = SCRIPT_PATH.parent / "dpm-plan-evidence.json"
PACKAGE = "blendlink_splash_dpm_plan_evidence"
TARGET_MATERIAL = "DPM.002"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def load_addon():
    spec = importlib.util.spec_from_file_location(
        PACKAGE,
        ADDON_DIR / "__init__.py",
        submodule_search_locations=[str(ADDON_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)
    module.register()
    return module


def main():
    addon = load_addon()
    compiler = addon.material_compiler
    material = bpy.data.materials.get(TARGET_MATERIAL)
    if material is None:
        raise RuntimeError(f"Missing material {TARGET_MATERIAL!r}")
    raw_bindings = [
        (obj, slot_index)
        for obj in bpy.context.scene.objects
        if getattr(obj, "type", None) == "MESH"
        for slot_index, slot in enumerate(obj.material_slots)
        if slot.material == material
        and any(
            int(polygon.material_index) == slot_index
            for polygon in obj.data.polygons
        )
    ]
    marker = compiler.marker_nodes(material)
    if len(marker) != 1:
        raise RuntimeError(
            f"{TARGET_MATERIAL} has {len(marker)} Web Color markers, expected one"
        )
    selected = compiler._linked_source(marker[0], compiler.COLOR_INPUT)
    if selected is None:
        raise RuntimeError(f"{TARGET_MATERIAL} Web Color is unconnected")
    before_fingerprint = compiler._material_fingerprint(material)
    current = compiler._plan_selected_material(
        material, raw_bindings, purpose="inspect",
    )
    problems = [
        issue.problem for issue in current.issues
        if issue.code == "material.selected-field-surface-response-ambiguous"
    ]
    if len(problems) != 1:
        raise RuntimeError(
            f"Expected one current surface-response diagnostic, got {problems!r}"
        )
    candidate_match = re.search(
        r'unique complete intrinsic candidate .* is '
        r'"([^"]+) -> ([^(]+) \(([^)]+)\)"',
        problems[0],
    )
    if candidate_match is None:
        raise RuntimeError(
            "Current diagnostic did not identify a unique complete intrinsic "
            f"candidate: {problems[0]}"
        )
    candidate_node = material.node_tree.nodes.get(candidate_match.group(1))
    expected_type = {
        "Color": "RGBA",
        "Value": "VALUE",
    }.get(candidate_match.group(3), candidate_match.group(3))
    candidate_socket = next((
        socket for socket in candidate_node.outputs
        if socket.name == candidate_match.group(2).rstrip()
        and socket.type == expected_type
    ), None) if candidate_node is not None else None
    if candidate_socket is None:
        raise RuntimeError(
            f"Diagnostic candidate {candidate_match.groups()!r} no longer resolves"
        )
    candidate_source, candidate_issue = compiler._classify_source(
        material.name, (candidate_node, candidate_socket), "color",
    )
    response, response_problem = compiler._infer_surface_response(
        material, (candidate_node, candidate_socket),
    )
    factorization = compiler._recognize_static_shade_floor(
        material, (candidate_node, candidate_socket),
    )
    binding_issues = compiler._materialized_binding_issues(
        material, raw_bindings,
    )
    after_fingerprint = compiler._material_fingerprint(material)
    if after_fingerprint != before_fingerprint:
        raise RuntimeError("Read-only DPM inspection changed the material graph")

    source_path = Path(bpy.data.filepath).resolve()
    evidence = {
        "schemaVersion": 1,
        "kind": "blendlink-real-splash-dpm-plan-evidence",
        "blender": bpy.app.version_string,
        "source": {
            "path": str(source_path),
            "sha256": sha256(source_path),
        },
        "material": material.name,
        "materialFingerprint": before_fingerprint,
        "markerCount": len(marker),
        "currentSelection": {
            "node": selected[0].name,
            "socket": selected[1].name,
            "kind": current.color.kind if current.color is not None else None,
            "outcome": current.outcome,
            "issues": [issue.as_dict() for issue in current.issues],
        },
        "suggestedSelection": {
            "node": candidate_node.name,
            "socket": candidate_socket.name,
            "kind": (
                candidate_source.kind if candidate_source is not None else None
            ),
            "classificationIssue": (
                candidate_issue.as_dict() if candidate_issue is not None else None
            ),
            "automaticSurfaceResponse": response,
            "surfaceResponseProblem": response_problem,
            "recognizedStaticFloorFactorization": (
                factorization.fingerprint_dict()
                if factorization is not None else None
            ),
        },
        "configurationCost": {
            "markerNodesAdded": 0,
            "markerLinksChanged": 1,
            "artistSelectionIsNeverChangedAutomatically": True,
            "bindingCount": len(raw_bindings),
            "currentMaterializationBlockers": [
                issue.as_dict() for issue in binding_issues
            ],
        },
    }
    OUTPUT_PATH.write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n",
        encoding="utf8",
    )
    addon.unregister()
    print(f"BLENDLINK_SPLASH_DPM_PLAN_EVIDENCE {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
