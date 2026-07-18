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
import os
import re
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


def yup(vector) -> list[float]:
    """Blender Z-up world → glTF/three Y-up: (x, y, z) → (x, z, -y)."""
    return [round(vector[0], 6), round(vector[2], 6), round(-vector[1], 6)]


def collect_sidecar(settings: dict) -> dict:
    """Blender-only data the GLB cannot carry.

    - timeline markers (scroll-scrub waypoints), scene fps
    - empty display types/sizes (collider primitives, anchor semantics)
    - curves: bezier control points + handles, or evaluated points —
      glTF has no curve primitive (spec gap open since 2018), so this is
      the data every studio re-derives with a pasted Python snippet.
    """
    scene = bpy.context.scene
    fps = scene.render.fps / scene.render.fps_base

    markers = [
        {"name": marker.name, "frame": marker.frame, "time": round(marker.frame / fps, 4)}
        for marker in scene.timeline_markers
    ]

    empties = []
    for obj in scene.objects:
        if obj.type != "EMPTY":
            continue
        empties.append({
            "name": obj.name,
            "displayType": obj.empty_display_type,
            "size": round(obj.empty_display_size, 6),
        })

    curves = []
    sample_count = int(settings.get("curveSamples", 64))
    for obj in scene.objects:
        if obj.type != "CURVE" or obj.hide_render:
            continue
        matrix = obj.matrix_world
        for index, spline in enumerate(obj.data.splines):
            name = obj.name if index == 0 else f"{obj.name}.{index:03d}"
            if spline.type == "BEZIER":
                points = [
                    {
                        "co": yup(matrix @ point.co),
                        "handleLeft": yup(matrix @ point.handle_left),
                        "handleRight": yup(matrix @ point.handle_right),
                    }
                    for point in spline.bezier_points
                ]
                curves.append({
                    "name": name,
                    "kind": "bezier",
                    "cyclic": spline.use_cyclic_u,
                    "points": points,
                })
            else:
                # NURBS/poly: evaluate uniformly through a temporary mesh so
                # the browser reconstructs with CatmullRom without needing
                # Blender's basis functions.
                depsgraph = bpy.context.evaluated_depsgraph_get()
                evaluated = obj.evaluated_get(depsgraph)
                mesh = evaluated.to_mesh()
                sampled = [yup(matrix @ vertex.co) for vertex in mesh.vertices]
                evaluated.to_mesh_clear()
                if len(sampled) > sample_count:
                    step = max(1, len(sampled) // sample_count)
                    sampled = sampled[::step]
                curves.append({
                    "name": name,
                    "kind": "points",
                    "cyclic": spline.use_cyclic_u,
                    "points": sampled,
                })

    return {"fps": fps, "markers": markers, "empties": empties, "curves": curves}


NOIMP_PATTERN = re.compile(r"[-_]noimp$", re.IGNORECASE)
ATLAS_UV = "BLENDLINK_ATLAS"


# ---------------------------------------------------------------------------
# Baked-unlit mode ("the bake is the painting")
#
# Ported from the proven flagship pipeline: evaluate modifiers, pack one
# non-overlapping atlas, bake Cycles Combined on a single joined proxy (one
# GPU job — bpy.ops.object.bake runs a full job PER SELECTED OBJECT
# otherwise), save through the dithered Standard-view render path (plain
# image saves never dither and band), rebuild materials unlit, export.
# ---------------------------------------------------------------------------


def render_meshes() -> list:
    return [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH" and not obj.hide_render and len(obj.data.polygons) > 0
    ]


def bake_prepare_geometry(margin_px: int, size: int) -> None:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = render_meshes()
    if not meshes:
        raise SystemExit("baked mode: no render meshes in the scene")
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(
            evaluated, preserve_all_data_layers=True, depsgraph=depsgraph,
        )
        obj.data = mesh
        obj.modifiers.clear()

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        mesh = obj.data
        if len(mesh.uv_layers) == 0:
            mesh.uv_layers.new(name="UVMap")
        source = mesh.uv_layers[0]
        values = [loop.uv.copy() for loop in source.data]
        previous = mesh.uv_layers.get(ATLAS_UV)
        if previous is not None and previous != source:
            mesh.uv_layers.remove(previous)
        atlas = mesh.uv_layers.new(name=ATLAS_UV)
        for loop, value in zip(atlas.data, values):
            loop.uv = value
        mesh.uv_layers.active = atlas
        atlas.active_render = True
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    # Island spacing must exceed the bake-margin dilation or islands bleed
    # into neighbours; FRACTION guarantees an absolute gap.
    bpy.ops.uv.pack_islands(
        rotate=True,
        scale=True,
        merge_overlap=False,
        margin_method="FRACTION",
        margin=(margin_px + 4) / size,
        shape_method="CONCAVE",
    )
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_engine(samples: int) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    # Bake-time denoising darkens island margins (denoise runs before the
    # margin fill — blender/blender#94573); adaptive samples instead.
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.seed = 0
    scene.cycles.use_animated_seed = False
    scene.cycles.use_auto_tile = False
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
        for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
            try:
                preferences.compute_device_type = backend
            except TypeError:
                continue
            preferences.get_devices()
            gpus = [device for device in preferences.devices if device.type != "CPU"]
            if gpus:
                for device in preferences.devices:
                    device.use = device.type != "CPU"
                scene.cycles.device = "GPU"
                return
    except Exception:
        pass


def bake_proxy() -> tuple:
    originals = render_meshes()
    copies = []
    for obj in originals:
        duplicate = obj.copy()
        duplicate.data = obj.data.copy()
        bpy.context.scene.collection.objects.link(duplicate)
        duplicate.matrix_world = obj.matrix_world.copy()
        duplicate.parent = None
        copies.append(duplicate)
    hidden = [(obj, obj.hide_render) for obj in originals]
    for obj, _ in hidden:
        obj.hide_render = True
    bpy.ops.object.select_all(action="DESELECT")
    for duplicate in copies:
        duplicate.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    proxy = copies[0]
    proxy.name = "BLENDLINK_BAKE_PROXY"
    return proxy, hidden


def bake_state(proxy, image, margin_px: int) -> None:
    scene = bpy.context.scene
    scene.render.bake.use_clear = True
    scene.render.bake.margin = margin_px
    for flag in (
        "use_pass_direct", "use_pass_indirect", "use_pass_diffuse",
        "use_pass_glossy", "use_pass_transmission", "use_pass_emit",
    ):
        setattr(scene.render.bake, flag, True)
    for material in {slot.material for slot in proxy.material_slots if slot.material}:
        material.use_nodes = True
        nodes = material.node_tree.nodes
        target = nodes.get("BLENDLINK_BAKE_TARGET") or nodes.new("ShaderNodeTexImage")
        target.name = "BLENDLINK_BAKE_TARGET"
        target.image = image
        uv = nodes.get("BLENDLINK_BAKE_UV") or nodes.new("ShaderNodeUVMap")
        uv.name = "BLENDLINK_BAKE_UV"
        uv.uv_map = ATLAS_UV
        if not target.inputs["Vector"].is_linked:
            material.node_tree.links.new(uv.outputs["UV"], target.inputs["Vector"])
        nodes.active = target
        target.select = True
    bpy.ops.object.select_all(action="DESELECT")
    proxy.select_set(True)
    bpy.context.view_layer.objects.active = proxy
    bpy.ops.object.bake(
        type="COMBINED", target="IMAGE_TEXTURES", margin=margin_px,
        use_clear=True, uv_layer=ATLAS_UV,
    )


def save_dithered(image, path: str) -> None:
    scene = bpy.context.scene
    settings = scene.render.image_settings
    settings.file_format = "PNG"
    settings.color_mode = "RGB"
    settings.color_depth = "8"
    scene.render.dither_intensity = 1.0
    image.save_render(path, scene=scene)


def set_collections_hidden(names: list, hidden: bool) -> None:
    for name in names:
        collection = bpy.data.collections.get(name)
        if collection is not None:
            collection.hide_render = hidden


def progress(fraction: float, label: str) -> None:
    """Stream a machine-readable progress line (only when a wrapper asks).

    The invoker echoes ##blendlink lines live to whoever launched the sync
    (e.g. the Blender addon's Sync Now progress bar)."""
    if os.environ.get("BLENDLINK_PROGRESS") != "1":
        return
    payload = {"fraction": max(0.0, min(1.0, fraction)), "label": label}
    print(f"##blendlink {json.dumps(payload)}", flush=True)


def run_baked_mode(settings: dict, out_glb: str) -> dict:
    bake = settings.get("bake", {})
    size = int(bake.get("size", 2048))
    samples = int(bake.get("samples", 128))
    margin_px = int(bake.get("margin", 48))
    states = bake.get("states") or [{"name": "default", "hideCollections": []}]

    progress(0.10, "packing bake atlas")
    bake_prepare_geometry(margin_px, size)
    bake_engine(samples)
    proxy, hidden = bake_proxy()

    state_paths = {}
    image = bpy.data.images.new(
        "blendlink-bake", width=size, height=size, alpha=False, float_buffer=True,
    )
    try:
        per_state = 0.6 / max(len(states), 1)
        for index, state in enumerate(states):
            progress(0.15 + index * per_state, f"baking {state['name']} at {size}px")
            hide = state.get("hideCollections", [])
            set_collections_hidden(hide, True)
            try:
                bake_state(proxy, image, margin_px)
            finally:
                set_collections_hidden(hide, False)
            state_path = out_glb + f".state.{state['name']}.png"
            save_dithered(image, state_path)
            state_paths[state["name"]] = state_path
    finally:
        mesh = proxy.data
        bpy.data.objects.remove(proxy)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
        for obj, old in hidden:
            obj.hide_render = old

    # Rebuild every material as an unlit view of the default-state bake.
    progress(0.78, "rebuilding materials unlit")
    first_state = states[0]["name"]
    baked = bpy.data.images.load(state_paths[first_state], check_existing=False)
    baked.colorspace_settings.name = "sRGB"
    for obj in render_meshes():
        for slot in obj.material_slots:
            material = slot.material
            if material is None:
                continue
            material.use_nodes = True
            nodes = material.node_tree.nodes
            nodes.clear()
            output = nodes.new("ShaderNodeOutputMaterial")
            background = nodes.new("ShaderNodeBackground")
            uv = nodes.new("ShaderNodeUVMap")
            uv.uv_map = ATLAS_UV
            texture = nodes.new("ShaderNodeTexImage")
            texture.image = baked
            material.node_tree.links.new(uv.outputs["UV"], texture.inputs["Vector"])
            material.node_tree.links.new(texture.outputs["Color"], background.inputs["Color"])
            material.node_tree.links.new(background.outputs["Background"], output.inputs["Surface"])
        # Atlas becomes TEXCOORD_0 everywhere (a shared glTF material can
        # only reference one texcoord index).
        mesh = obj.data
        for layer in [l for l in mesh.uv_layers if l.name != ATLAS_UV]:
            mesh.uv_layers.remove(layer)
        mesh.uv_layers.active_index = 0
        mesh.uv_layers[0].active_render = True

    return {"states": {name: path for name, path in state_paths.items()}}


def remove_noimp_objects() -> list[str]:
    """Godot's -noimp convention: never export, but never silently either."""
    removed = []
    for obj in list(bpy.context.scene.objects):
        if NOIMP_PATTERN.search(obj.name):
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
    return sorted(removed)


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

    excluded = remove_noimp_objects()
    sidecar = collect_sidecar(settings)

    baked_report = {}
    if settings.get("mode") == "baked":
        baked_report = run_baked_mode(settings, out_path)

    progress(0.82, "writing glTF")
    bpy.ops.export_scene.gltf(**kwargs)

    result = {
        "ok": True,
        "blenderVersion": bpy.app.version_string,
        "exporterKwargsDropped": dropped,
        "warnings": warnings,
        "collection": collection,
        "excluded": excluded,
        "sidecar": sidecar,
        "baked": baked_report,
    }
    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle)
    print("BLENDLINK_OK export")


if __name__ == "__main__":
    main()
