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

# Shared bake primitives live in bakelib.py beside this script — the ONE
# home for logic external pipelines also import. Never inline a copy here.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakelib  # noqa: E402

progress = bakelib.progress
quantize_half_pow2 = bakelib.quantize_half_pow2
save_dithered = bakelib.save_dithered
save_denoised = bakelib.save_denoised
save_resolved = bakelib.save_resolved
image_coverage = bakelib.image_coverage
flatten_saved_background = bakelib.flatten_saved_background


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


# .NNN-tolerant like every other suffix: the un-tolerant version shipped
# RefGrid-noimp.001 to the web while the addon blessed it (conformance
# fixture cases lock all three parsers together now).
NOIMP_PATTERN = re.compile(r"[-_]noimp(\.\d{3})?$", re.IGNORECASE)
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
    return bakelib.texel_weight_of(obj)


def dynamic_reason(obj) -> str | None:
    """Why this mesh is DYNAMIC (lit at runtime) instead of baked, or None.

    Mixed scenes are the honest answer to characters, glass, and hand-held
    lights: a static lightmap on a deforming or see-through surface is
    wrong by construction, so those keep their real materials and real-time
    lighting while the environment ships as the painting. Explicit override:
    the blendlink_dynamic property (truthy = lit, 0/False = force-bake).
    """
    explicit = obj.get("blendlink_dynamic")
    if explicit is not None:
        return "blendlink_dynamic property" if explicit else None
    if any(mod.type == "ARMATURE" for mod in obj.modifiers):
        return "armature-deformed (a static lightmap cannot deform)"
    for slot in obj.material_slots:
        material = slot.material
        if material is None:
            continue
        if getattr(material, "surface_render_method", "") == "BLENDED":
            return f"transparent material {material.name!r}"
        if getattr(material, "blend_method", "OPAQUE") == "BLEND":
            return f"transparent material {material.name!r}"
    return None


def render_meshes() -> list:
    """The BAKED mesh set: everything the atlas pack and bake touch.
    Dynamic (lit) meshes still export — they are simply not in here."""
    return [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH" and not obj.hide_render
        and len(obj.data.polygons) > 0 and not is_collision_proxy(obj)
        and texel_weight_of(obj) > 0.0 and dynamic_reason(obj) is None
    ]


def visible_render_meshes() -> list:
    """Render meshes excluding anything in a render-hidden collection —
    collection hide_render does not set obj.hide_render, and the bake proxy
    must respect state hideCollections (geometry states, not just lights)."""
    return [
        obj for obj in render_meshes()
        if not any(coll.hide_render for coll in obj.users_collection)
    ]


def camera_positions() -> list:
    """World positions of EVERY scene camera — density and atlas assignment
    both want the worst case over authored viewpoints, not just the active
    camera (a compact/portrait camera can approach closer than the main)."""
    return [
        obj.matrix_world.translation.copy()
        for obj in bpy.context.scene.objects
        if obj.type == "CAMERA"
    ]


def nearest_camera_distance(obj, cameras: list):
    """Distance from the object's bounds center to the closest camera, or
    None when the scene has no cameras. Floored at 0.2m."""
    if not cameras:
        return None
    from mathutils import Vector

    center = obj.matrix_world @ (
        0.125 * sum((Vector(corner) for corner in obj.bound_box), Vector())
    )
    return max(min((position - center).length for position in cameras), 0.2)


def atlas_config(bake: dict) -> dict:
    """Declared atlases, or the implicit single atlas 'main'. Each entry:
    {size, maxCameraDistance?}. Users configure ATLASES; objects are
    auto-assigned by proximity and overridden per-object — never a
    hand-maintained object list in the config."""
    atlases = bake.get("atlases")
    if not atlases:
        return {"main": {"size": int(bake.get("size", 2048))}}
    resolved = {}
    for name, entry in atlases.items():
        resolved[name] = {"size": int(entry.get("size", 2048))}
        if "maxCameraDistance" in entry:
            resolved[name]["maxCameraDistance"] = float(entry["maxCameraDistance"])
    return resolved


def assign_atlases(meshes: list, atlases: dict) -> tuple:
    """group -> [objects], plus warnings. Precedence per object: the
    blendlink_atlas property wins; else the first declared atlas whose
    maxCameraDistance covers the object's nearest-camera distance; else
    the catch-all (last atlas without a threshold). The resolved group is
    stamped back as blendlink_atlas so it ships in the GLB extras for the
    runtime (the export scene is disposable; the .blend is never saved).
    """
    names = list(atlases)
    catch_all = next(
        (name for name in reversed(names) if "maxCameraDistance" not in atlases[name]),
        names[-1],
    )
    cameras = camera_positions()
    groups = {name: [] for name in names}
    warnings = []
    for obj in meshes:
        override = obj.get("blendlink_atlas")
        group = None
        if isinstance(override, str):
            if override in atlases:
                group = override
            else:
                warnings.append(
                    f"{obj.name}: blendlink_atlas '{override}' is not a declared "
                    f"atlas ({', '.join(names)}) — auto-assigned instead"
                )
        if group is None:
            group = catch_all
            distance = nearest_camera_distance(obj, cameras)
            if distance is not None:
                for name in names:
                    threshold = atlases[name].get("maxCameraDistance")
                    if threshold is not None and distance <= threshold:
                        group = name
                        break
        obj["blendlink_atlas"] = group
        groups[group].append(obj)
    return groups, warnings


def compute_texel_weights(meshes: list) -> dict:
    """auto (camera-distance, median-normalized, clamped, quantized) × artist.

    The auto weight equalizes texels-per-SCREEN-pixel: required linear
    density is proportional to 1/distance, taken as the WORST CASE over
    every authored camera. Scenes without a camera get a flat baseline
    (artist weights still apply).
    """
    cameras = camera_positions()
    raw = {}
    for obj in meshes:
        distance = nearest_camera_distance(obj, cameras)
        raw[obj.name] = 1.0 / distance if distance is not None else 1.0
    values = sorted(raw.values())
    median = values[len(values) // 2] if values else 1.0
    weights = {}
    for obj in meshes:
        normalized = raw[obj.name] / median if median > 0 else 1.0
        auto = quantize_half_pow2(min(max(normalized, 0.25), 4.0))
        weights[obj.name] = {"auto": auto, "artist": texel_weight_of(obj)}
    return weights


def bake_prepare_geometry(bake: dict, supersample: int = 1) -> dict:
    """Freeze, unwrap-fallback, then per-atlas average + weight + pack.

    Returns the layout: {group: {objects, size, margin}} at FINAL
    resolution (bake-time images are ×supersample; the pack margin is a
    fraction, identical at both scales). The config margin is authored
    against the LARGEST declared atlas and scales down per group, so a
    small background atlas never spends 40% of itself on gutters.
    """
    meshes = render_meshes()
    if not meshes:
        raise SystemExit(
            "baked mode: no bakeable meshes in the scene (every render mesh "
            "is dynamic, zero-weight, or a collision proxy)"
        )
    # Two-phase evaluate-then-assign: interleaving dirties the depsgraph
    # mid-loop and makes inter-object modifiers order-dependent.
    bakelib.freeze_evaluated_meshes(meshes)
    # Unwrapped meshes get a real projection — Blender's default UV reset
    # maps every face to the full unit square, which shatters the pack.
    bakelib.ensure_authored_uvs(meshes)

    for obj in meshes:
        mesh = obj.data
        source = mesh.uv_layers[0]
        values = [loop.uv.copy() for loop in source.data]
        previous = mesh.uv_layers.get(ATLAS_UV)
        if previous is not None and previous != source:
            mesh.uv_layers.remove(previous)
        atlas = mesh.uv_layers.new(name=ATLAS_UV)
        for loop, value in zip(atlas.data, values):
            loop.uv = value
        # Active-for-editing so the UV ops below hit the atlas layer — but
        # NOT active_render: an Image Texture with an unconnected Vector
        # samples the active-render map, so flipping it here would bake
        # every implicit-UV texture through the PACKED coordinates. The
        # authored layer keeps active_render until the unlit rebuild strips
        # the extra layers at export.
        mesh.uv_layers.active = atlas

    atlases = atlas_config(bake)
    groups, assign_warnings = assign_atlases(meshes, atlases)
    reference = max(entry["size"] for entry in atlases.values())
    base_margin = int(bake.get("margin", 48))
    weights = compute_texel_weights(meshes)
    layout = {"_warnings": assign_warnings}
    for name, entry in atlases.items():
        objs = groups[name]
        margin = max(1, round(base_margin * entry["size"] / reference))
        layout[name] = {"objects": objs, "size": entry["size"], "margin": margin}
        if not objs:
            continue
        # Baseline: equalize px/m across THIS atlas (authored UV scales are
        # arbitrary), then apply texel weights as island pre-scales —
        # pack_islands(scale=True) preserves relative island scale, so the
        # pre-scale IS the weight (Unity Scale-in-Lightmap semantics).
        bakelib.average(objs)
        bakelib.scale_islands(
            objs, ATLAS_UV,
            lambda obj: weights[obj.name]["auto"] * weights[obj.name]["artist"],
        )
        bakelib.pack(objs, margin * supersample, entry["size"] * supersample)
    return layout


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
    """Joined proxy of the CURRENTLY VISIBLE render meshes — rebuilt per
    state so hideCollections can change geometry, not just lights."""
    return bakelib.join_proxy(
        visible_render_meshes(), "BLENDLINK_BAKE_PROXY", "BLENDLINK_DEFAULT_SURFACE",
    )


def set_bake_targets(proxy, image) -> None:
    """Point every proxy material's bake-target node at `image` and select
    exactly the proxy — shared setup for state, layer, and guide bakes."""
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


def bake_state(proxy, image, margin_px: int, emit: bool = True) -> None:
    scene = bpy.context.scene
    scene.render.bake.use_clear = True
    scene.render.bake.margin = margin_px
    for flag in (
        "use_pass_direct", "use_pass_indirect", "use_pass_diffuse",
        "use_pass_glossy", "use_pass_transmission",
    ):
        setattr(scene.render.bake, flag, True)
    # Light-group layers pass emit=False: surface self-emission already
    # lives in the base state, and mute_emission cannot reach node-driven
    # (linked) emission — baking it into every layer would add N+1 copies
    # of the monitor glow at runtime.
    scene.render.bake.use_pass_emit = emit
    set_bake_targets(proxy, image)
    bpy.ops.object.bake(
        type="COMBINED", target="IMAGE_TEXTURES", margin=margin_px,
        use_clear=True, uv_layer=ATLAS_UV,
    )


def bake_denoise_guides(proxy, size: int, group: str, margin_px: int) -> tuple:
    """Albedo + normal guide bakes for GUIDED OIDN denoising.

    Unguided OIDN reads authored micro-texture (plaster, wood grain) as
    noise and launders it away; the Denoise node's Albedo/Normal inputs are
    the fix. Both guides are cheap — one sample: albedo is a lightless
    surface evaluation, the normal pass is deterministic.
    """
    scene = bpy.context.scene
    prior_samples = scene.cycles.samples
    prior_adaptive = scene.cycles.use_adaptive_sampling
    scene.cycles.samples = 1
    scene.cycles.use_adaptive_sampling = False
    try:
        albedo = bpy.data.images.new(
            f"blendlink-albedo-{group}", width=size, height=size,
            alpha=True, float_buffer=True,
        )
        set_bake_targets(proxy, albedo)
        scene.render.bake.use_pass_direct = False
        scene.render.bake.use_pass_indirect = False
        scene.render.bake.use_pass_color = True
        bpy.ops.object.bake(
            type="DIFFUSE", target="IMAGE_TEXTURES", margin=margin_px,
            use_clear=True, uv_layer=ATLAS_UV,
        )
        normal = bpy.data.images.new(
            f"blendlink-normal-{group}", width=size, height=size,
            alpha=True, float_buffer=True,
        )
        set_bake_targets(proxy, normal)
        scene.render.bake.normal_space = "OBJECT"
        bpy.ops.object.bake(
            type="NORMAL", target="IMAGE_TEXTURES", margin=margin_px,
            use_clear=True, uv_layer=ATLAS_UV,
        )
        return albedo, normal
    finally:
        scene.cycles.samples = prior_samples
        scene.cycles.use_adaptive_sampling = prior_adaptive


def hide_collections(names: list) -> list:
    """Render-hide the named collections, returning prior values — an
    unconditional un-hide on restore would expose collections the artist
    authored hidden."""
    saved = []
    for name in names:
        collection = bpy.data.collections.get(name)
        if collection is not None:
            saved.append((collection, collection.hide_render))
            collection.hide_render = True
    return saved


def restore_collections(saved: list) -> None:
    for collection, value in saved:
        collection.hide_render = value



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
    layout = bake_prepare_geometry(bake)

    cameras = camera_positions()
    meshes = render_meshes()
    weights = compute_texel_weights(meshes)
    group_of = {
        obj.name: name
        for name, entry in layout.items() if name != "_warnings"
        for obj in entry["objects"]
    }
    group_size = {
        name: entry["size"] for name, entry in layout.items() if name != "_warnings"
    }
    objects = []
    group_uv = {name: 0.0 for name in group_size}
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
        group = group_of.get(obj.name, next(iter(group_size)))
        atlas_px = group_size[group]
        group_uv[group] += uv_area
        px_per_meter = ((uv_area * atlas_px * atlas_px) / surface) ** 0.5 if surface > 0 else 0.0
        distance = nearest_camera_distance(obj, cameras)
        entry = weights.get(obj.name, {"auto": 1.0, "artist": 1.0})
        objects.append({
            "name": obj.name,
            "atlas": group,
            "areaM2": round(surface, 3),
            "uvShare": round(uv_area, 5),
            "pxPerMeter": round(px_per_meter, 1),
            "cameraDistance": round(distance, 2) if distance is not None else None,
            # Equal perceived quality = equal px/m x distance.
            "screenDensity": round(px_per_meter * distance, 1) if distance is not None else None,
            "autoWeight": entry["auto"],
            "artistWeight": entry["artist"],
        })
    camera_position = cameras[0] if cameras else None
    total_uv = max(group_uv.values()) if group_uv else 0.0

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
    dynamic_objects = [
        {"name": obj.name, "reason": dynamic_reason(obj)}
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and not obj.hide_render and dynamic_reason(obj)
    ]
    populated = [name for name, entry in layout.items()
                 if name != "_warnings" and entry["objects"]]
    return {
        "supersample": max(1, int(bake.get("supersample", 1))),
        "atlasSize": size,
        "marginPx": margin_px,
        "samples": int(bake.get("samples", 128)),
        # Compat number: the fullest atlas. Per-atlas detail rides below.
        "occupancy": round(total_uv, 4),
        "atlases": {
            name: {
                "size": group_size[name],
                "occupancy": round(group_uv[name], 4),
                "objects": len(layout[name]["objects"]),
            }
            for name in group_size
        },
        "dynamicObjects": dynamic_objects,
        "states": [state["name"] for state in states],
        "lightGroups": light_groups,
        "bakeCount": (len(states) + len(light_groups)) * max(len(populated), 1),
        "objects": objects,
        "collisionProxies": collision_proxies,
        "warnings": warnings + layout.get("_warnings", []),
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
    proxies: dict, images: dict, margins: dict, final_sizes: dict,
    grouped_lights: dict, out_glb: str,
    progress_start: float, progress_step: float,
    denoise: bool = False, guides: dict | None = None,
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
    original_world, black = bakelib.swap_to_black_world()
    muted = mute_emission()

    layers = {}
    try:
        for index, (name, lights) in enumerate(sorted(grouped_lights.items())):
            progress(progress_start + index * progress_step, f"baking light group '{name}'")
            for light, _ in lights_prev:
                light.hide_render = light not in lights
            layers[name] = {}
            for group, proxy in proxies.items():
                image = images[group]
                # emit=False: node-driven emission escapes mute_emission and
                # would stamp itself into EVERY layer plus the base state.
                bake_state(proxy, image, margins[group], emit=False)

                pixels = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
                image.pixels.foreach_get(pixels)
                rgb = pixels.reshape(-1, 4)[:, :3]
                # Normalize to a high percentile, not the global max: one hot
                # bulb-filament texel would otherwise crush the whole room's
                # contribution into the bottom bits of an 8-bit PNG.
                peak = float(np.quantile(rgb.max(axis=1), 0.999))
                if peak > 1.0:
                    np.clip(rgb / peak, 0.0, 1.0, out=rgb)
                    image.pixels.foreach_set(pixels)
                suffix = "" if group == "main" else f".{group}"
                layer_path = out_glb + f".light.{name}{suffix}.png"
                guide_albedo, guide_normal = (guides or {}).get(group, (None, None))
                save_resolved(
                    image, layer_path, final_sizes[group], denoise=denoise,
                    albedo=guide_albedo, normal=guide_normal,
                )
                layers[name][group] = {"path": layer_path, "maxValue": max(peak, 1.0)}
    finally:
        for light, old in lights_prev:
            light.hide_render = old
        for socket, value in muted:
            socket.default_value = value
        bakelib.restore_world(original_world, black)
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

    progress(0.10, "packing bake atlases")
    layout = bake_prepare_geometry(bake, supersample)
    groups = {
        name: entry for name, entry in layout.items()
        if name != "_warnings" and entry["objects"]
    }
    bake_engine(samples)

    warnings = list(layout.get("_warnings", []))
    non_mesh = sorted(
        obj.name for obj in bpy.context.scene.objects
        if obj.type in ("CURVE", "FONT", "META", "SURFACE") and not obj.hide_render
    )
    if non_mesh:
        warnings.append(
            "renderable non-mesh objects are not baked and will render lit "
            f"(convert to mesh): {', '.join(non_mesh)}"
        )
    # Auto-dynamic must never be a surprise: name each lit mesh and why.
    dynamic = sorted(
        f"{obj.name} ({dynamic_reason(obj)})"
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and not obj.hide_render and dynamic_reason(obj)
    )
    if dynamic:
        warnings.append(
            "dynamic (lit at runtime, excluded from the bake): " + ", ".join(dynamic)
        )

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
    # transparent, Cycles writes opaque texels, the background flatten
    # reads the difference. One image per atlas group.
    images = {
        name: bpy.data.images.new(
            f"blendlink-bake-{name}",
            width=entry["size"] * supersample, height=entry["size"] * supersample,
            alpha=True, float_buffer=True,
        )
        for name, entry in groups.items()
    }
    margins = {name: entry["margin"] * supersample for name, entry in groups.items()}
    final_sizes = {name: entry["size"] for name, entry in groups.items()}

    def build_proxies() -> dict:
        """One joined proxy PER GROUP, ALL built before ANY bake: baking
        group A with group B's originals hidden but no proxy standing in
        would lose B's bounce and shadows (the flagship learned this the
        hard way). Returns {group: (proxy, hidden)}; groups fully hidden by
        the current state are skipped."""
        built = {}
        for name, entry in groups.items():
            visible = [
                obj for obj in entry["objects"]
                if not any(coll.hide_render for coll in obj.users_collection)
            ]
            if visible:
                built[name] = bakelib.join_proxy(
                    visible, f"BLENDLINK_BAKE_PROXY_{name}", "BLENDLINK_DEFAULT_SURFACE",
                )
        return built

    def release_proxies(built: dict) -> None:
        for proxy, hidden in built.values():
            bakelib.release_proxy(proxy, hidden)

    def state_file(state_name: str, group: str) -> str:
        suffix = "" if group == "main" else f".{group}"
        return out_glb + f".state.{state_name}{suffix}.png"

    bake_jobs = (len(states) + len(grouped_lights)) * max(len(groups), 1)
    per_job = 0.6 / max(bake_jobs, 1)
    job = 0
    guides = {}
    try:
        grouped_flat = [light for lights in grouped_lights.values() for light in lights]
        grouped_prev = [(light, light.hide_render) for light in grouped_flat]
        for light, _ in grouped_prev:
            light.hide_render = True
        try:
            for state in states:
                saved_collections = hide_collections(state.get("hideCollections", []))
                # Proxies are rebuilt per state so hideCollections changes
                # GEOMETRY, not just lights.
                built = build_proxies()
                try:
                    if denoise:
                        # Guides bake once per group (1 sample each) on the
                        # first proxies that include the group.
                        for name in built:
                            if name not in guides:
                                guides[name] = bake_denoise_guides(
                                    built[name][0],
                                    final_sizes[name] * supersample,
                                    name, margins[name],
                                )
                    for name in groups:
                        progress(0.15 + job * per_job,
                                 f"baking {state['name']}/{name} at {final_sizes[name] * supersample}px")
                        job += 1
                        if name in built:
                            bake_state(built[name][0], images[name], margins[name])
                        else:
                            bakelib.clear_image(images[name])
                finally:
                    release_proxies(built)
                    restore_collections(saved_collections)
                state_paths[state["name"]] = {}
                for name in groups:
                    clipped = bakelib.clipped_fraction(
                        images[name], image_coverage(images[name]),
                    )
                    if clipped > 0.001:
                        warnings.append(
                            f"state '{state['name']}' atlas '{name}': {clipped * 100:.1f}% "
                            "of texels exceed 1.0 and clip in the 8-bit save (states are "
                            "not peak-normalized; reduce light energy or accept the clip)"
                        )
                    path = state_file(state["name"], name)
                    guide_albedo, guide_normal = guides.get(name, (None, None))
                    save_resolved(
                        images[name], path, final_sizes[name], denoise=denoise,
                        albedo=guide_albedo, normal=guide_normal,
                    )
                    state_paths[state["name"]][name] = path
        finally:
            for light, old in grouped_prev:
                light.hide_render = old

        if grouped_lights:
            built = build_proxies()
            try:
                group_layers = bake_light_groups(
                    {name: proxy for name, (proxy, _) in built.items()},
                    images, margins, final_sizes, grouped_lights, out_glb,
                    progress_start=0.15 + job * per_job, progress_step=per_job,
                    denoise=denoise, guides=guides,
                )
            finally:
                release_proxies(built)
    finally:
        for image in images.values():
            if image.name in bpy.data.images:
                bpy.data.images.remove(image)
        for albedo, normal in guides.values():
            for guide in (albedo, normal):
                if guide is not None and guide.name in bpy.data.images:
                    bpy.data.images.remove(guide)

    # Rebuild every baked material as an unlit view of its group's
    # default-state atlas. Dynamic meshes never enter this loop, so their
    # real materials survive untouched.
    progress(0.78, "rebuilding materials unlit")
    first_state = states[0]["name"]
    baked_by_group = {}
    for name in groups:
        baked = bpy.data.images.load(state_paths[first_state][name], check_existing=False)
        baked.colorspace_settings.name = "sRGB"
        baked_by_group[name] = baked

    def rebuild_unlit(material, image) -> None:
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        background = nodes.new("ShaderNodeBackground")
        uv = nodes.new("ShaderNodeUVMap")
        uv.uv_map = ATLAS_UV
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        material.node_tree.links.new(uv.outputs["UV"], texture.inputs["Vector"])
        material.node_tree.links.new(texture.outputs["Color"], background.inputs["Color"])
        material.node_tree.links.new(background.outputs["Background"], output.inputs["Surface"])

    claimed = {}     # material -> atlas group that rebuilt it
    duplicates = {}  # (material name, group) -> per-group copy
    for obj in render_meshes():
        group = obj.get("blendlink_atlas", next(iter(groups), "main"))
        for slot in obj.material_slots:
            material = slot.material
            if material is None:
                continue
            owner = claimed.get(material)
            if owner is None:
                claimed[material] = group
                rebuild_unlit(material, baked_by_group[group])
            elif owner != group:
                # A material shared across atlas groups must fork: each copy
                # samples its own group's atlas.
                duplicate = duplicates.get((material.name, group))
                if duplicate is None:
                    duplicate = material.copy()
                    duplicate.name = f"{material.name}.{group}"
                    rebuild_unlit(duplicate, baked_by_group[group])
                    duplicates[(material.name, group)] = duplicate
                slot.material = duplicate
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
        "warnings": warnings,
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
        warnings.extend(baked_report.pop("warnings", []))

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
