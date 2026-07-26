"""Differential for linked legacy Curve export and Blendlink sidecar diagnostics.

The fixture is generated in a temporary directory so it exercises the same
linked-library shape as Blender's 3.6 demo bundle without checking copyrighted
demo bytes into the repository.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import bpy
from mathutils import Matrix


ROOT = Path(__file__).resolve().parents[2]
BLENDER_SOURCE = ROOT / "packages" / "blendlink" / "blender"
if str(BLENDER_SOURCE) not in sys.path:
    sys.path.insert(0, str(BLENDER_SOURCE))

import export_scene as exporter  # noqa: E402


CURVE_NAME = "BLENDLINK_LINKED_POLY_WIRE"
SENTINEL = "BLENDLINK_LEGACY_CURVE_SIDECAR_DIFFERENTIAL_PASSED"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def create_library(path: Path) -> None:
    reset()
    curve = bpy.data.curves.new(CURVE_NAME, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.075
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(3)
    for point, coordinate in zip(
        spline.points,
        (
            (-1.5, 0.0, 0.0, 1.0),
            (-0.5, 0.0, 0.5, 1.0),
            (0.5, 0.0, -0.25, 1.0),
            (1.5, 0.0, 0.25, 1.0),
        ),
    ):
        point.co = coordinate

    curve_object = bpy.data.objects.new(CURVE_NAME, curve)
    bpy.context.scene.collection.objects.link(curve_object)
    bpy.ops.wm.save_as_mainfile(filepath=str(path), check_existing=False)


def create_main(path: Path, library_path: Path) -> None:
    reset()
    with bpy.data.libraries.load(str(library_path), link=True) as (available, loaded):
        if CURVE_NAME not in available.curves:
            raise AssertionError(f"Generated library lacks Curve data {CURVE_NAME}")
        loaded.curves = [CURVE_NAME]
    curve_object = bpy.data.objects.new(CURVE_NAME, loaded.curves[0])
    bpy.context.scene.collection.objects.link(curve_object)

    # This is the minimal form of the real 3.6 blocker: a local Object owns
    # linked Curve data and a render-enabled Geometry Nodes modifier evaluates
    # to no geometry. The source bundle names that modifier "GN-Hide".
    node_group = bpy.data.node_groups.new("BLENDLINK_GN_HIDE", "GeometryNodeTree")
    node_group.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    output = node_group.nodes.new("NodeGroupOutput")
    output.is_active_output = True
    modifier = curve_object.modifiers.new("GN-Hide", "NODES")
    modifier.node_group = node_group
    bpy.ops.wm.save_as_mainfile(filepath=str(path), check_existing=False)


def curve_state(curve_object) -> dict:
    spline = curve_object.data.splines[0]
    return {
        "object": curve_object.name,
        "objectLibrary": curve_object.library.filepath if curve_object.library else None,
        "dataLibrary": curve_object.data.library.filepath if curve_object.data.library else None,
        "splineType": spline.type,
        "points": [tuple(round(float(value), 7) for value in point.co) for point in spline.points],
        "bevelDepth": round(float(curve_object.data.bevel_depth), 7),
        "hideRender": bool(curve_object.hide_render),
        "objectMatrix": [
            tuple(round(float(value), 7) for value in row)
            for row in curve_object.matrix_world
        ],
        "modifiers": [
            {
                "name": modifier.name,
                "type": modifier.type,
                "showRender": bool(modifier.show_render),
                "nodeGroup": modifier.node_group.name if modifier.node_group else None,
            }
            for modifier in curve_object.modifiers
        ],
    }


def supported_export_kwargs() -> tuple[dict, list[str]]:
    needle_kwargs = {
        "filepath": "",
        "check_existing": False,
        "export_format": "GLB",
        "export_cameras": True,
        "export_lights": True,
        "use_active_scene": True,
        "gltf_export_id": "Needle Engine",
        "export_import_convert_lighting_mode": "COMPAT",
        "export_apply": True,
        "export_animations": True,
        "use_visible": False,
        "export_image_format": "AUTO",
        "export_jpeg_quality": 100,
    }
    supported = {
        prop.identifier
        for prop in bpy.ops.export_scene.gltf.get_rna_type().properties
    }
    return (
        {key: value for key, value in needle_kwargs.items() if key in supported},
        sorted(key for key in needle_kwargs if key not in supported),
    )


def assert_cleanup_on_sampling_failure() -> None:
    """The temporary evaluated mesh must be released even when sampling fails."""

    class ExplodingVertices:
        def __iter__(self):
            raise RuntimeError("intentional sampling failure")

    class EvaluatedObject:
        def __init__(self):
            self.mesh = SimpleNamespace(vertices=ExplodingVertices())
            self.cleared = False

        def to_mesh(self):
            return self.mesh

        def to_mesh_clear(self):
            self.cleared = True

    evaluated = EvaluatedObject()
    fake_object = SimpleNamespace(
        name="BLENDLINK_CLEANUP_PROBE",
        library=None,
        data=SimpleNamespace(library=None),
        evaluated_get=lambda _depsgraph: evaluated,
    )
    try:
        exporter.evaluated_non_bezier_curve_points(
            fake_object,
            SimpleNamespace(type="POLY"),
            Matrix.Identity(4),
            depsgraph=object(),
        )
    except RuntimeError as error:
        if str(error) != "intentional sampling failure":
            raise
    else:
        raise AssertionError("The cleanup probe did not reach its intentional sampling failure")
    if not evaluated.cleared:
        raise AssertionError("Blendlink leaked the temporary evaluated Curve mesh")


def run(output_path: Path | None) -> None:
    report = {}
    with tempfile.TemporaryDirectory(prefix="blendlink-legacy-curve-") as directory:
        temp = Path(directory)
        library_path = temp / "legacy_curve_library.blend"
        main_path = temp / "legacy_curve_main.blend"
        stock_path = temp / "needle_core_floor.glb"

        create_library(library_path)
        create_main(main_path, library_path)
        source_hashes = {
            "library": sha256(library_path),
            "main": sha256(main_path),
        }

        reset()
        bpy.ops.wm.open_mainfile(filepath=str(main_path), load_ui=False)
        curve_object = bpy.data.objects.get(CURVE_NAME)
        if curve_object is None:
            raise AssertionError("Generated linked Curve fixture did not reload intact")
        before = curve_state(curve_object)

        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = curve_object.evaluated_get(depsgraph)
        direct_mesh = evaluated.to_mesh()
        direct_to_mesh_is_none = direct_mesh is None
        if direct_mesh is not None:
            evaluated.to_mesh_clear()
        if not direct_to_mesh_is_none:
            raise AssertionError(
                "Fixture no longer reproduces Blender returning no evaluated Mesh "
                "for the linked POLY Curve source"
            )

        export_kwargs, dropped_kwargs = supported_export_kwargs()
        export_kwargs["filepath"] = str(stock_path)
        stock_result = bpy.ops.export_scene.gltf(**export_kwargs)
        if "FINISHED" not in stock_result:
            raise AssertionError(f"Stock glTF export failed: {stock_result}")
        stock_document, _chunks, _json_index = exporter._read_glb_document(
            str(stock_path), "inspect the Needle core legacy-Curve floor",
        )
        stock_nodes = [
            node for node in stock_document.get("nodes", [])
            if node.get("name") == CURVE_NAME
        ]
        stock_has_curve_mesh = any("mesh" in node for node in stock_nodes)
        if stock_has_curve_mesh:
            raise AssertionError(
                "The stock exporter unexpectedly emitted a mesh for the linked "
                "legacy Curve; refresh the recorded differential"
            )

        diagnostic = None
        try:
            exporter.collect_sidecar({}, None, export_kwargs=export_kwargs)
        except SystemExit as error:
            diagnostic = str(error)
        if diagnostic is None:
            raise AssertionError("Blendlink did not refuse the unevaluable linked Curve")
        required_fragments = (
            CURVE_NAME,
            "POLY",
            library_path.name,
            "local",
            "Mesh",
            "raw spline points",
        )
        missing = [fragment for fragment in required_fragments if fragment not in diagnostic]
        if missing:
            raise AssertionError(
                "Blendlink's linked-Curve diagnostic is missing artist-facing context: "
                + ", ".join(missing)
                + f"\nDiagnostic: {diagnostic}"
            )

        assert_cleanup_on_sampling_failure()
        after = curve_state(curve_object)
        if after != before:
            raise AssertionError(
                "Blendlink or the stock differential mutated the source scene state:\n"
                + json.dumps({"before": before, "after": after}, indent=2)
            )
        after_hashes = {
            "library": sha256(library_path),
            "main": sha256(main_path),
        }
        if after_hashes != source_hashes:
            raise AssertionError(
                "The diagnostic transaction modified a source .blend: "
                + json.dumps({"before": source_hashes, "after": after_hashes}, indent=2)
            )

        evidence_diagnostic = diagnostic.replace(str(temp), "<TEMP>")
        report = {
            "blenderVersion": bpy.app.version_string,
            "fixture": {
                "curve": CURVE_NAME,
                "splineType": "POLY",
                "linkedCurveData": library_path.name,
                "emptyEvaluatedGeometryModifier": "GN-Hide",
            },
            "needleCoreFloor": {
                "operatorResult": sorted(stock_result),
                "droppedUnsupportedKwargs": dropped_kwargs,
                "curveNodeCount": len(stock_nodes),
                "curveNodeHasMesh": stock_has_curve_mesh,
            },
            "blendlink": {
                "directEvaluatedMeshIsNone": direct_to_mesh_is_none,
                "diagnostic": evidence_diagnostic,
                "temporaryMeshCleanupOnFailure": True,
            },
            "source": {
                "stateUnchanged": True,
                "filesUnchanged": True,
            },
        }
        reset()

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(SENTINEL)


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    run(Path(arguments[0]).resolve() if arguments else None)
