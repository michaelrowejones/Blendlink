# SPDX-License-Identifier: GPL-3.0-or-later
"""Load the one canonical bake module in packaged and source checkouts.

Release builds copy ``packages/blendlink/blender/bakelib.py`` beside this
module. Source-tree addon tests load the same file in place. This adapter is
only the packaging seam; bake mechanics remain authored in bakelib.py once.
"""
from __future__ import annotations

import importlib
import importlib.util
import sys
from pathlib import Path


def _load():
    packaged_name = f"{__package__}.bakelib"
    try:
        return importlib.import_module(packaged_name)
    except ModuleNotFoundError as error:
        if error.name != packaged_name:
            raise

    source = Path(__file__).resolve().parent.parent / "blendlink" / "blender" / "bakelib.py"
    if not source.is_file():
        raise ModuleNotFoundError(
            "Blendlink's canonical bakelib.py is missing from the addon package; "
            "rebuild/reinstall Blendlink"
        )
    spec = importlib.util.spec_from_file_location(packaged_name, source)
    if spec is None or spec.loader is None:
        raise ModuleNotFoundError(f"Could not load Blendlink bake module from {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[packaged_name] = module
    spec.loader.exec_module(module)
    return module


bakelib = _load()

