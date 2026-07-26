# SPDX-License-Identifier: GPL-3.0-or-later
"""Small, data-driven source-of-truth explanations for the Blender UI."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Decision:
    key: str
    label: str
    owner: str
    reason: str


OWNER_LABELS = {
    "BLEND": "This .blend",
    "WEBSITE": "Website code",
    "CONFIG": "Website project link",
    "OUTPUT": "Generated output",
}


def _decision(key, label, owner, reason):
    return Decision(key, label, owner, reason)


def decisions(project):
    """Resolve each visible publishing concern to exactly one owner.

    This is deliberately independent of bpy so the explanations are testable
    and every panel can consume the same precedence rules.
    """
    camera = _decision(
        "camera", "Starting camera",
        "BLEND" if project.main_camera is not None else "WEBSITE",
        (
            "The designated camera, behavior, target, and responsive frames publish with the scene."
            if project.main_camera is not None else
            "No presentation camera is designated, so application code chooses the view."
        ),
    )
    sequence_enabled = bool(getattr(project, "animation_sequence_enabled", False))
    playback = _decision(
        "playback", "Automatic playback",
        "WEBSITE" if project.animation_start == "MANUAL" and not sequence_enabled else "BLEND",
        (
            "The selected NLA track publishes as one ordered clip sequence."
            if sequence_enabled else
            "Start Still leaves action selection and timing to application code."
            if project.animation_start == "MANUAL" else
            "The scene publishes which clips start, their loop behavior, and speed."
        ),
    )
    tone = _decision(
        "tone", "Tone mapping & exposure",
        "WEBSITE" if project.tone_mapping == "APPLICATION" else "BLEND",
        (
            "Website Default preserves the renderer's existing tone mapping and exposure."
            if project.tone_mapping == "APPLICATION" else
            "Website Look publishes the selected tone mapping and photographic exposure."
        ),
    )
    fog_mode = getattr(project, "fog_mode", "APPLICATION")
    fog = _decision(
        "fog", "Distance fog",
        "WEBSITE" if fog_mode == "APPLICATION" else "BLEND",
        (
            "Website Default preserves the scene's existing fog."
            if fog_mode == "APPLICATION" else
            "Website Look publishes whether fog is cleared or applies the selected distance recipe."
        ),
    )

    if project.environment_background != "APPLICATION":
        background = _decision(
            "background", "Visible background", "BLEND",
            "HDR Environment owns the backdrop choice; Website Look is handed back to Application Default.",
        )
    elif project.background_mode != "APPLICATION":
        background = _decision(
            "background", "Visible background", "BLEND",
            "Website Look publishes the transparent or solid background choice.",
        )
    else:
        background = _decision(
            "background", "Visible background", "WEBSITE",
            "Both background controls are Application Default, so the page remains untouched.",
        )

    environment = _decision(
        "environment", "Image-based lighting",
        "WEBSITE" if project.environment_lighting == "APPLICATION" else "BLEND",
        (
            "Website Decides leaves scene.environment untouched."
            if project.environment_lighting == "APPLICATION" else
            "HDR Environment publishes whether the selected image lights objects or lighting is cleared."
        ),
    )
    shadows = _decision(
        "shadows", "Realtime shadow budget",
        "WEBSITE" if project.shadow_preset == "APPLICATION" else "BLEND",
        (
            "Website Default leaves renderer shadow policy and light budgets untouched."
            if project.shadow_preset == "APPLICATION" else
            "The scene publishes the filter, resolution, reach, bias, and update budget."
        ),
    )
    geometry = _decision(
        "geometry", "Geometry publishing", "BLEND",
        "Optimization explicitly publishes Meshopt or uncompressed geometry for this scene.",
    )
    textures = _decision(
        "textures", "Texture publishing", "BLEND",
        "Optimization plus image overrides publish original or semantic KTX2 textures.",
    )
    integration = _decision(
        "integration", "Paths, URLs & dev server", "CONFIG",
        "The small project link connects this art source to one repository; it owns paths, URLs, "
        "and commands, never artistic settings.",
    )
    artifacts = _decision(
        "artifacts", "GLB, textures & bindings", "OUTPUT",
        "The compiler rewrites these derived files; review and commit them with the website.",
    )
    return (
        camera, playback, tone, fog, background, environment, shadows,
        geometry, textures, integration, artifacts,
    )


def by_key(project, key):
    return next((decision for decision in decisions(project) if decision.key == key), None)


def draw_summary(layout, project):
    def wrapped(container, value, width=46):
        words, line = value.split(), ""
        for word in words:
            if line and len(line) + len(word) + 1 > width:
                container.label(text=line)
                line = word
            else:
                line = f"{line} {word}".strip()
        if line:
            container.label(text=line)

    for decision in decisions(project):
        box = layout.box()
        header = box.row(align=True)
        header.label(text=decision.label)
        header.label(text=f"Owned by: {OWNER_LABELS[decision.owner]}", icon={
            "BLEND": "FILE_BLEND",
            "WEBSITE": "WORLD",
            "CONFIG": "PREFERENCES",
            "OUTPUT": "EXPORT",
        }[decision.owner])
        wrapped(box, decision.reason)
