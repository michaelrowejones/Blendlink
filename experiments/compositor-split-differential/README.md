# Native Split image operation

`CompositorNodeSplit` has a real Image output in official Blender 4.2, 5.2 and
5.3. It is not the output-only Viewer, and the old `CompositorNodeSplitViewer`
class is not creatable in those releases. `native_schema.py` records actual RNA,
default controls, native Float32 EXR pixels and the executed fixture hash without
admitting a live implementation.

Pinned primary sources:

- [4.2 node and GPU dispatch](https://github.com/blender/blender/blob/v4.2.0/source/blender/nodes/composite/nodes/node_composite_split.cc)
- [4.2 CPU operation](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_SplitOperation.cc)
- [4.2 GPU shader](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/realtime_compositor/shaders/compositor_split.glsl)
- [5.2 node and CPU operation](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/composite/nodes/node_composite_split.cc)
- [5.3 node and CPU operation](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_split.cc)
- [5.3 GPU shader](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/shaders/compositor_split.glsl)

## Qualified live contract

New documents use `image-split`. All four channels are selected from one input;
the operation does not interpolate, clamp HDR RGB, associate alpha, or replace
signed/zero alpha. At least one input must be a real finite image field. Inputs
must have matching unshifted canvases; Image/Render Layers mixtures, unequal
static Image sizes, resized Crop windows, incoming Translate/Transform windows,
render borders and constant-only canvases remain explicitly refused. Static
Image inputs retain their independently qualified CPU-only restrictions.

Blender 4.2 has fixed X/Y and integer percentage controls. The CPU's
`legacy-cpu-axis-v1` truncates `size * percentage / 100` to an integer boundary.
The GPU's `legacy-gpu-axis-v1` compares the integer pixel against the Float32
product of size and the Float32 percentage ratio. On an odd 13-pixel canvas at
50%, these select the first input starting at pixel 6 and pixel 7 respectively.
Both axes and percentages 0 through 100 use these separate native models.

Blender 5.2/5.3 instead expose a two-component Position and a Rotation; their
default is a diagonal line at approximately pi/4. `native-line-f32-v1` stores the
producing CPU's native `[-sinf(rotation), cosf(rotation)]` coefficients. The
runtime preserves the staged Float32 position, direction and dot-product order,
including small nonzero coefficients at nominal quarter turns. Position and
Rotation must be fixed and unlinked, normalized Position must be in `[0,1]`, and
Rotation must lie within one full turn. Nonzero Position/normal components
smaller than `2^-50` are refused to keep projection intermediates outside the
unqualified subnormal/flush-to-zero domain at extents up to 8192 per axis. The
modern GPU line model is earned for Metal only; other GPU backends receive a
named source/runtime refusal rather than assuming identical contraction.
Fresh extraction is limited to measured Blender 4.2/5.2/5.3 version families.
No older serialized operation is changed.

Constant-only research controls show a separate native canvas contract:
legacy CPU/GPU select different uniform inputs, and modern output can be a
single pixel centered in the render canvas. Those controls are retained as
research; they are not counted as successful live image-field cases.

## Repeatable native and built proof

```sh
BLENDER_USER_RESOURCES=/absolute/isolated-resources \
BLENDLINK_COMPOSITOR_SPLIT_REFERENCES=/absolute/split-cpu \
  "$BLENDER" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/compositor_split_check.py

# Repeat with BLENDLINK_COMPOSITOR_SPLIT_DEVICE=GPU in a separate directory.
npm run build --workspace blendlink
node experiments/native-compositor-differential/run.mjs --built \
  /absolute/split-cpu /absolute/split-gpu --out /absolute/browser
```

The initial research evidence at `/private/tmp/blendlink-split-research`
contains 108 cases: 18 per native version/device pair. The final live corpus at
`/private/tmp/blendlink-split-proof/final` contains 594 cases: legacy CPU 58,
legacy GPU 52, and modern CPU 124 / GPU 118 per version. Official native builds
are 4.2.0 `a51f293548ad`, 5.2.0 LTS `fbe6228777e7` and 5.3.0 `02f0899d78e3`.
GPU references use Metal with Full precision, EEVEE render context and 32-bit
RGBA EXR readback. On unqualified modern GPU backends the repeatable fixture
records the exact source refusal and independent input control, explicitly
reporting zero numerical Split cases. The `blendlink-split-source-profile-v1`
protocol retains a hashed actual native Image output, exact diagnostic, native
build/backend and unchanged source fingerprint outside the numeric index.
`scripts/check-split-profile.mjs` independently validates those records and
requires real `image-split` programs for qualified CPU/Metal/legacy profiles.
The modern non-Metal branch emits `SOURCE_PROFILE_REFUSED`, never the numerical
`SPLIT_PASSED` marker. Its one input control remains separate from Split parity.

The corpus covers arbitrary and default angles, both legacy axes, endpoints,
odd/thin extents, HDR/signed/zero-alpha fields, both field branches, reversed
constant/field inputs, scalar-to-color conversion, node groups, Blur/Flip/
Exposure composition, matching static Image branches, independently captured
real EEVEE Render Layers and named cross-canvas refusals. Extraction checks
authored settings and datablock counts. Refusals stay outside the numeric index.

The browser proof snapshots exact production modules with the whole-program
TypeScript emit guard. It tests WebGPU and WebGL2, bitwise Float32 preservation
for direct selection, compiled graphs kept across repeated extents and DPR2,
source/render mismatch rejection and recovery, unchanged shader structure,
bounded pass/source cost, caller MRT/clear-state restoration and texture
cleanup. Split's pointwise field does not allocate per-input render targets;
the common finite-canvas realization owns its output target. Raw source
textures use exact texel loads while existing mapped field expressions retain
their coordinates. Fixed controls are privately copied before deferred shader
construction. Unit tests verify closed-profile guards, unchanged caller IR,
borrowed texture ownership and repeated/later-failure disposal.

The completed built proof is `final/browser-built/results.json`: all 594 cases
passed each browser backend; direct-selection bit mismatches are zero and the
largest composed RGB error is `3.5762786865234375e-7`. All texture cleanup checks
return zero, with at most five passes in the composed corpus. The matching
worker build, 1,390 unit tests (five skipped), 29 policy tests, 677-file package
and Vanilla/R3F consumer builds passed. These local browser results use
SwiftShader/LLVM; modern native OpenGL projection remains unclaimed.
