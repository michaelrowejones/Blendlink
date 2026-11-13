# Native Crop domain research

The original `native_domains.py` research does not admit an implementation. It records actual
CPU/GPU EXR output, authored controls, requested controls, compiler refusal,
native build identity, input bytes and the executed fixture hash.

The primary source references are pinned to the tested releases:

- [Legacy CPU crop](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_CropOperation.cc)
- [Legacy RNA mapping](https://github.com/blender/blender/blob/v4.2.0/source/blender/makesrna/intern/rna_nodetree.cc)
- [Modern 5.2 crop](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/composite/nodes/node_composite_crop.cc)
- [Modern 5.3 crop](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_crop.cc)

Initial observations:

- Legacy RNA names `min_y`/`max_y` bind upper/lower boundaries respectively.
  Relative fields follow the same order. The earlier `domains42-cpu` report
  retains the reversed-Y controls; it is not a successful intended-rectangle
  test and predates the explicit fixture hash.
- Transparent masking preserves the input canvas. Cropping its size changes
  terminal realization; it cannot be replaced by a mask in every mode.
- Legacy CPU/GPU odd cropped extents disagree visibly, including a one-pixel
  crop. Empty crop-size output differs too. Even extents and transparent-mask
  modes need separate positive controls before promotion.
- Modern output clamps/intersects the authored rectangle; zero Width still
  produces a one-pixel-wide region in the tested releases. Do not infer this
  from the current development branch, which has a different empty-bound path.
- Modern CPU/GPU crop-size terminal interpolation has small measured rounding
  differences. Transparent-mask cases matched exactly in the initial corpus.

Run with `BLENDLINK_CROP_EVIDENCE=/absolute/output`, optional
`BLENDLINK_CROP_DEVICE=GPU`, and a pinned Blender executable using
`--background --factory-startup --python-exit-code 1 --python
experiments/compositor-crop-differential/native_domains.py`.

## Transparent masking port

The first live port is **Alpha Crop enabled** in 5.2/5.3, or **Crop Image Size
disabled** in 4.2. It copies all four native float channels inside the rectangle
and writes transparent black outside, without moving or resizing the input
canvas. New documents use `alpha-crop` with a closed rectangle model:

- `modern-int-mask-v1`: X/Y clamp to `[0,inputSize-1]`; Width/Height clamp to
  at least one pixel; the upper bounds intersect the input extent.
- `legacy-int-mask-v1`: the legacy left/lower/right/upper boundaries are clamped
  to the input size. Reversed bounds collapse to an empty rectangle.
- `legacy-relative-mask-v1`: native Float32 factors multiply the physical input
  dimensions and truncate to integer boundaries. Legacy RNA `min_y` is upper,
  `max_y` lower. The serialized rectangle always uses lower-left order.

The lower bounds are inclusive and upper bounds exclusive. Authored rectangle
settings must be fixed and unlinked. Pixel coordinates are bounded to
`+/-1048576`, relative factors to `[0,1]`, and nonempty input extents to at most
8192 pixels per axis. GPU processing requires Full or final-render Automatic
precision; explicit Half output quantization remains refused. Single-value images pass through on modern CPU/GPU and
legacy GPU. Legacy CPU constant-image evaluation remains explicitly refused.

Render Layers must expose a matching finite source/render extent, independently
validated at each physical output resize. Static Image inputs retain their
existing CPU-only admission (including even legacy source/output dimensions)
and authored source extent, so masking occurs before
terminal padding/interpolation. Existing mixed Image/RenderLayers, unequal Image
canvas, translated/affine incoming windows, custom borders and scalar/vector
image conversion refusals remain. Size-changing Crop (the modern default) is
not yet admitted; its output data/display-window behavior requires a separate
model. No prior opcode or serialized document changes meaning.

Run the repeatable fixture from the repository root:

```sh
BLENDER_USER_RESOURCES=/absolute/isolated-resources \
BLENDLINK_COMPOSITOR_CROP_REFERENCES=/absolute/crop-cpu \
  "$BLENDER" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/compositor_crop_check.py

# Repeat with BLENDLINK_COMPOSITOR_CROP_DEVICE=GPU and a separate directory.
npm run build --workspace blendlink
node experiments/native-compositor-differential/run.mjs --built \
  /absolute/crop-cpu /absolute/crop-gpu --out /absolute/crop-browser
```

Native reference versions are official Blender 4.2.0 `a51f293548ad`, 5.2.0 LTS
`fbe6228777e7` and 5.3.0 `02f0899d78e3`, with FULL compositor precision, 32-bit
RGBA EXR readback and EEVEE render context. The GPU references here use native
Metal; actual OpenGL capture remains an independent hosted qualification.
The native fixture includes adversarial HDR/signed/zero-alpha image fields,
modern negative/zero/oversized rectangles, legacy reversed/empty/relative and
Float32 rounding-boundary controls, nested node groups, Blur/Flip/Exposure/
Posterize/Alpha Over composition and separately captured real EEVEE Render
Layers inputs. Source settings, pixels and datablock counts are checked across
extraction. GPU Static Image inputs are not claimed by substituting a fixture
image for an exported Render Layers input.

The built browser proof exercises WebGPU and WebGL2 with immutable production
module snapshots and the whole-program TypeScript emit guard. It keeps compiled
graphs alive across repeated sizes, DPR2, invalid source/render extent rejection
and recovery; checks unchanged shader structure, bounded pass/source size,
restored caller MRT/clear state and zero remaining textures on disposal. Unit
regressions also cover repeated disposal and cleanup after a later node fails.

Verified corpus: 4.2 CPU/GPU 60/49 cases, 5.2 CPU/GPU 50/38 and 5.3 CPU/GPU
50/38: **285 native cases and 570 built-runtime readbacks**. Both browser
backends passed with maximum error `2.384185791015625e-7`; exact-alpha cases
had zero alpha error. Nineteen same-graph resize sequences per backend include
legacy relative masks and fixed-size static Images. All rendered rows released
their textures; the measured maximum was six passes and 14,073 fragment-source
bytes. These counts describe this bounded masking corpus, not size-changing
Crop or every possible graph composition.
