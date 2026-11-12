# SPDX-License-Identifier: GPL-3.0-or-later
"""Package/source adapter for the canonical native material color-band model."""
import importlib
import importlib.util
from pathlib import Path
import sys

_name = (__package__ + '.' if __package__ else '') + 'native_color_band'
try:
    _module = importlib.import_module(_name)
except ModuleNotFoundError as error:
    if error.name != _name:
        raise
    _source = Path(__file__).resolve().parent.parent / 'blendlink/blender/native_color_band.py'
    if not _source.is_file():
        raise ModuleNotFoundError('This Blendlink package is incomplete: native_color_band.py is missing beside its Blender helpers') from error
    _spec = importlib.util.spec_from_file_location(_name, _source)
    _module = importlib.util.module_from_spec(_spec)
    sys.modules[_name] = _module
    _spec.loader.exec_module(_module)

native_color_band = _module.native_color_band
