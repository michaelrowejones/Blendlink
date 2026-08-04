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
        # This raises during import, before a single class registers, so the
        # artist sees a traceback and no Blendlink panel at all. Say what is
        # actually wrong and what to do, rather than "rebuild/reinstall":
        # the usual cause is a zip built from the source directory, which
        # does not contain bakelib.py, instead of the staged addon package.
        raise ModuleNotFoundError(
            "This Blendlink extension package is incomplete: bakelib.py is not "
            "beside the add-on modules, so nothing can register. Install the "
            "published extension, or build one from the staged package "
            "(packages/blendlink/dist/addon) rather than from the add-on "
            "source directory."
        )
    spec = importlib.util.spec_from_file_location(packaged_name, source)
    if spec is None or spec.loader is None:
        raise ModuleNotFoundError(f"Could not load Blendlink bake module from {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[packaged_name] = module
    spec.loader.exec_module(module)
    return module


bakelib = _load()

