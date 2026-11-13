# Native EEVEE Magic

This port uses the actual EEVEE Magic node as its oracle. It does not replace
Magic with an image or a fitted function. The browser cascade is adapted from
the Apache-2.0 Cycles `kernel/svm/magic.h`; native EEVEE source inspection selects
the distinct material-MF and GPU coordinate stages. Pinned Blender 4.2.0, 5.2.0
and 5.3.0 primary-source URLs, licenses and SHA256s are in `native-sources.json`.
The GPU shader source is consulted for stage semantics, not copied into the
distributed runtime. The runtime attribution travels with the SDK and website.

Fresh source extraction emits `tex_magic_native` / `eevee-magic-f32-v1`. Older
runtimes refuse this opcode. Existing `tex_magic` documents retain their old
behavior. Cycles source graphs take the explicit bake route.

The initial live domain is EEVEE, depth 0–10, Color and Factor, static Scale of
magnitude at most 8, and Distortion zero, [.25,1], or [-.5,-.25]. Authored scalar
Clamp nodes can establish the same Scale/Distortion ranges for linked controls.
Constant arithmetic islands must independently evaluate exactly in Float32.
Modern material-MF evaluation additionally needs independently exact constant
coordinates within magnitude 16 and exact constant controls. The old EEVEE GPU
stage applies floor-mod after Scale; modern MF evaluation has no modulo.

Shader coordinates must stay within magnitude 32 after Scale. The producer and
runtime prove that from actual mesh positions, exported texspace, actual UV
attributes, bounded vector arithmetic, or actual embedded nearest pixels.
Generated/UV coordinates are never assumed to lie in [0,1]. The first profile
does not qualify shader-coordinate Mapping or MINMAX Clamp trees, animated
mesh data, deformation, or instancing. Scalar MINMAX controls are supported. Image
inputs need actual opaque float data in Non-Color/Raw, Half Precision off, and
nearest sampling. The source image certificate belongs to the new Magic
wrapper; the old `tex_image` schema is unchanged. Source and runtime validate
these conditions separately. Installation and Final inspect the actual bound
geometry, and draw validation notices first-upload edits and subsequent Three
attribute-version changes. An authored Clamp may bound a scalar Magic output;
Magic itself earns no blanket unit-range claim because depth-zero outputs can
be signed/HDR.

Deferred shader construction captures validated primitive tags. Installed draw
checks own their coordinate grammar and Scale interval; image payloads become
private derived extrema rather than a second pixel-array copy. A custom
transport may reuse its IR after installation without changing the built
modulo/output mode or redirecting later bounds checks.

## Numerical oracle

Each authored case is rendered twice by native EEVEE. First render the original
Magic graph through an identity carrier, or an explicit positive carrier
`C = Magic * .125 + .5` for signed/HDR cases. The coarse scene-color result is
retained as `case.f32`. Its measured values become a private opaque nearest
float data image B. In the second native render, subtract B from the **same
original source expression C before the emission carrier**, then render
`R = (C - B) * 1024 + .5`. The numerical reference reconstructs
`C = B + (R - .5) / 1024`. Both browser and reconstructed reference are then
converted back to raw Magic units by undoing the original positive carrier.
The runtime never consumes B, R, or any native output pixels.

Every residual result is independently asserted finite, in [0,1], and exactly
representable as a half float. A separate 4,096-point RGB image-control grid
covers [0,1] at Float32-exact 1/4096 steps with permuted channel values. It
checks the scene-color carrier against the absolute full-half-step bound
2^-10. The residual quantization bound is consequently `2^-10 / 1024`, plus
2^-22 for Float32 reconstruction, divided by the authored carrier scale when
reporting raw Magic units. The raw-kernel budget remains **2e-5**; no raster/UV
allowance or generic half-target budget is added to the reconstructed kernel.
The coarse baseline cancels before the target; its approximation error is not
part of the kernel budget. The proof metadata pins baseline bytes, original IR
bytes, original source fingerprint, gain, reconstruction bound and independent
calibration ID. All calibration rows stay in the numerical gate.

The first 4.2 pilot showed why coarse scene-color pixels are not the numerical
kernel oracle: direct Color rows can exceed a per-component half-step estimate
even while the source-before-carrier residual agrees within 2e-5. Those coarse
files and the original failed report remain in `artifacts/qualified42`.
The final gate retains those baseline files as diagnostics and compares the
more precise reconstructed source value on every version.

Another retained boundary is Distortion -1 at depth 10 on the exact image
field: both physical APIs measured raw error 2.9921532e-5, above the 2e-5
budget. The candidate is unpromoted. The generator retains its authored graph
parameters, explicit source refusal, native pixel bytes/hash and source
fingerprint. The original failed candidate evidence is in
`artifacts/expanded53`. No production lookup or tolerance adjustment masks it.

## Reproduction

Use an actual Blender executable and Node 24. From the repository root:

```sh
npm exec --yes --package=node@24 -- npm run build --workspace blendlink
BLENDLINK_BLENDER=/path/to/Blender BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
  BLENDLINK_MAGIC_EVIDENCE=artifacts/magic-native \
  npm exec --yes --package=node@24 -- node experiments/magic-node-differential/run.mjs --built
```

The bundled full Chromium channel exercises physical Metal locally. Omit
`BLENDLINK_TEST_CHROMIUM_CHANNEL` to exercise the bundled software browser.
Both WebGPU and WebGL2 are measured, and adapter/device information is retained.
Reuse a reference corpus with `--reuse-reference`; copy its whole `reference`
directory into another evidence directory to preserve each report separately.
The runner captures immutable native modules, native fixture, every runtime
module/source map, and browser harness. The built mode verifies semantic
equivalence of the whole current TypeScript program to shipped JS before
snapshotting. Workspace edits cannot change captured executable bytes.

The source admission regression runs with:

```sh
/path/to/Blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/magic_translation_check.py
```

The independent Final flow saves an authored Principled scene with default
Generated, explicit UV Color, and UV Factor materials, exports an actual
standalone website using the built CLI, loads its real GLB and pinned sidecar,
and renders installed color nodes against native EEVEE emission. This keeps
geometry/basis/UV and live-only-carrier failures in scope:

```sh
BLENDLINK_BLENDER=/path/to/Blender BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
  BLENDLINK_MAGIC_FINAL=artifacts/magic-final \
  npm exec --yes --package=node@24 -- node experiments/magic-node-differential/run-final.mjs
```

Final uses the same baseline-cancellation method across the complete scene,
with gain 512 and a separate full-scene Window-sampled RGB grid. It checks the
native grid against the absolute 2^-10 bound with no kernel allowance, retains
the coarse/residual/calibration files, then compares reconstructed raw source
values against the actual GLB program. It also opens the unmodified exported
website and requires successful first rendering with no browser errors.

The final local built checkpoint contains 204 numerical cases for 4.2 and 206
each for 5.2/5.3 (four independent controls plus Magic residual rows). Every
corpus passes physical Apple Metal and software SwiftShader, each through
WebGPU and WebGL2: **2,464 readbacks**, maximum raw difference **1.28747e-5**.
The retained reports are `artifacts/checkpoint{42,52,53}-{physical,software}`.
Actual Final exports/visitors are under `artifacts/visitor{42,52,53}`; their
maximum raw difference is 2.087e-6 on physical APIs and 1.133e-6 on software.
Source admission and isolated packaged-ZIP imports pass all three versions;
the npm tarball compiles in Vanilla and R3F consumers. These are local Metal
source results, not hosted OpenGL qualification.

Native OpenGL and other source GPU profiles require their own hosted numerical
qualification. Local Metal evidence is not an OpenGL precision claim. Likewise
WebGPURenderer with its WebGL2 backend supports these live node materials;
legacy WebGLRenderer needs a portable/baked carrier.
