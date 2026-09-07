# EEVEE source passes and Three.js MRT

Investigated September 7, 2026 using Blender 5.2.0 LTS commit `fbe6228777e7` and local Three.js 0.184.0. Scope is opaque raster surfaces, source definitions, and an isolated Blender oracle. No runtime implementation was changed.

## Depth

EEVEE Depth is positive camera-axis linear Z for perspective and orthographic cameras. It is not the Euclidean distance along a perspective ray. `depth_convert_to_scene()` returns `-view.depth_screen_to_view(depth)`. The same source uses `length(viewPosition)` for perspective **Mist**, which is a different quantity. If the normalized conventional depth is exactly 1, film output replaces it with `1e10`. [Pinned film shader](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/draw/engines/eevee/shaders/eevee_film.bsl.hh).

The oracle places a plane at world Z=0 and a camera at Z=5. Perspective Depth is `5.0000042915` at both center and off-axis pixels. Orthographic Depth is `4.9999961853` at both. Background is exactly `10000000000`. These small surface errors come from depth projection/reconstruction precision.

Depth and Normal use the film sample closest to the target pixel center. They are not color-filtered averages. A generic MSAA resolve can blend foreground and background values at silhouettes and should not be described as equivalent. Camera DOF, motion blur, stochastic transparency, and temporal sample selection require separate comparisons.

Two Three.js implementations are possible:

1. A custom MRT value of `positionView.z.negate()` directly writes the desired scene-unit scalar at visible fragments. This works for perspective and orthographic cameras and avoids projection-depth precision loss. Reconstruct background `1e10` using an explicit coverage channel or the depth texture's clear value.
2. Read the pass depth texture and use `perspectiveDepthToViewZ(depth,near,far).negate()` or `orthographicDepthToViewZ(...).negate()` according to camera type. These r184 TSL functions handle `renderer.reversedDepthBuffer`. The background test must also respect reversed depth. Logarithmic depth needs its separate inverse function.

Do not call r184 `PassNode.getViewZNode()` blindly for an orthographic camera. The installed implementation always calls `perspectiveDepthToViewZ`. `getLinearDepthNode()` further normalizes into the near/far range rather than returning scene-unit distance. A Depth texture carrying `1e10` must use float32 storage; half float cannot represent the sentinel. Float32 is also preferable for useful scene-depth precision.

Local source counterparts are `node_modules/three/src/nodes/display/PassNode.js`, `ViewportDepthNode.js`, and `accessors/Position.js`. Primary tagged sources: [PassNode r184](https://github.com/mrdoob/three.js/blob/r184/src/nodes/display/PassNode.js), [depth conversions r184](https://github.com/mrdoob/three.js/blob/r184/src/nodes/display/ViewportDepthNode.js), [positionView r184](https://github.com/mrdoob/three.js/blob/r184/src/nodes/accessors/Position.js).

## Normal

Normal stores signed world-space XYZ, without remapping into `[0,1]`. Background XYZ is zero. The texture's internal alpha is 1; the Render Layers Normal socket is a vector, so consumers should use XYZ.

For the deferred EEVEE path, the pass is a normalized, closure-color-weighted average:

```
weighted = sum(closure.normal * sum(closure.color.rgb))
normal = length(weighted) < 1e-5 ? gbuffer.surfaceNormal : normalize(weighted)
```

Closure normals include material Normal Map/Bump contributions. With a single Diffuse closure, the oracle changed from approximately `(0,0,1)` to `(-.574707,.287109,.766113)` after connecting a tangent-space Normal Map with color `(.2,.65,.9)`. The small differences from normalized `(-.6,.3,.8)` include EEVEE G-buffer normal encoding and half-float pass storage. A flat base normal itself contained about `-1.5e-5` in X/Y and sometimes `.999512` in Z, so mathematical float32 output can be slightly more precise than Blender's pass.

Primary sources: [weighted closure normals and fallback](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/draw/engines/eevee/shaders/eevee_deferred_combine.bsl.hh), [world-normal G-buffer read](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/draw/engines/eevee/shaders/eevee_gbuffer_read.bsl.hh), [background clear values](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/draw/engines/eevee/shaders/eevee_renderpass_clear.bsl.hh).

Three's `normalWorld` invokes the material normal setup and includes a node material's custom normal. `normalWorldGeometry` bypasses that material perturbation. Use `normalWorld` for a single closure or materials whose closures share a normal. Differing coat/refraction/BSDF normals need a dedicated Blender-compatible weighted expression; Three's primary normal alone does not match that case. The glTF axis conversion must be undone before feeding a Blender-authored compositor vector graph: Three world `(x,y,z)` corresponds to Blender `(x,-z,y)` for the existing export convention. This coordinate adjustment is separate from normal-map decoding.

Primary Three sources: [normalWorld and normalWorldGeometry](https://github.com/mrdoob/three.js/blob/r184/src/nodes/accessors/Normal.js), [NodeMaterial setupNormal](https://github.com/mrdoob/three.js/blob/r184/src/materials/nodes/NodeMaterial.js). Blender's forward path is used for alpha-blended materials and Shader to RGB; do not assume deferred Normal semantics cover those materials. [Forward shader scope](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/draw/engines/eevee/shaders/eevee_surf_forward.bsl.hh).

## Named AOVs

Pinned Blender 5.2 defines `AOV_MAX=128` across Color and Value together. `Film::init_aovs` rejects more than that total. This supersedes older manual language about sixteen of each type. Shader writers match a hash of the authored name against the selected view-layer AOV definitions. The definition's type decides whether the writer's Color or Value socket is used. Treat the authored name and type as a binding contract and diagnose missing definitions, conflicts, and missing writers.

Color writes four raw signed float components. It does not clamp HDR, force alpha to 1, or premultiply RGB by its own alpha. The oracle writes `(-.5,2,4,.35)` and reads `(-.5,2,4,.3498535)`. Value writes a scalar; `-2.125` survives unchanged. Internal textures are RGBA16F and R16F respectively, even when final EXR output is 32-bit. Untouched Color AOV background is `(0,0,0,0)`; Value background is 0. Holdout multiplies the selected AOV value by `1-clamp(holdout,0,1)`.

AOVs use color/value film accumulation, unlike the nearest-sample data-pass handling of Depth/Normal. For compositing, preserve Color AOV's raw RGBA meaning; do not apply a blanket premultiplication step to every named Color source just because Combined is premultiplied.

Primary sources: [128 total and hash storage](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/draw/engines/eevee/eevee_renderbuffers_shared.hh), [AOV registration and total limit](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/draw/engines/eevee/eevee_film.cc), [raw AOV output and holdout](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/draw/engines/eevee/shaders/eevee_renderpass.bsl.hh), [ShaderNodeOutputAOV writer](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/gpu/shaders/material/gpu_shader_material_output_aov.glsl).

Three r184 supports global `pass.setMRT(mrt({...}))` and per-material `material.mrtNode`. `NodeMaterial` merges the material MRT into the pass MRT; named material outputs override matching global outputs. This provides the seam for global zero defaults and translated per-material AOV writers. The MRT node defaults custom attachments to no blending; only `output` uses material blending. Allocate requested attachments before compiling, preserve signed floating-point data, and budget against the actual backend's color-attachment limits. Blender's 128 texture-array AOV capacity does not imply 128 simultaneous browser MRT attachments. Pack scalar AOVs or split rendering when required, while preserving an explicit support boundary.

Primary Three source: [MRTNode dictionary, merge, and blend modes](https://github.com/mrdoob/three.js/blob/r184/src/nodes/core/MRTNode.js).

## Reproduce

Run `artifacts/verification-look/passes/fixture.py` with Blender `--background --factory-startup --python`. It creates a 64x48 scene with one opaque plane, a camera at Z=5, a Diffuse material, optional Normal Map, and signed Color/Value AOV writers. Six raw EXR32 files and matching JSON arrays are saved beside `pass-oracle.blend`. JSON includes camera settings, world matrix, plane size, material test parameters, and center/off-axis/background samples. Arrays are bottom row first, x-fastest RGBA. This is an isolated oracle, not a comprehensive renderer parity test.
