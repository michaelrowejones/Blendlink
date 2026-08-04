# SPDX-License-Identifier: GPL-3.0-or-later
"""Sync status: does the saved .blend match the last `blendlink sync`?

blendlink's generated manifest records `blendBytesHash` — the first 16 hex
chars of sha256 over the .blend bytes — and `sourceBlend`. We locate the
manifest (walk up from the .blend to a dir containing blendlink.config.mjs/js,
then a bounded search for *.manifest.json), then compare hashes. Everything
is mtime-cached; the timer only stats files.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

import bpy

_SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "out", "__pycache__"}
_MAX_WALK_UP = 8
_MAX_SCAN_DEPTH = 6
_MANIFEST_SCHEMA_VERSION = 3
_LOCAL_PATH_KEY = re.compile(r"^[a-f0-9]{64}$")


def _canonical_local_path(path: Path) -> str:
    value = str(path.resolve()).replace("\\", "/")
    return value.lower() if os.name == "nt" else value


def _local_path_key(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(b"blendlink-local-path-v1\0")
    digest.update(_canonical_local_path(path).encode("utf8"))
    return digest.hexdigest()


def _local_provenance_root() -> Path:
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA")
        return ((Path(base) if base else Path.home() / "AppData" / "Local") /
                "Blendlink" / "Cache" / "local-provenance-v1")
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "blendlink" / "local-provenance-v1"
    return (Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) /
            "blendlink" / "local-provenance-v1")


def _read_local_path_provenance(key: str, cache_root: Path | None = None) -> Path | None:
    if not isinstance(key, str) or _LOCAL_PATH_KEY.fullmatch(key) is None:
        return None
    record_path = (cache_root or _local_provenance_root()) / f"{key}.json"
    try:
        record = json.loads(record_path.read_text(encoding="utf8"))
        exact = Path(record.get("path", ""))
        if (record.get("schemaVersion") != 1 or record.get("key") != key or
                not exact.is_absolute() or _local_path_key(exact) != key):
            return None
        return exact.resolve()
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None

_state = {
    # CHECKING until the first timer tick runs. register() deliberately does
    # not refresh - it can run in Blender's restricted context - so for the
    # first second after the add-on is enabled the status is simply not known
    # yet. Starting at NO_FILE made a saved, connected, published scene
    # announce "Save the file to track sync" and "No website is connected yet"
    # before anything had looked.
    "status": "CHECKING",  # CHECKING | NO_FILE | NO_MANIFEST | IN_SYNC | NEEDS_SYNC | UNSAVED_EDITS
    "detail": "",
    "hint": "",  # manifest syncHint: the command that regenerates the artifacts
    "plan": {},  # manifest bakePlan objects keyed by object name
    "bake_plan": None,  # the whole bakePlan dict from the manifest
    "build_stats": None,
    "optimization": None,
    "texture_compression": None,
    "texture_transforms": [],
    "derived_assets": [],
    "incremental_bake": None,
    "manifest_path": None,
    "manifest": None,
    "asset_failures": [],
    "asset_hash_cache": {},
    "manifest_mtime": 0,
    "blend_hash": None,
    "blend_mtime": 0,
    "searched_for": None,
    "root": None,  # directory containing blendlink.config.mjs or .js
    # Exact generated app integration, when it can be identified from the
    # current manifest or from a single generated integration module. This is
    # deliberately a handoff reminder, never a user-settable "website ready"
    # flag: Blender cannot inspect whether application code mounted it.
    "website_handoff": None,
    # Generated integration parsing is cached by exact path + file stat. The
    # one-second status timer may stat this file, but never rereads unchanged
    # TypeScript from a local or network project.
    "handoff_cache": {},
    "manifest_rejections": [],
    "manifest_read_failure": "",
    "manifest_problems": [],
    "manifest_content_hash": "",
    "plan_signature": "",
    "asset_signature": "",
    # Monotonic artist-facing source revision. The bake table consumes this
    # token instead of reparsing/rebuilding on every timer tick.
    "change_token": 0,
    # Broader redraw revision for stats/assets/integrity that must not rebuild
    # the scene-wide bake table.
    "ui_token": 0,
}

STATUS_UI = {
    "CHECKING": ("TIME", "Checking website status"),
    "NO_FILE": ("FILE_BLEND", "Save the file to track sync"),
    "NO_MANIFEST": ("GHOST_DISABLED", "No published website build yet"),
    "IN_SYNC": ("CHECKMARK", "Published export artifacts are current"),
    "NEEDS_SYNC": ("FILE_REFRESH", "Saved changes not yet synced"),
    "UNSAVED_EDITS": ("GREASEPENCIL", "Unsaved edits in Blender"),
}


def status() -> tuple[str, str, str]:
    icon, label = STATUS_UI[_state["status"]]
    return _state["status"], icon, label


def sync_hint() -> str:
    """Command that regenerates the artifacts (from the manifest), or ''."""
    return _state["hint"]


def bake_plan() -> dict | None:
    """The whole cached bakePlan from the last sync's manifest (settings,
    atlases, objects, dynamicObjects), or None. Stale when status() is not
    IN_SYNC — display it, but say so."""
    return _state.get("bake_plan")


def change_token() -> int:
    """Revision of the published plan/status consumed by lightweight UI.

    A timer may compare this integer every tick without walking the plan. It
    advances only when :func:`refresh` observes a different bake plan or sync
    status (and when a file-load reset invalidates the prior source).
    """
    return int(_state.get("change_token", 0))


def plan_for(object_name: str) -> dict | None:
    """Bake-plan entry for an object from the last sync's manifest, or None.

    Entries carry pxPerMeter / screenDensity / uvShare / autoWeight /
    artistWeight — the numbers the density readout shows next to the
    Lightmap Scale slider. Stale when status() is not IN_SYNC.
    """
    return _state["plan"].get(object_name)


def project_root() -> str | None:
    """Directory containing blendlink.config.mjs/js, once discovered."""
    return str(_state["root"]) if _state["root"] else None


def website_handoff() -> dict | None:
    """Required application hookup for the generated integration, if known.

    The result intentionally has no completion boolean. Presence of an
    integration module proves that connect generated user-owned app code; it
    does not prove that a route or render tree imports and mounts that code.
    """
    value = _state.get("website_handoff")
    return dict(value) if isinstance(value, dict) else None


def _scene_integration_name(scene_name: str) -> str:
    """Mirror projectSetup.ts for already-canonical manifest scene names."""
    capitalized = scene_name[:1].upper() + scene_name[1:]
    return capitalized if capitalized.lower().endswith("scene") else f"{capitalized}Scene"


def _integration_handoff(path: Path, root: Path) -> dict:
    """Read a generated integration and state its exact WebGL hookup."""
    display = path.relative_to(root).as_posix()
    cache_key = (str(root), str(path))
    try:
        stat = path.stat()
        signature = (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)
    except OSError as error:
        return {
            "kind": "unreadable",
            "path": display,
            "instruction": f"Open {display} and mount its generated WebGL scene integration.",
            "detail": f"The integration exists but Blender could not inspect it: {error}",
        }
    cached = _state["handoff_cache"].get(cache_key)
    if cached is not None and cached[0] == signature:
        return dict(cached[1])
    try:
        source = path.read_text(encoding="utf8")
    except OSError as error:
        result = {
            "kind": "unreadable",
            "path": display,
            "instruction": f"Open {display} and mount its generated WebGL scene integration.",
            "detail": f"The integration exists but Blender could not read it: {error}",
        }
        _state["handoff_cache"][cache_key] = (signature, result)
        return dict(result)
    component = path.stem
    is_r3f_integration = (
        "@react-three/fiber" in source
        or "blendlink/react-three-fiber" in source
    ) and (
        re.search(
            rf"\bexport\s+function\s+{re.escape(component)}\b", source,
        )
        or re.search(
            rf"\bexport\s+const\s+{re.escape(component)}\s*=\s*"
            r"createR3FCompiledScene\b",
            source,
        )
    )
    if is_r3f_integration:
        instruction = (
            f"Render <{component} /> from {display} inside a WebGL React Three Fiber <Canvas>."
        )
        kind = "react-three-fiber"
    else:
        installer = f"install{component}"
        if re.search(rf"\bexport\s+function\s+{re.escape(installer)}\b", source):
            instruction = (
                f"Call await {installer}({{ renderer, scene }}) from {display} "
                "in the site's Three WebGLRenderer setup."
            )
            kind = "three"
        else:
            instruction = (
                f"Mount the generated WebGL scene integration exported by {display} "
                "in the website's render tree."
            )
            kind = "custom"
    result = {
        "kind": kind,
        "path": display,
        "instruction": instruction,
        "detail": (
            "Blender can verify this generated file, but cannot verify whether "
            "the user-owned website imports and mounts it."
        ),
    }
    _state["handoff_cache"][cache_key] = (signature, result)
    return dict(result)


def _discover_website_handoff(
    root: Path | None,
    manifest_path: Path | None,
) -> dict | None:
    """Find the exact generated handoff without parsing executable config JS."""
    if root is None:
        return None
    directory = root / "src" / "blendlink"
    expected = None
    if manifest_path is not None and manifest_path.name.endswith(".manifest.json"):
        scene_name = manifest_path.name[:-len(".manifest.json")]
        expected = directory / f"{_scene_integration_name(scene_name)}.ts"
        if expected.is_file():
            return _integration_handoff(expected, root)

    candidates = []
    try:
        candidates = [
            path for path in directory.glob("*.ts")
            if path.is_file() and not path.name.endswith((".gen.ts", ".baked.ts"))
        ]
    except OSError:
        candidates = []
    if expected is None and len(candidates) == 1:
        return _integration_handoff(candidates[0], root)

    expected_display = expected.relative_to(root).as_posix() if expected else "src/blendlink/<Scene>Scene.ts"
    detail = (
        f"The expected generated integration {expected_display} was not found."
        if expected is not None else
        "No single generated scene integration can be identified before the first manifest exists."
    )
    return {
        "kind": "missing" if expected is not None else "unknown",
        "path": expected_display,
        "instruction": (
            f"Run npx blendlink connect from {root}, then follow its generated WebGL hookup "
            f"for {expected_display}."
        ),
        "detail": detail,
    }


def build_stats() -> dict | None:
    return _state.get("build_stats")


def optimization() -> dict | None:
    return _state.get("optimization")


def texture_compression() -> dict | None:
    return _state.get("texture_compression")


def texture_compression_for(image_name: str) -> dict | None:
    report = texture_compression() or {}
    return next(
        (entry for entry in report.get("textures", [])
         if isinstance(entry, dict) and entry.get("name") == image_name),
        None,
    )


def texture_transform(image_name: str) -> dict | None:
    return next(
        (entry for entry in _state.get("texture_transforms", [])
         if isinstance(entry, dict) and entry.get("name") == image_name),
        None,
    )


def derived_assets() -> list[dict]:
    """Published images resolved to local files for thumbnail/isolation UI."""
    return list(_state.get("derived_assets", []))


def verified_derived_asset(path: str, content_hash: str = "") -> dict | None:
    """Current verified selection target, optionally pinned to exact bytes."""
    if not path:
        return None
    wanted = os.path.normcase(os.path.abspath(path))
    expected = str(content_hash or "")
    return next(
        (asset for asset in _state.get("derived_assets", [])
         if asset.get("verified") and asset.get("path")
         and os.path.normcase(os.path.abspath(asset["path"])) == wanted
         and (not expected or asset.get("contentHash") == expected)),
        None,
    )


def _clear_unverified_selection() -> bool:
    window_manager = getattr(bpy.context, "window_manager", None)
    session = getattr(window_manager, "blendlink", None) if window_manager else None
    if session is None or not session.derived_asset_path:
        return False
    if verified_derived_asset(
        session.derived_asset_path,
        getattr(session, "derived_asset_content_hash", ""),
    ) is not None:
        return False
    previous = session.derived_asset_label or os.path.basename(session.derived_asset_path)
    session.derived_asset_path = ""
    session.derived_asset_label = ""
    session.derived_asset_atlas = ""
    session.derived_asset_kind = ""
    session.derived_asset_content_hash = ""
    print(
        f"blendlink addon: published image selection {previous!r} changed or is no longer available; "
        "cleared the stale selection"
    )
    return True


def incremental_bake() -> dict | None:
    """Atlas jobs reused/rebuilt by the most recent published build."""
    report = _state.get("incremental_bake")
    return report if isinstance(report, dict) else None


def integrity_failures() -> list[str]:
    """Why a hash-matching .blend is still not the published artifact set."""
    return list(_state.get("asset_failures", []))


def manifest_rejections() -> list[str]:
    """Candidate manifests rejected during discovery, with explicit reasons."""
    return list(_state.get("manifest_rejections", []))


def manifest_problems() -> list[str]:
    """Rejections that are actually wrong, rather than ordinary discovery.

    A sibling scene's manifest is not a problem; an unreadable, malformed, or
    unsupported one is.
    """
    return list(_state.get("manifest_problems", []))


def manifest_read_failure() -> str:
    """Why the matched manifest could not be read, if that is what happened."""
    return str(_state.get("manifest_read_failure", "") or "")


def _asset_candidates(root: Path | None, url: str) -> list[Path]:
    """Deterministic local paths for a public URL.

    Vite serves ``public`` at `/`; other common static hosts use ``static``.
    We intentionally do not scan by basename: `wrong/foo.png` is not evidence
    for `/models/foo.png`, even if it is the only same-named file on disk.
    """
    if root is None or not isinstance(url, str) or not url:
        return []
    path = unquote(urlsplit(url).path).replace("\\", "/")
    parts = PurePosixPath(path.lstrip("/")).parts
    if not parts or any(part in {"", ".", ".."} or ":" in part for part in parts):
        return []
    relative = Path(*parts)
    candidates = []
    for base in (root, root / "public", root / "static"):
        candidate = (base / relative).resolve()
        try:
            candidate.relative_to(base.resolve())
        except ValueError:
            continue
        if candidate.is_file() and candidate not in candidates:
            candidates.append(candidate)
    return candidates


def _resolve_asset(root: Path | None, url: str, expected_hash: str | None = None) -> str | None:
    candidates = _asset_candidates(root, url)
    if not _valid_content_hash(expected_hash):
        # A deterministic path is useful for diagnostics, but never bless an
        # unhashed image for the exact-pixel inspection UI.
        return None
    if not candidates:
        return None
    matches = [
        candidate for candidate in candidates
        if _cached_hash(candidate, len(expected_hash), force=False) == expected_hash
    ]
    # More than one conventional served root is ambiguous. It is safe only
    # when every possible target contains the same declared bytes.
    return str(matches[0]) if len(matches) == len(candidates) else None


def _valid_content_hash(value) -> bool:
    return (
        isinstance(value, str) and len(value) in {16, 64}
        and all(character in "0123456789abcdef" for character in value)
    )


def _collect_derived_assets(manifest: dict) -> list[dict]:
    assets = []
    artifact_hashes = manifest.get("bakeArtifactHashes") or {}
    state_hashes = artifact_hashes.get("states") or {}
    light_hashes = artifact_hashes.get("lightGroups") or {}
    source_owners = {}

    def add(kind, label, url, expected_hash, atlas="main", max_value=None):
        path = _resolve_asset(_state.get("root"), url, expected_hash)
        assets.append({
            "kind": kind, "label": label, "url": url, "atlas": atlas,
            "path": path,
            "verified": bool(path),
            "contentHash": expected_hash,
            **({"bytes": os.path.getsize(path)} if path and os.path.isfile(path) else {}),
            **({"maxValue": max_value} if max_value is not None else {}),
        })

    for state, entry in (manifest.get("states") or {}).items():
        if not isinstance(entry, dict):
            continue
        if isinstance(entry.get("url"), str):
            add("state", state, entry["url"], (state_hashes.get(state) or {}).get("main"))
            source_owners[entry["url"]] = ("state", state, "main", None)
        for atlas, url in (entry.get("atlases") or {}).items():
            if isinstance(url, str):
                add("state", state, url, (state_hashes.get(state) or {}).get(atlas), atlas)
                source_owners[url] = ("state", state, atlas, None)
    for light, entry in (manifest.get("lightGroups") or {}).items():
        if not isinstance(entry, dict):
            continue
        if isinstance(entry.get("url"), str):
            add(
                "light", light, entry["url"],
                (light_hashes.get(light) or {}).get("main"),
                max_value=entry.get("maxValue"),
            )
            source_owners[entry["url"]] = (
                "light", light, "main", entry.get("maxValue"),
            )
        for atlas, layer in (entry.get("atlases") or {}).items():
            if isinstance(layer, dict) and isinstance(layer.get("url"), str):
                add(
                    "light", light, layer["url"],
                    (light_hashes.get(light) or {}).get(atlas), atlas,
                    layer.get("maxValue"),
                )
                source_owners[layer["url"]] = (
                    "light", light, atlas, layer.get("maxValue"),
                )

    # Resolution/format alternatives ship as independent files. Expose only
    # variants whose canonical source belongs to a known baked atlas, while
    # preserving that atlas's state/light semantics for pixel inspection.
    # Integrity validation below remains stricter and checks every declared
    # entry, including malformed or orphaned records.
    texture_variants = manifest.get("textureVariants") or {}
    if not isinstance(texture_variants, dict):
        texture_variants = {}
    for source_url, variants in texture_variants.items():
        owner = source_owners.get(source_url)
        if owner is None or not isinstance(variants, list):
            continue
        kind, label, atlas, max_value = owner
        for variant in variants:
            if not isinstance(variant, dict) \
                    or not isinstance(variant.get("url"), str) \
                    or variant.get("format") not in {"png", "webp"} \
                    or not isinstance(variant.get("width"), int) \
                    or variant.get("width") <= 0 \
                    or not isinstance(variant.get("height"), int) \
                    or variant.get("height") <= 0 \
                    or not isinstance(variant.get("bytes"), int) \
                    or variant.get("bytes") < 0 \
                    or not _valid_content_hash(variant.get("hash")) \
                    or variant.get("lossless") is not True:
                continue
            width = variant.get("width")
            height = variant.get("height")
            dimensions = (
                f"{width}x{height}" if isinstance(width, int) and isinstance(height, int)
                else "unknown size"
            )
            image_format = str(variant.get("format") or "variant").upper()
            add(
                kind, f"{label} · {dimensions} {image_format}", variant["url"],
                variant.get("hash"), atlas, max_value,
            )
    environment = manifest.get("environment")
    if isinstance(environment, dict) and isinstance(environment.get("url"), str):
        add(
            "environment", environment.get("sourceName", "Environment"),
            environment["url"], environment.get("hash"),
        )
    for probe_id, asset in (manifest.get("reflectionProbeAssets") or {}).items():
        if isinstance(asset, dict) and isinstance(asset.get("url"), str):
            add(
                "probe", asset.get("sourceName", probe_id),
                asset["url"], asset.get("hash"),
            )
    return assets


def reset():
    next_token = change_token() + 1
    next_ui_token = int(_state.get("ui_token", 0)) + 1
    _state.update(
        status="NO_FILE", detail="", hint="", plan={}, bake_plan=None,
        build_stats=None, optimization=None, texture_compression=None,
        texture_transforms=[], derived_assets=[], incremental_bake=None, manifest_path=None,
        manifest=None, asset_failures=[], asset_hash_cache={},
        manifest_mtime=0, blend_hash=None, blend_mtime=0, searched_for=None,
        root=None, website_handoff=None,
        handoff_cache={},
        manifest_rejections=[], manifest_problems=[], manifest_read_failure="",
        manifest_content_hash="", plan_signature="", asset_signature="",
        change_token=next_token,
        ui_token=next_ui_token,
    )


def _freeze_ui_value(value):
    if isinstance(value, dict):
        return tuple(sorted((str(key), _freeze_ui_value(item)) for key, item in value.items()))
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_ui_value(item) for item in value)
    if isinstance(value, Path):
        return str(value)
    return value


def _ui_snapshot():
    # O(1) with respect to object/plan count. Large structures are hashed only
    # when their manifest or verified asset set is actually rebuilt.
    return (
        _state.get("status"),
        _state.get("manifest_content_hash"),
        _state.get("asset_signature"),
        _freeze_ui_value(_state.get("website_handoff")),
        tuple(_state.get("manifest_rejections") or ()),
        _state.get("manifest_read_failure"),
    )


def _plan_source_snapshot():
    return (_state.get("status"), _state.get("plan_signature"))


def _finish_refresh(previous_snapshot, previous_plan_source) -> bool:
    """Commit one source revision after any artist-visible cached evidence moves."""
    ui_changed = previous_snapshot != _ui_snapshot()
    plan_changed = previous_plan_source != _plan_source_snapshot()
    if plan_changed:
        _state["change_token"] = change_token() + 1
    if ui_changed:
        _state["ui_token"] = int(_state.get("ui_token", 0)) + 1
    return ui_changed or plan_changed


def _json_signature(value) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf8")).hexdigest()[:16]


def _update_asset_signature() -> None:
    _state["asset_signature"] = _json_signature({
        "failures": _state.get("asset_failures") or [],
        "assets": _state.get("derived_assets") or [],
    })


def _clear_manifest_evidence(*, clear_content_hash: bool) -> None:
    _state.update(
        detail="", hint="", plan={}, bake_plan=None, manifest=None, plan_signature="",
        build_stats=None, optimization=None, texture_compression=None,
        texture_transforms=[], derived_assets=[], incremental_bake=None,
        asset_failures=[], asset_signature="",
    )
    if clear_content_hash:
        _state["manifest_content_hash"] = ""


def _hash_file(path: Path, length: int = 16) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()[:length]


def _cached_hash(path: Path, length: int, force: bool) -> str:
    stat = path.stat()
    signature = (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size, length)
    cached = _state["asset_hash_cache"].get(str(path))
    if not force and cached and cached[0] == signature:
        return cached[1]
    actual = _hash_file(path, length)
    _state["asset_hash_cache"][str(path)] = (signature, actual)
    return actual


def _declared_asset_checks(manifest: dict, manifest_path: Path) -> list[dict]:
    """Flatten every independently published file and its declared hash."""
    checks = []

    def add(
        label, expected_hash, *, url=None, path=None, expected_bytes=None,
        metadata_error=None,
    ):
        checks.append({
            "label": label, "hash": expected_hash, "url": url, "path": path,
            "bytes": expected_bytes, "metadataError": metadata_error,
        })

    stats = manifest.get("stats") if isinstance(manifest.get("stats"), dict) else {}
    add("scene GLB", manifest.get("hash"), url=manifest.get("url"), expected_bytes=stats.get("bytes"))
    module_name = manifest_path.name
    if module_name.endswith(".manifest.json"):
        module_name = module_name[:-len(".manifest.json")] + ".gen.ts"
    add(
        "generated scene module", manifest.get("generatedModuleHash"),
        path=manifest_path.with_name(module_name),
    )

    artifacts = manifest.get("bakeArtifactHashes") or {}
    state_hashes = artifacts.get("states") or {}
    light_hashes = artifacts.get("lightGroups") or {}
    for state, entry in (manifest.get("states") or {}).items():
        if not isinstance(entry, dict):
            continue
        hashes = state_hashes.get(state) or {}
        if isinstance(entry.get("url"), str):
            add(f"state {state!r} atlas 'main'", hashes.get("main"), url=entry["url"])
        for atlas, url in (entry.get("atlases") or {}).items():
            if isinstance(url, str):
                add(f"state {state!r} atlas {atlas!r}", hashes.get(atlas), url=url)
    for light, entry in (manifest.get("lightGroups") or {}).items():
        if not isinstance(entry, dict):
            continue
        hashes = light_hashes.get(light) or {}
        if isinstance(entry.get("url"), str):
            add(f"light group {light!r} atlas 'main'", hashes.get("main"), url=entry["url"])
        for atlas, layer in (entry.get("atlases") or {}).items():
            if isinstance(layer, dict) and isinstance(layer.get("url"), str):
                add(f"light group {light!r} atlas {atlas!r}", hashes.get(atlas), url=layer["url"])

    # Each advertised tier is independently fetchable and therefore part of
    # the publication transaction. Never let a current canonical PNG mask a
    # deleted or hand-modified PNG/WebP alternative.
    texture_variants = manifest.get("textureVariants") or {}
    if not isinstance(texture_variants, dict):
        add(
            "textureVariants", None,
            metadata_error="expected a canonical-URL object",
        )
        texture_variants = {}
    for source_url, variants in texture_variants.items():
        if not isinstance(variants, list):
            add(
                f"texture variants for {source_url!r}", None,
                metadata_error="expected an array",
            )
            continue
        for index, variant in enumerate(variants):
            label = f"texture variant {index + 1} for {source_url!r}"
            if not isinstance(variant, dict):
                add(label, None, metadata_error="expected an object")
                continue
            image_format = variant.get("format")
            width = variant.get("width")
            height = variant.get("height")
            if isinstance(image_format, str):
                label += f" ({image_format}"
                if isinstance(width, int) and isinstance(height, int):
                    label += f" {width}x{height}"
                label += ")"
            metadata_errors = []
            if not isinstance(source_url, str) or not source_url:
                metadata_errors.append("canonical URL must be a non-empty string")
            if not isinstance(variant.get("url"), str) or not variant.get("url"):
                metadata_errors.append("url must be a non-empty string")
            if variant.get("format") not in {"png", "webp"}:
                metadata_errors.append("format must be png or webp")
            for dimension in ("width", "height"):
                value = variant.get(dimension)
                if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                    metadata_errors.append(f"{dimension} must be a positive integer")
            expected_bytes = variant.get("bytes")
            if not isinstance(expected_bytes, int) or isinstance(expected_bytes, bool) \
                    or expected_bytes < 0:
                metadata_errors.append("bytes must be a non-negative integer")
            if variant.get("lossless") is not True:
                metadata_errors.append("lossless must be true")
            add(
                label, variant.get("hash"), url=variant.get("url"),
                expected_bytes=expected_bytes,
                metadata_error="; ".join(metadata_errors) if metadata_errors else None,
            )

    environment = manifest.get("environment")
    if isinstance(environment, dict) and isinstance(environment.get("url"), str):
        add("environment", environment.get("hash"), url=environment["url"], expected_bytes=environment.get("bytes"))
        optimized = environment.get("optimized")
        if isinstance(optimized, dict) and isinstance(optimized.get("url"), str):
            add(
                "optimized environment", optimized.get("hash"), url=optimized["url"],
                expected_bytes=optimized.get("bytes"),
            )
    for probe_id, asset in (manifest.get("reflectionProbeAssets") or {}).items():
        if isinstance(asset, dict) and isinstance(asset.get("url"), str):
            add(
                f"reflection probe {probe_id!r}", asset.get("hash"),
                url=asset["url"], expected_bytes=asset.get("bytes"),
            )
    return checks


def _verify_declared_assets(manifest: dict, manifest_path: Path, force: bool) -> list[str]:
    failures = []
    for check in _declared_asset_checks(manifest, manifest_path):
        label = check["label"]
        expected_hash = check["hash"]
        if check.get("metadataError"):
            failures.append(
                f"{label} has invalid manifest metadata "
                f"({check['metadataError']}); resync"
            )
            continue
        if not _valid_content_hash(expected_hash):
            failures.append(f"{label} has no valid integrity hash; resync")
            continue
        if check["path"] is not None:
            candidates = [Path(check["path"])] if Path(check["path"]).is_file() else []
        elif isinstance(check["url"], str):
            candidates = _asset_candidates(_state.get("root"), check["url"])
        else:
            candidates = []
        if not candidates:
            failures.append(f"{label} is missing")
            continue
        matched = []
        actuals = []
        for candidate in candidates:
            try:
                actual = _cached_hash(candidate, len(expected_hash), force)
            except OSError as error:
                actuals.append(f"{candidate}: {error}")
                continue
            actuals.append(f"{candidate}: {actual}")
            if actual == expected_hash:
                matched.append(candidate)
        if len(matched) != len(candidates):
            failures.append(
                f"{label} bytes changed (expected {expected_hash}; " + "; ".join(actuals) + ")"
            )
            continue
        resolved = matched[0]
        expected_bytes = check.get("bytes")
        if isinstance(expected_bytes, int) and resolved.stat().st_size != expected_bytes:
            failures.append(
                f"{label} size changed ({resolved.stat().st_size} != {expected_bytes})"
            )
    return failures


def _verify_external_dependencies(
    manifest: dict, force: bool, local_provenance_root: Path | None = None,
) -> list[str]:
    """Match the compiler's linked-file gate, with missing inputs kept loud."""
    failures = []
    source = manifest.get("sourceBlend")
    source_key = manifest.get("sourceBlendLocalPathKey")
    source_path = (_read_local_path_provenance(source_key, local_provenance_root)
                   if isinstance(source_key, str) else
                   Path(source) if isinstance(source, str) and source else None)
    if source_path is not None and not source_path.is_absolute():
        root = _state.get("root")
        source_path = (root / source_path).resolve() if root is not None else None
    for index, dependency in enumerate(manifest.get("externalDependencies") or []):
        label = f"external dependency {index + 1}"
        if not isinstance(dependency, dict) or not isinstance(dependency.get("path"), str):
            failures.append(f"{label} has invalid manifest metadata; resync")
            continue
        label = f"external dependency {dependency['path']!r}"
        if (
            dependency.get("reachable") is False
            and dependency.get("reachabilityReason") == "unbound-material"
        ):
            continue
        if dependency.get("volatile"):
            failures.append(f"{label} is volatile and must be rechecked by Blender")
            continue
        if dependency.get("relativeToBlend"):
            if source_path is None:
                failures.append(f"{label} cannot resolve without sourceBlend; resync")
                continue
            path = (source_path.parent / dependency["path"]).resolve()
        elif dependency.get("projectRelative"):
            root = _state.get("root")
            if root is None:
                failures.append(f"{label} cannot resolve without project root; resync")
                continue
            path = (root / dependency["path"]).resolve()
        elif dependency.get("localPathKey"):
            path = _read_local_path_provenance(
                dependency["localPathKey"], local_provenance_root,
            )
            if path is None:
                failures.append(
                    f"{label} has no private path record on this machine; run blendlink sync"
                )
                continue
            # This label is artist-facing. ``repr`` doubles Windows path
            # separators, which makes the exact local file harder to read and
            # copy from Blender's diagnostics.
            label = f"external dependency '{path}'"
        else:
            path = Path(dependency["path"])
        if not dependency.get("exists") or not path.is_file():
            failures.append(f"{label} is missing")
            continue
        expected_hash = dependency.get("hash")
        expected_bytes = dependency.get("bytes")
        if not _valid_content_hash(expected_hash) or not isinstance(expected_bytes, int):
            failures.append(f"{label} has no valid hash/size; resync")
            continue
        try:
            actual_bytes = path.stat().st_size
            actual_hash = _cached_hash(path, len(expected_hash), force)
        except OSError as error:
            failures.append(f"{label} could not be read: {error}")
            continue
        if actual_bytes != expected_bytes or actual_hash != expected_hash:
            failures.append(
                f"{label} changed (bytes {actual_bytes}/{expected_bytes}, "
                f"hash {actual_hash}/{expected_hash})"
            )
    return failures


def _iter_manifests(root: Path):
    stack = [(root, 0)]
    while stack:
        directory, depth = stack.pop()
        try:
            entries = sorted(
                os.scandir(directory), key=lambda entry: entry.name.casefold(),
            )
        except OSError:
            continue
        for entry in entries:
            if entry.is_dir(follow_symlinks=False):
                if depth < _MAX_SCAN_DEPTH and entry.name not in _SKIP_DIRS:
                    stack.append((Path(entry.path), depth + 1))
            elif entry.name.endswith(".manifest.json"):
                yield Path(entry.path)


def _find_manifest(blend_path: Path) -> Path | None:
    directory = blend_path.parent
    root = None
    for _ in range(_MAX_WALK_UP):
        if (directory / "blendlink.config.mjs").exists() \
                or (directory / "blendlink.config.js").exists():
            root = directory
            break
        if directory.parent == directory:
            break
        directory = directory.parent
    _state["root"] = root
    _state["manifest_rejections"] = []
    _state["manifest_problems"] = []
    if root is None:
        return None

    def reject(path: Path, reason: str, *, loud: bool = True):
        """Record why a candidate manifest was not used.

        `loud` also decides whether this is a PROBLEM. A manifest belonging to
        another scene of the same multi-scene website is an ordinary discovery
        outcome, and recording it as a rejection made the panel announce
        "Last published result was rejected - Blendlink found website output
        it could not safely use" the first time an artist opened the second
        scene of their own project, when nothing was wrong at all.
        """
        message = f"{path}: {reason}"
        _state["manifest_rejections"].append(message)
        if loud:
            _state["manifest_problems"].append(message)
            print(f"blendlink addon: rejected manifest {message}")

    matches = []
    for manifest_path in _iter_manifests(root):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf8"))
        except OSError as error:
            reject(manifest_path, f"could not be read: {error}")
            continue
        except json.JSONDecodeError as error:
            reject(
                manifest_path,
                f"invalid JSON at line {error.lineno}, column {error.colno}: {error.msg}",
            )
            continue
        if not isinstance(manifest, dict):
            reject(manifest_path, "root must be an object")
            continue
        if manifest.get("schemaVersion") != _MANIFEST_SCHEMA_VERSION:
            reject(
                manifest_path,
                f"schemaVersion {manifest.get('schemaVersion')!r} is unsupported; "
                f"expected {_MANIFEST_SCHEMA_VERSION}; resync",
            )
            continue
        if manifest.get("generator") != "blendlink":
            reject(manifest_path, f"generator {manifest.get('generator')!r} is not 'blendlink'")
            continue
        source = manifest.get("sourceBlend")
        if not isinstance(source, str) or not source:
            reject(manifest_path, "sourceBlend must be a non-empty string")
            continue
        source_path = Path(source)
        if not source_path.is_absolute():
            source_path = (root / source_path).resolve()
        try:
            if source_path.resolve() == blend_path.resolve():
                matches.append(manifest_path)
                continue
        except OSError as error:
            reject(manifest_path, f"sourceBlend could not be resolved: {error}")
            continue
        # A valid manifest for another configured scene is expected in a
        # multi-scene website. Retain the reason for diagnostics without
        # turning ordinary project discovery into console noise.
        reject(manifest_path, f"belongs to sourceBlend {source!r}", loud=False)
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        names = ", ".join(str(path) for path in matches)
        for path in matches:
            reject(
                path,
                "multiple published results reference this .blend; remove stale output "
                "before continuing",
            )
        print(f"blendlink addon: ambiguous published results: {names}")
    return None


def refresh(
    force: bool = False, *, rehash_assets: bool = False, rehash_blend: bool = False,
) -> bool:
    """Recompute status while retaining stat-cached artifact hashes by default.

    ``force`` rediscovers and rereads project metadata. ``rehash_assets`` and
    ``rehash_blend`` are reserved for an explicit artist refresh when
    unchanged stat metadata is suspected; lifecycle refreshes reuse hashes.
    """
    previous_snapshot = _ui_snapshot()
    previous_plan_source = _plan_source_snapshot()
    filepath = bpy.data.filepath
    if not filepath:
        _state["status"] = "NO_FILE"
        _clear_manifest_evidence(clear_content_hash=True)
        _state["website_handoff"] = None
        _clear_unverified_selection()
        return _finish_refresh(previous_snapshot, previous_plan_source)
    blend_path = Path(filepath)

    filepath_changed = _state["searched_for"] != filepath
    if force or filepath_changed or _state["root"] is None or (
        _state["manifest_path"] and not Path(_state["manifest_path"]).exists()
    ):
        _state["manifest_path"] = _find_manifest(blend_path)
        _state["searched_for"] = filepath
        _state["manifest_mtime"] = 0
        if filepath_changed:
            _state["blend_mtime"] = 0
            _state["blend_hash"] = None
        _state["manifest"] = None
        _state["asset_failures"] = []
        _state["manifest_read_failure"] = ""

    _state["website_handoff"] = _discover_website_handoff(
        _state.get("root"),
        Path(_state["manifest_path"]) if _state.get("manifest_path") else None,
    )

    if _state["manifest_path"] is None:
        _state["status"] = "NO_MANIFEST"
        _clear_manifest_evidence(clear_content_hash=True)
        _clear_unverified_selection()
        return _finish_refresh(previous_snapshot, previous_plan_source)

    try:
        blend_mtime = os.stat(blend_path).st_mtime_ns
        manifest_mtime = os.stat(_state["manifest_path"]).st_mtime_ns
    except OSError:
        _state["status"] = "NO_MANIFEST"
        _clear_manifest_evidence(clear_content_hash=True)
        _clear_unverified_selection()
        return _finish_refresh(previous_snapshot, previous_plan_source)

    if rehash_blend or blend_mtime != _state["blend_mtime"]:
        _state["blend_hash"] = _hash_file(blend_path)
        _state["blend_mtime"] = blend_mtime
    if force or manifest_mtime != _state["manifest_mtime"]:
        try:
            manifest_text = Path(_state["manifest_path"]).read_text(encoding="utf8")
            _state["manifest_content_hash"] = hashlib.sha256(
                manifest_text.encode("utf8")
            ).hexdigest()[:16]
            manifest = json.loads(manifest_text)
            if not isinstance(manifest, dict):
                raise ValueError("manifest root must be an object")
            if manifest.get("generator") != "blendlink" \
                    or manifest.get("schemaVersion") != _MANIFEST_SCHEMA_VERSION:
                # Unsupported schema reads as NEEDS_SYNC (self-healing), not
                # as a blind-cast misread.
                failure = (
                    "blendlink addon: manifest schemaVersion "
                    f"{manifest.get('schemaVersion')!r} or generator "
                    f"{manifest.get('generator')!r} unsupported — resync"
                )
                print(failure)
                _state["manifest_read_failure"] = failure.removeprefix("blendlink addon: ")
                manifest = {}
            else:
                _state["manifest_read_failure"] = ""
            _state["manifest"] = manifest
            _state["detail"] = manifest.get("blendBytesHash", "")
            _state["hint"] = manifest.get("syncHint", "")
            plan = manifest.get("bakePlan") or {}
            _state["bake_plan"] = plan if isinstance(plan, dict) and plan else None
            _state["plan_signature"] = _json_signature(plan) if isinstance(plan, dict) and plan else ""
            stats = manifest.get("stats")
            _state["build_stats"] = stats if isinstance(stats, dict) else None
            optimization = manifest.get("optimization")
            _state["optimization"] = optimization if isinstance(optimization, dict) else None
            texture_compression = manifest.get("textureCompression")
            _state["texture_compression"] = (
                texture_compression if isinstance(texture_compression, dict) else None
            )
            texture_transforms = manifest.get("textureTransforms")
            _state["texture_transforms"] = (
                texture_transforms if isinstance(texture_transforms, list) else []
            )
            incremental_bake = manifest.get("incrementalBake")
            _state["incremental_bake"] = (
                incremental_bake if isinstance(incremental_bake, dict) else None
            )
            _state["plan"] = {
                entry["name"]: entry
                for entry in plan.get("objects", [])
                if isinstance(entry, dict) and "name" in entry
            }
        except (OSError, json.JSONDecodeError, ValueError) as error:
            failure = (
                f"manifest {Path(_state['manifest_path'])} could not be read: "
                f"{type(error).__name__}: {error}"
            )
            print(f"blendlink addon: {failure}")
            _state["manifest_read_failure"] = failure
            _state["manifest"] = None
            _clear_manifest_evidence(clear_content_hash=False)
        _state["manifest_mtime"] = manifest_mtime

    manifest = _state.get("manifest")
    if isinstance(manifest, dict) and manifest:
        _state["asset_failures"] = _verify_declared_assets(
            manifest, Path(_state["manifest_path"]), rehash_assets,
        )
        _state["asset_failures"].extend(
            _verify_external_dependencies(manifest, rehash_assets)
        )
        # Only hash-verified paths become clickable/inspectable. Recompute so
        # restoring a missing artifact heals the UI without touching manifest.
        _state["derived_assets"] = _collect_derived_assets(manifest)
    else:
        # Keep "we cannot read the manifest" out of the published-asset
        # integrity list. Mixing them made an unreadable or newer-schema
        # manifest accuse the artist's website files of having changed
        # outside Blendlink, and never mentioned the real cause or remedy.
        _state["asset_failures"] = []
        _state["derived_assets"] = []
    _update_asset_signature()
    _clear_unverified_selection()

    if bpy.data.is_dirty:
        _state["status"] = "UNSAVED_EDITS"
    elif (
        _state["detail"] and _state["detail"] == _state["blend_hash"]
        and not _state["asset_failures"]
    ):
        _state["status"] = "IN_SYNC"
    else:
        _state["status"] = "NEEDS_SYNC"
    return _finish_refresh(previous_snapshot, previous_plan_source)
