# Ground Projection browser differential evidence

- Evidence date: 2026-07-23
- Needle runtime: `@needle-tools/engine 5.1.7`
- Needle Three.js: `0.169.19`
- Blendlink package: `0.8.0`
- Blendlink Three.js: `0.184.0`
- Browser: Chrome `150.0.7871.129`, headless, ANGLE SwiftShader
- Production result: the existing environment seam now auto-fits the grounded
  backdrop to visible compiled-root mesh bounds without a new manifest field

## Outcome

Blendlink's current Grounded Backdrop is not merely a source-level analogue.
The focused browser differential executes the actual pinned Needle
`GroundProjectedEnv` class on the left and Blendlink's current
`installLoadedThreeCompiledScene()` module on the right.

The resulting evidence supports five narrow conclusions:

1. **Basic projection is a verified match.** With identical raw RGBE bytes,
   height `2`, radius `18`, camera, viewport, DPR, tone mapping, and exposure,
   the 172,800-pixel images have MAE `0.0560`, RMSE `0.2378`, maximum
   channel error `6`, and zero pixels with a channel error over `8`.
2. **Runtime intensity is a verified match.** At intensity `0.65`, the images
   have MAE `0.0372`, RMSE `0.1934`, maximum channel error `4`, and zero
   pixels with a channel error over `8`.
3. **Blendlink improves raw-equirectangular rotation.** The pinned Needle
   implementation's `+90°` rotation produces zero changed pixels on this raw
   equirectangular projection. Its rotation varying and uniform are compiled
   only inside `NEEDLE_USE_CUBE_UV_MAP`. Blendlink rotates the published raw
   equirectangular GroundedSkybox and changes all 172,800 pixels as intended.
   This is an outcome improvement for Blendlink's actual published-HDR path,
   not a claim about Needle's separate CubeUV branch.
4. **Auto-fit is now a verified match and cleanup remains a Blendlink
   improvement; the denser geometry is a test-validated fidelity choice.**
   Both implementations place the off-origin subject's projection at
   `(3, 0.5, 1)`, and the rendered auto-fit cells have MAE `0.0556`, RMSE
   `0.2357`, maximum channel error `6`, and zero pixels over `8`. Needle uses
   16,128 triangles at resolution `64`; Blendlink retains 65,024 at resolution
   `128` because a separate five-view photographic gate rejected 64 against
   the predeclared image-error budget. Needle `onDisable()` removes but does
   not dispose the projection geometry, while Blendlink's production handle
   removes and disposes it.
5. **Initial camera safety is a verified Blendlink improvement.** The former
   package fallback formula gives a unit-box scene `far=86.603` against a
   required generated-geometry depth of `97.077`: 282 vertices clip and the
   browser control differs from a `far=1000` reference at MAE `4.2893`.
   Blendlink now measures the exact generated GroundedSkybox vertices once,
   expands only its own fallback camera to `97.077`, clips zero vertices, and
   renders byte-identically to the reference (MAE/RMSE/max `0`). Unsafe
   application-owned perspective and orthographic cameras both fail before
   Ready with the required far value; their far/projection matrices remain
   unchanged and the installation rolls back completely. This is an
   installation-time guard, not continuous ownership of a camera the website
   later moves.

The review image is
[`artifacts/ground-projection-browser-2026/ground-projection-differential.png`](../artifacts/ground-projection-browser-2026/ground-projection-differential.png).
The machine evidence, including every metric and retained browser diagnostic,
is
[`artifacts/ground-projection-browser-2026/evidence.json`](../artifacts/ground-projection-browser-2026/evidence.json).

## Exact source identity

`npm.cmd run verify:needle-baseline` passed before the differential:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 76 files, 5 source version identities (2026-07-23) integration=mixed-source
```

The browser report re-hashes every source it executes:

| Source | Version | SHA-256 |
| --- | --- | --- |
| `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/GroundProjection.ts` | Needle Engine `5.1.7` | `30abd50cd872c62d59d0b6e3cfaefb3f7701145f7820c4b6532197827e9e9627` |
| `experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/objects/GroundedSkybox.js` | Three `0.169.19` | `2c15df3f78e136fe37ba3adcdba38ee0bf867cffc54b545f688d85778e8774c2` |
| `packages/blendlink/src/threeRuntime.ts` | Blendlink `0.8.0` | `fa2d80538e09d8ac808fafffbb140168c4dbb4b3c44f214fbd83be1f30572b73` |
| `packages/blendlink/src/runtime.ts` | Blendlink `0.8.0` | `19d9df98a8e69e6c4f133af67ea84a3cc2ee3a1f231959576d99d3fbf6ac7b18` |
| `packages/blendlink/src/threeRenderableBounds.ts` | Blendlink `0.8.0` | `fd23edf6eca4c47338a7c7e5a7d2706e90231d315d95fad1d1da4968d5b866d3` |
| `packages/blendlink/src/threeGroundedCameraSafety.ts` | Blendlink `0.8.0` | `bfe32e1ff34627510c7b0477d8be36bacaa383396dfc7acc5f28a7d4128c23b8` |
| `node_modules/three/examples/jsm/objects/GroundedSkybox.js` | Three `0.184.0` | `14ad38d785bb998bba0dc9e74b5d8f93ea45753b24341be539755d8e567ee456` |

These Blendlink hashes identify the current dirty worktree, not a release tag.
Re-run the fixture if either file changes.

## Artist-facing field mapping

Needle has two authoring routes:

- its project shortcut exposes capture height, injects `autoFit = true`,
  derives radius as 30% of active-camera far clip (or `50`), and injects
  `arBlending = 1`;
- its manual component exposes `autoFit`, `radius`, and `height`.

Blendlink keeps Ground Projection inside the existing environment module,
rather than introducing a second Component owner:

| Outcome | Needle | Blendlink current behavior |
| --- | --- | --- |
| Capture height | Project shortcut and manual component | **Grounded Backdrop → Capture Height**, serialized as `groundHeight` |
| Radius | Derived by shortcut; editable on manual component | **Grounded Backdrop → Radius**, serialized as `groundRadius` |
| Auto-fit X/Z and ground Y | Runtime `autoFit`, default true | Automatic adapter-time fit over visible meshes beneath the compiled root; application-owned siblings, hidden subtrees, UI, and `blendlink_auto_fit=false` helpers are excluded |
| Y rotation | Scene background rotation consumed by runtime | **Grounded Backdrop → Rotation** is exposed and serialized |
| Background intensity | Scene/runtime value | Runtime descriptor supports it; grounded Blender authoring deliberately fixes it to `1` |
| Projected blur | Custom CubeUV or copied-texture path | Runtime descriptor carries it, but the Three adapter warns and ignores it; grounded Blender authoring deliberately fixes it to `0` |
| AR/passthrough blending | `arBlending` plus last-background fallback | Deliberate website/XR boundary; not shipped |

The Blendlink UI shows rotation, height, and radius for Grounded Backdrop.
It shows intensity and blur only for an ordinary image backdrop.
`packages/blender-addon/props.py` preserves the full runtime fields but emits
grounded intensity `1` and blur `0`. This is truthful authoring: artists are
not offered controls that the projection cannot represent.

## What each source actually does

Needle constructs the official Three GroundedSkybox with explicit resolution
`64`, then positions and optionally auto-fits it. Its material patch:

- multiplies background intensity;
- applies background rotation only in the `NEEDLE_USE_CUBE_UV_MAP` shader
  branch;
- provides CubeUV horizon blur;
- can copy and blur non-CubeUV textures;
- supports AR/passthrough alpha blending; and
- removes old projections from their parent without explicitly disposing
  their geometry or material.

Blendlink passes its already-published equirectangular HDR texture to the
official Three `0.184.0` GroundedSkybox. It positions at capture height,
auto-centers X/Z and places the floor at the compiled root's minimum visible
mesh Y, rotates the mesh around Y, applies intensity through material color,
warns loudly if projected blur is nonzero, and explicitly disposes detached
geometry and material as part of the environment transaction. Empty
environment-only scenes retain the authored world origin with an explicit
warning.

Three's official documentation defines height, radius, and resolution and
currently documents resolution `128` as the default
([GroundedSkybox](https://threejs.org/docs/pages/GroundedSkybox.html)).
Three's lifecycle guide states that removing a mesh does not dispose its
geometry or material and recommends `renderer.info` for cached-resource
diagnostics
([How to dispose of Objects](https://threejs.org/manual/en/how-to-dispose-of-objects.html)).

## Evidence-design comparison

Three designs were considered before choosing the fixture.

### Design A — source and unit invariants only

Hash the pinned sources, count geometry structurally, and use existing
renderer-neutral unit tests for environment arguments and disposal.

Advantages:

- deterministic and fast;
- excellent for interface and transaction invariants;
- no browser/toolchain noise.

Limit:

- cannot establish that the shaders compile, that pixels are nonblank, that
  rotation has an effect, or that renderer memory observes disposal.

### Design B — actual class versus production installer in one browser

Execute the pinned Needle TypeScript class with its nested Three version and
Blendlink's production installation module with its own Three version. Feed
both the same generated RGBE bytes and independently read matching render
targets.

Advantages:

- both implementations can fail independently;
- source identity, pixels, object positions, triangle counts, and
  `renderer.info.memory.geometries` are all observed in one run;
- no copied Needle algorithm is mistaken for Needle evidence.

Costs:

- two Three versions introduce small expected raster differences;
- importing the isolated Needle class transitively starts unrelated decoder
  bootstraps that a full Needle host would normally configure.

Decision: use Design B for the focused current evidence.

### Design C — two exported `.blend` applications

Export the same asymmetric `.blend` and photographic HDR through complete
Needle and Blendlink applications, then compare deployed routes.

Advantages:

- includes Blender serialization, camera setup, PMREM/CubeUV behavior, real
  asset loading, and full application lifecycle.

Costs:

- many more variables can fail at once;
- framework, route, decoder, and deployment differences can obscure the
  projection behavior;
- it is expensive for a first isolating fixture.

Decision: make this the next promotion gate for CubeUV blur/rotation and
camera clipping, not the first diagnostic.

## Browser fixture

Command:

```text
node experiments/ground-projection-browser/run.mjs
```

Last pass:

```text
BLENDLINK_GROUND_PROJECTION_BROWSER_PASSED commonMae=0.0560 rotatedMae=51.4581 autoFitMae=0.0556 needleTris=16128 blendlinkTris=65024
```

The fixture:

1. serves one asymmetric `32 × 16` RGBE axis chart from the same origin;
2. creates separate WebGL renderers for Needle `0.169.19` and Blendlink
   `0.184.0`;
3. executes the real Needle `GroundProjectedEnv.updateProjection()` and
   `onBeforeRender()`;
4. executes Blendlink `installLoadedThreeCompiledScene()`;
5. reads independent `480 × 360` render targets;
6. asserts nonblank opaque output;
7. compares common, rotated, and intensity variants;
8. asserts matching auto-fit positions/pixels and exact triangle counts;
9. captures the review images;
10. reintroduces the former package-camera far formula as an explicit visual
    control, compares the production repair with a far `1000` reference on
    the same renderer, and verifies application-camera rejection for both
    perspective and orthographic cameras; and
11. disables/disposes each implementation and observes renderer geometry
    counters.

The common-image threshold is deliberately broad enough for independent Three
versions but narrow enough to catch orientation or blank-render failures:
MAE `< 4`, RMSE `< 16`, and fewer than 8% of pixels with a channel error over
`8`. The actual common result is much tighter and has zero pixels over `8`.
This is not a universal perceptual threshold for photographic HDRs.

## Capability register

| Capability ID | Exact comparison | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- |
| NDL-GRD-BR-001 | Raw equirectangular GroundedSkybox with shared height/radius | **Match** | **Shipped** | `ground-projection-browser`, command above, passed 2026-07-23 on Chrome 150 / ANGLE SwiftShader; MAE `0.0560` |
| NDL-GRD-BR-002 | Runtime background intensity | **Match** | **Shipped** runtime; richer grounded authoring **Future** | Same gate; intensity `0.65` MAE `0.0372` |
| NDL-GRD-BR-003 | Rotate a raw equirectangular projected environment | **Improvement** | **Shipped** | Same gate; Needle changed `0` pixels while Blendlink changed all `172,800`; CubeUV comparison remains separate |
| NDL-GRD-BR-004 | Auto-center projection on rendered bounds and floor | **Match / Improvement** | **Shipped** | Same gate: both positions `(3, 0.5, 1)`, pixel MAE `0.0556`; Blendlink scopes bounds to its compiled root rather than application-owned siblings and excludes hidden/UI/opt-out helpers |
| NDL-GRD-BR-005 | Explicit geometry/material cleanup at scene disposal | **Improvement** | **Shipped** | Same gate; Blendlink geometry count falls on handle disposal, Needle count falls only after fixture's manual disposal |
| NDL-GRD-BR-006 | Projection geometry budget | **Deliberate fidelity improvement / cost tradeoff** | **Shipped** at resolution 128 | A separate five-view forest-EXR browser gate rejected Needle's 64 against the predeclared budget: worst MAE `2.2264`, RMSE `6.4582`, and `7.615%` of pixels over error `8`; 128 is retained without claiming a speed result |
| NDL-GRD-BR-007 | CubeUV horizon blur and rotation | **Gap** for blur; rotation relation not yet classified | **Future** | Pinned source verified; browser pixels Pending |
| NDL-GRD-BR-008 | AR/passthrough blending | **Boundary** | **Future** | Pinned source verified; deliberately outside current website compiler core |
| NDL-GRD-BR-009 | Initial camera far-plane/radius safety without taking website-camera ownership | **Improvement** | **Shipped** | Same browser gate: former fallback control clips 282 vertices and differs from reference at MAE `4.2893`; repaired fallback clips none and is byte-identical to far `1000`. Unsafe application perspective/orthographic cameras reject without mutation or leaked scene children. Pinned Needle only enlarges far through generic camera fitting; its calculated maximum zoom is not propagated by the inspected OrbitControls call path |

## Architecture consequence

No new public interface was justified. Ground Projection remains a deep part
of the environment module: one published HDR, independent lighting/background
ownership, one installation transaction, and one disposal owner.

Two internal auto-fit designs were compared before changing production:

1. compile a fixed center/floor from Blender bounds; or
2. compute visible compiled-root bounds in the Three adapter at install time.

The first is deterministic but becomes stale if website code changes
visibility. The second matches Needle's dynamic scene knowledge but must not
include application-owned siblings or hidden/internal helpers. The likely
product fit was adapter-time fitting over the compiled root only, with
authored height/radius unchanged and no site-camera reframing. That design now
ships behind `installLoadedThreeCompiledScene()` and passes both a public-seam
unit fixture and the actual pinned-Needle off-origin browser differential. It
intentionally fits once at installation; later application-driven transform
or visibility changes do not continuously refit an environment mesh.

Camera safety follows the same ownership boundary. Three designs were
compared: copy Needle's generic camera mutation, replace stock
GroundedSkybox depth behavior with a custom shader, or inspect the exact
generated vertices and repair only a Blendlink-created fallback. Generic
mutation would silently change artist/application depth precision and still
would not protect later motion; a shader override would create a new
WebGL/WebGPU/log-depth compatibility surface. The third design therefore
ships as the internal `threeGroundedCameraSafety` module. Blender-authored
and website-supplied cameras fail loudly with a source-specific remedy and
are never mutated.

The 64-resolution candidate was tested against 128 using the same Three
0.184.0 renderer, texture, and cameras across five photographic forest-EXR
views. Although it removes 48,896 triangles (75.2%), it exceeded the
predeclared visual budget around the projected horizon/floor. Blendlink
therefore keeps 128 as a deliberate fidelity choice. No timer query ran, so
the evidence supports triangle counts and pixels, not a GPU-speed comparison.

## Limits and open gates

- Only Chrome/ANGLE SwiftShader ran; no physical-GPU timing, mobile, Firefox,
  WebKit, or WebGPU evidence exists.
- The RGBE chart is intentionally diagnostic, not a production photographic
  HDR.
- Needle's CubeUV/PMREM rotation and blur branch remains untested.
- Projected blur remains absent in Blendlink.
- Camera far/radius safety runs once during installation. Later
  application-driven camera motion remains the website's responsibility;
  Blendlink does not mutate controls, near plane, FOV, zoom, or framing.
- AR/passthrough remains an explicit product boundary.
- The fixture observes Three renderer counters, not process-level VRAM
  reclamation.
- Repeated create/dispose cycles and context loss remain pending.
- Importing the pinned class transitively starts Needle's default Google
  DRACO and Needle CDN Basis bootstraps. The fixture fulfills the unrelated
  DRACO request with an inert response and records the network-restricted
  Basis failures. Neither decoder participates in this no-glTF/no-KTX test.
