# SPDX-License-Identifier: GPL-3.0-or-later
"""Small, lossless GLB JSON transaction primitives.

Blendlink has several Blender-side passes that need to inspect or adjust glTF
JSON after the stock exporter has finished.  They must preserve the binary and
every unknown/extension chunk byte-for-byte and replace the artifact
atomically.  Keep that mechanical contract here instead of open-coding subtly
different readers and writers in each compiler pass.
"""
from __future__ import annotations

import json
import os
import struct


GLB_JSON_CHUNK = 0x4E4F534A
GLB_BINARY_CHUNK = 0x004E4942


def read_document(path: str, purpose: str):
    """Return ``(document, chunks, json_index)`` for one complete GLB."""
    with open(path, "rb") as handle:
        glb = handle.read()
    if len(glb) < 12:
        raise ValueError(f"cannot {purpose} GLB {path!r}: truncated header")

    magic, version, declared_length = struct.unpack_from("<4sII", glb, 0)
    if magic != b"glTF" or version != 2 or declared_length != len(glb):
        raise ValueError(
            f"cannot {purpose} GLB {path!r}: expected a complete glTF 2.0 binary"
        )

    chunks = []
    json_indices = []
    cursor = 12
    while cursor < len(glb):
        if cursor + 8 > len(glb):
            raise ValueError(f"cannot {purpose} GLB {path!r}: truncated chunk")
        chunk_length, chunk_type = struct.unpack_from("<II", glb, cursor)
        start = cursor + 8
        end = start + chunk_length
        if chunk_length % 4 or end > len(glb):
            raise ValueError(f"cannot {purpose} GLB {path!r}: invalid chunk")
        chunks.append([chunk_type, glb[start:end]])
        if chunk_type == GLB_JSON_CHUNK:
            json_indices.append(len(chunks) - 1)
        cursor = end
    if cursor != len(glb) or len(json_indices) != 1:
        raise ValueError(f"cannot {purpose} GLB {path!r}: expected one JSON chunk")

    json_index = json_indices[0]
    try:
        document = json.loads(
            chunks[json_index][1].decode("utf8").rstrip(" \t\r\n\0")
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(
            f"cannot {purpose} GLB {path!r}: invalid JSON chunk: {error}"
        ) from error
    return document, chunks, json_index


def binary_chunk(chunks: list, purpose: str) -> bytes:
    """Return the sole GLB BIN chunk without accepting ambiguous storage."""
    matches = [payload for chunk_type, payload in chunks if chunk_type == GLB_BINARY_CHUNK]
    if len(matches) != 1:
        raise ValueError(f"cannot {purpose} GLB: expected one binary chunk")
    return matches[0]


def write_document(
    path: str,
    document: dict,
    chunks: list,
    json_index: int,
    purpose: str,
) -> None:
    """Atomically replace only the JSON chunk, preserving all other bytes."""
    encoded = json.dumps(
        document, ensure_ascii=False, separators=(",", ":"),
    ).encode("utf8")
    encoded += b" " * (-len(encoded) % 4)
    chunks[json_index][1] = encoded
    payload = b"".join(
        struct.pack("<II", len(chunk), chunk_type) + chunk
        for chunk_type, chunk in chunks
    )
    rewritten = struct.pack("<4sII", b"glTF", 2, 12 + len(payload)) + payload

    temporary = f"{path}.blendlink-{purpose}-{os.getpid()}.tmp"
    try:
        with open(temporary, "wb") as handle:
            handle.write(rewritten)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)
