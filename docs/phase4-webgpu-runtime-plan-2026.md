# Phase 4: the WebGPU/TSL runtime — measured shape (2026-07-27)

This supersedes the effect-mapping half of
`research-wgpu-post-replacement-2026.md` and turns the paused Phase 4
into an executable plan. Three inputs, all from 2026-07-27 research:
the three.js r184 ecosystem state (sourced), a full port-surface census
of this repo, and the IR-application design for the shipped
`blendlink_tsl_ir` route. WGPU-PP-001's negative measurement stands:
the pinned `postprocessing`/`n8ao` stack constructs 0/13 on
WebGPURenderer, so the port replaces the stack, not the wrapper.

## Ground truth that shapes the plan

- **three 0.184.0 (pinned)**: WebGPURenderer is functional and heavily
  invested-in but officially "experimental"; the WebGL2 fallback
  backend is real and was actively hardened in r184 (multi_draw,
  normal-bias, NodeMaterial compat layer). The known many-draw-call UBO
  performance issue (three#30560) affects BOTH backends; the mitigation
  is instancing/batching — which Blendlink's optimizer already produces
  (BatchedMesh stays).
- **Post-processing is the node system**: `PostProcessing` was renamed
  `RenderPipeline` in r183 (r184 keeps a deprecated wrapper — target
  `RenderPipeline` directly). Effects are TSL expressions composed into
  `renderPipeline.outputNode`; r184 ships ~40 effect nodes including
  bloom, gtao, dof, outline, lut3d, traa, fxaa, smaa. The pmndrs
  `postprocessing` package is WebGL-only by maintainer policy.
- **GLTFLoader needs no changes**: loaded classic materials are
  auto-converted by the node library; per-slot overrides work by
  swapping in `MeshStandardNodeMaterial` (setDefaultValues copies
  props) and setting colorNode/roughnessNode/metalnessNode/opacityNode
  — lights, env maps, and shadows are preserved because node materials
  ARE the native pipeline.
- **KTX2**: `KTX2Loader.detectSupport(renderer)` works on
  WebGPURenderer when called AFTER `await renderer.init()`
  (`detectSupportAsync` is deprecated since r181 — do not adopt it).
- **Migration pitfalls to engineer around**: mandatory async init
  (silent black screen otherwise), tone mapping/output color space as a
  separate output pass (small output deltas vs WebGLRenderer),
  HalfFloat default drawing buffer, async-only readback, no
  `ShaderMaterial`/`onBeforeCompile`, r183 shadow retune,
  import-path mixing hazards (`three` vs `three/webgpu`).
- **Version pressure**: r185 renamed TSL exports and changed
  GTAO/SSR visuals; r186 (due 2026-08-05) removes deprecated code and
  reworks GTAO again. Staying pinned at 0.184.0 is correct for this
  phase; a re-pin is its own future evidence-gated change.

## Architecture decision: additive WebGPU runtime, not an in-place flip

The shipped WebGL runtime (installer, pmndrs pipeline, GLSL
onBeforeCompile patches, contact-shadow ShaderMaterials) keeps working
untouched through v0.x. Phase 4 builds a parallel WebGPU runtime behind
the SAME renderer-neutral seams and becomes the default at v1.0, when
`postprocessing` + `n8ao` leave the dependency graph (flip the
`scripts/test-package.mjs` pin gate in the same change and delete
`n8ao.d.ts`). Rationale: WGPU-PP-001 proves coexistence on one renderer
is impossible, the interfaces (`PostPipelineService`,
`PostEffectDescriptor`, componentRuntime phases) were designed
renderer-neutral, and an additive runtime lets every stage land behind
evidence without a big-bang cutover.

## Track 0 — evidence first (prerequisite for everything)

STATUS: **MEASURED GREEN 2026-07-27** (WGPU-NODE-001,
`npm run test:wgpu-node-postprocessing`, evidence in
`experiments/wgpu-postprocessing-parity/output/node-evidence.json`).
Node pipeline 14/14 on native WebGPU, 14/14 on the WebGL2 fallback
(`forceWebGL`), pmndrs control 13/13, zero gate failures. Base-image
parity with the control is 0.01 mean luma; the custom-TSL probe is
0.00. Named residue for Track B: parameter-space mapping for bloom
(pmndrs luminance threshold 0.9 vs node 0), depth-of-field (normalized
CoC vs view-Z units), and n8ao (`n8ao-webgpu` defaults vs old
`N8AOPostPass` — delta 68 luma until the authored AO config maps);
n8ao temporal accumulation needs convergence before a tight
cross-backend threshold; upstream r184 `chromaticAberration`
null-center bug (pass `vec2(0.5, 0.5)`); vignette/tilt-shift/kuwahara
rows stay `pendingTrackB` until the Blendlink-owned nodes exist.

1. ~~Extend `experiments/wgpu-postprocessing-parity` into the
   per-effect fixture harness~~ — done (`node-main.js`/`node-run.mjs`;
   RenderTarget + `readRenderTargetPixelsAsync` readback, default-
   color-space target to avoid double sRGB encode).
2. ~~Measure the WebGL2 fallback backend explicitly~~ — done: 14/14,
   cross-backend mean-luma delta ≤ 0.29 everywhere except n8ao.
3. ~~Promote the harness into a registered browser-pixel CI gate~~ —
   registered as `test:wgpu-node-postprocessing` (non-zero exit on any
   construct/render/black-frame/inactive-effect failure), the same
   registered-gate class as the other browser evidence commands.

## Track A — renderer core (mechanical first, behavior second)

STATUS: **LANDED 2026-07-27** (commits 4b41f47, 05314da, 2354a04)
except the deliberately deferred templates sub-task below.

- ~~Retype-first commit~~ — `assertCompiledSceneRenderer` accepts
  either Three renderer identity; flag-less renderer-likes still
  reject; the rejection test inverted into a full-path WebGPU install
  acceptance test.
- ~~KTX2 wiring~~ — r184 `detectSupport()` natively branches on
  `isWebGPURenderer` (initialized renderer required); only the error
  copy needed fixing.
- ~~PMREM probe capture~~ — `createPmremGenerator()` picks the
  generator by renderer family; `three/webgpu` loads lazily so
  WebGL-only bundles pay nothing; the async WebGPU shader compile is
  awaited (no-op await on WebGL).
- ~~RectAreaLight LTC init~~ — resolved as a NAMED REFUSAL on
  WebGPURenderer (test-locked): the node system takes LTC through the
  write-only static `RectAreaLightNode.setLTC()` with no
  introspection, so Blendlink's partial/complete/absent ownership
  machine cannot protect shared state there. Revisit only if three
  grows a getter.
- ~~R3F device-lost~~ — `subscribeRendererLoss()`: the WebGPU family
  chains the renderer's public `onDeviceLost` hook (both its backends
  route loss there); classic WebGLRenderer keeps `webglcontextlost` +
  the synchronous probe.
- ~~Transparency guard~~ — the look layer reads WebGPURenderer's
  public `alpha` flag when `getContextAttributes` is absent; the
  silent pass is gone.
- Templates/scaffolds emitting WebGPURenderer construction (+ the
  Canvas gl-factory consumer docs): DEFERRED to the examples-migration
  step (sequencing step 4) — scaffolding WebGPU renderers while the
  production post pipeline is still the pmndrs WebGL stack would ship
  a mismatch. Track B unblocks it.

## Track B — post pipeline (RenderPipeline behind the same interface)

STATUS: **LANDED 2026-07-28** (763865e owned nodes, 8a8b57b service,
7f06970 browser-truth cells + measured TRAA-first contract, 9fdc1ff all
eleven effect types incl. production DoF semantics and color grading).
`ThreeWebgpuPostPipelineService` renders 10/10 service cells beside
19/19 per-effect cells on both WebGPU backends. Named residue: bloom
threshold operates on HDR pre-tonemap values (pmndrs luminance 0.9
convention differs — needs a look sign-off pass on a real scene),
Lut3DNode is trilinear (no tetrahedral interpolation), n8ao
beautyTexture references the raw scene target while beautyNode is the
TRAA-resolved chain (size/format reference only — watch), and the
kuwahara quality knobs rebuild at finalize rather than live-update.

`ThreePostPipelineService` is reimplemented on
`THREE.RenderPipeline` + TSL effect nodes behind the unchanged
`PostPipelineService` interface. What the census corrected in the old
plan:

- **Five Blendlink-owned TSL nodes, not three** — SHIPPED 2026-07-27
  as `blendlink/three/tsl-effects` (tslPostEffects.ts), all measured
  19/19 in WGPU-NODE-001 on both backends (cross-backend ≤ 0.015 mean
  luma; vignette/tilt-shift within 2 luma of the pmndrs control):
  vignette, tilt-shift, kuwahara — PLUS radial chromatic aberration
  (the shipped default is a custom radial GLSL effect with
  center/aspect math; ChromaticAberrationNode covers only the
  directional mode) and geometry-aware pixelation (the shipped variant
  consumes a shared normals pass with 0.82 edge darkening;
  PixelationPassNode is a self-rendering pass). Remaining Track B
  work: the RenderPipeline-backed PostPipelineService itself plus the
  authored-parameter mappings (bloom threshold, DoF units, n8ao
  config) and the AA/reporting re-spec.
- **Direct mappings** (6): Bloom→BloomNode, directional
  CA→ChromaticAberrationNode, CAS→SharpenNode, Outline→OutlineNode,
  LUT→Lut3DNode (loaders stay), DoF→DepthOfFieldNode.
- **AO is a named product decision**: N8AO→GTAONode would change
  appearance on every scene using `blendlink.ambient-occlusion`.
  DECIDED 2026-07-27: keep the N8AO look via `n8ao-webgpu` (see the
  signed-off decisions below); appearance continuity wins over
  in-tree-ness because CC0 licensing makes the dependency vendorable.
- **Anti-aliasing policy is net-new** (unaddressed before): the current
  pipeline owns MSAA policy plus a final SMAA pass and reports
  `antialiasingSamples`/`postEdgeAntialiasingPreset`. Proposed: TRAA
  default with FXAA fallback (both in-tree TSL), and the reporting
  contract re-specified alongside the new `postprocessingOrder`
  synthetic ids ('scene-normals' and 'tone-mapping' entries disappear;
  the node output pass replaces tone-mapping ordering machinery).
- **Selective bloom needs a masking design**: BloomNode alone cannot
  express SelectiveBloomEffect; design an emissive/MRT mask before
  promising parity.
- **What transfers**: the POST_RENDERER_STATE ownership lease and the
  detached staging/rebind protocol (activate/setMainScene semantics)
  are Blendlink-owned contracts and carry over; pmndrs fusion does not
  (effects compose as one TSL graph natively).

## Track C — materials: applying the shipped IR

STATUS 2026-07-28: five parts LANDED — the BuildTslOptions application
surface (07c02b3: objectSpace basis swizzle, uvChannel/colorAttribute
resolvers, texture_ref builder op, resource disposal, scalar entry),
the mesh-level `blendlink_tsl_runtime` extras with the vertex-color
refuse-by-name check (9bea52a), the materials.json programs sidecar
publication (baa3181), its full descriptor threading with integrity
verification (9b6a921), and `installTslMaterials` on
`blendlink/three/tsl-materials` (77085d9). Remaining: texture_ref
EMISSION (the route-level source-image-to-GLB-slot wiring), the GLB
differential cell (browser ground truth), the onObjectUpdate cell, the
onBeforeCompile/contact-shadow node conversions, and installer wiring.

The consumer for `blendlink_tsl_ir`, designed against the census:

- **Seam**: new `packages/blendlink/src/tslMaterialRuntime.ts`, shaped
  like threeMaterialCarriers (traverse → group → verify → reversible
  mutate → dispose), registering clones through `trackMaterialClone`.
- **Identity by extras, never names**: loaded materials are matched via
  `userData.blendlink_source_material` /
  `blendlink_material_rule` (the pattern threeMaterialCarriers.ts:90
  already uses). GLTFLoader clones and typegen dedup make names
  diagnostic-only.
- **Per-channel hybrid application**: one `MeshStandardNodeMaterial`
  per (material × uv-signature × texspace-class); channels with IR get
  nodes (colorNode/roughnessNode/metalnessNode/opacityNode), channels
  with `tslIrRefusal` keep their shipped carrier (factor value or baked
  texture) — routes never change.
- **Program transport**: a fetched `<scene>.materials.json` sidecar
  referenced from the descriptor as `materialPrograms {url, hash,
  bytes}` (environmentAsset pattern); never inline IR into the module
  (256 KB/channel budget). `tslIrHash` pins content.
- **Exporter prerequisites** (do these first): emit per-mesh
  `texspace_location/size` extras; publish the per-binding
  uvName→TEXCOORD map (already computed and GLB-attested in
  `_uv_descriptor` — it just isn't published); verify the vertex-color
  layer is the exported COLOR_0 or refuse by name (a real gap today —
  silent uv(0)/COLOR_0 sampling for named layers must fail loudly).
  SEAM MAP (2026-07-28, for implementation): the ownership-extras
  pattern is Blender custom properties on the generated material
  (material_compiler.py:3558 `generated["blendlink_source_material"]`)
  flowing to glTF extras via the stock exporter, then re-verified
  post-export against the document dict (4825-4836). The exported
  document is patched/verified in the `_resolve_generated_material`
  phase (4181+) — mesh-level `blendlink_texspace` extras can be
  stamped there from `mesh.texspace_location/size` for bindings whose
  channel IR contains a `generated` op, keeping user mesh data
  untouched. `_uv_descriptor` (1237) already resolves layer name AND
  index per binding; its result currently rides only the private
  `materialization` dict (6035-6041 `uvDescriptor`) — publication
  means copying `{name, index}` into the per-binding channel-plan
  records that reach sceneDiagnostics (the `tslIr*` threading pattern
  from _attach_tsl_ir). The BuildTslOptions consumer side
  (uvChannel/colorAttribute/textures/objectSpace/resources +
  buildTslScalarNode) landed in 07c02b3 and is ready for these.
- **BuildTslOptions growth** (harness defaults stay byte-identical):
  `objectSpace: {basis: 'blender-z-up' | 'gltf-y-up'}` (the measured
  swizzle vec3(x, −z, y), to be proven by a cell against a real
  GLB-loaded mesh, skinned/instanced excluded initially);
  `uvChannel(uvMap) => index`; `colorAttribute(layer) => name`;
  `textures(ref) => Texture`; plus a scalar-output build entry (the
  current export broadcasts to vec3) and a per-document DataTexture
  cache with disposal (today every build call allocates).
- **Texture transport**: replace the >128² refusal with a
  `texture_ref` IR op resolved at build time; wire source images into
  the generated material's GLB texture slots so KTX2 codec selection,
  sampler attestation, and the shared loader decode are reused — the
  runtime resolver steals the decoded texture from the loaded slot.
  Named fidelity notes: KTX2 lossiness, hardware filtering vs the
  byte-exact manual-bilinear oracle at texel edges, and the measured
  byte-space alpha association (pre-associate at publish).
- **Per-object values**: prove `uniform().onObjectUpdate` with a gated
  cell on 0.184; until then, fork node materials per mesh containing
  generated/object_coords (consistent with MTL-CONS-003 populations).
- **GLSL seams become node graphs**: the four onBeforeCompile sites
  (ADR 0006) plus contact shadows' blur ShaderMaterials (MaxEquation
  blending re-verified on WebGPU).

## Sequencing

0. Track 0 harness (per-effect fixtures + WebGL2-fallback measurement).
1. Track A retype + behavior seams.
2. Track B pipeline with fixtures gating each effect; GTAO/AA decisions
   signed off.
3. Track C exporter prerequisites → tslMaterialRuntime → texture_ref →
   basis/onObjectUpdate cells.
4. Examples migrate (WebGPURenderer construction + R3F gl factory);
   the examples CI gate grows a pixel check.
5. v1.0: default runtime flips, pmndrs deps leave, package gate flips.

## Decision points — signed off 2026-07-27

1. **AO: N8AO** (user decision, superseding the GTAO recommendation on
   quality grounds). Ship via the author-endorsed `n8ao-webgpu`
   adaptation (CC0-1.0, peer `three@^0.182`, composes into the
   node-based PostProcessing chain). The CC0 license is the drift
   hedge: the pass is small enough to vendor as a Blendlink-owned TSL
   node the moment it lags a pinned three release, and the Track 0
   per-effect fixture harness gates it like every other effect.
   GTAONode remains the documented in-tree fallback.
2. **AA default: TRAA**, with SMAA-TSL/FXAA selectable.
3. **v1.0 boundary**: as recommended — the WebGPU runtime becomes the
   default at v1.0, when the pmndrs `postprocessing`/`n8ao` WebGL
   stack leaves the dependency graph and the package gate flips.
