# SPDX-License-Identifier: GPL-3.0-or-later
"""Deep reflection-probe authoring module.

Callers use three operations only:

``prepare_status_cache(scene)``
    Derive artist-facing source/staleness evidence outside draw callbacks.
``status_for(probe)``
    Read the cached immutable status for UI and tests.
``bake(context, probes)``
    Render and atomically commit one or many Blender-baked probe assets.

The module owns source validation, dependency evidence, output paths,
transactional replacement, image datablocks, and rollback. Panoramic
render/save mechanics remain in canonical ``bakelib.py``.
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import time
import uuid
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable


DERIVED_DIRECTORY = Path("blendlink-derived") / "reflection-probes"
_VALID_MODES = {"RUNTIME", "BAKED", "CUSTOM"}
_FORMAT_BY_EXTENSION = {
    ".hdr": "hdr",
    ".exr": "exr",
    ".png": "png",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".webp": "webp",
}
_FORMAT_BY_BLENDER = {
    "HDR": "hdr",
    "OPEN_EXR": "exr",
    "OPEN_EXR_MULTILAYER": "exr",
    "PNG": "png",
    "JPEG": "jpeg",
    "WEBP": "webp",
}


@dataclass(frozen=True)
class ImageEvidence:
    valid: bool
    issue: str
    image_name: str = ""
    path: str = ""
    source: str = ""
    format: str = ""
    color_space: str = "linear"
    width: int = 0
    height: int = 0
    bytes: int = 0
    content_hash: str = ""


@dataclass(frozen=True)
class ProbeStatus:
    code: str
    label: str
    detail: str
    severity: str
    mode: str
    source_hash: str = ""
    expected_source_hash: str = ""
    image: object | None = None
    evidence: ImageEvidence | None = None


@dataclass(frozen=True)
class ProbeBakeResult:
    name: str
    path: str
    width: int
    height: int
    samples: int
    bytes: int
    content_hash: str
    source_hash: str
    device_class: str
    backend: str


@dataclass
class _PendingBake:
    probe: object
    temp_path: Path
    final_path: Path
    relative_path: str
    source_hash: str
    render: dict
    backup_path: Path | None = None
    committed: bool = False
    loaded_image: object | None = None


_cache = {
    "dirty": True,
    "dirty_at": 0.0,
    "scene_pointer": None,
    "statuses": {},
    "status_token": (),
}


def slug(value: str) -> str:
    """Filesystem-safe readable identity; never used as the stable key."""
    result = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return result or "reflection-probe"


def mode_of(probe) -> str:
    mode = str(getattr(probe, "capture_mode", "RUNTIME") or "RUNTIME").upper()
    return mode if mode in _VALID_MODES else "RUNTIME"


def relative_asset_path(name: str, object_id: str) -> str:
    """Stable owned path. Renaming later does not move an existing asset."""
    identity = re.sub(r"[^A-Za-z0-9]+", "", str(object_id))[:12].lower()
    if not identity:
        raise ValueError("save the scene once so this reflection probe has a stable identity")
    filename = f"{slug(name)}-{identity}.exr"
    return "//" + (DERIVED_DIRECTORY / filename).as_posix()


def _hash_bytes(payload: bytes, length: int = 16) -> str:
    return hashlib.sha256(payload).hexdigest()[:length]


def _hash_file(path: Path, length: int = 16) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()[:length]


def _format_matches_header(image_format: str, header: bytes) -> bool:
    signatures = {
        "exr": lambda value: value.startswith(bytes((0x76, 0x2F, 0x31, 0x01))),
        "hdr": lambda value: value.startswith((b"#?RADIANCE", b"#?RGBE")),
        "png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
        "webp": lambda value: len(value) >= 12
        and value.startswith(b"RIFF") and value[8:12] == b"WEBP",
    }
    return signatures[image_format](header)


def infer_image_format(image, raw_path: str) -> str:
    extension = Path(raw_path).suffix.lower() if raw_path else ""
    return _FORMAT_BY_EXTENSION.get(
        extension,
        _FORMAT_BY_BLENDER.get(str(getattr(image, "file_format", "")), ""),
    )


def _linear_color_space(image, image_format: str) -> str:
    if image_format in {"hdr", "exr"}:
        return "linear"
    authored = str(getattr(getattr(image, "colorspace_settings", None), "name", ""))
    return "linear" if authored in {"Non-Color", "Linear", "Linear Rec.709"} else "srgb"


def inspect_image(
        image, *, resolve_path: Callable[[str, object | None], str] | None = None,
        expected_hash: str = "") -> ImageEvidence:
    """Inspect exact source bytes and web suitability without mutating Image."""
    if image is None:
        return ImageEvidence(False, "Choose a reflection texture")
    width, height = (int(value) for value in image.size[:2])
    if width <= 0 or height <= 0:
        return ImageEvidence(False, f"{image.name} has no loaded pixels", image_name=image.name)
    if width < 32 or height < 16 or width > 8192 or height > 4096:
        return ImageEvidence(
            False,
            f"{image.name} is {width} x {height}; portable reflection sources must be "
            "between 32 x 16 and 8192 x 4096",
            image_name=image.name, width=width, height=height,
        )
    if width != height * 2:
        return ImageEvidence(
            False,
            f"{image.name} must be a 2:1 equirectangular image; it is {width} x {height}",
            image_name=image.name, width=width, height=height,
        )

    resolver = resolve_path
    if resolver is None:
        import bpy
        resolver = lambda value, library: bpy.path.abspath(value, library=library)
    raw_path = resolver(str(getattr(image, "filepath", "") or ""), getattr(image, "library", None))
    image_format = infer_image_format(image, raw_path)
    if image_format not in set(_FORMAT_BY_EXTENSION.values()):
        return ImageEvidence(
            False,
            f"{image.name} needs HDR, EXR, PNG, JPEG, or WebP source bytes",
            image_name=image.name, path=raw_path, width=width, height=height,
        )

    packed_files = list(getattr(image, "packed_files", ()))
    packed = getattr(image, "packed_file", None)
    if packed is not None and not packed_files:
        packed_files = [packed]
    if len(packed_files) > 1:
        return ImageEvidence(
            False,
            f"{image.name} is tiled/multi-packed; reflection probes require one equirectangular file",
            image_name=image.name, path=raw_path, format=image_format,
            width=width, height=height,
        )
    try:
        if packed_files:
            packed_entry = packed_files[0]
            nested = getattr(packed_entry, "packed_file", None)
            packed_source = nested if nested is not None else packed_entry
            payload = bytes(packed_source.data)
            size = len(payload)
            content_hash = _hash_bytes(payload)
            header = payload[:16]
            source = "packed"
        else:
            path = Path(raw_path)
            if not raw_path or not path.is_file():
                return ImageEvidence(
                    False,
                    f"{image.name} points to missing source file {raw_path or '<empty path>'}",
                    image_name=image.name, path=raw_path, format=image_format,
                    width=width, height=height,
                )
            size, content_hash = _hash_file(path)
            with path.open("rb") as stream:
                header = stream.read(16)
            source = "linked"
    except (OSError, RuntimeError, ValueError) as error:
        return ImageEvidence(
            False,
            f"Could not read {image.name} source bytes: {type(error).__name__}: {error}",
            image_name=image.name, path=raw_path, format=image_format,
            width=width, height=height,
        )
    if size <= 0:
        return ImageEvidence(
            False, f"{image.name} contains no source bytes",
            image_name=image.name, path=raw_path, source=source,
            format=image_format, width=width, height=height,
        )
    if not _format_matches_header(image_format, header):
        return ImageEvidence(
            False,
            f"{image.name} bytes do not match the declared {image_format.upper()} format",
            image_name=image.name, path=raw_path, source=source,
            format=image_format, width=width, height=height, bytes=size,
            content_hash=content_hash,
        )
    evidence = ImageEvidence(
        True, "", image_name=image.name, path=raw_path, source=source,
        format=image_format, color_space=_linear_color_space(image, image_format),
        width=width, height=height, bytes=size, content_hash=content_hash,
    )
    if expected_hash and content_hash != expected_hash:
        return replace(
            evidence, valid=False,
            issue=(
                f"{image.name} bytes changed ({content_hash}; expected {expected_hash}). "
                "Bake again, or switch to Custom Texture to preserve the edited file"
            ),
        )
    return evidence


def probe_origin(probe) -> tuple[float, float, float]:
    source = getattr(probe, "anchor", None) or getattr(probe, "probe_object", None)
    if source is None:
        raise ValueError("the reflection probe helper is missing")
    translation = source.matrix_world.translation
    values = tuple(float(translation[index]) for index in range(3))
    if not all(math.isfinite(value) for value in values):
        raise ValueError("the reflection probe capture origin is not finite")
    return values


def assigned_receivers(scene, probe) -> tuple[object, ...]:
    """Return the exact meshes that must not photograph themselves.

    Assignment remains explicit and object-owned. Sorting by stable identity
    makes dependency evidence independent of Blender collection iteration
    order; the canonical fingerprint rejects missing or duplicate IDs.
    """
    object_id = str(getattr(probe, "object_id", "") or "")
    if not object_id:
        raise ValueError(f"{getattr(probe, 'name', 'reflection probe')} has no stable identity")
    return tuple(sorted(
        (
            obj for obj in scene.objects
            if obj.type == "MESH"
            and obj.get("blendlink_reflection_probe") == object_id
        ),
        key=lambda obj: (
            str(obj.get("blendlink_id", "")),
            obj.name.casefold(),
        ),
    ))


def known_cycles_capture_blockers(scene, *, excluded_objects=()) -> tuple[str, ...]:
    """Report recognized Eevee-only contributors to an offline probe.

    This is deliberately a known-blocker detector, not a claim that every
    Cycles/Eevee difference can be classified statically.
    """
    from . import procedural

    excluded = {obj.as_pointer() for obj in excluded_objects}
    seen_materials = set()
    blockers = []
    for obj in scene.objects:
        if obj.type != "MESH" or obj.hide_render or obj.as_pointer() in excluded:
            continue
        for slot in obj.material_slots:
            material = slot.material
            if material is None or material.as_pointer() in seen_materials:
                continue
            seen_materials.add(material.as_pointer())
            compatibility = procedural.analyze_material(material)["cyclesAppearance"]
            for blocker in compatibility["blockers"]:
                blockers.append(
                    f"{material.name} (used by {obj.name}): "
                    + blocker.replace(
                        "Blendlink's Cycles Appearance bake",
                        "Blendlink's offline Cycles reflection capture",
                    )
                )
    return tuple(blockers)


def _status_error(mode: str, detail: str, image=None, evidence=None) -> ProbeStatus:
    return ProbeStatus(
        "ERROR", "Source needs attention", detail, "ERROR", mode,
        image=image, evidence=evidence,
    )


def evaluate_status(
        scene, probe, *, scene_fingerprint: str | None = None,
        resolve_path: Callable[[str, object | None], str] | None = None) -> ProbeStatus:
    """Compute complete observable source state for one authored probe."""
    mode = mode_of(probe)
    if mode == "RUNTIME":
        return ProbeStatus(
            "RUNTIME", "Captured when the website loads",
            "No texture is stored; Three.js captures the rendered scene once at startup.",
            "INFO", mode,
        )
    image = (
        getattr(probe, "custom_image", None)
        if mode == "CUSTOM" else
        getattr(probe, "baked_image", None)
    )
    expected_content = (
        str(getattr(probe, "baked_content_hash", "") or "")
        if mode == "BAKED" else ""
    )
    evidence = inspect_image(
        image, resolve_path=resolve_path, expected_hash=expected_content,
    )
    if not evidence.valid:
        return _status_error(mode, evidence.issue, image=image, evidence=evidence)
    if mode == "CUSTOM":
        dynamic_range = "HDR" if evidence.format in {"hdr", "exr"} else "LDR"
        return ProbeStatus(
            "READY", "Custom texture ready",
            f"{dynamic_range} {evidence.format.upper()} · {evidence.width} x {evidence.height} · "
            f"{evidence.source} · {evidence.content_hash}",
            "OK", mode, source_hash=evidence.content_hash,
            image=image, evidence=evidence,
        )

    stored_source = str(getattr(probe, "baked_source_hash", "") or "")
    if not stored_source:
        return ProbeStatus(
            "STALE", "Bake required",
            "This probe has image bytes but no dependency evidence. Bake it once with this Blendlink version.",
            "WARNING", mode, image=image, evidence=evidence,
        )
    try:
        from .bakelib_loader import bakelib
        receivers = assigned_receivers(scene, probe)
        expected_source = bakelib.fingerprint_reflection_probe_dependencies(
            scene,
            probe_origin(probe),
            int(probe.resolution),
            int(probe.samples),
            scene_fingerprint=scene_fingerprint,
            excluded_objects=receivers,
        )
    except Exception as error:
        return _status_error(
            mode,
            f"Could not inspect bake dependencies: {type(error).__name__}: {error}",
            image=image, evidence=evidence,
        )
    if stored_source != expected_source:
        return ProbeStatus(
            "STALE", "Scene changed — bake again",
            f"Stored source {stored_source}; current source {expected_source}.",
            "WARNING", mode, source_hash=stored_source,
            expected_source_hash=expected_source, image=image, evidence=evidence,
        )
    return ProbeStatus(
        "READY", "Bake is current",
        f"{evidence.width} x {evidence.height} · {int(probe.samples)} samples · "
        f"{evidence.bytes:,} bytes · {evidence.content_hash}",
        "OK", mode, source_hash=stored_source,
        expected_source_hash=expected_source, image=image, evidence=evidence,
    )


def mark_dirty(scene=None) -> None:
    _cache["dirty"] = True
    _cache["dirty_at"] = time.monotonic()
    if scene is not None:
        try:
            _cache["scene_pointer"] = scene.as_pointer()
        except (AttributeError, ReferenceError):
            _cache["scene_pointer"] = None


def prepare_status_cache(scene=None, *, force: bool = False) -> bool:
    """Refresh status after a quiet period; safe for the shared UI timer."""
    import bpy
    scene = scene or getattr(bpy.context, "scene", None)
    project = getattr(scene, "blendlink_project", None) if scene is not None else None
    if scene is None or project is None:
        return False
    pointer = scene.as_pointer()
    if not force:
        if not _cache["dirty"] and _cache["scene_pointer"] == pointer:
            return False
        if time.monotonic() - float(_cache["dirty_at"]) < 0.6:
            return False
    probes = list(project.reflection_probes)
    baked = [probe for probe in probes if mode_of(probe) == "BAKED"]
    scene_fingerprint = None
    try:
        if baked:
            from .bakelib_loader import bakelib
            scene_fingerprint = bakelib.fingerprint_reflection_scene_dependencies(scene)
        statuses = {
            str(probe.object_id): evaluate_status(
                scene, probe, scene_fingerprint=scene_fingerprint,
            )
            for probe in probes
        }
    except Exception as error:
        message = f"Could not refresh reflection probe status: {type(error).__name__}: {error}"
        print(f"blendlink addon: {message}")
        statuses = {
            str(probe.object_id): _status_error(mode_of(probe), message)
            for probe in probes
        }
    # Blender generates an Image's preview lazily, and asking for it is real
    # work, so the panel cannot do it from draw(). Requesting it here means the
    # probe thumbnail is ready by the time the panel next redraws.
    for status in statuses.values():
        image = getattr(status, "image", None)
        preview_ensure = getattr(image, "preview_ensure", None)
        if callable(preview_ensure):
            try:
                preview_ensure()
            except (AttributeError, ReferenceError, RuntimeError) as error:
                print(
                    "blendlink addon: could not prepare the reflection preview "
                    f"for {getattr(image, 'name', '?')!r}: "
                    f"{type(error).__name__}: {error}"
                )
    status_token = tuple(sorted(
        (
            key, status.code, status.label, status.detail, status.severity,
            status.mode, status.source_hash, status.expected_source_hash,
            status.evidence,
        )
        for key, status in statuses.items()
    ))
    changed = status_token != _cache["status_token"] or pointer != _cache["scene_pointer"]
    _cache.update(
        dirty=False,
        scene_pointer=pointer,
        statuses=statuses,
        status_token=status_token,
    )
    return changed


def status_for(probe) -> ProbeStatus:
    current_mode = mode_of(probe)
    owner = getattr(probe, "id_data", None)
    try:
        owner_pointer = owner.as_pointer() if owner is not None else _cache["scene_pointer"]
    except (AttributeError, ReferenceError, RuntimeError):
        owner_pointer = None
    status = _cache["statuses"].get(str(getattr(probe, "object_id", "")))
    # RNA update callbacks invalidate immediately, while the shared timer
    # deliberately waits for a quiet period before hashing a large scene.
    # Never show prior-mode Ready evidence during that debounce window.
    if not _cache["dirty"] and owner_pointer == _cache["scene_pointer"] \
            and status is not None and status.mode == current_mode:
        if status.image is not None:
            try:
                status.image.as_pointer()
            except (AttributeError, ReferenceError, RuntimeError):
                return ProbeStatus(
                    "CHECKING", "Checking source…",
                    "The previous reflection image was removed; Blendlink is rebuilding evidence.",
                    "INFO", current_mode,
                )
        return status
    return ProbeStatus(
        "CHECKING", "Checking source…",
        "Blendlink is rebuilding reflection probe evidence.",
        "INFO", current_mode,
    )


def _owned_final_path(blend_path: str, probe) -> tuple[Path, str]:
    source = Path(blend_path).resolve()
    if not source.is_file():
        raise ValueError("save this .blend before baking reflection probes")
    owned_root = (source.parent / DERIVED_DIRECTORY).resolve()
    relative = str(getattr(probe, "derived_asset_path", "") or "")
    if not relative:
        relative = relative_asset_path(probe.name, probe.object_id)
    normalized = relative.replace("\\", "/")
    expected_prefix = "//" + DERIVED_DIRECTORY.as_posix() + "/"
    if not normalized.startswith(expected_prefix):
        raise ValueError(
            f"{probe.name} has an unsafe derived asset path {relative!r}; "
            f"it must stay under {expected_prefix}"
        )
    suffix = normalized[len(expected_prefix):]
    if not suffix or "/" in suffix or Path(suffix).suffix.lower() != ".exr":
        raise ValueError(f"{probe.name} has an invalid derived reflection filename {suffix!r}")
    final_path = (owned_root / suffix).resolve()
    if final_path.parent != owned_root:
        raise ValueError(f"{probe.name} derived reflection path escapes its owned folder")
    return final_path, normalized


def _cleanup_pending(pending: Iterable[_PendingBake]) -> None:
    errors = []
    for item in pending:
        for path in (item.temp_path, item.backup_path):
            if path is None or not path.exists():
                continue
            try:
                path.unlink()
            except OSError as error:
                errors.append(f"{path}: {error}")
    if errors:
        print("blendlink addon: reflection probe temporary cleanup failed: " + "; ".join(errors))


def _commit_files(pending: list[_PendingBake]) -> None:
    """Commit a batch with same-directory backups and exact rollback."""
    try:
        for item in pending:
            if item.final_path.exists():
                item.backup_path = item.final_path.with_name(
                    f".{item.final_path.name}.backup-{uuid.uuid4().hex}"
                )
                os.replace(item.final_path, item.backup_path)
            os.replace(item.temp_path, item.final_path)
            item.committed = True
    except Exception as error:
        rollback_errors = _rollback_files(pending)
        detail = f"Could not atomically publish reflection assets: {type(error).__name__}: {error}"
        if rollback_errors:
            detail += "; rollback failed: " + "; ".join(rollback_errors)
        raise RuntimeError(detail) from error


def _rollback_files(pending: list[_PendingBake]) -> list[str]:
    errors = []
    for item in reversed(pending):
        try:
            if item.committed and item.final_path.exists():
                item.final_path.unlink()
            if item.backup_path is not None and item.backup_path.exists():
                os.replace(item.backup_path, item.final_path)
            item.committed = False
        except OSError as error:
            errors.append(f"{item.final_path}: {error}")
    return errors


def _finalize_backups(pending: list[_PendingBake]) -> None:
    errors = []
    for item in pending:
        if item.backup_path is None or not item.backup_path.exists():
            continue
        try:
            item.backup_path.unlink()
        except OSError as error:
            errors.append(f"{item.backup_path}: {error}")
    if errors:
        print(
            "blendlink addon: new reflection assets are valid, but old backup cleanup failed: "
            + "; ".join(errors)
        )


def _verified_render_result(path: Path, rendered: object, resolution: int, samples: int) -> dict:
    """Refuse a renderer result that does not describe its exact staged bytes."""
    if not isinstance(rendered, dict):
        raise RuntimeError("the reflection renderer returned no result evidence")
    expected_width = int(resolution) * 4
    expected_height = int(resolution) * 2
    if int(rendered.get("width", 0)) != expected_width \
            or int(rendered.get("height", 0)) != expected_height:
        raise RuntimeError(
            f"the reflection renderer returned {rendered.get('width')} x "
            f"{rendered.get('height')}; expected {expected_width} x {expected_height}"
        )
    if int(rendered.get("samples", 0)) != int(samples):
        raise RuntimeError(
            f"the reflection renderer reported {rendered.get('samples')} samples; "
            f"expected {samples}"
        )
    if str(rendered.get("format", "")).lower() != "exr":
        raise RuntimeError("the reflection renderer did not produce lossless EXR evidence")
    device_class = str(rendered.get("deviceClass", ""))
    backend = str(rendered.get("backend", ""))
    if device_class not in {"cpu", "gpu"} or not backend \
            or (device_class == "cpu" and backend != "cpu") \
            or (device_class == "gpu" and backend == "cpu"):
        raise RuntimeError(
            "the reflection renderer returned invalid Cycles device evidence "
            f"({device_class or '<missing>'}/{backend or '<missing>'})"
        )
    if not path.is_file():
        raise RuntimeError(f"the reflection renderer produced no staged file: {path}")
    byte_count, content_hash = _hash_file(path)
    if byte_count <= 0:
        raise RuntimeError(f"the reflection renderer produced an empty staged file: {path}")
    if int(rendered.get("bytes", -1)) != byte_count:
        raise RuntimeError(
            f"the reflection renderer byte count changed ({byte_count}; "
            f"reported {rendered.get('bytes')})"
        )
    if str(rendered.get("hash", "")) != content_hash:
        raise RuntimeError(
            f"the reflection renderer bytes changed ({content_hash}; "
            f"reported {rendered.get('hash') or '<missing hash>'})"
        )
    return rendered


def bake(context, probes: Iterable[object]) -> list[ProbeBakeResult]:
    """Bake one or many probes as a single artist-visible transaction.

    Every panorama renders before any prior asset is replaced. File commits
    use sibling backups; image/RNA updates are rolled back together if a load
    or recipe write fails. The function raises with a concrete reason and
    never reports partial success.
    """
    import bpy
    from . import props, validation
    from .bakelib_loader import bakelib

    scene = context.scene
    selected = list(probes)
    if not selected:
        raise ValueError("no Blender Bake reflection probes were selected")
    if not bpy.data.filepath:
        raise ValueError("save this .blend before baking reflection probes")
    identities = set()
    for probe in selected:
        if mode_of(probe) != "BAKED":
            raise ValueError(f"{probe.name} is not set to Blender Bake")
        if not probe.object_id or probe.object_id in identities:
            raise ValueError(f"{probe.name} has no unique stable probe identity")
        identities.add(probe.object_id)
        probe_origin(probe)

    scene_fingerprint = bakelib.fingerprint_reflection_scene_dependencies(scene)
    pending: list[_PendingBake] = []
    final_paths = set()
    try:
        for probe in selected:
            receivers = assigned_receivers(scene, probe)
            blockers = known_cycles_capture_blockers(
                scene,
                excluded_objects=receivers,
            )
            if blockers:
                raise ValueError(
                    f"{probe.name} cannot use Blender Bake because the reflection "
                    "panorama must use Cycles and found a known Eevee-only material: "
                    + "; ".join(blockers)
                    + ". Use Custom Texture for an artist-authored reflection source, "
                    "or remove the blocker from objects visible to this probe."
                )
            final_path, relative_path = _owned_final_path(bpy.data.filepath, probe)
            if final_path in final_paths:
                raise ValueError(f"multiple reflection probes publish to {final_path}")
            final_paths.add(final_path)
            final_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = final_path.with_name(
                f".{final_path.stem}.pending-{uuid.uuid4().hex}.exr"
            )
            source_hash = bakelib.fingerprint_reflection_probe_dependencies(
                scene,
                probe_origin(probe),
                int(probe.resolution),
                int(probe.samples),
                scene_fingerprint=scene_fingerprint,
                excluded_objects=receivers,
            )
            try:
                rendered = bakelib.render_reflection_panorama_exr(
                    scene,
                    probe_origin(probe),
                    str(temp_path),
                    resolution=int(probe.resolution),
                    samples=int(probe.samples),
                    exclude_objects=receivers,
                )
                rendered = _verified_render_result(
                    temp_path, rendered, int(probe.resolution), int(probe.samples),
                )
            except Exception as error:
                if temp_path.exists():
                    try:
                        temp_path.unlink()
                    except OSError as cleanup_error:
                        print(
                            f"blendlink addon: failed to remove incomplete reflection "
                            f"render {temp_path}: {cleanup_error}"
                        )
                raise RuntimeError(
                    f"Could not bake {probe.name}: {type(error).__name__}: {error}"
                ) from error
            pending.append(_PendingBake(
                probe=probe,
                temp_path=temp_path,
                final_path=final_path,
                relative_path=relative_path,
                source_hash=source_hash,
                render=rendered,
            ))

        _commit_files(pending)
        snapshots = []
        try:
            previous_loading = props._loading_recipe
            props._loading_recipe = True
            try:
                for item in pending:
                    probe = item.probe
                    snapshots.append((probe, {
                        "baked_image": probe.baked_image,
                        "baked_source_hash": probe.baked_source_hash,
                        "baked_content_hash": probe.baked_content_hash,
                        "baked_at_utc": probe.baked_at_utc,
                        "derived_asset_path": probe.derived_asset_path,
                        "baked_width": probe.baked_width,
                        "baked_height": probe.baked_height,
                    }))
                    image = bpy.data.images.load(str(item.final_path), check_existing=False)
                    item.loaded_image = image
                    decoded_size = tuple(int(value) for value in image.size[:2])
                    expected_size = (
                        int(item.render["width"]), int(item.render["height"]),
                    )
                    if decoded_size != expected_size:
                        raise RuntimeError(
                            f"{probe.name} decoded at {decoded_size[0]} x {decoded_size[1]}; "
                            f"expected {expected_size[0]} x {expected_size[1]}"
                        )
                    decoded = inspect_image(
                        image, expected_hash=str(item.render["hash"]),
                    )
                    if not decoded.valid:
                        raise RuntimeError(
                            f"{probe.name} staged EXR did not survive decode validation: "
                            f"{decoded.issue}"
                        )
                    image.name = f"Blendlink Reflection · {probe.name}"
                    image.filepath = item.relative_path
                    image["blendlink_probe_derived"] = True
                    image["blendlink_probe_object_id"] = probe.object_id
                    probe.baked_image = image
                    probe.baked_source_hash = item.source_hash
                    probe.baked_content_hash = item.render["hash"]
                    probe.baked_at_utc = datetime.now(timezone.utc).isoformat(timespec="seconds")
                    probe.derived_asset_path = item.relative_path
                    probe.baked_width = int(item.render["width"])
                    probe.baked_height = int(item.render["height"])
            finally:
                props._loading_recipe = previous_loading
            props.write_recipe(scene)
        except Exception as error:
            property_errors = []
            previous_loading = props._loading_recipe
            props._loading_recipe = True
            try:
                for probe, snapshot in reversed(snapshots):
                    for key, value in snapshot.items():
                        try:
                            setattr(probe, key, value)
                        except Exception as restore_error:
                            property_errors.append(
                                f"{probe.name}.{key}: {type(restore_error).__name__}: {restore_error}"
                            )
            finally:
                props._loading_recipe = previous_loading
            for item in pending:
                image = item.loaded_image
                if image is not None and image.users == 0:
                    try:
                        bpy.data.images.remove(image)
                    except Exception as remove_error:
                        property_errors.append(
                            f"new image {image.name}: {type(remove_error).__name__}: {remove_error}"
                        )
            file_errors = _rollback_files(pending)
            detail = f"Could not install baked reflection assets: {type(error).__name__}: {error}"
            combined = property_errors + file_errors
            if combined:
                detail += "; rollback failed: " + "; ".join(combined)
            raise RuntimeError(detail) from error

        _finalize_backups(pending)
        for probe, snapshot in snapshots:
            old = snapshot["baked_image"]
            if old is None or old is probe.baked_image:
                continue
            try:
                if old.users == 0 and bool(old.get("blendlink_probe_derived", False)):
                    bpy.data.images.remove(old)
            except (ReferenceError, RuntimeError, TypeError) as error:
                print(
                    f"blendlink addon: baked {probe.name}, but could not release its prior "
                    f"derived image: {type(error).__name__}: {error}"
                )
        validation.mark_dirty()
        mark_dirty(scene)
        prepare_status_cache(scene, force=True)
        return [
            ProbeBakeResult(
                name=item.probe.name,
                path=str(item.final_path),
                width=int(item.render["width"]),
                height=int(item.render["height"]),
                samples=int(item.render["samples"]),
                bytes=int(item.render["bytes"]),
                content_hash=str(item.render["hash"]),
                source_hash=item.source_hash,
                device_class=str(item.render["deviceClass"]),
                backend=str(item.render["backend"]),
            )
            for item in pending
        ]
    finally:
        _cleanup_pending(pending)


def image_record(probe) -> dict | None:
    """Portable source record used by props serialization and the exporter."""
    mode = mode_of(probe)
    if mode == "RUNTIME":
        return None
    image = probe.custom_image if mode == "CUSTOM" else probe.baked_image
    evidence = inspect_image(image)
    if not evidence.valid:
        raise ValueError(f"Reflection Probe {probe.name!r}: {evidence.issue}")
    if mode == "BAKED":
        source_hash = str(probe.baked_source_hash or "")
        content_hash = str(probe.baked_content_hash or "")
        if not source_hash or not content_hash:
            raise ValueError(f"Reflection Probe {probe.name!r} needs a fresh Blender Bake")
        if evidence.content_hash != content_hash:
            raise ValueError(
                f"Reflection Probe {probe.name!r} baked bytes changed; bake it again"
            )
    return {
        "imageName": image.name,
        "width": evidence.width,
        "height": evidence.height,
        "format": evidence.format,
        "colorSpace": evidence.color_space,
        **({
            "sourceHash": str(probe.baked_source_hash),
            "contentHash": str(probe.baked_content_hash),
        } if mode == "BAKED" else {}),
    }
