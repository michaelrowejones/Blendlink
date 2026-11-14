# SPDX-License-Identifier: GPL-3.0-or-later
"""Transport authored display operations without resampling the whole look."""

import base64, hashlib, json, math, os, pathlib
import bpy
import numpy as np
import PyOpenColorIO as O


def config_from_install():
    path = os.environ.get("OCIO") or str(
        pathlib.Path(bpy.utils.resource_path("LOCAL"))
        / "datafiles/colormanagement/config.ocio"
    )
    if not pathlib.Path(path).is_file():
        raise ValueError("Cannot resolve authored OCIO configuration: " + path)
    return O.Config.CreateFromFile(path), path


def composed_processor(scene, cfg):
    view = scene.view_settings
    if view.use_curve_mapping:
        raise ValueError(
            "Authored display CurveMapping has no supported browser mapping"
        )
    group = O.GroupTransform()
    matrix = np.eye(4)
    if getattr(view, "use_white_balance", False):
        # RNA already evaluates Blender's temperature/tint locus into scene RGB.
        basis = np.eye(3, dtype=np.float32)
        cfg.getProcessor(
            "scene_linear", "cie_xyz_d65_interchange"
        ).getDefaultCPUProcessor().applyRGB(basis)
        scene_to_xyz = basis.T.astype(np.float64)
        source = scene_to_xyz @ np.asarray(view.white_balance_whitepoint)
        target = scene_to_xyz @ np.ones(3)
        bradford = np.array(
            [
                [0.8951, 0.2664, -0.1614],
                [-0.7502, 1.7135, 0.0367],
                [0.0389, -0.0685, 1.0296],
            ]
        )
        adapt = (
            np.linalg.inv(bradford)
            @ np.diag((bradford @ target / target[1]) / (bradford @ source / source[1]))
            @ bradford
        )
        matrix[:3, :3] = np.linalg.inv(scene_to_xyz) @ adapt @ scene_to_xyz
    matrix[:3, :3] *= 2**view.exposure
    group.appendTransform(O.MatrixTransform(matrix=matrix.ravel().tolist()))
    src = O.ROLE_SCENE_LINEAR
    look = str(view.look)
    if look not in ("", "None"):
        # Blender RNA provides one selected look, not an arbitrary OCIO look chain.
        dst = cfg.getLook(look).getProcessSpace()
        if cfg.getColorSpace(
            cfg.getDisplayViewColorSpaceName(
                scene.display_settings.display_device, view.view_transform
            )
        ).isData():
            dst = src
        group.appendTransform(O.LookTransform(src=src, dst=dst, looks=look))
        src = dst
    group.appendTransform(
        O.DisplayViewTransform(
            src=src,
            display=scene.display_settings.display_device,
            view=view.view_transform,
            looksBypass=look not in ("", "None"),
        )
    )
    if view.gamma != 1:
        group.appendTransform(
            O.ExponentTransform(
                value=[1 / max(np.finfo(np.float32).eps, view.gamma)] * 3 + [1]
            )
        )
    return cfg.getProcessor(group)


def enum_name(value):
    return str(value).split(".")[-1]


def float_buffer(values):
    data = np.asarray(values, dtype="<f4").ravel()
    return {
        "encoding": "base64-f32le",
        "count": int(data.size),
        "data": base64.b64encode(data.tobytes()).decode("ascii"),
    }


def lower_neutral_log_contrast(transform):
    """Exact algebraic subset; rejects grading parameters outside plain log contrast.

    OCIO 2.5 GradingPrimary.cpp: c_rgb=float(master*channel),
    actualPivot=0.5+0.5*pivot. CPU applies (x-actualPivot)*c+actualPivot.
    Float evaluation order differs after lowering, so tiny rounding deltas remain.
    """
    if (
        not isinstance(transform, O.GradingPrimaryTransform)
        or transform.getStyle() != O.GRADING_LOG
        or transform.getDirection() != O.TRANSFORM_DIR_FORWARD
    ):
        raise ValueError("Only forward log GradingPrimary contrast can lower to Matrix")
    if getattr(transform, "isDynamic", lambda: False)():
        raise ValueError("Dynamic grading cannot be frozen into a Matrix")
    v = transform.getValue()

    def rgbm(parameter):
        return [getattr(parameter, k) for k in ("red", "green", "blue", "master")]

    for field in ("brightness", "offset", "exposure", "lift"):
        if rgbm(getattr(v, field)) != [0, 0, 0, 0]:
            raise ValueError("Nonneutral GradingPrimary " + field)
    for field in ("gamma", "gain"):
        if rgbm(getattr(v, field)) != [1, 1, 1, 1]:
            raise ValueError("Nonneutral GradingPrimary " + field)
    if (
        v.saturation != 1
        or v.pivotBlack != 0
        or v.pivotWhite != 1
        or v.clampBlack != v.NoClampBlack
        or v.clampWhite != v.NoClampWhite
    ):
        raise ValueError("Nonneutral GradingPrimary saturation/pivots/clamps")
    c = rgbm(v.contrast)
    if not all(math.isfinite(n) and n > 0 for n in c) or not math.isfinite(v.pivot):
        raise ValueError("Invalid contrast parameters")
    contrast = np.asarray(
        [c[0] * c[3], c[1] * c[3], c[2] * c[3]], dtype=np.float32
    ).astype(np.float64)
    pivot = float(np.float32(0.5 + 0.5 * v.pivot))
    m = np.diag([*contrast, 1])
    offset = [*(pivot * (1 - contrast)), 0]
    return O.MatrixTransform(matrix=m.ravel().tolist(), offset=offset)


def serialize_ops(processor):
    ops = []
    for t in processor.getOptimizedProcessor(
        O.OPTIMIZATION_DEFAULT
    ).createGroupTransform():
        if isinstance(t, O.GradingPrimaryTransform):
            t = lower_neutral_log_contrast(t)
        direction = enum_name(t.getDirection())
        op = {"type": type(t).__name__, "direction": direction}
        if isinstance(t, O.MatrixTransform):
            op.update(
                matrix=list(t.getMatrix()),
                offset=list(t.getOffset()),
                matrixOrder="row-major",
            )
        elif isinstance(t, O.LogTransform):
            op.update(base=t.getBase(), minPositive=float(np.finfo(np.float32).tiny))
        elif isinstance(t, O.LogAffineTransform):
            op.update(
                base=t.getBase(),
                logSideSlope=list(t.getLogSideSlopeValue()),
                logSideOffset=list(t.getLogSideOffsetValue()),
                linSideSlope=list(t.getLinSideSlopeValue()),
                linSideOffset=list(t.getLinSideOffsetValue()),
                minPositive=float(np.finfo(np.float32).tiny),
            )
        elif isinstance(t, O.ExponentTransform):
            op.update(
                value=list(t.getValue()), negativeStyle=enum_name(t.getNegativeStyle())
            )
        elif isinstance(t, O.ExponentWithLinearTransform):
            op.update(
                gamma=list(t.getGamma()),
                offset=list(t.getOffset()),
                negativeStyle=enum_name(t.getNegativeStyle()),
            )
        elif isinstance(t, O.Lut1DTransform):
            if (
                t.getInputHalfDomain()
                or t.getOutputRawHalfs()
                or t.getHueAdjust() != O.HUE_NONE
                or direction != "TRANSFORM_DIR_FORWARD"
            ):
                raise ValueError("Unsupported Lut1D half-domain/hue adjustment/inverse")
            op.update(
                length=t.getLength(),
                interpolation=enum_name(t.getInterpolation()),
                values=float_buffer(t.getData()),
                dataOrder="index,rgb",
            )
        elif isinstance(t, O.Lut3DTransform):
            if direction != "TRANSFORM_DIR_FORWARD":
                raise ValueError("Unsupported inverse Lut3D")
            op.update(
                size=t.getGridSize(),
                interpolation=enum_name(t.getInterpolation()),
                values=float_buffer(t.getData()),
                dataOrder="r,g,b,rgb; b-fastest",
            )
        else:
            raise ValueError("Unsupported OCIO operation: " + type(t).__name__)
        ops.append(op)
    return ops


def export_source_presentation(scene, glb_path):
    """An owned asset, independent of the site's explicit presentation policy."""
    result = {
        "schemaVersion": 1,
        "model": "blendlink-source-presentation-v1",
        "warnings": [],
    }
    from compositor_graph import extract, validate_mask_presentation

    compositor = extract(scene)
    if compositor["status"] != "disabled":
        result["compositor"] = compositor
    try:
        cfg, _path = config_from_install()
        if "compositor" in result:
            result["compositor"]["luminance"] = list(cfg.getDefaultLumaCoefs())
        if scene.display_settings.display_device != "sRGB":
            raise ValueError("The browser display currently supports sRGB only")
        input_space = cfg.getColorSpace(O.ROLE_SCENE_LINEAR).getName()
        if input_space != "Linear Rec.709":
            raise ValueError(
                "The browser working space currently supports Linear Rec.709 only"
            )
        processor = composed_processor(scene, cfg)
        ops = serialize_ops(processor)
        # Resolve inverse matrices at export; the runtime accepts only forward rows.
        for op in ops:
            if (
                op["type"] == "MatrixTransform"
                and op["direction"] == "TRANSFORM_DIR_INVERSE"
            ):
                inverse = np.linalg.inv(np.array(op["matrix"]).reshape(4, 4))
                op["offset"] = (-inverse @ np.asarray(op["offset"])).tolist()
                op["matrix"] = inverse.ravel().tolist()
                op["direction"] = "TRANSFORM_DIR_FORWARD"
        result["display"] = {
            "version": 1,
            "view": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "inputColorSpace": input_space,
            "outputDisplay": scene.display_settings.display_device,
            "configCacheID": cfg.getCacheID(),
            "processorCacheID": processor.getCacheID(),
            "ops": ops,
        }
    except (ValueError, O.Exception) as error:
        result["warnings"].append(
            "Blender display transform: "
            + str(error)
            + ". Native preview tone mapping remains active."
        )
    budget_issue = validate_mask_presentation(result)
    if budget_issue:
        op, message = budget_issue
        result['compositor']['status'] = 'unsupported'
        result['compositor']['diagnostics'].append({'code':('unsupported-wave-axis-sampler-budget' if op['kind']=='wave-texture' else 'unsupported-white-noise-sampler-budget' if op['kind']=='white-noise-texture' else 'unsupported-box-mask-sampler-budget' if op['kind']=='box-mask' else 'unsupported-ellipse-mask-sampler-budget'),
            'path':op['source']['path'], 'node':op['source']['node'],
            'socket':op['source']['output'], 'message':message})
    payload = json.dumps(
        result, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf8")
    path = str(glb_path) + ".presentation.json"
    pathlib.Path(path).write_bytes(payload)
    return {
        "path": path,
        "bytes": len(payload),
        "hash": hashlib.sha256(payload).hexdigest()[:16],
        "displayAvailable": "display" in result,
    }
