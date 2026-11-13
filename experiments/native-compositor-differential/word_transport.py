# SPDX-License-Identifier: GPL-3.0-or-later
"""Word transport avoids float32-to-Python-float conversion under native FTZ."""
import numpy as np

MAX_WORDS = 1048576


def float32_words(array):
    if not isinstance(array, np.ndarray) or array.dtype != np.dtype(np.float32):
        raise ValueError('Oracle word transport requires an actual native float32 array')
    if not 0 < array.size <= MAX_WORDS:
        raise ValueError('Oracle word packet exceeds its bound; use raw rgba32f for larger images')
    # Do not call array.tolist() or iterate float elements: native FTZ can
    # change subnormal words while widening a float32 to a Python float.
    words = np.ascontiguousarray(array).view(np.uint32).reshape(-1).tolist()
    return {'model': 'float32-word-array-v1', 'length': len(words), 'words': words}
