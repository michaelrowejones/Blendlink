# SPDX-License-Identifier: GPL-3.0-or-later
"""Locate the one canonical policy in installed and standalone source layouts."""
import importlib
import importlib.util
from pathlib import Path
import sys

_name = (__package__ + '.' if __package__ else '') + 'compositor_group_defaults'
try:
    policy = importlib.import_module(_name)
except ModuleNotFoundError as error:
    if error.name != _name:
        raise
    source = Path(__file__).resolve().parents[1] / 'blendlink' / 'blender' / 'compositor_group_defaults.py'
    if not source.is_file():
        raise
    spec = importlib.util.spec_from_file_location(_name, source)
    policy = importlib.util.module_from_spec(spec)
    sys.modules[_name] = policy
    try:
        spec.loader.exec_module(policy)
    except Exception:
        sys.modules.pop(_name, None)
        raise

validate_input = policy.validate_input
GroupDefaultUnsupported = policy.GroupDefaultUnsupported
