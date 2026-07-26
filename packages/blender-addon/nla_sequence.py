# SPDX-License-Identifier: GPL-3.0-or-later
"""Compile one artist-selected NLA track into a portable clip schedule.

The NLA Editor remains the only strip editor. Blendlink records the selected
track's resolved, portable subset and Three.js composes the exported Actions;
there is intentionally no second Animator graph to keep in sync.
"""
from __future__ import annotations

import math


PORTABLE_BLEND_TYPES = {"REPLACE": "replace", "ADD": "add"}
PORTABLE_EXTRAPOLATION = {
    "NOTHING": "nothing",
    "HOLD_FORWARD": "hold-forward",
    "HOLD": "hold",
}
PORTABLE_EASING = {"LINEAR", "EASE_IN", "EASE_OUT", "EASE_IN_OUT"}


def _seconds(frames, fps):
    return round(float(frames) / fps, 6)


def _finite_number(value, path, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{path} must be a number")
    numeric = float(value)
    if not math.isfinite(numeric) or not minimum <= numeric <= maximum:
        raise ValueError(f"{path} must be between {minimum:g} and {maximum:g}")
    return numeric


def _stable_source(scene, object_id):
    matches = [
        obj for obj in scene.objects
        if obj.get("blendlink_id") == object_id
    ]
    if len(matches) != 1:
        raise ValueError(
            f"Animation Sequence source ID {object_id!r} no longer resolves to "
            "exactly one object in this Scene"
        )
    return matches[0]


def _track(source, track_name):
    animation = getattr(source, "animation_data", None)
    if animation is None:
        raise ValueError(
            f"Animation Sequence source {source.name!r} has no animation data"
        )
    matches = [track for track in animation.nla_tracks if track.name == track_name]
    if len(matches) != 1:
        raise ValueError(
            f"Animation Sequence NLA track {track_name!r} no longer resolves on "
            f"{source.name!r}"
        )
    return matches[0]


def collect_track(scene, source, track, *, name, loop, speed, easing):
    """Return the canonical portable record for one concrete NLA track."""
    if scene.objects.get(source.name) is not source:
        raise ValueError(
            f"Animation Sequence source {getattr(source, 'name', '<missing>')!r} "
            "is outside the active Scene"
        )
    if not bool(getattr(source, "is_editable", True)):
        raise ValueError(
            f"Animation Sequence source {source.name!r} is linked/read-only. "
            "Create a library override before publishing its NLA track."
        )
    if bool(getattr(source, "hide_render", False)):
        raise ValueError(
            f"Animation Sequence source {source.name!r} is disabled in renders, "
            "so Blender's website exporter will omit both the object and its "
            "Action clips. Enable its render camera icon before publishing."
        )
    animation = getattr(source, "animation_data", None)
    track_identity = int(track.as_pointer()) if hasattr(track, "as_pointer") else id(track)
    if animation is None or not any(
        (int(candidate.as_pointer()) if hasattr(candidate, "as_pointer") else id(candidate))
        == track_identity
        for candidate in animation.nla_tracks
    ):
        raise ValueError(
            f"Animation Sequence NLA track {getattr(track, 'name', '<missing>')!r} "
            f"does not belong to source {source.name!r}"
        )
    object_id = source.get("blendlink_id")
    if not isinstance(object_id, str) or not object_id:
        raise ValueError(
            f"Animation Sequence source {source.name!r} has no stable Blendlink ID; "
            "run Set Up Blendlink Scene and save once"
        )
    sequence_name = str(name).strip()
    if not sequence_name:
        raise ValueError("Animation Sequence needs a name")
    speed = _finite_number(speed, "Animation Sequence speed", 0.05, 4)
    easing = str(easing).upper()
    if easing not in PORTABLE_EASING:
        raise ValueError(f"Animation Sequence easing {easing!r} is not supported")
    fps = float(scene.render.fps) / float(scene.render.fps_base)
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError("Animation Sequence needs a positive Scene frame rate")

    source_strips = sorted(
        tuple(track.strips), key=lambda item: (float(item.frame_start), item.name),
    )
    if not source_strips:
        raise ValueError(
            f"Animation Sequence NLA track {track.name!r} has no strips"
        )
    origin = float(source_strips[0].frame_start)
    strips = []
    prior_end = None
    action_slots = {}
    for order, strip in enumerate(source_strips):
        if getattr(strip, "type", "CLIP") != "CLIP":
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} is {strip.type.title()}, not "
                "an Action Clip. Replace NLA Transition/Meta strips with Action "
                "strip Blend In/Out values before publishing."
            )
        action = getattr(strip, "action", None)
        if action is None:
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} has no Action"
            )
        action_slot = getattr(strip, "action_slot", None)
        if hasattr(strip, "action_slot") and action_slot is None:
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} has no Action slot. "
                "Reassign its Action to the source object before publishing."
            )
        action_identity = action.as_pointer()
        slot_identity = int(getattr(action_slot, "handle", 0))
        prior_slot = action_slots.get(action_identity)
        if prior_slot is not None and prior_slot != slot_identity:
            raise ValueError(
                f"Animation Sequence Action {action.name!r} is used with multiple "
                "Action slots. Split those slots into named Actions before publishing."
            )
        action_slots[action_identity] = slot_identity
        if bool(getattr(strip, "use_animated_time", False)):
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} animates strip time. "
                "Bake the time remap into an Action before publishing."
            )
        if bool(getattr(strip, "use_animated_influence", False)):
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} animates influence. "
                "Use Blend In/Out plus the Blendlink easing control instead."
            )
        blend_type = str(getattr(strip, "blend_type", "REPLACE"))
        if blend_type not in PORTABLE_BLEND_TYPES:
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} uses Blender-only "
                f"{blend_type.title()} blending. Use Replace or Add."
            )
        extrapolation = str(getattr(strip, "extrapolation", "HOLD"))
        if extrapolation not in PORTABLE_EXTRAPOLATION:
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} uses unsupported "
                f"extrapolation {extrapolation!r}"
            )
        frame_start = float(strip.frame_start)
        frame_end = float(strip.frame_end)
        if frame_end <= frame_start:
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} has no positive duration"
            )
        if prior_end is not None and frame_start < prior_end - 1e-4:
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} overlaps the previous "
                "strip. Choose one non-overlapping NLA track."
            )
        prior_end = frame_end
        action_start = float(action.frame_range[0])
        trim_start_frame = float(strip.action_frame_start) - action_start
        trim_end_frame = float(strip.action_frame_end) - action_start
        if trim_start_frame < -1e-4 or trim_end_frame <= trim_start_frame:
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} has an invalid Action trim"
            )
        scale = _finite_number(
            float(strip.scale), f"Animation Sequence strip {strip.name!r} scale", 0.01, 100,
        )
        repeat = _finite_number(
            float(strip.repeat), f"Animation Sequence strip {strip.name!r} repeat", 0.01, 1000,
        )
        clip_start = _seconds(trim_start_frame, fps)
        clip_end = _seconds(trim_end_frame, fps)
        duration = _seconds(frame_end - frame_start, fps)
        expected = (clip_end - clip_start) * scale * repeat
        if abs(duration - expected) > max(1e-4, expected * 1e-4):
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} has a time remap that "
                "does not reduce to trim × scale × repeat. Apply or simplify the "
                "NLA timing before publishing."
            )
        blend_in = _seconds(float(getattr(strip, "blend_in", 0.0)), fps)
        blend_out = _seconds(float(getattr(strip, "blend_out", 0.0)), fps)
        if blend_in > duration + 1e-5 or blend_out > duration + 1e-5:
            raise ValueError(
                f"Animation Sequence strip {strip.name!r} blend exceeds its duration"
            )
        weight = _finite_number(
            float(getattr(strip, "influence", 1.0)),
            f"Animation Sequence strip {strip.name!r} influence", 0, 1,
        )
        strips.append({
            "order": order,
            "name": strip.name,
            "clip": action.name,
            "at": _seconds(frame_start - origin, fps),
            "duration": duration,
            "clipStart": clip_start,
            "clipEnd": clip_end,
            "scale": round(scale, 6),
            "speed": round(1.0 / scale, 6),
            "repeat": round(repeat, 6),
            "blend": PORTABLE_BLEND_TYPES[blend_type],
            "blendIn": blend_in,
            "blendOut": blend_out,
            "weight": round(weight, 6),
            "easing": easing.lower().replace("_", "-"),
            "extrapolation": PORTABLE_EXTRAPOLATION[extrapolation],
            "reverse": bool(getattr(strip, "use_reverse", False)),
            "muted": bool(getattr(track, "mute", False) or getattr(strip, "mute", False)),
        })
    duration = max(item["at"] + item["duration"] for item in strips)
    return {
        "name": sequence_name,
        "source": {
            "objectId": object_id,
            "objectName": source.name,
            "track": track.name,
        },
        "duration": round(duration, 6),
        "loop": bool(loop),
        "speed": round(speed, 6),
        "strips": strips,
    }


def collect_project_sequence(project, scene):
    """Compile the add-on's opt-in controls; absent means website-owned."""
    if not bool(getattr(project, "animation_sequence_enabled", False)):
        return None
    source = getattr(project, "animation_sequence_source", None)
    if source is None:
        raise ValueError("Animation Sequence needs a Source object")
    track_name = str(getattr(project, "animation_sequence_track", "")).strip()
    if not track_name:
        raise ValueError("Animation Sequence needs one NLA Track")
    return collect_track(
        scene,
        source,
        _track(source, track_name),
        name=getattr(project, "animation_sequence_name", "Website Sequence"),
        loop=getattr(project, "animation_sequence_loop", False),
        speed=getattr(project, "animation_sequence_speed", 1.0),
        easing=getattr(project, "animation_sequence_easing", "EASE_IN_OUT"),
    )


def _validate_structure(record):
    if not isinstance(record, dict):
        raise ValueError("animationSequence must be an object")
    name = record.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("animationSequence.name is required")
    source = record.get("source")
    if not isinstance(source, dict):
        raise ValueError("animationSequence.source must be an object")
    for key in ("objectId", "objectName", "track"):
        if not isinstance(source.get(key), str) or not source[key].strip():
            raise ValueError(f"animationSequence.source.{key} is required")
    if not isinstance(record.get("loop"), bool):
        raise ValueError("animationSequence.loop must be true or false")
    _finite_number(record.get("speed"), "animationSequence.speed", 0.05, 4)
    duration = _finite_number(
        record.get("duration"), "animationSequence.duration", 0.000001, 86400,
    )
    strips = record.get("strips")
    if not isinstance(strips, list) or not strips:
        raise ValueError("animationSequence.strips needs at least one NLA clip")
    orders = set()
    prior_end = 0.0
    easings = set()
    for index, strip in enumerate(strips):
        path = f"animationSequence.strips[{index}]"
        if not isinstance(strip, dict):
            raise ValueError(f"{path} must be an object")
        order = strip.get("order")
        if isinstance(order, bool) or not isinstance(order, int) or order < 0:
            raise ValueError(f"{path}.order must be a non-negative integer")
        if order in orders:
            raise ValueError(f"{path}.order duplicates {order}")
        orders.add(order)
        for key in ("name", "clip"):
            if not isinstance(strip.get(key), str) or not strip[key].strip():
                raise ValueError(f"{path}.{key} is required")
        at = _finite_number(strip.get("at"), f"{path}.at", 0, 86400)
        strip_duration = _finite_number(
            strip.get("duration"), f"{path}.duration", 0.000001, 86400,
        )
        clip_start = _finite_number(strip.get("clipStart"), f"{path}.clipStart", 0, 86400)
        clip_end = _finite_number(strip.get("clipEnd"), f"{path}.clipEnd", 0.000001, 86400)
        if clip_end <= clip_start:
            raise ValueError(f"{path}.clipEnd must exceed clipStart")
        scale = _finite_number(strip.get("scale"), f"{path}.scale", 0.01, 100)
        speed = _finite_number(strip.get("speed"), f"{path}.speed", 0.01, 100)
        if abs(speed - 1.0 / scale) > max(1e-5, speed * 1e-4):
            raise ValueError(f"{path}.speed must be the reciprocal of scale")
        repeat = _finite_number(strip.get("repeat"), f"{path}.repeat", 0.01, 1000)
        expected = (clip_end - clip_start) * scale * repeat
        if abs(strip_duration - expected) > max(1e-4, expected * 1e-4):
            raise ValueError(f"{path}.duration disagrees with trim × scale × repeat")
        if strip.get("blend") not in {"replace", "add"}:
            raise ValueError(f"{path}.blend must be replace or add")
        _finite_number(strip.get("blendIn"), f"{path}.blendIn", 0, strip_duration)
        _finite_number(strip.get("blendOut"), f"{path}.blendOut", 0, strip_duration)
        _finite_number(strip.get("weight"), f"{path}.weight", 0, 1)
        easing = strip.get("easing")
        if easing not in {"linear", "ease-in", "ease-out", "ease-in-out"}:
            raise ValueError(f"{path}.easing is not portable")
        easings.add(easing)
        if strip.get("extrapolation") not in {"nothing", "hold-forward", "hold"}:
            raise ValueError(f"{path}.extrapolation is not portable")
        for key in ("reverse", "muted"):
            if not isinstance(strip.get(key), bool):
                raise ValueError(f"{path}.{key} must be true or false")
        if index and at < prior_end - 1e-4:
            raise ValueError(f"{path}.at overlaps the prior strip")
        prior_end = at + strip_duration
    if len(easings) != 1:
        raise ValueError(
            "animationSequence strips must share one Blendlink easing setting"
        )
    if abs(duration - prior_end) > max(1e-4, duration * 1e-4):
        raise ValueError("animationSequence.duration does not end with its last strip")


def _records_agree(left, right):
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(
            _records_agree(left[key], right[key]) for key in left
        )
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            _records_agree(a, b) for a, b in zip(left, right)
        )
    if isinstance(left, (int, float)) and not isinstance(left, bool) \
            and isinstance(right, (int, float)) and not isinstance(right, bool):
        return abs(float(left) - float(right)) <= max(1e-6, abs(float(left)) * 1e-6)
    return left == right


def validate_published_sequence(record, scene=None):
    """Validate stored metadata, and when possible prove it matches the NLA."""
    if record is None:
        return None
    _validate_structure(record)
    if scene is None:
        return record
    source = _stable_source(scene, record["source"]["objectId"])
    easing = record["strips"][0]["easing"].upper().replace("-", "_")
    current = collect_track(
        scene,
        source,
        _track(source, record["source"]["track"]),
        name=record["name"],
        loop=record["loop"],
        speed=record["speed"],
        easing=easing,
    )
    if not _records_agree(record, current):
        raise ValueError(
            "Animation Sequence metadata no longer matches the selected NLA track. "
            "Save the .blend once to refresh strip order, trims, timing, and blending."
        )
    return record


def exporter_policy(supported, overrides, enabled):
    """Exporter settings required for deterministic Action/trim references."""
    if not enabled:
        return {}
    desired = {
        "export_animation_mode": "ACTIONS",
        "export_anim_slide_to_zero": True,
        "export_nla_strips": True,
        "export_merge_animation": "ACTION",
    }
    essential = {"export_animation_mode", "export_anim_slide_to_zero"}
    missing = sorted(essential - set(supported))
    if missing:
        raise ValueError(
            "This Blender glTF exporter cannot create the zero-based Action clips "
            "required by Animation Sequence trims (missing "
            + ", ".join(missing)
            + "). Update Blender or turn off Use NLA Sequence."
        )
    owned = {key: value for key, value in desired.items() if key in supported}
    for key, value in owned.items():
        if key in overrides and overrides[key] != value:
            raise ValueError(
                f"exporterOverrides.{key}={overrides[key]!r} conflicts with the "
                f"Animation Sequence export contract ({value!r})"
            )
    return owned


def prepare_action_export(record, scene):
    """Expose a multi-strip sequence as temporary one-Action stash tracks.

    Blender's stock ACTIONS exporter deliberately skips every NLA track with
    more than one non-muted strip. The website sequence needs the underlying
    Actions, not Blender's evaluated track, so temporarily give each Action
    that is not already discoverable one single-strip stash track. Authored
    track/strip state remains untouched. The caller must always pass the
    returned state to :func:`restore_action_export`.
    """
    if record is None:
        return None
    validate_published_sequence(record, scene)
    source = _stable_source(scene, record["source"]["objectId"])
    source_track = _track(source, record["source"]["track"])
    animation = source.animation_data
    state = {
        "animation": animation,
        "source": source,
        "temporaryTracks": [],
    }
    try:
        by_action = {}
        non_muted = [
            strip for strip in source_track.strips
            if strip.action is not None and not bool(strip.mute)
        ]
        discoverable = None
        if len(non_muted) == 1:
            visible_strip = non_muted[0]
            visible_slot = getattr(visible_strip, "action_slot", None)
            if not hasattr(visible_strip, "action_slot") or visible_slot is not None:
                discoverable = (
                    int(visible_strip.action.as_pointer()),
                    int(getattr(visible_slot, "handle", 0)),
                )
        for strip in source_track.strips:
            action = strip.action
            slot = getattr(strip, "action_slot", None)
            identity = int(action.as_pointer())
            slot_identity = (
                int(getattr(slot, "handle", 0)) if slot is not None else 0
            )
            existing = by_action.get(identity)
            if existing is not None and existing[0] != slot_identity:
                raise ValueError(
                    f"Animation Sequence Action {action.name!r} is used with multiple "
                    "Action slots. Split those slots into named Actions before publishing."
                )
            by_action[identity] = (slot_identity, strip)
        staged = [
            entry for action_identity, entry in by_action.items()
            if (action_identity, entry[0]) != discoverable
        ]
        for index, (_slot_identity, strip) in enumerate(staged):
            action = strip.action
            temporary = animation.nla_tracks.new()
            temporary.name = f"[Action Stash] Blendlink {index + 1:03d} {action.name}"
            state["temporaryTracks"].append(temporary)
            # Blender's ACTIONS discovery inspects non-muted strips even on a
            # muted track. Keep the staging tracks muted so they expose their
            # Action slots without changing the evaluated scene pose.
            temporary.mute = True
            action_start = int(math.floor(float(action.frame_range[0])))
            temporary_strip = temporary.strips.new(action.name, action_start, action)
            action_slot = getattr(strip, "action_slot", None)
            if action_slot is not None and hasattr(temporary_strip, "action_slot"):
                temporary_strip.action_slot = action_slot
        print(
            f"blendlink: temporarily exposed {len(state['temporaryTracks'])} "
            f"Animation Sequence Action(s) from NLA track {source_track.name!r}"
        )
        return state
    except Exception:
        restore_action_export(state)
        raise


def restore_action_export(state):
    """Restore exact authored strip mute values and remove temporary tracks."""
    if state is None:
        return
    animation = state["animation"]
    errors = []
    for track in reversed(state["temporaryTracks"]):
        try:
            animation.nla_tracks.remove(track)
        except (ReferenceError, RuntimeError) as error:
            errors.append(f"remove temporary track: {error}")
    if errors:
        raise RuntimeError(
            "Animation Sequence export could not restore Blender NLA state: "
            + "; ".join(errors)
        )
