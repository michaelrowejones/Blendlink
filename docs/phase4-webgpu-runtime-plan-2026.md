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

No committed CI gate renders browser pixels today: unit tests mock the
renderer, the baked e2e verifies Blender output, and the examples gate
only compiles. Until fixtures exist, the port could regress all 11
effects with every suite green.

1. Extend `experiments/wgpu-postprocessing-parity` into the per-effect
   fixture harness: it already renders the WebGL control for all 13
   configurations and hashes pixels; reuse
   `experiments/tsl-node-differential/main.js`'s proven
   init/renderAsync/readRenderTargetPixelsAsync pattern for the WebGPU
   side.
2. Measure the WebGL2 fallback backend explicitly (`forceWebGL: true`)
   — the "no device-support reduction" premise depends on it.
3. Promote the harness into a registered browser-pixel CI gate.

## Track A — renderer core (mechanical first, behavior second)

Retype-first commit: `assertWebGLRenderer`
(threeRuntime.ts:2918-2925, called at 1417/1623/2015) becomes a
structural renderer acceptance including WebGPURenderer, and
threeRuntime.test.ts:1323's rejection assertion inverts in the same
commit. Then the behavior seams, each a named sub-task (none were in
the old plan doc):

- KTX2 wiring: `detectSupport(renderer)` after `await renderer.init()`
  (createOwnedKtx2Loader, threeRuntime.ts:2806-2827; fix the error
  copy at 2822).
- PMREM probe capture (threeRuntime.ts:913) on the WebGPU path.
- RectAreaLight LTC init (threeRectAreaLights.ts LTC state machine
  328-383 + `instanceof WebGLRenderer` peer check 443-446).
- R3F: replace the `webglcontextlost` listener
  (reactThreeFiber.ts:412-421) with device-lost handling; document the
  Canvas gl-factory WebGPU pattern for consumers.
- `RendererLookLike` transparency guard: `getContextAttributes?.()` is
  absent on WebGPURenderer so the alpha check silently passes — make
  the absence explicit.
- Templates/scaffolds (preview.ts, previewStudioHost.ts,
  projectSetup.ts) emit WebGPURenderer construction including
  `await renderer.init()`.

## Track B — post pipeline (RenderPipeline behind the same interface)

`ThreePostPipelineService` is reimplemented on
`THREE.RenderPipeline` + TSL effect nodes behind the unchanged
`PostPipelineService` interface. What the census corrected in the old
plan:

- **Five Blendlink-owned TSL nodes, not three**: vignette, tilt-shift,
  kuwahara — PLUS radial chromatic aberration (the shipped default is
  a custom radial GLSL effect with center/aspect math;
  ChromaticAberrationNode covers only the directional mode) and
  geometry-aware pixelation (the shipped variant consumes a shared
  normals pass with 0.82 edge darkening; PixelationPassNode is a
  self-rendering pass).
- **Direct mappings** (6): Bloom→BloomNode, directional
  CA→ChromaticAberrationNode, CAS→SharpenNode, Outline→OutlineNode,
  LUT→Lut3DNode (loaders stay), DoF→DepthOfFieldNode.
- **AO is a named product decision**: N8AO→GTAONode changes appearance
  on every scene using `blendlink.ambient-occlusion`. The
  author-endorsed `n8ao-webgpu` port exists as the continuity
  alternative. DECISION REQUIRED before Track B lands: accept the GTAO
  look (with side-by-side fixture evidence) or adopt n8ao-webgpu.
  Recommendation: GTAO, staying in-tree — but it is an appearance
  change and must be signed off, never silent.
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

## Decision points requiring sign-off

1. **AO**: GTAONode (recommended; in-tree, but a look change) vs
   n8ao-webgpu (continuity, new dependency).
2. **AA default**: TRAA (recommended) vs SMAA-TSL vs FXAA-only.
3. **v1.0 boundary**: when the WebGPU runtime becomes default.
