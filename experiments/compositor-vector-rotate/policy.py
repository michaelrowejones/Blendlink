# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Full Vector Rotate family source policy.
from pathlib import Path
import os,runpy,sys
root=Path(__file__).resolve().parents[2]
sys.argv=[str(root/'packages/blender-addon/tests/compositor_vector_rotate_check.py'),'--',str(Path(os.environ['SCENETOWEB_VECTOR_ROTATE_REFERENCES'])/'policy.json')]
runpy.run_path(sys.argv[0],run_name='__main__')
