# SPDX-License-Identifier: MIT
"""Shared bake primitives — the ONE home for bake logic.

Both the blendlink exporter (export_scene.py) and external pipelines (the
flagship site's workbench exporter) import these. NEVER copy a function out
of this file into a consumer: the two-pipeline era proved every hand-mirrored
fix lands twice and drifts (32% of the exporter was byte-identical to the
site's before this module existed). Fixes land here, once.

Contracts these functions enforce:
- Saves go through Standard/None/0 color management (additive layers are
  linear math after sRGB decode; AgX baked into a layer breaks addition).
- Bake targets are transparent images; alpha is the coverage channel.
- Saved atlases get a CONSTANT background (mean island color) by byte
  surgery AFTER every lossy stage — dither and OIDN both re-grain anything
  applied earlier, and grain on invisible pixels balloons payloads.
- Failures and skips are LOUD. A silent skip hid a broken coverage contract
  once; never add a quiet early-return.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

import bpy


# --------------------------------------------------------------------------
# Progress protocol
# --------------------------------------------------------------------------

def progress(fraction: float, label: str) -> None:
    """Machine-readable progress line, only when a wrapper asks for it."""
    if os.environ.get("BLENDLINK_PROGRESS") != "1":
        return
    payload = json.dumps({"fraction": round(fraction, 4), "label": label})
    print(f"##blendlink {payload}", flush=True)


# --------------------------------------------------------------------------
# Color management: the Standard/None/0 save contract
# --------------------------------------------------------------------------

def force_color_management(scene) -> dict:
    """Force the save contract on a scene; returns prior values for restore.

    save_render applies the scene's view transform. A user's AgX/Filmic
    scene would bake different colors with denoise on vs off (the denoise
    stage scene always forced Standard) — so the MAIN save path forces it
    too, and restores the artist's settings afterwards.
    """
    view = scene.view_settings
    saved = {
        "view_transform": view.view_transform,
        "look": view.look,
        "exposure": view.exposure,
    }
    view.view_transform = "Standard"
    view.look = "None"
    view.exposure = 0.0
    return saved


def restore_color_management(scene, saved: dict) -> None:
    view = scene.view_settings
    view.view_transform = saved["view_transform"]
    view.look = saved["look"]
    view.exposure = saved["exposure"]


# --------------------------------------------------------------------------
# Saving: dither, denoise (optionally guided), resolve, flatten
# --------------------------------------------------------------------------

def save_dithered(image, path: str) -> None:
    """8-bit PNG through Standard view + dither (plain saves never dither
    and band the slow gradients). Forces and restores color management."""
    scene = bpy.context.scene
    saved = force_color_management(scene)
    settings = scene.render.image_settings
    prior_format = (settings.file_format, settings.color_mode, settings.color_depth)
    prior_dither = scene.render.dither_intensity
    try:
        settings.file_format = "PNG"
        settings.color_mode = "RGB"
        settings.color_depth = "8"
        scene.render.dither_intensity = 1.0
        image.save_render(path, scene=scene)
    finally:
        settings.file_format, settings.color_mode, settings.color_depth = prior_format
        scene.render.dither_intensity = prior_dither
        restore_color_management(scene, saved)


def save_denoised(image, path: str, albedo=None, normal=None) -> None:
    """OIDN via a throwaway compositor scene: Image → Denoise → output.

    The stage scene is EMPTY (renders instantly under Workbench) and its
    compositor output becomes the written file, through the same Standard
    view + dither contract. Runs after margin dilation, sidestepping the
    bake-time-denoise margin-darkening bug (blender#94573). Albedo/normal
    guide images make the denoise GUIDED: unguided OIDN reads authored
    micro-texture (plaster, wood grain) as noise and launders it away.
    """
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
        if albedo is not None:
            albedo_node = tree.nodes.new("CompositorNodeImage")
            albedo_node.image = albedo
            tree.links.new(albedo_node.outputs["Image"], denoise.inputs["Albedo"])
        if normal is not None:
            normal_node = tree.nodes.new("CompositorNodeImage")
            normal_node.image = normal
            tree.links.new(normal_node.outputs["Image"], denoise.inputs["Normal"])
        tree.links.new(denoise.outputs["Image"], sink.inputs["Image"])
        stage.render.filepath = path
        bpy.ops.render.render(write_still=True, scene=stage.name)
    finally:
        if tree is not None and owns_tree and tree.name in bpy.data.node_groups:
            bpy.data.node_groups.remove(tree)
        bpy.data.scenes.remove(stage)


def image_coverage(image):
    """Boolean (height, width) coverage from the bake target's alpha: the
    target clears transparent and Cycles writes opaque texels."""
    import numpy as np

    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(height, width, 4)[:, :, 3] > 0.5


def clipped_fraction(image, covered=None) -> float:
    """Fraction of covered texels above 1.0 — the 8-bit save clips them
    silently, so callers can warn instead."""
    import numpy as np

    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    rgb = pixels.reshape(height, width, 4)[:, :, :3]
    mask = covered if covered is not None else np.ones(rgb.shape[:2], dtype=bool)
    total = int(mask.sum())
    if total == 0:
        return 0.0
    return float((rgb[mask].max(axis=1) > 1.0).sum()) / total


def flatten_saved_background(path: str, covered, label: str = "", log=print) -> None:
    """Rewrite the saved atlas's background to ONE constant byte value.

    Mip level N keeps only 1/2^N of the authored island padding, so deep
    mips of a black-background atlas average dark halos into island edges.
    The bake-margin dilation covers the island-local band; the far-field
    wants the mean island color — but as an exact CONSTANT: dither and OIDN
    both put grain on the saved background, and grain on invisible pixels
    balloons encoded payloads. Byte surgery on the saved file, after every
    lossy stage, is the only ordering that guarantees flatness.
    """
    import numpy as np

    tag = label or Path(path).stem
    if covered.all():
        log(f"blendlink: background fill skipped for {tag} — alpha reports full coverage")
        return
    if covered.sum() < covered.size * 0.01:
        log(f"blendlink: background fill skipped for {tag} — no baked coverage in alpha")
        return
    image = bpy.data.images.load(path, check_existing=False)
    try:
        width, height = image.size
        if (height, width) != covered.shape:
            log(f"blendlink: background fill skipped for {tag} — saved size mismatch")
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
        holes = int(covered.size - covered.sum())
        log(f"blendlink: flattened {holes} background texels of {tag} to a constant")
    finally:
        bpy.data.images.remove(image)


def save_resolved(
    image, path: str, final_size: int, denoise: bool = False,
    albedo=None, normal=None,
) -> None:
    """Save at final_size: supersampled bakes resolve down through a copy so
    the live bake target keeps its full resolution for the next state. Then
    flatten the saved background to a constant."""
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
                save_denoised(target, path, albedo=albedo, normal=normal)
            except Exception as error:  # noqa: BLE001 — enhancement, never a gate
                print(f"BLENDLINK_DENOISE_FALLBACK {error}")
                save_dithered(target, path)
        else:
            save_dithered(target, path)
        flatten_saved_background(path, covered)
    finally:
        if duplicate is not None:
            bpy.data.images.remove(duplicate)


# --------------------------------------------------------------------------
# Texel density: weights, quantization, atlas packing
# --------------------------------------------------------------------------

def quantize_half_pow2(value: float) -> float:
    """Snap to 2^(k/2): pack-layout hysteresis across minor scene edits."""
    if value <= 0.0:
        return 0.0
    return 2.0 ** (round(math.log2(value) * 2.0) / 2.0)


def texel_weight_of(obj, keys=("blendlink_texel_weight", "texel_weight")) -> float:
    """Artist lightmap scale (Unity semantics): linear per-axis multiplier,
    default 1; 0 excludes the object from the atlas while it keeps lighting
    the bakes. `keys` is a fallback chain — namespaced name first, bare name
    kept for compatibility, and external pipelines may append their own."""
    for key in keys:
        if key in obj:
            try:
                return max(0.0, float(obj[key]))
            except (TypeError, ValueError):
                return 1.0
    return 1.0


def scale_islands(objs, uv_name: str, weight_for) -> None:
    """Pre-scale each object's islands; pack_islands(scale=True) preserves
    relative island scale, so the pre-scale IS the weight."""
    for obj in objs:
        final = float(weight_for(obj))
        if final != 1.0:
            layer = obj.data.uv_layers.get(uv_name)
            if layer is not None:
                for loop in layer.data:
                    loop.uv *= final


def select_only(objs) -> None:
    """Select exactly these objects; skips anything outside the view layer
    (view-layer-excluded collections raise on select_set). Per-object
    try/except rather than a name snapshot — freshly linked objects can be
    selectable before the view-layer listing refreshes."""
    bpy.ops.object.select_all(action="DESELECT")
    active = None
    for obj in objs:
        try:
            obj.select_set(True)
            active = obj
        except RuntimeError:
            continue
    bpy.context.view_layer.objects.active = active


def average_and_pack(objs, margin_px: int, size: int) -> None:
    """Equalize px/m (average_islands_scale) then pack with an absolute gap.

    CARDINAL rotation keeps island edges texel-aligned (dilates, mips, and
    block-compresses cleaner than free rotation); FRACTION margins guarantee
    a gap the bake dilation cannot cross regardless of island size.
    Callers apply island weight pre-scales BETWEEN averaging and packing —
    use average(), scale_islands(), then pack() if weights are in play.
    """
    average(objs)
    pack(objs, margin_px, size)


def average(objs) -> None:
    packable = [obj for obj in objs if len(obj.data.polygons) > 0]
    if not packable:
        return
    select_only(packable)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")


def pack(objs, margin_px: int, size: int) -> None:
    packable = [obj for obj in objs if len(obj.data.polygons) > 0]
    if not packable:
        return
    select_only(packable)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(
        rotate=True,
        rotate_method="CARDINAL",
        scale=True,
        merge_overlap=False,
        margin_method="FRACTION",
        margin=(margin_px + 4) / size,
        shape_method="CONCAVE",
    )
    bpy.ops.object.mode_set(mode="OBJECT")


# --------------------------------------------------------------------------
# Geometry preparation: evaluate, unwrap fallback, proxy join
# --------------------------------------------------------------------------

def freeze_evaluated_meshes(objs) -> None:
    """Two-phase evaluate-then-assign: evaluate EVERY object against a clean
    depsgraph before mutating any of them. Interleaving evaluated_get with
    obj.data assignment dirties the depsgraph mid-loop and makes results
    order-dependent for inter-object modifiers (booleans, shrinkwrap)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    frozen = []
    for obj in objs:
        evaluated = obj.evaluated_get(depsgraph)
        frozen.append((obj, bpy.data.meshes.new_from_object(
            evaluated, preserve_all_data_layers=True, depsgraph=depsgraph,
        )))
    for obj, mesh in frozen:
        obj.data = mesh
        obj.modifiers.clear()


def ensure_authored_uvs(objs, log=print) -> None:
    """Meshes with no UV layer get a Smart UV Project, not Blender's default
    per-face unit-square reset — the reset makes every face its own island
    and shatters the pack (10k faces = 10k margin-padded islands)."""
    missing = [obj for obj in objs if len(obj.data.uv_layers) == 0
               and len(obj.data.polygons) > 0]
    if not missing:
        return
    log(f"blendlink: smart-projecting {len(missing)} unwrapped meshes: "
        + ", ".join(obj.name for obj in missing))
    select_only(missing)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")


def join_proxy(objs, name: str, default_material_name: str) -> tuple:
    """One joined disposable proxy: bpy.ops.object.bake runs a full job PER
    SELECTED OBJECT and per-object margin dilation overwrites neighbouring
    islands, so the bake wants exactly one object.

    Handles the join traps: negative-scale (mirrored) sources get their
    winding flipped back (join keeps inverted normals — Cycles would bake
    their back sides), and material-less geometry gets a neutral surface
    (no material slot = nowhere to hang the bake target = cryptic Cycles
    failure).
    Returns (proxy, hidden) where hidden restores the originals.
    """
    copies = []
    for obj in objs:
        duplicate = obj.copy()
        duplicate.data = obj.data.copy()
        bpy.context.scene.collection.objects.link(duplicate)
        duplicate.matrix_world = obj.matrix_world.copy()
        duplicate.parent = None
        if obj.matrix_world.determinant() < 0.0:
            duplicate.data.flip_normals()
        copies.append(duplicate)
    hidden = [(obj, obj.hide_render) for obj in objs]
    for obj, _ in hidden:
        obj.hide_render = True
    select_only(copies)
    bpy.ops.object.join()
    # join keeps only the ACTIVE object; every other copy reference is now
    # dangling, so the proxy must come from the context.
    proxy = bpy.context.view_layer.objects.active
    proxy.name = name
    default = bpy.data.materials.get(default_material_name)
    if default is None:
        default = bpy.data.materials.new(default_material_name)
        default.use_nodes = True
    if not proxy.material_slots:
        proxy.data.materials.append(default)
    for slot in proxy.material_slots:
        if slot.material is None:
            slot.material = default
    return proxy, hidden


def release_proxy(proxy, hidden) -> None:
    mesh = proxy.data
    bpy.data.objects.remove(proxy)
    if mesh.users == 0:
        bpy.data.meshes.remove(mesh)
    for obj, was_hidden in hidden:
        obj.hide_render = was_hidden


# --------------------------------------------------------------------------
# Lighting helpers
# --------------------------------------------------------------------------

def swap_to_black_world() -> tuple:
    """Replace the world with pure black so a solo bake carries only the
    intended lights' contribution. Returns (original, black) for restore."""
    scene = bpy.context.scene
    original = scene.world
    black = bpy.data.worlds.new("BLENDLINK_BLACK_WORLD")
    black.use_nodes = True
    background = black.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs[0].default_value = (0.0, 0.0, 0.0, 1.0)
        background.inputs[1].default_value = 0.0
    scene.world = black
    return original, black


def restore_world(original, black) -> None:
    bpy.context.scene.world = original
    if black is not None and black.name in bpy.data.worlds:
        bpy.data.worlds.remove(black)
