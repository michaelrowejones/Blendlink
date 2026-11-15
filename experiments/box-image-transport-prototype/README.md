# BOX image transport prototype

This research targets Archviz's actual Plaster graph: two packed 1024×1024 PNGs,
Linear/Repeat BOX projection, stored Blend `0.09966777265071869`, Object
coordinates and Texture Mapping. The normal image feeds a tangent/OpenGL,
Displaced Normal Map with Strength 1. Source SHA-256 is
`9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e`.
The original 204,256,291-byte scene is never saved or modified.

Production admission, SDK/runtime behavior, coverage and supported-node counts
are unchanged. The experimental candidate is a GPL-2.0-or-later transcription of
Blender's shader body, excluded from the npm runtime. A production port needs an
appropriate implementation/license decision and the existing file-level notices.

## Observed results

The fresh r4 capture uses pinned Blender 5.3.0 build `02f0899d78e3`, Metal on the
local Apple M5 Pro. It reuses the calibrated direct RGBA32F oracle for the pure
native `tex_box_blend` body, and the existing orthographic/emission/EXR fixture
pattern for actual EEVEE Image Texture nodes. Three-axis sign flips and Blender's
piecewise barycentric weights are used; a conventional power-based triplanar
blend is not equivalent.

- All 26 pure weight cases are **bit-exact on both Metal browser APIs**: 13,312
  combined Float32 words, zero differences. Cases include signed axes, genuine
  off-axis normals, ties and points adjacent to a blend-zone transition.
- The native material stage performs 28 actual renders: four independent input
  controls plus 24 unique image/frequency/normal cases. Native/browser images
  have matching 64×4 physical extents. Immutable nearest RGBA32F input images,
  reused from the Noise Color oracle technique, supply exactly calibrated
  coordinates rather than assuming equality of interpolated Window arithmetic.
- Both browser APIs captured all 74 comparison rows. Actual sampler comparisons
  contain 98,304 words across the two APIs. Native references are intentionally
  reused to compare two browser sampler policies; this is not 48 native image
  renders or two independently qualified native policies.
- Current no-mip sampling has maximum absolute normal-image error **0.25369**.
  Enabling browser mipmaps reduces that maximum to **0.02465 on WebGPU** and
  **0.02269 on WebGL2**. Both remain outside the fixed diagnostic bound `2^-10`.
  No tolerance was widened. Anisotropy is not yet matched.
- Low-frequency axis samples meet the image bound. Off-axis normal-image samples
  retain errors of 0.00120–0.00247. The prototype supplies unpacked uniform
  normals; actual EEVEE's packed/interpolated geometry-normal stage must be
  integrated through the existing Geometry Context before those remaining
  differences can be attributed solely to image sampling.
- Both packed source images are opaque. The normal image's B range is
  0.7960785031–1, giving decoded tangent Z a substantial positive margin at
  Strength 1. Existing image-range/Mikk-frame certificates remain dependencies;
  this observation does not certify the composed Normal Map or the whole scene.

The overall r4 browser close **failed** on one WebGPU-page console HTTP 404. Its
URL was not logged, so attributing it to a favicon is an inference, not evidence.
There are no captured shader errors. All captured raw files and the console
error remain intact. The default reader still rejects this run. Explicit
`--diagnostic-only` replays validate native launcher/source/image/readback pins,
retain the error and report **zero qualification credit**. The image numeric
failures independently prevent admission even if the HTTP issue is corrected.

## Retained failures and next dependencies

The r1 attempt stopped on Blender's `GPUTexture.mipmap_mode` Python binding
`SystemError`. R2 found Blender's minimum render height is four; r3 rejected an
incorrect assumption that Window-derived HDR fields would be identical across
rows after half-film storage. These namespaces remain failed. R4 uses full 64×4
frames and independently calibrated nearest Float32 inputs; it does not retry
the broken sampler API, discard rows, or repair expected pixels.

Next work should reuse the existing native Geometry Context SNORM10/SNORM16
normal pipeline and object-basis guards, then qualify native mip/anisotropic
filtering and actual image decode. Preserve the native sign-dependent yz/xz/yx
coordinates and weight branch order. Only afterward compose the existing
Displaced/OpenGL Mikk Normal Map, capture an actual saved Final through the public
installer, and re-enter untouched Archviz acceptance. An axis-only shortcut or
Cycles appearance bake is not established as an equivalent replacement.

The algorithm adds three image reads per BOX lookup, with one shared image
resource and no required intermediate render target. Browser research runs
instantiate two sampler-policy variants per image deliberately. Recorded
draw-and-readback wall times include setup/readback costs and are not GPU timer,
FPS or production memory claims.

## Replay

Original native artifacts are under `/tmp/scenetoweb-box-archviz-native-r4`;
browser artifacts are under `/tmp/scenetoweb-box-archviz-browser-r4`. Replay the
original native archive from `/tmp/scenetoweb-v1-box-image-prototype` because its
launcher identity pins the invoked Python path.

```sh
node experiments/box-image-transport-prototype/compare.mjs \
  /tmp/scenetoweb-box-archviz-native-r4 /tmp/scenetoweb-box-archviz-browser-r4 \
  /tmp/FRESH-box-diagnostic.json --diagnostic-only
SCENETOWEB_BOX_NATIVE=/tmp/scenetoweb-box-archviz-native-r4 \
SCENETOWEB_BOX_BROWSER=/tmp/scenetoweb-box-archviz-browser-r4 \
node --test experiments/box-image-transport-prototype/*.test.mjs
```

Fresh source-only inventory uses `native.mjs SOURCE FRESH_OUTPUT UPSTREAM
--schema-only`. Native and browser capture entrypoints require an explicit
`--gpu-lease`; coordinate that lease before running them. A future browser run
should record failing response URLs and provide an explicit icon, without
changing material math, source/image pins or numerical gates.
