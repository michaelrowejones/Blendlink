# Blender5.3 compositor Integer Bits qualification

`FunctionNodeBitMath` supports AND, OR, XOR, NOT, SHIFT and ROTATE on full signed32 inputs. `FunctionNodeHashValue` supports its INT data type. This is a partial compositor port: inputs must be typed int32 socket literals, InputInt producers, flattened group defaults, reroutes, or bounded chains of these two qualified node kinds. Implicit conversions and image/computed fields are refused. The measured profile is Blender5.3.0 build`02f0899d78e3`, macOSarm64. Authored CPU and GPU compositor settings both execute these single values through native CPU multi-functions; no native spatialGPU numerical credit is claimed.

The runtime shares Blender-compatible Jenkins integer hash functions with the existing shader implementation. Hashes never pass through float normalization. BitMath shifts use unsigned bits, logical right shift, explicit ±31 guards and a separate zero-rotation branch, avoiding undefined shifts by32 or negation of INT_MIN.

The oracle independently computes signed32/Python Jenkins expectations. Every native pixel must match before it can be used by the browser proof. Full32bits are transported as exact rawFloat32 integers`[low16,byte2,byte3,1]` using existing IntegerMath DIVIDE_FLOOR/FLOORED_MODULO. Twelve standalone transport controls cover signed extrema/masks, so an error cannot cancel itself through a decoder using the new BitMath kernels. INT Compare consumers independently check signed32 equality.

Each native device setting has297cases, including all32single-bit positions, signed extrema, shift/rotate counts beyond word boundaries including INT_MIN/MAX, four literal provenance routes, and a BitMath→Hash dependency family chain. Twelve cases per device are saved.blend files and published through actual built Final sync. All cases run the built source builder on real WebGPU and WebGL2 with Metal and SwiftShader separately. Final cases load the actual GLTF and pinned source presentation through the production post pipeline, preserve source materials/callbacks and perform3apply/disposecycles. The exact actual-renderer DFG_LUT cache identity set from a no-compositor draw is restored; no count-only cache exemption is used.

```sh
export PATH=/tmp/mrj-tooling:$PATH
npm run build --workspace=scenetoweb
node --test experiments/compositor-integer-bits/protocol.test.mjs
npx vitest run packages/blendlink/src/tslCompositorIntegerBits.test.ts
node experiments/compositor-integer-bits/capture.mjs --blender /Applications/Blender.app/Contents/MacOS/Blender --device CPU --output artifacts/verification-integer-family53/cpu
SCENETOWEB_INTEGER_REFERENCES=artifacts/verification-integer-family53/cpu SCENETOWEB_INTEGER_BUILT=1 npx vitest run experiments/compositor-integer-bits/export.test.ts
SCENETOWEB_INTEGER_REFERENCES=artifacts/verification-integer-family53/cpu BLENDLINK_TEST_PROFILE=metal BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium BLENDLINK_TEST_CHROMIUM_ARGS='[]' node experiments/compositor-integer-bits/run.mjs --built
# Run --final separately; repeat raw/Final for software and nativeGPU device setting.
node experiments/compositor-integer-bits/verify.mjs artifacts/verification-integer-family53 experiments/compositor-integer-bits/evidence.json
```

Use the exact Chromium profile arguments recorded in the browser receipts for reproduction. Raw native/reference/browser artefacts are ignored. The compact tracked evidence receipt closes the native, source, emitted runtime, fixture, saved source, Final manifest, GLTF and presentation hashes. Qualification is historical to that pinned transaction; integration/source changes require a fresh transaction before claiming the current profile.
