# Compositor Image Info

This bounded port covers the five actual Blender 5.3.0 outputs: Dimensions, Resolution, Location, Rotation and Scale. Its source profile is build `02f0899d78e3` on macOS arm64. It accepts a direct current-scene Render Layers Image with an identity image domain, square pixels and no render borders. Transformed, static, computed, other-scene, unlinked and single-value inputs remain unsupported. Native metadata is allocated as host single values even when the authored compositor device is GPU; this provides no native GPU arithmetic credit.

Dimensions and Resolution come from the live texture size rather than an exported width or height. Location, Rotation and Scale use identity-domain facts only after the input has been qualified. Every output keeps a real textureSize/PassNode dependency and a render-time physical extent guard. Metadata is constant across each image, while its dimensions update through resize and DPR changes.

Dimensions/Resolution keep fresh `INT_VECTOR2` values, Location/Scale keep `FLOAT_VECTOR2`, and Rotation stays scalar. Image Info owns its explicit metadata-to-RGBA and padded float3 conversion checks. It does not reuse coordinate producer tags or change legacy VECTOR3 semantics. Direct scalar/integer/Boolean casts from the two-component metadata values require separate qualification.

All native metadata output words must match exactly. Two separately labelled examples compute width/height through existing SeparateXYZ and Math DIVIDE consumers. Those ratios use a predeclared two-ULP **and** scaled absolute bound; they are not a fabricated native Aspect output. The proof does not claim arbitrary composed-graph equivalence.

The fixed matrix has 132 native cases per device and twelve saved Final scenes per device. It exercises all outputs through direct, padded-vector, reroute and group paths; aspect examples; physical resize/DPR; named invalid-domain/conversion/nontexture refusals; actual GLTF and pinned source presentation loading; and three production pipeline apply/dispose cycles. The exact renderer-owned DFG_LUT identity baseline comes from an independent draw of the same source scene. The port adds no textures, render targets or per-frame GPU readback.

```sh
npm run build --workspace=scenetoweb
node --test experiments/compositor-image-info/protocol.test.mjs
npx vitest run packages/blendlink/src/tslCompositorImageInfo.test.ts
node experiments/compositor-image-info/matrix.mjs artifacts/verification-image-info
node experiments/compositor-image-info/verify.mjs artifacts/verification-image-info experiments/compositor-image-info/evidence.json
```

`capture.mjs CPU|GPU directory` already performs both the native capture and one twelve-scene Final publication. Do not export the same fixtures again. The shared frozen `browserProofContract` defines writer/reader status tokens. Full qualification requires both source devices, Metal and SwiftShader, and actual WebGPU and WebGL2. Fresh Python prefixes and retained launcher archives, exact native source/helper/oracle census, independent current emission, and complete runtime/vendor/map/fixture snapshots are checked by the closed reader. Raw references remain ignored; a compact evidence receipt records a completed qualification transaction.
