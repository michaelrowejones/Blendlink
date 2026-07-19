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

# UV-layer names are a cross-parser contract (exporter, external pipelines,
# the addon's preview/materialize operators). This module is their ONE home;
# the addon mirrors the strings and its headless test asserts they match.
ATLAS_UV = "BLENDLINK_ATLAS"          # the packed bake/export layer (derived)
AUTHORED_UV = "BLENDLINK_ATLAS_AUTHORED"  # the artist's editable layer (opt-in)
# The addon's viewport-only checker inspection modifier. show_render=False,
# but freeze/export paths evaluate the VIEWPORT depsgraph — see
# remove_checker_overrides.
CHECKER_MODIFIER = "BLENDLINK-checker-override"


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


def clear_image(image) -> None:
    """Zero every texel (transparent black) — for a state where an entire
    atlas group is hidden, so stale pixels from the previous state never
    ship as that state's atlas."""
    import numpy as np

    width, height = image.size
    image.pixels.foreach_set(np.zeros(width * height * 4, dtype=np.float32))
    image.update()


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
    flatten the saved background to a constant. Guide images (albedo/normal
    for GUIDED OIDN) are resolved alongside — a size-mismatched guide would
    misalign the denoiser's texture/noise separation."""
    target = image
    disposables = []
    if image.size[0] != final_size:
        duplicate = image.copy()
        duplicate.scale(final_size, final_size)
        disposables.append(duplicate)
        target = duplicate
    guides = {"albedo": albedo, "normal": normal}
    for name, guide in guides.items():
        if guide is not None and guide.size[0] != final_size:
            scaled = guide.copy()
            scaled.scale(final_size, final_size)
            disposables.append(scaled)
            guides[name] = scaled
    try:
        # Coverage at the SAVED size (alpha survives the resolve scale);
        # captured before saving because the 8-bit save discards alpha.
        covered = image_coverage(target)
        if denoise:
            try:
                save_denoised(target, path, albedo=guides["albedo"], normal=guides["normal"])
            except Exception as error:  # noqa: BLE001 — enhancement, never a gate
                print(f"BLENDLINK_DENOISE_FALLBACK {error}")
                save_dithered(target, path)
        else:
            save_dithered(target, path)
        flatten_saved_background(path, covered)
    finally:
        for disposable in disposables:
            bpy.data.images.remove(disposable)


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


def stage_atlas_layers(objs, uv_name: str = ATLAS_UV,
                       authored_name: str = AUTHORED_UV, log=print) -> list:
    """Create the pack workspace layer on every mesh.

    Source per mesh: the artist's AUTHORED layer when present — its islands
    AND pin flags are adopted so pack(pin=True) can hold pinned islands
    where the artist placed them — else the first UV layer, with pins
    forced clear (artists pin UVs for live-unwrap; a stale pin in a working
    layer must never lock the atlas pack). The authored layer itself is
    only ever READ — overwriting it is the top UV2 bug class elsewhere.

    The new layer becomes active-for-editing so the UV ops hit it — but
    NOT active_render: an Image Texture with an unconnected Vector samples
    the active-render map, so flipping it here would bake every implicit-UV
    texture through the PACKED coordinates.

    Returns the names of objects that carried an authored layer.
    """
    authored_names = []
    for obj in objs:
        mesh = obj.data
        authored = mesh.uv_layers.get(authored_name)
        source = authored if authored is not None else mesh.uv_layers[0]
        values = [loop.uv.copy() for loop in source.data]
        pins = [loop.pin_uv for loop in source.data] if authored is not None else None
        previous = mesh.uv_layers.get(uv_name)
        if previous is not None and previous != source:
            mesh.uv_layers.remove(previous)
        layer = mesh.uv_layers.new(name=uv_name)
        if layer is None:
            raise RuntimeError(
                f"{obj.name}: could not add the {uv_name} UV layer "
                "(Blender's 8-layer limit) — remove unused UV maps"
            )
        for index, loop in enumerate(layer.data):
            loop.uv = values[index]
            loop.pin_uv = bool(pins[index]) if pins is not None else False
        mesh.uv_layers.active = layer
        if authored is not None:
            authored_names.append(obj.name)
    if authored_names:
        log(
            f"blendlink: honoring authored atlas UVs ({authored_name}) on "
            f"{len(authored_names)} mesh(es): " + ", ".join(sorted(authored_names))
        )
    return authored_names


def scale_islands(objs, uv_name: str, weight_for, held: dict | None = None) -> None:
    """Pre-scale each object's islands; pack_islands(scale=True) preserves
    relative island scale, so the pre-scale IS the weight. `held` is the
    per-loop mask from average_unpinned — held (pinned-island) loops keep
    their authored scale."""
    for obj in objs:
        final = float(weight_for(obj))
        if final != 1.0:
            layer = obj.data.uv_layers.get(uv_name)
            if layer is not None:
                mask = (held or {}).get(obj.name)
                for index, loop in enumerate(layer.data):
                    if mask is not None and mask[index]:
                        continue
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


def average_unpinned(objs, uv_name: str) -> dict:
    """Equalize px/m across islands EXCEPT pinned ones — a pinned island is
    an authored placement whose scale must survive untouched.

    Islands are resolved by Blender's own selection ops (select_pinned +
    select_linked), so "island" here is exactly the unit pack_islands will
    constrain — a hand-rolled island walk would drift from the packer.
    The pin flags are then EXPANDED over each held island (uv.pin on the
    grown selection): idempotent for the packer, and it makes the held set
    readable per-loop in object mode, which is the returned mask.

    Returns {object name: per-loop held mask} for weight pre-scales to
    skip (objects with no held loops are absent). With no pins anywhere
    this degrades to average().
    """
    packable = [obj for obj in objs if len(obj.data.polygons) > 0]
    if not packable:
        return {}
    tools = bpy.context.scene.tool_settings
    prior_sync = tools.use_uv_select_sync
    # The uv.select_* ops below act on UV selection, not mesh selection.
    tools.use_uv_select_sync = False
    try:
        select_only(packable)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.select_all(action="DESELECT")
        bpy.ops.uv.select_pinned()
        bpy.ops.uv.select_linked()
        bpy.ops.uv.pin(clear=False)
        bpy.ops.uv.select_all(action="INVERT")
        bpy.ops.uv.average_islands_scale()
        bpy.ops.object.mode_set(mode="OBJECT")
    finally:
        tools.use_uv_select_sync = prior_sync
    held = {}
    for obj in packable:
        layer = obj.data.uv_layers.get(uv_name)
        if layer is None:
            continue
        mask = [loop.pin_uv for loop in layer.data]
        if any(mask):
            held[obj.name] = mask
    return held


def pack(objs, margin_px: int, size: int, pin: bool = False) -> None:
    packable = [obj for obj in objs if len(obj.data.polygons) > 0]
    if not packable:
        return
    select_only(packable)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    kwargs = dict(
        rotate=True,
        rotate_method="CARDINAL",
        scale=True,
        merge_overlap=False,
        margin_method="FRACTION",
        margin=(margin_px + 4) / size,
        shape_method="CONCAVE",
    )
    if pin:
        # LOCKED: islands containing any pinned UV keep position AND scale;
        # everything else packs around them. With zero pins present the
        # result is byte-identical to pin=False (verified on 5.2), so the
        # unchanged-inputs-pack-identically invariant holds.
        kwargs.update(pin=True, pin_method="LOCKED")
    bpy.ops.uv.pack_islands(**kwargs)
    bpy.ops.object.mode_set(mode="OBJECT")


def remove_checker_overrides(objs, log=print) -> int:
    """Strip the addon's checker-override modifiers (viewport UV-density
    inspection). They ship show_render=False, but freeze_evaluated_meshes
    and glTF export both evaluate the VIEWPORT depsgraph, where the
    override IS applied — a leftover would bake and export the checker
    material onto everything. Call this before any evaluate or export."""
    stripped = 0
    for obj in objs:
        for modifier in [m for m in getattr(obj, "modifiers", [])
                         if m.name.startswith(CHECKER_MODIFIER)]:
            obj.modifiers.remove(modifier)
            stripped += 1
    if stripped:
        log(
            f"blendlink: removed {stripped} leftover checker-override "
            "modifier(s) — a viewport inspection aid that must never bake"
        )
    return stripped


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
