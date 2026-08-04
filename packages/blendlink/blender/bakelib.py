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
import base64
import contextlib
import atexit
import hashlib
import math
import os
import struct
import sys
import threading
import tempfile
import zlib
from array import array
from collections.abc import Mapping
from pathlib import Path

import bpy
from mathutils import Vector

# Sibling modules in this directory, following the same convention as
# export_scene.py: bakelib is loaded both as a Blender-side import and
# directly by path from headless test modules, so it puts its own
# directory on the path rather than assuming a caller did.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from uvgeometry import (  # noqa: E402
    _RECEIVER_RECTANGLE_EPSILON,
    _RECEIVER_RECTANGLE_ORDERINGS,
    _RECEIVER_RECTANGLE_SCORINGS,
    _maxrects_receiver_attempt,
    _ordered_receiver_rectangles,
    _prune_receiver_free_rectangles,
    _receiver_rectangle_contains,
    _receiver_rectangles_intersect,
    _uv_bounds_tuple_distance,
    allocate_receiver_rectangles,
)


def capture_fixed_camera_card(
    scene,
    source,
    *,
    card_name,
    mesh_name,
    material_name,
    image_name,
    width,
    height,
    padding=2,
    card_id=None,
    source_id=None,
    capture_frame=None,
):
    """Compile a camera-locked procedural look into one packed unlit quad.

    This deliberately implements a constrained representation, not a general
    shader baker. The caller owns source eligibility and the final decision to
    exclude it from glTF; this primitive owns isolation, render-state restore,
    alpha crop, packing, inverse projection, and canonical material creation.
    """
    if scene.camera is None:
        raise RuntimeError("fixed-camera capture needs the scene presentation camera")
    if width < 1 or height < 1 or padding < 0:
        raise ValueError("fixed-camera capture needs positive dimensions and non-negative padding")

    prior = scene.objects.get(card_name)
    if prior is not None:
        if prior.type != "MESH" or card_id is None \
                or prior.get("blendlink_id") != card_id:
            raise RuntimeError(
                f"refusing to replace unrelated object named {card_name}; "
                "its type or stable ID does not match the generated capture"
            )
        bpy.data.objects.remove(prior, do_unlink=True)
    for collection, name in (
        (bpy.data.meshes, mesh_name),
        (bpy.data.materials, material_name),
        (bpy.data.images, image_name),
    ):
        datablock = collection.get(name)
        if datablock is None:
            continue
        if datablock.users:
            raise RuntimeError(
                f"refusing to replace generated capture datablock {name}: "
                f"it still has {datablock.users} user(s)"
            )
        collection.remove(datablock)

    saved_visibility = [(obj, obj.hide_render) for obj in scene.objects]
    saved_resolution = (
        scene.render.resolution_x,
        scene.render.resolution_y,
        scene.render.resolution_percentage,
    )
    saved_filepath = scene.render.filepath
    saved_file_format = scene.render.image_settings.file_format
    saved_color_mode = scene.render.image_settings.color_mode
    saved_compositor = scene.compositing_node_group
    saved_transparent = scene.render.film_transparent
    capture_image = None
    with tempfile.TemporaryDirectory(prefix="blendlink-fixed-camera-card-") as temporary:
        directory = Path(temporary)
        capture_path = directory / "capture.png"
        try:
            for obj in scene.objects:
                if obj != source and obj.type not in {"LIGHT", "CAMERA"}:
                    obj.hide_render = True
            source.hide_render = False
            scene.compositing_node_group = None
            scene.render.film_transparent = True
            scene.render.resolution_x = int(width)
            scene.render.resolution_y = int(height)
            scene.render.resolution_percentage = 100
            scene.render.image_settings.file_format = "PNG"
            scene.render.image_settings.color_mode = "RGBA"
            scene.render.filepath = str(capture_path)
            bpy.ops.render.render(write_still=True, scene=scene.name)
            if not capture_path.is_file():
                raise RuntimeError(f"fixed-camera capture did not write {capture_path}")
            capture_image = bpy.data.images.load(str(capture_path), check_existing=False)
            pixels, crop = _alpha_crop_image(capture_image, int(padding), source.name)
            image, digest = _pack_cropped_capture(
                pixels, crop, directory, image_name,
            )
            material = _fixed_camera_card_material(material_name, image)
            card = _fixed_camera_card_mesh(
                scene, source, image, material, crop,
                int(width), int(height), mesh_name, card_name,
            )
        finally:
            if capture_image is not None:
                bpy.data.images.remove(capture_image)
            for obj, hidden in saved_visibility:
                if obj.name in scene.objects:
                    obj.hide_render = hidden
            (
                scene.render.resolution_x,
                scene.render.resolution_y,
                scene.render.resolution_percentage,
            ) = saved_resolution
            scene.render.filepath = saved_filepath
            scene.render.image_settings.file_format = saved_file_format
            scene.render.image_settings.color_mode = saved_color_mode
            scene.compositing_node_group = saved_compositor
            scene.render.film_transparent = saved_transparent

    if card_id is not None:
        card["blendlink_id"] = str(card_id)
    if source_id is not None:
        card["blendlink_generated_from_id"] = str(source_id)
    if capture_frame is not None:
        card["blendlink_capture_frame"] = int(capture_frame)
    if len(card.data.vertices) != 4 or len(card.data.polygons) != 1:
        raise RuntimeError("generated fixed-camera card must contain one quad")
    if image.packed_file is None:
        raise RuntimeError("generated fixed-camera card image is not packed")
    return {
        "source": source,
        "card": card,
        "image": image,
        "crop": crop,
        "image_size": tuple(image.size),
        "sha256": digest,
        "depth": (scene.camera.matrix_world.translation - source.matrix_world.translation).length,
    }


def _alpha_crop_image(source, padding, label):
    width, height = source.size
    pixels = array("f", [0.0]) * (width * height * 4)
    source.pixels.foreach_get(pixels)
    threshold = 1.0 / 1024.0
    min_x, min_y, max_x, max_y = width, height, -1, -1
    for y in range(height):
        alpha_index = y * width * 4 + 3
        for x in range(width):
            if pixels[alpha_index + x * 4] <= threshold:
                continue
            min_x, min_y = min(min_x, x), min(min_y, y)
            max_x, max_y = max(max_x, x), max(max_y, y)
    if max_x < min_x or max_y < min_y:
        raise RuntimeError(f"{label} fixed-camera capture contains no visible alpha")
    left, right = max(0, min_x - padding), min(width - 1, max_x + padding)
    bottom, top = max(0, min_y - padding), min(height - 1, max_y + padding)
    crop_width, crop_height = right - left + 1, top - bottom + 1
    cropped = array("f", [0.0]) * (crop_width * crop_height * 4)
    row_values = crop_width * 4
    for row in range(crop_height):
        source_start = ((bottom + row) * width + left) * 4
        target_start = row * row_values
        cropped[target_start:target_start + row_values] = pixels[
            source_start:source_start + row_values
        ]
    return cropped, (left, height - 1 - top, crop_width, crop_height)


def _pack_cropped_capture(pixels, crop, directory, image_name):
    _, _, width, height = crop
    working = bpy.data.images.new(
        name=f"{image_name}_working", width=width, height=height,
        alpha=True, float_buffer=False,
    )
    working.colorspace_settings.name = "sRGB"
    working.alpha_mode = "STRAIGHT"
    working.pixels.foreach_set(pixels)
    working.update()
    path = directory / "card-rgba.png"
    working.filepath_raw = str(path)
    working.file_format = "PNG"
    working.save()
    bpy.data.images.remove(working)
    encoded = path.read_bytes()
    image = bpy.data.images.load(str(path), check_existing=False)
    image.name = image_name
    image.colorspace_settings.name = "sRGB"
    image.alpha_mode = "STRAIGHT"
    image.pack()
    image.filepath_raw = f"//{image_name}.png"
    if image.packed_file is None or tuple(image.size) != (width, height):
        raise RuntimeError(f"generated capture image {image_name} did not pack at {width}x{height}")
    return image, hashlib.sha256(encoded).hexdigest()


def _fixed_camera_card_material(name, image):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.surface_render_method = "DITHERED"
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    texture = nodes.new("ShaderNodeTexImage")
    emission = nodes.new("ShaderNodeEmission")
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    camera_mix = nodes.new("ShaderNodeMixShader")
    alpha_mix = nodes.new("ShaderNodeMixShader")
    light_path = nodes.new("ShaderNodeLightPath")
    texture.image = image
    texture.interpolation = "Linear"
    texture.extension = "CLIP"
    links.new(texture.outputs["Color"], emission.inputs["Color"])
    links.new(light_path.outputs["Is Camera Ray"], camera_mix.inputs[0])
    links.new(transparent.outputs["BSDF"], camera_mix.inputs[1])
    links.new(emission.outputs["Emission"], camera_mix.inputs[2])
    links.new(texture.outputs["Alpha"], alpha_mix.inputs[0])
    links.new(transparent.outputs["BSDF"], alpha_mix.inputs[1])
    links.new(camera_mix.outputs["Shader"], alpha_mix.inputs[2])
    links.new(alpha_mix.outputs["Shader"], output.inputs["Surface"])
    return material


def _fixed_camera_card_mesh(
    scene, source, image, material, crop,
    capture_width, capture_height, mesh_name, card_name,
):
    camera = scene.camera
    depth = (camera.matrix_world.translation - source.matrix_world.translation).length
    frame = camera.data.view_frame(scene=scene)
    frame_scale = depth / -frame[0].z
    full_frame = [
        Vector((point.x * frame_scale, point.y * frame_scale, -depth))
        for point in frame
    ]
    min_x, max_x = min(point.x for point in full_frame), max(point.x for point in full_frame)
    min_y, max_y = min(point.y for point in full_frame), max(point.y for point in full_frame)
    left, top, width, height = crop
    u0, u1 = left / capture_width, (left + width) / capture_width
    v0, v1 = 1.0 - (top + height) / capture_height, 1.0 - top / capture_height
    local_vertices = (
        Vector((min_x + u0 * (max_x - min_x), min_y + v0 * (max_y - min_y), -depth)),
        Vector((min_x + u1 * (max_x - min_x), min_y + v0 * (max_y - min_y), -depth)),
        Vector((min_x + u1 * (max_x - min_x), min_y + v1 * (max_y - min_y), -depth)),
        Vector((min_x + u0 * (max_x - min_x), min_y + v1 * (max_y - min_y), -depth)),
    )
    mesh = bpy.data.meshes.new(mesh_name)
    mesh.from_pydata([camera.matrix_world @ point for point in local_vertices], [], [(0, 1, 2, 3)])
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    uvs = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
    for loop in mesh.loops:
        uv_layer.data[loop.index].uv = uvs[loop.vertex_index]
    card = bpy.data.objects.new(card_name, mesh)
    scene.collection.objects.link(card)
    card.data.materials.append(material)
    # The camera-ray branch intentionally makes the captured source invisible
    # to non-camera rays. Core glTF cannot express that object-level contract,
    # so carry it through Blendlink's namespaced runtime flag as well as the
    # native Blender visibility channel. This prevents a transparent unlit
    # card from casting a solid rectangular website shadow.
    card.visible_shadow = False
    card["blendlink_cast_shadow"] = False
    return card

# UV-layer names are a cross-parser contract (exporter, external pipelines,
# the addon's preview/materialize operators). This module is their ONE home;
# the packaged addon imports this module rather than mirroring bake behavior.
ATLAS_UV = "BLENDLINK_ATLAS"          # the packed bake/export layer (derived)
AUTHORED_UV = "BLENDLINK_ATLAS_AUTHORED"  # the artist's editable layer (opt-in)
MATERIAL_ATLAS_UV = "BLENDLINK_WEB_ATLAS"  # compiler-private selected field
# The addon's viewport-only checker inspection modifier. show_render=False,
# but freeze/export paths evaluate the VIEWPORT depsgraph — see
# remove_checker_overrides.
CHECKER_MODIFIER = "BLENDLINK-checker-override"


# --------------------------------------------------------------------------
# Shader node-tree compatibility
# --------------------------------------------------------------------------

def ensure_shader_node_tree(owner):
    """Return a Material/World/Light shader tree across Blender versions.

    Blender 5.x creates the embedded shader tree eagerly and deprecates
    ``use_nodes``. Older releases can still require the legacy switch before
    ``node_tree`` exists. Read the tree first so modern Blender never touches
    that deprecated property, and fail loudly if the owner cannot provide a
    shader tree after the compatibility fallback.
    """
    owner_name = str(getattr(owner, "name", "") or "<unnamed>")
    owner_type = str(
        getattr(getattr(owner, "bl_rna", None), "identifier", "")
        or type(owner).__name__
    )
    try:
        tree = getattr(owner, "node_tree", None)
    except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
        raise RuntimeError(
            f"Blendlink could not read the shader node tree for "
            f"{owner_type} {owner_name!r}: {type(error).__name__}: {error}"
        ) from error
    if tree is not None:
        return tree

    try:
        owner.use_nodes = True
    except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
        raise RuntimeError(
            f"Blendlink could not enable shader nodes for "
            f"{owner_type} {owner_name!r}: {type(error).__name__}: {error}"
        ) from error
    try:
        tree = getattr(owner, "node_tree", None)
    except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
        raise RuntimeError(
            f"Blendlink enabled shader nodes for {owner_type} {owner_name!r} "
            f"but could not read its node tree: {type(error).__name__}: {error}"
        ) from error
    if tree is None:
        raise RuntimeError(
            f"Blendlink enabled shader nodes for {owner_type} {owner_name!r}, "
            "but Blender did not create a node tree"
        )
    return tree


def active_shader_node_tree(owner):
    """Return the active shader tree without mutating its owner.

    Before Blender 5, a datablock can retain a tree while ``use_nodes`` is
    disabled, so that legacy flag still controls whether the graph is active.
    Blender 5+ makes the embedded tree authoritative and deprecates the flag;
    never read it there so this path also remains valid after its removal.
    """
    if owner is None:
        return None
    owner_name = str(getattr(owner, "name", "") or "<unnamed>")
    owner_type = str(
        getattr(getattr(owner, "bl_rna", None), "identifier", "")
        or type(owner).__name__
    )
    try:
        tree = getattr(owner, "node_tree", None)
    except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
        raise RuntimeError(
            f"Blendlink could not read the shader node tree for "
            f"{owner_type} {owner_name!r}: {type(error).__name__}: {error}"
        ) from error
    if tree is None:
        return None
    if tuple(bpy.app.version) < (5, 0, 0):
        try:
            enabled = bool(getattr(owner, "use_nodes", False))
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            raise RuntimeError(
                f"Blendlink could not read legacy shader-node state for "
                f"{owner_type} {owner_name!r}: {type(error).__name__}: {error}"
            ) from error
        if not enabled:
            return None
    return tree


# --------------------------------------------------------------------------
# Incremental bake dependency fingerprints
# --------------------------------------------------------------------------

def file_sha256(path: str, length: int = 16) -> str:
    """Content identity for one published bake artifact.

    Dependency hashes answer whether pixels *should* change; this separately
    proves the prior file still contains the bytes Blendlink published.
    """
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()[:length]


def packed_image_payloads(image) -> tuple[tuple[str, bytes], ...]:
    """Return exact packed source bytes across Blender image API versions.

    Blender 5.2 changed ``Image.packed_files`` from PackedFile entries to
    ImagePackedFile wrappers. The wrapper owns view/tile metadata while its
    nested ``packed_file`` owns ``data``. ``Image.packed_file`` still exposes
    the legacy direct PackedFile. Keeping this adapter here prevents bake
    fingerprints and asset publication from drifting across those shapes.
    """
    entries = list(getattr(image, "packed_files", ()))
    direct = getattr(image, "packed_file", None)
    if not entries and direct is not None:
        entries = [direct]
    payloads = []
    for entry in entries:
        nested = getattr(entry, "packed_file", None)
        source = nested if nested is not None else entry
        try:
            payload = bytes(source.data)
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            raise RuntimeError(
                f"packed image {getattr(image, 'name', '<unnamed>')!r} source "
                f"bytes are unreadable: {type(error).__name__}: {error}"
            ) from error
        path = str(
            getattr(entry, "filepath", "")
            or getattr(source, "filepath", "")
            or ""
        )
        payloads.append((path, payload))
    return tuple(payloads)


def _fingerprint_value(digest, value) -> None:
    if value is None or isinstance(value, (bool, int, float, str)):
        digest.update(type(value).__name__.encode("ascii"))
        digest.update(b":")
        digest.update(repr(value).encode("utf8", "backslashreplace"))
        digest.update(b"\0")
        return
    if isinstance(value, bpy.types.ID):
        library = getattr(value, "library", None)
        _fingerprint_value(digest, (
            "BLENDER_ID",
            type(value).__name__,
            getattr(value, "name_full", value.name),
            getattr(library, "filepath", None),
        ))
        return
    if isinstance(value, Mapping):
        digest.update(type(value).__name__.encode("utf8", "backslashreplace"))
        digest.update(b"{")
        for key in sorted(value, key=lambda item: repr(item)):
            _fingerprint_value(digest, key)
            _fingerprint_value(digest, value[key])
        digest.update(b"}")
        return
    if isinstance(value, (set, frozenset)):
        digest.update(type(value).__name__.encode("utf8", "backslashreplace"))
        digest.update(b"{")
        for item in sorted(value, key=lambda entry: repr(entry)):
            _fingerprint_value(digest, item)
        digest.update(b"}")
        return
    try:
        values = list(value)
    except (TypeError, ValueError):
        digest.update(repr(value).encode("utf8", "backslashreplace"))
        digest.update(b"\0")
        return
    digest.update(type(value).__name__.encode("utf8", "backslashreplace"))
    digest.update(b"[")
    for item in values:
        _fingerprint_value(digest, item)
    digest.update(b"]")


def _fingerprint_rna_scalars(digest, value, skip=()) -> None:
    """Conservative scalar snapshot of render-relevant RNA settings.

    Unsupported/pointer/collection properties are handled explicitly by the
    caller. Read failures are recorded, never silently ignored, so a Blender
    version change invalidates rather than accidentally reuses a bake.
    """
    for prop in sorted(value.bl_rna.properties, key=lambda item: item.identifier):
        key = prop.identifier
        if key in skip or key == "rna_type" or prop.type in {"POINTER", "COLLECTION"}:
            continue
        digest.update(key.encode("utf8"))
        try:
            _fingerprint_value(digest, getattr(value, key))
        except Exception as error:
            digest.update(f"<unreadable:{type(error).__name__}>".encode("ascii"))


def _fingerprint_embedded_rna(digest, value, visited=None, depth=0, skip=()) -> None:
    """Fingerprint nested non-ID RNA such as color ramps and curve maps.

    The scalar-only helper intentionally avoids pointers, but shader nodes
    store important pixel controls behind embedded POINTER/COLLECTION RNA.
    Follow those bounded structures while treating Blender datablocks as
    stable named references; their contents are handled by dedicated paths.
    """
    if value is None or depth > 6:
        return
    visited = visited if visited is not None else set()
    try:
        pointer = value.as_pointer()
    except (AttributeError, ReferenceError, RuntimeError):
        pointer = id(value)
    if pointer in visited:
        digest.update(b"RNA-REFERENCE")
        return
    visited.add(pointer)
    for prop in sorted(value.bl_rna.properties, key=lambda item: item.identifier):
        key = prop.identifier
        if key == "rna_type" or key in skip:
            continue
        digest.update(key.encode("utf8"))
        try:
            child = getattr(value, key)
        except Exception as error:
            digest.update(f"<unreadable:{type(error).__name__}>".encode("ascii"))
            continue
        if prop.type not in {"POINTER", "COLLECTION"}:
            _fingerprint_value(digest, child)
        elif prop.type == "POINTER":
            if child is None:
                _fingerprint_value(digest, None)
            elif isinstance(child, bpy.types.ID):
                _fingerprint_value(digest, (type(child).__name__, child.name))
            else:
                _fingerprint_embedded_rna(digest, child, visited, depth + 1)
        else:
            for item in child:
                if isinstance(item, bpy.types.ID):
                    _fingerprint_value(digest, (type(item).__name__, item.name))
                else:
                    _fingerprint_embedded_rna(digest, item, visited, depth + 1)


def _fingerprint_image(digest, image) -> None:
    digest.update(b"IMAGE")
    _fingerprint_value(digest, (
        image.name, tuple(image.size), image.file_format,
        image.source, image.alpha_mode, image.colorspace_settings.name,
    ))
    packed_payloads = packed_image_payloads(image)
    if packed_payloads:
        for path, payload in packed_payloads:
            _fingerprint_value(digest, path)
            digest.update(hashlib.sha256(payload).digest())
        return
    path = bpy.path.abspath(image.filepath, library=image.library)
    if path and os.path.isfile(path):
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
    else:
        # Generated images have no source bytes; pixels are authoritative.
        pixels = array("f", [0.0]) * (image.size[0] * image.size[1] * 4)
        if pixels:
            image.pixels.foreach_get(pixels)
            digest.update(pixels.tobytes())


def _fingerprint_declared_file(digest, raw_path, library=None) -> None:
    if not isinstance(raw_path, str) or not raw_path:
        return
    path = bpy.path.abspath(raw_path, library=library)
    _fingerprint_value(digest, ("DECLARED_FILE", path))
    if not os.path.isfile(path):
        digest.update(b"MISSING_DECLARED_FILE")
        return
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)


def _fingerprint_node_tree(digest, tree, visited) -> None:
    if tree is None:
        return
    pointer = tree.as_pointer()
    if pointer in visited:
        digest.update(b"TREE-REFERENCE")
        _fingerprint_value(digest, tree.name)
        return
    visited.add(pointer)
    digest.update(b"NODETREE")
    for node in sorted(
        tree.nodes,
        key=lambda item: (item.name, item.bl_idname),
    ):
        _fingerprint_value(digest, (node.name, node.bl_idname))
        _fingerprint_embedded_rna(
            digest, node,
            skip={"name", "label", "location", "width", "height", "select", "show_options", "show_preview"},
        )
        # IES and OSL/script nodes expose file paths that Blender's
        # bpy.utils.blend_paths() does not consistently enumerate.
        _fingerprint_declared_file(
            digest, getattr(node, "filepath", ""), library=getattr(tree, "library", None),
        )
        for socket in node.inputs:
            if hasattr(socket, "default_value") and not socket.is_linked:
                _fingerprint_value(digest, (socket.identifier, socket.default_value))
        image = getattr(node, "image", None)
        if image is not None:
            _fingerprint_image(digest, image)
        nested = getattr(node, "node_tree", None)
        if nested is not None:
            _fingerprint_node_tree(digest, nested, visited)
    for link in sorted(
        tree.links,
        key=lambda item: (
            item.from_node.name, item.from_socket.identifier,
            item.to_node.name, item.to_socket.identifier,
        ),
    ):
        _fingerprint_value(digest, (
            link.from_node.name, link.from_socket.identifier,
            link.to_node.name, link.to_socket.identifier,
        ))


def _fingerprint_material(digest, material, visited) -> None:
    digest.update(b"MATERIAL")
    _fingerprint_rna_scalars(
        digest, material,
        skip={"name", "name_full", "users", "use_fake_user", "is_embedded_data", "is_library_indirect"},
    )
    tree = active_shader_node_tree(material)
    if tree is not None:
        _fingerprint_node_tree(digest, tree, visited)


def _fingerprint_mesh(digest, mesh, include_atlas=False) -> None:
    digest.update(b"MESH")
    for collection, prop, code in (
        (mesh.vertices, "co", "f"),
        (mesh.edges, "vertices", "i"),
        (mesh.edges, "use_seam", "b"),
        (mesh.edges, "use_edge_sharp", "b"),
        (mesh.loops, "vertex_index", "i"),
        (mesh.loops, "edge_index", "i"),
        (mesh.polygons, "loop_start", "i"),
        (mesh.polygons, "loop_total", "i"),
        (mesh.polygons, "material_index", "i"),
        (mesh.polygons, "use_smooth", "b"),
    ):
        if len(collection) and not hasattr(collection[0], prop):
            continue
        width = len(getattr(collection[0], prop)) if len(collection) and hasattr(getattr(collection[0], prop), "__len__") else 1
        values = array(code, [0]) * (len(collection) * width)
        if values:
            collection.foreach_get(prop, values)
            digest.update(values.tobytes())
    # Source UVs, color attributes, custom normals, and Geometry Nodes named
    # attributes can all feed shader pixels. Hash every mesh attribute, not
    # only positions/topology; atlas coordinates are scoped per job below.
    for attribute in sorted(mesh.attributes, key=lambda item: (item.name, item.domain, item.data_type)):
        _fingerprint_value(digest, (attribute.name, attribute.domain, attribute.data_type))
        if attribute.name == ATLAS_UV and not include_atlas:
            digest.update(b"ATLAS_ATTRIBUTE_OUTSIDE_JOB")
            continue
        for item in attribute.data:
            _fingerprint_rna_scalars(digest, item)
    for layer in sorted(mesh.uv_layers, key=lambda item: item.name):
        if layer.name == ATLAS_UV and not include_atlas:
            continue
        _fingerprint_value(digest, layer.name)
        values = array("f", [0.0]) * (len(layer.data) * 2)
        if values:
            layer.data.foreach_get("uv", values)
            digest.update(values.tobytes())
    if include_atlas:
        layer = mesh.uv_layers.get(ATLAS_UV)
        if layer is None:
            digest.update(b"MISSING_ATLAS_UV")
        else:
            values = array("f", [0.0]) * (len(layer.data) * 2)
            if values:
                layer.data.foreach_get("uv", values)
                digest.update(values.tobytes())


def _fingerprint_linking_collection(digest, label, collection) -> None:
    digest.update(label.encode("ascii"))
    if collection is None:
        digest.update(b"NONE")
        return
    _fingerprint_value(digest, (
        collection.name,
        tuple(sorted(obj.name for obj in collection.all_objects)),
        tuple(sorted(child.name for child in collection.children_recursive)),
    ))


def _fingerprint_evaluated_mesh(digest, obj, depsgraph, include_atlas) -> None:
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    if mesh is None:
        raise RuntimeError(f"{obj.name}: could not evaluate mesh for bake cache fingerprint")
    try:
        _fingerprint_mesh(digest, mesh, include_atlas=include_atlas)
    finally:
        evaluated.to_mesh_clear()


def _fingerprint_object_contributor(
        digest, obj, depsgraph, visited, *, include_atlas=False,
        evaluated=False, matrix_world=None, source_raw=False) -> None:
    """Hash one Cycles contributor using the same contract in/out of instances."""
    transform = matrix_world if matrix_world is not None else obj.matrix_world
    transform_values = transform if isinstance(transform, tuple) else tuple(
        value for row in transform for value in row
    )
    _fingerprint_value(digest, (
        "VISIBILITY", obj.name, obj.hide_render,
        tuple(sorted(collection.name for collection in obj.users_collection)),
    ))
    digest.update(b"OBJECT")
    _fingerprint_value(digest, (
        obj.type,
        transform_values,
        obj.color[:],
        obj.pass_index,
        tuple((name, getattr(obj, name, None)) for name in (
            "visible_camera", "visible_diffuse", "visible_glossy",
            "visible_transmission", "visible_volume_scatter", "visible_shadow",
            "is_shadow_catcher", "is_holdout",
        )),
        tuple(sorted(
            (key, value) for key, value in obj.items()
            # Runtime identity cannot change a Cycles pixel. Unsaved legacy
            # scenes may receive a fresh ID in each isolated exporter process.
            if key not in {"_RNA_UI", "blendlink_id"}
        )),
    ))
    cycles = getattr(obj, "cycles", None)
    if cycles is not None:
        _fingerprint_rna_scalars(digest, cycles)
    linking = getattr(obj, "light_linking", None)
    if linking is not None:
        _fingerprint_linking_collection(
            digest, "LIGHT_RECEIVERS", getattr(linking, "receiver_collection", None),
        )
        _fingerprint_linking_collection(
            digest, "SHADOW_BLOCKERS", getattr(linking, "blocker_collection", None),
        )
    for modifier in obj.modifiers:
        _fingerprint_value(digest, ("MODIFIER", modifier.name, modifier.type))
        _fingerprint_rna_scalars(digest, modifier)
        node_group = getattr(modifier, "node_group", None)
        if node_group is not None:
            _fingerprint_node_tree(digest, node_group, visited)

    if obj.type == "MESH":
        if evaluated:
            mesh = obj.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
            if mesh is None:
                raise RuntimeError(
                    f"{obj.name}: could not evaluate instanced mesh for bake cache fingerprint"
                )
            try:
                _fingerprint_mesh(digest, mesh, include_atlas=include_atlas)
            finally:
                obj.to_mesh_clear()
        elif source_raw:
            # A viewport-hidden Collection Instance can be absent from the
            # viewport depsgraph even though Cycles still renders it. Hash the
            # detached source mesh/material/modifier graph directly so cache
            # reuse remains conservative instead of silently stale.
            _fingerprint_mesh(digest, obj.data, include_atlas=include_atlas)
        else:
            _fingerprint_evaluated_mesh(digest, obj, depsgraph, include_atlas)
        for slot in obj.material_slots:
            if slot.material is None:
                digest.update(b"NO_MATERIAL")
            else:
                _fingerprint_material(digest, slot.material, visited)
    elif obj.type == "LIGHT":
        _fingerprint_rna_scalars(digest, obj.data, skip={"name", "name_full", "users"})
        tree = active_shader_node_tree(obj.data)
        if tree is not None:
            _fingerprint_node_tree(digest, tree, visited)
        _fingerprint_value(digest, getattr(obj, "lightgroup", ""))
    elif obj.data is not None:
        _fingerprint_rna_scalars(digest, obj.data, skip={"name", "name_full", "users"})
        _fingerprint_declared_file(
            digest, getattr(obj.data, "filepath", ""),
            library=getattr(obj.data, "library", None),
        )
        for slot in getattr(obj, "material_slots", ()):
            if slot.material is None:
                digest.update(b"NO_MATERIAL")
            else:
                _fingerprint_material(digest, slot.material, visited)


def _fingerprint_depsgraph_instances(digest, depsgraph, visited) -> None:
    """Hash geometry/materials generated by collection/particle instances.

    These contributors can cast bounce and shadows without their source
    objects appearing in ``scene.objects``. Depsgraph instances are the
    evaluated truth Cycles sees, including the instance transform.
    """
    instances = []
    # DepsgraphObjectInstance and its evaluated object are ephemeral RNA views
    # invalidated by the next iterator step. Fingerprint the contributor while
    # the view is live, then sort only immutable identity/bytes.
    for instance in depsgraph.object_instances:
        if not instance.is_instance:
            continue
        evaluated = instance.object
        name = evaluated.name
        persistent_id = tuple(instance.persistent_id)
        matrix_world = tuple(value for row in instance.matrix_world for value in row)
        contributor = hashlib.sha256()
        _fingerprint_object_contributor(
            contributor, evaluated, depsgraph, set(),
            include_atlas=False, evaluated=True, matrix_world=matrix_world,
        )
        instances.append((
            name, persistent_id, matrix_world, contributor.digest(),
        ))
    for name, persistent_id, matrix_world, contributor in sorted(
            instances, key=lambda item: item[:3]):
        _fingerprint_value(digest, (
            "DEPSGRAPH_INSTANCE", name, persistent_id, matrix_world,
        ))
        digest.update(contributor)


def _fingerprint_collection_instance_sources(digest, scene, depsgraph) -> None:
    """Hash detached Collection Instance sources independent of viewport state.

    Cycles evaluates render-visible Collection Instances even when the root is
    hidden only in the viewport, while ``depsgraph.object_instances`` omits
    them. Traverse authored collection ownership as a conservative second
    route. Contributor bytes are cached by object identity; occurrence paths
    and transforms remain separate so nesting/placement edits invalidate too.
    """
    contributor_cache = {}

    def contributor_bytes(obj):
        pointer = obj.as_pointer()
        cached = contributor_cache.get(pointer)
        if cached is not None:
            return cached
        local = hashlib.sha256()
        _fingerprint_object_contributor(
            local, obj, depsgraph, set(), include_atlas=False,
            source_raw=True,
        )
        cached = local.digest()
        contributor_cache[pointer] = cached
        return cached

    def walk(collection, path, ancestors):
        pointer = collection.as_pointer()
        if pointer in ancestors:
            raise RuntimeError(
                "collection-instance cycle prevents a truthful bake-cache "
                f"fingerprint at {' / '.join(path + (collection.name,))}"
            )
        current = path + (collection.name,)
        _fingerprint_value(digest, (
            "INSTANCE_COLLECTION", current, collection.hide_render,
            tuple(float(value) for value in collection.instance_offset),
        ))
        next_ancestors = ancestors | {pointer}
        for obj in sorted(collection.objects, key=lambda item: item.name):
            matrix = tuple(value for row in obj.matrix_world for value in row)
            _fingerprint_value(digest, (
                "INSTANCE_SOURCE", current, obj.name, obj.hide_render,
                obj.instance_type, matrix,
            ))
            digest.update(contributor_bytes(obj))
            nested = getattr(obj, "instance_collection", None)
            if obj.instance_type == "COLLECTION" and nested is not None:
                walk(nested, current + (obj.name,), next_ancestors)
        for child in sorted(collection.children, key=lambda item: item.name):
            walk(child, current, next_ancestors)

    for root in sorted(scene.objects, key=lambda item: item.name):
        collection = getattr(root, "instance_collection", None)
        if (root.instance_type != "COLLECTION" or collection is None
                or root.hide_render):
            continue
        matrix = tuple(value for row in root.matrix_world for value in row)
        _fingerprint_value(digest, (
            "INSTANCE_ROOT", root.name, matrix, root.hide_render,
        ))
        walk(collection, (root.name,), frozenset())


def _fingerprint_layer_collection(digest, layer_collection, path=()) -> None:
    current = path + (layer_collection.name,)
    _fingerprint_value(digest, (
        "LAYER_COLLECTION", current,
        layer_collection.exclude,
        layer_collection.holdout,
        layer_collection.indirect_only,
    ))
    for child in layer_collection.children:
        _fingerprint_layer_collection(digest, child, current)


def fingerprint_bake_dependencies(scene, layout: dict, bake: dict, group: str, mode: str) -> str:
    """Fingerprint every dependency that can change pixels in one atlas job.

    The implementation is intentionally conservative: a false invalidation
    costs time; a false reuse ships stale lighting. Camera/UI/animation-only
    edits fall out, while evaluated geometry, transforms, materials and source
    images, lights, world nodes, collection visibility, atlas UVs, Blender
    version, and quality settings participate.
    """
    digest = hashlib.sha256()
    _fingerprint_value(digest, ("blendlink-bake-cache-v1", bpy.app.version_string, mode, group, bake))
    _fingerprint_rna_scalars(digest, scene.cycles)
    _fingerprint_rna_scalars(digest, scene.render.bake)
    _fingerprint_layer_collection(digest, bpy.context.view_layer.layer_collection)
    visited = set()
    _fingerprint_node_tree(digest, active_shader_node_tree(scene.world), visited)
    if scene.world is not None:
        _fingerprint_rna_scalars(digest, scene.world, skip={"name", "name_full", "users", "node_tree"})
    group_objects = set(layout.get(group, {}).get("objects", []))
    for collection in sorted(bpy.data.collections, key=lambda item: item.name):
        _fingerprint_value(digest, (
            collection.name, collection.hide_render,
            tuple(sorted(obj.name for obj in collection.objects)),
            tuple(sorted(child.name for child in collection.children)),
        ))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in sorted(scene.objects, key=lambda item: item.name):
        # Cameras never contribute bake pixels. Fully hidden objects likewise
        # contribute nothing; toggling a previously visible object still
        # changes the digest because its complete OBJECT record disappears.
        if obj.type == "CAMERA" or obj.hide_render:
            continue
        _fingerprint_object_contributor(
            digest, obj, depsgraph, visited, include_atlas=obj in group_objects,
        )
    _fingerprint_depsgraph_instances(digest, depsgraph, visited)
    _fingerprint_collection_instance_sources(digest, scene, depsgraph)
    return digest.hexdigest()[:24]


def fingerprint_reflection_scene_dependencies(scene, view_layer=None) -> str:
    """Conservative shared fingerprint for panoramic reflection captures.

    A reflection probe photographs the rendered scene rather than one atlas
    group, so its dependency set is deliberately broader than an atlas job:
    evaluated geometry and instances, transforms, render visibility,
    materials and source images, lights, World nodes, collection/layer state,
    the current animation frame, and render-relevant Cycles settings. Camera
    objects and output-only settings do not participate because the capture
    uses a private panoramic camera and an explicit output contract.

    The expensive scene traversal is shared by every probe in a Bake All
    operation. :func:`fingerprint_reflection_probe_dependencies` adds the
    per-probe origin and quality controls without walking the scene again.
    """
    view_layer = view_layer or bpy.context.view_layer
    digest = hashlib.sha256()
    _fingerprint_value(digest, (
        "blendlink-reflection-scene-v1",
        bpy.app.version_string,
        int(scene.frame_current),
        float(scene.frame_subframe),
    ))
    cycles = getattr(scene, "cycles", None)
    if cycles is not None:
        # Capture samples and device are explicit per-operation inputs. A
        # device switch must not make an otherwise identical result appear
        # stale, while seed/denoise/bounces and every other render control can
        # change the finite-sample pixels and therefore remain dependencies.
        _fingerprint_rna_scalars(
            digest, cycles,
            skip={"samples", "preview_samples", "device", "time_limit"},
        )
    _fingerprint_layer_collection(digest, view_layer.layer_collection)
    visited = set()
    world = scene.world
    _fingerprint_node_tree(digest, active_shader_node_tree(world), visited)
    if world is not None:
        _fingerprint_rna_scalars(
            digest, world,
            skip={"name", "name_full", "users", "node_tree"},
        )
    for collection in sorted(
            _scene_collections_for_fingerprint(scene), key=lambda item: item.name):
        _fingerprint_value(digest, (
            collection.name,
            collection.hide_render,
            tuple(sorted(obj.name for obj in collection.objects)),
            tuple(sorted(child.name for child in collection.children)),
        ))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in sorted(scene.objects, key=lambda item: item.name):
        if obj.type == "CAMERA" or obj.hide_render:
            continue
        _fingerprint_object_contributor(
            digest, obj, depsgraph, visited, include_atlas=False,
        )
    _fingerprint_depsgraph_instances(digest, depsgraph, visited)
    _fingerprint_collection_instance_sources(digest, scene, depsgraph)
    return digest.hexdigest()


def _scene_collections_for_fingerprint(scene):
    """Collections reachable from one Scene, including its private root."""
    result = []
    stack = [scene.collection]
    seen = set()
    while stack:
        collection = stack.pop()
        pointer = collection.as_pointer()
        if pointer in seen:
            continue
        seen.add(pointer)
        result.append(collection)
        stack.extend(collection.children)
    return result


def fingerprint_reflection_probe_dependencies(
        scene, position, resolution: int, samples: int, *,
        view_layer=None, scene_fingerprint: str | None = None,
        excluded_objects=()) -> str:
    """Return the rename-independent source identity for one probe bake."""
    if scene_fingerprint is None:
        scene_fingerprint = fingerprint_reflection_scene_dependencies(
            scene, view_layer=view_layer,
        )
    values = tuple(float(value) for value in position)
    if len(values) != 3 or not all(math.isfinite(value) for value in values):
        raise ValueError("reflection probe capture origin must contain three finite values")
    resolution = int(resolution)
    samples = int(samples)
    if resolution < 16 or resolution > 2048 or resolution & (resolution - 1):
        raise ValueError("reflection probe resolution must be a power of two from 16..2048")
    if not 1 <= samples <= 16384:
        raise ValueError("reflection probe samples must be 1..16384")
    excluded_ids = []
    for obj in excluded_objects:
        object_id = obj.get("blendlink_id") if obj is not None else None
        if not isinstance(object_id, str) or not object_id:
            raise ValueError(
                "reflection probe receiver exclusion needs stable blendlink_id values; "
                "run Set Up Blendlink Scene and save before baking"
            )
        excluded_ids.append(object_id)
    if len(excluded_ids) != len(set(excluded_ids)):
        raise ValueError("reflection probe receiver exclusion contains duplicate stable IDs")
    digest = hashlib.sha256()
    _fingerprint_value(digest, (
        "blendlink-reflection-probe-v2",
        scene_fingerprint,
        values,
        resolution,
        samples,
        tuple(sorted(excluded_ids)),
        # Blendlink defines resolution as cubemap-face detail and therefore
        # writes a 4R x 2R equirectangular source. Needle defines its field as
        # panorama width, so its smaller output is a distinct contract rather
        # than a violation of its own UI promise.
        "equirectangular-4x2",
        "openexr-half-zip",
        "exclude-assigned-receivers-v1",
    ))
    return digest.hexdigest()[:24]


# --------------------------------------------------------------------------
# Progress protocol
# --------------------------------------------------------------------------

_PROGRESS_STATE = {"fraction": 0.0, "label": "starting Blender export"}
_PROGRESS_HEARTBEAT_STARTED = False


def ensure_progress_heartbeat(interval_seconds: float = 20.0) -> None:
    """Keep the Node inactivity watchdog truthful during silent Cycles work.

    A single high-resolution ``bpy.ops.object.bake`` call can legitimately run
    longer than the invoker's inactivity window without producing Blender
    output. The heartbeat touches no bpy data; it only repeats the last known
    machine-readable progress record from a daemon thread while a wrapper has
    explicitly enabled the protocol.
    """
    global _PROGRESS_HEARTBEAT_STARTED
    if os.environ.get("BLENDLINK_PROGRESS") != "1" or _PROGRESS_HEARTBEAT_STARTED:
        return
    _PROGRESS_HEARTBEAT_STARTED = True
    stopped = threading.Event()

    def beat() -> None:
        while not stopped.wait(interval_seconds):
            payload = json.dumps({**_PROGRESS_STATE, "heartbeat": True})
            print(f"##blendlink {payload}", flush=True)

    threading.Thread(
        target=beat,
        name="blendlink-progress-heartbeat",
        daemon=True,
    ).start()
    atexit.register(stopped.set)


def progress(fraction: float, label: str) -> None:
    """Machine-readable progress line, only when a wrapper asks for it."""
    if os.environ.get("BLENDLINK_PROGRESS") != "1":
        return
    _PROGRESS_STATE.update({"fraction": round(fraction, 4), "label": label})
    payload = json.dumps(_PROGRESS_STATE)
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


_CYCLES_GPU_BACKENDS = ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL")


def snapshot_cycles_compute_state(scene) -> dict:
    """Start an exact, lazily populated Cycles device-state transaction.

    Device discovery itself can reveal preference entries that were not
    enumerable before a backend query. ``configure_cycles_compute_device``
    therefore records each device's ``use`` value immediately after it is
    discovered and before it mutates anything. The returned snapshot is
    intentionally opaque to callers; pass it back to
    ``restore_cycles_compute_state``.
    """
    cycles = getattr(scene, "cycles", None)
    if cycles is None:
        raise RuntimeError("Cycles settings are unavailable in this Blender build")
    return {
        "cycles": cycles,
        "scene_device": cycles.device,
        "preferences": None,
        "compute_device_type": None,
        "devices": [],
        "device_keys": set(),
    }


def _remember_cycles_preferences(snapshot: dict | None, preferences, devices=()) -> None:
    if snapshot is None:
        return
    if snapshot["preferences"] is None:
        snapshot["preferences"] = preferences
        snapshot["compute_device_type"] = preferences.compute_device_type
    elif snapshot["preferences"] is not preferences:
        raise RuntimeError("Cycles preferences changed during device selection")
    candidates = list(getattr(preferences, "devices", ())) + list(devices)
    for device in candidates:
        key = id(device)
        if key in snapshot["device_keys"]:
            continue
        snapshot["device_keys"].add(key)
        snapshot["devices"].append((device, bool(device.use)))


def configure_cycles_compute_device(
        scene, *, log=print, restore_state: dict | None = None,
        purpose: str = "bake") -> dict:
    """Select one exact Cycles GPU backend, with truthful CPU fallback.

    The canonical policy is shared by atlas baking and offline reflection
    capture. Pass a snapshot from ``snapshot_cycles_compute_state`` when the
    caller borrows an artist-owned live scene and must restore it afterwards.
    Hardware names remain local log evidence; the returned record is safe to
    publish because it contains only the broad device class and backend.
    """
    cycles = getattr(scene, "cycles", None)
    if cycles is None:
        raise RuntimeError("Cycles settings are unavailable in this Blender build")
    cycles.device = "CPU"
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
        _remember_cycles_preferences(restore_state, preferences)
    except Exception as error:
        log(
            f"blendlink {purpose}: Cycles device discovery failed; using CPU — "
            f"{type(error).__name__}: {error}"
        )
        return {"deviceClass": "cpu", "backend": "cpu"}

    attempts = []
    for backend in _CYCLES_GPU_BACKENDS:
        try:
            preferences.compute_device_type = backend
            targeted_query = getattr(preferences, "get_devices_for_type", None)
            if callable(targeted_query):
                devices = list(targeted_query(backend))
            else:
                # Compatibility with older supported Blender releases. Newer
                # Cycles exposes a targeted query so unrelated GPU drivers are
                # not initialized merely to discover one backend.
                preferences.get_devices()
                devices = list(preferences.devices)
            _remember_cycles_preferences(restore_state, preferences, devices)
        except (TypeError, ValueError, RuntimeError) as error:
            attempts.append(f"{backend}: {error}")
            continue
        gpus = [device for device in devices if device.type == backend]
        if gpus:
            # CUDA and OptiX can expose two logical entries for one NVIDIA GPU.
            # Enable only the selected exact backend; do not silently enable a
            # hybrid CPU+GPU render or another logical driver for the card.
            all_devices = list(preferences.devices)
            _remember_cycles_preferences(restore_state, preferences, all_devices)
            for device in all_devices:
                device.use = device.type == backend
            for device in gpus:
                device.use = True
            cycles.device = "GPU"
            log(
                f"blendlink {purpose}: using {backend} on "
                + ", ".join(f"{backend}: {device.name}" for device in gpus)
            )
            return {"deviceClass": "gpu", "backend": backend.lower()}
        attempts.append(f"{backend}: no compatible GPU device")
    log(
        f"blendlink {purpose}: no compatible GPU backend; using CPU — "
        + "; ".join(attempts)
    )
    return {"deviceClass": "cpu", "backend": "cpu"}


def restore_cycles_compute_state(snapshot: dict) -> None:
    """Restore every Cycles preference touched by a temporary selection."""
    errors = []
    preferences = snapshot.get("preferences")
    if preferences is not None:
        for device, use in snapshot.get("devices", ()):
            try:
                device.use = use
            except Exception as error:
                errors.append(
                    f"device {getattr(device, 'name', '<unknown>')}: "
                    f"{type(error).__name__}: {error}"
                )
        try:
            preferences.compute_device_type = snapshot["compute_device_type"]
        except Exception as error:
            errors.append(
                f"compute backend: {type(error).__name__}: {error}"
            )
    try:
        snapshot["cycles"].device = snapshot["scene_device"]
    except Exception as error:
        errors.append(f"scene device: {type(error).__name__}: {error}")
    if errors:
        raise RuntimeError("Cycles device state restoration failed: " + "; ".join(errors))


def render_reflection_panorama_exr(
        scene, position, path: str, *, resolution: int, samples: int,
        exclude_objects=(), log=print) -> dict:
    """Render one lossless scene-linear equirectangular reflection source.

    ``resolution`` is the portable cubemap-face resolution used by the Three
    runtime contract. The panorama is therefore written at 4x by 2x that
    value, preserving comparable angular detail across the complete sphere.
    The caller owns atomic publication: this function writes exactly ``path``
    (normally a same-directory temporary file), verifies it, and returns only
    after every Blender setting and temporary datablock has been restored.

    This is intentionally the sole panoramic render/save implementation. The
    add-on provides lifecycle and UI; consumers must not copy this primitive.
    """
    position = tuple(float(value) for value in position)
    resolution = int(resolution)
    samples = int(samples)
    if len(position) != 3 or not all(math.isfinite(value) for value in position):
        raise ValueError("reflection probe capture origin must contain three finite values")
    if resolution < 16 or resolution > 2048 or resolution & (resolution - 1):
        raise ValueError("reflection probe resolution must be a power of two from 16..2048")
    if not 1 <= samples <= 16384:
        raise ValueError("reflection probe samples must be 1..16384")
    output = os.path.abspath(path)
    if not output:
        raise ValueError("reflection probe output path is empty")
    directory = os.path.dirname(output)
    if not os.path.isdir(directory):
        raise FileNotFoundError(
            f"reflection probe output directory does not exist: {directory}"
        )

    render = scene.render
    settings = render.image_settings
    cycles = getattr(scene, "cycles", None)
    if cycles is None:
        raise RuntimeError("Cycles settings are unavailable in this Blender build")
    exclusions = []
    exclusion_keys = set()
    scene_keys = {obj.as_pointer() for obj in scene.objects}
    for obj in exclude_objects:
        if obj is None:
            raise ValueError("reflection probe receiver exclusion contains a missing object")
        pointer = obj.as_pointer()
        if pointer not in scene_keys:
            raise ValueError(
                f"reflection probe receiver exclusion {obj.name!r} is not in the capture scene"
            )
        if pointer in exclusion_keys:
            continue
        exclusion_keys.add(pointer)
        exclusions.append((obj, bool(obj.hide_render)))
    device_state = snapshot_cycles_compute_state(scene)

    # Camera post/format conveniences must not contaminate local radiance or
    # alter the promised panorama dimensions. Keep this bounded and
    # feature-detected across supported Blender releases.
    render_policy = {
        key: getattr(render, key)
        for key in (
            "use_compositing", "use_sequencer", "use_stamp",
            "use_border", "use_crop_to_border", "use_multiview",
            "use_simplify", "use_freestyle", "use_motion_blur",
        )
        if hasattr(render, key)
    }
    saved = {
        "camera": scene.camera,
        "engine": render.engine,
        "resolution_x": render.resolution_x,
        "resolution_y": render.resolution_y,
        "resolution_percentage": render.resolution_percentage,
        "film_transparent": render.film_transparent,
        "filepath": render.filepath,
        "use_file_extension": render.use_file_extension,
        "file_format": settings.file_format,
        "color_mode": settings.color_mode,
        "color_depth": settings.color_depth,
        "exr_codec": settings.exr_codec,
        "cycles_samples": cycles.samples,
        "color_management": force_color_management(scene),
    }
    device_evidence = {"deviceClass": "cpu", "backend": "cpu"}
    camera_data = None
    camera_object = None
    primary_error = None
    cleanup_errors = []
    width = resolution * 4
    height = resolution * 2
    try:
        camera_data = bpy.data.cameras.new("BLENDLINK_REFLECTION_CAPTURE_CAMERA")
        camera_object = bpy.data.objects.new(
            "BLENDLINK_REFLECTION_CAPTURE_CAMERA", camera_data,
        )
        scene.collection.objects.link(camera_object)
        camera_object.location = position
        # Blender's panoramic camera basis needs this fixed orientation for an
        # equirectangular texture consumed through Three's standard mapping.
        camera_object.rotation_euler = (math.pi / 2.0, 0.0, -math.pi / 2.0)
        camera_data.type = "PANO"
        camera_data.clip_start = 0.01
        camera_data.clip_end = 1000000.0
        if hasattr(camera_data, "panorama_type"):
            camera_data.panorama_type = "EQUIRECTANGULAR"
            camera_data.latitude_min = -math.pi / 2.0
            camera_data.latitude_max = math.pi / 2.0
            camera_data.longitude_min = -math.pi
            camera_data.longitude_max = math.pi
        elif hasattr(camera_data, "cycles"):
            camera_data.cycles.panorama_type = "EQUIRECTANGULAR"
            camera_data.cycles.latitude_min = -math.pi / 2.0
            camera_data.cycles.latitude_max = math.pi / 2.0
            camera_data.cycles.longitude_min = -math.pi
            camera_data.cycles.longitude_max = math.pi
        else:
            raise RuntimeError(
                "this Blender build exposes no Cycles equirectangular camera settings"
            )

        scene.camera = camera_object
        render.engine = "CYCLES"
        render.resolution_x = width
        render.resolution_y = height
        render.resolution_percentage = 100
        render.film_transparent = False
        for key in render_policy:
            setattr(render, key, False)
        render.filepath = output
        render.use_file_extension = False
        settings.file_format = "OPEN_EXR"
        settings.color_mode = "RGB"
        settings.color_depth = "16"
        # ZIP is lossless. DWAA is attractive for size but silently sacrifices
        # the highlight detail that local reflections exist to preserve.
        settings.exr_codec = "ZIP"
        cycles.samples = samples
        for obj, _hidden in exclusions:
            obj.hide_render = True
        device_evidence = configure_cycles_compute_device(
            scene,
            log=log,
            restore_state=device_state,
            purpose="reflection probe",
        )
        log(
            f"blendlink: rendering reflection panorama {width}x{height}, "
            f"{samples} samples -> {output}"
        )
        bpy.ops.render.render(write_still=True, scene=scene.name)
        if not os.path.isfile(output) or os.path.getsize(output) <= 0:
            raise RuntimeError(
                f"reflection panorama render produced no file: {output}"
            )
    except Exception as error:
        primary_error = error
    finally:
        restores = [
            *(
                (
                    f"receiver visibility {obj.name}",
                    lambda obj=obj, hidden=hidden: setattr(obj, "hide_render", hidden),
                )
                for obj, hidden in exclusions
            ),
            (
                "Cycles compute device",
                lambda: restore_cycles_compute_state(device_state),
            ),
            ("scene camera", lambda: setattr(scene, "camera", saved["camera"])),
            ("render engine", lambda: setattr(render, "engine", saved["engine"])),
            ("resolution X", lambda: setattr(render, "resolution_x", saved["resolution_x"])),
            ("resolution Y", lambda: setattr(render, "resolution_y", saved["resolution_y"])),
            (
                "resolution percentage",
                lambda: setattr(render, "resolution_percentage", saved["resolution_percentage"]),
            ),
            (
                "film transparency",
                lambda: setattr(render, "film_transparent", saved["film_transparent"]),
            ),
            ("render filepath", lambda: setattr(render, "filepath", saved["filepath"])),
            (
                "file extension policy",
                lambda: setattr(render, "use_file_extension", saved["use_file_extension"]),
            ),
            (
                "image format",
                lambda: setattr(settings, "file_format", saved["file_format"]),
            ),
            (
                "image color mode",
                lambda: setattr(settings, "color_mode", saved["color_mode"]),
            ),
            (
                "image color depth",
                lambda: setattr(settings, "color_depth", saved["color_depth"]),
            ),
            (
                "EXR codec",
                lambda: setattr(settings, "exr_codec", saved["exr_codec"]),
            ),
            (
                "Cycles samples",
                lambda: setattr(cycles, "samples", saved["cycles_samples"]),
            ),
            (
                "color management",
                lambda: restore_color_management(scene, saved["color_management"]),
            ),
        ]
        restores.extend(
            (
                f"render policy {key}",
                lambda key=key, value=value: setattr(render, key, value),
            )
            for key, value in render_policy.items()
        )
        for label, restore in restores:
            try:
                if label != "Cycles samples" or cycles is not None:
                    restore()
            except Exception as error:
                cleanup_errors.append(f"{label}: {type(error).__name__}: {error}")
        if camera_object is not None:
            try:
                bpy.data.objects.remove(camera_object, do_unlink=True)
            except Exception as error:
                cleanup_errors.append(
                    f"temporary camera object: {type(error).__name__}: {error}"
                )
        if camera_data is not None and camera_data.users == 0:
            try:
                bpy.data.cameras.remove(camera_data)
            except Exception as error:
                cleanup_errors.append(
                    f"temporary camera data: {type(error).__name__}: {error}"
                )

    if primary_error is not None or cleanup_errors:
        detail = (
            f"{type(primary_error).__name__}: {primary_error}"
            if primary_error is not None else
            "render completed but Blender state restoration failed"
        )
        if cleanup_errors:
            detail += "; cleanup failed: " + "; ".join(cleanup_errors)
        raise RuntimeError(f"reflection panorama failed: {detail}") from primary_error
    return {
        "path": output,
        "width": width,
        "height": height,
        "samples": samples,
        "format": "exr",
        "encoding": "scene-linear-half-zip",
        "deviceClass": device_evidence["deviceClass"],
        "backend": device_evidence["backend"],
        "bytes": os.path.getsize(output),
        "hash": file_sha256(output),
    }


# --------------------------------------------------------------------------
# Saving: dither, denoise (optionally guided), resolve, flatten
# --------------------------------------------------------------------------

def _save_render_with_private_scene(
        image, path: str, *, file_format: str, color_mode: str,
        color_depth: str, dither_intensity: float = 0.0,
        view_transform: str = "Standard") -> None:
    """Write one live image buffer without borrowing the artist's scene.

    Blender narrows ``scene.render.image_settings.file_format`` for some
    authored output modes. In Blender 5.2, for example, a scene currently set
    to FFMPEG rejects assigning PNG entirely. A throwaway scene gives bake
    output a stable format/color contract and makes preservation structural
    instead of relying on mutate/restore cleanup.

    ``view_transform`` is ``Standard`` for color output the runtime samples
    as sRGB, or ``Raw`` for data channels — ORM and tangent normals — whose
    bytes must equal the linear values with no display encode.
    """
    if view_transform not in {"Standard", "Raw"}:
        raise ValueError(
            f"unsupported bake save view transform {view_transform!r}"
        )
    stage = bpy.data.scenes.new("BLENDLINK_IMAGE_SAVE_STAGE")
    try:
        stage.view_settings.view_transform = view_transform
        stage.view_settings.look = "None"
        stage.view_settings.exposure = 0.0
        stage.render.dither_intensity = float(dither_intensity)
        settings = stage.render.image_settings
        settings.file_format = file_format
        settings.color_mode = color_mode
        settings.color_depth = color_depth
        image.save_render(path, scene=stage)
        if not os.path.isfile(path) or os.path.getsize(path) <= 0:
            raise RuntimeError(
                f"{file_format} image save produced no file: {path or '<empty path>'}"
            )
    finally:
        bpy.data.scenes.remove(stage)

def save_linear_exr(image, path: str) -> None:
    """Save scene-linear float pixels to EXR without touching artist metadata.

    Environment compression runs in a separate Blender process, but it still
    shares the same Standard/None/0 output contract as every other bake save.
    Image.copy() cannot be trusted here: Blender may copy a generated image's
    datablock without its live float buffer, yielding a valid all-black EXR.
    Image.save_render() reads Blender's already-decoded scene-linear buffer
    without changing its authored filepath, format, or input colorspace and
    avoids duplicating hundreds of megabytes for an 8K HDRI. (Changing a
    generated/live image to Non-Color can invalidate its pixel buffer.) Any
    write failure is intentionally raised to the caller; optional compression
    may fall back, but never silently ships an unverified conversion.
    """
    _save_render_with_private_scene(
        image, path,
        file_format="OPEN_EXR", color_mode="RGB", color_depth="32",
    )


def save_dithered(image, path: str) -> None:
    """8-bit PNG through Standard view + dither (plain saves never dither
    and band the slow gradients). The private save scene cannot mutate an
    artist's render format or color management."""
    _save_render_with_private_scene(
        image, path,
        file_format="PNG", color_mode="RGB", color_depth="8",
        dither_intensity=1.0,
    )


def save_data_png(image, path: str) -> None:
    """8-bit PNG whose bytes equal the linear buffer values (Raw view).

    glTF samples ORM and normal textures linearly, so encoding them through
    the Standard view would sRGB-bend every roughness, metallic, and normal
    value.  Dither stays off: exact data values matter more than gradient
    banding, and UASTC normal handling renormalizes downstream.
    """
    _save_render_with_private_scene(
        image, path,
        file_format="PNG", color_mode="RGB", color_depth="8",
        view_transform="Raw",
    )


def save_denoised(image, path: str, albedo=None, normal=None) -> None:
    """OIDN via a throwaway compositor scene: Image → Denoise → output.

    The stage scene is EMPTY (renders instantly under Workbench) and its
    compositor output becomes the written file, through the same Standard
    view + dither contract. Runs after margin dilation, sidestepping the
    bake-time-denoise margin-darkening bug (blender#94573). Blendlink supplies
    the valid albedo guide only: Blender's encoded object-space NORMAL bake is
    not a truthful OIDN common-space guide and is intentionally not connected.
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


def image_signal_coverage(
        image, label: str, *, threshold: float = 1.0e-6):
    """Coverage from a dedicated constant-white EMIT bake.

    Blender 5.2's EMIT pass can set alpha across the complete target even
    where no UV-covered texel received RGB. Selected-field materialization
    therefore bakes a separate white signal target and uses its RGB rather
    than making a false alpha-coverage claim. Callers must not pass arbitrary
    artwork here: black is a valid material color but is deliberately
    impossible in the dedicated white mask.
    """
    import numpy as np

    cutoff = float(threshold)
    if not math.isfinite(cutoff) or cutoff < 0.0 or cutoff >= 1.0:
        raise ValueError(
            f"signal coverage threshold must be finite in [0, 1), got {threshold!r}"
        )
    if image is None or min(tuple(getattr(image, "size", (0, 0)))) <= 0:
        raise RuntimeError(f"{label}: signal coverage needs an initialized image")
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    covered = np.max(
        pixels.reshape(height, width, 4)[:, :, :3],
        axis=2,
    ) > cutoff
    if int(covered.sum()) == 0:
        raise RuntimeError(
            f"{label}: constant-white Cycles EMIT mask produced no covered RGB "
            "signal; Blendlink refused to publish an empty material texture. "
            "Check the bake target, selected objects, and UV layer"
        )
    return covered


def require_image_coverage(image, label: str):
    """Return coverage or fail when a populated proxy wrote no texels.

    Callers deliberately skip this when a state hides an atlas's entire
    geometry. Once a proxy was built and Cycles ran, however, zero alpha
    means the target, UV, or proxy contract broke; constant black must not
    disguise that failure as a valid scene.
    """
    covered = image_coverage(image)
    if int(covered.sum()) == 0:
        raise RuntimeError(
            f"{label}: Cycles produced no baked coverage for a populated "
            "atlas proxy; Blendlink refused to publish an empty atlas. "
            "Check the bake target, atlas UVs, and evaluated mesh"
        )
    return covered


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


# --------------------------------------------------------------------------
# Additive light-group bake mechanics
# --------------------------------------------------------------------------

def mute_emission() -> list:
    """Temporarily neutralize material emission for additive solo bakes.

    Disabling the Combined Emit pass only removes the emitting surface from
    its own texel; linked emission can still bounce onto every other surface.
    Disconnect strength links (including nested groups) and restore the exact
    graph afterwards so each light layer contains only its named lights.
    """
    muted = []
    seen_trees = set()

    def walk(tree):
        if tree is None or tree.as_pointer() in seen_trees:
            return
        seen_trees.add(tree.as_pointer())
        for node in tree.nodes:
            nested = getattr(node, "node_tree", None)
            if nested is not None:
                walk(nested)
            sockets = []
            if node.type in {"EMISSION", "BACKGROUND"}:
                sockets.append(node.inputs.get("Strength"))
            elif node.type == "BSDF_PRINCIPLED":
                sockets.append(node.inputs.get("Emission Strength"))
            for socket in sockets:
                if socket is None:
                    continue
                links = [(link.from_socket, link.to_socket) for link in socket.links]
                muted.append((tree, socket, socket.default_value, links))
                for link in list(socket.links):
                    tree.links.remove(link)
                socket.default_value = 0.0

    for material in bpy.data.materials:
        tree = active_shader_node_tree(material)
        if tree is not None:
            walk(tree)
    return muted


def restore_emission(muted: list) -> None:
    """Restore the exact emission values and links returned by mute_emission."""
    for tree, socket, value, links in muted:
        socket.default_value = value
        for from_socket, to_socket in links:
            tree.links.new(from_socket, to_socket)


def covered_light_peak(rgb, covered) -> float:
    """Robust peak of authored texels only; empty atlas area is irrelevant."""
    import numpy as np

    samples = rgb[covered.reshape(-1)]
    return float(np.quantile(samples.max(axis=1), 0.999)) if len(samples) else 0.0


def normalize_bake_image(image, covered=None) -> float:
    """Peak-normalize a float bake atlas before its 8-bit save.

    A rare hot texel must not crush useful lighting or finished appearance
    into the lowest PNG bits. The scale uses the covered-texel 99.9th
    percentile; the runtime multiplier reconstructs the linear range before
    tone mapping. It is always at least one, so ordinary LDR bakes remain
    byte-identical.
    """
    import numpy as np

    coverage = image_coverage(image) if covered is None else covered
    pixels = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    rgb = pixels.reshape(-1, 4)[:, :3]
    peak = covered_light_peak(rgb, coverage)
    if peak > 1.0:
        np.clip(rgb / peak, 0.0, 1.0, out=rgb)
        image.pixels.foreach_set(pixels)
    return max(peak, 1.0)


def normalize_light_image(image, covered=None) -> float:
    """Compatibility name for callers predating normalized Appearance states."""
    return normalize_bake_image(image, covered)


def flatten_saved_background(
        path: str, covered, label: str = "", log=print,
        source_peak: float | None = None) -> None:
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
    image = bpy.data.images.load(path, check_existing=False)
    try:
        width, height = image.size
        if (height, width) != covered.shape:
            raise RuntimeError(
                f"{tag}: saved atlas is {width}x{height}, but bake coverage is "
                f"{covered.shape[1]}x{covered.shape[0]}"
            )
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        rgba = pixels.reshape(height, width, 4)
        # Structurally valid PNGs can still lose their useful signal before
        # saving (Blender 5.2's Image.copy() does this to live float images).
        # A genuinely black bake remains valid because its source peak is 0.
        if source_peak is not None and source_peak >= (4.0 / 255.0):
            saved_peak = covered_light_peak(
                rgba[:, :, :3].reshape(-1, 3), covered,
            )
            if saved_peak <= (1.5 / 255.0):
                raise RuntimeError(
                    f"{tag}: saved atlas lost its visible RGB signal "
                    f"(source peak {source_peak:.6g}, saved peak {saved_peak:.6g}); "
                    "Blendlink refused to publish a valid-but-black PNG"
                )
        if covered.all():
            log(f"blendlink: background fill skipped for {tag} — alpha reports full coverage")
            return
        # Byte-backed pixels round-trip as value/255 with no transforms, so
        # a k/255 constant survives the re-save exactly.
        covered_count = int(covered.sum())
        if covered_count == 0:
            # A state may intentionally hide an atlas's entire geometry. It
            # has no island mean, so publish one explicit constant instead of
            # leaving dither/denoise residue in invisible texels.
            mean = np.zeros(3, dtype=np.float32)
            log(f"blendlink: {tag} has no baked coverage — publishing constant black")
        else:
            mean = np.round(rgba[:, :, :3][covered].mean(axis=0) * 255.0) / 255.0
        rgba[:, :, :3][~covered] = mean
        if covered_count == 0:
            rgba[:, :, :3] = mean
        rgba[:, :, 3] = 1.0
        image.pixels.foreach_set(pixels)
        image.filepath_raw = path
        image.file_format = "PNG"
        image.save()
        holes = int(covered.size - covered_count)
        log(f"blendlink: flattened {holes} background texels of {tag} to a constant")
    finally:
        bpy.data.images.remove(image)


def delivery_variant_sizes(final_size: int, minimum: int = 256) -> list[int]:
    """Resolution tiers below the artist-owned canonical atlas.

    The full PNG remains the editable/source-of-truth artifact.  These are
    delivery derivatives only: a website can begin with the smallest tier
    appropriate for its actual viewport and promote to a larger one without
    asking every phone to allocate the full atlas.  Power-of-two tiers remain
    predictable even when an advanced user authors a non-power-of-two atlas.
    """
    final = int(final_size)
    floor = max(1, int(minimum))
    if final <= floor:
        return []
    sizes = []
    size = floor
    while size < final:
        sizes.append(size)
        size *= 2
    return sizes


def resize_coverage_any(covered, target_size: int):
    """Conservatively resolve bake coverage to a square delivery tier.

    Coverage is not ordinary color data.  Filtering alpha and thresholding it
    can erase thin UV islands; nearest-neighbour can miss them entirely.  A
    target texel is therefore covered when *any* source texel in its footprint
    was covered.  Exact integer reductions use a compact reshape.  The summed
    area fallback handles intentionally non-power-of-two artist atlases.
    """
    import numpy as np

    source = np.asarray(covered, dtype=bool)
    if source.ndim != 2 or source.shape[0] != source.shape[1]:
        raise RuntimeError(
            f"atlas coverage must be square; received {source.shape!r}"
        )
    target = int(target_size)
    if target <= 0:
        raise RuntimeError(f"delivery atlas size must be positive; received {target}")
    height, width = source.shape
    if target == width:
        return source.copy()
    if target > width:
        raise RuntimeError(
            f"delivery atlas {target}px cannot exceed canonical atlas {width}px"
        )
    if width % target == 0:
        factor = width // target
        return source.reshape(target, factor, target, factor).any(axis=(1, 3))

    # Rectangle sums are fully vectorized. uint32 is sufficient for the
    # supported maximum 8192^2 atlas (67,108,864 covered texels).
    integral = np.pad(
        source.astype(np.uint32).cumsum(axis=0, dtype=np.uint32)
        .cumsum(axis=1, dtype=np.uint32),
        ((1, 0), (1, 0)),
    )
    starts = np.floor(np.arange(target) * width / target).astype(np.int64)
    ends = np.ceil((np.arange(target) + 1) * width / target).astype(np.int64)
    sums = (
        integral[ends[:, None], ends[None, :]]
        - integral[starts[:, None], ends[None, :]]
        - integral[ends[:, None], starts[None, :]]
        + integral[starts[:, None], starts[None, :]]
    )
    return sums > 0


def delivery_variant_path(path: str, size: int) -> str:
    source = Path(path)
    return str(source.with_name(f"{source.stem}.{int(size)}{source.suffix}"))


def publish_delivery_variants(
        canonical_path: str, canonical_coverage, sizes=None, log=print) -> list[dict]:
    """Publish resolution derivatives from the finalized canonical PNG.

    This intentionally lives beside every other bake-save primitive.  The
    finalized PNG is decoded, resized, saved through the same color contract,
    and has its constant background restored *after* the lossy resize/dither
    stage.  No TypeScript image library is allowed to approximate this path.
    """
    import numpy as np

    sizes = delivery_variant_sizes(canonical_coverage.shape[1]) if sizes is None else sizes
    requested = sorted({int(size) for size in sizes})
    variants = []
    for size in requested:
        if size <= 0 or size >= canonical_coverage.shape[1]:
            raise RuntimeError(
                f"delivery variant {size}px must be smaller than canonical atlas "
                f"{canonical_coverage.shape[1]}px"
            )
        variant_path = delivery_variant_path(canonical_path, size)
        variant = bpy.data.images.load(canonical_path, check_existing=False)
        try:
            variant.scale(size, size)
            covered = resize_coverage_any(canonical_coverage, size)
            pixels = np.empty(size * size * 4, dtype=np.float32)
            variant.pixels.foreach_get(pixels)
            source_peak = covered_light_peak(
                pixels.reshape(-1, 4)[:, :3], covered,
            )
            save_dithered(variant, variant_path)
            flatten_saved_background(
                variant_path, covered,
                label=f"{Path(canonical_path).stem} {size}px delivery tier",
                log=log, source_peak=source_peak,
            )
        finally:
            bpy.data.images.remove(variant)
        if not os.path.isfile(variant_path) or os.path.getsize(variant_path) <= 0:
            raise RuntimeError(
                f"delivery atlas save produced no file: {variant_path}"
            )
        variants.append({
            "path": variant_path,
            "width": size,
            "height": size,
            "bytes": os.path.getsize(variant_path),
            "hash": file_sha256(variant_path),
        })
        log(
            f"blendlink: published verified {size}px delivery tier for "
            f"{Path(canonical_path).name}"
        )
    return variants


def save_resolved(
    image, path: str, final_size: int, denoise: bool = False,
    albedo=None, normal=None, delivery_sizes=None, coverage=None,
    data: bool = False,
) -> list[dict]:
    """Save at final_size and restore the reusable bake target's dimensions.

    Blender 5.2's ``Image.copy()`` can omit a live generated float image's
    RGB buffer. Resolve the live image in place instead. Exporter bake jobs
    always clear before Cycles writes the next result, so restoring dimensions
    is sufficient; the prior pixels are deliberately not observable. Guides
    are resolved once in place so GUIDED OIDN stays aligned. ``coverage`` is
    reserved for a separately proved mask such as a constant-white EMIT pass;
    ordinary COMBINED/DIFFUSE callers continue to use the target alpha.
    """
    import numpy as np

    original_size = tuple(image.size)
    resolved_coverage = None
    if coverage is not None:
        source_coverage = np.asarray(coverage, dtype=bool)
        expected_shape = (original_size[1], original_size[0])
        if source_coverage.shape != expected_shape:
            raise RuntimeError(
                f"explicit bake coverage is {source_coverage.shape!r}, expected "
                f"{expected_shape!r} for {original_size[0]}x{original_size[1]} image"
            )
        if final_size > original_size[0] or original_size[0] != original_size[1]:
            raise RuntimeError(
                "explicit bake coverage can resolve only a square source at or "
                "above the requested final size"
            )
        resolved_coverage = (
            source_coverage.copy()
            if final_size == original_size[0]
            else resize_coverage_any(source_coverage, final_size)
        )
    if image.size[0] != final_size or image.size[1] != final_size:
        image.scale(final_size, final_size)
    target = image
    try:
        guides = {"albedo": albedo, "normal": normal}
        # Guides are disposable products of this bake and may be reused across
        # several light layers. Resolve them once in place; copying a live
        # float guide has the same black-buffer failure as copying the target.
        for guide in guides.values():
            if guide is not None and (
                    guide.size[0] != final_size or guide.size[1] != final_size):
                guide.scale(final_size, final_size)
        # Coverage at the SAVED size (alpha survives the resolve scale);
        # captured before saving because the 8-bit save discards alpha.
        covered = (
            image_coverage(target)
            if resolved_coverage is None else resolved_coverage
        )
        source_pixels = np.empty(
            target.size[0] * target.size[1] * 4, dtype=np.float32,
        )
        target.pixels.foreach_get(source_pixels)
        source_peak = covered_light_peak(
            source_pixels.reshape(-1, 4)[:, :3], covered,
        )
        del source_pixels
        if data:
            # Data channels never denoise: OIDN is trained on lit color and
            # its edits would corrupt exact roughness/metallic/normal values.
            if denoise:
                raise ValueError("data-channel saves cannot be denoised")
            save_data_png(target, path)
        elif denoise:
            try:
                save_denoised(target, path, albedo=guides["albedo"], normal=guides["normal"])
            except Exception as error:  # noqa: BLE001 — enhancement, never a gate
                print(f"BLENDLINK_DENOISE_FALLBACK {error}")
                save_dithered(target, path)
        else:
            save_dithered(target, path)
        flatten_saved_background(path, covered, source_peak=source_peak)
        return publish_delivery_variants(
            path, covered,
            delivery_variant_sizes(final_size) if delivery_sizes is None else delivery_sizes,
        )
    finally:
        if tuple(image.size) != original_size:
            image.scale(*original_size)


# --------------------------------------------------------------------------
# Texel density: weights, quantization, atlas packing
# --------------------------------------------------------------------------

def quantize_half_pow2(value: float) -> float:
    """Snap to 2^(k/2): pack-layout hysteresis across minor scene edits."""
    if value <= 0.0:
        return 0.0
    return 2.0 ** (round(math.log2(value) * 2.0) / 2.0)


def _material_binding_world_area_and_center(obj, slot_index: int) -> tuple[float, Vector]:
    """Measured source-face area and representative centre in world space."""
    if obj is None or getattr(obj, "type", None) != "MESH":
        raise RuntimeError("selected-field density planning needs one Mesh object")
    mesh = obj.data
    mesh.calc_loop_triangles()
    used_vertices = set()
    area = 0.0
    for triangle in mesh.loop_triangles:
        polygon = mesh.polygons[triangle.polygon_index]
        if int(polygon.material_index) != int(slot_index):
            continue
        points = [
            obj.matrix_world @ mesh.vertices[index].co
            for index in triangle.vertices
        ]
        triangle_area = 0.5 * (points[1] - points[0]).cross(
            points[2] - points[0]
        ).length
        if math.isfinite(triangle_area):
            area += triangle_area
        used_vertices.update(int(index) for index in triangle.vertices)
    if not math.isfinite(area) or area <= 1.0e-12 or not used_vertices:
        raise RuntimeError(
            f'{obj.name}: selected material slot {slot_index} has no finite '
            "non-zero world-space surface area"
        )
    centre = sum(
        (
            obj.matrix_world @ mesh.vertices[index].co
            for index in sorted(used_vertices)
        ),
        Vector(),
    ) / len(used_vertices)
    if any(not math.isfinite(float(value)) for value in centre):
        raise RuntimeError(
            f"{obj.name}: selected material receiver has a non-finite world centre"
        )
    return area, centre


def _bounded_power_of_two(value: int, minimum: int, maximum: int) -> int:
    if minimum <= 0 or maximum < minimum:
        raise ValueError("invalid power-of-two bounds")
    target = max(1, int(value))
    result = 1 << (target - 1).bit_length()
    return min(max(result, minimum), maximum)


def _source_unit_evidence(scene, world_area_blender_units_squared: float) -> dict:
    """Name source-declared units without conflating them with glTF units."""
    unit_settings = scene.unit_settings
    unit_system = str(unit_settings.system)
    meters_per_blender_unit = None
    if unit_system in {"METRIC", "IMPERIAL"}:
        candidate = float(unit_settings.scale_length)
        if not math.isfinite(candidate) or candidate <= 0.0:
            raise RuntimeError(
                "selected-field source unit scale must be finite and positive"
            )
        meters_per_blender_unit = candidate
    return {
        "sourceUnitSystem": unit_system,
        "sourceMetersPerBlenderUnit": meters_per_blender_unit,
        "sourceWorldAreaBlenderUnitsSquared": (
            world_area_blender_units_squared
        ),
        "sourceWorldAreaSquareMeters": (
            world_area_blender_units_squared
            * meters_per_blender_unit
            * meters_per_blender_unit
            if meters_per_blender_unit is not None else None
        ),
    }


def _clip_homogeneous_polygon(points) -> list[Vector]:
    """Clip homogeneous points to Blender's OpenGL camera volume."""
    polygon = [point.copy() for point in points]
    planes = (
        lambda point: point.w + point.x,
        lambda point: point.w - point.x,
        lambda point: point.w + point.y,
        lambda point: point.w - point.y,
        lambda point: point.w + point.z,
        lambda point: point.w - point.z,
    )
    for distance in planes:
        source = polygon
        polygon = []
        if not source:
            break
        previous = source[-1]
        previous_distance = float(distance(previous))
        previous_inside = previous_distance >= 0.0
        for current in source:
            current_distance = float(distance(current))
            current_inside = current_distance >= 0.0
            if current_inside != previous_inside:
                denominator = previous_distance - current_distance
                if abs(denominator) > 1.0e-20:
                    amount = previous_distance / denominator
                    polygon.append(
                        previous + (current - previous) * amount
                    )
            if current_inside:
                polygon.append(current)
            previous = current
            previous_distance = current_distance
            previous_inside = current_inside
    return polygon


def _material_projected_pixel_area(
        obj, slot_index: int, camera, width: int, height: int,
) -> float:
    """Conservative clipped triangle footprint, capped to one viewport."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_camera = camera.evaluated_get(depsgraph)
    try:
        projection = evaluated_camera.calc_matrix_camera(
            depsgraph,
            x=int(width),
            y=int(height),
            scale_x=float(bpy.context.scene.render.pixel_aspect_x),
            scale_y=float(bpy.context.scene.render.pixel_aspect_y),
        )
    except (AttributeError, RuntimeError, TypeError, ValueError):
        return 0.0
    view_projection = projection @ evaluated_camera.matrix_world.inverted()
    mesh = obj.data
    mesh.calc_loop_triangles()
    viewport_pixels = float(width * height)
    projected_pixels = 0.0
    for triangle in mesh.loop_triangles:
        polygon = mesh.polygons[triangle.polygon_index]
        if int(polygon.material_index) != int(slot_index):
            continue
        clip_points = [
            view_projection @ (obj.matrix_world @ mesh.vertices[index].co).to_4d()
            for index in triangle.vertices
        ]
        clipped = _clip_homogeneous_polygon(clip_points)
        if len(clipped) < 3:
            continue
        ndc = [
            (float(point.x / point.w), float(point.y / point.w))
            for point in clipped
            if math.isfinite(float(point.w)) and abs(float(point.w)) > 1.0e-20
        ]
        if len(ndc) != len(clipped):
            continue
        area = abs(_signed_polygon_area(ndc)) * viewport_pixels * 0.25
        if math.isfinite(area):
            projected_pixels += area
        if projected_pixels >= viewport_pixels:
            return viewport_pixels
    return min(max(projected_pixels, 0.0), viewport_pixels)


def plan_material_texture_resolution(
        obj, slot_index: int, *, purpose: str,
) -> dict:
    """Zero-config screen-density policy for one private material texture.

    Needle 1.4.2 exposes a manual fixed 128..8192 choice (default 1024) and
    relative object allocation, but does not prove screen density. Blendlink
    instead measures the receiver's clipped authored-camera pixel footprint,
    then compares it with the packed UV texel area. This handles camera-inside
    backgrounds without treating an enormous hidden world surface as visible
    screen density. The plan is inspection-only and JSON-safe; packing remains
    transaction-private.
    """
    if purpose not in {"inspect", "preview", "final"}:
        raise ValueError(f"unsupported material texture purpose {purpose!r}")
    scene = bpy.context.scene
    render = scene.render
    scale = max(float(render.resolution_percentage), 1.0) / 100.0
    width = max(1, int(round(float(render.resolution_x) * scale)))
    height = max(1, int(round(float(render.resolution_y) * scale)))
    render_ceiling = _bounded_power_of_two(max(width, height), 128, 4096)
    ceiling = (
        min(render_ceiling, 1024)
        if purpose == "preview" else render_ceiling
    )
    area, centre = _material_binding_world_area_and_center(obj, slot_index)

    eligible_cameras = sorted(
        (item for item in scene.objects if item.type == "CAMERA"),
        key=lambda item: item.name.casefold(),
    )
    eligible_cameras = [
        camera for camera in eligible_cameras
        if camera.data.type in {"ORTHO", "PERSP"}
    ]
    candidates = []
    for camera in eligible_cameras:
        projected_pixels = _material_projected_pixel_area(
            obj, slot_index, camera, width, height,
        )
        if math.isfinite(projected_pixels) and projected_pixels > 0.0:
            stable_id = camera.get("blendlink_id")
            candidates.append({
                "projectedTriangleAreaSumPixelAreaCapped": projected_pixels,
                "name": camera.name,
                "stableId": (
                    stable_id
                    if isinstance(stable_id, str) and stable_id else None
                ),
            })

    selected = max(
        candidates,
        default=None,
        key=lambda item: item[
            "projectedTriangleAreaSumPixelAreaCapped"
        ],
    )
    source_units = _source_unit_evidence(scene, area)
    measurement = {
        "measurementModel": "selected-field-density-v1",
        **source_units,
        "projectionMetric": (
            "clipped-triangle-area-sum-capped-to-viewport"
        ),
        "cameraScope": (
            "all-scene-perspective-orthographic-cameras"
        ),
        "cameraSelection": "maximum-projected-triangle-area-sum",
        "selectedCameraName": selected["name"] if selected else None,
        "selectedCameraStableId": (
            selected["stableId"] if selected else None
        ),
        "eligibleCameraCount": len(eligible_cameras),
        "projectingCameraCount": len(candidates),
    }
    if selected is None:
        fallback = min(1024, ceiling)
        return {
            "policy": "fallback-no-camera",
            "purpose": purpose,
            "materialSlotIndex": int(slot_index),
            "effectiveRenderWidth": width,
            "effectiveRenderHeight": height,
            "renderCeiling": render_ceiling,
            "resolutionCeiling": ceiling,
            "fallbackResolution": fallback,
            "targetPxPerMeter": None,
            "targetProjectedPixels": None,
            "projectedCoverageFraction": None,
            "projectedTriangleAreaSumPixelAreaCapped": None,
            "projectedTriangleAreaSumFractionCapped": None,
            "camera": None,
            "cameraDepth": None,
            "worldAreaM2": area,
            **measurement,
            "densityThreshold": 0.95,
            "warning": (
                "No valid Blender camera sees this receiver; Blendlink "
                f"uses Needle's 1024px default bounded to {fallback}px. Add an "
                "authored Blender camera/composition to enable automatic "
                "projected-coverage sizing."
            ),
        }

    target_pixels = selected[
        "projectedTriangleAreaSumPixelAreaCapped"
    ]
    projected_fraction = target_pixels / float(width * height)
    return {
        "policy": "projected-camera-coverage",
        "purpose": purpose,
        "materialSlotIndex": int(slot_index),
        "effectiveRenderWidth": width,
        "effectiveRenderHeight": height,
        "renderCeiling": render_ceiling,
        "resolutionCeiling": ceiling,
        "fallbackResolution": None,
        "targetPxPerMeter": None,
        "targetProjectedPixels": target_pixels,
        "projectedCoverageFraction": projected_fraction,
        "projectedTriangleAreaSumPixelAreaCapped": target_pixels,
        "projectedTriangleAreaSumFractionCapped": projected_fraction,
        "camera": selected["name"],
        "cameraDepth": None,
        "worldAreaM2": area,
        **measurement,
        "densityThreshold": 0.95,
        "warning": (
            "Preview caps private selected-field textures at 1024px; its "
            "projected-coverage result is diagnostic rather than a Final claim."
            if purpose == "preview" and ceiling < render_ceiling else None
        ),
    }


def _format_private_uv_issues(issues: list[dict]) -> str:
    details = []
    for issue in issues[:8]:
        label = f"{issue.get('object', '<unknown>')} {issue.get('kind', 'layout')}"
        island = issue.get("island")
        if island is not None:
            label += f" island {island}"
        details.append(label)
    if len(issues) > 8:
        details.append(f"and {len(issues) - 8} more")
    return "; ".join(details)


def _material_texture_source_uv(obj):
    """Choose the artist UV topology worth preserving on private data."""
    mesh = obj.data
    authored = mesh.uv_layers.get(AUTHORED_UV)
    if authored is not None:
        return authored, "authored-atlas"
    render_layers = [
        layer for layer in mesh.uv_layers
        if bool(getattr(layer, "active_render", False))
    ]
    if len(render_layers) == 1:
        return render_layers[0], "active-render-copy"
    active = getattr(mesh.uv_layers, "active", None)
    if active is not None:
        return active, (
            "active-edit-copy"
            if not render_layers else "ambiguous-render-fallback"
        )
    if len(mesh.uv_layers):
        return mesh.uv_layers[0], "first-layer-copy"
    raise RuntimeError(
        f"{obj.name}: selected-field UV source is absent after unwrap"
    )


def _uv_layer_pin_mask(layer) -> list[bool]:
    """Read UV pins without the deprecated per-loop reverse lookup."""
    modern_pins = getattr(layer, "pin", None)
    if modern_pins is not None:
        pin_count = len(modern_pins)
        if pin_count == 0:
            return [False] * len(layer.data)
        if pin_count != len(layer.data):
            raise RuntimeError(
                f"UV layer {layer.name!r} has {pin_count} pin values for "
                f"{len(layer.data)} corners"
            )
        values = [False] * pin_count
        modern_pins.foreach_get("value", values)
        return values
    # Blendlink requires Blender 4.2+, where ``MeshUVLoopLayer.pin`` exists.
    # Keep the fallback for controlled tests and unusually patched builds.
    return [bool(loop.pin_uv) for loop in layer.data]


def _uv_layer_has_pins(layer) -> bool:
    return any(_uv_layer_pin_mask(layer))


def _copy_private_material_uv(obj, source_name: str, target_name: str) -> None:
    """Copy one source UV to a disposable target without copying live pins."""
    mesh = obj.data
    source = mesh.uv_layers.get(source_name)
    if source is None:
        raise RuntimeError(
            f"{obj.name}: selected-field source UV {source_name!r} disappeared"
        )
    values = [loop.uv.copy() for loop in source.data]
    previous = mesh.uv_layers.get(target_name)
    if previous is not None and previous != source:
        mesh.uv_layers.remove(previous)
    target = mesh.uv_layers.new(name=target_name)
    if target is None:
        raise RuntimeError(
            f"{obj.name}: could not add private UV {target_name!r} "
            "(Blender's 8-layer limit); remove unused UV maps"
    )
    for index, loop in enumerate(target.data):
        loop.uv = values[index]
    if _uv_layer_has_pins(target):
        raise RuntimeError(
            f"{obj.name}: newly-created private UV {target_name!r} "
            "unexpectedly inherited artist pins"
        )
    mesh.uv_layers.active = target


def prepare_material_texture_uv(
        obj, resolution_plan: dict, *, uv_name: str = MATERIAL_ATLAS_UV, log=print,
) -> dict:
    """Create and pack a mip-safe UV only on a compiler-private Mesh.

    The artist's source UV layers are read but never changed. A caller must
    already have installed a private Mesh copy and must discard it after the
    export transaction.
    """
    if obj is None or getattr(obj, "type", None) != "MESH":
        raise RuntimeError("private selected-field UV preparation needs one Mesh")
    if not isinstance(resolution_plan, dict):
        raise TypeError("private selected-field UV preparation needs a resolution plan")
    ceiling = int(resolution_plan.get("resolutionCeiling", 0))
    if ceiling < 128 or ceiling > 4096 or ceiling & (ceiling - 1):
        raise RuntimeError(
            f"private selected-field resolution ceiling is invalid: {ceiling}"
        )
    target_pixels = resolution_plan.get("targetProjectedPixels")
    try:
        material_slot_index = int(resolution_plan["materialSlotIndex"])
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError(
            "private selected-field resolution plan has no valid material slot"
        ) from error
    if material_slot_index < 0:
        raise RuntimeError(
            "private selected-field material slot cannot be negative"
        )
    threshold = float(resolution_plan.get("densityThreshold", 0.95))
    world_area = float(resolution_plan.get(
        "sourceWorldAreaBlenderUnitsSquared",
        resolution_plan.get("worldAreaM2", 0.0),
    ))
    if target_pixels is not None:
        target_pixels = float(target_pixels)
        if not math.isfinite(target_pixels) or target_pixels <= 0.0:
            raise RuntimeError(
                "private selected-field projected pixel target is invalid"
            )
    if not math.isfinite(world_area) or world_area <= 0.0:
        raise RuntimeError("private selected-field world area is invalid")

    if target_pixels is None:
        candidates = [int(resolution_plan["fallbackResolution"])]
        minimum_candidate = candidates[0]
    else:
        # A proved in-bounds injective atlas has UV area <= 1, so no smaller
        # texture can possibly reach the requested projected-pixel ratio.
        # Start at that mathematical lower bound instead of repeating Smart
        # Project, repair, packing, and BVH validation at doomed resolutions.
        minimum_candidate = _bounded_power_of_two(
            math.ceil(threshold * math.sqrt(target_pixels)),
            128,
            ceiling,
        )
        candidates = []
        size = minimum_candidate
        while size <= ceiling:
            candidates.append(size)
            size *= 2
    selected_before = list(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active
    existing_names = {layer.name for layer in obj.data.uv_layers}
    resolved_uv_name = str(uv_name)
    suffix = 1
    while resolved_uv_name in existing_names:
        resolved_uv_name = f"{uv_name}.{suffix:03d}"
        suffix += 1
    result = None
    primary_error = None
    cleanup_error = None
    try:
        ensure_authored_uvs([obj], log=log)
        source_layer, source_strategy = _material_texture_source_uv(obj)
        source_uv_name = source_layer.name
        for candidate_index, size in enumerate(candidates):
            margin = max(2, size // 256)
            source_layout_issues = []
            source_rescue_polygons = []
            source_rescue_attempted_count = 0
            source_rescue_succeeded = False
            if source_strategy == "authored-atlas":
                stage_atlas_layers(
                    [obj], uv_name=resolved_uv_name, log=log,
                )
                uv_strategy = "authored-atlas"
                uv_generation_space = "artist-authored"
            else:
                _copy_private_material_uv(
                    obj, source_uv_name, resolved_uv_name,
                )
                uv_generation_space = "source-uv"
                complete_source_mask = {
                    obj.name: [
                        True
                        for _loop in obj.data.uv_layers[resolved_uv_name].data
                    ],
                }
                source_layout_issues = pinned_uv_layout_issues(
                    [obj],
                    resolved_uv_name,
                    complete_source_mask,
                )
                source_issue_kinds = {
                    str(issue.get("kind", "layout"))
                    for issue in source_layout_issues
                }
                if source_layout_issues and source_issue_kinds == {"degenerate"}:
                    collapsed = _nonzero_geometry_zero_uv_triangles(
                        obj, resolved_uv_name,
                    )
                    if collapsed:
                        source_rescue_polygons = (
                            _planar_rescue_collapsed_atlas_polygons(
                                obj,
                                resolved_uv_name,
                                collapsed,
                            )
                        )
                        source_rescue_attempted_count = len(
                            source_rescue_polygons
                        )
                        repaired_source_issues = pinned_uv_layout_issues(
                            [obj],
                            resolved_uv_name,
                            complete_source_mask,
                        )
                        repaired_source_blockers = [
                            issue for issue in repaired_source_issues
                            if issue.get("kind") != "out-of-bounds"
                        ]
                        remaining_collapsed = (
                            _nonzero_geometry_zero_uv_triangles(
                                obj, resolved_uv_name,
                            )
                        )
                        if (
                            not repaired_source_blockers
                            and not remaining_collapsed
                        ):
                            source_rescue_succeeded = True
                            uv_strategy = (
                                source_strategy
                                + "+local-degenerate-rescue"
                            )
                            log(
                                f"blendlink: preserved source UV "
                                f"{source_uv_name!r} on {obj.name} and locally "
                                f"rescued {len(source_rescue_polygons)} "
                                "collapsed polygon(s) on the private copy"
                            )
                        else:
                            source_layout_issues = (
                                source_layout_issues
                                + repaired_source_blockers
                            )
                if (
                    source_layout_issues
                    and not source_rescue_polygons
                ) or (
                    source_rescue_polygons
                    and not source_rescue_succeeded
                ):
                    log(
                        f"blendlink: source UV {source_uv_name!r} on "
                        f"{obj.name} is not an injective bake target "
                        f"({_format_private_uv_issues(source_layout_issues)}); "
                        "using a private Smart Project while preserving the "
                        "artist UV"
                    )
                    projection = smart_project_private_uvs(
                        [obj],
                        uv_name=resolved_uv_name,
                        log=log,
                        world_linear=True,
                    )
                    uv_strategy = "smart-project-fallback"
                    if projection.get("rescuedNonInjective"):
                        uv_strategy = "smart-project-fallback+lightmap-rescue"
                    uv_generation_space = "world-linear-private-proxy"
                elif not source_layout_issues:
                    uv_strategy = source_strategy
            if source_strategy == "ambiguous-render-fallback":
                log(
                    f"blendlink: {obj.name} has multiple active-render UV "
                    f"flags; trying active editing layer {source_uv_name!r} "
                    "on private data and validating it before bake"
                )
            prepack_repairs = repair_evaluated_atlas_uvs(
                [obj],
                uv_name=resolved_uv_name,
                log=log,
                world_linear=True,
            )
            held = average_unpinned([obj], resolved_uv_name)
            required_gutter = required_bake_gutter_px(
                margin, guard_px=4,
            ) / size
            pinned = pinned_uv_layout_issues(
                [obj], resolved_uv_name, held,
                minimum_gutter=required_gutter,
            )
            if pinned:
                pinned_kinds = {
                    str(issue.get("kind", "layout"))
                    for issue in pinned
                }
                next_candidate = (
                    candidates[candidate_index + 1]
                    if candidate_index + 1 < len(candidates)
                    else None
                )
                if (
                    next_candidate is not None
                    and pinned_kinds
                    <= {"insufficient-gutter", "insufficient-edge-gutter"}
                ):
                    log(
                        f"blendlink: pinned authored UV gutter on {obj.name} "
                        f"cannot provide {required_gutter * size:.0f}px of "
                        f"delivery padding at {size}px; retrying the bounded "
                        f"{next_candidate}px candidate"
                    )
                    continue
                attempted_label = (
                    f" at the {size}px resolution ceiling"
                    if size == ceiling
                    else f" at {size}px"
                )
                raise RuntimeError(
                    "private selected-field UV cannot honor the artist's pinned "
                    f"{AUTHORED_UV} layout{attempted_label}: "
                    f"{_format_private_uv_issues(pinned)}. "
                    "Repair/unpin that layout or remove the authored atlas layer "
                    "to let Blendlink pack a private one"
                )
            try:
                repairs, final_held = pack_with_evaluated_uv_repair(
                    [obj],
                    resolved_uv_name,
                    lambda _obj: 1.0,
                    margin,
                    size,
                    held=held,
                    pin=True,
                    delivery_size=size,
                    guard_px=4,
                    world_linear_repairs=True,
                    # The complete proof below measures exact geometric
                    # gutters; AABB charts satisfy it by construction.
                    chart_shape="AABB",
                    # This function runs the complete bounds/injectivity/
                    # gutter proof over the packed layout a few lines down
                    # (an all-True mask through pinned_uv_layout_issues),
                    # which subsumes the AABB receiver-spacing proof.
                    caller_proves_layout=True,
                    log=log,
                )
            except ReceiverGutterProofError as error:
                if candidate_index + 1 < len(candidates):
                    next_candidate = candidates[candidate_index + 1]
                elif size * 2 <= 4096:
                    # The density ceiling is a QUALITY cap, not a correctness
                    # cap: island-dense receivers (per-face lightmap charts,
                    # many-piece meshes) may need more texels than density
                    # demands before the fixed-pixel gutter contract becomes
                    # provable. Growing past the ceiling wastes texels but
                    # never bleeds; the global resolution maximum still
                    # bounds the ladder.
                    next_candidate = size * 2
                    candidates.append(next_candidate)
                else:
                    raise
                # Gutters are fixed pixels: the same layout doubles its
                # achieved gutter at the next power-of-two candidate.
                log(
                    f"blendlink: island gutters on {obj.name} cannot reach "
                    f"the bake contract at {size}px ({error}); retrying the "
                    f"bounded {next_candidate}px candidate"
                )
                continue
            all_repairs = [*prepack_repairs, *repairs]
            coverage = material_binding_packed_uv_coverage(
                obj,
                material_slot_index,
                resolved_uv_name,
            )
            uv_area = coverage["uvArea"]
            complete_mask = {
                obj.name: [
                    True
                    for _loop in obj.data.uv_layers[resolved_uv_name].data
                ],
            }
            complete_issues = pinned_uv_layout_issues(
                [obj],
                resolved_uv_name,
                complete_mask,
                minimum_gutter=(margin + 4.0) / size,
            )
            if complete_issues:
                complete_kinds = {
                    str(issue.get("kind", "layout"))
                    for issue in complete_issues
                }
                if complete_kinds <= {
                    "insufficient-gutter", "insufficient-edge-gutter",
                    "out-of-bounds", "degenerate",
                }:
                    # These kinds are resolution-dependent. Gutters are
                    # fixed pixels while layouts are fixed fractions, so a
                    # layout's gutter grows linearly with resolution. And at
                    # small candidates fixed-pixel margins become infeasible
                    # FRACTIONS — pack_islands then silently overflows the
                    # unit square (measured: 54 islands x 0.094 margin needs
                    # ~1.9 units^2; the pack spans u=[0.08,1.98] and islands
                    # shrink toward degeneracy). Retry a larger candidate
                    # (past the density ceiling if needed) before refusing;
                    # overlap kinds stay immediate refusals — packing again
                    # bigger cannot fix a fold.
                    if candidate_index + 1 < len(candidates):
                        next_candidate = candidates[candidate_index + 1]
                    elif size * 2 <= 4096:
                        next_candidate = size * 2
                        candidates.append(next_candidate)
                    else:
                        next_candidate = None
                    if next_candidate is not None:
                        log(
                            f"blendlink: packed gutters on {obj.name} fall "
                            f"short of the bake contract at {size}px "
                            f"({_format_private_uv_issues(complete_issues[:3])}); "
                            f"retrying the bounded {next_candidate}px candidate"
                        )
                        continue
                raise RuntimeError(
                    "private selected-field UV failed its complete bounds/"
                    "injectivity/gutter proof after packing: "
                    + _format_private_uv_issues(complete_issues)
                )
            achieved = math.sqrt((uv_area * size * size) / world_area)
            achieved_projected_pixels = uv_area * size * size
            meters_per_blender_unit = resolution_plan.get(
                "sourceMetersPerBlenderUnit"
            )
            achieved_per_source_meter = (
                achieved / float(meters_per_blender_unit)
                if meters_per_blender_unit is not None else None
            )
            ratio = (
                math.sqrt(achieved_projected_pixels / target_pixels)
                if target_pixels is not None else None
            )
            result = {
                **resolution_plan,
                "resolution": size,
                "minimumCandidateResolution": minimum_candidate,
                "margin": margin,
                "uvName": resolved_uv_name,
                "sourceUvName": source_uv_name,
                "uvStrategy": uv_strategy,
                "uvGenerationSpace": uv_generation_space,
                "sourceLayoutIssues": sorted({
                    str(issue.get("kind", "layout"))
                    for issue in source_layout_issues
                }),
                "sourceRescueAttemptedPolygonCount": (
                    source_rescue_attempted_count
                ),
                "sourceRescuePolygonCount": (
                    len(source_rescue_polygons)
                    if source_rescue_succeeded else 0
                ),
                "uvArea": uv_area,
                "achievedPxPerMeter": achieved,
                "achievedProjectedPixels": achieved_projected_pixels,
                "achievedTexelsPerBlenderUnit": achieved,
                "achievedTexelsPerSourceMeter": (
                    achieved_per_source_meter
                ),
                "allocatedBindingTexelArea": (
                    achieved_projected_pixels
                ),
                "densityRatio": ratio,
                "densityMet": ratio is None or ratio >= threshold,
                "authoredAtlas": source_strategy == "authored-atlas",
                "repairCount": len(all_repairs),
                "uvRepairStrategies": sorted({
                    str(repair["strategy"])
                    for repair in all_repairs
                }),
                "pinnedReceiver": bool(final_held),
            }
            if ratio is None or ratio >= threshold:
                break
        if result is None:
            raise RuntimeError("private selected-field UV preparation chose no resolution")
        zero_world_area_count = int(coverage["zeroWorldAreaTriangleCount"])
        result["ignoredZeroAreaTriangles"] = zero_world_area_count
        result["zeroWorldAreaTriangleCount"] = zero_world_area_count
        if zero_world_area_count:
            log(
                f"blendlink: {obj.name} material slot "
                f"{material_slot_index} has "
                f"{zero_world_area_count} zero-world-area triangle(s); "
                "they were excluded from selected-field density evidence "
                "(the conservative UV layout proof still includes their loops)"
            )
        if not result["densityMet"] and resolution_plan.get("purpose") == "final":
            raise RuntimeError(
                f'private selected-field texture for "{obj.name}" reaches only '
                f'{result["densityRatio"] * 100.0:.1f}% of the authored-camera '
                f'projected coverage target at the {ceiling}px render-derived '
                "ceiling. "
                "Increase Blender's render resolution, reduce the receiver's "
                "screen size, or use a direct portable material field"
            )
    except BaseException as error:
        primary_error = error
    finally:
        try:
            select_only(selected_before)
            if (
                active_before is not None
                and bpy.context.view_layer.objects.get(active_before.name)
                is active_before
            ):
                bpy.context.view_layer.objects.active = active_before
            else:
                bpy.context.view_layer.objects.active = None
        except BaseException as error:
            cleanup_error = RuntimeError(
                f"private selected-field UV selection restore failed: {error}"
            )
    if cleanup_error is not None:
        if primary_error is not None:
            raise cleanup_error from primary_error
        raise cleanup_error
    if primary_error is not None:
        raise primary_error.with_traceback(primary_error.__traceback__)
    return result


_DEPRECATED_PROPERTY_WARNINGS = set()


def texel_weight_of(obj, keys=("blendlink_texel_weight", "texel_weight"), log=print) -> float:
    """Artist lightmap scale (Unity semantics): linear per-axis multiplier,
    default 1; 0 excludes the object from the atlas while it keeps lighting
    the bakes. `keys` is a fallback chain — namespaced name first, bare name
    kept for compatibility, and external pipelines may append their own."""
    for key in keys:
        if key in obj:
            if key == "texel_weight":
                marker = (obj.name, key)
                if marker not in _DEPRECATED_PROPERTY_WARNINGS:
                    _DEPRECATED_PROPERTY_WARNINGS.add(marker)
                    log(
                        f"BLENDLINK_DEPRECATED_PROPERTY {obj.name}: bare texel_weight is "
                        "read for compatibility; rename it to blendlink_texel_weight before 1.0"
                    )
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
        source = (
            authored if authored is not None
            else _atlas_seed_layer(obj, log)
        )
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


def _atlas_seed_layer(obj, log):
    """The measurably best seed for the atlas workspace layer.

    Blindly seeding from ``uv_layers[0]`` once handed the repair pipeline
    a layer with 19,818 unbakeable triangles while a nearly valid layer
    sat beside it (cube-diorama's Bracken: UVMap vs Leaf/Stem at 3,700) --
    the degenerate seed cascaded into a whole-layer Smart Project, a
    per-face fold rescue, and an atlas-wide packing scale collapse. Pick
    the layer with the fewest non-zero-surface triangles that have
    zero-area UVs; ties keep authoring order.
    """
    mesh = obj.data
    layers = list(mesh.uv_layers)
    if len(layers) <= 1:
        return layers[0]
    best = None
    for index, layer in enumerate(layers):
        count = len(_nonzero_geometry_zero_uv_triangles(obj, layer.name))
        if best is None or count < best[0]:
            best = (count, index, layer)
        if count == 0 and index == 0:
            break
    count, index, layer = best
    if index != 0:
        log(
            f"blendlink: seeding the atlas layer for {obj.name} from UV "
            f"layer {layer.name!r} ({count} unbakeable triangle(s); the "
            f"first layer {layers[0].name!r} has "
            f"{len(_nonzero_geometry_zero_uv_triangles(obj, layers[0].name))})"
        )
    return layer


@contextlib.contextmanager
def scoped_uv_edit(objects, uv_name=None, *, faces=None, sync=None,
                   select_uvs=True, require_multi_object=False):
    """Enter Blender Edit Mode with an exact, restorable UV operand.

    THE seam for every ``bpy.ops.uv.*`` primitive in this module. Callers
    say what to operate on; this owns the whole state contract, because
    each part of it was learned the expensive way and none of it is
    discoverable from the operator signatures:

    * ``use_uv_select_sync`` decides what the operand even IS. With sync
      ON the MESH selection is the operand and ``uv.select_all(SELECT)``
      re-selects the whole mesh -- measured on 5.2 silently widening a
      scoped projection back to every island. With sync OFF the UV
      selection is the operand and must be established explicitly.
    * Stale per-loop UV flags survive on faces the UV editor cannot
      currently see, and the UV operators' pack phase moves every
      UV-selected island -- measured as kept islands repacking while the
      projection itself stayed correctly scoped. They must be cleared
      while every face is visible, BEFORE scoping.
    * Object-mode element flags are re-derived through select-mode
      flushing on Edit-Mode entry, so a stale all-selected vertex state
      widens the operand. Face scope is therefore established through
      bmesh in FACE select mode, where vertex-sharing between kept and
      operated islands cannot bleed.
    * Multi-object entry can silently take for only the active object,
      leaving other receivers stacked at the origin.

    ``sync`` forces ``use_uv_select_sync`` (None leaves it); ``faces``
    scopes to exact polygon indices of a single object (None means every
    face); ``require_multi_object`` proves Edit Mode took for every
    selected mesh. Blender state is restored on the way out even when the
    body raises, and a restore failure is reported as the cause of, not a
    replacement for, the body's error.
    """
    import bmesh

    packable = list(objects)
    if uv_name is not None:
        for obj in packable:
            obj.data.uv_layers.active = obj.data.uv_layers[uv_name]
    select_only(packable)

    tools = bpy.context.tool_settings
    prior_sync = tools.use_uv_select_sync
    prior_select_mode = tuple(tools.mesh_select_mode)
    expected = {
        obj.as_pointer() for obj in bpy.context.selected_objects
        if obj.type == "MESH"
    }

    primary_error = None
    cleanup_errors = []
    try:
        if sync is not None:
            tools.use_uv_select_sync = bool(sync)
        bpy.ops.object.mode_set(mode="EDIT")
        if require_multi_object:
            entered = {
                obj.as_pointer()
                for obj in bpy.context.objects_in_mode_unique_data
                if obj.type == "MESH"
            }
            if entered != expected:
                raise RuntimeError(
                    "UV editing did not enter multi-object Edit Mode for "
                    f"every selected receiver ({len(entered)}/{len(expected)})"
                )
        if faces is None:
            bpy.ops.mesh.select_all(action="SELECT")
        else:
            if len(packable) != 1:
                raise RuntimeError(
                    "face-scoped UV editing operates on exactly one object; "
                    f"got {len(packable)}"
                )
            bpy.ops.mesh.select_mode(type="FACE")
            if not tools.use_uv_select_sync:
                bpy.ops.mesh.select_all(action="SELECT")
                bpy.ops.uv.select_all(action="DESELECT")
            bpy.ops.mesh.select_all(action="DESELECT")
            mesh = packable[0].data
            wanted = set(faces)
            bm = bmesh.from_edit_mesh(mesh)
            bm.faces.ensure_lookup_table()
            for face in bm.faces:
                face.select_set(face.index in wanted)
            bm.select_flush_mode()
            bmesh.update_edit_mesh(mesh)
        if select_uvs and not tools.use_uv_select_sync:
            bpy.ops.uv.select_all(action="SELECT")
        yield
    except BaseException as error:
        primary_error = error
    finally:
        if bpy.context.mode != "OBJECT":
            try:
                bpy.ops.object.mode_set(mode="OBJECT")
            except BaseException as error:
                cleanup_errors.append(f"Object Mode restore failed: {error}")
        try:
            tools.mesh_select_mode = prior_select_mode
        except BaseException as error:
            cleanup_errors.append(f"mesh select-mode restore failed: {error}")
        try:
            tools.use_uv_select_sync = prior_sync
        except BaseException as error:
            cleanup_errors.append(f"UV selection-sync restore failed: {error}")
    if cleanup_errors:
        cleanup_error = RuntimeError(
            "scoped UV editing could not restore Blender state: "
            + "; ".join(cleanup_errors)
        )
        if primary_error is not None:
            raise cleanup_error from primary_error
        raise cleanup_error
    if primary_error is not None:
        raise primary_error.with_traceback(primary_error.__traceback__)


def _smart_project_private_uv_objects(objects, uv_name: str) -> None:
    """Run Blender's Smart Project on validated disposable/private objects."""
    with scoped_uv_edit(objects, uv_name):
        bpy.ops.uv.smart_project(
            angle_limit=math.radians(66.0),
            island_margin=0.0,
            # Blender implements this as independent U/V scaling. Keeping it
            # false is essential when world-linear geometry is intentionally
            # projected to preserve directional texel density.
            scale_to_bounds=False,
        )


def _smart_project_private_uv_faces(
        obj, uv_name: str, polygon_indices) -> None:
    """Smart Project ONLY the given faces of a private/disposable object.

    The unselected islands keep their coordinates bit-for-bit. Projected
    islands may land over kept ones -- the ordinary pack separates
    islands, exactly as after a margin-0 whole-object projection."""
    with scoped_uv_edit(
            [obj], uv_name, faces=polygon_indices):
        bpy.ops.uv.smart_project(
            angle_limit=math.radians(66.0),
            island_margin=0.0,
            # Blender implements this as independent U/V scaling. Keeping it
            # false is essential when world-linear geometry is intentionally
            # projected to preserve directional texel density.
            scale_to_bounds=False,
        )


def _lightmap_pack_private_uv_faces(
        obj, uv_name: str, polygon_indices) -> None:
    """Per-face lightmap charts for ONLY the given faces (rescue-scoped)."""
    with scoped_uv_edit(
            [obj], uv_name, faces=polygon_indices):
        bpy.ops.uv.lightmap_pack(
            PREF_CONTEXT="SEL_FACES",
            PREF_PACK_IN_ONE=True,
            PREF_MARGIN_DIV=0.2,
        )


def _lightmap_pack_private_uv_object(obj, uv_name: str) -> None:
    """Per-face lightmap charts on a private/disposable object.

    Injective by construction (every face gets its own chart), at the cost
    of a seam on every edge. Rescue-only: never a first choice."""
    with scoped_uv_edit([obj], uv_name):
        bpy.ops.uv.lightmap_pack(
            PREF_CONTEXT="ALL_FACES",
            PREF_PACK_IN_ONE=True,
            PREF_MARGIN_DIV=0.2,
        )


def _projection_overlap_issues(obj, uv_name: str):
    """Self-overlap issues only: folds WITHIN an island that no amount of
    downstream island packing can separate. Inter-island overlaps after a
    margin-0 Smart Project are packing artifacts the ordinary pack fixes —
    treating them as fold evidence once shredded a 3168-triangle mesh into
    per-face charts whose fixed-pixel gutters fit no atlas."""
    layer = obj.data.uv_layers.get(uv_name)
    mask = {obj.name: [True for _loop in layer.data]}
    issues = pinned_uv_layout_issues([obj], uv_name, mask, minimum_gutter=0.0)
    return [
        issue for issue in issues
        if str(issue.get("kind", "")) == "self-overlap"
    ]


def _rescue_noninjective_smart_projection(objects, uv_name: str, log) -> int:
    """Replace still-folded Smart Project layouts with lightmap charts.

    Smart Project assigns islands by projection direction, so coplanar
    stacked pieces (patches, straps, decal-like shells) land in the same
    island and overlap at ANY angle limit — measured on the ellie
    fannypack: self-overlap persists 66°→12° and through seam-guided
    conformal unwrap, while a per-face lightmap pack proves clean. Each
    rescued object is re-proved here and the caller's complete post-pack
    proof still gates the final layout."""
    rescued = 0
    for obj in objects:
        overlaps = _projection_overlap_issues(obj, uv_name)
        if not overlaps:
            continue
        log(
            f"blendlink: Smart Project left {len(overlaps)} self-overlapping "
            f"island(s) on {obj.name} "
            f"({_format_private_uv_issues(overlaps)}); rescuing with "
            "per-face lightmap charts on the private layer"
        )
        _lightmap_pack_private_uv_object(obj, uv_name)
        remaining = _projection_overlap_issues(obj, uv_name)
        if remaining:
            raise RuntimeError(
                f"{obj.name}: per-face lightmap rescue still overlaps: "
                + _format_private_uv_issues(remaining)
            )
        rescued += 1
    return rescued


def _validated_private_uv_layers(source_obj, target_obj, uv_name: str):
    """Prove an unwrap proxy kept topology and return its UV layer pair."""
    source_mesh = source_obj.data
    target_mesh = target_obj.data
    counts = (
        ("vertices", len(source_mesh.vertices), len(target_mesh.vertices)),
        ("edges", len(source_mesh.edges), len(target_mesh.edges)),
        ("polygons", len(source_mesh.polygons), len(target_mesh.polygons)),
        ("loops", len(source_mesh.loops), len(target_mesh.loops)),
    )
    mismatched = [
        f"{label} {source_count} != {target_count}"
        for label, source_count, target_count in counts
        if source_count != target_count
    ]
    if mismatched:
        raise RuntimeError(
            f"{target_obj.name}: world-linear unwrap proxy changed topology "
            f"({'; '.join(mismatched)})"
        )
    for collection_name, properties in (
        ("loop", ("vertex_index", "edge_index")),
        ("polygon", ("loop_start", "loop_total")),
    ):
        source_collection = getattr(source_mesh, f"{collection_name}s")
        target_collection = getattr(target_mesh, f"{collection_name}s")
        for property_name in properties:
            source_values = array("i", [0]) * len(source_collection)
            target_values = array("i", [0]) * len(target_collection)
            source_collection.foreach_get(property_name, source_values)
            target_collection.foreach_get(property_name, target_values)
            if source_values == target_values:
                continue
            mismatch_index = next(
                index
                for index, (source_value, target_value) in enumerate(zip(
                    source_values,
                    target_values,
                ))
                if source_value != target_value
            )
            raise RuntimeError(
                f"{target_obj.name}: world-linear unwrap proxy changed "
                f"{collection_name} {property_name} at index {mismatch_index} "
                f"({source_values[mismatch_index]} != "
                f"{target_values[mismatch_index]})"
            )
    source_layer = source_mesh.uv_layers.get(uv_name)
    target_layer = target_mesh.uv_layers.get(uv_name)
    if source_layer is None or target_layer is None:
        raise RuntimeError(
            f"{target_obj.name}: world-linear unwrap proxy or private receiver "
            f"lost {uv_name!r}"
        )
    if len(source_layer.data) != len(target_layer.data):
        raise RuntimeError(
            f"{target_obj.name}: world-linear unwrap proxy changed UV corner "
            "count"
        )
    if _uv_layer_has_pins(source_layer) or _uv_layer_has_pins(target_layer):
        raise RuntimeError(
            f"{target_obj.name}: world-linear unwrap requires an unpinned "
            f"private {uv_name!r} layer"
        )
    source_uv_values = None
    source_uv = getattr(source_layer, "uv", None)
    target_uv = getattr(target_layer, "uv", None)
    if (
        source_uv is not None
        and target_uv is not None
        and len(source_uv) == len(source_layer.data)
        and len(target_uv) == len(target_layer.data)
    ):
        source_uv_values = array("f", [0.0]) * (len(source_uv) * 2)
        source_uv.foreach_get("vector", source_uv_values)
        invalid_index = next(
            (
                index // 2
                for index, value in enumerate(source_uv_values)
                if not math.isfinite(float(value))
            ),
            None,
        )
        if invalid_index is not None:
            raise RuntimeError(
                f"{target_obj.name}: world-linear unwrap produced a non-finite "
                f"UV at corner {invalid_index}"
            )
    else:
        for index, source_loop in enumerate(source_layer.data):
            if not all(math.isfinite(float(value)) for value in source_loop.uv):
                raise RuntimeError(
                    f"{target_obj.name}: world-linear unwrap produced a "
                    f"non-finite UV at corner {index}"
                )
    return source_layer, target_layer, source_uv_values


def _copy_validated_private_uvs(
        source_obj, target_obj, uv_name: str, *,
        validated_layers=None) -> None:
    """Copy only corner UVs after proving an unwrap proxy kept topology."""
    source_layer, target_layer, source_uv_values = (
        validated_layers
        if validated_layers is not None
        else _validated_private_uv_layers(source_obj, target_obj, uv_name)
    )
    if source_uv_values is not None:
        target_layer.uv.foreach_set("vector", source_uv_values)
    else:
        for source_loop, target_loop in zip(
                source_layer.data, target_layer.data):
            target_loop.uv = source_loop.uv
    target_mesh = target_obj.data
    target_mesh.uv_layers.active = target_layer
    target_mesh.update()


def smart_project_private_uvs(
        objs, uv_name: str = ATLAS_UV, log=print, *,
        world_linear: bool = False) -> dict:
    """Create injective zero-config islands on an already private UV layer.

    Material sampling UVs may intentionally tile, overlap, or fold. Copying
    and merely packing those islands cannot turn them into a valid bake
    target. Needle likewise Smart Projects each receiver before atlas
    packing. Artist-authored ``BLENDLINK_ATLAS_AUTHORED`` layouts bypass this
    helper and retain their pins through the existing validation path.

    ``world_linear`` projects a second disposable Mesh copy after applying
    the receiver's complete world-linear matrix. Blender's UV operator reads
    local edit-mesh coordinates, so this is required to avoid directional
    texel-density skew under non-uniform object/parent scale or shear. Only
    validated corner UVs return to the caller-owned private Mesh; source
    geometry and transforms are never changed.
    """
    objects = [
        obj for obj in objs
        if getattr(obj, "type", None) == "MESH"
        and len(getattr(obj.data, "polygons", ())) > 0
    ]
    if not objects:
        raise RuntimeError("private Smart UV projection needs a non-empty Mesh")
    missing = [
        obj.name for obj in objects
        if obj.data.uv_layers.get(uv_name) is None
    ]
    if missing:
        raise RuntimeError(
            f"private Smart UV projection needs {uv_name!r} on: "
            + ", ".join(sorted(missing))
        )
    object_names = ", ".join(sorted(obj.name for obj in objects))
    if not world_linear:
        log(
            f"blendlink: Smart Projecting private {uv_name} bake UVs on "
            + object_names
        )
        _smart_project_private_uv_objects(objects, uv_name)
        rescued_count = _rescue_noninjective_smart_projection(
            objects, uv_name, log,
        )
        return {
            "geometrySpace": "object-local",
            "proxyCount": 0,
            "rescuedNonInjective": rescued_count,
        }

    log(
        f"blendlink: Smart Projecting private {uv_name} bake UVs from "
        f"world-scaled geometry on {object_names}; source geometry and "
        "transforms remain unchanged"
    )
    records = []
    primary_error = None
    rescued_count = 0
    try:
        for obj in objects:
            linear = obj.matrix_world.to_3x3()
            if not all(
                math.isfinite(float(value))
                for row in linear
                for value in row
            ):
                raise RuntimeError(
                    f"{obj.name}: world-linear unwrap needs a finite object "
                    "transform"
                )
            try:
                proxy_mesh = obj.data.copy()
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                raise RuntimeError(
                    f"{obj.name}: could not create a disposable world-linear "
                    f"unwrap Mesh: {error}"
                ) from error
            record = {
                "target": obj,
                "mesh": proxy_mesh,
                "meshName": proxy_mesh.name,
                "object": None,
                "objectName": None,
                "validatedUvLayers": None,
            }
            records.append(record)
            proxy_mesh.name = f"__Blendlink World Unwrap {obj.data.name}"
            record["meshName"] = proxy_mesh.name
            try:
                proxy_mesh.transform(linear.to_4x4())
                proxy_mesh.update()
                proxy = bpy.data.objects.new(
                    f"__Blendlink World Unwrap {obj.name}",
                    proxy_mesh,
                )
                record["object"] = proxy
                record["objectName"] = proxy.name
                bpy.context.scene.collection.objects.link(proxy)
                proxy_layer = proxy_mesh.uv_layers.get(uv_name)
                if proxy_layer is None:
                    raise RuntimeError(
                        f"{obj.name}: disposable world-linear unwrap Mesh "
                        f"lost {uv_name!r}"
                    )
                proxy_mesh.uv_layers.active = proxy_layer
            except (
                AttributeError, ReferenceError, RuntimeError, TypeError,
                ValueError,
            ) as error:
                raise RuntimeError(
                    f"{obj.name}: could not prepare disposable world-linear "
                    f"unwrap geometry: {error}"
                ) from error
        bpy.context.view_layer.update()
        _smart_project_private_uv_objects(
            [record["object"] for record in records],
            uv_name,
        )
        rescued_count = _rescue_noninjective_smart_projection(
            [record["object"] for record in records], uv_name, log,
        )
        # Validate every proxy before copying any UVs. A failed object cannot
        # leave an earlier private receiver partially updated.
        for record in records:
            record["validatedUvLayers"] = _validated_private_uv_layers(
                record["object"],
                record["target"],
                uv_name,
            )
        for record in records:
            _copy_validated_private_uvs(
                record["object"],
                record["target"],
                uv_name,
                validated_layers=record["validatedUvLayers"],
            )
    except BaseException as error:
        primary_error = error

    cleanup_errors = []
    for record in reversed(records):
        proxy = record["object"]
        proxy_mesh = record["mesh"]
        if proxy is not None:
            try:
                found = bpy.data.objects.get(record["objectName"])
                if found is not proxy:
                    raise RuntimeError("temporary Object identity changed")
                bpy.data.objects.remove(proxy, do_unlink=True)
            except (
                AttributeError, ReferenceError, RuntimeError, TypeError,
            ) as error:
                cleanup_errors.append(
                    f"{record['target'].name} unwrap Object cleanup failed: "
                    f"{error}"
                )
        try:
            found = bpy.data.meshes.get(record["meshName"])
            if found is not proxy_mesh:
                raise RuntimeError("temporary Mesh identity changed")
            if proxy_mesh.users != 0:
                raise RuntimeError(
                    f"temporary Mesh still has {proxy_mesh.users} user(s)"
                )
            bpy.data.meshes.remove(proxy_mesh)
        except (
            AttributeError, ReferenceError, RuntimeError, TypeError,
        ) as error:
            cleanup_errors.append(
                f"{record['target'].name} unwrap Mesh cleanup failed: {error}"
            )
    if cleanup_errors:
        cleanup_error = RuntimeError(
            "world-linear private UV projection could not remove all "
            "temporary data: " + "; ".join(cleanup_errors)
        )
        if primary_error is not None:
            raise cleanup_error from primary_error
        raise cleanup_error
    if primary_error is not None:
        raise primary_error.with_traceback(primary_error.__traceback__)
    return {
        "geometrySpace": "world-linear",
        "proxyCount": len(records),
        "rescuedNonInjective": rescued_count,
    }


# Pinned atlas UV validation -------------------------------------------------

_UV_CONNECT_EPSILON = 1e-7
_UV_BOUNDS_EPSILON = 1e-6
_UV_OVERLAP_AREA_EPSILON = 1e-12
def _uv_close(left, right, epsilon: float = _UV_CONNECT_EPSILON) -> bool:
    return (abs(float(left[0]) - float(right[0])) <= epsilon
            and abs(float(left[1]) - float(right[1])) <= epsilon)


def _uv_polygon_islands(mesh, layer) -> tuple[list[int], dict[int, int]]:
    """Resolve UV islands without changing Blender selection or edit mode.

    Two polygons share an island only when they meet across a non-seam mesh
    edge and both endpoint UVs agree. This is the TOPOLOGICAL model, and it
    is the right one for fold detection: two shells that project onto each
    other (a Solidify inner/outer pair) must read as separate islands that
    overlap, not as one island that self-overlaps, because the difference
    decides whether a layout can be repaired by packing or is a genuine
    fold. Gutter proofs need the packer's coarser model instead — see
    :func:`_uv_welded_island_pairs`. The returned display numbers are
    stable (ordered by the first polygon in each island), which keeps plan
    errors actionable and deterministic.
    """
    parents = list(range(len(mesh.polygons)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parents[max(left_root, right_root)] = min(left_root, right_root)

    edge_uses = {}
    for polygon in mesh.polygons:
        indices = list(polygon.loop_indices)
        for offset, loop_index in enumerate(indices):
            next_index = indices[(offset + 1) % len(indices)]
            loop = mesh.loops[loop_index]
            edge = mesh.edges[loop.edge_index]
            if edge.use_seam:
                continue
            next_loop = mesh.loops[next_index]
            vertices = (loop.vertex_index, next_loop.vertex_index)
            coordinates = {
                vertices[0]: tuple(layer.data[loop_index].uv),
                vertices[1]: tuple(layer.data[next_index].uv),
            }
            key = tuple(sorted(vertices))
            edge_uses.setdefault(key, []).append((polygon.index, coordinates))

    for uses in edge_uses.values():
        for index, (polygon, coordinates) in enumerate(uses):
            for other_polygon, other_coordinates in uses[index + 1:]:
                if all(
                    vertex in other_coordinates
                    and _uv_close(coordinate, other_coordinates[vertex])
                    for vertex, coordinate in coordinates.items()
                ):
                    union(polygon, other_polygon)

    roots = [find(index) for index in range(len(mesh.polygons))]
    first_polygon = {}
    for polygon_index, root in enumerate(roots):
        first_polygon.setdefault(root, polygon_index)
    ordered = sorted(first_polygon, key=first_polygon.get)
    return roots, {root: index + 1 for index, root in enumerate(ordered)}


def _uv_welded_island_pairs(mesh, layer, roots) -> dict:
    """Group topological islands into the units ``pack_islands`` moves.

    Blender packs with ``options.topology_from_uvs = true`` and
    ``topology_from_uvs_use_seams = false``, so seams are NOT island
    boundaries, and ``BM_loop_uv_share_edge_check`` compares the two loop
    pairs with ``equals_v2v2`` -- bitwise float equality, no epsilon
    (measured on 5.2.0: a 1e-7 UV mismatch already splits the island, and a
    seam-marked shared edge with equal UVs does not). Two topological
    islands are therefore one packer island exactly when some shared mesh
    edge carries bit-equal UVs on both endpoints from both sides.

    UV coincidence alone is not enough: split vertices with identical UVs
    pack apart (measured 0.10 at margin 0.05), so surface adjacency is
    required and a coincidental touch between unrelated charts still owes
    its gutter.

    Returns island root -> welded component root. Consumed ONLY by the
    gutter proofs -- the ``insufficient-gutter`` comparison in
    :func:`pinned_uv_layout_issues` and the same-owner island bounds in
    :func:`_receiver_island_bounds`: the packer cannot open a gap inside a
    unit it moves rigidly, so demanding one is unsatisfiable at every
    resolution. Overlap,
    self-overlap, bounds and degeneracy keep consuming
    :func:`_uv_polygon_islands` unchanged -- that separation is why this is
    a second model and not an edit to the first.
    """
    parents = {root: root for root in roots}

    def find(root: int) -> int:
        while parents[root] != root:
            parents[root] = parents[parents[root]]
            root = parents[root]
        return root

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parents[max(left_root, right_root)] = min(left_root, right_root)

    edge_uses = {}
    for polygon in mesh.polygons:
        indices = list(polygon.loop_indices)
        for offset, loop_index in enumerate(indices):
            next_index = indices[(offset + 1) % len(indices)]
            loop = mesh.loops[loop_index]
            next_loop = mesh.loops[next_index]
            key = tuple(sorted((loop.vertex_index, next_loop.vertex_index)))
            edge_uses.setdefault(key, []).append((
                polygon.index,
                {
                    loop.vertex_index: tuple(layer.data[loop_index].uv),
                    next_loop.vertex_index: tuple(layer.data[next_index].uv),
                },
            ))

    for uses in edge_uses.values():
        for index, (polygon, coordinates) in enumerate(uses):
            for other_polygon, other_coordinates in uses[index + 1:]:
                # Exact equality, matching equals_v2v2. Do NOT use _uv_close
                # here: its 1e-7 is looser than the packer's.
                if all(
                    vertex in other_coordinates
                    and coordinate == other_coordinates[vertex]
                    for vertex, coordinate in coordinates.items()
                ):
                    union(roots[polygon], roots[other_polygon])

    return {root: find(root) for root in parents}


def _signed_polygon_area(points) -> float:
    return 0.5 * sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    )


def _triangle_geometry_quality(mesh, triangle, linear_transform=None) -> float:
    coordinates = [mesh.vertices[index].co for index in triangle.vertices]
    ab = coordinates[1] - coordinates[0]
    ac = coordinates[2] - coordinates[0]
    bc = coordinates[2] - coordinates[1]
    if linear_transform is not None:
        ab = linear_transform @ ab
        ac = linear_transform @ ac
        bc = linear_transform @ bc
    edge_squared = ab.length_squared + ac.length_squared + bc.length_squared
    if edge_squared <= 0.0:
        return 0.0
    return 2.0 * math.sqrt(3.0) * ab.cross(ac).length / edge_squared


def _exact_zero_world_area_triangle_indices(obj) -> list[int]:
    """Triangles with literally no world-space surface to rasterize."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    world_linear = obj.matrix_world.to_3x3()
    indices = []
    for triangle in mesh.loop_triangles:
        coordinates = [mesh.vertices[index].co for index in triangle.vertices]
        ab = world_linear @ (coordinates[1] - coordinates[0])
        ac = world_linear @ (coordinates[2] - coordinates[0])
        double_area = ab.cross(ac).length
        if not math.isfinite(double_area):
            raise RuntimeError(
                f"{obj.name}: UV validation found non-finite world geometry"
            )
        if double_area <= 0.0:
            indices.append(triangle.index)
    return indices


def _nonzero_geometry_zero_uv_triangles(obj, uv_name: str) -> list[int]:
    """Find evaluated surface triangles that cannot receive baked texels."""
    mesh = obj.data
    layer = mesh.uv_layers.get(uv_name)
    if layer is None:
        raise RuntimeError(
            f"{obj.name}: evaluated UV validation requires a {uv_name} layer; "
            "stage atlas layers before validating evaluated geometry"
        )
    mesh.calc_loop_triangles()
    zero_geometry = set(_exact_zero_world_area_triangle_indices(obj))
    affected = []
    for triangle in mesh.loop_triangles:
        # A zero-area geometry triangle needs no texels. A real surface with a
        # collapsed UV triangle does: baking it would alias every sample to a
        # point/line and can leave modifier-generated faces visibly unbaked.
        if triangle.index in zero_geometry:
            continue
        points = [tuple(layer.data[index].uv) for index in triangle.loops]
        if abs(_signed_polygon_area(points)) <= _UV_OVERLAP_AREA_EPSILON:
            affected.append(triangle.index)
    return affected


def _planar_rescue_collapsed_atlas_polygons(
        obj, uv_name: str, triangle_indices, *, target_span: float = 1.0,
        world_linear: bool = False) -> list[int]:
    """Give Smart-Project precision failures independent planar islands.

    Blender's whole-object Smart Project can still quantize a physically
    valid, millimetre-scale polygon to one float32 UV point when the same
    evaluated mesh spans much larger dimensions. Re-running the operator on
    only those faces uses the same internal scale and does not repair that
    case. This bounded fallback projects only the still-collapsed polygons in
    their own local coordinates and places each outside the existing UV
    bounds. Automatic selected-field repair can instead request world-linear
    coordinates so a non-uniform receiver transform does not reintroduce
    directional density skew. The normal density/packing pass subsequently
    owns final scale and placement, so these temporary coordinates do not
    encode atlas policy.
    """
    if not math.isfinite(target_span) or target_span <= 0.0:
        raise ValueError("planar atlas rescue target_span must be finite and positive")
    mesh = obj.data
    # UV operators can replace the RNA wrapper even when the named layer is
    # unchanged. Always reacquire it after Smart Project before byte writes.
    layer = mesh.uv_layers.get(uv_name)
    if layer is None:
        raise RuntimeError(
            f"{obj.name}: planar atlas rescue requires a {uv_name} layer"
        )
    mesh.calc_loop_triangles()
    polygon_indices = sorted({
        mesh.loop_triangles[index].polygon_index
        for index in triangle_indices
    })
    if not polygon_indices:
        return []

    finite_u = [float(loop.uv.x) for loop in layer.data
                if math.isfinite(float(loop.uv.x))]
    if len(finite_u) != len(layer.data):
        raise RuntimeError(
            f"{obj.name}: {uv_name} contains non-finite coordinates; "
            "repair or regenerate the atlas UV layer"
        )
    base_u = max(finite_u, default=0.0) + (2.0 * target_span)
    triangles_by_polygon = {}
    for triangle in mesh.loop_triangles:
        triangles_by_polygon.setdefault(triangle.polygon_index, []).append(triangle)
    coordinate_linear = (
        obj.matrix_world.to_3x3()
        if world_linear else None
    )

    for offset, polygon_index in enumerate(polygon_indices):
        polygon = mesh.polygons[polygon_index]
        coordinates = [
            (
                coordinate_linear
                @ mesh.vertices[mesh.loops[loop_index].vertex_index].co
                if coordinate_linear is not None
                else mesh.vertices[
                    mesh.loops[loop_index].vertex_index
                ].co.copy()
            )
            for loop_index in polygon.loop_indices
        ]
        candidates = triangles_by_polygon.get(polygon_index, [])
        if not candidates:
            raise RuntimeError(
                f"{obj.name}: polygon {polygon_index} has no evaluated "
                "triangles for planar atlas rescue"
            )
        reference = max(candidates, key=lambda triangle: float(triangle.area))
        if coordinate_linear is None:
            normal = reference.normal.copy()
        else:
            reference_points = [
                coordinate_linear @ mesh.vertices[index].co
                for index in reference.vertices
            ]
            normal = (
                reference_points[1] - reference_points[0]
            ).cross(reference_points[2] - reference_points[0])
        if normal.length_squared <= 0.0:
            raise RuntimeError(
                f"{obj.name}: polygon {polygon_index} has no stable normal "
                "for planar atlas rescue"
            )
        normal.normalize()
        projected_edges = []
        for index, coordinate in enumerate(coordinates):
            edge = coordinates[(index + 1) % len(coordinates)] - coordinate
            edge -= normal * edge.dot(normal)
            projected_edges.append(edge)
        tangent = max(projected_edges, key=lambda edge: edge.length_squared)
        if tangent.length_squared <= 0.0:
            raise RuntimeError(
                f"{obj.name}: polygon {polygon_index} has no stable tangent "
                "for planar atlas rescue"
            )
        tangent.normalize()
        bitangent = normal.cross(tangent)
        if bitangent.length_squared <= 0.0:
            raise RuntimeError(
                f"{obj.name}: polygon {polygon_index} has no stable plane "
                "for planar atlas rescue"
            )
        bitangent.normalize()
        origin = coordinates[0]
        projected = [
            (
                (coordinate - origin).dot(tangent),
                (coordinate - origin).dot(bitangent),
            )
            for coordinate in coordinates
        ]
        min_u = min(point[0] for point in projected)
        min_v = min(point[1] for point in projected)
        span = max(
            max(point[0] for point in projected) - min_u,
            max(point[1] for point in projected) - min_v,
        )
        if not math.isfinite(span) or span <= 0.0:
            raise RuntimeError(
                f"{obj.name}: polygon {polygon_index} has no finite planar "
                "extent for atlas rescue"
            )
        island_u = base_u + (2.0 * target_span * offset)
        for loop_index, point in zip(polygon.loop_indices, projected):
            layer.data[loop_index].uv = (
                island_u + (target_span * (point[0] - min_u) / span),
                target_span * (point[1] - min_v) / span,
            )
    mesh.update()
    return polygon_indices


def _uv_triangle_inradius(points) -> float:
    perimeter = sum(
        math.hypot(
            points[(index + 1) % 3][0] - point[0],
            points[(index + 1) % 3][1] - point[1],
        )
        for index, point in enumerate(points)
    )
    if perimeter <= 0.0:
        return 0.0
    return 2.0 * abs(_signed_polygon_area(points)) / perimeter


def _regular_polygon_rescue_collapsed_atlas_polygons(
        obj, uv_name: str, triangle_indices, *,
        minimum_triangle_inradius: float) -> list[int]:
    """Regularize already-collapsed micro-polygons for bake sampleability.

    Unlike the general planar repair, this final bounded fallback deliberately
    does not preserve a subpixel polygon's geometric aspect ratio: doing so
    can leave a four-texel-long sliver with zero covered bake samples. Only
    fully unpinned polygons that have already survived ordinary projection and
    density packing reach this function.
    """
    if (
        not math.isfinite(minimum_triangle_inradius)
        or minimum_triangle_inradius <= 0.0
    ):
        raise ValueError(
            "regular polygon atlas rescue inradius must be finite and positive"
        )
    mesh = obj.data
    layer = mesh.uv_layers.get(uv_name)
    if layer is None:
        raise RuntimeError(
            f"{obj.name}: regular polygon atlas rescue requires a {uv_name} layer"
        )
    mesh.calc_loop_triangles()
    polygon_indices = sorted({
        mesh.loop_triangles[index].polygon_index
        for index in triangle_indices
    })
    finite_u = [float(loop.uv.x) for loop in layer.data
                if math.isfinite(float(loop.uv.x))]
    if len(finite_u) != len(layer.data):
        raise RuntimeError(
            f"{obj.name}: {uv_name} contains non-finite coordinates; "
            "repair or regenerate the atlas UV layer"
        )
    triangles_by_polygon = {}
    for triangle in mesh.loop_triangles:
        triangles_by_polygon.setdefault(triangle.polygon_index, []).append(triangle)

    cursor_u = max(finite_u, default=0.0) + (2.0 * minimum_triangle_inradius)
    for polygon_index in polygon_indices:
        polygon = mesh.polygons[polygon_index]
        loop_indices = list(polygon.loop_indices)
        if len(loop_indices) < 3:
            raise RuntimeError(
                f"{obj.name}: polygon {polygon_index} has fewer than three "
                "corners for regular atlas rescue"
            )
        unit = {
            loop_index: (
                math.cos((2.0 * math.pi * offset) / len(loop_indices)),
                math.sin((2.0 * math.pi * offset) / len(loop_indices)),
            )
            for offset, loop_index in enumerate(loop_indices)
        }
        candidates = triangles_by_polygon.get(polygon_index, [])
        inradii = [
            _uv_triangle_inradius([unit[index] for index in triangle.loops])
            for triangle in candidates
        ]
        minimum_unit_inradius = min(inradii, default=0.0)
        if minimum_unit_inradius <= 0.0:
            raise RuntimeError(
                f"{obj.name}: polygon {polygon_index} could not form a stable "
                "regular UV triangulation"
            )
        scale = minimum_triangle_inradius / minimum_unit_inradius
        scaled = {
            index: (point[0] * scale, point[1] * scale)
            for index, point in unit.items()
        }
        min_u = min(point[0] for point in scaled.values())
        min_v = min(point[1] for point in scaled.values())
        max_u = max(point[0] for point in scaled.values())
        for loop_index in loop_indices:
            point = scaled[loop_index]
            layer.data[loop_index].uv = (
                cursor_u + point[0] - min_u,
                point[1] - min_v,
            )
        cursor_u += (max_u - min_u) + (2.0 * minimum_triangle_inradius)
    mesh.update()
    return polygon_indices


def _minimum_uv_triangle_inradius(obj, uv_name: str, polygon_indices) -> float:
    mesh = obj.data
    layer = mesh.uv_layers.get(uv_name)
    if layer is None:
        return 0.0
    wanted = set(polygon_indices)
    mesh.calc_loop_triangles()
    inradii = [
        _uv_triangle_inradius([
            tuple(layer.data[index].uv) for index in triangle.loops
        ])
        for triangle in mesh.loop_triangles
        if triangle.polygon_index in wanted
    ]
    return min(inradii, default=0.0)


def _uv_triangle_has_texel_center(points, size: int) -> bool:
    """Whether a triangle contains a delivery texel center in O(short span)."""
    if size <= 0 or abs(_signed_polygon_area(points)) <= _UV_OVERLAP_AREA_EPSILON:
        return False
    in_bounds = all(
        0.0 <= float(value) <= 1.0
        for point in points
        for value in point
    )
    if (
        in_bounds
        and _uv_triangle_inradius(points) * size >= math.sqrt(0.5)
    ):
        return True

    # Transform centers (i + 0.5) / size into the integer lattice. Scan along
    # the triangle's shorter axis, intersecting one row with the convex
    # triangle at a time. This avoids an O(width*height) trap for long diagonal
    # precision slivers at a 4096px Final size.
    scaled = [
        (float(point[0]) * size - 0.5, float(point[1]) * size - 0.5)
        for point in points
    ]
    x_span = max(point[0] for point in scaled) - min(point[0] for point in scaled)
    y_span = max(point[1] for point in scaled) - min(point[1] for point in scaled)
    if x_span < y_span:
        scaled = [(point[1], point[0]) for point in scaled]
    epsilon = 1.0e-9
    minimum_row = max(
        0, math.ceil(min(point[1] for point in scaled) - epsilon),
    )
    maximum_row = min(
        size - 1, math.floor(max(point[1] for point in scaled) + epsilon),
    )
    for row in range(minimum_row, maximum_row + 1):
        intersections = []
        for index, start in enumerate(scaled):
            end = scaled[(index + 1) % 3]
            delta = end[1] - start[1]
            if abs(delta) <= epsilon:
                if abs(float(row) - start[1]) <= epsilon:
                    intersections.extend((start[0], end[0]))
                continue
            amount = (float(row) - start[1]) / delta
            if -epsilon <= amount <= 1.0 + epsilon:
                intersections.append(
                    start[0] + amount * (end[0] - start[0])
                )
        if not intersections:
            continue
        minimum_column = max(0, math.ceil(min(intersections) - epsilon))
        maximum_column = min(
            size - 1, math.floor(max(intersections) + epsilon),
        )
        if minimum_column <= maximum_column:
            return True
    return False


def _uv_triangle_texel_center_count(points, size: int) -> int:
    """Count delivery texel centers covered by one UV triangle."""
    if size <= 0 or abs(_signed_polygon_area(points)) <= _UV_OVERLAP_AREA_EPSILON:
        return 0
    minimum_u = max(0, math.ceil(min(point[0] for point in points) * size - 0.5))
    maximum_u = min(
        size - 1, math.floor(max(point[0] for point in points) * size - 0.5),
    )
    minimum_v = max(0, math.ceil(min(point[1] for point in points) * size - 0.5))
    maximum_v = min(
        size - 1, math.floor(max(point[1] for point in points) * size - 0.5),
    )
    if minimum_u > maximum_u or minimum_v > maximum_v:
        return 0

    orientation = 1.0 if _signed_polygon_area(points) > 0.0 else -1.0
    count = 0
    for y in range(minimum_v, maximum_v + 1):
        point_y = (y + 0.5) / size
        for x in range(minimum_u, maximum_u + 1):
            point_x = (x + 0.5) / size
            inside = True
            for index, start in enumerate(points):
                end = points[(index + 1) % 3]
                signed = orientation * (
                    (end[0] - start[0]) * (point_y - start[1])
                    - (end[1] - start[1]) * (point_x - start[0])
                )
                if signed < -_UV_OVERLAP_AREA_EPSILON:
                    inside = False
                    break
            if inside:
                count += 1
    return count


_FLOAT32_UV_SAMPLEABILITY_RESCUE_CEILING = 64.0 * (2.0 ** -23)


def _mixed_zero_world_area_polygon_triangles(obj) -> list[int]:
    """Zero-area triangulations inside polygons that still have real surface.

    A collinear corner can make one loop triangle exact-zero while a sibling
    triangle in the same polygon remains visible. Smart Project may fold that
    valid sibling across its neighbors because the polygon's triangulation is
    singular. Returning the zero member identifies the whole polygon for the
    existing private regular-polygon rescue.
    """
    mesh = obj.data
    mesh.calc_loop_triangles()
    exact_zero = set(_exact_zero_world_area_triangle_indices(obj))
    triangles_by_polygon = {}
    for triangle in mesh.loop_triangles:
        triangles_by_polygon.setdefault(
            triangle.polygon_index, [],
        ).append(triangle.index)
    return sorted(
        triangle_index
        for triangle_indices in triangles_by_polygon.values()
        if (
            any(index in exact_zero for index in triangle_indices)
            and any(index not in exact_zero for index in triangle_indices)
        )
        for triangle_index in triangle_indices
        if triangle_index in exact_zero
    )


def _precision_sliver_unsampleable_uv_triangles(
        obj, uv_name: str, size: int) -> list[int]:
    """Find near-float32 slivers with no delivery texel-center sample.

    Not every subpixel triangle deserves more atlas area. This deliberately
    targets only meaningful world-space surfaces within 64 float32 ULPs of
    collinearity, where packing precision can turn a valid Smart Project
    result non-injective. A complete post-pack layout proof remains the gate.
    """
    if size <= 0:
        raise ValueError("UV sampleability needs a positive delivery size")
    mesh = obj.data
    layer = mesh.uv_layers.get(uv_name)
    if layer is None:
        raise RuntimeError(
            f"{obj.name}: UV sampleability requires a {uv_name} layer"
        )
    mesh.calc_loop_triangles()
    world_linear = obj.matrix_world.to_3x3()
    affected = []
    for triangle in mesh.loop_triangles:
        quality = _triangle_geometry_quality(
            mesh, triangle, world_linear,
        )
        if (
            quality <= 0.0
            or quality > _FLOAT32_UV_SAMPLEABILITY_RESCUE_CEILING
        ):
            continue
        points = [
            tuple(layer.data[index].uv)
            for index in triangle.loops
        ]
        if not _uv_triangle_has_texel_center(points, size):
            affected.append(triangle.index)
    return affected


def _minimum_rescued_delivery_texel_centers(
        obj, uv_name: str, polygon_indices, size: int) -> int:
    mesh = obj.data
    layer = mesh.uv_layers.get(uv_name)
    if layer is None:
        return 0
    wanted = set(polygon_indices)
    mesh.calc_loop_triangles()
    counts = [
        _uv_triangle_texel_center_count([
            tuple(layer.data[index].uv) for index in triangle.loops
        ], size)
        for triangle in mesh.loop_triangles
        if triangle.polygon_index in wanted
    ]
    return min(counts, default=0)


def _scoped_atlas_island_repair(obj, uv_name: str, zero_triangles):
    """Repair only the islands that are degenerate or folded.

    Returns None when every island needs repair (the whole-layer path is
    then honest) -- otherwise Smart Projects just the repair set, keeping
    every other island's coordinates bit-for-bit, and rescues a
    still-folded projection with per-face lightmap charts scoped to the
    same faces. Measured motivation (cube-diorama Bracken): the
    whole-object rescue shredded 11,689 faces into per-face charts when
    only the degenerate subset needed new coordinates, collapsing the
    receiver allocation scale atlas-wide.
    """
    mesh = obj.data
    layer = mesh.uv_layers.get(uv_name)
    mesh.calc_loop_triangles()
    roots, display = _uv_polygon_islands(mesh, layer)
    polygon_of_triangle = {
        triangle.index: triangle.polygon_index
        for triangle in mesh.loop_triangles
    }
    repair_roots = {
        roots[polygon_of_triangle[index]]
        for index in zero_triangles
        if index in polygon_of_triangle
    }
    mask = {obj.name: [True for _loop in layer.data]}
    root_by_display = {number: root for root, number in display.items()}
    for issue in pinned_uv_layout_issues(
            [obj], uv_name, mask, minimum_gutter=0.0):
        # Folds and collapsed triangles need new coordinates; plain
        # inter-island overlap and out-of-bounds are the pack's job.
        if str(issue.get("kind")) not in {"self-overlap", "degenerate"}:
            continue
        number = issue.get("island")
        if number in root_by_display:
            repair_roots.add(root_by_display[number])
    if not repair_roots or repair_roots >= set(roots):
        return None
    face_indices = [
        polygon.index for polygon in mesh.polygons
        if roots[polygon.index] in repair_roots
    ]
    _smart_project_private_uv_faces(obj, uv_name, face_indices)
    lightmap_rescued = 0
    folds = _projection_overlap_issues(obj, uv_name)
    if folds:
        # Kept islands were fold-free by construction (folded islands
        # joined the repair set), so any fold here is inside the projected
        # subset -- and the per-face rescue takes ONLY the still-folded
        # islands' faces, not the whole subset. (Measured on Bracken: the
        # projection heals most of the 3,053-face subset; per-face
        # charting all of it re-created the chart explosion this function
        # exists to avoid, one level down.)
        fold_roots, fold_display = _uv_polygon_islands(
            mesh, mesh.uv_layers.get(uv_name))
        fold_root_by_display = {
            number: root for root, number in fold_display.items()
        }
        folded = {
            fold_root_by_display[issue.get("island")]
            for issue in folds
            if issue.get("island") in fold_root_by_display
        }
        folded_faces = [
            polygon.index for polygon in mesh.polygons
            if fold_roots[polygon.index] in folded
        ]
        _lightmap_pack_private_uv_faces(obj, uv_name, folded_faces)
        remaining = _projection_overlap_issues(obj, uv_name)
        if remaining:
            raise RuntimeError(
                f"{obj.name}: scoped per-face lightmap rescue still "
                "overlaps: " + _format_private_uv_issues(remaining)
            )
        lightmap_rescued = len(folded_faces)
    return {
        "repairedIslands": len(repair_roots),
        "totalIslands": len(set(roots)),
        "faceCount": len(face_indices),
        "lightmapRescued": lightmap_rescued,
    }


def repair_evaluated_atlas_uvs(
        objs, uv_name: str = ATLAS_UV, log=print, *,
        world_linear: bool = False) -> list[dict]:
    """Repair modifier-created atlas holes without changing authored UVs.

    Evaluated modifiers such as Solidify can add real triangles while merely
    copying a boundary's UVs, leaving those new faces with zero UV area. The
    atlas workspace is safe to regenerate only when it is completely
    unpinned. Any pin means the artist owns placement, so this fails before
    changing any object. Fully unpinned affected objects receive a whole-mesh
    Smart Project on the derived atlas layer; the authored/source layers stay
    untouched. A bounded local planar fallback handles valid tiny polygons
    that Blender's whole-object projection still quantizes to one UV point.
    Every repair is revalidated before this function returns.
    """
    affected = []
    for obj in sorted(objs, key=lambda item: item.name):
        if not obj.data.polygons:
            continue
        layer = obj.data.uv_layers.get(uv_name)
        if layer is None:
            raise RuntimeError(
                f"{obj.name}: evaluated UV validation requires a {uv_name} layer; "
                "stage atlas layers before validating evaluated geometry"
            )
        triangles = _nonzero_geometry_zero_uv_triangles(obj, uv_name)
        if triangles:
            affected.append((obj, layer, triangles))

    # Preflight every object before mutation. One artist-owned pinned layout
    # must not leave earlier unpinned objects silently reprojected on failure.
    pinned = [
        (obj, triangles)
        for obj, layer, triangles in affected
        if any(loop.pin_uv for loop in layer.data)
    ]
    if pinned:
        details = "; ".join(
            f"{obj.name} ({len(triangles)} triangle(s))"
            for obj, triangles in pinned
        )
        raise RuntimeError(
            f"evaluated geometry produced non-zero surface triangles with "
            f"zero-area {uv_name} UVs on pinned atlas layout(s): {details}. "
            "Blendlink will not alter pinned artist UVs; apply/update the "
            "modifier UVs or unpin the authored atlas layout"
        )

    reports = []
    for obj, layer, triangles in affected:
        scoped = None
        if not world_linear:
            scoped = _scoped_atlas_island_repair(obj, uv_name, triangles)
        if scoped is not None:
            lightmap_rescued = scoped["lightmapRescued"]
        else:
            # The fold rescue inside this call can replace the whole layout
            # with per-face lightmap charts. That is a large, visible quality
            # change, so it reaches the caller's log and the report strategy
            # below rather than being swallowed.
            projection = smart_project_private_uvs(
                [obj],
                uv_name=uv_name,
                log=log,
                world_linear=world_linear,
            )
            lightmap_rescued = bool(projection.get("rescuedNonInjective"))

        remaining = _nonzero_geometry_zero_uv_triangles(obj, uv_name)
        rescued_polygons = []
        if remaining:
            rescued_polygons = _planar_rescue_collapsed_atlas_polygons(
                obj,
                uv_name,
                remaining,
                world_linear=world_linear,
            )
            remaining = _nonzero_geometry_zero_uv_triangles(obj, uv_name)
        if remaining:
            raise RuntimeError(
                f"{obj.name}: Smart Project plus local planar rescue could not "
                f"repair {len(remaining)} non-zero surface triangle(s) with "
                f"zero-area {uv_name} UVs"
            )
        report = {
            "object": obj.name,
            "triangleCount": len(triangles),
            "strategy": (
                (
                    "smart-project-degenerate-islands"
                    if scoped is not None
                    else "smart-project-whole-unpinned-object"
                )
                + ("+planar-polygon-rescue" if rescued_polygons else "")
                + ("+lightmap-rescue" if lightmap_rescued else "")
            ),
        }
        if scoped is not None:
            report["repairedIslands"] = scoped["repairedIslands"]
            report["totalIslands"] = scoped["totalIslands"]
        if rescued_polygons:
            report["rescuePolygonCount"] = len(rescued_polygons)
        reports.append(report)
        if scoped is not None:
            projected_how = (
                f"Smart Projecting {scoped['repairedIslands']} degenerate/"
                f"folded island(s) of {scoped['totalIslands']} "
                f"({scoped['faceCount']} face(s)) on the fully unpinned "
                f"{uv_name} layer"
                + (
                    ", then replacing the still-folded island(s) with "
                    f"per-face lightmap charts ({scoped['lightmapRescued']} "
                    "face(s))"
                    if lightmap_rescued else ""
                )
            )
        elif lightmap_rescued:
            projected_how = (
                "replacing the fully unpinned "
                f"{uv_name} layer with per-face lightmap charts (the Smart "
                "Project still self-overlapped)"
            )
        else:
            projected_how = (
                f"Smart Projecting the whole fully unpinned {uv_name} layer"
            )
        log(
            f"blendlink: repaired {len(triangles)} evaluated triangle(s) with "
            f"zero-area atlas UVs on {obj.name} by "
            + projected_how
            + (
                f" and locally projecting {len(rescued_polygons)} tiny "
                "polygon(s) that remained collapsed"
                if rescued_polygons else ""
            )
            + "; authored UV layers were preserved"
        )
    return reports


def _triangle_intersection_area(left, right) -> float:
    """Exact convex clipping area for two UV triangles.

    Edge/point contact has zero area and is intentionally accepted. This is
    the important distinction from bounding-box overlap, which falsely blocks
    a normal tightly packed atlas.
    """
    orientation = _signed_polygon_area(right)
    if abs(orientation) <= _UV_OVERLAP_AREA_EPSILON:
        return 0.0
    orientation = 1.0 if orientation > 0.0 else -1.0
    output = [tuple(point) for point in left]
    for edge_index, edge_start in enumerate(right):
        edge_end = right[(edge_index + 1) % len(right)]

        def distance(point):
            return orientation * (
                (edge_end[0] - edge_start[0]) * (point[1] - edge_start[1])
                - (edge_end[1] - edge_start[1]) * (point[0] - edge_start[0])
            )

        source = output
        output = []
        if not source:
            break
        previous = source[-1]
        previous_distance = distance(previous)
        previous_inside = previous_distance >= 0.0
        for current in source:
            current_distance = distance(current)
            current_inside = current_distance >= 0.0
            if current_inside != previous_inside:
                denominator = previous_distance - current_distance
                if denominator != 0.0:
                    factor = previous_distance / denominator
                    output.append((
                        previous[0] + factor * (current[0] - previous[0]),
                        previous[1] + factor * (current[1] - previous[1]),
                    ))
            if current_inside:
                output.append(current)
            previous = current
            previous_distance = current_distance
            previous_inside = current_inside
    return abs(_signed_polygon_area(output)) if len(output) >= 3 else 0.0


def _point_segment_distance_squared(point, start, end) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length_squared = dx * dx + dy * dy
    if length_squared <= _UV_OVERLAP_AREA_EPSILON:
        offset_x = point[0] - start[0]
        offset_y = point[1] - start[1]
        return offset_x * offset_x + offset_y * offset_y
    amount = (
        (point[0] - start[0]) * dx + (point[1] - start[1]) * dy
    ) / length_squared
    amount = min(1.0, max(0.0, amount))
    nearest_x = start[0] + amount * dx
    nearest_y = start[1] + amount * dy
    offset_x = point[0] - nearest_x
    offset_y = point[1] - nearest_y
    return offset_x * offset_x + offset_y * offset_y


def _triangle_distance(left, right) -> float:
    """Shortest UV-space distance between two non-overlapping triangles."""
    distances = []
    for points, edges in ((left, right), (right, left)):
        for point in points:
            for edge_index, edge_start in enumerate(edges):
                edge_end = edges[(edge_index + 1) % len(edges)]
                distances.append(
                    _point_segment_distance_squared(point, edge_start, edge_end)
                )
    return math.sqrt(min(distances)) if distances else math.inf


_UV_BVH_LEAF_SIZE = 8


def _uv_bounds_distance(left, right) -> float:
    dx = max(
        float(left["min_x"]) - float(right["max_x"]),
        float(right["min_x"]) - float(left["max_x"]),
        0.0,
    )
    dy = max(
        float(left["min_y"]) - float(right["max_y"]),
        float(right["min_y"]) - float(left["max_y"]),
        0.0,
    )
    return math.hypot(dx, dy)


def _bounds_positive_overlap(left, right) -> bool:
    return (
        min(float(left["max_x"]), float(right["max_x"]))
        - max(float(left["min_x"]), float(right["min_x"])) > 0.0
        and min(float(left["max_y"]), float(right["max_y"]))
        - max(float(left["min_y"]), float(right["min_y"])) > 0.0
    )


def _triangle_bvh(triangles):
    """Balanced UV-space hierarchy for exact triangle queries."""
    node = {
        "min_x": min(item["min_x"] for item in triangles),
        "max_x": max(item["max_x"] for item in triangles),
        "min_y": min(item["min_y"] for item in triangles),
        "max_y": max(item["max_y"] for item in triangles),
        "count": len(triangles),
    }
    if len(triangles) <= _UV_BVH_LEAF_SIZE:
        node["triangles"] = triangles
        return node
    x_span = node["max_x"] - node["min_x"]
    y_span = node["max_y"] - node["min_y"]
    if x_span >= y_span:
        key = lambda item: (item["min_x"] + item["max_x"], item["min_y"])
    else:
        key = lambda item: (item["min_y"] + item["max_y"], item["min_x"])
    ordered = sorted(triangles, key=key)
    midpoint = len(ordered) // 2
    node["left"] = _triangle_bvh(ordered[:midpoint])
    node["right"] = _triangle_bvh(ordered[midpoint:])
    return node


def _island_bounds_near(left, right, padding: float) -> bool:
    return not (
        float(left["max_x"]) + padding
        < float(right["min_x"]) - _UV_CONNECT_EPSILON
        or float(right["max_x"]) + padding
        < float(left["min_x"]) - _UV_CONNECT_EPSILON
        or float(left["max_y"]) + padding
        < float(right["min_y"]) - _UV_CONNECT_EPSILON
        or float(right["max_y"]) + padding
        < float(left["min_y"]) - _UV_CONNECT_EPSILON
    )


def _island_bvh(islands):
    node = {
        "min_x": min(item["min_x"] for item in islands),
        "max_x": max(item["max_x"] for item in islands),
        "min_y": min(item["min_y"] for item in islands),
        "max_y": max(item["max_y"] for item in islands),
        "count": len(islands),
    }
    if len(islands) <= _UV_BVH_LEAF_SIZE:
        node["islands"] = islands
        return node
    x_centers = [(item["min_x"] + item["max_x"]) * 0.5 for item in islands]
    y_centers = [(item["min_y"] + item["max_y"]) * 0.5 for item in islands]
    if max(x_centers) - min(x_centers) >= max(y_centers) - min(y_centers):
        key = lambda item: (
            item["min_x"] + item["max_x"],
            item["min_y"] + item["max_y"],
            item["owner"],
        )
    else:
        key = lambda item: (
            item["min_y"] + item["max_y"],
            item["min_x"] + item["max_x"],
            item["owner"],
        )
    ordered = sorted(islands, key=key)
    midpoint = len(ordered) // 2
    node["left"] = _island_bvh(ordered[:midpoint])
    node["right"] = _island_bvh(ordered[midpoint:])
    return node


def _island_bvh_candidates(root, island, padding: float):
    candidates = []

    def visit(node):
        if not _island_bounds_near(node, island, padding):
            return
        leaf = node.get("islands")
        if leaf is not None:
            for candidate in leaf:
                if (candidate["ordinal"] < island["ordinal"]
                        and _island_bounds_near(candidate, island, padding)):
                    candidates.append(candidate)
            return
        visit(node["left"])
        visit(node["right"])

    visit(root)
    return sorted(candidates, key=lambda item: item["ordinal"])


def _segments_may_intersect(left_start, left_end, right_start, right_end) -> bool:
    def cross(start, end, point):
        return (
            (end[0] - start[0]) * (point[1] - start[1])
            - (end[1] - start[1]) * (point[0] - start[0])
        )

    def on_segment(start, end, point):
        return (
            min(start[0], end[0]) - _UV_CONNECT_EPSILON
            <= point[0]
            <= max(start[0], end[0]) + _UV_CONNECT_EPSILON
            and min(start[1], end[1]) - _UV_CONNECT_EPSILON
            <= point[1]
            <= max(start[1], end[1]) + _UV_CONNECT_EPSILON
        )

    def cross_tolerance(start, end, point):
        # cross() has units of UV². Scale the linear connectivity tolerance by
        # the local edge/point extent instead of comparing unlike dimensions;
        # otherwise genuine crossings of short atlas edges disappear.
        extent = max(
            math.hypot(end[0] - start[0], end[1] - start[1]),
            math.hypot(point[0] - start[0], point[1] - start[1]),
            _UV_CONNECT_EPSILON,
        )
        return _UV_CONNECT_EPSILON * extent

    left_right_start = cross(left_start, left_end, right_start)
    left_right_end = cross(left_start, left_end, right_end)
    right_left_start = cross(right_start, right_end, left_start)
    right_left_end = cross(right_start, right_end, left_end)
    # Opposite raw signs prove a proper crossing in the represented Float32
    # geometry. Tolerances belong only to the collinear/on-segment fallback.
    if left_right_start * left_right_end < 0.0:
        if right_left_start * right_left_end < 0.0:
            return True
    for value, point, start, end in (
        (left_right_start, right_start, left_start, left_end),
        (left_right_end, right_end, left_start, left_end),
        (right_left_start, left_start, right_start, right_end),
        (right_left_end, left_end, right_start, right_end),
    ):
        if (abs(value) <= cross_tolerance(start, end, point)
                and on_segment(start, end, point)):
            return True
    return False


def _boundary_segments_conflict(left, right) -> bool:
    if (left["max_x"] < right["min_x"] - _UV_CONNECT_EPSILON
            or right["max_x"] < left["min_x"] - _UV_CONNECT_EPSILON
            or left["max_y"] < right["min_y"] - _UV_CONNECT_EPSILON
            or right["max_y"] < left["min_y"] - _UV_CONNECT_EPSILON):
        return False
    shared = {left["start"], left["end"]} & {right["start"], right["end"]}
    if shared:
        if len(shared) != 1:
            return True
        shared_node = next(iter(shared))
        left_other = left["end_uv"] if left["start"] == shared_node else left["start_uv"]
        right_other = right["end_uv"] if right["start"] == shared_node else right["start_uv"]
        shared_uv = left["start_uv"] if left["start"] == shared_node else left["end_uv"]
        left_vector = (
            left_other[0] - shared_uv[0], left_other[1] - shared_uv[1],
        )
        right_vector = (
            right_other[0] - shared_uv[0], right_other[1] - shared_uv[1],
        )
        cross = left_vector[0] * right_vector[1] - left_vector[1] * right_vector[0]
        dot = left_vector[0] * right_vector[0] + left_vector[1] * right_vector[1]
        return abs(cross) <= _UV_CONNECT_EPSILON and dot > 0.0
    return _segments_may_intersect(
        left["start_uv"], left["end_uv"], right["start_uv"], right["end_uv"],
    )


class _UVSweepNode:
    __slots__ = ("segment", "priority", "left", "right", "parent")

    def __init__(self, segment):
        self.segment = segment
        # Odd multiplication permutes 32-bit indices into stable, unique
        # pseudo-random priorities without Python's process-randomized hash.
        self.priority = ((segment["index"] + 1) * 2654435761) & 0xFFFFFFFF
        self.left = None
        self.right = None
        self.parent = None


def _boundary_segments_are_simple(segments) -> bool:
    """Shamos-Hoey-style intersection decision in O(B log B).

    A deterministic shear chooses a sweep direction with distinct vertex
    events and no vertical boundary edges. A treap maintains y-order, so only
    neighboring active segments need exact intersection checks. Any ambiguous
    projection declines the fast proof rather than approximating it.
    """
    if len(segments) < 3:
        return False
    node_uvs = {}
    for segment in segments:
        for node, coordinate in (
            (segment["start"], segment["start_uv"]),
            (segment["end"], segment["end_uv"]),
        ):
            previous = node_uvs.setdefault(node, coordinate)
            if not _uv_close(previous, coordinate):
                return False

    shear = None
    projected = None
    for candidate in (
        math.sqrt(2.0), -math.sqrt(2.0), math.pi / 3.0,
        -math.e / 2.0, (1.0 + math.sqrt(5.0)) / 2.0,
    ):
        values = {
            node: float(point[0]) + candidate * float(point[1])
            for node, point in node_uvs.items()
        }
        ordered = sorted(values.values())
        if any(
                abs(ordered[index + 1] - ordered[index]) <= 1e-12
                for index in range(len(ordered) - 1)):
            continue
        if any(abs(values[item["end"]] - values[item["start"]]) <= 1e-12
               for item in segments):
            continue
        shear, projected = candidate, values
        break
    if shear is None:
        return False

    events = {}
    for index, segment in enumerate(segments):
        segment["index"] = index
        start_x = projected[segment["start"]]
        end_x = projected[segment["end"]]
        if start_x < end_x:
            left_node, right_node = segment["start"], segment["end"]
            left_uv, right_uv = segment["start_uv"], segment["end_uv"]
            left_x, right_x = start_x, end_x
        else:
            left_node, right_node = segment["end"], segment["start"]
            left_uv, right_uv = segment["end_uv"], segment["start_uv"]
            left_x, right_x = end_x, start_x
        segment["sweep_left_node"] = left_node
        segment["sweep_right_node"] = right_node
        segment["sweep_left_uv"] = left_uv
        segment["sweep_right_uv"] = right_uv
        segment["sweep_left_x"] = left_x
        segment["sweep_right_x"] = right_x
        events.setdefault(left_x, {"add": [], "remove": []})["add"].append(segment)
        events.setdefault(right_x, {"add": [], "remove": []})["remove"].append(segment)

    root = None
    active_nodes = {}
    sweep_x = 0.0

    def y_at(segment):
        amount = (
            (sweep_x - segment["sweep_left_x"])
            / (segment["sweep_right_x"] - segment["sweep_left_x"])
        )
        return (
            segment["sweep_left_uv"][1]
            + amount * (
                segment["sweep_right_uv"][1] - segment["sweep_left_uv"][1]
            )
        )

    def slope(segment):
        return (
            (segment["sweep_right_uv"][1] - segment["sweep_left_uv"][1])
            / (segment["sweep_right_x"] - segment["sweep_left_x"])
        )

    def less(left, right):
        left_y, right_y = y_at(left), y_at(right)
        if abs(left_y - right_y) > 1e-12:
            return left_y < right_y
        left_slope, right_slope = slope(left), slope(right)
        if abs(left_slope - right_slope) > 1e-12:
            return left_slope < right_slope
        return left["index"] < right["index"]

    def replace_parent(old, new):
        nonlocal root
        new.parent = old.parent
        if old.parent is None:
            root = new
        elif old.parent.left is old:
            old.parent.left = new
        else:
            old.parent.right = new

    def rotate_left(node):
        child = node.right
        replace_parent(node, child)
        node.right = child.left
        if child.left is not None:
            child.left.parent = node
        child.left = node
        node.parent = child

    def rotate_right(node):
        child = node.left
        replace_parent(node, child)
        node.left = child.right
        if child.right is not None:
            child.right.parent = node
        child.right = node
        node.parent = child

    def insert(segment):
        nonlocal root
        node = _UVSweepNode(segment)
        if root is None:
            root = node
        else:
            current = root
            while True:
                branch = "left" if less(segment, current.segment) else "right"
                child = getattr(current, branch)
                if child is None:
                    setattr(current, branch, node)
                    node.parent = current
                    break
                current = child
        while node.parent is not None and node.priority < node.parent.priority:
            if node.parent.left is node:
                rotate_right(node.parent)
            else:
                rotate_left(node.parent)
        active_nodes[segment["index"]] = node
        return node

    def predecessor(node):
        if node.left is not None:
            current = node.left
            while current.right is not None:
                current = current.right
            return current
        current = node
        while current.parent is not None and current.parent.left is current:
            current = current.parent
        return current.parent

    def successor(node):
        if node.right is not None:
            current = node.right
            while current.left is not None:
                current = current.left
            return current
        current = node
        while current.parent is not None and current.parent.right is current:
            current = current.parent
        return current.parent

    def remove(node):
        nonlocal root
        while node.left is not None or node.right is not None:
            if node.left is None:
                rotate_left(node)
            elif node.right is None or node.left.priority < node.right.priority:
                rotate_right(node)
            else:
                rotate_left(node)
        if node.parent is None:
            root = None
        elif node.parent.left is node:
            node.parent.left = None
        else:
            node.parent.right = None
        active_nodes.pop(node.segment["index"], None)

    def conflicts(left_node, right_node):
        return (
            left_node is not None and right_node is not None
            and _boundary_segments_conflict(left_node.segment, right_node.segment)
        )

    for event_x in sorted(events):
        sweep_x = event_x
        event = events[event_x]
        for segment in sorted(event["remove"], key=lambda item: item["index"]):
            node = active_nodes.get(segment["index"])
            if node is None:
                return False
            before, after = predecessor(node), successor(node)
            if conflicts(node, before) or conflicts(node, after):
                return False
            remove(node)
            if conflicts(before, after):
                return False
        for segment in sorted(event["add"], key=lambda item: item["index"]):
            node = insert(segment)
            if conflicts(node, predecessor(node)) or conflicts(node, successor(node)):
                return False
    return root is None and not active_nodes


def _disk_island_proves_no_self_overlap(triangles) -> bool:
    """Fast proof for the common, dense, simply-connected UV island.

    A consistently oriented triangulated disk with a simple boundary is an
    injective piecewise-linear map. Complex/non-manifold islands return False
    and retain the exact BVH fallback; this function can only skip work after
    proving the stronger condition.
    """
    if len(triangles) < 2:
        return True
    orientations = {
        1 if _signed_polygon_area(item["points"]) > 0.0 else -1
        for item in triangles
    }
    if len(orientations) != 1:
        return False

    nodes = set()
    edge_uses = {}
    for triangle_index, triangle in enumerate(triangles):
        topology = triangle.get("topology")
        if topology is None or len(topology) != 3:
            return False
        nodes.update(topology)
        for edge_index, start in enumerate(topology):
            end = topology[(edge_index + 1) % 3]
            key = tuple(sorted((start, end)))
            edge_uses.setdefault(key, []).append((
                triangle_index,
                start,
                end,
                triangle["points"][edge_index],
                triangle["points"][(edge_index + 1) % 3],
            ))
    if any(len(uses) not in (1, 2) for uses in edge_uses.values()):
        return False
    for uses in edge_uses.values():
        if len(uses) == 2 and not (
                uses[0][1] == uses[1][2] and uses[0][2] == uses[1][1]):
            # A consistently wound disk traverses every internal edge in
            # opposite directions. Same-direction glue is a fold/pinch, not
            # evidence that permits the fast injectivity proof.
            return False
    if len(nodes) - len(edge_uses) + len(triangles) != 1:
        return False

    # The triangle complex must be one disk, not disconnected components that
    # happen to have the same aggregate Euler characteristic.
    triangle_neighbors = {index: set() for index in range(len(triangles))}
    for uses in edge_uses.values():
        if len(uses) == 2:
            left, right = uses[0][0], uses[1][0]
            triangle_neighbors[left].add(right)
            triangle_neighbors[right].add(left)
    reached = {0}
    pending = [0]
    while pending:
        current = pending.pop()
        for neighbor in triangle_neighbors[current] - reached:
            reached.add(neighbor)
            pending.append(neighbor)
    if len(reached) != len(triangles):
        return False

    boundary = [uses[0] for uses in edge_uses.values() if len(uses) == 1]
    boundary_neighbors = {}
    for _, start, end, _, _ in boundary:
        boundary_neighbors.setdefault(start, set()).add(end)
        boundary_neighbors.setdefault(end, set()).add(start)
    if not boundary_neighbors or any(
            len(neighbors) != 2 for neighbors in boundary_neighbors.values()):
        return False
    reached_boundary = {next(iter(boundary_neighbors))}
    pending = list(reached_boundary)
    while pending:
        current = pending.pop()
        for neighbor in boundary_neighbors[current] - reached_boundary:
            reached_boundary.add(neighbor)
            pending.append(neighbor)
    if len(reached_boundary) != len(boundary_neighbors):
        return False

    # The balanced event sweep proves the one loop is simple. Adjacent edges
    # may share only their endpoint; every ambiguity deliberately falls back
    # to exact triangle checks.
    segments = []
    for _, start, end, start_uv, end_uv in boundary:
        segments.append({
            "start": start,
            "end": end,
            "start_uv": start_uv,
            "end_uv": end_uv,
            "min_x": min(start_uv[0], end_uv[0]),
            "max_x": max(start_uv[0], end_uv[0]),
            "min_y": min(start_uv[1], end_uv[1]),
            "max_y": max(start_uv[1], end_uv[1]),
        })
    return _boundary_segments_are_simple(segments)


def _bvh_self_overlaps(node) -> bool:
    """Whether one island contains a positive-area triangle overlap."""
    triangles = node.get("triangles")
    if triangles is not None:
        for index, triangle in enumerate(triangles):
            for candidate in triangles[index + 1:]:
                if not _bounds_positive_overlap(triangle, candidate):
                    continue
                if (_triangle_intersection_area(
                        triangle["points"], candidate["points"])
                        > _UV_OVERLAP_AREA_EPSILON):
                    return True
        return False

    if _bvh_self_overlaps(node["left"]) or _bvh_self_overlaps(node["right"]):
        return True
    return _bvh_nodes_overlap(node["left"], node["right"])


def _bvh_nodes_overlap(left, right) -> bool:
    """Exact positive-area overlap query between disjoint BVH branches."""
    if not _bounds_positive_overlap(left, right):
        return False
    left_triangles = left.get("triangles")
    right_triangles = right.get("triangles")
    if left_triangles is not None and right_triangles is not None:
        for triangle in left_triangles:
            for candidate in right_triangles:
                if not _bounds_positive_overlap(triangle, candidate):
                    continue
                if (_triangle_intersection_area(
                        triangle["points"], candidate["points"])
                        > _UV_OVERLAP_AREA_EPSILON):
                    return True
        return False
    if right_triangles is not None or (
            left_triangles is None and left["count"] >= right["count"]):
        return (
            _bvh_nodes_overlap(left["left"], right)
            or _bvh_nodes_overlap(left["right"], right)
        )
    return (
        _bvh_nodes_overlap(left, right["left"])
        or _bvh_nodes_overlap(left, right["right"])
    )


def _bvh_pair_relation(left, right, minimum_gutter: float) -> tuple[bool, float]:
    """Return (positive-area overlap, shortest distance below the gutter).

    Node bounds are a lower bound on triangle distance. Branches already far
    enough apart are never expanded; bounds that merely touch still descend
    because a child pair may overlap inside them.
    """
    best_distance = math.inf

    def visit(left_node, right_node) -> bool:
        nonlocal best_distance
        lower_bound = _uv_bounds_distance(left_node, right_node)
        if lower_bound > 0.0:
            threshold = min(best_distance, minimum_gutter - _UV_CONNECT_EPSILON)
            if minimum_gutter <= 0.0 or lower_bound >= threshold:
                return False
        left_triangles = left_node.get("triangles")
        right_triangles = right_node.get("triangles")
        if left_triangles is not None and right_triangles is not None:
            for triangle in left_triangles:
                for candidate in right_triangles:
                    if (_bounds_positive_overlap(triangle, candidate)
                            and _triangle_intersection_area(
                                triangle["points"], candidate["points"]
                            ) > _UV_OVERLAP_AREA_EPSILON):
                        return True
                    if minimum_gutter > 0.0:
                        triangle_lower_bound = _uv_bounds_distance(
                            triangle, candidate,
                        )
                        threshold = min(
                            best_distance,
                            minimum_gutter - _UV_CONNECT_EPSILON,
                        )
                        if triangle_lower_bound < threshold:
                            best_distance = min(
                                best_distance,
                                _triangle_distance(
                                    triangle["points"], candidate["points"]
                                ),
                            )
            return False
        if right_triangles is not None or (
                left_triangles is None
                and left_node["count"] >= right_node["count"]):
            return (
                visit(left_node["left"], right_node)
                or visit(left_node["right"], right_node)
            )
        return (
            visit(left_node, right_node["left"])
            or visit(left_node, right_node["right"])
        )

    return visit(left, right), best_distance


def pinned_uv_layout_issues(objs, uv_name: str = ATLAS_UV,
                            held: dict | None = None,
                            minimum_gutter: float = 0.0) -> list[dict]:
    """Return blocking bounds/spacing issues for pinned UV islands.

    `held` is the expanded per-loop mask returned by `average_unpinned`.
    Passing it makes this validator consume the exact islands Blender will
    lock in `pack_islands`; without it, current layer pin flags are used.
    Objects passed together are assumed to share one atlas. Overlap is tested
    on triangulated UV geometry, not bounding boxes. Distinct locked islands
    must also retain `minimum_gutter` UV units between their true boundaries
    and from the atlas edge, because Blender cannot move them to restore the
    bake/mipmap padding contract. Errors are deduplicated per island pair so
    dense hero meshes produce one useful error.
    """
    minimum_gutter = float(minimum_gutter)
    if not math.isfinite(minimum_gutter) or minimum_gutter < 0.0:
        raise ValueError(
            f"minimum_gutter must be a finite non-negative UV distance, got "
            f"{minimum_gutter!r}"
        )
    issues = []
    triangles = []
    packer_islands = {}
    degenerate_owners = set()
    for obj in sorted(objs, key=lambda item: item.name):
        mesh = obj.data
        layer = mesh.uv_layers.get(uv_name)
        if layer is None or not mesh.polygons:
            continue
        mask = ((held or {}).get(obj.name) if held is not None
                else [loop.pin_uv for loop in layer.data])
        if mask is None or not any(mask):
            continue
        if len(mask) != len(layer.data):
            raise RuntimeError(
                f"{obj.name}: pinned UV mask has {len(mask)} loops but "
                f"{uv_name} has {len(layer.data)}"
            )

        roots, display_numbers = _uv_polygon_islands(mesh, layer)
        pinned_roots = {
            roots[polygon.index]
            for polygon in mesh.polygons
            if any(mask[index] for index in polygon.loop_indices)
        }
        welded = _uv_welded_island_pairs(mesh, layer, roots)
        for root in pinned_roots:
            packer_islands[(obj.name, display_numbers[root])] = (
                obj.name, "packer-island", welded[root],
            )
        coordinates_by_root = {root: [] for root in pinned_roots}
        for polygon in mesh.polygons:
            root = roots[polygon.index]
            if root in coordinates_by_root:
                coordinates_by_root[root].extend(
                    tuple(layer.data[loop_index].uv)
                    for loop_index in polygon.loop_indices
                )
        invalid_roots = set()
        for root in sorted(pinned_roots, key=lambda item: display_numbers[item]):
            coordinates = coordinates_by_root[root]
            if any(not math.isfinite(value) for coordinate in coordinates for value in coordinate):
                invalid_roots.add(root)
                issues.append({
                    "kind": "non-finite",
                    "object": obj.name,
                    "island": display_numbers[root],
                })
                continue
            bounds = (
                min(point[0] for point in coordinates),
                min(point[1] for point in coordinates),
                max(point[0] for point in coordinates),
                max(point[1] for point in coordinates),
            )
            if (bounds[0] < -_UV_BOUNDS_EPSILON
                    or bounds[1] < -_UV_BOUNDS_EPSILON
                    or bounds[2] > 1.0 + _UV_BOUNDS_EPSILON
                    or bounds[3] > 1.0 + _UV_BOUNDS_EPSILON):
                issues.append({
                    "kind": "out-of-bounds",
                    "object": obj.name,
                    "island": display_numbers[root],
                    "bounds": bounds,
                })
            elif minimum_gutter > 0.0 and (
                    bounds[0] < minimum_gutter - _UV_BOUNDS_EPSILON
                    or bounds[1] < minimum_gutter - _UV_BOUNDS_EPSILON
                    or bounds[2] > 1.0 - minimum_gutter + _UV_BOUNDS_EPSILON
                    or bounds[3] > 1.0 - minimum_gutter + _UV_BOUNDS_EPSILON):
                issues.append({
                    "kind": "insufficient-edge-gutter",
                    "object": obj.name,
                    "island": display_numbers[root],
                    "bounds": bounds,
                    "requiredGutter": minimum_gutter,
                })

        mesh.calc_loop_triangles()
        zero_geometry = set(_exact_zero_world_area_triangle_indices(obj))
        for triangle in mesh.loop_triangles:
            root = roots[triangle.polygon_index]
            if root not in pinned_roots or root in invalid_roots:
                continue
            # A triangle with literally no world-space surface cannot claim a
            # bake pixel. Its loops remain part of conservative island bounds,
            # but it must not create a false overlap or degenerate-triangle
            # refusal for neighboring renderable faces.
            if triangle.index in zero_geometry:
                continue
            points = tuple(tuple(layer.data[index].uv) for index in triangle.loops)
            owner = (obj.name, display_numbers[root])
            if abs(_signed_polygon_area(points)) <= _UV_OVERLAP_AREA_EPSILON:
                degenerate_owners.add(owner)
                continue
            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            triangles.append({
                "owner": owner,
                "points": points,
                "topology": tuple(
                    (
                        mesh.loops[index].vertex_index,
                        float(layer.data[index].uv[0]),
                        float(layer.data[index].uv[1]),
                    )
                    for index in triangle.loops
                ),
                "min_x": min(xs), "max_x": max(xs),
                "min_y": min(ys), "max_y": max(ys),
            })

    for owner in sorted(degenerate_owners):
        issues.append({
            "kind": "degenerate",
            "object": owner[0],
            "island": owner[1],
        })
    if degenerate_owners:
        # One collapsed source triangle invalidates the complete locked island.
        # Do not let its remaining triangles enter an injectivity proof that
        # would incorrectly describe only the non-collapsed subset.
        triangles = [
            triangle for triangle in triangles
            if triangle["owner"] not in degenerate_owners
        ]

    # Build once per island. A triangle-level sweep becomes quadratic on a
    # perfectly valid radial fan because every AABB meets at its center; the
    # hierarchy prunes whole angular branches while preserving exact clips at
    # its leaves. The outer sweep therefore works on islands, not triangles.
    triangles_by_owner = {}
    for triangle in triangles:
        triangles_by_owner.setdefault(triangle["owner"], []).append(triangle)
    islands = []
    overlapping_pairs = set()
    for owner, owner_triangles in sorted(triangles_by_owner.items()):
        hierarchy = _triangle_bvh(owner_triangles)
        islands.append({"owner": owner, "hierarchy": hierarchy, **{
            key: hierarchy[key] for key in ("min_x", "max_x", "min_y", "max_y")
        }})
        if (not _disk_island_proves_no_self_overlap(owner_triangles)
                and _bvh_self_overlaps(hierarchy)):
            overlapping_pairs.add((owner, owner))

    islands.sort(key=lambda item: item["owner"])
    for ordinal, island in enumerate(islands):
        island["ordinal"] = ordinal
    insufficient_gutters = {}
    island_hierarchy = _island_bvh(islands) if islands else None
    for island in islands:
        for candidate in _island_bvh_candidates(
                island_hierarchy, island, minimum_gutter):
            pair = tuple(sorted((candidate["owner"], island["owner"])))
            if pair in overlapping_pairs:
                continue
            # Distinct packer islands only. Blender moves a welded group
            # rigidly, so a gutter demanded inside one is unobtainable at
            # every resolution -- and unnecessary: a bit-weld leaves no
            # uncovered texels for EXTEND to dilate into (measured: 0 covered
            # texels changed at margin 4 and margin 16). Overlap is still
            # measured on the topological islands, so a fold across a weld is
            # still an exact, reported overlap.
            gutter = (
                0.0 if packer_islands.get(pair[0], pair[0])
                == packer_islands.get(pair[1], pair[1])
                else minimum_gutter
            )
            overlaps, distance = _bvh_pair_relation(
                candidate["hierarchy"], island["hierarchy"], gutter,
            )
            if overlaps:
                overlapping_pairs.add(pair)
                insufficient_gutters.pop(pair, None)
                continue
            if (gutter > 0.0
                    and distance < gutter - _UV_CONNECT_EPSILON):
                insufficient_gutters[pair] = min(
                    distance, insufficient_gutters.get(pair, math.inf)
                )

    for pair in sorted(overlapping_pairs):
        issues.append({
            "kind": ("self-overlap" if pair[0] == pair[1] else "overlap"),
            "object": pair[0][0],
            "island": pair[0][1],
            "otherObject": pair[1][0],
            "otherIsland": pair[1][1],
        })
    for pair, distance in sorted(insufficient_gutters.items()):
        issues.append({
            "kind": "insufficient-gutter",
            "object": pair[0][0],
            "island": pair[0][1],
            "otherObject": pair[1][0],
            "otherIsland": pair[1][1],
            "distance": distance,
            "requiredGutter": minimum_gutter,
        })

    return sorted(issues, key=lambda issue: (
        issue["object"], issue["island"], issue["kind"],
        issue.get("otherObject", ""), issue.get("otherIsland", 0),
    ))


_ATLAS_LAYOUT_VERSION = 1
_ATLAS_LAYOUT_ENCODING = "f32le-zlib-base64"


def mesh_topology_hash(mesh) -> str:
    """Stable identity for the loop topology addressed by atlas UV evidence.

    Packed UVs are corner data. Vertex count or loop count alone can match
    after a topology edit while the corner-to-vertex mapping changed, so the
    evidence includes polygon boundaries and every loop's vertex index.
    """
    digest = hashlib.sha256()
    digest.update(struct.pack("<III", len(mesh.vertices), len(mesh.loops), len(mesh.polygons)))
    for polygon in mesh.polygons:
        digest.update(struct.pack("<II", polygon.loop_start, polygon.loop_total))
    for loop in mesh.loops:
        digest.update(struct.pack("<I", loop.vertex_index))
    return digest.hexdigest()[:16]


def packed_uv_area(obj, uv_name: str = ATLAS_UV) -> float:
    """Area occupied by an object's packed UV polygons in normalized space.

    This is the canonical coverage measurement used by both the plan and the
    post-pack failure gate. Keeping it beside the packer prevents reporting
    and bake validation from drifting apart.
    """
    layer = obj.data.uv_layers.get(uv_name)
    if layer is None:
        return 0.0
    area = 0.0
    for polygon in obj.data.polygons:
        coordinates = [layer.data[index].uv for index in polygon.loop_indices]
        shoelace = 0.0
        for index, current in enumerate(coordinates):
            following = coordinates[(index + 1) % len(coordinates)]
            shoelace += current.x * following.y - following.x * current.y
        area += abs(shoelace) * 0.5
    return area


def material_binding_packed_uv_coverage(
        obj, slot_index: int, uv_name: str) -> dict:
    """Measure one selected material binding on its exact private UV layer.

    Density is a per-binding claim: unrelated material slots must not inflate
    it, and zero-world-area triangles cannot contribute visible surface area.
    The general atlas layout validator remains deliberately conservative and
    still sees every loop; this helper owns only selected-field density.
    """
    if obj is None or getattr(obj, "type", None) != "MESH":
        raise RuntimeError("selected-field UV coverage needs one Mesh object")
    resolved_slot = int(slot_index)
    if resolved_slot < 0:
        raise ValueError("selected-field UV coverage needs a non-negative slot")
    mesh = obj.data
    layer = mesh.uv_layers.get(uv_name)
    if layer is None:
        raise RuntimeError(
            f"{obj.name}: selected-field density requires UV layer {uv_name!r}"
        )
    mesh.calc_loop_triangles()
    world_area = 0.0
    uv_area = 0.0
    zero_world_area = 0
    triangle_count = 0
    for triangle in mesh.loop_triangles:
        polygon = mesh.polygons[triangle.polygon_index]
        if int(polygon.material_index) != resolved_slot:
            continue
        triangle_count += 1
        points = [
            obj.matrix_world @ mesh.vertices[index].co
            for index in triangle.vertices
        ]
        triangle_world_area = 0.5 * (
            points[1] - points[0]
        ).cross(points[2] - points[0]).length
        if not math.isfinite(triangle_world_area):
            raise RuntimeError(
                f"{obj.name}: material slot {resolved_slot} has non-finite "
                "world-space triangle area"
            )
        if triangle_world_area <= 0.0:
            zero_world_area += 1
            continue
        uv_points = [
            tuple(layer.data[index].uv)
            for index in triangle.loops
        ]
        triangle_uv_area = abs(_signed_polygon_area(uv_points))
        if not math.isfinite(triangle_uv_area):
            raise RuntimeError(
                f"{obj.name}: material slot {resolved_slot} has non-finite "
                f"coordinates in private UV layer {uv_name!r}"
            )
        world_area += triangle_world_area
        uv_area += triangle_uv_area
    if triangle_count == 0 or world_area <= 0.0:
        raise RuntimeError(
            f"{obj.name}: material slot {resolved_slot} has no finite "
            "non-zero world-space surface for selected-field density"
        )
    return {
        "uvArea": uv_area,
        "worldAreaM2": world_area,
        "triangleCount": triangle_count,
        "zeroWorldAreaTriangleCount": zero_world_area,
    }


def capture_packed_uv_evidence(objs, atlas_for) -> dict:
    """Serialize the exact packed corner UVs that are about to ship.

    This is deliberately an output snapshot, not enough settings to replay a
    pack. Blender's packer, evaluated modifiers, and the fixed dilation guard
    can all make a replay differ. The compressed float32 bytes preserve the
    values Blender stores while keeping the manifest substantially smaller
    than a JSON pair per loop.

    ``atlas_for`` may be a mapping keyed by object name or a callable.
    """
    records = []
    lookup = atlas_for if callable(atlas_for) else lambda obj: atlas_for[obj.name]
    for obj in sorted(objs, key=lambda item: item.name):
        layer = obj.data.uv_layers.get(ATLAS_UV)
        if layer is None:
            raise RuntimeError(f"{obj.name}: packed atlas layer {ATLAS_UV!r} is missing")
        raw = b"".join(
            struct.pack("<ff", float(loop.uv.x), float(loop.uv.y))
            for loop in layer.data
        )
        object_id = obj.get("blendlink_id")
        records.append({
            "name": obj.name,
            **({"id": object_id} if isinstance(object_id, str) and object_id else {}),
            "atlas": str(lookup(obj)),
            "topologyHash": mesh_topology_hash(obj.data),
            "loopCount": len(layer.data),
            "uvHash": hashlib.sha256(raw).hexdigest()[:16],
            "data": base64.b64encode(zlib.compress(raw, level=9)).decode("ascii"),
        })
    return {
        "version": _ATLAS_LAYOUT_VERSION,
        "encoding": _ATLAS_LAYOUT_ENCODING,
        "space": "blender-pack",
        "objects": records,
    }


def _decode_packed_uv_record(record: dict) -> list[tuple[float, float]]:
    try:
        compressed = base64.b64decode(record["data"], validate=True)
        raw = zlib.decompress(compressed)
        count = int(record["loopCount"])
    except (KeyError, TypeError, ValueError, zlib.error) as error:
        raise ValueError(f"invalid packed UV payload: {error}") from error
    expected_bytes = count * 8
    if len(raw) != expected_bytes:
        raise ValueError(
            f"packed UV payload has {len(raw)} bytes; expected {expected_bytes} for {count} loops"
        )
    expected_hash = record.get("uvHash")
    actual_hash = hashlib.sha256(raw).hexdigest()[:16]
    if not isinstance(expected_hash, str) or actual_hash != expected_hash:
        raise ValueError(
            f"packed UV payload hash is {actual_hash}; expected {expected_hash!r}"
        )
    return list(struct.iter_unpack("<ff", raw))


def apply_packed_uv_evidence(scene_objects, evidence: dict,
                             uv_name: str = ATLAS_UV) -> dict:
    """Apply published packed UV evidence to matching source meshes.

    Identity prefers ``blendlink_id`` and falls back to the recorded object
    name for legacy scenes. Topology must match exactly. Linked mesh data with
    more than one published record is refused because one Blender UV layer
    cannot represent different per-instance packs. Returns a loud, structured
    result: ``{applied: [...], skipped: [{name, reason}]}``.
    """
    if not isinstance(evidence, dict):
        raise ValueError("atlas layout evidence is missing")
    if evidence.get("version") != _ATLAS_LAYOUT_VERSION:
        raise ValueError(
            f"atlas layout version {evidence.get('version')!r} is unsupported; "
            f"expected {_ATLAS_LAYOUT_VERSION}"
        )
    if evidence.get("encoding") != _ATLAS_LAYOUT_ENCODING:
        raise ValueError(
            f"atlas layout encoding {evidence.get('encoding')!r} is unsupported"
        )
    records = evidence.get("objects")
    if not isinstance(records, list):
        raise ValueError("atlas layout objects must be a list")

    objects = list(scene_objects)
    by_name = {obj.name: obj for obj in objects}
    by_id = {}
    duplicate_ids = set()
    for obj in objects:
        object_id = obj.get("blendlink_id")
        if not isinstance(object_id, str) or not object_id:
            continue
        if object_id in by_id:
            duplicate_ids.add(object_id)
        else:
            by_id[object_id] = obj
    resolved = []
    skipped = []
    for item in evidence.get("unavailable", []):
        if isinstance(item, dict):
            skipped.append({
                "name": str(item.get("name", "<unnamed>")),
                "reason": "final GLB UV evidence unavailable: " + str(item.get("reason", "unknown reason")),
            })
    mesh_owners = {}
    conflicted_meshes = set()
    for record in records:
        if not isinstance(record, dict):
            skipped.append({"name": "<invalid>", "reason": "layout record is not an object"})
            continue
        name = str(record.get("name", "<unnamed>"))
        object_id = record.get("id")
        if isinstance(object_id, str) and object_id in duplicate_ids:
            skipped.append({
                "name": name,
                "reason": f"stable ID {object_id!r} is duplicated in the live scene; repair IDs and resync",
            })
            continue
        has_stable_id = isinstance(object_id, str) and bool(object_id)
        obj = by_id.get(object_id) if has_stable_id else by_name.get(name)
        if has_stable_id and obj is None:
            skipped.append({
                "name": name,
                "reason": (
                    f"published stable ID {object_id!r} is not present; "
                    "resync before loading atlas UVs"
                ),
            })
            continue
        if obj is None or obj.type != "MESH":
            skipped.append({"name": name, "reason": "published mesh is not present"})
            continue
        if obj.data in conflicted_meshes:
            skipped.append({
                "name": name,
                "reason": "shares mesh data with another published object; make it single-user and resync",
            })
            continue
        prior = mesh_owners.get(obj.data)
        if prior is not None and prior != name:
            reason = "shares mesh data with another published object; make it single-user and resync"
            resolved = [(item, values) for item, values in resolved if item.data != obj.data]
            if not any(item["name"] == prior and "shares mesh data" in item["reason"]
                       for item in skipped):
                skipped.append({"name": prior, "reason": reason})
            skipped.append({
                "name": name,
                "reason": reason,
            })
            conflicted_meshes.add(obj.data)
            continue
        mesh_owners[obj.data] = name
        expected_topology = record.get("topologyHash")
        actual_topology = mesh_topology_hash(obj.data)
        if expected_topology != actual_topology:
            skipped.append({
                "name": name,
                "reason": (
                    f"topology differs from the published evaluated mesh "
                    f"({actual_topology} != {expected_topology!r})"
                ),
            })
            continue
        try:
            values = _decode_packed_uv_record(record)
        except ValueError as error:
            skipped.append({"name": name, "reason": str(error)})
            continue
        if len(values) != len(obj.data.loops):
            skipped.append({
                "name": name,
                "reason": f"loop count differs ({len(obj.data.loops)} != {len(values)})",
            })
            continue
        resolved.append((obj, values))

    # Preflight editability and name/capacity conflicts before touching any UV
    # values. Existing preview layers are updated in place so an allocation
    # failure can never destroy the artist's prior inspection state.
    targets = []
    for obj, values in resolved:
        mesh = obj.data
        if not getattr(mesh, "is_editable", True):
            skipped.append({
                "name": obj.name,
                "reason": "mesh data is linked/read-only; make it local before loading atlas UVs",
            })
            continue
        layer = mesh.uv_layers.get(uv_name)
        reserved = mesh.attributes.get(uv_name)
        if layer is None and reserved is not None:
            skipped.append({
                "name": obj.name,
                "reason": f"mesh attribute {uv_name!r} blocks the UV layer name; rename it first",
            })
            continue
        targets.append({
            "obj": obj,
            "mesh": mesh,
            "values": values,
            "layer": layer,
            "active": mesh.uv_layers.active.name if mesh.uv_layers.active else None,
            "snapshot": (
                [(tuple(loop.uv), bool(loop.pin_uv)) for loop in layer.data]
                if layer is not None else None
            ),
        })

    created = []
    writable = []
    for target in targets:
        layer = target["layer"]
        if layer is None:
            failure = None
            try:
                layer = target["mesh"].uv_layers.new(name=uv_name)
            except Exception as error:
                failure = f"{type(error).__name__}: {error}"
                layer = None
            if layer is not None and layer.name != uv_name:
                failure = f"Blender returned renamed UV layer {layer.name!r}"
                try:
                    target["mesh"].uv_layers.remove(layer)
                except Exception as error:
                    raise RuntimeError(
                        f"{target['obj'].name}: could not roll back rejected UV layer: {error}"
                    ) from error
                layer = None
            if layer is None:
                skipped.append({
                    "name": target["obj"].name,
                    "reason": (
                        f"could not add {uv_name} ({failure or 'UV-layer limit'}); "
                        "remove unused UV maps"
                    ),
                })
                continue
            created.append((target["mesh"], layer))
            target["layer"] = layer
        writable.append(target)

    applied = []
    try:
        for target in writable:
            layer = target["layer"]
            values = target["values"]
            if len(layer.data) != len(values):
                raise RuntimeError(
                    f"{target['obj'].name}: loop count changed while loading atlas UVs"
                )
            for loop, (x, y) in zip(layer.data, values):
                loop.uv = (x, y)
                loop.pin_uv = False
            target["mesh"].uv_layers.active = layer
            applied.append(target["obj"].name)
    except Exception as error:
        rollback_errors = []
        for target in writable:
            snapshot = target["snapshot"]
            if snapshot is None:
                continue
            try:
                for loop, (uv, pinned) in zip(target["layer"].data, snapshot):
                    loop.uv = uv
                    loop.pin_uv = pinned
            except Exception as rollback_error:
                rollback_errors.append(
                    f"{target['obj'].name}: {type(rollback_error).__name__}: {rollback_error}"
                )
        for mesh, layer in reversed(created):
            try:
                mesh.uv_layers.remove(layer)
            except Exception as rollback_error:
                rollback_errors.append(
                    f"{mesh.name}: {type(rollback_error).__name__}: {rollback_error}"
                )
        for target in targets:
            active_name = target["active"]
            if active_name:
                active = target["mesh"].uv_layers.get(active_name)
                if active is not None:
                    target["mesh"].uv_layers.active = active
        detail = (
            "; rollback also failed: " + "; ".join(rollback_errors)
            if rollback_errors else "; every target was restored"
        )
        raise RuntimeError(
            f"loading published atlas UVs failed: {type(error).__name__}: {error}{detail}"
        ) from error
    return {"applied": applied, "skipped": skipped}


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
    with scoped_uv_edit(packable):
        bpy.ops.uv.average_islands_scale()


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
    # The uv.select_* ops below act on UV selection, not mesh selection,
    # so this needs sync OFF and establishes its own UV selection.
    with scoped_uv_edit(packable, sync=False, select_uvs=False):
        bpy.ops.uv.select_all(action="DESELECT")
        bpy.ops.uv.select_pinned()
        bpy.ops.uv.select_linked()
        bpy.ops.uv.pin(clear=False)
        bpy.ops.uv.select_all(action="INVERT")
        bpy.ops.uv.average_islands_scale()
    held = {}
    for obj in packable:
        layer = obj.data.uv_layers.get(uv_name)
        if layer is None:
            continue
        mask = _uv_layer_pin_mask(layer)
        if any(mask):
            held[obj.name] = mask
    return held


def required_bake_gutter_px(margin_px: int, *, guard_px: int = 4) -> int:
    """Atlas spacing for Blender's native multi-object EXTEND writes.

    The bake operator writes each selected receiver through its own mask and
    extends that receiver by ``margin_px``. Adjacent receivers therefore need
    two margins plus a small mip/raster guard. Needle 1.4.2 uses this exact
    ``2 * margin + 4`` contract; the official Blender bake loop confirms the
    receiver-local writes. A joined proxy needed only one margin, but joining
    cannot preserve general object-scoped shader semantics.
    """
    margin = int(margin_px)
    if margin < 0:
        raise ValueError(f"bake margin cannot be negative: {margin_px}")
    guard = int(guard_px)
    if guard < 0:
        raise ValueError(f"bake gutter guard cannot be negative: {guard_px}")
    return 2 * margin + guard


def _pack_selected_uv_islands(
        *, margin: float, rotate: bool, scale: bool = True,
        shape_method: str = "CONCAVE") -> None:
    # Deliberately NOT on scoped_uv_edit: this is the only UV operation
    # that must set use_uv_select_sync AFTER entering Edit Mode (see the
    # multi-object contract below), while the seam sets it before. Every
    # other bpy.ops.uv.* primitive in this module goes through the seam.
    prior_sync = bpy.context.tool_settings.use_uv_select_sync
    expected = {
        obj.as_pointer() for obj in bpy.context.selected_objects
        if obj.type == "MESH"
    }
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        # Multi-object proxy packing follows Needle's explicit sync contract;
        # without it Blender 5.2 can pack only the active proxy and leave the
        # other receiver rectangles stacked at the origin.
        bpy.context.tool_settings.use_uv_select_sync = True
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.select_all(action="SELECT")
        entered = {
            obj.as_pointer()
            for obj in bpy.context.objects_in_mode_unique_data
            if obj.type == "MESH"
        }
        if entered != expected:
            raise RuntimeError(
                "UV packing did not enter multi-object Edit Mode for every "
                f"selected receiver ({len(entered)}/{len(expected)})"
            )
        bpy.ops.uv.pack_islands(
            rotate=rotate,
            rotate_method="CARDINAL",
            scale=scale,
            merge_overlap=False,
            margin_method="FRACTION",
            margin=float(margin),
            shape_method=shape_method,
        )
    finally:
        bpy.context.tool_settings.use_uv_select_sync = prior_sync
        bpy.ops.object.mode_set(mode="OBJECT")


def _active_uv_bounds(obj) -> tuple[float, float, float, float]:
    layer = obj.data.uv_layers.active
    if layer is None or not layer.data:
        raise RuntimeError(f"{obj.name}: receiver packing needs an active UV layer")
    coordinates = [tuple(loop.uv) for loop in layer.data]
    return (
        min(point[0] for point in coordinates),
        min(point[1] for point in coordinates),
        max(point[0] for point in coordinates),
        max(point[1] for point in coordinates),
    )


def _pack_receiver_groups_mutating(
        objs, margin_px: int, size: int, *, guard_px: int = 4,
        local_margin_scale: float = 1.0) -> bool:
    """Pack local charts, then globally pack one rectangle per receiver.

    Needle 1.4.2 uses the same two-level ownership shape. The large native
    multi-object gap belongs between receivers because separate bake writes can
    overwrite one another. Charging that gap to every chart reduces a complex
    scene to a tiny fraction of its atlas. Inside one receiver, retain
    Blendlink's previously validated ``bake margin + 4px`` chart gap (stronger
    than Needle's ``margin + 1px``); the deterministic outer rectangle pass
    then keeps receiver ownership intact while preserving Blendlink's
    precomputed UV-area ratios (surface density, camera weighting, and artist
    texel weight).

    This path is intentionally limited to fully unpinned layouts. Artist-held
    coordinates continue through Blender's ordinary global locked-island pack.
    """
    objects = [obj for obj in objs if len(obj.data.polygons) > 0]
    if not objects:
        return False
    if size <= 0:
        raise ValueError(f"receiver pack size must be positive: {size}")

    target_areas = {}
    for obj in objects:
        layer = obj.data.uv_layers.active
        if layer is None:
            raise RuntimeError(f"{obj.name}: receiver packing needs an active UV layer")
        area = packed_uv_area(obj, layer.name)
        if not math.isfinite(area) or area <= _UV_OVERLAP_AREA_EPSILON:
            # The bounded repair pass that follows packing owns collapsed
            # evaluated UVs. Let the ordinary pack establish a first layout;
            # after repair, the next call can use hierarchical ownership.
            select_only(objects)
            _pack_selected_uv_islands(
                margin=required_bake_gutter_px(
                    margin_px, guard_px=guard_px,
                ) / size,
                rotate=True,
            )
            return False
        target_areas[obj.as_pointer()] = area

    total_area = sum(target_areas.values())
    # Give the local no-scale packs enough common working room while retaining
    # every receiver's precomputed area ratio. The final proxy pass expands or
    # contracts this whole arrangement uniformly to the atlas bounds.
    normalization = math.sqrt(0.25 / total_area)
    for obj in objects:
        layer = obj.data.uv_layers.active
        for loop in layer.data:
            loop.uv.x *= normalization
            loop.uv.y *= normalization

    receiver_bounds = {}
    inner_guard = float(guard_px)
    for obj in sorted(objects, key=lambda item: item.name):
        expected_area = target_areas[obj.as_pointer()] * normalization * normalization
        # The caller's fixed-point loop scales this request until the
        # DELIVERED gutter (this local charge times the outer allocation's
        # uniform scale) meets the final-space contract.
        local_margin = (
            (float(margin_px) + inner_guard) / float(size)
        ) * float(local_margin_scale)
        select_only([obj])
        _pack_selected_uv_islands(
            margin=local_margin, rotate=True, scale=False,
            shape_method="AABB",
        )
        layer = obj.data.uv_layers.active
        packed_area = packed_uv_area(obj, layer.name)
        if (not math.isfinite(packed_area)
                or packed_area <= _UV_OVERLAP_AREA_EPSILON):
            raise RuntimeError(
                f"{obj.name}: local receiver packing produced zero UV area"
            )
        if not math.isclose(
                packed_area, expected_area, rel_tol=2e-4, abs_tol=1e-10):
            raise RuntimeError(
                f"{obj.name}: no-scale local receiver pack changed UV area "
                f"from {expected_area:.8g} to {packed_area:.8g}"
            )
        receiver_bounds[obj.as_pointer()] = _active_uv_bounds(obj)

    rectangles = []
    object_by_name = {}
    for obj in sorted(objects, key=lambda item: item.name):
        bounds = receiver_bounds[obj.as_pointer()]
        width = bounds[2] - bounds[0]
        height = bounds[3] - bounds[1]
        if width <= 0.0 or height <= 0.0:
            raise RuntimeError(f"{obj.name}: receiver UV bounds are collapsed")
        rectangles.append((obj.name, width, height))
        object_by_name[obj.name] = obj

    edge_gutter = (float(margin_px) + float(guard_px)) / float(size)
    allocation = allocate_receiver_rectangles(
        rectangles,
        edge_gutter=edge_gutter,
        receiver_gutter=required_bake_gutter_px(
            margin_px, guard_px=guard_px,
        ) / float(size),
    )
    for name, packed_bounds in allocation["placements"].items():
        obj = object_by_name[name]
        source_bounds = receiver_bounds[obj.as_pointer()]
        source_width = source_bounds[2] - source_bounds[0]
        source_height = source_bounds[3] - source_bounds[1]
        scale_u = (packed_bounds[2] - packed_bounds[0]) / source_width
        scale_v = (packed_bounds[3] - packed_bounds[1]) / source_height
        if not math.isclose(scale_u, scale_v, rel_tol=2e-4, abs_tol=1e-7):
            raise RuntimeError(
                f"{obj.name}: receiver rectangle pack changed aspect ratio "
                f"({scale_u:.8g} by {scale_v:.8g})"
            )
        layer = obj.data.uv_layers.active
        for loop in layer.data:
            loop.uv.x = packed_bounds[0] + (
                loop.uv.x - source_bounds[0]
            ) * scale_u
            loop.uv.y = packed_bounds[1] + (
                loop.uv.y - source_bounds[1]
            ) * scale_v
    select_only(objects)
    return True


# The fixed-point margin loop saturates in the margin-dominated regime
# (raising the local charge inflates the local AABBs, which lowers the
# uniform outer scale) -- bound the passes and let the proof refuse.
_RECEIVER_LOCAL_MARGIN_PASSES = 6


def _receiver_intra_gutter_shortfall(
        objs, margin_px: int, size: int, *, guard_px: int = 4):
    """Worst delivered same-owner island gutter, if under contract.

    Returns ``(delivered, required)`` in UV fraction units for the worst
    same-owner packer-island pair across all receivers, or ``None`` when
    every pair honors ``(margin + guard) / size``. The cross-receiver and
    edge gutters are enforced exactly by ``allocate_receiver_rectangles``
    in final space and need no feedback.
    """
    required = (float(margin_px) + float(guard_px)) / float(size)
    epsilon = 2e-6
    worst = None
    for obj in objs:
        islands = _receiver_island_bounds(obj)
        for index, (_left_number, left) in enumerate(islands):
            for _right_number, right in islands[index + 1:]:
                distance = _uv_bounds_tuple_distance(left, right)
                if distance + epsilon < required and (
                        worst is None or distance < worst):
                    worst = distance
    if worst is None:
        return None
    return worst, required


class _ReceiverUvRestoreError(RuntimeError):
    """The between-pass UV snapshot restore failed; packing state is the
    diagnosis, not the pack itself -- surfaced unwrapped."""


def _pack_receiver_groups(
        objs, margin_px: int, size: int, *, guard_px: int = 4) -> None:
    """Transactional wrapper for the receiver-rectangle allocator."""
    objects = [obj for obj in objs if len(obj.data.polygons) > 0]
    snapshots = []
    for obj in objects:
        layer = obj.data.uv_layers.active
        if layer is None:
            raise RuntimeError(f"{obj.name}: receiver packing needs an active UV layer")
        snapshots.append((
            obj, layer.name, [tuple(loop.uv) for loop in layer.data],
        ))
    def restore_snapshots() -> list:
        failures = []
        for obj, layer_name, coordinates in snapshots:
            # UV operators can replace CustomData storage while retaining the
            # layer name. Reusing the pre-Edit-Mode RNA wrapper silently writes
            # stale memory and does not roll back the live mesh.
            layer = obj.data.uv_layers.get(layer_name)
            if layer is None:
                failures.append(
                    f"{obj.name}: missing UV layer {layer_name}"
                )
                continue
            if len(layer.data) != len(coordinates):
                failures.append(
                    f"{obj.name}: {layer_name} changed from "
                    f"{len(coordinates)} to {len(layer.data)} loops"
                )
                continue
            for loop, coordinate in zip(layer.data, coordinates):
                loop.uv = coordinate
        return failures

    try:
        # The local packs charge the chart gutter BEFORE the outer
        # allocation multiplies every receiver by its single uniform scale,
        # so the delivered same-owner gutter is (charge x scale) -- under
        # contract whenever local packing efficiency pushes the scale below
        # 1. Close the loop on the measurement itself: escalate the local
        # charge by the measured shortfall (agnostic of Blender's
        # margin-to-gap factor), repack from the pristine snapshot, and
        # refuse only when the margin-dominated regime saturates.
        local_margin_scale = 1.0
        base_charge = (float(margin_px) + float(guard_px)) / float(size)
        previous_delivered = None
        for attempt in range(_RECEIVER_LOCAL_MARGIN_PASSES):
            hierarchical = _pack_receiver_groups_mutating(
                objects, margin_px, size, guard_px=guard_px,
                local_margin_scale=local_margin_scale,
            )
            if not hierarchical:
                break
            shortfall = _receiver_intra_gutter_shortfall(
                objects, margin_px, size, guard_px=guard_px,
            )
            if shortfall is None:
                break
            delivered, required = shortfall
            # A convergent pass closes a meaningful fraction of the
            # REMAINING gap; the margin-dominated regime (raising the
            # charge inflates the local AABBs, which lowers the uniform
            # outer scale) barely moves it -- refuse now instead of
            # burning the remaining passes on it. Measured: the
            # cube-diorama moves 5.46px -> 5.62px against a 12px contract
            # (2.5% of its gap, unresolvable at any charge) while the
            # convergent headless fixture moves 18.64px -> 19.3px against
            # 20px (half its gap per pass).
            saturated = (
                previous_delivered is not None
                and (delivered - previous_delivered)
                < 0.25 * (required - previous_delivered)
            )
            if saturated or attempt + 1 >= _RECEIVER_LOCAL_MARGIN_PASSES:
                raise ReceiverGutterProofError(
                    "hierarchical receiver packing saturated before "
                    "delivering its chart gutter: "
                    f"{delivered * size:.3g}px of {required * size:.3g}px "
                    f"after {attempt + 1} margin pass(es)"
                )
            previous_delivered = delivered
            # 5% headroom so convergence does not asymptote just under the
            # proof's epsilon; the touching-pair floor bounds each pass's
            # escalation at 4.2x. Blender's pack_islands FRACTION margin
            # hard-clamps at 1.0 (measured on 5.2: 1.0, 5.0, and 100.0
            # produce bit-identical layouts), so cap the request there --
            # one pass at the clamp is the maximal attempt, and the
            # progress check above refuses the bit-identical pass after it.
            local_margin_scale = min(
                local_margin_scale
                * 1.05 * required / max(delivered, required / 4.0),
                1.0 / base_charge,
            )
            between_failures = restore_snapshots()
            if between_failures:
                raise _ReceiverUvRestoreError(
                    "receiver packing could not restore its UV transaction "
                    "between margin passes: " + "; ".join(between_failures)
                )
    except _ReceiverUvRestoreError:
        # The restore itself is the diagnosis; re-restoring cannot succeed
        # and rewrapping would misattribute the failure to the pack.
        raise
    except BaseException as error:
        rollback_failures = restore_snapshots()
        if rollback_failures:
            raise RuntimeError(
                "receiver packing failed and could not restore its UV "
                "transaction: " + "; ".join(rollback_failures)
            ) from error
        raise




def _receiver_island_bounds(obj) -> list[tuple[int, tuple[float, float, float, float]]]:
    layer = obj.data.uv_layers.active
    if layer is None:
        raise RuntimeError(f"{obj.name}: receiver spacing validation needs an active UV layer")
    roots, display_numbers = _uv_polygon_islands(obj.data, layer)
    # Fold welded topological islands into the packer's units: pack_islands
    # moves a welded component rigidly, so demanding a gutter inside one is
    # unsatisfiable at every resolution.
    welded = _uv_welded_island_pairs(obj.data, layer, roots)
    coordinates = {}
    for polygon in obj.data.polygons:
        root = welded[roots[polygon.index]]
        coordinates.setdefault(root, []).extend(
            tuple(layer.data[index].uv) for index in polygon.loop_indices
        )
    result = []
    for root, points in coordinates.items():
        if any(
                not math.isfinite(value)
                for point in points for value in point):
            raise RuntimeError(
                f"{obj.name}: receiver island {display_numbers[root]} has "
                "NaN or infinite UV coordinates after packing"
            )
        result.append((display_numbers[root], (
            min(point[0] for point in points),
            min(point[1] for point in points),
            max(point[0] for point in points),
            max(point[1] for point in points),
        )))
    return sorted(result)


class ReceiverGutterProofError(RuntimeError):
    """The packed layout cannot honor its fixed-pixel gutter contract.

    Gutters are fixed pixel amounts, so the same fractional layout doubles
    its achieved gutter at double the resolution — callers with a bounded
    resolution ladder may retry a larger candidate instead of refusing."""


def validate_receiver_group_spacing(
        objs, margin_px: int, size: int, *, guard_px: int = 4) -> None:
    """Prove final AABB-pack spacing at the ownership levels that write it."""
    if size <= 0:
        raise ValueError(f"receiver spacing size must be positive: {size}")
    inner = (float(margin_px) + float(guard_px)) / float(size)
    outer = required_bake_gutter_px(
        margin_px, guard_px=guard_px,
    ) / float(size)
    epsilon = 2e-6
    receiver_bounds = []
    failures = []
    for obj in sorted(objs, key=lambda item: item.name):
        islands = _receiver_island_bounds(obj)
        if not islands:
            continue
        bounds = (
            min(item[1][0] for item in islands),
            min(item[1][1] for item in islands),
            max(item[1][2] for item in islands),
            max(item[1][3] for item in islands),
        )
        receiver_bounds.append((obj.name, bounds))
        edge = min(bounds[0], bounds[1], 1.0 - bounds[2], 1.0 - bounds[3])
        if edge + epsilon < inner:
            failures.append(
                f"{obj.name} leaves {edge * size:.3g}px at the atlas edge; "
                f"needs {inner * size:.3g}px"
            )
        for index, (left_number, left) in enumerate(islands):
            for right_number, right in islands[index + 1:]:
                distance = _uv_bounds_tuple_distance(left, right)
                if distance + epsilon < inner:
                    failures.append(
                        f"{obj.name} islands {left_number}/{right_number} leave "
                        f"{distance * size:.3g}px; need {inner * size:.3g}px"
                    )
                    break
            if failures and failures[-1].startswith(f"{obj.name} islands"):
                break

    for index, (left_name, left) in enumerate(receiver_bounds):
        for right_name, right in receiver_bounds[index + 1:]:
            distance = _uv_bounds_tuple_distance(left, right)
            if distance + epsilon < outer:
                failures.append(
                    f"receivers {left_name}/{right_name} leave "
                    f"{distance * size:.3g}px; need {outer * size:.3g}px"
                )
                break
        if failures and failures[-1].startswith("receivers "):
            break
    if failures:
        raise ReceiverGutterProofError(
            "hierarchical receiver packing could not prove its chart/receiver "
            "gutter contract: " + "; ".join(failures[:8])
        )


def pack(
        objs, margin_px: int, size: int, pin: bool = False, *,
        guard_px: int = 4, group_receivers: bool = False,
        chart_shape: str | None = None) -> None:
    packable = [obj for obj in objs if len(obj.data.polygons) > 0]
    if not packable:
        return
    # Hierarchical ownership exists to keep cross-receiver area ratios and
    # ownership rectangles; a single receiver owns the whole atlas, and the
    # ordinary global pack separates dense per-face chart layouts that the
    # no-scale local AABB pass leaves stacked (measured: 288 lightmap
    # charts, hierarchical min gap 0px vs plain pack 48px at 4096).
    if group_receivers and len(packable) > 1:
        _pack_receiver_groups(
            packable, margin_px, size, guard_px=guard_px,
        )
        return
    # AABB outlines when the caller's downstream proof measures exact
    # geometric gutters: a bounding-box gap always lower-bounds the true
    # shape gap, so the proof holds by construction.
    shape_method = (
        "AABB" if (chart_shape == "AABB" or group_receivers) else "CONCAVE"
    )
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
        margin=required_bake_gutter_px(
            margin_px, guard_px=guard_px,
        ) / size,
        shape_method=shape_method,
    )
    if pin:
        # LOCKED: islands containing any pinned UV keep position AND scale;
        # everything else packs around them. With zero pins present the
        # result is byte-identical to pin=False (verified on 5.2), so the
        # unchanged-inputs-pack-identically invariant holds.
        kwargs.update(pin=True, pin_method="LOCKED")
    bpy.ops.uv.pack_islands(**kwargs)
    bpy.ops.object.mode_set(mode="OBJECT")


_TARGET_RESCUE_INRADIUS_DELIVERY_TEXELS = 1.0
_MINIMUM_PACKED_RESCUE_INRADIUS_DELIVERY_TEXELS = 0.75


def _minimum_footprint_rescue_and_repack(
        objects, remaining, uv_name: str, margin_px: int, size: int, *,
        delivery_size: int | None = None, pin: bool = False,
        guard_px: int = 4, group_receivers: bool = False,
        log=print) -> list[dict]:
    """Give post-density micro-polygons a resolvable footprint and repack.

    Repeating equal-density scaling recreates the float32 collapse. At this
    discrete-output boundary, regularize only the affected polygon and target
    a one-delivery-texel incircle in every resulting triangle. An incircle
    above sqrt(2)/2 texels must contain a texel center regardless of lattice
    translation; the 0.75 post-pack floor leaves explicit headroom. One
    adaptive enlarge/repack is allowed if global packing shrinks below it.
    """
    if size <= 0:
        raise ValueError("minimum-footprint atlas rescue requires a positive size")
    resolved_delivery_size = size if delivery_size is None else delivery_size
    if resolved_delivery_size <= 0 or resolved_delivery_size > size:
        raise ValueError(
            "minimum-footprint atlas rescue requires a positive delivery size "
            "no larger than the effective bake size"
        )

    prepared = []
    for obj, triangles in remaining:
        layer = obj.data.uv_layers.get(uv_name)
        if layer is None:
            raise RuntimeError(
                f"{obj.name}: minimum-footprint rescue requires a {uv_name} layer"
            )
        obj.data.calc_loop_triangles()
        polygon_indices = sorted({
            obj.data.loop_triangles[index].polygon_index
            for index in triangles
        })
        pinned = [
            polygon_index
            for polygon_index in polygon_indices
            if any(
                layer.data[index].pin_uv
                for index in obj.data.polygons[polygon_index].loop_indices
            )
        ]
        if pinned:
            detail = ", ".join(str(index) for index in pinned[:8])
            if len(pinned) > 8:
                detail += f", and {len(pinned) - 8} more"
            raise RuntimeError(
                f"{obj.name}: final atlas packing collapsed pinned polygon(s) "
                f"{detail} below float32 UV precision. Blendlink will not move "
                "artist-owned pins; enlarge those UV islands, increase atlas "
                "Resolution, reduce Padding, or unpin them"
            )
        prepared.append((obj, triangles, polygon_indices))

    target_inradius = (
        _TARGET_RESCUE_INRADIUS_DELIVERY_TEXELS
        / float(resolved_delivery_size)
    )
    reports = []
    for obj, triangles, expected_polygons in prepared:
        polygons = _regular_polygon_rescue_collapsed_atlas_polygons(
            obj, uv_name, triangles,
            minimum_triangle_inradius=target_inradius,
        )
        if polygons != expected_polygons:
            raise RuntimeError(
                f"{obj.name}: minimum-footprint rescue target changed during "
                "atlas preparation"
            )
        report = {
            "object": obj.name,
            "triangleCount": len(triangles),
            "rescuePolygonCount": len(polygons),
            "targetInradiusDeliveryTexels": (
                _TARGET_RESCUE_INRADIUS_DELIVERY_TEXELS
            ),
            "strategy": "sampleable-regular-polygon-rescue",
            "_object": obj,
            "_polygons": polygons,
        }
        reports.append(report)
        log(
            f"blendlink: final atlas packing found {len(triangles)} "
            f"precision-sensitive triangle(s) on {obj.name}; regularized "
            f"{len(polygons)} fully unpinned micro-polygon(s) for a "
            "one-delivery-texel minimum triangle inradius"
        )
    pack(
        objects, margin_px, size, pin=pin, guard_px=guard_px,
        group_receivers=group_receivers,
    )

    def measure() -> list[tuple[dict, float, int]]:
        return [
            (
                report,
                _minimum_uv_triangle_inradius(
                    report["_object"], uv_name, report["_polygons"],
                ) * resolved_delivery_size,
                _minimum_rescued_delivery_texel_centers(
                    report["_object"], uv_name, report["_polygons"],
                    resolved_delivery_size,
                ),
            )
            for report in reports
        ]

    measured = measure()
    retry = [
        (report, achieved, samples)
        for report, achieved, samples in measured
        if (
            achieved < _MINIMUM_PACKED_RESCUE_INRADIUS_DELIVERY_TEXELS
            or samples < 1
        )
    ]
    if retry:
        for report, achieved, samples in retry:
            if achieved <= 0.0:
                factor = 4.0
            else:
                factor = (
                    _TARGET_RESCUE_INRADIUS_DELIVERY_TEXELS / achieved
                ) * 1.05
            if samples < 1:
                factor = max(factor, 1.5)
            _regular_polygon_rescue_collapsed_atlas_polygons(
                report["_object"], uv_name,
                [
                    triangle.index
                    for triangle in report["_object"].data.loop_triangles
                    if triangle.polygon_index in set(report["_polygons"])
                ],
                minimum_triangle_inradius=target_inradius * factor,
            )
            report["adaptiveRepack"] = True
        pack(
            objects, margin_px, size, pin=pin, guard_px=guard_px,
            group_receivers=group_receivers,
        )
        measured = measure()

    failures = [
        (report, achieved, samples)
        for report, achieved, samples in measured
        if (
            achieved < _MINIMUM_PACKED_RESCUE_INRADIUS_DELIVERY_TEXELS
            or samples < 1
        )
    ]
    if failures:
        detail = "; ".join(
            f"{report['object']} achieved {achieved:.3g}px for "
            f"{report['rescuePolygonCount']} polygon(s), minimum "
            f"{samples} covered delivery texel center(s) per triangle"
            for report, achieved, samples in failures
        )
        raise RuntimeError(
            "atlas packing could not preserve a sampleable rescued UV "
            f"footprint after one adaptive repack: {detail}. Increase atlas "
            "Resolution, reduce Padding, simplify/apply the generating "
            "modifier, or keep the object Realtime"
        )

    public_reports = []
    for report, achieved, samples in measured:
        public = {
            key: value for key, value in report.items()
            if not key.startswith("_")
        }
        public["packedInradiusDeliveryTexels"] = achieved
        public["minimumCoveredDeliveryTexelCenters"] = samples
        public_reports.append(public)
    return public_reports


def pack_with_evaluated_uv_repair(
        objs, uv_name: str, scale_of, margin_px: int, size: int,
        held=None, pin: bool = False, log=print,
        delivery_size: int | None = None,
        guard_px: int = 4,
        world_linear_repairs: bool = False,
        chart_shape: str | None = None,
        caller_proves_layout: bool = False) -> tuple[list[dict], dict]:
    """Pack, repair float32 UV collapse, and repack with bounded fallbacks.

    Modifier-created triangles are repaired before packing by
    :func:`repair_evaluated_atlas_uvs`, but a valid extremely thin triangle can
    still collapse after Blender scales and translates a large multi-object
    atlas. UV layers are float32, so a small coordinate delta that is distinct
    near zero may become identical after the packed island moves into 0..1.

    A fully unpinned affected object may be Smart Projected as a whole. The
    complete atlas is then averaged, artist/automatic weights are reapplied,
    and every object is repacked; repairing only one island in place would
    overlap its neighbours. Pinned artist layouts retain their existing loud
    refusal. If density normalization still reduces valid micro-polygons below
    float32 precision, one final bounded repair regularizes only those
    polygons to a sampleable delivery-texel footprint and packs again without
    re-averaging. One adaptive enlargement is allowed; a collapse after that
    is a geometry/layout problem, not a reason to mutate UVs indefinitely.

    Returns ``(repair_reports, held_masks)`` so callers retain the exact pinned
    masks produced by the final averaging pass.
    """
    objects = [obj for obj in objs if len(obj.data.polygons) > 0]
    current_held = dict(held or {})
    resolved_delivery_size = size if delivery_size is None else delivery_size
    if (
        resolved_delivery_size <= 0
        or resolved_delivery_size > size
    ):
        raise ValueError(
            "evaluated UV repair requires a positive delivery size no larger "
            "than the effective pack size"
        )

    def scale_and_pack() -> None:
        scale_islands(objects, uv_name, scale_of, held=current_held)
        pack(
            objects, margin_px, size, pin=pin, guard_px=guard_px,
            group_receivers=not current_held,
            chart_shape=chart_shape,
        )

    scale_and_pack()
    repairs = repair_evaluated_atlas_uvs(
        objects,
        uv_name,
        log=log,
        world_linear=world_linear_repairs,
    )
    if repairs:
        current_held = average_unpinned(objects, uv_name)
        scale_and_pack()

    remaining = []
    for obj in sorted(objects, key=lambda item: item.name):
        triangles = sorted(set(
            _precision_sliver_unsampleable_uv_triangles(
                obj, uv_name, resolved_delivery_size,
            )
            + _mixed_zero_world_area_polygon_triangles(obj)
        ))
        if triangles:
            remaining.append((obj, triangles))
    if remaining:
        repairs.extend(_minimum_footprint_rescue_and_repack(
            objects, remaining, uv_name, margin_px, size,
            delivery_size=delivery_size, pin=pin,
            guard_px=guard_px, group_receivers=not current_held, log=log,
        ))
        remaining = []
        for obj in sorted(objects, key=lambda item: item.name):
            triangles = _precision_sliver_unsampleable_uv_triangles(
                obj, uv_name, resolved_delivery_size,
            )
            if triangles:
                remaining.append((obj, triangles))
    if remaining:
        detail = "; ".join(
            f"{obj.name} ({len(triangles)} triangle(s), first {triangles[0]})"
            for obj, triangles in remaining
        )
        raise RuntimeError(
            f"atlas packing produced non-zero surface triangles without a "
            f"delivery texel-center sample in {uv_name} after whole-object "
            f"repair and a bounded "
            f"sampleability rescue/repack: {detail}. "
            "Apply or simplify the generating modifier, repair the source UVs, "
            "or keep the object Realtime"
        )
    # This is the ONLY post-pack bleed/bounds proof the atlas callers have,
    # so it runs for every unpinned pack whatever the receiver count. The
    # single caller that may skip it says so explicitly and runs its own
    # complete geometric proof over the same layout immediately afterward.
    if not current_held and not caller_proves_layout:
        validate_receiver_group_spacing(
            objects, margin_px, size, guard_px=guard_px,
        )
    return repairs, current_held


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
# Geometry preparation and native object-context baking
# --------------------------------------------------------------------------

def configure_combined_bake(
        scene, margin_px: int, *, emit: bool = True,
        view_from: str = "ABOVE_SURFACE") -> None:
    """Canonical COMBINED-bake RNA shared by fingerprints and execution.

    Blender keeps these values mutable on the Scene. A rebuilt earlier job (or
    a denoise guide) must not change a later job's dependency fingerprint
    compared with the same earlier job being reused.
    """
    bake = scene.render.bake
    bake.use_clear = True
    bake.margin = int(margin_px)
    bake.margin_type = "EXTEND"
    bake.use_selected_to_active = False
    bake.use_cage = False
    bake.cage_extrusion = 0.0
    bake.max_ray_distance = 0.0
    bake.use_pass_color = True
    for flag in (
        "use_pass_direct", "use_pass_indirect", "use_pass_diffuse",
        "use_pass_glossy", "use_pass_transmission",
    ):
        setattr(bake, flag, True)
    bake.use_pass_emit = bool(emit)
    if view_from not in {"ABOVE_SURFACE", "ACTIVE_CAMERA"}:
        raise ValueError(f"unsupported Cycles bake view origin {view_from!r}")
    if not hasattr(bake, "view_from"):
        if view_from == "ACTIVE_CAMERA":
            raise RuntimeError(
                "this Blender build cannot bake from the active camera; keep the "
                "view-dependent object Realtime or use Blender 4.2+"
            )
    else:
        bake.view_from = view_from
    # Guide bakes set this to OBJECT. It is irrelevant to COMBINED, but still
    # part of Blender's RNA and therefore needs one deterministic value.
    bake.normal_space = "OBJECT"


def configure_lighting_bake(scene, margin_px: int) -> None:
    """Canonical material-independent irradiance bake settings.

    A ``lighting`` atlas is multiplied with the authored PBR material in the
    website. Baking surface color into it would therefore tint the material
    twice, while baking direct light would make the result fight any realtime
    key/fill lights. Cycles' DIFFUSE pass with *only* Indirect enabled is the
    portable contract: direct=False, color=False, indirect=True.

    Keep this beside ``configure_combined_bake`` because these RNA values are
    both execution state and incremental-cache input. Callers must configure
    the intended output before fingerprinting and again before baking.
    """
    bake = scene.render.bake
    bake.use_clear = True
    bake.margin = int(margin_px)
    bake.margin_type = "EXTEND"
    bake.use_selected_to_active = False
    bake.use_cage = False
    bake.cage_extrusion = 0.0
    bake.max_ray_distance = 0.0
    bake.use_pass_direct = False
    bake.use_pass_indirect = True
    bake.use_pass_color = False
    # These flags do not alter a DIFFUSE bake, but deterministic values keep
    # fingerprints independent of whichever bake an artist ran previously.
    bake.use_pass_diffuse = True
    bake.use_pass_glossy = False
    bake.use_pass_transmission = False
    bake.use_pass_emit = False
    if hasattr(bake, "view_from"):
        bake.view_from = "ABOVE_SURFACE"
    bake.normal_space = "OBJECT"


def configure_normal_bake(scene, margin_px: int) -> None:
    """Canonical tangent-space NORMAL bake RNA for the Material bake.

    glTF normal maps are tangent-space with +Y green (OpenGL), which is
    Blender's POS_X/POS_Y/POS_Z swizzle.  The tangent basis follows the bake
    UV layer, so the exporter must ship tangents computed against the same
    layer.  Keep this beside the other configure functions: these RNA values
    are both execution state and incremental-cache input.
    """
    bake = scene.render.bake
    bake.use_clear = True
    bake.margin = int(margin_px)
    bake.margin_type = "EXTEND"
    bake.use_selected_to_active = False
    bake.use_cage = False
    bake.cage_extrusion = 0.0
    bake.max_ray_distance = 0.0
    # Pass flags do not alter a NORMAL bake; deterministic values keep
    # fingerprints independent of whichever bake ran previously.
    bake.use_pass_direct = False
    bake.use_pass_indirect = False
    bake.use_pass_color = False
    bake.use_pass_diffuse = False
    bake.use_pass_glossy = False
    bake.use_pass_transmission = False
    bake.use_pass_emit = False
    if hasattr(bake, "view_from"):
        bake.view_from = "ABOVE_SURFACE"
    bake.normal_space = "TANGENT"
    bake.normal_r = "POS_X"
    bake.normal_g = "POS_Y"
    bake.normal_b = "POS_Z"


def configure_emit_bake(
        scene, margin_px: int, *, view_from: str = "ABOVE_SURFACE") -> None:
    """Canonical deterministic RNA for a selected intrinsic EMIT field.

    ``view_from="ACTIVE_CAMERA"`` casts the bake rays from the scene camera
    so view-dependent inputs (Fresnel, Layer Weight) evaluate for one
    authored view — the reference mechanism of the TSL view-dependent
    differential cells.
    """
    bake = scene.render.bake
    bake.use_clear = True
    bake.margin = int(margin_px)
    bake.margin_type = "EXTEND"
    bake.use_selected_to_active = False
    bake.use_cage = False
    bake.cage_extrusion = 0.0
    bake.max_ray_distance = 0.0
    bake.use_pass_direct = False
    bake.use_pass_indirect = False
    bake.use_pass_color = False
    bake.use_pass_diffuse = False
    bake.use_pass_glossy = False
    bake.use_pass_transmission = False
    bake.use_pass_emit = True
    if view_from not in {"ABOVE_SURFACE", "ACTIVE_CAMERA"}:
        raise ValueError(f"unsupported Cycles bake view origin {view_from!r}")
    if not hasattr(bake, "view_from"):
        if view_from == "ACTIVE_CAMERA":
            raise RuntimeError(
                "this Blender build cannot bake from the active camera"
            )
    else:
        bake.view_from = view_from
    bake.normal_space = "OBJECT"


def bake_objects_to_image(
        objs, image, *, bake_type: str, margin_px: int,
        uv_layer: str = ATLAS_UV,
        default_material_name: str = "BLENDLINK_DEFAULT_SURFACE",
        log=print) -> None:
    """Bake many real mesh objects into one image without joining them.

    Blender's bake operator clears every tagged target image once, then calls
    the render engine once per selected object and merges each result through
    that object's pixel mask. This is the correctness seam used by Needle's
    lightmapper: Shader Attribute (Object), Object Info, Generated/Object
    coordinates, object transforms, and other per-object shader inputs keep
    their native Blender evaluation context.

    A joined mesh cannot preserve that contract in general. ID properties and
    Object Info collapse to the active object; Generated coordinates acquire a
    new shared bounding box; instancer behavior cannot be represented by a few
    copied vertex attributes. Keep joining as a geometry utility only, never as
    the semantic bake default.

    Target image nodes and neutral replacements for empty material slots are
    temporary. Node selection, active nodes, material slots, object selection,
    and the active object are restored even when Cycles fails. The artist's
    material graph is not copied, rewritten, or left with exporter nodes.
    """
    objects = [] if objs is None else list(objs)
    unique = []
    seen = set()
    for obj in objects:
        pointer = obj.as_pointer()
        if pointer in seen:
            continue
        seen.add(pointer)
        unique.append(obj)
    objects = unique
    if not objects:
        raise RuntimeError("native object-context bake needs at least one mesh object")
    invalid = [
        f"{obj.name} ({getattr(obj, 'type', '<unknown>')})"
        for obj in objects
        if getattr(obj, "type", None) != "MESH"
        or len(getattr(getattr(obj, "data", None), "polygons", ())) == 0
    ]
    if invalid:
        raise RuntimeError(
            "native object-context bake received non-mesh or empty targets: "
            + ", ".join(invalid)
        )
    missing_uv = [
        obj.name for obj in objects if obj.data.uv_layers.get(uv_layer) is None
    ]
    if missing_uv:
        raise RuntimeError(
            f"native object-context bake needs UV layer {uv_layer!r} on: "
            + ", ".join(sorted(missing_uv))
        )
    if bake_type not in {"COMBINED", "DIFFUSE", "EMIT", "NORMAL"}:
        raise ValueError(f"unsupported Blendlink bake pass {bake_type!r}")
    if int(margin_px) < 0:
        raise ValueError(f"bake margin cannot be negative: {margin_px}")
    if image is None or min(tuple(getattr(image, "size", (0, 0)))) <= 0:
        raise RuntimeError("native object-context bake needs an initialized target image")

    selected_before = list(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active
    material_states = {}
    slot_states = []
    material_lengths = {}
    default_material = None
    interaction_states = []
    collection_view_states = []
    layer_collection_view_states = []

    def neutral_material():
        nonlocal default_material
        if default_material is None:
            default_material = bpy.data.materials.new(
                f"{default_material_name}.BLENDLINK_BAKE_TARGET"
            )
            default_material["blendlink_bake_target_material"] = True
        return default_material

    def prepare_material(material):
        pointer = material.as_pointer()
        if pointer in material_states:
            return
        legacy_use_nodes = None
        if tuple(bpy.app.version) < (5, 0, 0):
            legacy_use_nodes = bool(getattr(material, "use_nodes", False))
        tree = ensure_shader_node_tree(material)
        nodes = tree.nodes
        previous_active = nodes.active
        previous_selection = [(node, bool(node.select)) for node in nodes]
        for node in nodes:
            node.select = False
        target = nodes.new("ShaderNodeTexImage")
        target.name = "BLENDLINK_BAKE_TARGET"
        target.label = "Blendlink temporary bake target"
        target.image = image
        target.select = True
        nodes.active = target
        material_states[pointer] = {
            "material": material,
            "tree": tree,
            "target": target,
            "active": previous_active,
            "selection": previous_selection,
            "legacyUseNodes": legacy_use_nodes,
        }

    try:
        # Viewport-only visibility and selection locks do not change Blender's
        # render result, but they prevent bpy.ops.object.bake from selecting an
        # otherwise valid receiver. Needle omits those objects; Blendlink keeps
        # render truth by temporarily exposing them and restoring the exact
        # artist interaction state after both success and failure.
        scene_collections = [bpy.context.scene.collection]
        scene_collections.extend(bpy.context.scene.collection.children_recursive)
        for collection in scene_collections:
            collection_view_states.append(
                (collection, bool(collection.hide_viewport))
            )
            collection.hide_viewport = False

        layer_stack = [bpy.context.view_layer.layer_collection]
        while layer_stack:
            layer_collection = layer_stack.pop()
            layer_collection_view_states.append(
                (layer_collection, bool(layer_collection.hide_viewport))
            )
            layer_collection.hide_viewport = False
            layer_stack.extend(layer_collection.children)

        for obj in objects:
            state = (
                obj,
                bool(obj.hide_select),
                bool(obj.hide_viewport),
                bool(obj.hide_get(view_layer=bpy.context.view_layer)),
            )
            interaction_states.append(state)
            obj.hide_select = False
            obj.hide_viewport = False
            obj.hide_set(False, view_layer=bpy.context.view_layer)

        for obj in objects:
            materials = obj.data.materials
            if len(materials) == 0:
                pointer = obj.data.as_pointer()
                material_lengths.setdefault(pointer, (obj.data, 0))
                materials.append(neutral_material())
            for slot in obj.material_slots:
                if slot.material is None:
                    slot_states.append((slot, None))
                    slot.material = neutral_material()
                prepare_material(slot.material)

        select_only(objects)
        selected = {obj.as_pointer() for obj in bpy.context.selected_objects}
        unselectable = [obj.name for obj in objects if obj.as_pointer() not in selected]
        if unselectable:
            raise RuntimeError(
                "native object-context bake targets are outside the active view layer: "
                + ", ".join(sorted(unselectable))
            )
        log(
            f"blendlink bake: preserving native shader context across "
            f"{len(objects)} object(s) in one shared {image.size[0]}x{image.size[1]} atlas"
        )
        result = bpy.ops.object.bake(
            type=bake_type,
            target="IMAGE_TEXTURES",
            margin=int(margin_px),
            margin_type="EXTEND",
            use_clear=True,
            uv_layer=uv_layer,
        )
        if "FINISHED" not in result:
            raise RuntimeError(
                f"Cycles cancelled the {bake_type} bake for "
                + ", ".join(obj.name for obj in objects)
            )
    finally:
        for state in reversed(list(material_states.values())):
            nodes = state["tree"].nodes
            target = state["target"]
            if target in nodes.values():
                nodes.remove(target)
            for node, selected in state["selection"]:
                node.select = selected
            nodes.active = state["active"]
            if state["legacyUseNodes"] is not None:
                state["material"].use_nodes = state["legacyUseNodes"]
        for slot, material in reversed(slot_states):
            slot.material = material
        for mesh, original_length in reversed(list(material_lengths.values())):
            while len(mesh.materials) > original_length:
                mesh.materials.pop(index=len(mesh.materials) - 1)
        if (default_material is not None and default_material.users == 0
                and default_material.name in bpy.data.materials):
            bpy.data.materials.remove(default_material)
        select_only(selected_before)
        if (active_before is not None
                and bpy.context.view_layer.objects.get(active_before.name) is active_before):
            bpy.context.view_layer.objects.active = active_before
        else:
            bpy.context.view_layer.objects.active = None
        for obj, hide_select, hide_viewport, hidden_in_view_layer in reversed(
                interaction_states):
            obj.hide_set(hidden_in_view_layer, view_layer=bpy.context.view_layer)
            obj.hide_viewport = hide_viewport
            obj.hide_select = hide_select
        for layer_collection, hide_viewport in reversed(layer_collection_view_states):
            layer_collection.hide_viewport = hide_viewport
        for collection, hide_viewport in reversed(collection_view_states):
            collection.hide_viewport = hide_viewport


# --- MTL-BAKE-001: per-channel Material bake primitives ----------------------
#
# A Material bake captures a material's individual input channels — base
# color, metallic, roughness, normal, emission, alpha — into images so the
# result stays ordinary lit glTF pbrMetallicRoughness.  The compiler owns
# graph semantics (which socket, which proxy material); these primitives own
# bake mechanics: isolation, coverage proof, colorspace-correct saves, the
# tangent NORMAL pass, ORM packing, and the disposable tile proxy.

_ISOLATED_BAKE_CYCLES_NAMES = (
    "samples", "use_denoising", "use_adaptive_sampling",
    "adaptive_threshold", "seed", "use_animated_seed", "use_auto_tile",
)
_ISOLATED_BAKE_RNA_NAMES = (
    "use_clear", "margin", "margin_type", "use_selected_to_active",
    "use_cage", "cage_extrusion", "max_ray_distance",
    "use_pass_direct", "use_pass_indirect", "use_pass_color",
    "use_pass_diffuse", "use_pass_glossy", "use_pass_transmission",
    "use_pass_emit", "view_from", "normal_space",
    "normal_r", "normal_g", "normal_b",
)


def _snapshot_isolated_bake_rna(scene):
    """Capture engine + Cycles + bake RNA around an isolated channel bake."""
    render = scene.render
    cycles = getattr(scene, "cycles", None)
    if cycles is None:
        raise RuntimeError("Cycles settings are unavailable in this Blender build")
    bake = render.bake
    return {
        "engine": render.engine,
        "cycles": {
            name: getattr(cycles, name)
            for name in _ISOLATED_BAKE_CYCLES_NAMES if hasattr(cycles, name)
        },
        "bake": {
            name: getattr(bake, name)
            for name in _ISOLATED_BAKE_RNA_NAMES if hasattr(bake, name)
        },
    }


def _force_isolated_bake_determinism(scene):
    """One sample, no denoise/adaptive/tiling, seed zero: an isolated channel
    bake is a pure function of the graph, never of sampling luck."""
    render = scene.render
    cycles = scene.cycles
    render.engine = "CYCLES"
    cycles.samples = 1
    if hasattr(cycles, "use_denoising"):
        cycles.use_denoising = False
    if hasattr(cycles, "use_adaptive_sampling"):
        cycles.use_adaptive_sampling = False
    if hasattr(cycles, "seed"):
        cycles.seed = 0
    if hasattr(cycles, "use_animated_seed"):
        cycles.use_animated_seed = False
    if hasattr(cycles, "use_auto_tile"):
        cycles.use_auto_tile = False


def _restore_isolated_bake_rna(scene, saved, cleanup_errors):
    """Restore what ``_snapshot_isolated_bake_rna`` captured."""
    render = scene.render
    cycles = getattr(scene, "cycles", None)
    bake = render.bake
    for name, value in saved["bake"].items():
        try:
            setattr(bake, name, value)
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            cleanup_errors.append(f"bake setting {name}: {error}")
    for name, value in saved["cycles"].items():
        try:
            setattr(cycles, name, value)
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            cleanup_errors.append(f"Cycles setting {name}: {error}")
    try:
        render.engine = saved["engine"]
    except (AttributeError, RuntimeError, TypeError, ValueError) as error:
        cleanup_errors.append(f"render engine: {error}")


def _bake_isolated_field_pixels(
        objs, *, size: int, margin_px: int, uv_layer: str,
        label: str, log=print, bake_type: str = "EMIT",
        view_from: str = "ABOVE_SURFACE",
        configure=None) -> dict:
    """Coverage-proved isolated bake to float pixels with exact restoration.

    Callers own graph semantics and must install their private material
    before entering.  This core owns Cycles/device/bake RNA, the separate
    constant-white EMIT coverage pass Blender 5.2 requires, finite-value
    validation, and cleanup.  It returns float RGB pixels plus the proved
    coverage so composed channel packs (ORM) can bake several scalars and
    save once.
    """
    objects = list(objs or ())
    resolution = int(size)
    margin = int(margin_px)
    if resolution < 16 or resolution > 4096 or resolution & (resolution - 1):
        raise ValueError(
            f"{label}: texture size must be a power of two from 16..4096, "
            f"got {size}"
        )
    if margin < 0:
        raise ValueError(f"{label}: bake margin cannot be negative: {margin_px}")
    if not objects:
        raise RuntimeError(f"{label}: isolated bake needs one private receiver")

    import numpy as np

    scene = bpy.context.scene
    saved = _snapshot_isolated_bake_rna(scene)
    device_state = snapshot_cycles_compute_state(scene)
    target = None
    coverage_target = None
    coverage_material = None
    slots = []
    device = {"deviceClass": "cpu", "backend": "cpu"}
    result = None
    primary_error = None
    cleanup_errors = []
    try:
        _force_isolated_bake_determinism(scene)
        configure_emit_bake(scene, margin, view_from=view_from)
        device = configure_cycles_compute_device(
            scene, log=log, restore_state=device_state, purpose=label,
        )

        coverage_target = bpy.data.images.new(
            "BLENDLINK_CHANNEL_FIELD_COVERAGE",
            width=resolution, height=resolution,
            alpha=True, float_buffer=True,
        )
        coverage_target.generated_color = (0.0, 0.0, 0.0, 0.0)
        coverage_material = bpy.data.materials.new(
            "BLENDLINK_CHANNEL_FIELD_COVERAGE"
        )
        tree = ensure_shader_node_tree(coverage_material)
        tree.nodes.clear()
        output_node = tree.nodes.new("ShaderNodeOutputMaterial")
        emission = tree.nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        emission.inputs["Strength"].default_value = 1.0
        tree.links.new(
            emission.outputs["Emission"], output_node.inputs["Surface"],
        )
        for obj in objects:
            for slot in obj.material_slots:
                slots.append((slot, slot.link, slot.material))
                slot.link = "DATA"
                slot.material = coverage_material
        bake_objects_to_image(
            objects, coverage_target, bake_type="EMIT",
            margin_px=margin, uv_layer=uv_layer, log=log,
        )
        coverage = image_signal_coverage(coverage_target, f"{label} coverage")
        for slot, link, material in reversed(slots):
            slot.link = link
            slot.material = material
        slots.clear()

        if bake_type != "EMIT":
            if configure is None:
                raise ValueError(
                    f"{label}: non-EMIT bake {bake_type!r} needs its canonical "
                    "configure function"
                )
            configure(scene, margin)
        target = bpy.data.images.new(
            "BLENDLINK_CHANNEL_FIELD_FLOAT",
            width=resolution, height=resolution,
            alpha=True, float_buffer=True,
        )
        target.generated_color = (0.0, 0.0, 0.0, 0.0)
        bake_objects_to_image(
            objects, target, bake_type=bake_type,
            margin_px=margin, uv_layer=uv_layer, log=log,
        )
        pixels = np.empty(resolution * resolution * 4, dtype=np.float32)
        target.pixels.foreach_get(pixels)
        rgb = pixels.reshape(resolution, resolution, 4)[:, :, :3].copy()
        covered = rgb[coverage]
        if len(covered) == 0:
            raise RuntimeError(
                f"{label}: isolated bake produced no covered RGB samples"
            )
        if not np.isfinite(covered).all():
            raise RuntimeError(
                f"{label}: isolated bake contains NaN or infinite covered "
                "RGB values"
            )
        result = {
            "pixels": rgb,
            "coverage": coverage,
            "rgbMin": tuple(float(value) for value in covered.min(axis=0)),
            "rgbMax": tuple(float(value) for value in covered.max(axis=0)),
            "deviceClass": device["deviceClass"],
            "backend": device["backend"],
        }
    except BaseException as error:
        primary_error = error
    finally:
        for slot, link, material in reversed(slots):
            try:
                slot.link = link
                slot.material = material
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                cleanup_errors.append(f"coverage material binding: {error}")
        for image in (coverage_target, target):
            if image is None:
                continue
            try:
                if bpy.data.images.get(image.name) is image:
                    bpy.data.images.remove(image)
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                cleanup_errors.append(f"temporary bake image: {error}")
        if coverage_material is not None:
            try:
                if bpy.data.materials.get(coverage_material.name) is coverage_material:
                    bpy.data.materials.remove(coverage_material, do_unlink=True)
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                cleanup_errors.append(f"coverage material: {error}")
        try:
            restore_cycles_compute_state(device_state)
        except BaseException as error:
            cleanup_errors.append(f"Cycles compute device: {error}")
        _restore_isolated_bake_rna(scene, saved, cleanup_errors)
    if cleanup_errors:
        cleanup_error = RuntimeError(
            f"{label}: isolated bake could not restore Blender state: "
            + "; ".join(cleanup_errors)
        )
        if primary_error is not None:
            raise cleanup_error from primary_error
        raise cleanup_error
    if primary_error is not None:
        raise primary_error.with_traceback(primary_error.__traceback__)
    if result is None:
        raise RuntimeError(f"{label}: isolated bake produced no result")
    return result


def save_channel_png(
        pixels, coverage, path: str, *, colorspace: str, alpha=None,
        label: str = "material channel") -> dict:
    """Save composed float channel pixels through the canonical private save.

    ``colorspace`` is ``srgb`` for color the runtime decodes (base color,
    emissive) or ``data`` for linearly sampled channels (ORM, tangent
    normals) whose PNG bytes must equal the values.  ``alpha`` is the baked
    alpha plane riding a base-color carrier: it switches the file to RGBA and
    flattens the uncovered background in-buffer (mean covered RGB, alpha 0),
    because ``flatten_saved_background`` would force the whole file opaque.
    """
    import numpy as np

    output = os.path.abspath(path)
    directory = os.path.dirname(output)
    if not directory or not os.path.isdir(directory):
        raise FileNotFoundError(
            f"{label}: channel output directory does not exist: {directory}"
        )
    if colorspace not in {"srgb", "data"}:
        raise ValueError(f"{label}: unsupported channel colorspace {colorspace!r}")
    rgb = np.asarray(pixels, dtype=np.float32)
    if rgb.ndim != 3 or rgb.shape[2] != 3 or rgb.shape[0] != rgb.shape[1]:
        raise ValueError(
            f"{label}: channel pixels must be square (H, W, 3), got {rgb.shape!r}"
        )
    resolution = int(rgb.shape[0])
    if alpha is not None:
        alpha_plane = np.asarray(alpha, dtype=np.float32)
        if alpha_plane.shape != (resolution, resolution):
            raise ValueError(
                f"{label}: alpha plane is {alpha_plane.shape!r}, expected "
                f"{(resolution, resolution)!r}"
            )
        covered = np.asarray(coverage, dtype=bool)
        if covered.shape != (resolution, resolution):
            raise ValueError(
                f"{label}: coverage is {covered.shape!r}, expected "
                f"{(resolution, resolution)!r}"
            )
        composed = np.empty((resolution, resolution, 4), dtype=np.float32)
        composed[:, :, :3] = rgb
        composed[:, :, 3] = alpha_plane
        covered_count = int(covered.sum())
        if covered_count == 0:
            raise RuntimeError(
                f"{label}: an alpha-carrying channel save needs covered texels"
            )
        if covered_count < covered.size:
            mean = np.round(
                composed[:, :, :3][covered].mean(axis=0) * 255.0
            ) / 255.0
            composed[:, :, :3][~covered] = mean
            composed[:, :, 3][~covered] = 0.0
        stage = bpy.data.images.new(
            "BLENDLINK_CHANNEL_SAVE_STAGE",
            width=resolution, height=resolution,
            alpha=True, float_buffer=True,
        )
        try:
            stage.pixels.foreach_set(composed.reshape(-1))
            _save_render_with_private_scene(
                stage, output,
                file_format="PNG", color_mode="RGBA", color_depth="8",
                dither_intensity=1.0 if colorspace == "srgb" else 0.0,
                view_transform="Standard" if colorspace == "srgb" else "Raw",
            )
        finally:
            if bpy.data.images.get(stage.name) is stage:
                bpy.data.images.remove(stage)
    else:
        stage = bpy.data.images.new(
            "BLENDLINK_CHANNEL_SAVE_STAGE",
            width=resolution, height=resolution,
            alpha=True, float_buffer=True,
        )
        try:
            composed = np.empty((resolution, resolution, 4), dtype=np.float32)
            composed[:, :, :3] = rgb
            composed[:, :, 3] = 1.0
            stage.pixels.foreach_set(composed.reshape(-1))
            save_resolved(
                stage, output, resolution,
                denoise=False, delivery_sizes=[], coverage=coverage,
                data=(colorspace == "data"),
            )
        finally:
            if bpy.data.images.get(stage.name) is stage:
                bpy.data.images.remove(stage)
    if not os.path.isfile(output) or os.path.getsize(output) <= 0:
        raise RuntimeError(f"{label}: channel save produced no PNG: {output}")
    return {
        "path": output,
        "width": resolution,
        "height": resolution,
        "mime": "image/png",
        "colorspace": colorspace,
        "hasAlpha": alpha is not None,
        "sha256": file_sha256(output, length=64),
        "bytes": os.path.getsize(output),
    }


def bake_channel_field_pixels(
        objs, *, size: int, margin_px: int, uv_layer: str = ATLAS_UV,
        label: str = "material channel field", allow_hdr: bool = False,
        clamp_ldr: bool = False, view_from: str = "ABOVE_SURFACE",
        log=print) -> dict:
    """Bake one caller-installed private EMIT channel to float pixels.

    The Material bake composes several scalar channels into one packed PNG,
    so the float result and its proved coverage return to the caller instead
    of saving here.  Values must stay 0..1; ``allow_hdr`` (emission) reports
    the covered peak for ``KHR_materials_emissive_strength`` instead of
    refusing it.  ``clamp_ldr`` clamps an out-of-range LDR field into the
    carrier instead of refusing: Cycles renders Principled Base Color above
    1.0 unclamped (measured: (1.2, 2.0, 0.5) bakes ~(1.16, 1.93, 0.48) in
    the DIFFUSE color pass), so an 8-bit carrier of such a material cannot
    be exact — the clamped texture is the closest one it can hold.  This is
    a NAMED loss, not a lossless route: a TSL program may recover the exact
    field on the WebGPU family, but IR is opt-in, can be refused per
    channel, and never loads on WebGL, so the clamped carrier is what many
    viewers see.  ``result['clampedToCarrier']`` records the true measured
    range for any caller that publishes evidence.
    """
    result = _bake_isolated_field_pixels(
        objs, size=size, margin_px=margin_px, uv_layer=uv_layer,
        label=label, log=log, view_from=view_from,
    )
    minimum = result["rgbMin"]
    maximum = result["rgbMax"]
    peak = float(max(maximum))
    # A negative field is a graph defect, never a carrier-precision problem,
    # so it keeps refusing ahead of any clamp.
    if min(minimum) < -1.0e-6:
        raise RuntimeError(
            f"{label}: channel field contains negative values {minimum!r}"
        )
    if clamp_ldr and not allow_hdr and peak > 1.0 + 1.0e-6:
        import numpy as np
        log(
            f"blendlink: {label}: channel field range {minimum!r}.."
            f"{maximum!r} exceeds the 8-bit carrier; clamping the carrier "
            "to 0..1"
        )
        np.clip(result["pixels"], 0.0, 1.0, out=result["pixels"])
        # The measured range stays the truth the evidence publishes; the
        # clamp is recorded beside it so nothing reads a clamped carrier as
        # a faithful one.
        result["clampedToCarrier"] = {
            "measuredRgbMin": list(minimum),
            "measuredRgbMax": list(maximum),
        }
        maximum = tuple(min(max(float(v), 0.0), 1.0) for v in maximum)
        result["rgbMax"] = maximum
        peak = float(max(maximum))
    if not allow_hdr and peak > 1.0 + 1.0e-6:
        raise RuntimeError(
            f"{label}: channel field range {minimum!r}..{maximum!r} cannot be "
            "represented in an 8-bit glTF channel without clipping. Clamp or "
            "map the channel to 0..1 in Blender"
        )
    result["peak"] = peak
    return result


def bake_channel_field_to_png(
        objs, path: str, *, size: int, margin_px: int,
        uv_layer: str = ATLAS_UV, colorspace: str = "srgb",
        allow_hdr: bool = False, label: str = "material channel field",
        log=print) -> dict:
    """Bake and save one channel.  An HDR emissive field normalizes by its
    covered peak and reports the multiplier the compiler carries as
    ``KHR_materials_emissive_strength``; without it the values would clamp."""
    result = bake_channel_field_pixels(
        objs, size=size, margin_px=margin_px, uv_layer=uv_layer,
        label=label, allow_hdr=allow_hdr, log=log,
    )
    pixels = result["pixels"]
    strength = 1.0
    if allow_hdr and result["peak"] > 1.0 + 1.0e-6:
        strength = float(result["peak"])
        pixels = pixels / strength
    saved = save_channel_png(
        pixels, result["coverage"], path, colorspace=colorspace, label=label,
    )
    saved.update({
        "coveredFraction":
            float(result["coverage"].sum()) / float(result["coverage"].size),
        "rgbMin": result["rgbMin"],
        "rgbMax": result["rgbMax"],
        "emissiveStrength": strength,
        "deviceClass": result["deviceClass"],
        "backend": result["backend"],
    })
    return saved


def bake_tangent_normal_field_pixels(
        objs, *, size: int, margin_px: int, uv_layer: str = ATLAS_UV,
        label: str = "material normal channel", log=print) -> dict:
    """Tangent-space +Y NORMAL bake to float pixels.

    Unlike every other channel this pass evaluates the caller's installed
    material directly — Cycles resolves the shader's normal input chain —
    so the private proxy must keep only the Normal link and neutral
    defaults elsewhere.  The tangent basis follows the bake UV layer; the
    exporter must ship tangents computed against the same layer.
    """
    return _bake_isolated_field_pixels(
        objs, size=size, margin_px=margin_px, uv_layer=uv_layer,
        label=label, log=log,
        bake_type="NORMAL", configure=configure_normal_bake,
    )


def bake_tangent_normal_to_png(
        objs, path: str, *, size: int, margin_px: int,
        uv_layer: str = ATLAS_UV, label: str = "material normal channel",
        log=print) -> dict:
    """Bake and save one tangent-space normal channel as a raw data PNG."""
    result = bake_tangent_normal_field_pixels(
        objs, size=size, margin_px=margin_px, uv_layer=uv_layer,
        label=label, log=log,
    )
    saved = save_channel_png(
        result["pixels"], result["coverage"], path,
        colorspace="data", label=label,
    )
    saved.update({
        "coveredFraction":
            float(result["coverage"].sum()) / float(result["coverage"].size),
        "rgbMin": result["rgbMin"],
        "rgbMax": result["rgbMax"],
        "deviceClass": result["deviceClass"],
        "backend": result["backend"],
    })
    return saved


def compose_channel_pack_pixels(
        size: int, *, red=None, green=None, blue=None,
        fill=(1.0, 1.0, 1.0)):
    """Compose scalar channel planes into one packed RGB image.

    glTF ORM order: R=occlusion, G=roughness, B=metallic.  A missing plane
    takes its neutral fill so an absent occlusion bake stays a no-op white
    channel instead of darkening the material.
    """
    import numpy as np

    resolution = int(size)
    packed = np.empty((resolution, resolution, 3), dtype=np.float32)
    for index, plane in enumerate((red, green, blue)):
        if plane is None:
            packed[:, :, index] = float(fill[index])
            continue
        data = np.asarray(plane, dtype=np.float32)
        if data.shape != (resolution, resolution):
            raise ValueError(
                f"channel pack plane {index} is {data.shape!r}, expected "
                f"{(resolution, resolution)!r}"
            )
        packed[:, :, index] = data
    return packed


def uv_tile_proxy(
        uv_names, *, window=(0.0, 0.0, 1.0, 1.0),
        write_layer: str = "BLENDLINK_TILE_BAKE",
        name: str = "BLENDLINK_TILE_PROXY"):
    """Disposable unit quad whose named UV layers cover one UV-space window.

    A Tileable channel depends only on the mesh's own UVs, so its 0..1 tile
    bakes on this quad instead of the artist's mesh; baking a second integer
    window and comparing float results is the numeric period-1 gate that
    demotes a non-repeating graph to the Unique route.  Every referenced UV
    map name receives the window; the write layer stays identity 0..1 and is
    never active-render, or the graph would sample its own bake target
    coordinates.
    """
    u0, v0, u1, v1 = (float(item) for item in window)
    if not (u1 > u0 and v1 > v0):
        raise ValueError(f"tile proxy window must be positive, got {window!r}")
    names = [str(item) for item in uv_names if str(item)]
    if not names:
        names = ["BLENDLINK_TILE_SOURCE"]
    if write_layer in names:
        raise ValueError(
            f"tile proxy write layer {write_layer!r} collides with a "
            "referenced UV map name"
        )
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        ((-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (1.0, 1.0, 0.0), (-1.0, 1.0, 0.0)),
        (),
        ((0, 1, 2, 3),),
    )
    mesh.update()
    corners = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
    for uv_name in names:
        mesh.uv_layers.new(name=uv_name)
        # uv_layers.new invalidates held layer references; re-fetch by name.
        layer = mesh.uv_layers[uv_name]
        for loop_index, corner in enumerate(corners):
            layer.data[loop_index].uv = (
                u0 + corner[0] * (u1 - u0),
                v0 + corner[1] * (v1 - v0),
            )
    mesh.uv_layers.new(name=write_layer)
    write = mesh.uv_layers[write_layer]
    for loop_index, corner in enumerate(corners):
        write.data[loop_index].uv = corner
    source = mesh.uv_layers[names[0]]
    source.active_render = True
    mesh.uv_layers.active = source
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def remove_uv_tile_proxy(obj):
    """Remove a ``uv_tile_proxy`` object and its private mesh datablock."""
    if obj is None:
        return
    mesh = getattr(obj, "data", None)
    if bpy.data.objects.get(obj.name) is obj:
        bpy.data.objects.remove(obj, do_unlink=True)
    if mesh is not None and bpy.data.meshes.get(mesh.name) is mesh:
        bpy.data.meshes.remove(mesh)


# --- GEO-EVAL-001: evaluated-geometry realization primitives -----------------
#
# glTF has no strand, stroke, or particle primitive.  These primitives ask
# the depsgraph for the evaluated result and capture it as an ordinary Mesh
# datablock — through a disposable MESH host with an Object Info pull, so
# the artist's CURVES/Grease Pencil object is never mutated.  The exporter
# orchestrates naming, visibility, and restoration; budgets are deterministic
# functions of evaluated counts, never wall-clock.

# One realized strand segment extrudes the profile ring: two triangles per
# profile side.  Four sides is the smallest closed tube.
REALIZED_PROFILE_SIDES = 4
# Per-object ceiling, aligned with the mid-tier runtime triangle budget.
# Identical .blend files must not take different routes on faster machines.
MAX_REALIZED_TRIANGLES = 500_000

_REALIZE_KINDS = {"strands", "greasePencil"}


def estimate_realized_strand_triangles(
        curve_count: int, point_count: int,
        profile_sides: int = REALIZED_PROFILE_SIDES) -> int:
    """Deterministic triangle estimate for strand realization."""
    segments = max(int(point_count) - int(curve_count), 0)
    return segments * int(profile_sides) * 2


def _realize_geometry_node_group(source, kind: str, profile_sides: int):
    """Disposable GN tree: Object Info pull -> (GP to curves ->) tube mesh.

    The Curve to Mesh ``Scale`` input is wired to the ``radius`` attribute
    explicitly — Blender no longer applies curve radius implicitly — so hair
    and stroke widths survive realization.
    """
    tree = bpy.data.node_groups.new(
        f"BLENDLINK_REALIZE_{kind.upper()}", "GeometryNodeTree",
    )
    tree.interface.new_socket(
        "Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    group_out = tree.nodes.new("NodeGroupOutput")
    info = tree.nodes.new("GeometryNodeObjectInfo")
    info.inputs["Object"].default_value = source
    as_instance = next(
        (item for item in info.inputs if item.name == "As Instance"), None,
    )
    if as_instance is not None:
        as_instance.default_value = False
    circle = tree.nodes.new("GeometryNodeCurvePrimitiveCircle")
    circle.inputs["Resolution"].default_value = int(profile_sides)
    circle.inputs["Radius"].default_value = 1.0
    radius = tree.nodes.new("GeometryNodeInputNamedAttribute")
    radius.data_type = "FLOAT"
    radius.inputs["Name"].default_value = "radius"
    to_mesh = tree.nodes.new("GeometryNodeCurveToMesh")
    geometry = info.outputs["Geometry"]
    if kind == "greasePencil":
        convert = tree.nodes.new("GeometryNodeGreasePencilToCurves")
        realize = tree.nodes.new("GeometryNodeRealizeInstances")
        tree.links.new(geometry, convert.inputs[0])
        tree.links.new(convert.outputs[0], realize.inputs[0])
        geometry = realize.outputs[0]
    tree.links.new(geometry, to_mesh.inputs["Curve"])
    tree.links.new(circle.outputs["Curve"], to_mesh.inputs["Profile Curve"])
    tree.links.new(radius.outputs["Attribute"], to_mesh.inputs["Scale"])
    tree.links.new(to_mesh.outputs["Mesh"], group_out.inputs["Geometry"])
    return tree


def realize_object_to_mesh_data(
        source, *, kind: str, label: str,
        profile_sides: int = REALIZED_PROFILE_SIDES, log=print):
    """Capture one object's evaluated strand/stroke geometry as a Mesh.

    Returns a caller-owned Mesh datablock in the source's local space.  The
    source object is read, never written; every disposable host, modifier,
    and node group is removed on success and failure alike.
    """
    if kind not in _REALIZE_KINDS:
        raise ValueError(f"{label}: unsupported realization kind {kind!r}")
    tree = None
    host = None
    host_mesh = None
    realized = None
    try:
        tree = _realize_geometry_node_group(source, kind, profile_sides)
        host_mesh = bpy.data.meshes.new(f"BLENDLINK_REALIZE_HOST.{source.name}")
        host = bpy.data.objects.new(
            f"BLENDLINK_REALIZE_HOST.{source.name}", host_mesh,
        )
        bpy.context.scene.collection.objects.link(host)
        modifier = host.modifiers.new("BLENDLINK_REALIZE", "NODES")
        modifier.node_group = tree
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = host.evaluated_get(depsgraph)
        realized = bpy.data.meshes.new_from_object(
            evaluated, preserve_all_data_layers=True, depsgraph=depsgraph,
        )
        if len(realized.polygons) == 0:
            raise RuntimeError(
                f"{label}: evaluated realization produced no renderable "
                "polygons"
            )
        realized.name = f"{source.name} Realized"
        log(
            f"blendlink realize: {label} -> "
            f"{len(realized.vertices)} vertices, "
            f"{len(realized.polygons)} polygons"
        )
        return realized
    except BaseException:
        if realized is not None and bpy.data.meshes.get(realized.name) is realized:
            bpy.data.meshes.remove(realized)
        raise
    finally:
        if host is not None and bpy.data.objects.get(host.name) is host:
            bpy.data.objects.remove(host, do_unlink=True)
        if host_mesh is not None and bpy.data.meshes.get(host_mesh.name) is host_mesh:
            bpy.data.meshes.remove(host_mesh)
        if tree is not None and tree.name in bpy.data.node_groups:
            bpy.data.node_groups.remove(tree)


def build_particle_strand_curves(emitter, system_name: str, *, label: str):
    """Temporary Curves datablock from evaluated legacy HAIR/PATH parents.

    Positions come from the evaluated system's ``hair_keys`` in emitter
    local space, with a linear root-to-tip radius taper from the particle
    settings.  The caller owns the returned datablock and wraps it in a
    disposable source object for ``realize_object_to_mesh_data``.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = emitter.evaluated_get(depsgraph)
    ev_system = next(
        (item for item in evaluated.particle_systems
         if item.name == system_name),
        None,
    )
    if ev_system is None:
        raise RuntimeError(
            f"{label}: evaluated particle system {system_name!r} disappeared"
        )
    particles = [
        particle for particle in ev_system.particles
        if len(particle.hair_keys) >= 2
    ]
    if not particles:
        raise RuntimeError(
            f"{label}: evaluated particle system {system_name!r} has no "
            "hair keys to realize"
        )
    settings = ev_system.settings
    scale = float(getattr(settings, "radius_scale", 0.01))
    root = float(getattr(settings, "root_radius", 1.0)) * scale * 0.5
    tip = float(getattr(settings, "tip_radius", 0.0)) * scale * 0.5
    if root <= 0.0:
        root = 0.005
    curves = bpy.data.hair_curves.new(f"BLENDLINK_REALIZE_STRANDS.{label}")
    curves.add_curves([len(particle.hair_keys) for particle in particles])
    index = 0
    for particle in particles:
        keys = particle.hair_keys
        last = len(keys) - 1
        for key_index, key in enumerate(keys):
            point = curves.points[index]
            point.position = tuple(key.co)
            fraction = key_index / last if last else 0.0
            point.radius = root + (tip - root) * fraction
            index += 1
    return curves


def remove_particle_strand_curves(curves):
    """Remove a ``build_particle_strand_curves`` datablock."""
    if curves is not None and bpy.data.hair_curves.get(curves.name) is curves:
        bpy.data.hair_curves.remove(curves)


def bake_emit_field_to_png(
        objs, path: str, *, size: int, margin_px: int,
        uv_layer: str = ATLAS_UV, label: str = "selected material field",
        log=print) -> dict:
    """Bake one already-private intrinsic field to a restored sRGB PNG.

    Callers own graph semantics and must install a private Emission material
    before entering. This primitive owns Cycles/device/bake RNA, the separate
    white coverage pass required by Blender 5.2, unit-range validation,
    canonical Standard/None/0 save, and exact cleanup.
    """
    objects = list(objs or ())
    resolution = int(size)
    margin = int(margin_px)
    if resolution < 128 or resolution > 4096 or resolution & (resolution - 1):
        raise ValueError(
            f"selected-field texture size must be a power of two from 128..4096, got {size}"
        )
    if margin < 0:
        raise ValueError(f"selected-field bake margin cannot be negative: {margin_px}")
    output = os.path.abspath(path)
    directory = os.path.dirname(output)
    if not directory or not os.path.isdir(directory):
        raise FileNotFoundError(
            f"selected-field texture output directory does not exist: {directory}"
        )
    if not objects:
        raise RuntimeError("selected-field materialization needs one private receiver")

    scene = bpy.context.scene
    render = scene.render
    cycles = getattr(scene, "cycles", None)
    if cycles is None:
        raise RuntimeError("Cycles settings are unavailable in this Blender build")
    bake = render.bake
    cycle_names = (
        "samples", "use_denoising", "use_adaptive_sampling",
        "adaptive_threshold", "seed", "use_animated_seed", "use_auto_tile",
    )
    bake_names = (
        "use_clear", "margin", "margin_type", "use_selected_to_active",
        "use_cage", "cage_extrusion", "max_ray_distance",
        "use_pass_direct", "use_pass_indirect", "use_pass_color",
        "use_pass_diffuse", "use_pass_glossy", "use_pass_transmission",
        "use_pass_emit", "view_from", "normal_space",
    )
    saved = {
        "engine": render.engine,
        "cycles": {
            name: getattr(cycles, name)
            for name in cycle_names if hasattr(cycles, name)
        },
        "bake": {
            name: getattr(bake, name)
            for name in bake_names if hasattr(bake, name)
        },
    }
    device_state = snapshot_cycles_compute_state(scene)
    target = None
    coverage_target = None
    coverage_material = None
    slots = []
    device = {"deviceClass": "cpu", "backend": "cpu"}
    result = None
    primary_error = None
    cleanup_errors = []
    try:
        render.engine = "CYCLES"
        cycles.samples = 1
        if hasattr(cycles, "use_denoising"):
            cycles.use_denoising = False
        if hasattr(cycles, "use_adaptive_sampling"):
            cycles.use_adaptive_sampling = False
        if hasattr(cycles, "seed"):
            cycles.seed = 0
        if hasattr(cycles, "use_animated_seed"):
            cycles.use_animated_seed = False
        if hasattr(cycles, "use_auto_tile"):
            cycles.use_auto_tile = False
        configure_emit_bake(scene, margin)
        device = configure_cycles_compute_device(
            scene,
            log=log,
            restore_state=device_state,
            purpose="selected material field",
        )

        target = bpy.data.images.new(
            "BLENDLINK_SELECTED_FIELD_FLOAT",
            width=resolution,
            height=resolution,
            alpha=True,
            float_buffer=True,
        )
        target.generated_color = (0.0, 0.0, 0.0, 0.0)
        coverage_target = bpy.data.images.new(
            "BLENDLINK_SELECTED_FIELD_COVERAGE",
            width=resolution,
            height=resolution,
            alpha=True,
            float_buffer=True,
        )
        coverage_target.generated_color = (0.0, 0.0, 0.0, 0.0)
        coverage_material = bpy.data.materials.new(
            "BLENDLINK_SELECTED_FIELD_COVERAGE"
        )
        coverage_material.use_nodes = True
        tree = active_shader_node_tree(coverage_material)
        tree.nodes.clear()
        output_node = tree.nodes.new("ShaderNodeOutputMaterial")
        emission = tree.nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        emission.inputs["Strength"].default_value = 1.0
        tree.links.new(
            emission.outputs["Emission"],
            output_node.inputs["Surface"],
        )

        for obj in objects:
            for slot in obj.material_slots:
                slots.append((slot, slot.link, slot.material))
                slot.link = "DATA"
                slot.material = coverage_material
        bake_objects_to_image(
            objects,
            coverage_target,
            bake_type="EMIT",
            margin_px=margin,
            uv_layer=uv_layer,
            log=log,
        )
        coverage = image_signal_coverage(
            coverage_target,
            f"{label} coverage",
        )
        for slot, link, material in reversed(slots):
            slot.link = link
            slot.material = material
        slots.clear()

        bake_objects_to_image(
            objects,
            target,
            bake_type="EMIT",
            margin_px=margin,
            uv_layer=uv_layer,
            log=log,
        )
        import numpy as np

        pixels = np.empty(resolution * resolution * 4, dtype=np.float32)
        target.pixels.foreach_get(pixels)
        samples = pixels.reshape(resolution, resolution, 4)[:, :, :3][coverage]
        if len(samples) == 0:
            raise RuntimeError(
                f"{label}: selected EMIT field produced no covered RGB samples"
            )
        if not np.isfinite(samples).all():
            raise RuntimeError(
                f"{label}: selected field contains NaN or infinite covered RGB values"
            )
        minimum = tuple(float(value) for value in samples.min(axis=0))
        maximum = tuple(float(value) for value in samples.max(axis=0))
        if min(minimum) < -1.0e-6 or max(maximum) > 1.0 + 1.0e-6:
            raise RuntimeError(
                f"{label}: selected field range {minimum!r}..{maximum!r} "
                "cannot be represented as glTF base color without clipping. "
                "Clamp or map the selected field to 0..1 in Blender"
            )
        save_resolved(
            target,
            output,
            resolution,
            denoise=False,
            delivery_sizes=[],
            coverage=coverage,
        )
        if not os.path.isfile(output) or os.path.getsize(output) <= 0:
            raise RuntimeError(
                f"selected-field materialization produced no PNG: {output}"
            )
        result = {
            "path": output,
            "width": resolution,
            "height": resolution,
            "mime": "image/png",
            "sha256": file_sha256(output, length=64),
            "bytes": os.path.getsize(output),
            "coveredFraction": float(coverage.sum()) / float(coverage.size),
            "rgbMin": minimum,
            "rgbMax": maximum,
            "deviceClass": device["deviceClass"],
            "backend": device["backend"],
        }
    except BaseException as error:
        primary_error = error
    finally:
        for slot, link, material in reversed(slots):
            try:
                slot.link = link
                slot.material = material
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                cleanup_errors.append(f"coverage material binding: {error}")
        for image in (coverage_target, target):
            if image is None:
                continue
            try:
                if bpy.data.images.get(image.name) is image:
                    bpy.data.images.remove(image)
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                cleanup_errors.append(f"temporary bake image: {error}")
        if coverage_material is not None:
            try:
                if bpy.data.materials.get(coverage_material.name) is coverage_material:
                    bpy.data.materials.remove(coverage_material, do_unlink=True)
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                cleanup_errors.append(f"coverage material: {error}")
        try:
            restore_cycles_compute_state(device_state)
        except BaseException as error:
            cleanup_errors.append(f"Cycles compute device: {error}")
        for name, value in saved["bake"].items():
            try:
                setattr(bake, name, value)
            except (AttributeError, RuntimeError, TypeError, ValueError) as error:
                cleanup_errors.append(f"bake setting {name}: {error}")
        for name, value in saved["cycles"].items():
            try:
                setattr(cycles, name, value)
            except (AttributeError, RuntimeError, TypeError, ValueError) as error:
                cleanup_errors.append(f"Cycles setting {name}: {error}")
        try:
            render.engine = saved["engine"]
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            cleanup_errors.append(f"render engine: {error}")
    if cleanup_errors:
        cleanup_error = RuntimeError(
            "selected-field bake could not restore Blender state: "
            + "; ".join(cleanup_errors)
        )
        if primary_error is not None:
            raise cleanup_error from primary_error
        raise cleanup_error
    if primary_error is not None:
        raise primary_error.with_traceback(primary_error.__traceback__)
    if result is None:
        raise RuntimeError("selected-field bake produced no result")
    return result


def _new_realize_instances_group():
    """Private final modifier used only while capturing one evaluated mesh.

    ``new_from_object`` does not include a Geometry Nodes instances component.
    Let Blender's native Realize Instances implementation merge transforms,
    materials, UVs, and named attributes before converting to a Mesh datablock.
    """
    group = bpy.data.node_groups.new(
        "__Blendlink Bake Realize Instances", "GeometryNodeTree",
    )
    group.interface.new_socket(
        name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry",
    )
    group.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    source = group.nodes.new("NodeGroupInput")
    realize = group.nodes.new("GeometryNodeRealizeInstances")
    output = group.nodes.new("NodeGroupOutput")
    group.links.new(source.outputs["Geometry"], realize.inputs["Geometry"])
    group.links.new(realize.outputs["Geometry"], output.inputs["Geometry"])
    return group


def geometry_nodes_instance_context_risks(objs) -> list[dict]:
    """Find proven per-instance shader context that realization would erase.

    Blender keeps ``Object Info > Random`` distinct for unrealized Geometry
    Nodes instances. The final Realize Instances modifier needed for mesh/UV
    baking collapses that identity. Detect the evidenced route narrowly and
    block it instead of silently baking one random value across every copy.
    An authored Realize Instances node makes the collapse Blender's own source
    truth, so that graph is not reported here.
    """
    risks = []

    def node_trees(root):
        stack = [root]
        seen = set()
        while stack:
            tree = stack.pop()
            if tree is None or tree.as_pointer() in seen:
                continue
            seen.add(tree.as_pointer())
            yield tree
            for node in tree.nodes:
                nested = getattr(node, "node_tree", None)
                if nested is not None:
                    stack.append(nested)

    def material_uses_instance_random(material):
        tree = active_shader_node_tree(material)
        for nested in node_trees(tree):
            for node in nested.nodes:
                if node.bl_idname != "ShaderNodeObjectInfo":
                    continue
                output = node.outputs.get("Random")
                if output is not None and output.is_linked:
                    return True
        return False

    for obj in objs:
        groups = [
            modifier.node_group for modifier in obj.modifiers
            if modifier.type == "NODES" and modifier.node_group is not None
        ]
        trees = [tree for group in groups for tree in node_trees(group)]
        has_instances = any(
            node.bl_idname == "GeometryNodeInstanceOnPoints"
            for tree in trees for node in tree.nodes
        )
        has_authored_realize = any(
            node.bl_idname == "GeometryNodeRealizeInstances"
            for tree in trees for node in tree.nodes
        )
        if not has_instances or has_authored_realize:
            continue
        materials = {
            slot.material for slot in obj.material_slots
            if slot.material is not None
        }
        for tree in trees:
            for node in tree.nodes:
                sources = []
                if node.bl_idname == "GeometryNodeObjectInfo":
                    socket = node.inputs.get("Object")
                    if socket is not None and socket.default_value is not None:
                        sources.append(socket.default_value)
                elif node.bl_idname == "GeometryNodeCollectionInfo":
                    socket = node.inputs.get("Collection")
                    collection = socket.default_value if socket is not None else None
                    if collection is not None:
                        sources.extend(collection.all_objects)
                for source in sources:
                    materials.update(
                        slot.material for slot in getattr(source, "material_slots", ())
                        if slot.material is not None
                    )
        risky_materials = sorted(
            material.name for material in materials
            if material_uses_instance_random(material)
        )
        if risky_materials:
            risks.append({"object": obj.name, "materials": risky_materials})
    return risks


def freeze_evaluated_meshes(objs, log=print) -> list:
    """Freeze evaluated geometry and return meshes that still have faces.

    Two-phase evaluate-then-assign evaluates EVERY object against a clean
    depsgraph before mutating any of them. Interleaving ``evaluated_get`` with
    ``obj.data`` assignment dirties the depsgraph mid-loop and makes results
    order-dependent for inter-object modifiers (booleans, shrinkwrap).

    Instance-only Geometry Nodes output is realized through one temporary final
    modifier at a time. Applying it to all objects together could perturb
    Object Info, boolean, or shrinkwrap dependencies. Native realization keeps
    Blender's material/attribute propagation contract without modifying the
    artist's node group or leaving a modifier behind.

    Geometry Nodes may still legitimately evaluate an authored mesh to no
    geometry at the current bake frame. Such an object has nothing to unwrap,
    pack, or bake; retaining it would make the next UV stage index a layer that
    cannot exist. Exclude it from downstream bake mechanics, but report the
    exact object and frame so a surprising empty result is never a silent skip.
    """
    objects = list(objs)
    context_risks = geometry_nodes_instance_context_risks(objects)
    if context_risks:
        details = "; ".join(
            f"{item['object']} ({', '.join(item['materials'])})"
            for item in context_risks
        )
        raise RuntimeError(
            "Blendlink cannot bake unrealized Geometry Nodes instances whose "
            "materials use Object Info Random: realization would collapse "
            f"per-instance shader identity on {details}. Add an authored "
            "Realize Instances node if that collapse is intentional, or keep "
            "the object Realtime."
        )
    captured = {}
    realize_group = None
    try:
        # Capture ordinary objects against one clean dependency graph before
        # any temporary modifier exists anywhere in the scene.
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for obj in objects:
            if any(modifier.type == "NODES" for modifier in obj.modifiers):
                continue
            evaluated = obj.evaluated_get(depsgraph)
            captured[obj] = bpy.data.meshes.new_from_object(
                evaluated, preserve_all_data_layers=True, depsgraph=depsgraph,
            )

        for obj in objects:
            if not any(modifier.type == "NODES" for modifier in obj.modifiers):
                continue
            if realize_group is None:
                realize_group = _new_realize_instances_group()
            modifier = obj.modifiers.new(
                "__Blendlink Bake Realize Instances", "NODES",
            )
            modifier.node_group = realize_group
            try:
                bpy.context.view_layer.update()
                depsgraph = bpy.context.evaluated_depsgraph_get()
                evaluated = obj.evaluated_get(depsgraph)
                captured[obj] = bpy.data.meshes.new_from_object(
                    evaluated, preserve_all_data_layers=True, depsgraph=depsgraph,
                )
            finally:
                if obj.modifiers.get(modifier.name) is modifier:
                    obj.modifiers.remove(modifier)
                bpy.context.view_layer.update()
    except Exception:
        for mesh in captured.values():
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        raise
    finally:
        if realize_group is not None and realize_group.users == 0:
            bpy.data.node_groups.remove(realize_group)

    frozen = [(obj, captured[obj]) for obj in objects]
    for obj, mesh in frozen:
        obj.data = mesh
        obj.modifiers.clear()
    kept = [obj for obj, mesh in frozen if len(mesh.polygons) > 0]
    empty = [obj.name for obj, mesh in frozen if len(mesh.polygons) == 0]
    if empty:
        log(
            "blendlink: skipping evaluated-empty bake mesh(es) at frame "
            f"{bpy.context.scene.frame_current}: " + ", ".join(sorted(empty))
        )
    return kept


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


def join_proxy(
        objs, name: str, default_material_name: str, *,
        private_materials: bool = False) -> tuple:
    """Build one joined disposable geometry utility.

    This is not the semantic atlas-bake path. Native separate receiver objects
    are required to preserve Object Attribute/Info, Generated coordinates, and
    other object-scoped shader inputs. Keep this helper only for geometry tasks
    that explicitly accept joined object context.

    Handles the join traps: negative-scale (mirrored) sources get their
    winding flipped back (join keeps inverted normals — Cycles would bake
    their back sides), and material-less geometry gets a neutral surface
    (no material slot = nowhere to hang the bake target = cryptic Cycles
    failure).
    ``private_materials`` copies every joined material before a caller adds
    bake-target nodes. This is mandatory for lighting atlases: their exported
    originals keep authored PBR graphs, and a material may also be shared by
    an Appearance or Realtime object. The copies are tagged for scoped cleanup
    by :func:`release_proxy`.

    Returns (proxy, hidden) where hidden restores the originals.
    """
    private_by_source = {}
    copies = []
    for obj in objs:
        duplicate = obj.copy()
        duplicate.data = obj.data.copy()
        bpy.context.scene.collection.objects.link(duplicate)
        duplicate.matrix_world = obj.matrix_world.copy()
        duplicate.parent = None
        if obj.matrix_world.determinant() < 0.0:
            duplicate.data.flip_normals()
        if private_materials:
            shadow_visible = bool(getattr(obj, "visible_shadow", True))
            diffuse_visible = bool(getattr(obj, "visible_diffuse", True))
            for slot in duplicate.material_slots:
                source = slot.material
                if source is None:
                    continue
                key = (source.as_pointer(), shadow_visible, diffuse_visible)
                material = private_by_source.get(key)
                if material is None:
                    material = source.copy()
                    material.name = f"{source.name}.BLENDLINK_BAKE_PROXY"
                    material["blendlink_bake_proxy_material"] = True
                    material["blendlink_bake_proxy_shadow_visible"] = shadow_visible
                    material["blendlink_bake_proxy_diffuse_visible"] = diffuse_visible
                    if not shadow_visible:
                        disable_material_shadow_rays(material)
                    if not diffuse_visible:
                        disable_material_diffuse_rays(material)
                    private_by_source[key] = material
                slot.material = material
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
        ensure_shader_node_tree(default)
    if not proxy.material_slots:
        proxy.data.materials.append(default)
    for slot in proxy.material_slots:
        if slot.material is None:
            slot.material = default
    if private_materials:
        for slot in proxy.material_slots:
            source = slot.material
            if bool(source.get("blendlink_bake_proxy_material", False)):
                continue
            source_key = source.as_pointer()
            material = private_by_source.get(source_key)
            if material is None:
                material = source.copy()
                material.name = f"{source.name}.BLENDLINK_BAKE_PROXY"
                material["blendlink_bake_proxy_material"] = True
                material["blendlink_bake_proxy_shadow_visible"] = True
                material["blendlink_bake_proxy_diffuse_visible"] = True
                private_by_source[source_key] = material
            slot.material = material
    return proxy, hidden


def disable_material_shadow_rays(material) -> None:
    """Keep a proxy surface bakeable while making it transparent to shadows.

    Joining atlas receivers collapses Blender's object-level Cycles ray
    visibility onto one proxy object. A source object's ``visible_shadow``
    therefore cannot survive as object state. Private proxy materials are the
    correct seam: on shadow rays only, mix the authored surface to Transparent;
    camera/bake evaluation and every non-shadow contribution remain unchanged.
    Source materials are never mutated.
    """
    tree = ensure_shader_node_tree(material)
    output = next(
        (node for node in tree.nodes
         if node.bl_idname == "ShaderNodeOutputMaterial"
         and getattr(node, "is_active_output", False)),
        None,
    )
    if output is None:
        output = next(
            (node for node in tree.nodes
             if node.bl_idname == "ShaderNodeOutputMaterial"),
            None,
        )
    if output is None:
        raise RuntimeError(
            f"{material.name}: private bake proxy has no Material Output; "
            "cannot preserve Visible to Shadow Rays"
        )
    surface = output.inputs.get("Surface")
    if surface is None or not surface.is_linked:
        raise RuntimeError(
            f"{material.name}: private bake proxy Material Output has no linked "
            "Surface; cannot preserve Visible to Shadow Rays"
        )
    authored = surface.links[0].from_socket
    tree.links.remove(surface.links[0])
    light_path = tree.nodes.new("ShaderNodeLightPath")
    light_path.name = "BLENDLINK_BAKE_SHADOW_PATH"
    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    transparent.name = "BLENDLINK_BAKE_SHADOW_TRANSPARENT"
    mix = tree.nodes.new("ShaderNodeMixShader")
    mix.name = "BLENDLINK_BAKE_SHADOW_VISIBILITY"
    tree.links.new(light_path.outputs["Is Shadow Ray"], mix.inputs[0])
    tree.links.new(authored, mix.inputs[1])
    tree.links.new(transparent.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], surface)


def disable_material_diffuse_rays(material) -> None:
    """Keep a proxy surface bakeable while hiding it from diffuse rays.

    ``visible_diffuse`` controls indirect diffuse visibility independently of
    ordinary shadow rays. Atlas receivers are joined into one proxy, so the
    object flag otherwise disappears and can create false bounced-light
    occlusion. Wrap only the private proxy material; camera/bake evaluation and
    non-diffuse contributions remain unchanged, and source materials are never
    mutated.
    """
    tree = ensure_shader_node_tree(material)
    output = next(
        (node for node in tree.nodes
         if node.bl_idname == "ShaderNodeOutputMaterial"
         and getattr(node, "is_active_output", False)),
        None,
    )
    if output is None:
        output = next(
            (node for node in tree.nodes
             if node.bl_idname == "ShaderNodeOutputMaterial"),
            None,
        )
    if output is None:
        raise RuntimeError(
            f"{material.name}: private bake proxy has no Material Output; "
            "cannot preserve Visible to Diffuse Rays"
        )
    surface = output.inputs.get("Surface")
    if surface is None or not surface.is_linked:
        raise RuntimeError(
            f"{material.name}: private bake proxy Material Output has no linked "
            "Surface; cannot preserve Visible to Diffuse Rays"
        )
    authored = surface.links[0].from_socket
    tree.links.remove(surface.links[0])
    light_path = tree.nodes.new("ShaderNodeLightPath")
    light_path.name = "BLENDLINK_BAKE_DIFFUSE_PATH"
    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    transparent.name = "BLENDLINK_BAKE_DIFFUSE_TRANSPARENT"
    mix = tree.nodes.new("ShaderNodeMixShader")
    mix.name = "BLENDLINK_BAKE_DIFFUSE_VISIBILITY"
    tree.links.new(light_path.outputs["Is Diffuse Ray"], mix.inputs[0])
    tree.links.new(authored, mix.inputs[1])
    tree.links.new(transparent.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], surface)


def release_proxy(proxy, hidden) -> None:
    mesh = proxy.data
    private_materials = {
        slot.material for slot in proxy.material_slots
        if slot.material is not None
        and bool(slot.material.get("blendlink_bake_proxy_material", False))
    }
    bpy.data.objects.remove(proxy)
    if mesh.users == 0:
        bpy.data.meshes.remove(mesh)
    for material in private_materials:
        if material.users == 0 and material.name in bpy.data.materials:
            bpy.data.materials.remove(material)
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
    tree = ensure_shader_node_tree(black)
    background = tree.nodes.get("Background")
    if background is not None:
        background.inputs[0].default_value = (0.0, 0.0, 0.0, 1.0)
        background.inputs[1].default_value = 0.0
    scene.world = black
    return original, black


def restore_world(original, black) -> None:
    bpy.context.scene.world = original
    if black is not None and black.name in bpy.data.worlds:
        bpy.data.worlds.remove(black)
