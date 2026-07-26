# SPDX-License-Identifier: GPL-3.0-or-later
"""Build and verify an optional packed-float KTX2 environment.

The authored HDR/EXR is never modified.  This helper runs in Blender because
Blender already provides the one decoder that can read both source formats as
scene-linear float pixels.  KTX-Software performs only the standardized
B10G11R11 + Zstd conversion; its extracted EXR is compared with the pixels
Blender decoded from the original source.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np

# This file is executed directly by Blender from dist/blender. Keep the
# canonical bake/save primitives beside it so source and packaged runs share
# exactly one implementation.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakelib  # noqa: E402


def _radiance_metrics(reference, decoded, width: int, height: int) -> dict:
    if len(reference) != len(decoded) or len(reference) != width * height * 4:
        raise ValueError(
            f"decoded pixel count changed ({len(reference)} -> {len(decoded)})"
        )

    source_squared = 0.0
    error_squared = 0.0
    source_absolute = 0.0
    error_absolute = 0.0
    source_peak = 0.0
    decoded_peak = 0.0
    max_error = 0.0
    source_min = math.inf
    invalid_values = 0
    negative_channels = 0
    source_luminance_peak = 0.0
    # Slice the Blender pixel collections in bounded chunks. Holding two full
    # Python float copies of an 8K environment can otherwise exceed 1 GiB on
    # top of Blender's image buffers. NumPy keeps the actual comparisons
    # vectorized: a large studio environment should spend its time in KTX,
    # not in hundreds of millions of Python-loop iterations.
    chunk_values = 256 * 1024
    for start in range(0, len(reference), chunk_values):
        end = min(len(reference), start + chunk_values)
        source_chunk = np.asarray(reference[start:end], dtype=np.float64).reshape(-1, 4)[:, :3]
        decoded_chunk = np.asarray(decoded[start:end], dtype=np.float64).reshape(-1, 4)[:, :3]
        finite = np.isfinite(source_chunk).all(axis=1) & np.isfinite(decoded_chunk).all(axis=1)
        invalid_values += int(np.count_nonzero(~finite))
        if not np.any(finite):
            continue
        source_rgb = source_chunk[finite]
        decoded_rgb = decoded_chunk[finite]
        error = decoded_rgb - source_rgb
        source_squared += float(np.sum(source_rgb * source_rgb, dtype=np.float64))
        error_squared += float(np.sum(error * error, dtype=np.float64))
        source_absolute += float(np.sum(np.abs(source_rgb), dtype=np.float64))
        error_absolute += float(np.sum(np.abs(error), dtype=np.float64))
        source_peak = max(source_peak, float(np.max(source_rgb)))
        decoded_peak = max(decoded_peak, float(np.max(decoded_rgb)))
        source_min = min(source_min, float(np.min(source_rgb)))
        max_error = max(max_error, float(np.max(np.abs(error))))
        negative_channels += int(np.count_nonzero(source_rgb < -1e-7))
        luminance = source_rgb @ np.array((0.2126, 0.7152, 0.0722))
        source_luminance_peak = max(source_luminance_peak, float(np.max(luminance)))

    luminance_floor = max(1e-8, source_luminance_peak * 1e-5)
    stops_squared = 0.0
    stops_samples = 0
    for start in range(0, len(reference), chunk_values):
        end = min(len(reference), start + chunk_values)
        source_rgb = np.asarray(reference[start:end], dtype=np.float64).reshape(-1, 4)[:, :3]
        decoded_rgb = np.asarray(decoded[start:end], dtype=np.float64).reshape(-1, 4)[:, :3]
        source_luminance = source_rgb @ np.array((0.2126, 0.7152, 0.0722))
        decoded_luminance = decoded_rgb @ np.array((0.2126, 0.7152, 0.0722))
        usable = (
            np.isfinite(source_luminance)
            & np.isfinite(decoded_luminance)
            & (source_luminance > luminance_floor)
        )
        if not np.any(usable):
            continue
        stops = np.log2(
            np.maximum(decoded_luminance[usable], luminance_floor * 1e-3)
            / source_luminance[usable]
        )
        stops_squared += float(np.sum(stops * stops, dtype=np.float64))
        stops_samples += int(stops.size)

    epsilon = 1e-20
    return {
        "width": width,
        "height": height,
        "relativeRmse": math.sqrt(error_squared / max(source_squared, epsilon)),
        "meanRelativeError": error_absolute / max(source_absolute, epsilon),
        "peakRelativeError": abs(decoded_peak - source_peak) / max(abs(source_peak), 1e-8),
        "maxErrorOverPeak": max_error / max(abs(source_peak), 1e-8),
        "logLuminanceRmseStops": math.sqrt(stops_squared / max(stops_samples, 1)),
        "sourcePeak": source_peak,
        "decodedPeak": decoded_peak,
        "sourceMin": source_min if source_min != math.inf else 0.0,
        "negativeChannels": negative_channels,
        "invalidPixels": invalid_values,
    }


def _run(tool: str, args: list[str], label: str) -> str:
    result = subprocess.run(
        [tool, *args],
        capture_output=True,
        text=True,
        timeout=240,
        check=False,
    )
    output = f"{result.stdout}\n{result.stderr}".strip()
    if result.returncode != 0:
        tail = "\n".join(output.splitlines()[-12:]) or "no diagnostic output"
        raise RuntimeError(f"KTX-Software failed while {label} (exit {result.returncode}): {tail}")
    return output


def _ktx_create_dialect(tool: str) -> tuple[str, bool]:
    """Support stable KTX 4.3 and 4.4+ create option names."""
    help_text = _run(tool, ["create", "--help"], "inspecting create capabilities")
    if "--assign-tf " in help_text:
        transfer_option = "--assign-tf"
    elif "--assign-oetf " in help_text:
        transfer_option = "--assign-oetf"
    else:
        raise RuntimeError(
            "KTX create exposes neither --assign-tf nor --assign-oetf"
        )
    return transfer_option, "--assign-texcoord-origin " in help_text


def main() -> None:
    import bpy

    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) != 4:
        raise SystemExit("expected: -- <source.hdr|exr> <output.ktx2> <ktx> <result.json>")
    source_path, output_path, ktx_tool, result_path = args
    result: dict = {"ok": False}
    source_image = None
    decoded_image = None
    try:
        print("BLENDLINK_HDR_PROGRESS decoding authored environment", flush=True)
        source_image = bpy.data.images.load(source_path, check_existing=False)
        width, height = map(int, source_image.size)
        if width <= 0 or height <= 0:
            raise RuntimeError("source environment has no decodable dimensions")
        with tempfile.TemporaryDirectory(prefix="blendlink-hdr-") as work:
            prepared_path = os.path.join(work, "source.exr")
            decoded_path = os.path.join(work, "decoded.exr")
            # ktx create deliberately accepts EXR, PNG, and raw input only.
            # Re-emit both HDR and EXR through the same float-pixel path so
            # packed/multilayer sources have deterministic channel handling.
            print("BLENDLINK_HDR_PROGRESS preparing scene-linear EXR", flush=True)
            bakelib.save_linear_exr(source_image, prepared_path)
            print("BLENDLINK_HDR_PROGRESS encoding packed-float KTX2", flush=True)
            transfer_option, supports_origin = _ktx_create_dialect(ktx_tool)
            create_args = [
                "create",
                "--format", "B10G11R11_UFLOAT_PACK32",
                transfer_option, "linear",
                "--assign-primaries", "bt709",
            ]
            if supports_origin:
                create_args.extend(["--assign-texcoord-origin", "top-left"])
            create_args.extend([
                "--zstd", "18",
                prepared_path,
                output_path,
            ])
            _run(
                ktx_tool,
                create_args,
                "encoding the HDR environment",
            )
            print("BLENDLINK_HDR_PROGRESS validating KTX2 container", flush=True)
            _run(ktx_tool, ["validate", output_path], "validating the HDR environment")
            print("BLENDLINK_HDR_PROGRESS decoding shipped KTX2", flush=True)
            _run(
                ktx_tool,
                ["extract", "--level", "0", output_path, decoded_path],
                "decoding the HDR environment for radiance verification",
            )
            decoded_image = bpy.data.images.load(decoded_path, check_existing=False)
            decoded_width, decoded_height = map(int, decoded_image.size)
            if (decoded_width, decoded_height) != (width, height):
                raise RuntimeError(
                    f"KTX round-trip changed dimensions {width}x{height} -> "
                    f"{decoded_width}x{decoded_height}"
                )
            print("BLENDLINK_HDR_PROGRESS comparing scene-linear radiance", flush=True)
            metrics = _radiance_metrics(
                source_image.pixels, decoded_image.pixels, width, height
            )
        with open(output_path, "rb") as handle:
            payload = handle.read()
        result = {
            "ok": True,
            "bytes": len(payload),
            "hash": hashlib.sha256(payload).hexdigest()[:16],
            "metrics": metrics,
        }
    except Exception as error:  # optional optimization; the raw source remains authoritative
        result = {"ok": False, "error": str(error)}
        if os.path.exists(output_path):
            os.remove(output_path)
    finally:
        if decoded_image is not None:
            bpy.data.images.remove(decoded_image)
        if source_image is not None:
            bpy.data.images.remove(source_image)
        with open(result_path, "w", encoding="utf-8") as handle:
            json.dump(result, handle)
        if result.get("ok"):
            print("BLENDLINK_HDR_OK verified packed-float KTX2")
        else:
            print(f"BLENDLINK_HDR_FALLBACK {result.get('error', 'unknown failure')}")


if __name__ == "__main__":
    main()
