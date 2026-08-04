# Generated progressive meshes — implementation design (2026-08-04)

Status: design. Nothing here is implemented. `NDL-PRG-001` and `NDL-PRG-002`
are the largest remaining true capability gap against Needle Engine
(`docs/FEATURE_PARITY.md:182`), and this document says how to close the part
of it that can be closed honestly, what cannot be closed at all, and what
each step is allowed to claim.

Every code fact below was re-read against HEAD on 2026-08-04 and carries its
file and line. Where the measured design input disagreed with the code, the
correction is stated in §3 rather than silently applied. Nothing in this
document contains a number that was not read out of a file.

---

## 1. What Needle actually does, and why there is no differential

The repo's own behavioral baseline already measured the capability, so this
section restates the ledger rather than re-researching it.

- **Build pipeline 3.0.0** defaults `textures.lods` and `meshes.lods` to
  true. It emits a *simplified embedded mesh* inside the main GLB plus
  content-identified per-mesh GLB companions carrying hash and density
  metadata (`docs/TECHNIQUE_LEDGER.md:151`, evidence tag `[N-PRG1]`, sources
  `extensions/NEEDLE_progressive.py` and
  `src/engine/extensions/NEEDLE_progressive.ts`,
  `docs/research-needle-behavioral-baseline-2026.md:468` and `:765`).
- **`@needle-tools/gltf-progressive` 3.6.0-beta.2** inspects render lists,
  computes projected screen density and device pixel ratio, queues requests,
  and swaps individual mesh and texture resources as they settle
  (`docs/TECHNIQUE_LEDGER.md:152`, `docs/research-needle-behavioral-baseline-2026.md:469`).
- **No abort signal was found at the inspected progressive request seam**
  (`docs/research-needle-behavioral-baseline-2026.md:471`). Needle coalesces,
  queues, ignores stale slot requests, weakly retains low tiers, and
  reference-counts — but the cancellation story is not one this repo can
  copy, because it was not observed.

**The differential is impossible and will stay impossible.** The pinned build
pipeline 3.0.0 is CLI-only and JWT-gated, and has not run end-to-end in the
pinned stack (`docs/TECHNIQUE_LEDGER.md:151`,
`docs/FEATURE_PARITY.md:182`). Every other capability in the parity ledger
that reached Match or Better did so through a *coherent same-camera Needle
differential*. This one cannot. The consequence is structural, not
scheduling:

> The acceptance evidence for generated progressive meshes must be
> **self-standing**, not comparative. Determinism, decoded geometry gates,
> refusal coverage, and same-camera Blendlink-versus-Blendlink bytes and
> pixels are the whole case. That is a genuinely weaker claim than parity,
> and the ledger must say so as a *recorded constraint*, not as a pending
> task.

This is the same honesty shape `docs/FEATURE_PARITY.md:136` already uses for
authored distance LOD ("Core/Adapter implementation is shipped. A same-camera
coherent-Needle differential must still prove …"), except that there the
differential is merely unbuilt; here it is unavailable.

**One design divergence is forced and is the largest in this document.**
Needle embeds the *simplified* mesh and treats full detail as the progressive
upgrade. Blendlink must invert that: embed **Final**, publish tiers as opt-in
**downgrades**. The reason is measured, not aesthetic — the atlas-tier
dogfood proved that implicit DPR-1 selection could halve Wall from 222.7 to
about 111.35 px/m, and the conclusion written into the ledger is that a
future recommendation "may improve `adaptive`, but cannot silently weaken
Final" (`docs/FEATURE_PARITY.md:152`). Copying Needle's artifact shape would
make every Blendlink scene ship degraded geometry by default. So "parity"
here can never mean "same artifact shape", and the ledger row should say
that too.

---

## 2. What Blendlink already has

### 2.1 The selector exists and is ownership-safe

`packages/blendlink/src/lodRuntime.ts` is a complete LOD selector whose
entire public surface is three types and one function:

- `CompiledSceneLodOptions { createVector3(): LodVectorLike; hysteresis?: number }` (:25-30)
- `CompiledSceneLods { active: Record<string, number>; update(): void; stop(): void }` (:32-37)
- `startCompiledSceneLods(root, camera, descriptor, options): CompiledSceneLods | null` (:91-96)

It is **purely distance-driven and index-discrete**. There is no projected
density, no tier bytes, and no asynchronous arrival anywhere in it. What it
*does* already have is every ownership property a tier system needs:

- refuses to start on any invalid chain, naming base and warnings (:99-105);
- binds levels by rename-stable `blendlink_id` before falling back to loaded
  name (:118), with duplicate-ID detection (:59);
- records whether `visible` was an own property before taking ownership
  (:139-143);
- `stop()` restores conditionally, so a later owner is not clobbered
  (:169-172);
- restores unconditionally and rethrows if the first `update()` throws
  (:179-184).

The anti-thrash law is asymmetric and reusable as-is: promote requires
`distance >= threshold * (1 + hysteresis)`, demote requires
`distance < threshold * (1 - hysteresis)`, default 0.05, validated loudly to
`0 <= h < 0.5` (:76-83, :109-112).

Chains arrive through `resolveRuntimeSceneDiagnostics(descriptor).lodChains`
(`runtimeDiagnostics.ts:53`, :23), which already refuses unknown schema
versions rather than falling back to stale evidence (:56-72).

### 2.2 The simplifier is already installed

No new dependency is required.

- `packages/blendlink/package.json` pins `@gltf-transform/functions` at
  exactly `4.4.1` and `meshoptimizer` at `^1.2.0`; the installed versions are
  4.4.1 and 1.2.0.
- `optimizer.ts:16` imports seven functions from `@gltf-transform/functions`
  (`dedup, inspect, prune, quantize, reorder, resample, weld`) and simply
  does not import `simplify`.
- `optimizer.ts:17` already imports `MeshoptDecoder, MeshoptEncoder` from
  `meshoptimizer`, so driving `MeshoptSimplifier` from the same package is an
  established pattern, not a new one.

`node_modules/meshoptimizer/meshopt_simplifier.d.ts` exposes `simplify`,
`simplifyWithAttributes`, `simplifyWithUpdate`, `simplifySloppy`,
`simplifyPoints`, `simplifyPrune`, `compactMesh`, `generatePositionRemap`,
and `getScale`, with flags
`'LockBorder' | 'Sparse' | 'ErrorAbsolute' | 'Prune' | 'Regularize' | 'Permissive' | 'RegularizeLight'`.

### 2.3 Final is lossless by construction, and the gates say so

`optimizeMeshopt` cannot host simplification. Four of its own verification
gates reject it by construction:

| gate | line | what it forbids |
| --- | --- | --- |
| rendered TEXCOORD value + format equality | `optimizer.ts:1097-1100` | any change to UV bytes |
| scene rendered-vertex-count equality | `optimizer.ts:1109-1114` | any vertex removal |
| primitive-count equality | `optimizer.ts:252-256` | any primitive disposal |
| morph-target-count equality | `optimizer.ts:273-275` | any target loss |

That is not an obstacle to route around. It is the repo stating that Final
stays lossless and that tiers must be a **separate artifact**.

Two reusable pieces come out of the same file:

- `verifySceneBounds` is exported (`optimizer.ts:65-71`) with a
  scale-relative tolerance `max(1e-6, diagonal * 1e-4)` (:81). A tier gate
  wants the same shape with a **declared, looser** tolerance, because a tier
  is legitimately lossy.
- `refusePass(reason)` (`optimizer.ts:922-925`) pushes an actionable string
  into `passes.skipped` *and* warns on the console; the field is documented
  as "Optional passes refused for this asset, with an actionable reason for
  each refusal" (`optimizer.ts:46-47`).

And a policy tiers must inherit: every `TEXCOORD` is excluded from
quantization so baked atlas UVs stay exact Float32
(`optimizer.ts:1004-1006`, :1029-1031).

### 2.4 The tiered-artifact precedent

`packages/blendlink/src/atlasDelivery.ts` is the nearest shipped shape. Its
governing law is at :53-56 — "The source remains published as the
conservative fallback and incremental-bake identity; generated runtime
recipes may prefer this derivative." A derivative that is not smaller is
skipped loudly with a byte-count reason rather than published (:127-133).

The record it publishes is
`TextureDeliveryVariant { url, format, width, height, bytes, hash, lossless: true }`
(:16-26) and the report is
`AtlasDeliveryReport { format, encoder, inputBytes, outputBytes, savedBytes, ratio, entries, skipped }`
(:40-49).

### 2.5 The runtime tier policy vocabulary

`bakedRecipe.ts:278` defines `BakedAtlasDeliveryQuality = 'authored' | 'adaptive' | number`,
default `'authored'`. `'authored'` resolves to `Number.POSITIVE_INFINITY`
(:590-593), which selects the highest advertised tier — the default can never
silently downgrade Final. `'adaptive'` derives from viewport, DPR clamped to
1..2, `saveData`, and `deviceMemory`, floored at 256 (:575-588). Selection is
"smallest advertised tier at or above desired, else the largest" (:604-611).

### 2.6 The publication graph

- Exactly one entry may carry role `'scene'`; `assetUrls.ts:36-41` throws
  otherwise, and `createSceneAssetGraph` throws at
  `sceneAssetGraph.ts:307-309`.
- Roles are `'scene' | 'companion' | 'basis-runtime'` (`sceneAssetGraph.ts:5`).
- `<scene>/<full-sha256>/` addressing is enforced by asserting the last path
  segment equals the graph fingerprint (`assetUrls.ts:147-152`), and
  `BLENDLINK_IMMUTABLE_CACHE_CONTROL` (`assetUrls.ts:3-4`) is granted only
  beneath that prefix. Any file that becomes a graph entry inherits
  `public, max-age=31536000, immutable` for free, and any byte change in it
  rotates the whole scene fingerprint (`sceneAssetGraph.ts:324-340`).
- `inspectCompilerStagingDirectory` (`sceneAssetGraph.ts:194-267`) refuses
  any undeclared staged file: "Unexpected undeclared compiler-owned staged
  file" (:249). Files must be declared through `declaredStagePaths`
  (`sync.ts:1359-1365`) or the publish refuses.

### 2.7 The density unit already exists

`invoke.ts:209-211` documents `screenDensity` as "px/m × distance — equal
values = equal perceived quality", and `cli.ts:717` prints exactly that
sentence beside the bake plan. A tier threshold expressed in any other unit
gives the artist two incomparable numbers.

### 2.8 Per-loop atlas UV evidence is already published

`invoke.ts:233-252` publishes `atlasLayout` — compressed, topology-checked
corner UVs from the exact pack that ships, per object, with `topologyHash`,
`loopCount`, and `uvHash`, in space `'blender-pack'` or
`'final-glb-decoded'`. This is the data needed to derive atlas-island
membership without re-deriving island topology.

---

## 3. Corrections the code forced on the design input

The measured design input at
`scratchpad/recon/02-generated-progressive-meshes-ndl-prg-001-002-imple.md`
was accurate on most claims. Six are corrected here. Two of the corrections
make the work **easier**, which matters: an over-pessimistic prior would
have bought machinery the repo does not need.

**C1 — meshoptimizer's `simplify` is not UV-blind. It is UV-*metric*-blind.**
The input says the position-only path has "zero knowledge of UVs". The
primary source disagrees. `node_modules/meshoptimizer/README.md`, Simplifier
section: "While the algorithm doesn't use other attributes like
normals/texture coordinates, it automatically recognizes and preserves
attribute discontinuities based on index data." On a welded mesh a UV seam
*is* an index-level discontinuity — two distinct vertex indices at one
position — so the simplifier sees the atlas island boundary topologically
and tries to preserve it. What it lacks is any *metric* notion of UV stretch
inside an island. This does not remove the gutter-crossing question; it
changes its prior. Crossing an island boundary requires the simplifier to
defeat its own seam handling, not merely to be ignorant of the seam. "Tries
to preserve" is still not "guarantees", so the measurement in Phase 0 stands
— but the expected answer is now "few or zero", and `simplifyWithAttributes`
with a UV lock moves from *probable requirement* to *fallback*.

**C2 — `simplifyPrimitive` requires a welded, indexed primitive and will
throw on an unindexed one.** `dist/index.js` reads
`const srcIndices = prim.getIndices(); let indicesArray = srcIndices.getArray()`
with no null check. The document-level `simplify()` transform gets away with
it because it runs `await document.transform(weld({ overwrite: false }))`
first. Blendlink's Final GLB is normally welded at `optimizer.ts:963`
(`weld({ overwrite: true })`) — but weld is a *refusable* pass with two
documented refusal paths (`optimizer.ts:954` for
`KHR_mesh_primitive_restart`, `:957` for an invalid primitive). A tier
compiler therefore must not assume weldedness. It must check for indices and
refuse by name, never weld silently. The README is explicit about why this
matters beyond the crash: "it's critical that identical vertices are 'welded'
together … for the algorithm to function well, the mesh vertices should be
unique."

**C3 — `simplifyPrimitive` silently narrows the index component type.**
After compaction it runs `if (dstVertexCount <= 65534) prim.getIndices().setArray(new Uint16Array(...))`.
That is a format change the tier report should record rather than discover.

**C4 — role `'companion'` is assigned automatically; `SceneAssetRole` needs
no edit.** The input listed `sceneAssetGraph.ts:5` as a hand-maintained
enumeration that must move in lockstep. It does not.
`sync.ts:1525-1529` assigns `'scene'` to the configured GLB,
`'basis-runtime'` under the KTX2 transcoder directory, and `'companion'` to
**everything else**. Tier GLBs become companions with zero code.

**C5 — one of the two "silent 404 in production" risks is actually loud.**
The input warns that omitting a wiring site "publishes UNADDRESSED tier URLs
that 404 only in production". For the *staging* half that is false:
`inspectCompilerStagingDirectory` refuses undeclared staged files outright
(`sceneAssetGraph.ts:248-250`) and `sync.ts:1517-1519` additionally proves
the declared GLB was produced. The genuinely silent site is the *other* one
— `assetUrls.ts:210-222`, the graph backstop, which absorbs any unclassified
companion URL and loses its typed classification, so a browser smoke would
report a generic graph-entry failure instead of "mesh tier for object X".
That is worth a regression test; it is not worth a production-outage warning.

**C6 — the wiring-site count is larger than four, and larger than seven.**
The task named four sites. The input raised it to seven. The nearest
precedent — `textureVariants` — occupies **fifteen TypeScript sites and two
Python sites**, verified by enumeration at HEAD. See §7. The input's
recommendation to compute tiers **in `sync`, from the finished GLB**, rather
than in the exporter, is correct and removes two of them (`ExportResult` and
the invoke mapping) outright. This design adopts that recommendation, which
means the four sites named in the task collapse to a different, larger set —
and §7 names all of them.

---

## 4. The hard parts

Each is stated as a question, with a proposed answer and the measurement that
would settle it. None of the proposed answers is asserted as fact.

### 4.1 Does a simplified mesh still sample the SAME baked atlas?

**Why it is not the obvious problem.** The naive fear is that simplification
re-parameterizes the mesh and invalidates the bake. That is false, and the
reason is in the dependency: `compactPrimitive` remaps every attribute *and*
every morph target through one src→dst vertex remap
(`@gltf-transform/functions/dist/index.js`, `compactPrimitive`), so a
surviving vertex keeps its **exact original** TEXCOORD value. meshopt's own
contract says the same thing: "The index buffer can be used to render the
simplified mesh with the same vertex buffer(s) as the original one, including
non-positional attributes." Attributes survive by **selection**, not by
re-fitting. Surviving vertices sample identical texels.

**The actual failure is gutter-crossing.** A collapsed edge can produce a
triangle whose three UV corners lie in two different atlas islands. That
triangle interpolates across the pack gutter and samples a neighbouring
island's pixels. It is invisible to vertex-level equality checks and
invisible to bounds checks. It is only detectable by a per-triangle
island-membership test.

**Proposed answer.** Type the published field as the literal `0`:

```ts
gutterCrossings: 0
```

so the type system itself forbids publishing a tier that samples across an
island. Any nonzero count is a refusal, named per object, not a warning.

**Measurement.** Phase 0 cell. For each mesh in
`docs/demo-corpus-inventory.json` (11 scenes at HEAD), decode the shipped
GLB, derive island membership from the published `atlasLayout` evidence
(`invoke.ts:233-252`), simplify at a swept ratio, and count output triangles
whose three TEXCOORD corners are not all inside one source island. Report the
ratio at which the count first becomes nonzero, per mesh. Given C1, the
expected result is that position-only `simplify` already holds the seam; if
it does, `simplifyWithAttributes` is not needed for correctness and Phase 1's
effort estimate does not double.

### 4.2 Skinning weights

**Question.** Can a tier be generated for a skinned mesh?

**Proposed answer: refuse, and sequence any future attempt strictly after
pending task #4.** Two independent reasons.

1. The collapse metric sees only the base POSITION array — the rest pose.
   `compactPrimitive` then carries surviving JOINTS/WEIGHTS through verbatim,
   so the weights are *exact* but the vertices chosen to survive were chosen
   for a pose the character is rarely in. meshopt offers `'Regularize'`,
   documented as improving "geometric quality under deformation such as
   skinning" — that is a mitigation, not a proof.
2. Pending task #4, the bind-pose integrity proof, is not done. Publishing
   *derived* skinned geometry before there is any way to prove the derivation
   preserved the bind pose would be shipping an unprovable artifact.
   `docs/character-routes-and-deformation-2026.md` is the governing plan for
   that axis and it does not currently contemplate derived geometry.

**Measurement, if it is ever revisited.** Maximum per-vertex world deviation
between the Final skinned mesh and the tier skinned mesh, evaluated over
every frame of every shipped clip, expressed as a fraction of bbox diagonal
— the exact unit `docs/character-routes-and-deformation-2026.md:41-48`
already uses. Refuse above a declared threshold. Do not attempt this before
#4.

### 4.3 Morph targets

**Question.** Can morph targets survive simplification?

**Proposed answer: refuse permanently with the installed simplifier. This is
unfixable, not merely hard.** The collapse metric sees only the base
positions, so it preferentially removes vertices in regions that are flat
*at rest* — which is exactly where a morph that lifts or creases a flat area
does its work. `compactPrimitive` then carries the surviving deltas through
verbatim (it remaps `prim.listTargets()` attributes through the same remap),
so the tier is **silently wrong** rather than loudly broken. Silent
wrongness is the failure mode this repo refuses by policy.

`simplifyWithAttributes` could in principle weight morph deltas as
attributes. That is a research question, not a phase. Do not scope it.

### 4.4 Material boundaries

**Question.** Can a collapse merge across a material boundary, and can
primitives of one mesh crack apart?

**Proposed answer.** Cross-material collapse **cannot** happen: glTF already
splits distinct materials into distinct primitives, and per-primitive
simplification cannot see across that boundary. The residual risk is the
**seam between primitives of one mesh** — each is simplified independently
with no shared border constraint, so a shared edge can crack open.
`lockBorder: true` (meshopt `'LockBorder'`) addresses this by locking
topological-border vertices, at a cost in reduction.

**Measurement.** Phase 0 cell, variant (b): sweep ratio with and without
`LockBorder` on multi-primitive meshes in the corpus and record surviving
triangle count for each. If `LockBorder` over-constrains to the point of no
useful reduction, multi-primitive meshes become a refusal rather than a
tiered mesh. Do not guess which; the cell is cheap.

### 4.5 Does the simplifier preserve attribute seams?

This is 4.1 and 4.4 restated as one question about the dependency's own
promise, and it deserves its own answer because C1 changed it. The
documented behavior is that `simplify` "automatically recognizes and
preserves attribute discontinuities based on index data", and that
`simplifySloppy` explicitly "doesn't preserve attribute seams or borders".

**Proposed answer.** `simplifySloppy` is refused outright and named in a
comment at the import site. `simplify`'s seam preservation is *trusted only
as far as it is measured* — the gutter-crossing count in Phase 0 is the
measurement, and the `gutterCrossings: 0` literal type is the enforcement
that does not depend on trusting it.

### 4.6 Determinism

**Question.** Is `MeshoptSimplifier` byte-deterministic across platforms?

**Why it is load-bearing, not a nice-to-have.** Every tier byte enters the
scene fingerprint (`sceneAssetGraph.ts:324-340`). A nondeterministic
simplifier rotates the fingerprint on every sync and destroys incremental
reuse — `docs/MANIFEST.md:630-634` already records that a missing or changed
tier rebuilds the whole safe atlas job. Nondeterminism would therefore show
up as a build-time regression, not as a correctness bug, which is the kind
that gets misattributed.

**Measurement.** Phase 0, and it must be Phase 0 rather than Phase 1: same
input GLB + same ratios ⇒ byte-identical tier companions and identical
sha256s across two runs on two machines. This is also the *substitute* for
the impossible Needle differential (§1) and must be labelled as the weaker
claim it is.

---

## 5. Phased plan

Each phase is independently shippable and names its evidence gate in the
units this repository actually uses: a **measured cell**
(`experiments/<name>/`), a **vitest file**
(`packages/blendlink/src/<name>.test.ts`, auto-discovered by
`packages/blendlink/scripts/run-vitest.mjs`), a **headless addon check**
(`packages/blender-addon/tests/<name>_check.py` printing a `BLENDLINK_*`
sentinel, discovered by `run_headless.py`), or a **browser gate**
(`experiments/<name>/run.mjs` plus a root `test:<name>` script). The root
`package.json` registers 15 such browser/differential gates today; note that
**none of them is in `test:full`** — `test:full` runs unit, real-toolchains,
consumer-builds, examples, package, dogfood-identity, addon-headless, and
baked-e2e.

### Phase 0 — measure before designing

**Deliverable.** `experiments/meshopt-tier-seam-cell/run.mjs`, sibling of
`experiments/atlas-packing-probe` and `experiments/blender-52-exporter-cells`.
Writes nothing into `packages/`. Not registered in `test:full`; emits JSON to
`experiments/meshopt-tier-seam-cell/output/`.

**What it runs.** On every baked scene in `docs/demo-corpus-inventory.json`
(11 at HEAD), three variants of the same primitive at a swept ratio:

- (a) `simplifyPrimitive` position-only, the shipped 4.4.1 path;
- (b) the same with `lockBorder: true`;
- (c) direct `MeshoptSimplifier.simplifyWithAttributes` passing the atlas
  TEXCOORD as `vertex_attributes` with a swept `attribute_weight` and a
  `vertex_lock` mask derived from `atlasLayout` island boundaries.

**Recorded per (scene, mesh, ratio, variant).** Surviving vertex and triangle
count; max and RMS position error against the source, reported in the same
`max(1e-6, diagonal * 1e-4)` unit `verifySceneBounds` uses so the number is
comparable to Final's tolerance; **gutter-crossing count**; decoded byte size;
and whether the index component type narrowed (C3).

**Evidence gate.** The acceptance criterion is *that it produces the numbers*,
not that the numbers are good. Specifically: the gutter-crossing count per
(scene, ratio, variant), the `LockBorder` reduction cost on multi-primitive
meshes, and the two-machine determinism comparison from §4.6.

**Effort.** Two measured cells — one corpus sweep, one weight/ratio sweep.
No shipping code. This is the cheapest possible way to learn whether Phase 1
is legal, and it is the only phase that must happen before committing to
anything below.

### Phase 1 — the artifact, with no runtime switching

**Deliverable.** `packages/blendlink/src/meshTiers.ts` — a new module,
deliberately *not* inside `optimizer.ts` (§2.3), sibling of
`atlasDelivery.ts`. Exports
`compileMeshTiers(glbPath, options): Promise<MeshTierReport | null>`, modelled
on `compileAtlasSidecarDelivery` (`atlasDelivery.ts:108`). It reads the
**final post-`optimizeMeshopt` GLB** and writes a separate companion GLB per
eligible mesh per requested ratio, leaving the Final GLB byte-identical.

Because `optimizeMeshopt` writes back in place (`optimizer.ts`, staged
`writeFileSync` + `renameSync`) and applies `EXTMeshoptCompression`, the tier
compiler must read through a `NodeIO` with `MeshoptDecoder`/`MeshoptEncoder`
registered — exactly as `atlasDelivery.ts:169-175` already does.

**Record shape.** Mirror `TextureDeliveryVariant` and substitute the honest
fields:

```ts
export interface MeshTierVariant {
  url: string
  ratio: number
  renderVertices: number
  renderTriangles: number
  bytes: number
  hash: string
  maxPositionError: number
  positionErrorTolerance: number
  gutterCrossings: 0
  indexComponentType: number
}
```

Two deliberate omissions versus `TextureDeliveryVariant`: there is **no
`lossless: true`**, because that literal is precisely the claim a mesh tier is
not entitled to make; and `gutterCrossings` is typed as the literal `0` so the
type system forbids publishing a tier that samples across an island (§4.1).
`positionErrorTolerance` is recorded so the looseness relative to Final's
`max(1e-6, diagonal * 1e-4)` is **inspectable rather than assumed**.

Report shape mirrors `AtlasDeliveryReport`:
`{ generator: 'meshoptimizer', inputBytes, outputBytes, savedBytes, ratio, entries, skipped }`.

**Forbidden call site, in a comment at the import.** Never call the
document-level `simplify()` transform. It disposes any primitive that
simplifies to zero rendered vertices, disposes the owning mesh when its last
primitive goes, and only `logger.warn`s about primitives skipped for
unsupported draw mode. All three are silent data loss and all three violate
the repo's loud-refusal rule. Drive `simplifyPrimitive`, or the raw
`MeshoptSimplifier`, under Blendlink's own refusal policy.

**Opt-in.** Add `meshTiers` to `OptimizationRecipe`
(`sceneRecipe.ts:83`, interface at :205) as an authored array of ratios or
`'none'`, defaulting to `'none'` in `DEFAULT_SCENE_RECIPE`
(`sceneRecipe.ts:239`, currently `optimization: { geometry: 'none', textures: 'none' }`),
parsed and diagnosed in `parseOptimization` (`sceneRecipe.ts:827-849`)
exactly like `geometry`, with a `severity: 'error'` diagnostic naming the bad
path. The stage is then gated in `sync.ts` beside the existing
`if (sceneRecipe?.optimization.geometry === 'meshopt')` at `sync.ts:1352-1357`.

**Why the recipe and not a Blender custom property.** The repo rule that
vocabulary/op changes must pass conformance artifacts on *both* parsers
(`packages/blendlink/conformance/vocabulary.json`, `tsl-ir-ops.json`) is
triggered by authored Blender vocabulary, not by recipe JSON. Putting the
knob in the recipe avoids a dual-parser conformance obligation entirely for
Phase 1. **This saving must be stated in the phase-1 commit message** so it
is a recorded decision rather than an oversight: if a future phase adds a
per-object authored tier property, both parsers change and
`vocabulary.json` is regenerated.

**Evidence gates.**

- *Vitest* — `packages/blendlink/src/meshTiers.test.ts`, in the
  `atlasDelivery.test.ts` idiom. Must assert: every refusal in §6 fires with
  the Blender object name in the message; a tier that is not smaller than
  the source is skipped with a byte-count reason rather than published
  (`atlasDelivery.ts:127-133` pattern); **the Final GLB is byte-identical
  before and after `compileMeshTiers`** (hash equality — the strongest
  possible statement of "never silently weakens Final"); and each published
  tier's decoded `maxPositionError` is at or below its declared tolerance.
- *In-module decoded gate, not only in tests* — mirror
  `optimizer.ts:1083-1084`, which re-decodes the bytes that will actually
  ship (`const decoded = await io.readBinary(output)`) before measuring.
  Reuse the exported `verifySceneBounds` for the bounds component.
- *Publication integrity* — extend `sceneAssetGraph.test.ts` and
  `scenePublication.test.ts`: tier companions appear as role `'companion'`
  (automatic per C4), change the scene fingerprint when any tier byte
  changes, and fall under the prefix returned by
  `compiledSceneImmutableAssetPolicy`. Add the C5 regression case:
  `compiledSceneAssetUrls` must name every tier URL through a **typed
  `meshTiers` walk**, not merely through the graph backstop at
  `assetUrls.ts:210-222`.
- *Headless addon check* —
  `packages/blender-addon/tests/mesh_tier_staleness_check.py`, wired into
  `npm run test:addon-headless`. Assert the add-on treats a deleted or
  truncated tier companion as STALE, matching the documented atlas rule at
  `docs/MANIFEST.md:490-492`. `syncstatus.py:675-700` is the pattern to
  follow (it already does this for `textureVariants`, adding a
  `metadata_error` for malformed shapes).
- *Conformance* — not required, by construction, provided the opt-in stays in
  the recipe.

**Do not wire a runtime consumer in this phase.** Phase 1 ships an
inspectable artifact and nothing consumes it. That is a complete, shippable
increment and it is what moves the ledger row from Gap to Partial.

### Phase 2 — runtime selection, reusing the shipped selector

**Deliverable.** Extend `lodRuntime.ts`; do **not** write a second selector.
A generated tier set presents as a synthetic chain bound by the same
`blendlink_id` the base mesh already carries (`lodRuntime.ts:118`), and
`selectedLevel` (:65-83) is driven by projected density instead of raw
distance while keeping the identical asymmetric hysteresis law.

Policy union mirrors atlases exactly:
`MeshTierQuality = 'authored' | 'adaptive' | number`, default `'authored'`,
where `'authored'` resolves to a desired density of `POSITIVE_INFINITY` and
therefore always selects the **full mesh** — the inversion of Needle demanded
by §1.

**Inspectability is a hard requirement, not a nicety.**
`docs/FEATURE_PARITY.md:151` states that quality reduction must remain
inspectable. Render the tier report in `cli.ts` in the same table idiom as
the bake plan (`cli.ts:697-717`): per mesh, the full triangle count, each
tier's triangle count and bytes, the density at which each tier activates in
the same **px/m × distance** unit the plan already prints, and every refusal
reason verbatim. A quality reduction that is not visible in
`blendlink plan` / `inspect` output does not ship.

**Evidence gates.**

- *Vitest* — density-driven `selectedLevel` including the hysteresis dead
  band, and ownership handoff (`stop()` conditional restore) when tiers and
  an authored LOD chain both exist.
- *Browser gate* — `experiments/mesh-tier-density-browser/run.mjs` plus a
  root `test:mesh-tier-density-browser` script, following
  `experiments/graph-deployment-browser-gate/run.mjs` (local HTTP server,
  immutable-header assertions, real Chromium). Must record **four states
  independently per tier crossing: requested, decoded, GPU-resident, and
  presented** — `docs/TECHNIQUE_LEDGER.md:153` is explicit that
  `initTexture` is not GPU completion and not presented-frame evidence, and
  the same distinction applies here. Must cross deterministic density
  thresholds under scripted camera and DPR changes, and must assert
  hysteresis by driving the camera to just inside the dead band and proving
  **no** swap occurs.
- *Same-camera bytes/pixels* — the same gate run twice from an identical
  camera, once with `meshTierQuality: 'authored'` and once with an explicit
  numeric policy. Assert (a) transferred bytes strictly decrease under the
  numeric policy; (b) the `'authored'` run's decoded triangle count equals
  the Final GLB's **exactly**, proving the default did not silently
  downgrade; (c) a pixel differential between the two runs stays within a
  declared, recorded threshold. Reuse the screenshot-comparison harness from
  `experiments/contact-shadows-differential-browser`.

### Phase 3 — on-demand fetch, cancellation, cache ownership

**Deliverable.** `packages/blendlink/src/meshTierCache.ts`. Only after
Phase 2 ships with tiers preloaded eagerly.

`docs/TECHNIQUE_LEDGER.md:154` records `NDL-PRG-004` as Gap/Future:
"progressive companions have no package-owned request/cache lifecycle yet".
`docs/research-needle-behavioral-baseline-2026.md:471` enumerates what a
design needs — attempt generations, per-consumer leases, retry, late-result
disposal, cache ownership, and truthful network/decode cancellation tests.
Reuse `publicationLease.ts` and the LRU/pinning model already proven for
atlases (`bakedRecipe.ts` texture cache).

**Evidence gate.** `meshTierCache.test.ts` plus a browser gate asserting
truthful abort: a tier request superseded by a camera move must not commit
its late result, and the test must distinguish "we ignored the result" from
"we actually aborted the request" by inspecting network state — precisely
because `docs/research-needle-behavioral-baseline-2026.md:471` records that
**no abort signal was found** at Needle's own progressive request seam, so
there is nothing to copy and nothing to compare against.

Shipping Phase 2 before this is safe only because Phase 2 preloads. Making
tiers on-demand without Phase 3 would ship an untruthful cancellation story.

### Ledger honesty (lands with Phases 1 and 2)

After Phase 1, `docs/FEATURE_PARITY.md:182` moves Gap → Partial **only** with
the refusal set named in the Notes column and the explicit statement that no
runtime selector consumes the tiers yet. It cannot reach Match or Better
while the Needle differential remains impossible. Record that as the reason,
not as a pending task. `docs/TECHNIQUE_LEDGER.md:151-152` gets the
corresponding `NDL-PRG-001`/`NDL-PRG-002` edits. Pending task #8 means this
row will be read against HEAD regardless.

---

## 6. What is refused rather than approximated

Every refusal names the Blender object, the cause, and the artist's remedy,
and is pushed into `skipped` in the `refusePass` idiom
(`optimizer.ts:922-925`) so it reaches the manifest and the CLI.

| # | refused | why it is a refusal and not an approximation |
| --- | --- | --- |
| 1 | any primitive carrying `JOINTS_0`/`WEIGHTS_0`, or any node with a skin | §4.2 — rest-pose-only metric, and pending task #4 (bind-pose integrity proof) is not done |
| 2 | any primitive with `listTargets().length > 0` | §4.3 — the tier would be silently wrong, not loudly broken |
| 3 | any document with `KHR_mesh_primitive_restart` | the dependency throws; refuse first, by name |
| 4 | any primitive whose mode is not `TRIANGLES` | `simplify()` warns and skips (`numUnsupported`); a warning is not a refusal |
| 5 | any mesh whose simplified result would have zero rendered vertices | `simplify()` disposes it and then disposes the owning mesh; **refuse, never dispose** |
| 6 | any primitive without an index buffer, or in a document where the weld pass was refused | C2 — never weld silently to make a mesh eligible |
| 7 | any mesh already a member of an authored `_LODn` chain | `lodRuntime.ts:137-145` takes exclusive `visible` ownership; two owners is the bug |
| 8 | any node whose primitives resolve to more than one atlas group | island membership is not defined across atlases |
| 9 | any state-controlled node | shipped precedent: `docs/MANIFEST.md:541` already omits LOD chains containing one, for the same ownership reason |
| 10 | any mesh with a nonzero gutter-crossing count at the requested ratio | §4.1; enforced by the `gutterCrossings: 0` literal type |
| 11 | `simplifySloppy`, permanently | its own documentation says it "doesn't preserve attribute seams or borders" |
| 12 | the document-level `simplify()` transform, permanently | silent primitive and mesh disposal; forbid at the import site in a comment |
| 13 | multi-primitive meshes, **conditionally** | only if Phase 0 measures `LockBorder` as over-constraining (§4.4). Unmeasured is itself a refusal: a multi-primitive mesh with no measurement does not ship a tier |

Refusals 1 and 2 deserve one more sentence because they will be argued with.
They are not conservatism. `compactPrimitive` remaps morph deltas and skin
weights through the *base-mesh* remap, so a rest-pose-driven simplifier
removes exactly the vertices carrying a morph's extremes and rebinds nothing.
The surviving weights and deltas are numerically exact; the deformation the
artist authored is gone. That is the silent-wrongness class.

---

## 7. The wiring cost, enumerated

The task named four sites: `ExportResult`, the invoke mapping, the sync
`typegenOptions` spread, and the typegen options type plus assembly. That
model is correct for an **exporter-originated scalar** field. `meshTiers`
is neither: it is computed in `sync` from the finished GLB (which deletes the
first two sites), and it **carries URLs** (which adds several).

Verified by enumeration at HEAD, `textureVariants` — the nearest precedent —
occupies these sites:

| # | file:line | what it is | silent if omitted? |
| --- | --- | --- | --- |
| 1 | `typegen.ts:305` | `SceneManifest` field | no — type error |
| 2 | `typegen.ts:769` | `generateSceneModule` options type | no — type error |
| 3 | `typegen.ts:1127-1129` | manifest assembly conditional spread | **yes** — field silently absent |
| 4 | `typegen.ts:1413-1420` | generated-module emission via `versionedAssetUrl(url, hash)` | **yes** — manifest has tiers the descriptor cannot see |
| 5 | `sync.ts:221` | `addressedTypegenAssetFields` param type | no — type error |
| 6 | `sync.ts:246-256` | that function's URL re-addressing map | **yes** — unaddressed URLs |
| 7 | `sync.ts:318` | that function's return spread | **yes** — addressing dropped |
| 8 | `sync.ts:1366-1371` | build from raw result through `toUrl`, which also populates `declaredStagePaths` | no — `inspectCompilerStagingDirectory` refuses undeclared staged files (C5) |
| 9 | `sync.ts:1473` | first `typegenOptions` spread | **yes** |
| 10 | `sync.ts:1542` | second spread, into `addressedTypegenAssetFields` | **yes** |
| 11 | `sync.ts:982-984` | unchanged-scene presence/hash verification | **yes** — stale tiers accepted |
| 12 | `sync.ts:1054-1060` | incremental bake-cache reuse | **yes** — reuse drift |
| 13 | `assetUrls.ts:205-208` | `compiledSceneAssetUrls` typed walk | **yes** — the graph backstop at :210-222 absorbs it and browser smokes lose the typed classification (C5) |
| 14 | `runtime.ts:92-101` | `CompiledSceneDescriptor` field | no — type error |
| 15 | `bakedRecipe.ts:310-312`, `:597` | generated recipe template consumer | n/a for Phase 1; required for Phase 2 |
| 16 | `syncstatus.py:488-500` | add-on exposure for pixel inspection | **yes** — Python, no type checker |
| 17 | `syncstatus.py:681-700` | add-on staleness/integrity | **yes** — Python, no type checker |

**Eleven of seventeen fail silently.** Two of those are in Python, where
nothing catches the omission at all. `sceneAssetGraph.ts:5` is *not* on this
list (C4). The mitigation is the C5 regression test plus a checklist in the
phase-1 commit; there is no cleverness available here. The risk is entirely
in omitting a site, not in any site being hard — each is roughly five lines.

---

## 8. Effort, honestly

These are estimates with their basis stated, not measurements.

| phase | shape | estimate | basis |
| --- | --- | --- | --- |
| 0 | 2 measured cells, no shipping code | smallest phase | `experiments/atlas-packing-probe` is the size precedent; no `packages/` edit, no gate registration |
| 1 | 1 module + 1 vitest + ~17 wiring edits + 1 headless check + recipe knob | the module is easy; **the wiring is where the bug will be** | `atlasDelivery.ts` is 300 lines and `meshTiers.ts` is a similar shape with a larger eligibility predicate; the predicate is the majority of the test surface |
| 2 | ~2 files touched in `packages/` + recipe template + 1 vitest + 1 browser gate | **the browser gate is the expensive part** | four independent states (requested / decoded / GPU / presented) must be observed separately, per `docs/TECHNIQUE_LEDGER.md:153` |
| 3 | 1 module + 1 vitest + 1 browser gate | **realistically the largest single phase**, comparable to the entire baked-atlas cache effort | `NDL-PRG-004`'s full enumeration at `docs/research-needle-behavioral-baseline-2026.md:471`; do not scope it alongside a release |

**Total to a defensible Partial: Phases 0–2.** Phase 3 is a separate
decision.

One estimate is conditional. If Phase 0 measures nonzero gutter-crossings on
the corpus under position-only simplify, Phase 1 must use
`simplifyWithAttributes` with an `atlasLayout`-derived `vertex_lock`, and
Phase 1's effort roughly doubles. Per C1 the expected answer is that it does
not, but that expectation is a reading of documentation, not a measurement,
and the phase ordering exists precisely so the difference costs a cell rather
than a rewrite.

---

## 9. What is still owed

- **The Needle differential, permanently.** Build pipeline 3.0.0 is CLI-only
  and JWT-gated. Determinism plus decoded gates plus same-camera
  Blendlink-versus-Blendlink evidence is a *weaker* claim than parity and
  must be labelled as such in the ledger, every time.
- **The gutter-crossing number.** Everything in §4.1 is currently a reading
  of `meshoptimizer/README.md`. It is unproven on this corpus.
- **The `LockBorder` reduction cost.** Unproven. Until measured,
  multi-primitive meshes are refused (refusal 13).
- **Cross-platform determinism of `MeshoptSimplifier`.** Unproven, and
  load-bearing for build times, not just for identity.
- **Skinned tiers.** Blocked behind pending task #4, and possibly refused
  permanently. Do not sequence them before the bind-pose integrity proof
  exists.
- **Morph-target tiers.** Refused, with `simplifyWithAttributes` weighting of
  morph deltas noted as a research question that nobody has scoped.
- **Whether tiers are worth it at all on this corpus.** Nothing here proves a
  byte or frame-time win. Phase 0 measures decoded byte size per tier;
  Phase 2's same-camera gate measures transferred bytes. If those numbers are
  small, the honest outcome is to publish the measurement and not ship
  Phase 2 — the same conclusion `docs/character-routes-and-deformation-2026.md:171-196`
  reached when de-duplication turned out to dominate constant-channel
  elision.
