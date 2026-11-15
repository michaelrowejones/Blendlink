# Noise offset contraction diagnostic

Research only. No production kernel, source input or numerical gate changes.

The original canonical helpers expose raw hash halves, uint-to-float conversion, normalized units and offsets for literal and uniform seeds 3/4. Native captures use the original Blender Metal fragment compiler. Browser controls reuse the existing SDK `compositorCpuUintRne`, `buildNativeNoiseFma` and finite rounding helpers.

All hashes, casts and units match exactly. The distinguishing operand is seed3.z: native literal and uniform offsets are word **1128360077**. Browser literal evaluation produces **1128360078**, while browser uniform evaluation produces **1128360077**, on both Metal APIs. Existing software-FMA controls produce the native word; staged controls produce the separate-rounding word. The other five offset operands agree under both rounding orders.

This confirms a target constant-evaluation/contraction boundary rather than a hash or uint-conversion error. It witnesses only six fixed operands; it does not qualify a general new FMA range or alter the generic Noise implementation. Separate diagnostic shaders can affect optimization and do not expose original shader registers.

19 native draws and 40 browser draws are retained. The browser captures contain 320 raw stage words. Native receipt ownership is separate. An initial WGSL vector-shift packing error remains recorded; the correction only packs high halves componentwise.

CPU replay, using existing local artifacts:

```sh
node experiments/noise-offset-fma-diagnostic/verify.mjs /tmp/scenetoweb-noise-offset-native-r1 /tmp/scenetoweb-noise-offset-browser-r2 /tmp/new-offset-close.json
```

Browser capture requires a serialized GPU lease:

```sh
node experiments/noise-offset-fma-diagnostic/run.mjs /tmp/scenetoweb-shader-kernel-next-build/adapted-r2 /tmp/fresh-offset-browser /path/to/qualified/packages/blendlink/dist
```

The source library retains Blender's GPL notices; imported FMA code retains its SDK BSD-3-Clause provenance. No generated native code is relabelled MIT.
