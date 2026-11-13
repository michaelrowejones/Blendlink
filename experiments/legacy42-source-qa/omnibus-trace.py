"""Diagnostic only: retain the last Python fixture line before a native abort."""
import os
from pathlib import Path
import runpy
import sys
fixture=Path(__file__).resolve().parents[2]/'packages/blender-addon/tests/run_headless.py'
stream=open(os.environ['BLENDLINK_QA_OMNIBUS_TRACE'],'w',buffering=1)
def trace(frame,event,arg):
    if event=='line' and frame.f_code.co_filename==str(fixture):
        stream.write(str(frame.f_lineno)+'\n')
    return trace
sys.settrace(trace)
try:runpy.run_path(str(fixture),run_name='__main__')
finally:sys.settrace(None);stream.close()
