# HDR environment compression decision

Audited 2026-07-19 against official Khronos and Three.js documentation and
source. This note answers a narrow product question: can Blendlink reduce HDR
environment transfer/GPU cost locally without making the artist's lighting
less trustworthy or binding the output to a proprietary service?

## Decision

Ship a conservative two-asset contract:

1. The authored Radiance HDR or OpenEXR remains published byte-for-byte and is
   always the runtime fallback.
2. When the artist enables KTX2 Auto and the local Khronos tool is available,
   Blendlink attempts a standard KTX2 derivative using
   `B10G11R11_UFLOAT_PACK32` plus Zstd.
3. Blendlink extracts that exact KTX2 back to EXR and compares scene-linear
   pixels decoded by Blender. The derivative is only entered in the manifest
   if it passes scale-independent energy, highlight, maximum-error, and
   log-luminance gates. Negative or non-finite radiance is not representable
   by this unsigned format and therefore keeps the source-only path.
4. The runtime prefers the derivative only when the website supplies a
   configured `KTX2Loader` and Three's `LinearFilter`; failure reports a
   warning and loads the original.

This is deliberately not the same operation used for baked atlases. It never
touches `bakelib.py`, never changes the atlas background contract, and never
rewrites the source environment.

Blender documents float image data-blocks as scene-linear in memory and
OpenEXR as a scene-linear intermediate format; its standard reference space
uses Rec. 709 chromaticities and D65. That is why the helper performs both
source and extracted-image comparison inside Blender and assigns linear BT.709
metadata to the KTX2. [Blender color management](https://docs.blender.org/manual/en/latest/render/color_management.html)

## Why this format is ready

The official KTX CLI accepts EXR input, accepts Vulkan format enum names via
`--format`, and supports lossless Zstd supercompression. Its `extract` command
exports floating-point formats to EXR, giving us an independent decode step
for the radiance gate. [KTX `create`](https://github.khronos.org/KTX-Software/ktxtools/ktx_create.html)
[KTX `extract`](https://github.khronos.org/KTX-Software/ktxtools/ktx_extract.html)

Three.js added R11G11B10 and Zstd KTX2 support in r180, and the current
`KTX2Loader` source maps `VK_FORMAT_B10G11R11_UFLOAT_PACK32` directly to the
corresponding Three packed-float texture type. This is an ordinary KTX2 load,
not a Blendlink runtime format. [Three r180 release](https://github.com/mrdoob/three.js/releases/tag/r180)
[KTX2Loader r184 source](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/KTX2Loader.js)

The same loader source gives non-Basis raw DataTextures nearest filtering by
default. Blendlink therefore sets both filters to the caller's
`THREE.LinearFilter` and marks the texture for upload before using the
derivative. If that constant is not supplied, it reports the missing
prerequisite and keeps the source path; passing the pixel gate is not enough if
runtime sampling would visibly alias the environment.

The derivative stores three positive HDR channels in 32 GPU bits per texel,
instead of the 64 bits normally used by RGBA16F. Zstd reduces network bytes
without adding another lossy stage. Three then performs its normal
equirectangular-to-PMREM path; PMREM remains the renderer's GGX-filtered
lighting representation. [PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html)

## Why UASTC HDR is not the default yet

Basis Universal now defines UASTC HDR, and current Three `KTX2Loader` can
transcode it to BC6H or fall back to uncompressed half float. However, the
official Khronos encoder support is currently published in KTX-Software
5.0.0-rc1, whose release notes identify it as a prerelease pending a not-yet-
published KTX specification revision. The latest stable release remains 4.4.2.
That is not an appropriate required toolchain for an artist-first default.
[KTX-Software releases](https://github.com/KhronosGroup/KTX-Software/releases)
[Three KTX2Loader documentation](https://threejs.org/docs/pages/KTX2Loader.html)

There is also no universal GPU-memory win today: current Three source chooses
BC6H when BPTC exists and otherwise expands UASTC HDR to RGBA half float. The
portable fallback is correct, but it does not deliver the claimed GPU savings
on every device. The packed-float path has one predictable 32-bit GPU shape.

## Why prefiltered PMREM is a later optimization

Three can export a render target such as a PMREM to KTX2, and its PMREM is a
special CubeUV layout. This is promising because it can remove runtime
prefilter work. But producing it requires a real Three renderer, and Blendlink
does not currently own a browser/GPU build stage. Adding one solely for this
optimization would increase setup fragility and renderer-version coupling.
[KTX2Exporter](https://threejs.org/docs/pages/KTX2Exporter.html)
[PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html)

Re-evaluate prefiltered PMREM when the existing browser comparison runner can
produce it deterministically on all supported development platforms. The raw
equirectangular source must still remain available for high-resolution visible
backgrounds and compatibility.

## Acceptance evidence

The implementation lives behind `environmentCompression.ts` and the Blender
float-pixel helper `environment_compress.py`. Unit tests cover every blocking
gate and runtime preference/fallback. A real-tool integration remains
environment-gated, like material KTX tests, because KTX-Software is an
optional local dependency: set `BLENDLINK_BLENDER_PATH`, `BLENDLINK_KTX_PATH`,
and `BLENDLINK_HDR_TEST_IMAGE` to a representative `.hdr` or `.exr` before
running the package tests. Product acceptance for any future codec change is:

- official stable encoder and Three loader support;
- extraction of the actual shipped bytes to scene-linear float pixels;
- the same or stricter radiance gates;
- source HDR/EXR remains byte-identical and mandatory;
- browser checks on desktop and mobile-class renderer paths;
- measured transfer and GPU-memory improvement on representative studio,
  outdoor, and high-contrast sunset environments.
