# SPDX-License-Identifier: GPL-3.0-or-later
"""Run the actual source policy inside the family-owned native transaction."""
from pathlib import Path
import os,runpy,sys
root=Path(__file__).resolve().parents[2]
sys.argv=[str(Path(__file__)), '--',os.environ['SCENETOWEB_BLANK_IMAGE_REFERENCES']]
runpy.run_path(str(root/'packages/blender-addon/tests/compositor_blank_image_check.py'),run_name='__main__')
