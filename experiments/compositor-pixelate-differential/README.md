# Native Pixelate block means

This fresh `pixelate` operation uses `native-block-mean-v1`, qualified against
Blender 4.2, 5.2 and 5.3 CPU/GPU compositors in an EEVEE render context. The
legacy `pixel_size` property and modern fixed integer Size socket share a
normalized 1..16-pixel block size. Unknown source versions, linked Size, custom
render borders, GPU Half precision and scalar/vector image conversions refuse.
Static Image, shifted/affine and resized input windows remain separate work.

The implementation accumulates complete RGBA blocks in native row/column
order, dividing by the actual edge-block area. Signed/HDR colors and alpha are
averaged without clamping or premultiplication changes. It computes each mean
once on a smaller Float32 target, then repeats that value with integer loads.
Work therefore scales with input pixels rather than block area times output
pixels. Size 1 and single values pass through without allocating Pixelate
targets. Existing serialized operations are unchanged.

Primary reference definitions are pinned:

- [4.2 CPU operation](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_PixelateOperation.cc)
- [4.2 node/GPU dispatch](https://github.com/blender/blender/blob/v4.2.0/source/blender/nodes/composite/nodes/node_composite_pixelate.cc)
- [5.2 GPU kernel](https://github.com/blender/blender/blob/v5.2.0/source/blender/compositor/shaders/compositor_pixelate.glsl)
- [5.3 node/CPU operation](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_pixelate.cc)

The source fixture records its SHA256 in every reference. Each native version
has 46 CPU and 46 GPU cases: partial edge blocks, sizes larger than the input,
constant and signed/zero/HDR alpha, Exposure/Posterize, Blur before/after,
cascades, node groups, actual EEVEE Render Layers and same-graph resize/DPR2.
Responsive sequences include mismatched-source refusal followed by recovery.
Source extraction checks preserve the authored tree and Blender data counts.
Browser checks verify caller MRT/clear state and complete texture disposal.
The pass budget includes the separately required domain/Blur realization passes;
it is bounded at seven passes and 22,000 bytes per fragment shader.

```sh
BLENDLINK_COMPOSITOR_PIXELATE_REFERENCES=/absolute/native-cpu \
  "$BLENDER" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/compositor_pixelate_check.py
# Repeat with BLENDLINK_COMPOSITOR_PIXELATE_DEVICE=GPU and a separate directory.
npm run build --workspace blendlink
node experiments/native-compositor-differential/run.mjs --built \
  /absolute/native-cpu /absolute/native-gpu --out /absolute/browser-proof
```

Native capture uses official 4.2.0 `a51f293548ad`, 5.2.0 `fbe6228777e7` and
5.3.0 `02f0899d78e3`. Local native GPU references are Metal. Linux/OpenGL source
qualification requires its own hosted corpus; a requested backend name alone
does not establish that proof. Numeric comparisons retain the existing native
compositor budget; discrete downstream edge cases remain part of future
coverage rather than a claim of renderer identity.
