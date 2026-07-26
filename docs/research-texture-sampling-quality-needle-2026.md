# Imported texture sampling quality: Needle differential

Date: 2026-07-25
Capability: `NDL-TEX-001`
Decision: **Match / Boundary Improvement / Shipped** for Blendlink-owned glTF resources;
application-owned cached resources remain explicit.

## Question

DOGWALK exposed strong ground-texture moiré under stock Three r184. This audit
asks what exact sampling policy Needle applies, whether Blendlink can improve
the result without taking ownership of application caches, and what the public
interface should be.

`npm.cmd run verify:needle-baseline` passed on 2026-07-25 before this
comparison. The refreshed machine inventory now pins the additional ordinary
glTF and MaterialX files used below.

## Exact Needle baseline

Paths are repository-relative and slash-normalized. SHA-256 values identify the
actual installed bytes; version labels come from their package manifests.

| Package | Version | Path | SHA-256 | Relevant behavior |
| --- | --- | --- | --- | --- |
| `@needle-tools/engine` | 5.1.4 | `experiments/needle-splash-official-preview/node_modules/@needle-tools/engine/src/engine/engine_loaders.gltf.ts` | `5fa4bf5a04b982d66b2f2975ed4b4f9e3cdbc21883df8fdcce9155c27ac28288` | Configures progressive, Draco, KTX2, and Meshopt; it does not raise ordinary material textures after loading. |
| Engine-nested `@needle-tools/three` | 0.169.19 | `experiments/needle-splash-official-preview/node_modules/@needle-tools/engine/node_modules/three/src/textures/Texture.js` | `0c28f5d27c574e1b2f4f27508bc82e37f78ca06db1278d84ff5dc15f4d1eb50d` | Needle's fork changes `Texture.DEFAULT_ANISOTROPY` to `4`. |
| Engine-nested `@needle-tools/three` | 0.169.19 | `experiments/needle-splash-official-preview/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/loaders/GLTFLoader.js` | `4aba05147b1ccb01f581979ea44950b60a568e74a5db811df9f5573a2b3521b1` | Every ordinary glTF image texture is explicitly assigned anisotropy `4` after sampler filters/wraps are decoded. |
| `@needle-tools/gltf-progressive` | 3.6.0-beta.2 | `experiments/needle-splash-official-preview/node_modules/@needle-tools/gltf-progressive/lib/extension.js` | `67df9318da7e85a1fdd8d71d2ceb1f0610e436ed25e0bb4f049ca26b69cfb1fc` | A replacement texture copies the source texture's anisotropy; it does not promote `4` to the renderer maximum. |
| `@needle-tools/engine` | 5.1.4 | `experiments/needle-splash-official-preview/node_modules/@needle-tools/engine/src/engine/extensions/NEEDLE_materialx.ts` | `bb8f82a1372a877aafb261138f74a3e8bca541c530396d3856912844e5b58896` | Registers Needle's MaterialX loader against the glTF parser. |
| `@needle-tools/materialx` | 1.7.1 | `experiments/needle-splash-official-preview/node_modules/@needle-tools/materialx/src/loader/loader.three.js` | `79e815bf0ba139aac5f5df5eb71cf14c330900dc5315d7341ab155c9120d55c3` | MaterialX image inputs call `parser.getDependency("texture", index)`, so material maps inherit the same glTF anisotropy `4`. |
| `@needle-tools/materialx` | 1.7.1 | `experiments/needle-splash-official-preview/node_modules/@needle-tools/materialx/src/materialx.helper.js` | `ad66ec035a4c39df3dcd8db5f766a7738e80456f784e7bdf14e7867f3ffd5e43` | A separate MaterialX environment conversion texture uses the renderer maximum. This is not a general material-map policy. |

The exact distinction is:

- ordinary Needle glTF material textures: `4`;
- MaterialX material image inputs: the same parser textures, also `4`;
- selected MaterialX environment/pre-filter targets: renderer maximum;
- progressive texture replacements: preserve the source value.

## Blendlink and Three r184 baseline

Blendlink installs Three `0.184.0`. Its stock `src/textures/Texture.js`
SHA-256 is
`ab2b297f91c58c69a95849ef8d1d3a9b7c0e7d2c3a574964b0ffd90b107452c6`
and keeps `Texture.DEFAULT_ANISOTROPY = 1`. Its stock `GLTFLoader.js`
SHA-256 is
`97642d720f16cc9a0c9844934198e4d0c023bea8e89576d0f7545d03b2d103d2`
and does not override texture sampling anisotropy.

Three documents that higher anisotropy reduces mipmap blur at the cost of more
texture samples, and exposes the device ceiling through
`renderer.capabilities.getMaxAnisotropy()`. The WebGL extension exposes both
the sampler parameter and its hardware maximum:

- [Three Texture anisotropy](https://threejs.org/docs/pages/Texture.html)
- [Three WebGLRenderer capabilities](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Khronos `EXT_texture_filter_anisotropic`](https://registry.khronos.org/webgl/extensions/EXT_texture_filter_anisotropic/)

## Designs compared

### A. Fixed `4` in every loader

This exactly matches Needle's ordinary glTF result and has a bounded sampling
cost. It is also shallow: every loader/cache adapter must remember the rule,
application-owned loaders are mutated implicitly, and a renderer with a lower
limit still performs its own hidden clamp.

### B. Mutate `THREE.Texture.DEFAULT_ANISOTROPY`

This is compact but globally changes application textures, render targets,
component textures, and other libraries. It has no resource ownership seam and
cannot restore safely. Rejected.

### C. Installation-time material-texture lease

One package module traverses the final imported material set, selects only
ordinary 2D textures whose current minification filter can actually use
anisotropic sampling, resolves the renderer capability, updates them before the
shader/prewarm barrier, and returns an inspectable, idempotent lease.

This is selected because it is deep and ownership-aligned:

- the one-call installer owns and later disposes its loaded glTF graph, so its
  zero-configuration default is numeric `4`, matching Needle and clamped to
  renderer capability;
- already-loaded R3F/application cache seams default to `"authored"`;
- cached callers can explicitly request `"renderer-max"` or a finite number;
- overlapping leases use the highest active request, and the last lease
  restores the prior value only while the texture still contains Blendlink's
  installed value;
- a developer/application mutation during the lease wins and is never
  overwritten during cleanup.

The stable interface is one additive option:

```ts
textureAnisotropy?: "authored" | "renderer-max" | number
```

A numeric `4` is the exact Needle-matching choice where the renderer supports
it. Numeric requests are clamped to renderer capability. The installed scene
exposes the resolved `textureSampling` report.

## Evidence

### Verified implementation and ownership

- `npm.cmd test --workspace blendlink -- src/threeTextureSampling.test.ts`
  passes 4 focused cases covering eligibility, idempotent restore, overlapping
  shared-cache leases, application override, and authored no-op.
- `npm.cmd test --workspace blendlink -- src/threeRuntime.test.ts -t
  "already-loaded cache|Needle-matching cache|loads, applies authored"` passes
  the private-default, cache-default, and explicit-numeric installer seams.
- `npm.cmd run build --workspace blendlink` passes on TypeScript 5.9.2 /
  Three 0.184.0.
- `node experiments/texture-sampling-browser/run.mjs` passes in Chromium
  `150.0.7871.182` / Three r184 / WebGL2 SwiftShader with maximum `16`. It
  queries the actual native `TEXTURE_MAX_ANISOTROPY_EXT` value and proves
  `1 → 4 → 16 → 4 → 1` across two overlapping leases. This is structural
  sampler/ownership evidence, not proof that maximum is the best default.
  Evidence is written to
  `experiments/texture-sampling-browser/output/evidence.json`.

### DOGWALK scene-level visual evidence

The exact current-pose/shadows-off GLB
`dd6f01c1ebdaa9243caaa45ac621bdd042b3783de7a4f26d4bb9f87eaba73161`
was rendered twice in Chromium 150 at the same authored camera:

- stock Three: all 46 material textures report anisotropy `1`, screenshot
  `03098d3d998885d726e024d1b185874d455ddfa4eb7154b71898d87e4708ac49`;
- renderer maximum: all 46 report `16`, screenshot
  `8f8974be027d725f02a9080e53f9af8aee7c5d1ff8d57ee20839bf2c81193258`.

The maximum control visibly removes most of the oblique ground moiré and
low-resolution appearance. This is **Prototype visual evidence** because the
fixture did not include a reference-image error metric and changed sampler
state directly rather than through the then-unshipped module.

## Honest boundary

`NDL-TEX-001` is **Match / Boundary Improvement / Shipped**: zero-configuration
owned resources match Needle's `4`, while Blendlink adds an ownership-safe
cache seam, inspectable report, and explicit renderer-maximum escape hatch.
The larger ceiling (`16` instead of Needle's `4`) is measurable, and the
DOGWALK differential is useful Prototype visual evidence, but it is not proof
that maximum is the best production default or a physical-GPU performance
claim. Higher anisotropy can increase texture samples. Physical desktop/mobile
GPU timing, power, and frame-budget evidence remain **Future Work**.
