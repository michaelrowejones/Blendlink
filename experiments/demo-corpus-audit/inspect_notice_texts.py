"""Print embedded notice/readme text blocks without executing source scripts.

Run with Blender's ``--disable-autoexec`` and an immutable source file:

  blender --background --factory-startup --disable-autoexec scene.blend \
    --python inspect_notice_texts.py

Only explicitly notice-like datablock names are emitted. This keeps the normal
capability inventory from dumping arbitrary embedded Python or artist notes.
The script never saves the open file.
"""

from __future__ import annotations

import json
import re

import bpy


NOTICE_NAME = re.compile(r"(readme|license|licence|copying|copyright|authors?)", re.I)


def main() -> None:
    notices = [
        {
            "name": text.name,
            "content": text.as_string(),
        }
        for text in bpy.data.texts
        if NOTICE_NAME.search(text.name)
    ]
    print("##blendlink-demo-corpus-notices " + json.dumps(notices, sort_keys=True))


if __name__ == "__main__":
    main()
