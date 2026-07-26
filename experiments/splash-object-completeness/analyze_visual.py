"""PROTOTYPE: rank source-visible objects by retained visual contrast."""

from __future__ import annotations

import json
import hashlib
import math
import pathlib
import sys

import numpy as np
import OpenImageIO as oiio


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def read_image(path: pathlib.Path) -> np.ndarray:
    buffer = oiio.ImageBuf(str(path))
    spec = buffer.spec()
    if spec.width <= 0 or spec.height <= 0 or spec.nchannels < 3:
        raise RuntimeError(f"Cannot read RGB image {path}")
    return buffer.get_pixels(oiio.FLOAT)[:, :, :3]


def decode_ids(path: pathlib.Path) -> np.ndarray:
    values = read_image(path)
    scaled = values * 11.0 - 1.0
    digits = np.rint(scaled).astype(np.int32)
    close_to_code = np.max(np.abs(scaled - digits), axis=2) <= 1e-2
    valid_digits = np.all((digits >= 0) & (digits <= 9), axis=2)
    decoded = (
        digits[:, :, 0]
        + 10 * digits[:, :, 1]
        + 100 * digits[:, :, 2]
    )
    decoded[~(close_to_code & valid_digits)] = 0
    return decoded


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    height, width = mask.shape
    result = np.zeros_like(mask)
    for delta_y in range(-radius, radius + 1):
        source_y0 = max(0, -delta_y)
        source_y1 = min(height, height - delta_y)
        target_y0 = max(0, delta_y)
        target_y1 = min(height, height + delta_y)
        for delta_x in range(-radius, radius + 1):
            source_x0 = max(0, -delta_x)
            source_x1 = min(width, width - delta_x)
            target_x0 = max(0, delta_x)
            target_x1 = min(width, width + delta_x)
            result[target_y0:target_y1, target_x0:target_x1] |= mask[
                source_y0:source_y1,
                source_x0:source_x1,
            ]
    return result


def image_metrics(image: np.ndarray, mask: np.ndarray) -> dict[str, object]:
    outer = dilate(mask, 6)
    inner = dilate(mask, 2)
    ring = outer & ~inner
    pixels = image[mask]
    ring_pixels = image[ring]
    if len(pixels) == 0 or len(ring_pixels) == 0:
        return {
            "meanRgb": None,
            "meanLuma": None,
            "lumaStd": None,
            "ringMedianRgb": None,
            "medianContrastToRing": None,
        }
    ring_median = np.median(ring_pixels, axis=0)
    distances = np.linalg.norm(pixels - ring_median, axis=1)
    luma = (
        pixels[:, 0] * 0.2126
        + pixels[:, 1] * 0.7152
        + pixels[:, 2] * 0.0722
    )
    return {
        "meanRgb": [round(float(value), 6) for value in pixels.mean(axis=0)],
        "meanLuma": round(float(luma.mean()), 6),
        "lumaStd": round(float(luma.std()), 6),
        "ringMedianRgb": [
            round(float(value), 6)
            for value in ring_median
        ],
        "medianContrastToRing": round(float(np.median(distances)), 6),
    }


def fit_crop(
    image: np.ndarray,
    region: tuple[int, int, int, int],
    target_width: int,
    target_height: int,
) -> np.ndarray:
    x0, y0, x1, y1 = region
    crop = image[y0:y1, x0:x1]
    height, width = crop.shape[:2]
    scale = min(target_width / width, target_height / height)
    scaled_width = max(1, int(round(width * scale)))
    scaled_height = max(1, int(round(height * scale)))
    xs = np.linspace(0, width - 1, scaled_width).astype(np.int32)
    ys = np.linspace(0, height - 1, scaled_height).astype(np.int32)
    resized = crop[ys[:, None], xs[None, :]]
    tile = np.zeros((target_height, target_width, 3), dtype=np.float32)
    offset_x = (target_width - scaled_width) // 2
    offset_y = (target_height - scaled_height) // 2
    tile[
        offset_y : offset_y + scaled_height,
        offset_x : offset_x + scaled_width,
    ] = resized
    return tile


def write_png(path: pathlib.Path, pixels: np.ndarray) -> None:
    pixels = np.clip(pixels, 0.0, 1.0)
    encoded = np.rint(pixels * 255.0).astype(np.uint8)
    height, width, channels = encoded.shape
    output = oiio.ImageOutput.create(str(path))
    if output is None:
        raise RuntimeError(f"Cannot create image output {path}")
    try:
        if not output.open(
            str(path),
            oiio.ImageSpec(width, height, channels, oiio.UINT8),
        ):
            raise RuntimeError(output.geterror())
        if not output.write_image(encoded):
            raise RuntimeError(output.geterror())
    finally:
        output.close()


def main() -> None:
    if len(sys.argv) != 11:
        raise RuntimeError(
            "Expected source evidence, structural evidence, ID EXR, Eevee PNG, "
            "Blendlink stock PNG, Blendlink lowered PNG, Needle PNG, ID preview "
            "PNG, output JSON, output PNG"
        )
    (
        source_evidence_path,
        structural_evidence_path,
        id_exr_path,
        eevee_path,
        blendlink_stock_path,
        blendlink_path,
        needle_path,
        id_preview_path,
        output_json_path,
        output_png_path,
    ) = [pathlib.Path(value).resolve() for value in sys.argv[1:]]

    source_evidence = json.loads(source_evidence_path.read_text(encoding="utf-8"))
    structural_evidence = json.loads(
        structural_evidence_path.read_text(encoding="utf-8")
    )
    decoded_ids = decode_ids(id_exr_path)
    images = {
        "eevee": read_image(eevee_path),
        "blendlinkStock": read_image(blendlink_stock_path),
        "blendlink": read_image(blendlink_path),
        "needle": read_image(needle_path),
        "objectId": read_image(id_preview_path),
    }
    expected_shape = decoded_ids.shape
    for label, image in images.items():
        if image.shape[:2] != expected_shape:
            raise RuntimeError(
                f"{label} shape {image.shape[:2]} != ID shape {expected_shape}"
            )

    comparisons_by_name = {
        record["name"]: record
        for record in structural_evidence["comparisons"]
    }
    object_records = []
    for object_index, source_object in enumerate(
        source_evidence["objects"],
        start=1,
    ):
        if not bool(source_object.get("objectIdReliable", False)):
            continue
        structural = comparisons_by_name.get(source_object["name"])
        if structural is None:
            # These are excluded source meshes that remain visible only as
            # Geometry Nodes instance sources. Direct-name completeness cannot
            # truthfully classify their occurrences.
            continue
        mask = decoded_ids == object_index
        pixel_count = int(np.count_nonzero(mask))
        if pixel_count == 0:
            continue
        image_evidence = {
            label: image_metrics(image, mask)
            for label, image in images.items()
            if label != "objectId"
        }
        source_contrast = image_evidence["eevee"]["medianContrastToRing"]
        blendlink_stock_contrast = image_evidence["blendlinkStock"][
            "medianContrastToRing"
        ]
        blendlink_contrast = image_evidence["blendlink"]["medianContrastToRing"]
        needle_contrast = image_evidence["needle"]["medianContrastToRing"]
        blendlink_retention = (
            blendlink_contrast / source_contrast
            if source_contrast and blendlink_contrast is not None
            else None
        )
        blendlink_stock_retention = (
            blendlink_stock_contrast / source_contrast
            if source_contrast and blendlink_stock_contrast is not None
            else None
        )
        needle_retention = (
            needle_contrast / source_contrast
            if source_contrast and needle_contrast is not None
            else None
        )
        if not structural["inBlendlink"]:
            classification = "structural-omission"
        elif (
            source_contrast is not None
            and source_contrast >= 0.05
            and blendlink_retention is not None
            and blendlink_retention < 0.35
        ):
            classification = "visually-collapsed"
        else:
            classification = "retained-or-ambiguous"
        object_records.append(
            {
                "name": source_object["name"],
                "visiblePixels": pixel_count,
                "bboxTopLeft": source_object["bboxTopLeft"],
                "materials": source_object["materials"],
                "inBlendlink": structural["inBlendlink"],
                "inNeedle": structural["inNeedle"],
                "classification": classification,
                "blendlinkStockContrastRetention": (
                    round(float(blendlink_stock_retention), 6)
                    if blendlink_stock_retention is not None
                    else None
                ),
                "blendlinkContrastRetention": (
                    round(float(blendlink_retention), 6)
                    if blendlink_retention is not None
                    else None
                ),
                "needleContrastRetention": (
                    round(float(needle_retention), 6)
                    if needle_retention is not None
                    else None
                ),
                "images": image_evidence,
            }
        )

    likely_collapsed = sorted(
        (
            record
            for record in object_records
            if record["visiblePixels"] >= 50
            and record["classification"] == "visually-collapsed"
        ),
        key=lambda record: (
            record["blendlinkContrastRetention"],
            -record["visiblePixels"],
        ),
    )
    needle_advantages = sorted(
        (
            record
            for record in object_records
            if record["visiblePixels"] >= 50
            and record["blendlinkContrastRetention"] is not None
            and record["needleContrastRetention"] is not None
            and record["needleContrastRetention"]
            - record["blendlinkContrastRetention"]
            >= 0.25
        ),
        key=lambda record: (
            record["blendlinkContrastRetention"]
            - record["needleContrastRetention"]
        ),
    )

    focus_names = [
        "Pencil.001.GPM.meshline",
        "Pencil.001.GPM.meshline.003",
        "Pencil.GPM.meshline.004",
        "Pencil.GPM.meshline.005",
        "Pencil.GPM.meshline.006",
        "Icosphere.025",
        "Icosphere.026",
        "Icosphere.028",
        "Icosphere.029",
    ]
    records_by_name = {record["name"]: record for record in object_records}
    focus = {
        name: records_by_name[name]
        for name in focus_names
        if name in records_by_name
    }

    regions = {
        "lamp": (495, 175, 570, 280),
        "leftHangingFlowerpot": (405, 225, 510, 335),
        "rightHangingFlowerpot": (750, 180, 865, 320),
        "groundFlowerpot": (725, 365, 855, 515),
    }
    column_order = [
        "eevee",
        "blendlinkStock",
        "blendlink",
        "needle",
        "objectId",
    ]
    tile_width = 240
    tile_height = 190
    gap = 8
    canvas_height = len(regions) * tile_height + (len(regions) - 1) * gap
    canvas_width = len(column_order) * tile_width + (len(column_order) - 1) * gap
    canvas = np.zeros((canvas_height, canvas_width, 3), dtype=np.float32)
    column_colors = {
        "eevee": (0.2, 0.55, 1.0),
        "blendlinkStock": (0.55, 0.55, 0.55),
        "blendlink": (1.0, 0.25, 0.65),
        "needle": (1.0, 0.65, 0.15),
        "objectId": (0.25, 0.9, 0.45),
    }
    for row_index, region in enumerate(regions.values()):
        y = row_index * (tile_height + gap)
        for column_index, label in enumerate(column_order):
            x = column_index * (tile_width + gap)
            tile = fit_crop(
                images[label],
                region,
                tile_width,
                tile_height,
            )
            tile[:5, :, :] = column_colors[label]
            canvas[y : y + tile_height, x : x + tile_width] = tile

    output_png_path.parent.mkdir(parents=True, exist_ok=True)
    write_png(output_png_path, canvas)
    evidence = {
        "prototype": "splash-object-visual-completeness-v1",
        "inputs": {
            "sourceEvidence": {
                "path": str(source_evidence_path),
                "sha256": sha256_file(source_evidence_path),
            },
            "structuralEvidence": {
                "path": str(structural_evidence_path),
                "sha256": sha256_file(structural_evidence_path),
            },
            "objectIdExr": {
                "path": str(id_exr_path),
                "sha256": sha256_file(id_exr_path),
            },
            "eevee": {
                "path": str(eevee_path),
                "sha256": sha256_file(eevee_path),
            },
            "blendlinkStock": {
                "path": str(blendlink_stock_path),
                "sha256": sha256_file(blendlink_stock_path),
            },
            "blendlink": {
                "path": str(blendlink_path),
                "sha256": sha256_file(blendlink_path),
            },
            "needle": {
                "path": str(needle_path),
                "sha256": sha256_file(needle_path),
            },
            "objectIdPreview": {
                "path": str(id_preview_path),
                "sha256": sha256_file(id_preview_path),
            },
        },
        "metric": (
            "Median RGB code-value distance from source-object interior pixels "
            "to a 3-6px surrounding ring at the same authored-camera coordinates."
        ),
        "classificationThresholds": {
            "minimumVisiblePixels": 50,
            "minimumSourceContrast": 0.05,
            "visuallyCollapsedRetentionBelow": 0.35,
            "needleAdvantageAbove": 0.25,
        },
        "diagnosticImage": {
            "path": str(output_png_path),
            "columnOrder": column_order,
            "rowOrder": list(regions),
            "columnMarkerColors": column_colors,
        },
        "focus": focus,
        "likelyVisuallyCollapsed": likely_collapsed[:30],
        "needleAdvantages": needle_advantages[:30],
        "objectRecords": object_records,
    }
    output_json_path.write_text(
        json.dumps(evidence, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    print(
        "BLENDLINK_SPLASH_VISUAL_COMPLETENESS "
        f"collapsed={len(likely_collapsed)} "
        f"needleAdvantages={len(needle_advantages)} "
        f"output={output_json_path}"
    )


if __name__ == "__main__":
    main()
