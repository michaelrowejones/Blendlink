# SPDX-License-Identifier: GPL-3.0-or-later
"""Windows never tries the invalid POSIX process handle; missing CRT refuses."""
import ctypes
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'blendlink/blender'))
import compositor_chroma_key as chroma
import compositor_affine as affine
import compositor_blur as blur

class Function:
    def __call__(self,*_args):raise AssertionError('Routing mock must not supply numerical results')

symbols=['sinf','cosf','tanf','sqrtf','atan2f','expf']
for module,attribute,expected in [
    (chroma,'_native_math',['sinf','cosf','tanf','sqrtf','atan2f']),
    (affine,'native_trigonometry',['sinf','cosf']),
    (blur,'gaussian_float_math',['expf','sqrtf']),
]:
    load=getattr(module,attribute)
    def library(name,**kwargs):
        assert name=='ucrtbase.dll' and kwargs=={'winmode':0x800},(name,kwargs)
        return SimpleNamespace(**{name:Function() for name in symbols})
    try:
        with patch.object(sys,'platform','win32'),patch.object(ctypes,'CDLL',side_effect=library) as mocked:
            load.cache_clear();functions=load();assert mocked.call_count==1
            for symbol,function in zip(expected,functions):
                assert function.argtypes==(ctypes.c_float,)*(2 if symbol=='atan2f' else 1)
                assert function.restype is ctypes.c_float
        for failure in [OSError('No system UCRT'),AttributeError('Missing scalar float export')]:
            with patch.object(sys,'platform','win32'),patch.object(ctypes,'CDLL',side_effect=failure) as mocked:
                load.cache_clear()
                try:load();raise AssertionError('Unavailable native math acquired a fallback')
                except ValueError as error:assert 'native scalar C' in str(error),str(error)
                assert mocked.call_args.args==('ucrtbase.dll',) and mocked.call_count==1
        # The established Unix process/libm route stays intact.
        def process(name,**kwargs):
            assert name is None and not kwargs
            return SimpleNamespace(**{name:Function() for name in symbols})
        with patch.object(sys,'platform','darwin'),patch.object(ctypes,'CDLL',side_effect=process):
            load.cache_clear();assert len(load())==len(expected)
    finally:load.cache_clear()
print('BLENDLINK_NATIVE_COMPOSITOR_MATH_LOADER_PASSED system UCRT, exact float ABI, explicit unavailable refusal, Unix unchanged')
