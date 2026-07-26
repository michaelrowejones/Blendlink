# Final-glTF runtime capability gate for an honest beta

Research date: 2026-07-25

Capability: `NDL-RUN-003`

## Decision

The smallest honest beta now ships a **shared, pure compatibility classifier**
at the exact glTF JSON seam, with two thin adapters:

1. Final compilation/type generation classifies the exact GLB bytes against
   Blendlink's package-owned Three runtime profile before publication.
2. The Three adapter classifies `loaded.parser.json` again against the exact
   r184 built-ins, configured decoders, and any **explicit application
   capability attestation that is also present on the concrete parser** before
   the detached result may be prepared or committed.

The first adapter prevents an unsupported required
extension or a silently dropped material animation from entering the last
known-good publication. The second is defense in depth and preserves
application-owned loader plugins without treating a plugin name as proof that
the application preserves the extension's visible semantics.

Actual `KHR_animation_pointer` playback can remain Future for beta if those
channels fail loudly. That is still a capability Gap relative to Needle, but
it is not a silent-fidelity bug.

No manifest reshape is required for this first gate.

## Primary-source identities

| Source | Identity |
| --- | --- |
| Installed Three package | `three@0.184.0`; `node_modules/three/package.json`; SHA-256 `8308e43d6d6dd4c636c2dfe2e724da07dcd9fe4349bba6afb56f2c5ba6625391` |
| Installed Three loader | `node_modules/three/examples/jsm/loaders/GLTFLoader.js`; 114,959 bytes; SHA-256 `97642d720f16cc9a0c9844934198e4d0c023bea8e89576d0f7545d03b2d103d2`; immutable [r184 source](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/GLTFLoader.js) |
| Khronos extension mechanics | glTF revision `77b44be7bef26e01fb0b140e3d5bb1716421c5e9`; [registry source](https://github.com/KhronosGroup/glTF/blob/77b44be7bef26e01fb0b140e3d5bb1716421c5e9/extensions/README.md) |
| `KHR_animation_pointer` | same glTF revision; [ratified specification](https://github.com/KhronosGroup/glTF/blob/77b44be7bef26e01fb0b140e3d5bb1716421c5e9/extensions/2.0/Khronos/KHR_animation_pointer/README.md) |
| Needle Engine registration | `@needle-tools/engine@5.1.4`; `experiments/needle-splash-official-preview/node_modules/@needle-tools/engine/lib/engine/extensions/extensions.js`; SHA-256 `e00c4909eaea01cb2d21d45b7bb022ed2f1c87060ce736d74c023ee78f072e1c` |
| Needle pointer plugin | `@needle-tools/three-animation-pointer@1.1.2`; `src/GLTFLoaderAnimationPointer.js`; SHA-256 `9b6ed41c2bee905a0b1f2d48a7fd80b9408ad6ee17918467b366eaa904030617` |
| Needle pointer package identity | `@needle-tools/three-animation-pointer/package.json`; SHA-256 `e6338efbb4e4c63cc7ca5c6bab6c971de35d0246e187c5ee0fc1f6dfa70dc8d5` |
| Coherent Needle nested Three | `@needle-tools/three@0.169.19`; GLTFLoader SHA-256 `4aba05147b1ccb01f581979ea44950b60a568e74a5db811df9f5573a2b3521b1` |

The Khronos registry says `extensionsRequired` exists so an engine can decide
whether it can properly load an asset without walking every extension object.
The animation-pointer specification deliberately omits `target.node`; a loader
without the extension therefore ignores that channel. That is conforming
fallback, but it is not acceptable when Blendlink promises to transport the
artist's animated material.

## Exact Three r184 behavior

Three's constructor registers plugin callbacks, while four older handlers are
installed directly by the `extensionsUsed` switch. The list below means
“Three has a construction path”, not “pixel parity is proved.”

### Built-in construction paths

| Extension | Three r184 path | Important condition or evidence |
| --- | --- | --- |
| `KHR_lights_punctual` | plugin callback | Constructs directional, point, and spot lights |
| `KHR_materials_anisotropy` | plugin callback | Khronos corpus constructs `MeshPhysicalMaterial` |
| `KHR_materials_clearcoat` | plugin callback | Khronos corpus constructs `MeshPhysicalMaterial` |
| `KHR_materials_dispersion` | plugin callback | Khronos corpus constructs `MeshPhysicalMaterial` |
| `KHR_materials_emissive_strength` | plugin callback | Khronos corpus observes emissive intensity |
| `KHR_materials_ior` | plugin callback | Khronos corpus constructs the field |
| `KHR_materials_iridescence` | plugin callback | Khronos corpus constructs the field |
| `KHR_materials_sheen` | plugin callback | Khronos corpus constructs the field |
| `KHR_materials_specular` | plugin callback | Khronos corpus constructs the field |
| `KHR_materials_transmission` | plugin callback | Khronos corpus constructs the field |
| `KHR_materials_volume` | plugin callback | Khronos corpus constructs thickness/attenuation |
| `KHR_materials_unlit` | direct switch handler | Khronos corpus constructs `MeshBasicMaterial` |
| `KHR_texture_transform` | direct switch handler | Khronos corpus observes six non-identity transforms |
| `KHR_mesh_quantization` | direct marker handler | Accessor decoding uses core loader paths |
| `EXT_materials_bump` | plugin callback | Source-verified; no official pinned corpus cell yet |
| `EXT_mesh_gpu_instancing` | plugin callback | Source has explicit no-Points/Lines fallback and a SkinnedMesh TODO; handler presence is not blanket semantic proof |
| `EXT_texture_avif` | plugin callback | Depends on browser image decoding and deployment success |
| `EXT_texture_webp` | plugin callback | Depends on browser image decoding and deployment success |

### Built in, but only when the concrete loader is configured

| Extension | Required configuration | r184 failure behavior |
| --- | --- | --- |
| `KHR_draco_mesh_compression` | `setDRACOLoader()` | Its direct extension constructor throws whenever the extension is used and no DRACO loader exists. Blendlink's current high-level installer does not configure DRACO. |
| `KHR_texture_basisu` | `setKTX2Loader()` | A required texture throws when KTX2 is not configured; an optional extension returns to its core fallback. Blendlink auto-configures its owned KTX2 path when the descriptor requires it. |
| `EXT_meshopt_compression` | supported `setMeshoptDecoder()` value | A required compressed view throws when the decoder is absent/unsupported; an optional extension returns to fallback data. Blendlink configures this path. |
| `KHR_meshopt_compression` | same Meshopt decoder | r184 registers a second plugin under the KHR name. Blendlink currently derives `requiresMeshopt` only from the EXT name, so KHR-name support needs a matching descriptor/typegen test before it is promised. |

`EXT_texture_avif` and `EXT_texture_webp` are registered handlers, but r184
does not use a compile-time browser feature flag in these classes. Successful
image decoding remains browser/deployment evidence, not an artifact-only fact.

### Ignored or warning-only paths

- An unrecognized **optional** extension gets no top-level warning. At certain
  root/material/primitive/mesh/node/scene locations its JSON may be copied to
  `userData.gltfExtensions`, but no behavior is installed.
- An unrecognized **required** extension produces
  `THREE.GLTFLoader: Unknown extension "<name>".` with `console.warn()` and
  loading continues.
- `KHR_animation_pointer` is documented by Three as an external-plugin path.
  Core `loadAnimation()` executes `continue` when `target.node` is undefined,
  so an optional pointer channel is silently omitted. If it is required, the
  generic warning is emitted and the same omission occurs.
- `KHR_materials_variants`, `MSFT_texture_dds`, and `NEEDLE_progressive` are
  documented external-plugin paths, not core semantics.
- `KHR_node_visibility` has no r184 handler. The pinned official
  `CubeVisibility` cell warns, loads five meshes, and creates a zero-track
  clip.

The official `AnimatedColorsCube` cell is the important negative control:
Three retains two core transform tracks while silently dropping its optional
material-color pointer track. A required-extension allowlist alone cannot
detect that loss.

## Current Blendlink seams

The implementation uses the existing publication and detached-preparation
transactions:

- `gltfRuntimeCompatibility.ts` owns the strict GLB JSON reader, pure
  classifier, stable issue codes, exact package profile, and non-mutating
  loaded-parser profile.
- `typegen.ts::generateSceneModule()` classifies the exact raw GLB before
  `NodeIO.readBinary()`. This matters because
  `@gltf-transform/extensions@4.4.1` has no `KHR_animation_pointer`
  implementation and could otherwise erase that evidence before typegen sees
  it.
- `compiledSceneAudit.ts::auditCompiledSceneArtifact()` classifies the exact
  fully transformed staged GLB before decode and sealing. `verifyAll()` reruns
  that same audit against the published bytes.
- `threeRuntime.ts` loads into an exclusively owned detached root and exposes
  `loaded.parser.json`, `loaded.parser.plugins`, and
  `loaded.parser.extensions` through Three's typed `GLTF` result.
  `prepareLoadedThreeCompiledScene()` derives the concrete profile, intersects
  any `gltfRuntimeCapabilities` declaration with actually registered parser
  handlers, and asserts compatibility before shader compilation, rendering,
  or root commit.
- `configureCompiledSceneLoader()` owns KTX2 and EXT Meshopt configuration
  claims. It still has no DRACO or pointer-plugin configuration. The compiled
  profile deliberately excludes Draco and `KHR_meshopt_compression`.

No capability fields were added to manifest schema v3.

## Designs compared

### A. Compile-time static allowlist only

Parse `extensionsRequired` from the final GLB and compare it with a constant
Three r184 list.

Advantages:

- very small;
- fails before publication;
- deterministic and browser-free.

Problems:

- it overclaims conditional decoder paths;
- it cannot recognize an application-owned plugin with separately evidenced
  semantics;
- it misses optional loss-sensitive pointer channels;
- a profile verified from one Three revision cannot truthfully bless another.

Reject as the complete design. A static profile remains useful as one adapter
for Blendlink's package-owned beta runtime. Blendlink resolved the version
precondition by narrowing the executable `three` peer to exact `0.184.0`.
Generated projects now default to that exact runtime and reject ranges that
escape r184. The declaration-only `@types/three` peer permits
`>=0.184.0 <0.185.0`; the dogfood site proves `0.184.1` compiles without
changing the audited loader bytes.

### B. Infer support from runtime plugin names or warnings

Register a guard plugin or inspect the loaded parser and fail when a required
extension has no concrete handler.

Advantages:

- sees application plugin names and configured decoders;
- follows the actual website runtime.

Problems:

- Three's warning is not an error;
- a loader mutation has concurrency and unregister/Strict-Mode ownership
  hazards;
- a runtime-only failure allows an invalid artifact through `publish`;
- the bytes and decoder work may already have been spent.
- a `{ name: extension }` object is syntactic registration evidence, not proof
  that materials, animation tracks, visibility, or other semantics survived.

Reject as the sole gate. Prefer a non-mutating post-load inspection of
`loaded.parser` as defense in depth, and never promote unknown plugin names
without an explicit application declaration.

### C. One pure classifier, compile and runtime adapters

Choose this design. One deep module owns glTF validation, required-extension
comparison, animation-pointer discovery, stable issue codes, and
artist-readable remedies. A package-owned profile and a concrete loaded-parser
profile are adapters at the profile seam.

This gives callers one concept and keeps final publication, verification,
imperative Three, and R3F behavior aligned.

## Shipped smallest interface

```ts
export interface GltfRuntimeCapabilityProfile {
  readonly id: string
  /** Exact extension names this configured runtime may accept when required. */
  readonly supportedRequiredExtensions: ReadonlySet<string>
  /** Omit while pointer playback is unsupported. */
  supportsAnimationPointer?(pointer: string): boolean
}

export interface GltfRuntimeCompatibilityIssue {
  readonly code:
    | 'runtime.required-extension-unsupported'
    | 'runtime.animation-pointer-unsupported'
  readonly extension: string
  readonly location: string
  readonly pointer?: string
  readonly summary: string
  readonly fix: string
}

export interface GltfRuntimeCompatibilityReport {
  readonly profile: string
  readonly extensionsUsed: readonly string[]
  readonly extensionsRequired: readonly string[]
  readonly animationPointers: readonly {
    animation: number
    channel: number
    pointer: string
    family: 'material' | 'camera' | 'light' | 'node' | 'other'
  }[]
  readonly issues: readonly GltfRuntimeCompatibilityIssue[]
  readonly compatible: boolean
}

export function inspectGltfRuntimeCompatibility(
  document: unknown,
  profile: GltfRuntimeCapabilityProfile,
): GltfRuntimeCompatibilityReport

export function assertGltfRuntimeCompatibility(
  document: unknown,
  profile: GltfRuntimeCapabilityProfile,
): GltfRuntimeCompatibilityReport
```

The implementation validates the small raw JSON surface it consumes; callers
do not cast arbitrary fields. The throwing wrapper formats all issues in one
message. The report-returning function is the interface-level test seam.

The package-owned constant and loaded-parser adapter hide
version/configuration details:

```ts
BLENDLINK_THREE_R184_COMPILED_PROFILE: GltfRuntimeCapabilityProfile
loadedThreeRuntimeProfile(
  gltf.parser,
  applicationCapabilities?: GltfRuntimeCapabilityProfile,
): GltfRuntimeCapabilityProfile
```

The loaded profile starts from exact r184 built-ins, removes KTX2/Meshopt
capability when the corresponding `parser.options` dependency is absent, and
adds a custom required extension only when both conditions hold:

1. the application explicitly declares semantic support; and
2. the exact loaded parser exposes the matching plugin/extension handler.

The package-owned profiles omit pointer support and therefore reject every
observed unsupported pointer channel. An application may supply a pointer
predicate only alongside a registered pointer plugin; its own browser smoke is
responsible for proving that declaration. The classifier records material,
camera, light, node, and other pointer families so support can broaden through
the same policy seam. Merely finding `KHR_animation_pointer` in
`parser.plugins` never grants playback capability.

## Implemented insertion order

1. `readGlbJson()` is the strict raw-GLB JSON reader shared by typegen and the
   compiled-scene audit.
2. `generateSceneModule()` classifies before `NodeIO.readBinary()`. This
   covers the standalone external `blendlink typegen` path and prevents an
   unsupported extension from disappearing inside a library that does not
   implement it.
3. `auditCompiledSceneArtifact()` classifies the exact fully transformed
   staged bytes before decode and before sealing. `verifyAll()` inherits the
   same gate.
4. `prepareLoadedThreeCompiledScene()` classifies `loaded.parser.json` before
   preparation or commit using the concrete parser profile. Package-owned
   loading crosses this same already-loaded seam.
5. Manifest schema v3 remains unchanged.

The beta contract now requires r184. A runtime-derived check does not make an
r184 compile-time allowance true for a different Three minor.

## Acceptance evidence and remaining cells

### Pure classifier

Shipped in `packages/blendlink/src/gltfRuntimeCompatibility.test.ts`: all
seven cells below. The current compiled profile accepts Basis and EXT Meshopt
and refuses KHR Meshopt and Draco.

1. Known required `KHR_materials_unlit` passes.
2. Required `KHR_node_visibility` returns
   `runtime.required-extension-unsupported`, including the name and a concrete
   remove/plugin/compatible-runtime remedy.
3. An unknown optional extension is reported as observed but does not trigger
   the required-extension error.
4. Optional `/materials/0/pbrMetallicRoughness/baseColorFactor`
   `KHR_animation_pointer` returns
   `runtime.animation-pointer-unsupported`.
5. The same material pointer still fails when the animation contains valid
   core transform tracks.
6. Required Basis, EXT Meshopt, KHR Meshopt, and Draco vary independently with
   concrete profile configuration.
7. Malformed arrays, target objects, and pointer payloads fail loudly rather
   than becoming “no issues”.

### Publication transaction

Shipped: item 1 in `compiledSceneAudit.test.ts`; both standalone typegen
halves in `runtimeCompatibilityTypegen.test.ts`; and the last-known-good
rollback cell in `syncRenderableArtifact.integration.test.ts`. The rollback
uses a real renderable staged GLB whose exact JSON requires
`KHR_node_visibility`, then proves the prior GLB, manifest, generated module,
and developer-edited baked recipe remain byte-identical with no stage/next/
backup residue.

1. A renderable final GLB with required `KHR_node_visibility` is refused by
   `auditCompiledSceneArtifact()`.
2. A forced compile seeded with a last-known-good GLB, manifest, generated
   module, and baked recipe preserves every byte and leaves no stage when the
   staged GLB fails compatibility.
3. Standalone external typegen refuses both the required-extension cell and
   optional material-pointer cell before writing generated files.

### Three/runtime

Shipped in `threeRuntime.atomic.test.ts` and `reactThreeFiber.test.ts`: a
loaded parser requiring `KHR_node_visibility` refuses before `compileAsync()`,
renderer presentation, or root commit; the private-loader path publishes
Failed exactly once and Ready zero times, commits no application nodes, and
disposes geometry/material/texture exactly once. A concrete application plugin
name alone still refuses. A custom required extension passes only when the
parser registration and explicit application semantic declaration agree; a
pointer predicate additionally requires a registered pointer plugin. The
compiled r184 profile remains closed.

The refreshed consolidated focused command passed 42/42 tests on 2026-07-25:

```powershell
npm run test --workspace blendlink -- src/gltfRuntimeCompatibility.test.ts src/compiledSceneAudit.test.ts src/runtimeCompatibilityTypegen.test.ts src/threeRuntime.atomic.test.ts src/reactThreeFiber.test.ts src/syncRenderableArtifact.integration.test.ts
```

1. Package-owned r184 KTX2 and Meshopt scenes retain their existing successful
   paths.
2. A loaded parser with no matching plugin refuses `KHR_node_visibility`
   before root commit.
3. An application loader's registered extension name does not grant support.
   A matching explicit application capability can affect only that loaded
   parser; it does not retroactively bless Final compile.
4. Failure disposes loaded resources, publishes Failed once, publishes Ready
   zero times, and commits zero scene nodes.

### Browser evidence — production classifier verified

The corpus runner and browser harness now import the exact built
`dist/gltfRuntimeCompatibility.js` module instead of maintaining an
experiment-local allowlist. The Chrome gate passed on 2026-07-25 with the
hash-pinned 20-asset / 26-file official corpus:

```powershell
npm run build --workspace blendlink
node experiments/khronos-runtime-corpus/run.mjs --browser
```

The browser first classified each exact `.gltf`/`.glb` byte stream through
`BLENDLINK_THREE_R184_COMPILED_PROFILE`, before invoking `GLTFLoader`, then
classified the real loaded parser through `loadedThreeRuntimeProfile()`.
`CubeVisibility` refused with both
`runtime.required-extension-unsupported` and
`runtime.animation-pointer-unsupported`; the explicit raw-Three bypass then
confirmed five meshes and zero tracks. `AnimatedColorsCube` refused with
`runtime.animation-pointer-unsupported`; its explicit raw-Three bypass
confirmed four meshes and only two core tracks. Required unlit and the other
positive cells passed both production profiles. Injecting a named but no-op
pointer plugin into the loaded parser still refused the pointer channel.

Evidence identity:

- Chrome `150.0.7871.182`, Three `0.184.0`;
- built classifier SHA-256
  `d4a5374b1fc8f06244205bc2b364293bfc8611ddb783c2dd16bbedaddf78aee4`;
- browser evidence SHA-256
  `297f9928e972c05630de07eef1d13d5de795ecd173583bd5b1bdcd4549e11df4`.

A future pointer plugin can change the profile only after the same official
asset proves actual material/property playback rather than merely loading.

## Needle comparison

Needle Engine 5.1.4 asynchronously imports
`@needle-tools/three-animation-pointer@1.1.2`, registers
`GLTFAnimationPointerExtension`, and installs its pointer resolver. The pinned
plugin implements `loadAnimation()`, recognizes pointer targets, maps material,
node, punctual-light, and camera properties, and creates Three keyframe
tracks. That is a real implementation path absent from Blendlink.

The source inspection does not by itself prove every plugin mapping in a
browser. Blendlink should continue to record pointer playback as a Gap until a
coherent Needle/Blendlink differential runs. Loud refusal is an Improvement
over raw core Three's optimistic partial result, not parity with Needle.

## Release judgment

**Implemented beta behavior, with refreshed browser run pending:** exact-artifact
typegen/audit refusal for unknown required extensions and unsupported pointer
channels, concrete loaded-parser refusal before preparation or commit, and
the exact production classifier running against the official corpus in
Chromium before raw loader construction. The named last-known-good
capability-failure rollback and private-loader cleanup/status cells also pass.

**Explicit Gap, not silently accepted:** Blendlink does not package pointer
playback or browser-attest third-party plugins. The explicit application
capability seam is shipped, but the application owns the plugin and evidence.
Visual parity for every built-in material extension remains separate work.

**Resolved version boundary:** r184 is the exact beta runtime peer baseline.
Other Three minors require a new source/profile/browser audit before widening
the contract.

## Existing reusable evidence

The hash-pinned corpus and exact commands remain:

```powershell
node experiments/khronos-runtime-corpus/run.mjs
node experiments/khronos-runtime-corpus/run.mjs --browser
```

Both passed on 2026-07-25. The browser result used Chrome
`150.0.7871.182` and installed Three `0.184.0`; see
[`research-khronos-runtime-corpus-2026.md`](research-khronos-runtime-corpus-2026.md)
and `experiments/khronos-runtime-corpus/output/evidence.json`.
The 16:38 UTC browser rerun imports and verifies the exact built production
classifier; it is now valid browser evidence for that pure compatibility
seam. It remains structural/runtime evidence, not a pixel-parity oracle or a
browser execution of the Node-only typegen/audit adapters.
