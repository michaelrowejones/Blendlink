# Shadow Catcher implementation review (2026-07-23)

This is a read-only review of the first-party implementation in
`packages/blendlink/src/threeShadowCatcher.ts`. It does not promote any
capability to Verified. The browser/compositing gate described below is still
required.

## Reviewed identities

- Needle Blender add-on `1.4.2`
- `@needle-tools/engine` `5.1.7`
- Needle runtime source
  `node_modules/@needle-tools/engine/src/engine-components/ShadowCatcher.ts`,
  SHA-256
  `af0b0fea08e92cee701b618613975b6412eb7a0b80642312a25ce01bba4b740b`
- Needle Blender component catalog
  `data/builtin.component.json`, SHA-256
  `d32f28bc6beb4379dcce1b12e114c389f56e493e4e0820123c9a500dfb867382`
- Blendlink-installed `three` and `@types/three` `0.184.0`
- Three `src/materials/ShadowMaterial.js`, SHA-256
  `9de4022504a8da0934569c8d125e00d6309892af78d3c485dac0c02e909efc40`
- Three `src/renderers/shaders/ShaderLib/meshphysical.glsl.js`, SHA-256
  `2fc4c7abab0acb6a1a83bd67eb313c277ebecd74258a804adcadc8c880e39a5c`
- Three `src/renderers/webgl/WebGLState.js`, SHA-256
  `fd6adb6c01d75a148ef6ebc8ea948a38acc1a48d3cfdbbb1d12dbde668092431`

`npm.cmd run verify:needle-baseline` passed with 68 files and five version
identities on 2026-07-23. Exact root resolution and the other pinned hashes are
in [`needle-baseline.json`](needle-baseline.json).

## Source-grounded comparison

Needle does the following:

1. A Mesh target receives a clone of its current material. A non-Mesh target
   gets a newly created quad.
2. The target is moved to layer 2, making it non-raycastable under Needle's
   default camera/raycaster policy.
3. Mask mode replaces the clone with Three `ShadowMaterial`.
4. Additive mode keeps the cloned material, sets additive blending, and patches
   the Mesh Standard/Physical direct-light seam with a hard-coded `6.6`
   multiplier.
5. Occluder mode keeps the cloned material and sets depth/stencil write,
   disables color write, and sets render order to `-100`.
6. The inspected class has no component-owned restoration/disposal path.

The pinned Blender catalog gives Shadow Mask an artist default of black with
alpha `0.5`. The runtime class's TypeScript initializer says alpha `1`, but an
ordinary Blender-authored record carries the catalog value.

Three documents `ShadowMaterial` as a transparent shadow receiver and uses it
with `receiveShadow = true`.
[Three ShadowMaterial](https://threejs.org/docs/pages/ShadowMaterial.html)
Three also documents that `onBeforeCompile` and its cache-key customization are
WebGLRenderer-only; the WebGPU migration guide requires node materials/TSL for
this kind of modification.
[Three Material](https://threejs.org/docs/pages/Material.html#onBeforeCompile)
[Three WebGPU migration](https://threejs.org/manual/en/webgpurenderer#migration)

Blendlink improves several ownership properties in source:

- a Group can apply the catcher to existing descendant meshes instead of
  silently ignoring them;
- layers and default raycasting are left application-owned;
- each replacement material is Blendlink-owned and disposed;
- original material, `receiveShadow`, and `renderOrder` values are restored
  conditionally; and
- outer scene installation invokes `compileAsync()` before ready by default,
  so the additive seam can fail during the installation transaction.

These are implementation facts, not yet browser-verified improvements.

## Correctness risks

### Findings resolved during this review

1. An earlier in-progress revision multiplied Additive direct light by the
   shared `[0, 0, 0]` Mask tint and therefore produced zero RGB/alpha at its
   defaults. Additive now ignores the Mask-only tint and clones a
   Standard/Physical source material, matching Needle's basic source-coverage
   approach.

2. An earlier in-progress revision used Mask opacity `1`, while the pinned
   Needle Blender catalog uses `0.5`. The TypeScript and Blender defaults now
   use `0.5`.

Both fixes still need the browser evidence below; source/unit correction alone
does not make their visual status Verified.

### Release blockers

1. **Occluder loses source coverage.** Needle modifies a clone of the source
   material. Blendlink creates a blank `MeshBasicMaterial`, copying only
   `side`. Alpha maps/tests, clipping, displacement, vertex colors, and other
   geometry-affecting material behavior can therefore change. A cutout
   occluder can write full-triangle depth instead of the authored silhouette.
   Either preserve the relevant source properties or explicitly reject
   unsupported receivers.

2. **Descendant behavior has no scope control.** The earlier design called for
   `includeDescendants`, default true. The implementation always traverses
   descendants, including when the selected target is itself a Mesh. Attaching
   a catcher to a parent mesh can unexpectedly replace materials on unrelated
   child meshes.

3. **Empty targets pass authoring compatibility but fail at runtime.** The
   Blender schema allows any Object and has no Shadow Catcher mesh-descendant
   validation. Needle creates a quad for a non-Mesh target; Blendlink throws
   when an Empty has no mesh descendants. Blendlink should either lint this
   before publish, deliberately author a plane, or record the missing auto-quad
   behavior under its own stable capability ID.

4. **Additive is ahead of its evidence state.** The prior grounding research
   requires WebGL/TSL and transparent-compositing evidence before Additive
   ships. The current public enum exposes it. Also, `prewarm: false` moves a
   missing-seam failure from atomic installation to the first later render.
   Until the pixel matrix exists, Additive should remain Prototype/Future and
   be labelled or gated accordingly.

### Ownership and performance risks

1. Material restoration compares only the material/array object identity. If
   an application mutates one slot of Blendlink's installed material array,
   disposal still replaces the entire array and loses that later slot owner.
   The supported ownership granularity needs to be explicit and tested.

2. `restore()` groups material, shadow, and render-order restoration in one
   `try`. A failure restoring the material skips the remaining state restores.
   Cleanup failure should not prevent independent cleanup attempts.

3. `dispose()` marks the installation disposed before cleanup. A cleanup error
   cannot be retried. This is acceptable only if the ownership contract says
   cleanup is best-effort after a loud aggregate error.

4. A failure while constructing a multi-slot replacement can leak materials
   created before the failing slot because that mesh has not yet entered the
   outer installation list.

5. The additive program cache key includes color, opacity, and strength even
   though they are uniforms and do not alter shader structure. Different
   artistic values therefore force separate GPU programs. The browser fixture
   should prove that two value variants share one shader program before calling
   the mode low-cost.

6. Mask mode can install successfully while rendering nothing when the
   renderer has shadows disabled or no relevant light/caster can cast a shadow.
   Artist-facing diagnostics should distinguish a valid transparent result from
   a provably ineffective setup.

## Minimum tests before promotion

### Unit/transaction tests

- Mask on a Group with two descendant meshes and a multi-material mesh:
  exact material slot count, `ShadowMaterial` parameters, unchanged layers, and
  `receiveShadow = true`.
- Occluder properties and actual depth intent: `colorWrite = false`,
  `depthWrite = true`, render order `-100`, plus exact restoration.
- No source material mutation; every owned replacement emits one dispose event.
- Idempotent disposal; a later application material assignment survives while
  untouched meshes restore exact identities.
- Explicit material-array slot ownership behavior.
- Failure on a later descendant rolls back every earlier descendant and
  disposes all partial materials.
- No-mesh target fails with the target name, and the Blender validation gate
  catches the same case before browser runtime.
- Additive default produces visible nonzero intent, or Additive is unavailable.
- Additive seam injection, missing-seam error, and a full
  `installLoadedThreeCompiledScene()` compile-barrier rollback test.
- `prewarm: false` cannot silently publish a lazily failing Additive material.
- Two additive artistic variants do not allocate structurally duplicate shader
  programs.

The existing focused command passed 38 tests on 2026-07-23:

```powershell
npm.cmd exec --workspace packages/blendlink -- vitest run src/threeComponents.test.ts src/components.test.ts
```

At the time of this review, those files covered the new catalog defaults but
did not yet contain Shadow Catcher material/lifecycle tests. The Blendlink
workspace build also passed.

## Minimal browser visual-evidence fixture

Build a production Vite consumer from a freshly packed Blendlink tarball, serve
the built output, and test it in system Chrome through Playwright. The page must
own a transparent WebGL Canvas over a high-contrast checkerboard DOM
background, use DPR 1, a fixed camera, fixed tone mapping/output color space,
and real shadow maps.

Use four deterministic cells:

1. **Mask:** a directional-light cube shadow on a plane. Capture raw Canvas
   RGBA and the DOM-composited screenshot. Unshadowed pixels must remain
   transparent; shadow pixels must have the expected tint/alpha. A no-shadow
   control must remain unchanged.
2. **Descendants:** one Group with two receiver meshes. Both must work while
   their distinct layer masks and pointer-raycast hits remain unchanged.
3. **Occluder:** a colorless depth plane in front of a colored object, with an
   unobstructed control. The occluded region must reveal the DOM background,
   proving depth changed while color did not.
4. **Additive (separate experimental gate until accepted):** fixed point, spot,
   and directional lights with default, tint, opacity, fog, and tone-mapping
   variants. Defaults must be visibly nonzero and captures must be compared to
   the actual pinned Needle runtime under identical renderer settings.

For exact parity, run flat-Mesh Mask/Occluder/Additive cells once through the
actual pinned Needle class and once through the packed Blendlink adapter.
Store both source identity/hashes in the evidence JSON. Treat the Group cell as
a separate improvement test because Needle creates/uses its own target rather
than mutating those descendants.

The same page should expose a lifecycle API to Playwright:

- record original material UUIDs, `receiveShadow`, layer masks, render order,
  and raycast hit IDs;
- install, replace one material from the application, dispose twice, and assert
  exact conditional restoration;
- repeat five install/render/dispose cycles and verify stable renderer program
  and material counts after a flush frame;
- assert installation ready occurs only after `compileAsync`;
- collect page, console, request, HTTP, WebGL, and context-loss errors; and
- exercise `WEBGL_lose_context` separately from ordinary disposal.

Retain the composed PNGs, raw RGBA measurements, thresholds, Chrome/Three
versions, tarball SHA-256, pinned Needle SHA-256, lifecycle observations, and
all named assertions in one machine-readable evidence JSON. A passing unit
seam is not evidence for the transparent Canvas, depth buffer, or deployed
packed-consumer claims.

## Implementation resolution (2026-07-23)

The review findings were implemented in the package-owned
`threeShadowCatcher.ts` module and the portable Component registry instead of
being copied into generated website code.

Implemented behavior:

- Mask uses Three's `ShadowMaterial`; Additive preserves the authored
  Standard/Physical material inputs and patches the same direct-light seam and
  `6.6` default multiplier as pinned Needle 5.1.7; Occluder writes depth and
  stencil without color at render order `-100`.
- A Mesh target works directly. An Empty/group can create one owned plane, and
  descendant groups preserve their separate material slots, transforms, and
  layer masks instead of inheriting Needle's layer-2 takeover.
- Overlapping Preview generations use a lease stack. Disposal is idempotent,
  restores only values Blendlink still owns, retains a later application
  material assignment, and disposes every owned material/geometry exactly
  once. Partial installation rolls back transactionally.
- Blender serialization, validation, native controls, Component search, and
  Three installation use one `blendlink.shadow-catcher` record. Invalid
  no-mesh targets fail before publish and again at runtime if bypassed.

Verified behavior:

- Focused unit and installer tests cover all three modes, multi-material and
  descendant receivers, overlapping owners, partial failure, application
  takeover, generated-plane sharing, and cleanup.
- The real-Chromium fixture in
  `artifacts/shadow-catcher-browser-2026/evidence.json` observed 2,473
  partial-alpha Mask pixels, 2,648 partial-alpha pixels across two descendant
  receivers, depth occlusion without a color write, 54,600 nonzero-RGB
  Additive pixels at the authored defaults, unchanged application layer masks,
  no page/console errors, and exact conditional restoration.

Evidence boundary:

- The browser run records the pinned Needle source SHA-256 but does not execute
  the Needle class side by side. It proves Blendlink effectiveness and
  source-structure parity, not exact cross-version pixel identity.
- Additive remains Preview because its source algorithm is explicitly
  heuristic and its output depends on light, tone-mapping, and material
  context. Physical-GPU timing, alpha-tested coverage, WebKit/Firefox/mobile,
  and an actual pinned-Needle pixel differential remain future evidence.
