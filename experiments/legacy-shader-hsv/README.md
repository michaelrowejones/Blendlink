# Legacy shader HSV

This is an actual-node compatibility port for EEVEE in **Blender 4.2.0**.
`ShaderNodeCombineHSV` has three scalar inputs H/S/V and one Color output;
`ShaderNodeSeparateHSV` has one Color input and three scalar outputs H/S/V.
Neither exposes Alpha. Separate ignores input alpha; Combine creates alpha1.
Fresh Cycles extraction takes a named refusal and keeps source baking available.
Unmeasured source versions are refused.

Both legacy classes are absent and uncreatable in 5.2.0/5.3.0. Those versions
upgrade an actual saved 4.2 graph to `ShaderNodeCombineColor` / `ShaderNodeSeparateColor`
in HSV mode, preserving defaults and authored links. The availability/migration
probes record actual Blender classes and sockets; they never create an invented
modern alias or count unavailable classes as numerical passes.

## Why reuse the existing math

Blender's pinned [4.2 legacy registration](https://raw.githubusercontent.com/blender/blender/v4.2.0/source/blender/nodes/shader/nodes/node_shader_sepcomb_hsv.cc)
registers GPU callbacks and no material multi-function. The
[legacy Separate wrapper](https://raw.githubusercontent.com/blender/blender/v4.2.0/source/blender/gpu/shaders/material/gpu_shader_material_separate_hsv.glsl)
and [Combine wrapper](https://raw.githubusercontent.com/blender/blender/v4.2.0/source/blender/gpu/shaders/material/gpu_shader_material_combine_hsv.glsl)
call the same `rgb_to_hsv` / `hsv_to_rgb` functions as the
[modern Separate](https://raw.githubusercontent.com/blender/blender/v4.2.0/source/blender/gpu/shaders/material/gpu_shader_material_separate_color.glsl)
and [Combine](https://raw.githubusercontent.com/blender/blender/v4.2.0/source/blender/gpu/shaders/material/gpu_shader_material_combine_color.glsl)
wrappers. The common [native helpers](https://raw.githubusercontent.com/blender/blender/v4.2.0/source/blender/gpu/shaders/common/gpu_shader_common_color_utils.glsl)
include their actual out-of-range Hue behavior; this port does not replace it
with generic hue wrapping or RGB clamping.

The source adapter fixes mode=HSV, maps actual H/S/V sockets to x/y/z, and emits
the already supported `color_convert` EEVEE model. Its source/compiler stage
remains shader even for literal inputs. No existing serialized opcode or runtime
formula changes. Automatic EEVEE-to-Cycles fallback is explicitly guarded because
native evaluator equivalence has not been established. The existing explicit
Cycles Material bake route classifies these pure color functions as coordinate
neutral; it does not claim a live Cycles port. Automatic Final planning is tested
to ship the EEVEE program, and explicit Cycles Material bake planning is tested
to retain the bake route.

## Numerical proof

The 50-case native corpus contains four independent controls and 46 conversions:
defaults, gray and primaries, constant and nearest float image fields, UV,
negative/HDR RGB, extended Hue/Saturation/Value, each Separate scalar output,
and four source alpha values. Every conversion is rendered twice with the actual
legacy and modern Blender nodes; the encoded native outputs must be bit-identical.
The input image is float Non-Color, Half Precision off, opaque, nearest sampled.
No native pixels are used in production math.

The scene-color carrier is half precision. For each conversion an initial render
B is retained as a coarse baseline. The same native node's encoded output C
(`.25 + .125 * raw`) is then connected to `(C - B) * 1024 + .5` **before** the
scene render target. The half result R reconstructs C as `B + (R - .5) / 1024`.
A separate dense RGB carrier grid bounds target error by `2^-10`; no calibration
value is fitted to a node's output. The decoder divides both errors by `.125`.
The raw kernel budget is `6e-6`, with only the independent carrier reconstruction
allowance `(2^-10 / 1024 + 2^-22) / .125`. There is no UV rasterization allowance,
source reference edit, generic output clamp, or comparison against an idealized
Python HSV formula. Ordinary coarse renders and all calibration/source hashes
remain in the reference directory.

The runner freezes the whole runtime, native modules, reference producer and
both browser harness files. `--built` independently checks all emitted production
modules against whole-program TypeScript output. Reused native references must
match the actual captured producer module hashes.

The retained built reports are `artifacts/verification-legacy-hsv-final-{software,physical}/report.json`: 200 readbacks, zero failures, raw conversion maximum
`3.814697265625e-6`. Source availability and real file migration JSON are under
`artifacts/probe{42,52,53}` and `artifacts/migration{52,53}.json`. The isolated
installed ZIP probe additionally checks actual package-qualified emission and
automatic Final planning.

Local evidence covers native 4.2.0 **Metal** and physical Apple Metal / software
SwiftShader, each through WebGPU and WebGL2. Native OpenGL legacy qualification
is not claimed by the Metal measurements. Modern Color HSV has its own corpus;
file migration is an actual source/schema check, not a 5.2/5.3 legacy numeric port.
This is a finite-input shader math port; precision-sensitive downstream threshold
or amplification graphs need their own composition evidence.

## Repeatable commands

Use Node24, locked dependencies, and the exact Blender4.2.0 executable. From the
repository root:

```sh
BLENDLINK_BLENDER=/absolute/path/to/blender-4.2.0 \
BLENDLINK_HSV_EVIDENCE=artifacts/verification-legacy-hsv-software \
node experiments/legacy-shader-hsv/run.mjs --built
```

No `--reuse-reference` means the command generates fresh native references and
all carrier controls, then runs both software browser APIs. The normal package
build must precede `--built`. For the physical bundled Chromium repeat with
`BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium` and a separate evidence directory.
`BLENDLINK_TEST_CHROMIUM_ARGS` accepts a JSON string array; no watchdog disabling
is required. On Linux use the software graphics dependencies and `xvfb-run`.

The independent source/availability regression is
`packages/blender-addon/tests/legacy_shader_hsv_check.py`, run by each official
4.2.0, 5.2.0 and 5.3.0 binary with `--background --factory-startup --python-exit-code 1`.
For file versioning, run `probe.py` in 4.2 with `BLENDLINK_HSV_PROBE=/private/output`,
then `migration.py` in 5.2/5.3 with `BLENDLINK_HSV_LEGACY_BLEND` pointing to that
actual saved `Legacy HSV.blend` and `BLENDLINK_HSV_MIGRATION` to a JSON output.
