# SPDX-License-Identifier: GPL-3.0-or-later
"""Responsive framing and visual-reference planning.

This module is deliberately free of ``bpy``.  Blender's UI/render adapter and
the headless tests exercise the same small interface:

``parse_frame_spec`` turns an artist-friendly frame expression into poses,
``overlay_geometry`` resolves crop/safe-zone rectangles, and
``build_reference_matrix`` creates the complete Blender x website comparison
contract.  Browser pixels never enter this module disguised as Blender pixels.
"""
from __future__ import annotations

import math
import re


MATRIX_SCHEMA_VERSION = 1
MAX_REFERENCE_FRAMES = 128
MAX_CAPTURE_DIMENSION = 8192

_FRAME_RANGE = re.compile(r"^(-?\d+)\s*-\s*(-?\d+)(?:\s*[x:]\s*(\d+))?$")


def parse_frame_spec(
    spec: str,
    *,
    current: int,
    start: int,
    end: int,
    limit: int = MAX_REFERENCE_FRAMES,
) -> list[int]:
    """Resolve ``current,start,end,1,12-48x12`` into ordered unique frames.

    Frames outside the authored scene range are rejected instead of silently
    clamped: a comparison that claims to cover a pose must actually cover it.
    """
    if start > end:
        raise ValueError(f"scene frame range is invalid: {start}..{end}")
    raw_tokens = [token.strip().lower() for token in spec.split(",") if token.strip()]
    if not raw_tokens:
        raise ValueError("reference frames are empty; use current, start, end, or frame numbers")
    aliases = {"current": current, "start": start, "end": end}
    frames: list[int] = []
    seen: set[int] = set()

    def append(frame: int) -> None:
        if frame < start or frame > end:
            raise ValueError(f"reference frame {frame} is outside scene range {start}..{end}")
        if frame not in seen:
            seen.add(frame)
            frames.append(frame)
        if len(frames) > limit:
            raise ValueError(
                f"reference frame expression expands past {limit} poses; "
                "use a larger range step or a shorter list"
            )

    for token in raw_tokens:
        if token in aliases:
            append(aliases[token])
            continue
        if re.fullmatch(r"-?\d+", token):
            append(int(token))
            continue
        match = _FRAME_RANGE.fullmatch(token)
        if match is None:
            raise ValueError(
                f"cannot read reference frame token {token!r}; "
                "use current, start, end, a frame, or an inclusive range such as 1-48x12"
            )
        first, last = int(match.group(1)), int(match.group(2))
        step = int(match.group(3) or 1)
        if step < 1:
            raise ValueError(f"reference frame range {token!r} needs a positive step")
        direction = 1 if last >= first else -1
        for frame in range(first, last + direction, direction * step):
            append(frame)
        if frames[-1] != last:
            append(last)
    return frames


def overlay_geometry(
    region: tuple[float, float, float, float],
    camera_frame: tuple[float, float, float, float],
    safe_margin: float,
) -> dict:
    """Return clipped crop bars, exact camera frame, and page-safe frame.

    Rectangles are ``(left, bottom, right, top)`` in viewport pixels.  The
    camera frame may extend beyond the region while zoomed; crop bars are
    always clipped so GPU batches remain small and predictable.
    """
    left, bottom, right, top = region
    frame_left, frame_bottom, frame_right, frame_top = camera_frame
    if right <= left or top <= bottom:
        raise ValueError("overlay region has no area")
    if frame_right <= frame_left or frame_top <= frame_bottom:
        raise ValueError("camera frame has no area")
    if not 0.0 <= safe_margin <= 0.45:
        raise ValueError("safe margin must be between 0 and 0.45")

    clipped_left = max(left, min(right, frame_left))
    clipped_right = max(left, min(right, frame_right))
    clipped_bottom = max(bottom, min(top, frame_bottom))
    clipped_top = max(bottom, min(top, frame_top))
    crop = [
        (left, bottom, clipped_left, top),
        (clipped_right, bottom, right, top),
        (clipped_left, bottom, clipped_right, clipped_bottom),
        (clipped_left, clipped_top, clipped_right, top),
    ]
    crop = [rect for rect in crop if rect[2] > rect[0] and rect[3] > rect[1]]
    width, height = frame_right - frame_left, frame_top - frame_bottom
    safe = (
        frame_left + width * safe_margin,
        frame_bottom + height * safe_margin,
        frame_right - width * safe_margin,
        frame_top - height * safe_margin,
    )
    return {"crop": crop, "frame": camera_frame, "safe": safe}


def build_reference_matrix(
    *,
    source_blend: str,
    cameras: list[dict],
    states: list[dict],
    compositions: list[dict],
    frame_spec: str,
    current_frame: int,
    frame_start: int,
    frame_end: int,
    fps: float,
    device_pixel_ratio: float,
    qualities: tuple[str, ...] = ("preview", "final"),
) -> dict:
    """Build the deterministic capture/comparison cross product.

    Blender references are quality-independent source truth and are captured
    once.  Preview/Final browser cells intentionally point to that same source
    truth while reserving different website pixels and diff images.
    """
    if not source_blend:
        raise ValueError("save the .blend before building a reference matrix")
    if not cameras:
        raise ValueError("reference matrix needs at least one camera")
    if not states:
        raise ValueError("reference matrix needs at least one lighting state")
    if not compositions:
        raise ValueError("reference matrix needs at least one responsive composition")
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError("scene frame rate must be positive")
    if not math.isfinite(device_pixel_ratio) or not 0.5 <= device_pixel_ratio <= 4.0:
        raise ValueError("reference device pixel ratio must be between 0.5 and 4")
    if not qualities or any(quality not in {"preview", "final"} for quality in qualities):
        raise ValueError("reference qualities must be preview and/or final")
    frames = parse_frame_spec(
        frame_spec, current=current_frame, start=frame_start, end=frame_end,
    )

    normalized_cameras = []
    camera_ids = set()
    for camera in cameras:
        object_id = str(camera.get("objectId", "")).strip()
        object_name = str(camera.get("objectName", "")).strip()
        if not object_id or not object_name:
            raise ValueError("every reference camera needs a stable objectId and objectName")
        if object_id in camera_ids:
            raise ValueError(f"duplicate reference camera ID {object_id!r}")
        camera_ids.add(object_id)
        normalized_cameras.append({"objectId": object_id, "objectName": object_name})

    normalized_states = []
    state_names = set()
    for state in states:
        name = str(state.get("name", "")).strip()
        if not name:
            raise ValueError("every reference lighting state needs a name")
        if name in state_names:
            raise ValueError(f"duplicate reference lighting state {name!r}")
        state_names.add(name)
        hidden = state.get("hideCollections") or []
        normalized_states.append({"name": name, "hideCollections": list(hidden)})

    normalized_compositions = []
    composition_names = set()
    for composition in compositions:
        name = str(composition.get("name", "")).strip()
        width, height = int(composition.get("width", 0)), int(composition.get("height", 0))
        safe_margin = float(composition.get("safeMargin", 0.0))
        if not name:
            raise ValueError("every reference composition needs a name")
        if name in composition_names:
            raise ValueError(f"duplicate reference composition {name!r}")
        if width < 1 or height < 1:
            raise ValueError(f"reference composition {name!r} needs a positive width and height")
        if not 0 <= safe_margin <= 0.45:
            raise ValueError(f"reference composition {name!r} has an invalid safe margin")
        backing_width, backing_height = round(width * device_pixel_ratio), round(height * device_pixel_ratio)
        if max(backing_width, backing_height) > MAX_CAPTURE_DIMENSION:
            raise ValueError(
                f"reference composition {name!r} resolves to {backing_width}x{backing_height}; "
                f"the capture limit is {MAX_CAPTURE_DIMENSION}px per edge"
            )
        safe_x, safe_y = round(backing_width * safe_margin), round(backing_height * safe_margin)
        normalized_compositions.append({
            "name": name,
            "cssWidth": width,
            "cssHeight": height,
            "devicePixelRatio": device_pixel_ratio,
            "backingWidth": backing_width,
            "backingHeight": backing_height,
            "safeMargin": safe_margin,
            "safeRect": {
                "origin": "top-left",
                "x": safe_x,
                "y": safe_y,
                "width": backing_width - safe_x * 2,
                "height": backing_height - safe_y * 2,
            },
        })
        composition_names.add(name)

    references = []
    comparisons = []
    for camera_index, camera in enumerate(normalized_cameras, 1):
        for state_index, state in enumerate(normalized_states, 1):
            for composition_index, composition in enumerate(normalized_compositions, 1):
                for frame in frames:
                    reference_id = _reference_id(
                        camera_index, camera["objectName"], state_index, state["name"],
                        composition_index, composition["name"], frame,
                    )
                    blender_path = f"blender/{reference_id}.png"
                    references.append({
                        "id": reference_id,
                        "camera": camera,
                        "lightingState": state,
                        "composition": composition,
                        "pose": {
                            "frame": frame,
                            "timeSeconds": (frame - frame_start) / fps,
                        },
                        "blender": {"status": "required", "path": blender_path},
                    })
                    for quality in qualities:
                        comparisons.append({
                            "id": f"{reference_id}--{quality}",
                            "referenceId": reference_id,
                            "quality": quality,
                            "buildCommand": (
                                "npx blendlink compile --preview"
                                if quality == "preview" else "npx blendlink compile"
                            ),
                            "browser": {
                                "status": "required",
                                "path": f"browser/{quality}/{reference_id}.png",
                                "viewport": {
                                    "width": composition["cssWidth"],
                                    "height": composition["cssHeight"],
                                    "devicePixelRatio": device_pixel_ratio,
                                },
                                "cameraObjectId": camera["objectId"],
                                "lightingState": state["name"],
                                "frame": frame,
                                "timeSeconds": (frame - frame_start) / fps,
                            },
                            "comparison": {
                                "status": "pending",
                                "path": f"diff/{quality}/{reference_id}.png",
                            },
                        })

    return {
        "schemaVersion": MATRIX_SCHEMA_VERSION,
        "kind": "blendlink-visual-reference-matrix",
        "sourceBlend": source_blend,
        "captureTruth": (
            "Blender paths contain Blender source renders only. Browser paths are mandatory "
            "website captures and are never synthesized or marked complete by Blender."
        ),
        "browserAuditAdapter": {
            "package": "blendlink",
            "export": "runVisualReferenceAudit",
            "comparisonSpace": "premultiplied-rgba",
            "acceptance": "project-owned; omitted means measured without pass/fail",
        },
        "browserCaptureProtocol": [
            "Run buildCommand for the comparison quality.",
            "Open the real website at the requested CSS viewport and devicePixelRatio.",
            "Select cameraObjectId and lightingState, pause animation, then seek to timeSeconds.",
            "Write the website screenshot to browser.path without resizing it.",
            "Verify its backing dimensions and source .blend hash before accepting the capture.",
            "Compare it with the Blender reference and write the visual diff to comparison.path.",
        ],
        "matrix": {
            "cameraCount": len(normalized_cameras),
            "lightingStateCount": len(normalized_states),
            "compositionCount": len(normalized_compositions),
            "poseCount": len(frames),
            "qualityCount": len(qualities),
            "blenderReferenceCount": len(references),
            "comparisonCount": len(comparisons),
        },
        "references": references,
        "comparisons": comparisons,
    }


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "unnamed"
    return slug[:24].rstrip("-")


def _reference_id(
    camera_index: int,
    camera_name: str,
    state_index: int,
    state_name: str,
    composition_index: int,
    composition_name: str,
    frame: int,
) -> str:
    frame_label = f"m{abs(frame):05d}" if frame < 0 else f"{frame:05d}"
    return (
        f"c{camera_index:02d}-{_slug(camera_name)}__"
        f"s{state_index:02d}-{_slug(state_name)}__"
        f"v{composition_index:02d}-{_slug(composition_name)}__f{frame_label}"
    )
