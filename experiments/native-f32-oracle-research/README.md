# Direct native GPU Float32 oracle research

A direct Float32 kernel measurement stage is feasible in the pinned Blender5.3.0 build `02f0899d78e3`. The guarded prototype explicitly initializes the background GPU context with `gpu.init()`, draws to an `RGBA32F` texture/framebuffer and reads `FLOAT` words directly. It needs no Emission/HDR measurement carrier.

The actual Metal pilot passed seven draws /112 Float32 words exactly. Five independent controls preserve non-half-representable positive values, signed/HDR values including2016.125 and2049, tiny normals down to2^-126, adjacent Float32 values and signed zero. Two source-derived Vector Math Add cases pass with an arithmetic body copied byte-for-byte from pinned native source. The source declaration is explicitly adapted from BSL to GLSL; this is a new source-stage model with zero node, material or full-scene qualification credit. See `pilot-receipt.json` and the ignored native archive referenced there.

## Why AOV is not the escape hatch

Pinned [RenderBuffers declarations](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/draw/engines/eevee/eevee_renderbuffers.hh) use half-float color/value formats. The [render-buffer allocation](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/draw/engines/eevee/eevee_renderbuffers.cc) applies those formats to the color/value arrays including AOV layers. [Film allocation and AOV readback](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/draw/engines/eevee/eevee_film.cc) also use half-float accumulation. Requesting float readback or32-bit EXR cannot recover earlier lost mantissa bits.

The Python API [explicitly supports background GPU initialization](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/python/gpu/gpu_py_api.cc), and its [texture format mapping](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/python/gpu/gpu_py_texture.cc) supports RGBA32F. Query GPU identity only after successful initialization. This avoids a dummy scene render just to initialize the GPU.

## Exact source-stage boundary

The model is `blender53-python-glsl-adapted-bsl-body-rgba32f-v1`. The Python shader path uses a [GLSL SourceProcessor and its own create-info flags](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/gpu/intern/gpu_shader.cc). Blender5.3 node sources use BSL declarations: C++ vector types, output references and node attributes. The probe drops the node attribute and adapts only this function's signature; its original `{ outVector = a + b; }` body remains byte-identical, with a separately recorded digest. It does not attempt a general BSL translator or pretend to execute Blender's complete generated material graph.

The common [Metal compiler options](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/gpu/metal/mtl_shader.mm) enable fast math and invariance preservation, with Metal2.2 as the baseline. These facts are grounded in the pinned source, not runtime compiler-option introspection. Python's stage macros, bindings, source frontend and optimization context differ from EEVEE material create-info. Same backend/compiler entry does not establish identical generated code or cross-node fusion.

## Proposed pipeline

1. Use the direct32F stage for fast pure-kernel regression: fixed raw Float32 inputs, pinned source dependency closure, source-body/declaration-adapter digests, explicit backend/compiler source profile, independent storage calibration and exact or predeclared bounded output gates.
2. Preserve CPU-MF/constant-folding oracles separately. A shader kernel cannot replace the native CPU evaluator for folded Blackbody or modern single-value compositor paths.
3. Keep a smaller actual-material crosscheck corpus per kernel family. Force an actual GPU field input using a verified full-Float32 non-color nearest texture; record texture storage/filtering and avoid accidentally testing CPU constant folding. Begin with signed/ordinary dyadic Add inputs whose expected outputs are representable in half. Compare actual one-sample EEVEE AOV words to a companion direct RGBA16F target using the same inputs, while retaining direct RGBA32F outputs independently. This checks the material transport/storage boundary without pretending the AOV is32F.
4. For outputs near half-rounding/branch boundaries, or a claim about full material Float32 intermediates, retain an independent calibrated carrier or use an explicitly instrumented native build with32F material/film targets. Stock AOV alone cannot prove those claims. Keep actual saved Final and browser lifecycle/resource verification.

The direct stage does not automatically qualify derivatives, implicit textures/LOD, closures, geometry/normal evaluation, nested zones, material optimization, animation or arbitrary composed graphs. Each requires its actual source environment. Most simple arithmetic kernels can use this stage immediately; complex BSL/native material integration remains separate engineering work.

## Reproduce the research pilot

Fetch the exact source URLs in `sources.json` into an owned directory using their basenames and verify every digest. Build/runtime changes are unnecessary. Coordinate GPU ownership, then run:

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/native-f32-oracle-research/run.mjs \
  artifacts/verification-native-f32-oracle-research-NEW SOURCE_DIRECTORY
```

The runner limits the child to120seconds and closes its actual guarded invocation with the shared native archive reader. Raw Float32 files, submitted GLSL, source hashes and the native binary/helper identities remain in the ignored transaction. This is research, not a node-capability receipt.
