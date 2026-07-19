# SPDX-License-Identifier: GPL-3.0-or-later
"""Vocabulary authoring operators.

Every operator follows the native contract: acts on all selected editable
objects, {'REGISTER', 'UNDO'} so F9 redo works, poll() with a message, and a
status-bar report of what happened. No dialogs, no popups.
"""
from __future__ import annotations

import bpy
from mathutils import Matrix

from . import validation, vocab

_SEP = "-"


def _rename(obj, new_name: str) -> bool:
    """Rename without letting Blender silently append `.001` (which would hide
    the vocabulary token). Returns False when the name is taken."""
    if obj.name == new_name:
        return True
    existing = bpy.data.objects.get(new_name)
    if existing is not None and existing != obj:
        return False
    obj.name = new_name
    return obj.name == new_name


def _mesh_or_empty_selected(context) -> bool:
    return any(o.type in ("MESH", "EMPTY") for o in context.selected_editable_objects)


class BLENDLINK_OT_tag_collider(bpy.types.Operator):
    """Rename selected objects with a collider suffix the web build understands"""
    bl_idname = "blendlink.tag_collider"
    bl_label = "Tag as Collider"
    bl_options = {"REGISTER", "UNDO"}

    kind: bpy.props.EnumProperty(
        name="Collider Type",
        items=(
            ("col", "Trimesh (-col)", "Exact triangle-mesh collider, object stays visible"),
            ("convcol", "Convex (-convcol)", "Convex-hull collider, object stays visible"),
            ("colonly", "Trimesh Proxy (-colonly)", "Collision-only proxy, removed from the render"),
            ("convcolonly", "Convex Proxy (-convcolonly)", "Convex collision-only proxy, removed from the render"),
        ),
        default="colonly",
    )

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not _mesh_or_empty_selected(context):
            cls.poll_message_set("Select a mesh or empty to tag")
            return False
        return True

    def execute(self, context):
        tagged, skipped = 0, []
        for obj in context.selected_editable_objects:
            if obj.type not in ("MESH", "EMPTY"):
                continue
            base = vocab.strip_structural(obj.name)
            if _rename(obj, f"{base}{_SEP}{self.kind}"):
                tagged += 1
            else:
                skipped.append(obj.name)
        validation.mark_dirty()
        if skipped:
            self.report({"WARNING"}, f"Tagged {tagged}, skipped name collisions: {', '.join(skipped)}")
        else:
            self.report({"INFO"}, f"Tagged {tagged} object(s) as {self.kind}")
        return {"FINISHED"}


class BLENDLINK_OT_tag_rigid(bpy.types.Operator):
    """Rename selected objects as rigid bodies and add mass and friction properties"""
    bl_idname = "blendlink.tag_rigid"
    bl_label = "Tag as Rigid Body"
    bl_options = {"REGISTER", "UNDO"}

    mass: bpy.props.FloatProperty(
        name="Mass", default=1.0, min=0.0, soft_max=100.0,
        description="Rigid-body mass in kilograms",
    )
    friction: bpy.props.FloatProperty(
        name="Friction", default=0.5, min=0.0, max=1.0,
        description="Surface friction coefficient",
    )

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not any(o.type == "MESH" for o in context.selected_editable_objects):
            cls.poll_message_set("Select a mesh to tag")
            return False
        return True

    def execute(self, context):
        tagged = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            base = vocab.strip_structural(obj.name)
            if not _rename(obj, f"{base}{_SEP}rigid"):
                continue
            obj["blendlink_mass"] = self.mass
            obj.id_properties_ui("blendlink_mass").update(
                min=0.0, soft_max=100.0, precision=2,
                description="Rigid-body mass in kilograms",
            )
            obj["blendlink_friction"] = self.friction
            obj.id_properties_ui("blendlink_friction").update(
                min=0.0, max=1.0, precision=2,
                description="Surface friction coefficient",
            )
            tagged += 1
        validation.mark_dirty()
        self.report({"INFO"}, f"Tagged {tagged} rigid bod{'y' if tagged == 1 else 'ies'}")
        return {"FINISHED"}


class BLENDLINK_OT_set_lod(bpy.types.Operator):
    """Rename selected objects into a LOD chain level"""
    bl_idname = "blendlink.set_lod"
    bl_label = "Set LOD Level"
    bl_options = {"REGISTER", "UNDO"}

    level: bpy.props.IntProperty(name="Level", default=0, min=0, max=7)
    distance: bpy.props.FloatProperty(
        name="Switch Distance", default=0.0, min=0.0, soft_max=200.0, subtype="DISTANCE",
        description="Camera distance where this level takes over (0 leaves it unset)",
    )

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not any(o.type == "MESH" for o in context.selected_editable_objects):
            cls.poll_message_set("Select a mesh to place in a LOD chain")
            return False
        return True

    def execute(self, context):
        tagged = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            base = vocab.strip_structural(obj.name)
            if not _rename(obj, f"{base}_LOD{self.level}"):
                continue
            if self.distance > 0.0:
                obj["blendlink_lod_distance"] = self.distance
                obj.id_properties_ui("blendlink_lod_distance").update(
                    min=0.0, soft_max=500.0, subtype="DISTANCE",
                    description="Camera distance where this level takes over",
                )
            tagged += 1
        validation.mark_dirty()
        self.report({"INFO"}, f"Set {tagged} object(s) to LOD{self.level}")
        return {"FINISHED"}


class BLENDLINK_OT_tag_noimp(bpy.types.Operator):
    """Rename selected objects so the web export leaves them out"""
    bl_idname = "blendlink.tag_noimp"
    bl_label = "Exclude from Web Export"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not context.selected_editable_objects:
            cls.poll_message_set("Select objects to exclude")
            return False
        return True

    def execute(self, context):
        tagged = 0
        for obj in context.selected_editable_objects:
            base = vocab.strip_structural(obj.name)
            if _rename(obj, f"{base}{_SEP}noimp"):
                tagged += 1
        validation.mark_dirty()
        self.report({"INFO"}, f"Excluded {tagged} object(s) from export")
        return {"FINISHED"}


class BLENDLINK_OT_clear_tag(bpy.types.Operator):
    """Remove the blendlink suffix or anchor prefix from selected object names"""
    bl_idname = "blendlink.clear_tag"
    bl_label = "Clear Blendlink Tag"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not any(vocab.classify(o.name) for o in context.selected_editable_objects):
            cls.poll_message_set("Select tagged objects")
            return False
        return True

    def execute(self, context):
        cleared = 0
        for obj in context.selected_editable_objects:
            classification = vocab.classify(obj.name)
            if classification is None:
                continue
            if classification.kind in ("socket", "hotspot", "audio"):
                stripped = vocab.strip_anchor(obj.name)
            else:
                stripped = vocab.strip_structural(obj.name)
            if _rename(obj, stripped):
                cleared += 1
        validation.mark_dirty()
        self.report({"INFO"}, f"Cleared tags on {cleared} object(s)")
        return {"FINISHED"}


_ANCHOR_DISPLAY = {
    "SOCKET": ("ARROWS", 0.15),
    "HOTSPOT": ("SPHERE", 0.08),
    "AUDIO": ("PLAIN_AXES", 0.12),
}


class BLENDLINK_OT_add_anchor(bpy.types.Operator):
    """Add a typed anchor empty parented to the active object"""
    bl_idname = "blendlink.add_anchor"
    bl_label = "Add Anchor"
    bl_options = {"REGISTER", "UNDO"}

    kind: bpy.props.EnumProperty(
        name="Anchor Type",
        items=(
            ("SOCKET", "Socket", "Attachment point exposed as a typed transform"),
            ("HOTSPOT", "Hotspot", "Interactive marker with title and body text"),
            ("AUDIO", "Audio", "Positional audio emitter location"),
        ),
        default="SOCKET",
    )
    anchor_name: bpy.props.StringProperty(name="Name", default="New")

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        return True

    def execute(self, context):
        display_type, display_size = _ANCHOR_DISPLAY[self.kind]
        anchor = bpy.data.objects.new(f"{self.kind}_{self.anchor_name}", None)
        anchor.empty_display_type = display_type
        anchor.empty_display_size = display_size
        context.collection.objects.link(anchor)
        parent = context.active_object
        if parent is not None and parent != anchor:
            anchor.parent = parent
            anchor.matrix_parent_inverse = Matrix.Identity(4)
            anchor.matrix_world = parent.matrix_world
        else:
            anchor.location = context.scene.cursor.location
        if self.kind == "HOTSPOT":
            anchor["blendlink_title"] = self.anchor_name
            anchor.id_properties_ui("blendlink_title").update(description="Heading shown in the web hotspot")
            anchor["blendlink_body"] = ""
            anchor.id_properties_ui("blendlink_body").update(description="Body text shown in the web hotspot")
        for obj in context.selected_objects:
            obj.select_set(False)
        anchor.select_set(True)
        context.view_layer.objects.active = anchor
        validation.mark_dirty()
        self.report({"INFO"}, f"Added {self.kind.lower()} anchor {anchor.name!r}")
        return {"FINISHED"}


class BLENDLINK_OT_fix_numbered(bpy.types.Operator):
    """Move Blender's duplicate number into the base name so the tag parses"""
    bl_idname = "blendlink.fix_numbered"
    bl_label = "Fix Numbered Name"
    bl_options = {"REGISTER", "UNDO", "INTERNAL"}

    object_name: bpy.props.StringProperty(options={"SKIP_SAVE"})

    def execute(self, context):
        obj = bpy.data.objects.get(self.object_name)
        if obj is None:
            self.report({"WARNING"}, f"Object {self.object_name!r} no longer exists")
            return {"CANCELLED"}
        fixed = vocab.fix_numbered(obj.name)
        if fixed == obj.name or not _rename(obj, fixed):
            self.report({"WARNING"}, f"Could not fix {obj.name!r}")
            return {"CANCELLED"}
        validation.mark_dirty()
        self.report({"INFO"}, f"Renamed to {fixed!r}")
        return {"FINISHED"}


class BLENDLINK_OT_select_issue(bpy.types.Operator):
    """Select and frame the object this check refers to"""
    bl_idname = "blendlink.select_issue"
    bl_label = "Select Object"
    bl_options = {"REGISTER", "UNDO", "INTERNAL"}

    object_name: bpy.props.StringProperty(options={"SKIP_SAVE"})

    def execute(self, context):
        obj = bpy.data.objects.get(self.object_name)
        if obj is None or obj.name not in context.view_layer.objects:
            self.report({"WARNING"}, f"Object {self.object_name!r} is not in this view layer")
            return {"CANCELLED"}
        for other in context.selected_objects:
            other.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        return {"FINISHED"}


class BLENDLINK_OT_set_texel_weight(bpy.types.Operator):
    """Add a lightmap scale to selected meshes — a linear density multiplier
    for the baked atlas (2 doubles resolution per axis; 0 excludes the
    object from the atlas while it keeps lighting the bake)"""
    bl_idname = "blendlink.set_texel_weight"
    bl_label = "Set Lightmap Scale"
    bl_options = {"REGISTER", "UNDO"}

    weight: bpy.props.FloatProperty(
        name="Scale", default=1.0, min=0.0, soft_max=4.0,
        description="Linear texel-density multiplier (0 excludes from the atlas)",
    )

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not any(o.type == "MESH" for o in context.selected_editable_objects):
            cls.poll_message_set("Select a mesh")
            return False
        return True

    def execute(self, context):
        tagged = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            obj["blendlink_texel_weight"] = self.weight
            obj.id_properties_ui("blendlink_texel_weight").update(
                min=0.0, soft_max=4.0, precision=2,
                description=(
                    "Lightmap scale: linear texel-density multiplier for the "
                    "baked atlas. 0 excludes the object from the atlas but it "
                    "still lights the bake"
                ),
            )
            tagged += 1
        from . import validation
        validation.mark_dirty()
        self.report({"INFO"}, f"Set lightmap scale {self.weight:g} on {tagged} object(s)")
        return {"FINISHED"}


def _atlas_items(self, context):
    """Enum items from the last sync's plan — Auto first, then each
    declared atlas by name."""
    from . import syncstatus
    plan = syncstatus.bake_plan() or {}
    items = [("__AUTO__", "Auto (by camera proximity)", "Remove the override")]
    for name in (plan.get("atlases") or {"main": {}}):
        items.append((name, name, f"Force into the '{name}' atlas"))
    return items


class BLENDLINK_OT_set_atlas(bpy.types.Operator):
    """Choose which atlas the selected meshes bake into — Auto assigns by
    camera proximity; a named atlas forces membership"""
    bl_idname = "blendlink.set_atlas"
    bl_label = "Set Atlas"
    bl_options = {"REGISTER", "UNDO"}
    bl_property = "atlas"

    atlas: bpy.props.EnumProperty(name="Atlas", items=_atlas_items)

    @classmethod
    def poll(cls, context):
        return any(obj.type == "MESH" for obj in context.selected_editable_objects)

    def execute(self, context):
        changed = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            if self.atlas == "__AUTO__":
                if "blendlink_atlas" in obj:
                    del obj["blendlink_atlas"]
            else:
                obj["blendlink_atlas"] = self.atlas
            changed += 1
        label = "Auto" if self.atlas == "__AUTO__" else self.atlas
        self.report({"INFO"}, f"Atlas → {label} on {changed} object(s)")
        return {"FINISHED"}


class BLENDLINK_OT_set_shading(bpy.types.Operator):
    """Bake this mesh into the atlas, keep it dynamic (real materials, lit
    at runtime), or let blendlink decide (armature/transparency auto-detect)"""
    bl_idname = "blendlink.set_shading"
    bl_label = "Set Shading"
    bl_options = {"REGISTER", "UNDO"}
    bl_property = "mode"

    mode: bpy.props.EnumProperty(name="Shading", items=[
        ("AUTO", "Auto", "Baked unless armature-deformed or transparent"),
        ("DYNAMIC", "Dynamic (lit)", "Keep real materials; lit at runtime"),
        ("BAKED", "Baked (forced)", "Bake even if auto-detection says dynamic"),
    ])

    @classmethod
    def poll(cls, context):
        return any(obj.type == "MESH" for obj in context.selected_editable_objects)

    def execute(self, context):
        changed = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            if self.mode == "AUTO":
                if "blendlink_dynamic" in obj:
                    del obj["blendlink_dynamic"]
            else:
                obj["blendlink_dynamic"] = 1 if self.mode == "DYNAMIC" else 0
            changed += 1
        self.report({"INFO"}, f"Shading → {self.mode.title()} on {changed} object(s)")
        return {"FINISHED"}


class BLENDLINK_OT_select_atlas_objects(bpy.types.Operator):
    """Select every object the last sync assigned to this atlas"""
    bl_idname = "blendlink.select_atlas_objects"
    bl_label = "Select Atlas Objects"
    bl_options = {"REGISTER", "UNDO"}

    atlas: bpy.props.StringProperty()

    def execute(self, context):
        from . import syncstatus
        plan = syncstatus.bake_plan() or {}
        names = {
            entry["name"] for entry in plan.get("objects", [])
            if entry.get("atlas", "main") == self.atlas
        }
        bpy.ops.object.select_all(action="DESELECT")
        selected = 0
        for name in names:
            obj = context.scene.objects.get(name)
            if obj is None:
                continue
            try:
                obj.select_set(True)
                context.view_layer.objects.active = obj
                selected += 1
            except RuntimeError:
                continue
        self.report({"INFO"}, f"Selected {selected}/{len(names)} objects in '{self.atlas}'")
        return {"FINISHED"}


# UV-layer and checker names MIRROR packages/blendlink/blender/bakelib.py —
# the one home for the contract. The headless test imports bakelib and
# asserts these match, the same trick the vocabulary conformance uses.
ATLAS_UV = "BLENDLINK_ATLAS"
AUTHORED_UV = "BLENDLINK_ATLAS_AUTHORED"
CHECKER_MODIFIER = "BLENDLINK-checker-override"


def _stage_atlas_layer(mesh) -> bool:
    """Mirror of bakelib.stage_atlas_layers for ONE mesh: the authored
    layer's islands and pin flags when present, else the first UV layer
    with pins cleared (a stale live-unwrap pin must never lock the pack).
    Returns True when the authored layer was adopted."""
    authored = mesh.uv_layers.get(AUTHORED_UV)
    source = authored if authored is not None else mesh.uv_layers[0]
    values = [loop.uv.copy() for loop in source.data]
    pins = [loop.pin_uv for loop in source.data] if authored is not None else None
    previous = mesh.uv_layers.get(ATLAS_UV)
    if previous is not None and previous != source:
        mesh.uv_layers.remove(previous)
    layer = mesh.uv_layers.new(name=ATLAS_UV)
    if layer is None:
        raise RuntimeError(
            f"{mesh.name}: could not add {ATLAS_UV} (UV-layer limit) — "
            "remove unused UV maps"
        )
    for index, loop in enumerate(layer.data):
        loop.uv = values[index]
        loop.pin_uv = bool(pins[index]) if pins is not None else False
    mesh.uv_layers.active = layer
    return authored is not None


def _average_unpinned(context) -> None:
    """Mirror of bakelib.average_unpinned on the current selection:
    equalize px/m across islands EXCEPT pinned ones. Blender's own
    select_pinned + select_linked resolve the islands, then uv.pin expands
    the flags island-wide so loop.pin_uv is the held mask afterwards."""
    tools = context.scene.tool_settings
    prior_sync = tools.use_uv_select_sync
    tools.use_uv_select_sync = False
    try:
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


class BLENDLINK_OT_preview_atlas_uvs(bpy.types.Operator):
    """Pack preview atlas UVs from the last sync's plan so the UV editor
    shows what the bake will produce (writes the BLENDLINK_ATLAS layer;
    one undo step reverses it). Meshes with a materialized authored layer
    contribute its islands — pinned islands hold position and scale"""
    bl_idname = "blendlink.preview_atlas_uvs"
    bl_label = "Preview Atlas UVs"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        if syncstatus.bake_plan() is None:
            cls.poll_message_set("No bake plan yet — run a sync first")
            return False
        return context.mode == "OBJECT"

    def execute(self, context):
        from . import syncstatus
        plan = syncstatus.bake_plan()
        # REPLAY the plan, never recompute it: assignments and final weights
        # come from the manifest, so this cannot drift from the exporter.
        atlases = plan.get("atlases") or {"main": {"size": plan.get("atlasSize", 2048)}}
        reference = max(entry.get("size", 2048) for entry in atlases.values())
        base_margin = int(plan.get("marginPx", 48))
        groups = {}
        for entry in plan.get("objects", []):
            obj = context.scene.objects.get(entry.get("name", ""))
            if obj is None or obj.type != "MESH" or len(obj.data.polygons) == 0:
                continue
            weight = float(entry.get("autoWeight", 1.0)) * float(entry.get("artistWeight", 1.0))
            groups.setdefault(entry.get("atlas", "main"), []).append((obj, weight))
        if not groups:
            self.report({"WARNING"}, "No plan objects found in this scene — resync?")
            return {"CANCELLED"}
        packed = 0
        authored_count = 0
        for name, members in groups.items():
            size = atlases.get(name, {}).get("size", 2048)
            margin = max(1, round(base_margin * size / reference))
            for obj, _ in members:
                if len(obj.data.uv_layers) == 0:
                    continue
                if _stage_atlas_layer(obj.data):
                    authored_count += 1
            objs = [obj for obj, _ in members]
            _select_only(context, objs)
            if context.view_layer.objects.active is None:
                continue
            _average_unpinned(context)
            for obj, weight in members:
                if weight != 1.0:
                    layer = obj.data.uv_layers.get(ATLAS_UV)
                    if layer is not None:
                        for loop in layer.data:
                            if not loop.pin_uv:
                                loop.uv *= weight
            _select_only(context, objs)
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.select_all(action="SELECT")
            # Mirrors the exporter's pack contract (CARDINAL/CONCAVE/FRACTION,
            # pin=LOCKED; with zero pins the result is identical to no pin).
            bpy.ops.uv.pack_islands(
                rotate=True, rotate_method="CARDINAL", scale=True,
                merge_overlap=False, margin_method="FRACTION",
                margin=(margin + 4) / size, shape_method="CONCAVE",
                pin=True, pin_method="LOCKED",
            )
            bpy.ops.object.mode_set(mode="OBJECT")
            packed += 1
        honored = f", honoring {authored_count} authored layer(s)" if authored_count else ""
        self.report(
            {"INFO"},
            f"Packed {packed} preview atlas(es) into the {ATLAS_UV} UV layer"
            f"{honored} — open a UV Editor to inspect (Ctrl+Z reverses)",
        )
        return {"FINISHED"}


class BLENDLINK_OT_materialize_atlas_uvs(bpy.types.Operator):
    """Persist the previewed pack as an authored, editable UV layer the
    export honors: move islands freely, pin (P in the UV editor) the ones
    that must hold — the next sync locks pinned islands in place and packs
    everything else around them"""
    bl_idname = "blendlink.materialize_atlas_uvs"
    bl_label = "Materialize Editable UVs"
    bl_options = {"REGISTER", "UNDO"}

    overwrite: bpy.props.BoolProperty(
        name="Overwrite Authored Layer",
        description="Replace an existing authored layer — its edits and pins are lost",
        default=False,
    )

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not any(o.type == "MESH" for o in context.selected_editable_objects):
            cls.poll_message_set("Select the meshes to materialize")
            return False
        return True

    def execute(self, context):
        made, kept, missing = [], [], []
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            mesh = obj.data
            atlas = mesh.uv_layers.get(ATLAS_UV)
            if atlas is None:
                missing.append(obj.name)
                continue
            existing = mesh.uv_layers.get(AUTHORED_UV)
            # NEVER silently overwrite an authored layer — the artist's
            # edits and pins live there. Explicit opt-in via the redo panel.
            if existing is not None and not self.overwrite:
                kept.append(obj.name)
                continue
            values = [loop.uv.copy() for loop in atlas.data]
            if existing is not None:
                mesh.uv_layers.remove(existing)
            layer = mesh.uv_layers.new(name=AUTHORED_UV)
            if layer is None:
                self.report(
                    {"ERROR"},
                    f"{obj.name}: could not add {AUTHORED_UV} (UV-layer limit) "
                    "— remove unused UV maps",
                )
                return {"CANCELLED"}
            for index, loop in enumerate(layer.data):
                loop.uv = values[index]
                loop.pin_uv = False
            mesh.uv_layers.active = layer
            made.append(obj.name)
        if not made and not kept:
            self.report(
                {"WARNING"},
                "No previewed atlas UVs on the selection — run Preview Atlas UVs first",
            )
            return {"CANCELLED"}
        parts = []
        if made:
            parts.append(
                f"Materialized {len(made)} authored layer(s) — edit freely, "
                "pin (P) islands to hold them through the next sync"
            )
        if kept:
            parts.append(
                f"kept {len(kept)} existing authored layer(s) untouched "
                f"(enable Overwrite to replace): {', '.join(kept)}"
            )
        if missing:
            parts.append(f"no preview UVs on {len(missing)}")
        self.report({"WARNING"} if kept or missing else {"INFO"}, "; ".join(parts))
        return {"FINISHED"}


# --- checker inspection override -------------------------------------------
# TexTools-style: a geometry-nodes modifier sets a shared checker material
# in the VIEWPORT only (show_render=False), never touching user material
# slots. The exporter additionally strips strays before evaluating, because
# freeze/export walk the viewport depsgraph where the override IS applied.

_CHECKER_PREFIX = "BLENDLINK-checker"
_GRID_IMAGE_RES = 1024
# Blender's generated UV_GRID image draws fixed 32px checkers at any
# resolution (measured on 5.2), so one repeat holds RES/32 cells.
_UV_GRID_CELL_PX = 32


def _checker_image(kind: str):
    name = f"{_CHECKER_PREFIX}-grid-{'uv' if kind == 'UV_GRID' else 'color'}"
    image = bpy.data.images.get(name)
    if image is None:
        image = bpy.data.images.new(name, _GRID_IMAGE_RES, _GRID_IMAGE_RES)
        image.generated_type = kind
    return image


def _checker_material(mode: str, size: int, cell_px: int):
    if mode == "DENSITY":
        name = f"{_CHECKER_PREFIX}-DENSITY-{size}px-{cell_px}t"
        # One generated checker cell (32px in the image) must span cell_px
        # REAL atlas texels: scale = atlas / (cells-per-repeat × cell_px).
        cells = _GRID_IMAGE_RES // _UV_GRID_CELL_PX
        scale = size / (cells * cell_px)
        image, interpolation = _checker_image("UV_GRID"), "Closest"
    else:
        name = f"{_CHECKER_PREFIX}-UVGRID-{size}px"
        # One lettered color grid across the whole atlas: cells are fixed
        # in ATLAS space (density still comparable) and letters say WHERE
        # an island landed.
        scale = 1.0
        image, interpolation = _checker_image("COLOR_GRID"), "Linear"
    material = bpy.data.materials.get(name)
    if material is not None:
        return material
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = interpolation
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, 1.0)
    uvmap = tree.nodes.new("ShaderNodeUVMap")
    uvmap.uv_map = ATLAS_UV
    tree.links.new(uvmap.outputs["UV"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
    tree.links.new(texture.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def _checker_group(mode: str, size: int, cell_px: int):
    """Geometry-nodes group per (mode, atlas size): Set Material with the
    checker as the socket DEFAULT (5.2 rejects material id-props on the
    modifier, so the material rides inside the group)."""
    material = _checker_material(mode, size, cell_px)
    group = bpy.data.node_groups.get(material.name)
    if group is not None:
        return group
    group = bpy.data.node_groups.new(material.name, "GeometryNodeTree")
    group.is_modifier = True
    group.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    source = group.nodes.new("NodeGroupInput")
    sink = group.nodes.new("NodeGroupOutput")
    set_material = group.nodes.new("GeometryNodeSetMaterial")
    set_material.inputs["Material"].default_value = material
    group.links.new(source.outputs["Geometry"], set_material.inputs["Geometry"])
    group.links.new(set_material.outputs["Geometry"], sink.inputs["Geometry"])
    return group


def _checker_mode() -> str:
    """Current mode derived from the FILE (robust across undo and reload):
    the first checker modifier found names its node group by mode."""
    for obj in bpy.data.objects:
        for modifier in getattr(obj, "modifiers", []):
            if modifier.name.startswith(CHECKER_MODIFIER) and modifier.node_group:
                if "-DENSITY-" in modifier.node_group.name:
                    return "DENSITY"
                if "-UVGRID-" in modifier.node_group.name:
                    return "UVGRID"
    return "OFF"


def _checker_sweep() -> tuple:
    """Strip every checker override and datablock, strays included."""
    removed = 0
    for obj in bpy.data.objects:
        for modifier in [m for m in getattr(obj, "modifiers", [])
                         if m.name.startswith(CHECKER_MODIFIER)]:
            obj.modifiers.remove(modifier)
            removed += 1
    blocks = 0
    for collection in (bpy.data.node_groups, bpy.data.materials, bpy.data.images):
        for block in [b for b in collection if b.name.startswith(_CHECKER_PREFIX)]:
            collection.remove(block)
            blocks += 1
    return removed, blocks


class BLENDLINK_OT_toggle_checker(bpy.types.Operator):
    """Cycle the atlas checker: OFF → DENSITY (one checker cell = a fixed
    count of real atlas texels — judge density AFTER packing, the pack
    rescales islands) → UV GRID (one lettered grid across the whole atlas —
    seams, orientation, and where islands landed) → OFF. Viewport-only:
    a geometry-nodes override, render and export never see it"""
    bl_idname = "blendlink.toggle_checker"
    bl_label = "Toggle Atlas Checker"
    bl_options = {"REGISTER", "UNDO"}

    cell_px: bpy.props.IntProperty(
        name="Texels per Checker", default=8, min=1, soft_max=64,
        description="DENSITY mode: real atlas texels covered by one checker cell",
    )

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        if syncstatus.bake_plan() is None:
            cls.poll_message_set("No bake plan yet — run a sync first")
            return False
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        return True

    def execute(self, context):
        from . import syncstatus
        current = _checker_mode()
        if current == "UVGRID":
            removed, blocks = _checker_sweep()
            self.report({"INFO"}, f"Checker off — removed {removed} override(s)")
            return {"FINISHED"}
        mode = "DENSITY" if current == "OFF" else "UVGRID"
        plan = syncstatus.bake_plan()
        atlases = plan.get("atlases") or {"main": {"size": plan.get("atlasSize", 2048)}}
        targets, skipped = [], []
        for entry in plan.get("objects", []):
            obj = context.scene.objects.get(entry.get("name", ""))
            if obj is None or obj.type != "MESH":
                continue
            if obj.data.uv_layers.get(ATLAS_UV) is None:
                skipped.append(obj.name)
                continue
            size = int(atlases.get(entry.get("atlas", "main"), {}).get("size", 2048))
            targets.append((obj, size))
        if not targets:
            self.report(
                {"WARNING"},
                "Nothing to inspect — run Preview Atlas UVs first "
                "(the checker samples the previewed layer)",
            )
            return {"CANCELLED"}
        for obj, size in targets:
            group = _checker_group(mode, size, self.cell_px)
            modifier = next(
                (m for m in obj.modifiers if m.name.startswith(CHECKER_MODIFIER)),
                None,
            )
            if modifier is None:
                modifier = obj.modifiers.new(name=CHECKER_MODIFIER, type="NODES")
            modifier.node_group = group
            modifier.show_render = False
        label = (
            f"Density checker: 1 cell = {self.cell_px}×{self.cell_px} atlas texels"
            if mode == "DENSITY"
            else "UV grid: one lettered grid across each atlas"
        )
        note = f" — skipped {len(skipped)} without preview UVs" if skipped else ""
        self.report({"INFO"}, f"{label} on {len(targets)} mesh(es){note} (viewport only)")
        return {"FINISHED"}


class BLENDLINK_OT_checker_cleanup(bpy.types.Operator):
    """Remove every checker override and its datablocks from the file,
    strays included (the exporter also strips leftovers defensively)"""
    bl_idname = "blendlink.checker_cleanup"
    bl_label = "Remove Checker Overrides"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        removed, blocks = _checker_sweep()
        self.report(
            {"INFO"},
            f"Removed {removed} checker override(s) and {blocks} datablock(s)",
        )
        return {"FINISHED"}


def _select_only(context, objs):
    bpy.ops.object.select_all(action="DESELECT")
    active = None
    for obj in objs:
        try:
            obj.select_set(True)
            active = obj
        except RuntimeError:
            continue
    context.view_layer.objects.active = active


class BLENDLINK_OT_refresh_bake_table(bpy.types.Operator):
    """Rebuild the bake table from the last sync's plan plus the LIVE scene
    (shading and atlas overrides reflect current properties; objects added
    since the sync appear marked as new)"""
    bl_idname = "blendlink.refresh_bake_table"
    bl_label = "Refresh Bake Table"
    bl_options = {"REGISTER"}

    def execute(self, context):
        from . import syncstatus, ui
        plan = syncstatus.bake_plan() or {}
        rows = context.window_manager.blendlink.bake_rows
        rows.clear()
        planned = {}
        for entry in plan.get("objects", []):
            planned[entry.get("name", "")] = entry
        dynamic_reasons = {
            entry.get("name", ""): entry.get("reason", "")
            for entry in plan.get("dynamicObjects", [])
        }
        for obj in sorted(context.scene.objects, key=lambda o: o.name):
            if obj.type != "MESH" or obj.hide_render:
                continue
            row = rows.add()
            row.name = obj.name
            note = ui._dynamic_note(obj)
            if note is not None:
                row.shading = "dynamic"
                row.atlas = "—"
                row.density = note.replace("Dynamic — ", "")
                continue
            if obj.name in dynamic_reasons and "blendlink_dynamic" not in obj:
                row.shading = "dynamic"
                row.atlas = "—"
                row.density = dynamic_reasons[obj.name]
                continue
            row.shading = "baked"
            entry = planned.get(obj.name)
            override = obj.get("blendlink_atlas")
            if isinstance(override, str):
                row.atlas = override + " (set)"
            elif entry is not None:
                row.atlas = str(entry.get("atlas", "main"))
            else:
                row.atlas = "new — resync"
            if entry is not None:
                px = entry.get("pxPerMeter")
                row.density = f"{px:.0f} px/m" if px else ""
                auto = entry.get("autoWeight", 1.0)
                artist = entry.get("artistWeight", 1.0)
                if auto != 1.0 or artist != 1.0:
                    row.weight = f"{auto:g}×{artist:g}"
        context.window_manager.blendlink.bake_row_index = -1
        self.report({"INFO"}, f"{len(rows)} meshes in the bake table")
        return {"FINISHED"}


class BLENDLINK_OT_sync_now(bpy.types.Operator):
    """Save the file and run the project sync in the background"""
    bl_idname = "blendlink.sync_now"
    bl_label = "Sync Now"
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context):
        from . import syncrun, syncstatus
        if syncrun.is_running():
            cls.poll_message_set("A sync is already running")
            return False
        if not bpy.data.filepath:
            cls.poll_message_set("Save the file first so there is something to sync")
            return False
        if syncstatus.project_root() is None:
            cls.poll_message_set("No blendlink.config.mjs found near this file")
            return False
        return True

    def execute(self, context):
        from . import syncrun, syncstatus
        if bpy.data.is_dirty:
            bpy.ops.wm.save_mainfile()
        syncstatus.refresh(force=True)
        # Always run the orchestrator: it hash-gates external builds and
        # skips instantly when everything is already in sync.
        command = "npx blendlink sync"
        error = syncrun.start(command, syncstatus.project_root())
        if error is not None:
            self.report({"ERROR"}, error)
            return {"CANCELLED"}
        self.report({"INFO"}, "Syncing in the background...")
        return {"FINISHED"}


class BLENDLINK_OT_sync_cancel(bpy.types.Operator):
    """Stop the running sync"""
    bl_idname = "blendlink.sync_cancel"
    bl_label = "Cancel Sync"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncrun
        return syncrun.is_running()

    def execute(self, context):
        from . import syncrun
        syncrun.cancel()
        self.report({"INFO"}, "Sync canceled")
        return {"FINISHED"}


class BLENDLINK_OT_open_sync_log(bpy.types.Operator):
    """Open the last sync log in the system viewer"""
    bl_idname = "blendlink.open_sync_log"
    bl_label = "Open Sync Log"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncrun
        import os
        if not syncrun.last_log_path() or not os.path.exists(syncrun.last_log_path()):
            cls.poll_message_set("No sync has run yet")
            return False
        return True

    def execute(self, context):
        from . import syncrun
        bpy.ops.wm.path_open(filepath=syncrun.last_log_path())
        return {"FINISHED"}


class BLENDLINK_OT_copy_sync_hint(bpy.types.Operator):
    """Copy the sync command to the clipboard to run it in a terminal"""
    bl_idname = "blendlink.copy_sync_hint"
    bl_label = "Copy Sync Command"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        if not syncstatus.sync_hint():
            cls.poll_message_set("The manifest does not record a sync command")
            return False
        return True

    def execute(self, context):
        from . import syncstatus
        hint = syncstatus.sync_hint()
        context.window_manager.clipboard = hint
        self.report({"INFO"}, f"Copied: {hint}")
        return {"FINISHED"}


class BLENDLINK_OT_refresh_checks(bpy.types.Operator):
    """Re-run the vocabulary checks now"""
    bl_idname = "blendlink.refresh_checks"
    bl_label = "Refresh Checks"
    bl_options = {"INTERNAL"}

    def execute(self, context):
        validation.recompute(context.scene)
        return {"FINISHED"}


class BLENDLINK_OT_refresh_sync(bpy.types.Operator):
    """Re-check whether the saved file matches the last blendlink sync"""
    bl_idname = "blendlink.refresh_sync"
    bl_label = "Refresh Sync Status"
    bl_options = {"INTERNAL"}

    def execute(self, context):
        from . import syncstatus
        syncstatus.refresh(force=True)
        return {"FINISHED"}


classes = (
    BLENDLINK_OT_tag_collider,
    BLENDLINK_OT_tag_rigid,
    BLENDLINK_OT_set_lod,
    BLENDLINK_OT_tag_noimp,
    BLENDLINK_OT_clear_tag,
    BLENDLINK_OT_add_anchor,
    BLENDLINK_OT_fix_numbered,
    BLENDLINK_OT_select_issue,
    BLENDLINK_OT_set_texel_weight,
    BLENDLINK_OT_set_atlas,
    BLENDLINK_OT_set_shading,
    BLENDLINK_OT_select_atlas_objects,
    BLENDLINK_OT_preview_atlas_uvs,
    BLENDLINK_OT_materialize_atlas_uvs,
    BLENDLINK_OT_toggle_checker,
    BLENDLINK_OT_checker_cleanup,
    BLENDLINK_OT_refresh_bake_table,
    BLENDLINK_OT_sync_now,
    BLENDLINK_OT_sync_cancel,
    BLENDLINK_OT_open_sync_log,
    BLENDLINK_OT_copy_sync_hint,
    BLENDLINK_OT_refresh_checks,
    BLENDLINK_OT_refresh_sync,
)
