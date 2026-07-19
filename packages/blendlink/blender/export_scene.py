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

import bmesh
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
# Collision-only proxies ship in the GLB (physics needs the geometry) but
# never render — keep them out of the atlas pack and the bake.
COLONLY_PATTERN = re.compile(r"[-_](conv)?colonly(\.\d{3})?$", re.IGNORECASE)
ATLAS_UV = "BLENDLINK_ATLAS"


def is_collision_proxy(obj) -> bool:
    role = obj.get("blendlink_role")
    if isinstance(role, str) and role.lower().strip() in ("colonly", "convcolonly"):
        return True
    return bool(COLONLY_PATTERN.search(obj.name))


# ---------------------------------------------------------------------------
# Baked-unlit mode ("the bake is the painting")
#
# Ported from the proven flagship pipeline: evaluate modifiers, pack one
# non-overlapping atlas, bake Cycles Combined on a single joined proxy (one
# GPU job — bpy.ops.object.bake runs a full job PER SELECTED OBJECT
# otherwise), save through the dithered Standard-view render path (plain
# image saves never dither and band), rebuild materials unlit, export.
# ---------------------------------------------------------------------------


def texel_weight_of(obj) -> float:
    """Artist lightmap scale (Unity semantics): linear per-axis multiplier,
    default 1; 0 excludes the object from the atlas and export while it
    keeps lighting the bakes."""
    try:
        return max(0.0, float(obj.get("texel_weight", 1.0)))
    except (TypeError, ValueError):
        return 1.0


def render_meshes() -> list:
    return [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH" and not obj.hide_render
        and len(obj.data.polygons) > 0 and not is_collision_proxy(obj)
        and texel_weight_of(obj) > 0.0
    ]


def quantize_half_pow2(value: float) -> float:
    """Snap to 2^(k/2): pack-layout hysteresis across minor scene edits."""
    import math

    if value <= 0.0:
        return 0.0
    return 2.0 ** (round(math.log2(value) * 2.0) / 2.0)


def compute_texel_weights(meshes: list) -> dict:
    """auto (camera-distance, median-normalized, clamped, quantized) × artist.

    The auto weight equalizes texels-per-SCREEN-pixel: required linear
    density is proportional to 1/distance from the authored camera. Scenes
    without a camera get a flat baseline (artist weights still apply).
    """
    from mathutils import Vector

    camera = bpy.context.scene.camera
    raw = {}
    for obj in meshes:
        auto = 1.0
        if camera is not None:
            center = obj.matrix_world @ (
                0.125 * sum((Vector(corner) for corner in obj.bound_box), Vector())
            )
            distance = max((camera.matrix_world.translation - center).length, 0.2)
            auto = 1.0 / distance
        raw[obj.name] = auto
    values = sorted(raw.values())
    median = values[len(values) // 2] if values else 1.0
    weights = {}
    for obj in meshes:
        normalized = raw[obj.name] / median if median > 0 else 1.0
        auto = quantize_half_pow2(min(max(normalized, 0.25), 4.0))
        weights[obj.name] = {"auto": auto, "artist": texel_weight_of(obj)}
    return weights


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
    # Baseline: equalize px/m across the atlas (authored UV scales are
    # arbitrary), then apply texel weights as island pre-scales —
    # pack_islands(scale=True) preserves relative island scale, so the
    # pre-scale IS the weight (Unity Scale-in-Lightmap semantics).
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    weights = compute_texel_weights(meshes)
    for obj in meshes:
        entry = weights[obj.name]
        final = entry["auto"] * entry["artist"]
        if final != 1.0:
            layer = obj.data.uv_layers.get(ATLAS_UV)
            for loop in layer.data:
                loop.uv *= final
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    # Island spacing must exceed the bake-margin dilation or islands bleed
    # into neighbours; FRACTION guarantees an absolute gap.
    bpy.ops.uv.pack_islands(
        rotate=True,
        # 90-degree steps keep island edges texel-aligned — they dilate,
        # mip, and block-compress cleaner than free rotation.
        rotate_method="CARDINAL",
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
    # Meshes without materials cannot host a bake-target node — Cycles dies
    # with "No active image found". Bare primitives are the first thing a
    # new user bakes, so give the proxy a neutral surface instead.
    default = bpy.data.materials.get("BLENDLINK_DEFAULT_SURFACE")
    if default is None:
        default = bpy.data.materials.new("BLENDLINK_DEFAULT_SURFACE")
        default.use_nodes = True
    if not proxy.material_slots:
        proxy.data.materials.append(default)
    for slot in proxy.material_slots:
        if slot.material is None:
            slot.material = default
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


def image_coverage(image):
    """Boolean (height, width) coverage from the bake target's alpha: the
    target clears transparent and Cycles writes opaque texels."""
    import numpy as np

    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(height, width, 4)[:, :, 3] > 0.5


def flatten_saved_background(path: str, covered) -> None:
    """Rewrite the saved atlas's background to ONE constant byte value.

    Mip level N keeps only 1/2^N of the authored island padding, so the deep
    mips of a black-background atlas average dark halos into island edges.
    The bake-margin dilation covers the island-local band; the far-field
    wants the mean island color — but as an exact CONSTANT: dither and OIDN
    both put grain on the saved background, and grain on invisible pixels
    balloons the encoded payloads. Byte surgery on the saved file, after
    every lossy stage, is the only ordering that guarantees flatness.
    """
    import numpy as np

    if covered.all():
        # Full alpha coverage means the transparent clear never happened —
        # say so, a silent skip here once hid a broken coverage contract.
        print("blendlink: background fill skipped — alpha reports full coverage")
        return
    if covered.sum() < covered.size * 0.01:
        print("blendlink: background fill skipped — no baked coverage in alpha")
        return
    image = bpy.data.images.load(path, check_existing=False)
    try:
        width, height = image.size
        if (height, width) != covered.shape:
            print("blendlink: background fill skipped — saved size mismatch")
            return
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        rgba = pixels.reshape(height, width, 4)
        # Byte-backed pixels round-trip as value/255 with no transforms, so
        # a k/255 constant survives the re-save exactly.
        mean = np.round(rgba[:, :, :3][covered].mean(axis=0) * 255.0) / 255.0
        rgba[:, :, :3][~covered] = mean
        rgba[:, :, 3] = 1.0
        image.pixels.foreach_set(pixels)
        image.filepath_raw = path
        image.file_format = "PNG"
        image.save()
    finally:
        bpy.data.images.remove(image)


def save_dithered(image, path: str) -> None:
    scene = bpy.context.scene
    settings = scene.render.image_settings
    settings.file_format = "PNG"
    settings.color_mode = "RGB"
    settings.color_depth = "8"
    scene.render.dither_intensity = 1.0
    image.save_render(path, scene=scene)


def save_denoised(image, path: str) -> None:
    """OIDN via a throwaway compositor scene: Image → Denoise → Composite.

    The stage scene is EMPTY (renders instantly under Workbench) and its
    Composite output becomes the written file, through the same Standard
    view + dither contract. Runs after margin dilation, sidestepping the
    bake-time-denoise margin-darkening bug (blender#94573)."""
    stage = bpy.data.scenes.new("BLENDLINK_DENOISE_STAGE")
    tree = None
    owns_tree = False
    try:
        stage.render.engine = "BLENDER_WORKBENCH"
        stage.render.resolution_x = image.size[0]
        stage.render.resolution_y = image.size[1]
        stage.render.resolution_percentage = 100
        stage.view_settings.view_transform = "Standard"
        stage.view_settings.look = "None"
        stage.view_settings.exposure = 0.0
        stage.render.dither_intensity = 1.0
        settings = stage.render.image_settings
        settings.file_format = "PNG"
        settings.color_mode = "RGB"
        settings.color_depth = "8"
        # Blender 5.x: the compositor is a node group on the scene; output
        # flows through NodeGroupOutput (CompositorNodeComposite is gone).
        # 4.x keeps the embedded scene.node_tree.
        if hasattr(stage, "node_tree") and not hasattr(stage, "compositing_node_group"):
            stage.use_nodes = True
            tree = stage.node_tree
            tree.nodes.clear()
            sink = tree.nodes.new("CompositorNodeComposite")
            owns_tree = False
        else:
            tree = bpy.data.node_groups.new("BLENDLINK_DENOISE_TREE", "CompositorNodeTree")
            tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
            sink = tree.nodes.new("NodeGroupOutput")
            stage.compositing_node_group = tree
            owns_tree = True
        source = tree.nodes.new("CompositorNodeImage")
        source.image = image
        denoise = tree.nodes.new("CompositorNodeDenoise")
        tree.links.new(source.outputs["Image"], denoise.inputs["Image"])
        tree.links.new(denoise.outputs["Image"], sink.inputs["Image"])
        stage.render.filepath = path
        bpy.ops.render.render(write_still=True, scene=stage.name)
    finally:
        if tree is not None and owns_tree and tree.name in bpy.data.node_groups:
            bpy.data.node_groups.remove(tree)
        bpy.data.scenes.remove(stage)


def save_resolved(image, path: str, final_size: int, denoise: bool = False) -> None:
    """Save at final_size: supersampled bakes resolve down through a copy so
    the live bake target keeps its full resolution for the next state."""
    target = image
    duplicate = None
    if image.size[0] != final_size:
        duplicate = image.copy()
        duplicate.scale(final_size, final_size)
        target = duplicate
    try:
        # Coverage at the SAVED size (alpha survives the resolve scale);
        # captured before saving because the 8-bit save discards alpha.
        covered = image_coverage(target)
        if denoise:
            try:
                save_denoised(target, path)
            except Exception as error:  # noqa: BLE001 — enhancement, never a gate
                print(f"BLENDLINK_DENOISE_FALLBACK {error}")
                save_dithered(target, path)
        else:
            save_dithered(target, path)
        flatten_saved_background(path, covered)
    finally:
        if duplicate is not None:
            bpy.data.images.remove(duplicate)


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


def compute_bake_plan(settings: dict) -> dict:
    """Everything an artist wants to know BEFORE the bake, computed from the
    UV pack alone (no Cycles work): per-object texel density, atlas share,
    occupancy, and the state list. The re-bake causes on record are density
    discovered too late and one object hogging the atlas — this is the lint.
    """
    bake = settings.get("bake", {})
    size = int(bake.get("size", 2048))
    margin_px = int(bake.get("margin", 48))
    states = bake.get("states") or [{"name": "default"}]
    bake_prepare_geometry(margin_px, size)

    from mathutils import Vector

    camera = bpy.context.scene.camera
    camera_position = camera.matrix_world.translation if camera else None
    meshes = render_meshes()
    weights = compute_texel_weights(meshes)
    objects = []
    total_uv = 0.0
    for obj in meshes:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.transform(obj.matrix_world)
        surface = sum(face.calc_area() for face in bm.faces)
        uv_layer = bm.loops.layers.uv.get(ATLAS_UV)
        uv_area = 0.0
        if uv_layer is not None:
            for face in bm.faces:
                coords = [loop[uv_layer].uv for loop in face.loops]
                shoelace = 0.0
                for i, current in enumerate(coords):
                    following = coords[(i + 1) % len(coords)]
                    shoelace += current.x * following.y - following.x * current.y
                uv_area += abs(shoelace) / 2.0
        bm.free()
        total_uv += uv_area
        px_per_meter = ((uv_area * size * size) / surface) ** 0.5 if surface > 0 else 0.0
        distance = None
        if camera_position is not None:
            center = obj.matrix_world @ (
                0.125 * sum((Vector(corner) for corner in obj.bound_box), Vector())
            )
            distance = max((camera_position - center).length, 0.2)
        entry = weights.get(obj.name, {"auto": 1.0, "artist": 1.0})
        objects.append({
            "name": obj.name,
            "areaM2": round(surface, 3),
            "uvShare": round(uv_area, 5),
            "pxPerMeter": round(px_per_meter, 1),
            "cameraDistance": round(distance, 2) if distance is not None else None,
            # Equal perceived quality = equal px/m x distance.
            "screenDensity": round(px_per_meter * distance, 1) if distance is not None else None,
            "autoWeight": entry["auto"],
            "artistWeight": entry["artist"],
        })

    # Worst perceived quality first — the offender list leads.
    objects.sort(key=lambda entry: entry["screenDensity"] if entry["screenDensity"] is not None else entry["pxPerMeter"])
    warnings = []
    metric = "screenDensity" if camera_position is not None else "pxPerMeter"
    densities = sorted(entry[metric] for entry in objects if entry[metric])
    if densities:
        median = densities[len(densities) // 2]
        for entry in objects:
            value = entry[metric]
            if value and median > 0:
                ratio = value / median
                if ratio < 0.5:
                    warnings.append(
                        f"{entry['name']} sits {median / value:.1f}x below the median "
                        f"screen density — it will look blurry at its closest approach "
                        f"(raise its texel_weight)"
                    )
                elif ratio > 2.0:
                    warnings.append(
                        f"{entry['name']} sits {ratio:.1f}x above the median screen "
                        f"density — it is hogging atlas space (lower its texel_weight)"
                    )
    light_groups = sorted({
        obj.lightgroup for obj in bpy.context.scene.objects
        if obj.type == "LIGHT" and getattr(obj, "lightgroup", "")
    })
    collision_proxies = sorted(
        obj.name for obj in bpy.context.scene.objects
        if obj.type == "MESH" and is_collision_proxy(obj)
    )
    return {
        "supersample": max(1, int(bake.get("supersample", 1))),
        "atlasSize": size,
        "marginPx": margin_px,
        "samples": int(bake.get("samples", 128)),
        "occupancy": round(total_uv, 4),
        "states": [state["name"] for state in states],
        "lightGroups": light_groups,
        "bakeCount": len(states) + len(light_groups),
        "objects": objects,
        "collisionProxies": collision_proxies,
        "warnings": warnings,
    }


def mute_emission() -> list:
    """Best-effort: zero unlinked emission during light-group solo bakes so
    emissive surfaces don't stamp themselves into every group's layer.
    Node-driven emission is left alone (its bounce stays in the base)."""
    muted = []
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            sockets = []
            if node.type == "EMISSION":
                sockets.append(node.inputs.get("Strength"))
            elif node.type == "BSDF_PRINCIPLED":
                sockets.append(node.inputs.get("Emission Strength"))
            for socket in sockets:
                if socket is not None and not socket.is_linked and socket.default_value:
                    muted.append((socket, socket.default_value))
                    socket.default_value = 0.0
    return muted


def bake_light_groups(
    proxy, image, margin_px: int, grouped_lights: dict, out_glb: str,
    progress_start: float, progress_step: float, final_size: int,
    denoise: bool = False,
) -> dict:
    """Solo-bake each light group's full contribution (direct + indirect).

    Cycles cannot bake light-group AOVs, but a Combined bake with only that
    group's lights enabled IS its contribution, by linearity. World goes
    black and unlinked emission is muted so nothing else leaks in. Layers
    are peak-normalized to survive 8-bit PNG; maxValue rides the manifest so
    the runtime can rescale (layer * maxValue * tint * strength, added in
    linear space).
    """
    import numpy as np

    scene = bpy.context.scene
    all_lights = [obj for obj in scene.objects if obj.type == "LIGHT"]
    lights_prev = [(light, light.hide_render) for light in all_lights]
    world_prev = scene.world
    black = bpy.data.worlds.new("BLENDLINK_BLACK_WORLD")
    black.use_nodes = True
    background = black.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        background.inputs["Strength"].default_value = 0.0
    muted = mute_emission()

    layers = {}
    try:
        scene.world = black
        for index, (name, lights) in enumerate(sorted(grouped_lights.items())):
            progress(progress_start + index * progress_step, f"baking light group '{name}'")
            for light, _ in lights_prev:
                light.hide_render = light not in lights
            bake_state(proxy, image, margin_px)

            pixels = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
            image.pixels.foreach_get(pixels)
            rgb = pixels.reshape(-1, 4)[:, :3]
            peak = float(rgb.max())
            if peak > 1.0:
                rgb /= peak
                image.pixels.foreach_set(pixels)
            layer_path = out_glb + f".light.{name}.png"
            save_resolved(image, layer_path, final_size, denoise=denoise)
            layers[name] = {"path": layer_path, "maxValue": max(peak, 1.0)}
    finally:
        scene.world = world_prev
        for light, old in lights_prev:
            light.hide_render = old
        for socket, value in muted:
            socket.default_value = value
        bpy.data.worlds.remove(black)
    return layers


def run_baked_mode(settings: dict, out_glb: str) -> dict:
    bake = settings.get("bake", {})
    size = int(bake.get("size", 2048))
    samples = int(bake.get("samples", 128))
    margin_px = int(bake.get("margin", 48))
    # Cycles bakes have no edge anti-aliasing; baking at N× and box-resolving
    # down (Blender's bilinear scale on an exact 2× grid IS a box filter) is
    # the standard workaround — quality at zero runtime cost.
    supersample = max(1, int(bake.get("supersample", 1)))
    denoise = bool(bake.get("denoise", False))
    bake_size = size * supersample
    bake_margin = margin_px * supersample
    states = bake.get("states") or [{"name": "default", "hideCollections": []}]

    progress(0.10, "packing bake atlas")
    bake_prepare_geometry(bake_margin, bake_size)
    bake_engine(samples)
    proxy, hidden = bake_proxy()

    # Lights assigned to a Cycles Light Group become interactive: excluded
    # from the base/state bakes, then solo-baked as additive contribution
    # layers (light adds linearly — Quake lightstyles' 30-year-old exploit).
    grouped_lights = {}
    for obj in bpy.context.scene.objects:
        if obj.type == "LIGHT" and getattr(obj, "lightgroup", ""):
            grouped_lights.setdefault(obj.lightgroup, []).append(obj)

    state_paths = {}
    group_layers = {}
    # alpha=True is the coverage contract: bake use_clear resets to
    # transparent, Cycles writes opaque texels, fill_image_background reads
    # the difference.
    image = bpy.data.images.new(
        "blendlink-bake", width=bake_size, height=bake_size, alpha=True, float_buffer=True,
    )
    bake_jobs = len(states) + len(grouped_lights)
    per_job = 0.6 / max(bake_jobs, 1)
    job = 0
    try:
        grouped_flat = [light for lights in grouped_lights.values() for light in lights]
        grouped_prev = [(light, light.hide_render) for light in grouped_flat]
        for light, _ in grouped_prev:
            light.hide_render = True
        try:
            for state in states:
                progress(0.15 + job * per_job, f"baking {state['name']} at {bake_size}px")
                job += 1
                hide = state.get("hideCollections", [])
                set_collections_hidden(hide, True)
                try:
                    bake_state(proxy, image, bake_margin)
                finally:
                    set_collections_hidden(hide, False)
                state_path = out_glb + f".state.{state['name']}.png"
                save_resolved(image, state_path, size, denoise=denoise)
                state_paths[state["name"]] = state_path
        finally:
            for light, old in grouped_prev:
                light.hide_render = old

        if grouped_lights:
            group_layers = bake_light_groups(
                proxy, image, bake_margin, grouped_lights, out_glb,
                progress_start=0.15 + job * per_job, progress_step=per_job,
                final_size=size, denoise=denoise,
            )
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

    return {
        "states": {name: path for name, path in state_paths.items()},
        "lightGroups": group_layers,
    }


def remove_noimp_objects() -> list[str]:
    """Godot's -noimp convention: never export, but never silently either.
    The blendlink_role custom property is the explicit override channel."""
    removed = []
    for obj in list(bpy.context.scene.objects):
        role = obj.get("blendlink_role")
        by_property = isinstance(role, str) and role.lower().strip() == "noimp"
        if by_property or NOIMP_PATTERN.search(obj.name):
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
    return sorted(removed)


def main() -> None:
    out_path, settings_path, result_path = parse_argv()
    with open(settings_path, "r", encoding="utf-8") as handle:
        settings = json.load(handle)

    if settings.get("planOnly"):
        excluded = remove_noimp_objects()
        plan = compute_bake_plan(settings)
        result = {
            "ok": True,
            "blenderVersion": bpy.app.version_string,
            "exporterKwargsDropped": [],
            "warnings": [],
            "collection": settings.get("collection"),
            "excluded": excluded,
            "sidecar": {"fps": 0, "markers": [], "empties": [], "curves": []},
            "baked": {},
            "plan": plan,
        }
        with open(result_path, "w", encoding="utf-8") as handle:
            json.dump(result, handle)
        print("BLENDLINK_OK plan")
        return

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
    plan = None
    if settings.get("mode") == "baked":
        # The plan rides along on every real sync so the manifest can carry
        # per-object density — the addon shows it next to the Lightmap Scale
        # slider. The UV prep it runs is idempotent; the bake re-runs it.
        plan = compute_bake_plan(settings)
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
        "plan": plan,
    }
    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle)
    print("BLENDLINK_OK export")


if __name__ == "__main__":
    main()
