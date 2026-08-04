# alphaMode from the bake, not the plan - measured seam map (2026-08-04)

Status: **DELIBERATELY NOT IMPLEMENTED.** Nothing in this document has been written into the
compiler. It is the measured seam map for open task #6 ("Decide alphaMode from the baked result,
not the plan"), recorded so the next session starts from verified anchors instead of re-deriving
them. Section 10 says why it was deferred rather than landed.

Every anchor below was re-read against HEAD (`a3b8c68`) during this session. The seam map I was
given had drifted: section 3 lists every place I corrected it. Where I could not verify a claim,
it is marked unproven and stays unproven - it is not repeated as fact.

Scope: alphaMode and the alpha gutter only. The other defects from the same adversarial review
were handled separately and are not discussed here.

---

## 1. The claim

A material whose alpha is provably opaque over its covered texels can ship `alphaMode: "BLEND"`,
and the cause is a routing guess made *before any bake ran*, not a measurement of the bake.

The whole chain is confirmed by reading at HEAD. What is **not** confirmed at HEAD is how many
of ellie's materials it currently affects: `docs/character-routes-and-deformation-2026.md`
Phase 1c measured 26 of 51 materials publishing BLEND with 0.00% midtone alpha, but that same
document records the figure as taken from a pre-texCoord-fix GLB and says it "needs re-quoting
after a clean HEAD compile". Treat the mechanism as measured and the population as stale.

---

## 2. The defect, in four measured steps

**Step 1 - a whole-tree refusal is swallowed, and it collapses every channel at once.**

`packages/blender-addon/material_compiler.py:3074-3084`, inside `_synthesize_surface_routing`:

```python
    emitted = None
    tsl_ir.set_texture_ref_emission(True)
    try:
        emitted = tsl_ir.emit_surface(tree)
    except (tsl_ir.TslIrRefusal, RecursionError):
        # Channels bake without fold-constant detection (and without the
        # IR upgrade); the projection tap does not need IR emission.
        emitted = None
    finally:
        tsl_ir.set_texture_ref_emission(False)
    fold_channels = (emitted or {}).get("channels", {})
```

`emit_surface` is a **whole-tree** emission. One `TslIrRefusal` anywhere in the graph - on any
channel, for any reason - makes `fold_channels` an empty dict for *all six* channels. The
`except` has no `as` clause, so the reason is not captured either.

**Step 2 - an empty fold map is reported as "linked", unqualified.**

`material_compiler.py:3086-3107`, the local `record()`:

```python
    def record(name, document):
        expression = (document or {}).get("output") or {}
        op = expression.get("op")
        if op == "const_float":
            ...
        if op == "const_vec3":
            ...
        return {
            "channel": name,
            "linked": True,
            "routing": routing_kind,
            ...
        }
```

With `document` `None`, `expression` is `{}`, `op` is `None`, both const arms are skipped, and the
fall-through returns `"linked": True`. Applied to all six channels at `:3109-3119`, Alpha among
them. There is no marker distinguishing "this channel is proven varying" from "we could not look".

**Step 3 - a linked Alpha becomes a bake, and the bake stamps BLEND from the plan.**

`material_compiler.py:3340-3342`:

```python
        else:
            record = route_bake("Alpha", alpha_entry, "data")
            alpha_baked = record is not None
```

`material_compiler.py:3533-3536`:

```python
                alpha_mode=(
                    "BLEND" if (alpha_baked or alpha_factor < 1.0 - 1e-9)
                    else "OPAQUE"
                ),
```

There is no MASK arm on this route at all, and the code says so at `:3552-3556`:

```python
    if alpha_baked:
        limitations.append(
            "Baked alpha publishes as BLEND; MASK detection from baked "
            "coverage is not implemented yet."
        )
```

**Step 4 - the plan verdict is what ships, in a scope where the bake result is already in hand.**

`material_compiler.py:8299-8300`, inside the `generated_facts[generated.name]` assembly for the
channels transport:

```python
                    "usesAlpha": binding.alpha_mode != "OPAQUE",
                    "alphaMode": binding.alpha_mode,
```

The very next lines (`:8301-8305`) already read the bake result:
`products["images"].get("baseColor", {}).get("hasAlpha")`. The measurement is in scope and is not
consulted for the mode.

---

## 3. Corrections to the seam map I was given

The source moved during the session. These are the corrections, so the next reader does not
re-derive them:

| claim as given | verified at HEAD | note |
| --- | --- | --- |
| `material_compiler.py:3025-3032` swallowed refusal | **`:3074-3084`** | the input had already self-corrected; confirmed |
| `material_compiler.py:3049-3056` `record()` | **`:3086-3107`** | confirmed |
| `material_compiler.py:3413` picks the mode | **`:3533-3536`** | `:3413` is unrelated; the input's correction is right |
| `bakelib.py:7460-7461` `rgbMin`/`rgbMax` | **`:7465-7466`** | 5 lines low |
| `bakelib.py:7557-7562` alpha compose | **`:7562-7567`** | 5 lines low |
| `bakelib.py:7413-7419` coverage bake with margin | **`:7418-7424`** | 5 lines low |
| `bakelib.py:7659-7662` `clampedToCarrier` | **`:7670`** | 11 lines low |
| `sceneDiagnostics.ts:468` alphaMode union | **`:494`** | 26 lines low |
| `sceneDiagnostics.ts:1478-1482` equality check | **`:1496-1499`** | 18 lines low |

`material_compiler.py:4226`, `:4246-4250`, `:6029-6034`, `:6151`, `:7806`, `:6870-6898`,
`:8299-8300` and `:3552-3556` were all found exactly where the input said. Anchor on the
identifiers - `_synthesize_surface_routing`, `record`, `alpha_baked`, `save_channel_png`,
`_attest_generated_materials`, `generated_facts` - not on these numbers.

**One correction is substantive, not cosmetic.** The input proposed a test fixture using "a Noise
Texture at scale 40 [which] hits `tsl.noise-3d-scale-above-exact` per `tsl_ir.py:233-243`". That
is **stale and would not refuse at HEAD**:

- `packages/blender-addon/tsl_ir.py:359` - `_NOISE_SCALE_BOUND = 80.0`, and the comment at
  `:358` names `noise-scale40` as one of the *proving* cells.
- `tsl_ir.py:365` - `_NOISE_SCALE_APPROXIMATE_BOUNDS = {"1D": 1600.0, "2D": 200.0, "3D": 400.0}`.
  Above the exact bound, 3D noise ships as a declared approximation rather than refusing.

So scale 40 is now well inside the exact bound and scale 200 is a declared band. A fixture needs a
refusal that is still unconditional. Verified candidates in `tsl_ir.py`, each a bare `_refuse`
with no bound to raise:

- `:1315` - `"Vector Rotate EULER_XYZ has no cell yet (needs a matrix)"`
- `:1319` - `"Vector Rotate with Invert has no cell yet"`
- `:610` - `"Transparent BSDF with a linked Color has no cell yet"`

`EULER_XYZ` is the cheapest to author and the least likely to be earned away by the next
differential cell.

The input already flagged as UNVERIFIED that ellie's specific trigger is noise scale 40. It is now
worse than unverified - the named gate no longer fires at that value. **Which refusal ellie
actually trips at HEAD is unmeasured.** The mechanism is refusal-agnostic, so the defect stands
regardless, but nobody should cite a trigger until it is measured on the real scene.

---

## 4. Facts the seam map did not carry

Four things I found while verifying that change what the fix has to do.

**a. The decision site is already one-per-variant, which is exactly right.** `_bake_material_channels`
products are cached by `_variant_key` (`material_compiler.py:7662`, `:7666`, `:7681`); the second
pass looks up the same variant (`:8234-8235`), builds the generated material once per variant
(`:8237-8247`), and assembles `generated_facts` in that same block (`:8291`). So the measured alpha
plane and the published alphaMode already have one owner and one lifetime. The recommended decision
site is structurally sound - it is not a place where one measurement would have to serve two
answers.

**b. `binding.alpha_mode` is load-bearing for identity, not just for the GLB.** It appears in
`_variant_key` (`:3951`) and in `MaterialBinding.fingerprint_dict()` (`:218`). The variant token is
`sha256(_variant_key(...))[:12]` (`:6657-6659`) and that token names every generated channel PNG -
`channel-{token}-base.png` at `:6888`. Setting `alpha_mode=None` at plan time (option (a) of the
recommended fix) therefore **renames every generated channel texture in every scene**, with
incremental-cache and committed-fixture consequences.

It does not *merge* anything, though: `alpha_baked` and `alpha_factor` are computed once per
material at `:3331-3342`, before the per-binding loop, so every binding of one material already
gets the same `alpha_mode`. Removing the term from the key cannot collapse a split that exists
today. Verified by reading; not by running.

**c. The bake route's generated Blender material has its own, separate notion of "uses alpha", and
no MASK arm.** `_generated_material_bake` derives it from the image, not from the plan
(`material_compiler.py:7345-7347`):

```python
        if base_entry.get("hasAlpha"):
            tree.links.new(node.outputs["Alpha"], principled.inputs["Alpha"])
            uses_alpha = True
```

The MASK handling - the `ShaderNodeMath` `ROUND` clip - exists only on the webColor route, at
`:4246-4250`. Making MASK reachable on the bake route means deciding whether the generated Blender
material needs the same treatment; today there is nothing there to extend.

**d. `alphaCutoff` does not exist anywhere in Blendlink.** `grep -rn 'alphaCutoff|alpha_cutoff|
alphaThreshold'` over `packages/blender-addon`, `packages/blendlink/blender` and
`packages/blendlink/src` returns **zero** matches. glTF's default for MASK is 0.5, and the one
place MASK exists (`ROUND` at `:4248`) also implies 0.5. So shipping MASK would ship an unstated,
unmeasured 0.5 threshold. Whether the baked plane's actual threshold is 0.5 is an open measurement,
not a safe assumption.

---

## 5. The alpha gutter, and why it only bites once alphaMode is right

`packages/blendlink/blender/bakelib.py:7562-7567`, in `save_channel_png`:

```python
        if covered_count < covered.size:
            mean = np.round(
                composed[:, :, :3][covered].mean(axis=0) * 255.0
            ) / 255.0
            composed[:, :, :3][~covered] = mean
            composed[:, :, 3][~covered] = 0.0
```

The RGB planes get a mean fill so they survive mip reduction. The alpha plane is hard-zeroed
outside coverage with no dilation, so every mip level averages zeros into covered texels.

**Session measurement: the covered-region alpha mean falls to 0.88 at mip4 and 0.66 at mip6.**
That measurement was taken during this session and has **no committed harness** - it is not
reproducible from the repository as it stands. Section 11 says how it becomes reproducible.

Three facts make this a real gap rather than a guess:

- The repository already argues this exact case, for RGB. `flatten_saved_background`'s docstring
  (`bakelib.py:1921-1930`) states it plainly: mip level N keeps only a fraction of the authored
  island padding, so deep mips of a dark-background atlas average halos into island edges.
- The alpha branch deliberately bypasses that function, and says why in its own docstring
  (`bakelib.py:7521-7523`): `flatten_saved_background` would force the whole file opaque. It does -
  `bakelib.py:1975` is `rgba[:, :, 3] = 1.0`. So the RGB half of the argument was re-implemented
  in-buffer at `:7562-7567` and the alpha half was left behind.
- The zeros start close to the islands. The coverage mask is itself baked with the bake margin
  (`bakelib.py:7418-7424` passes `margin_px=margin` into `bake_objects_to_image` before
  `image_signal_coverage`), so the alpha-zero region begins just outside the extend band and
  reaches covered texels within a few reductions.

**With alphaMode correctly OPAQUE this is invisible** - the alpha channel is not sampled. It
becomes visible precisely for the materials that legitimately ship MASK or BLEND, which dissolve at
distance. That is why the two findings belong in one document: fixing alphaMode is what makes the
gutter matter.

---

## 6. The evidence needed to decide correctly is already measured, then thrown away

`material_compiler.py:6870-6878`:

```python
        if alpha_baked:
            alpha_material = _material_bake_channel_material(
                decision, "alpha", created_materials,
            )
            alpha_result = bake_once(
                alpha_record, alpha_material, carrier_resolution,
                allow_hdr=False,
            )
            alpha_plane = alpha_result["pixels"][:, :, 0]
```

`bake_once` (`:6710`) returns the dict from `bakelib.bake_channel_field_pixels` unchanged (`:6805`
`return main`), and that dict already carries covered-texel range - `bakelib.py:7462-7466`:

```python
        result = {
            "pixels": rgb,
            "coverage": coverage,
            "rgbMin": tuple(float(value) for value in covered.min(axis=0)),
            "rgbMax": tuple(float(value) for value in covered.max(axis=0)),
```

Only `["pixels"][:, :, 0]` is kept. `alpha_result["rgbMin"][0]` and `["rgbMax"][0]` are free at the
call site and are discarded. What survives into `images["baseColor"]` (`:6892-6898`) is a bare
boolean, `"hasAlpha": alpha_plane is not None`.

---

## 7. Why neither verifier catches this

**The Python attestation compares the shipped GLB against the plan.**
`_attest_generated_materials` at `material_compiler.py:6029-6034`:

```python
        emitted_alpha = emitted.get("alphaMode", "OPAQUE")
        if not stock_program_carrier and emitted_alpha != fact["alphaMode"]:
            raise MaterialCompileError(...)
```

and then republishes it at `:6151` as `"alphaMode": emitted_alpha`. A plan that is wrong but
self-consistent passes and is re-published as evidence.

**The TypeScript verifier does the same thing independently.**
`packages/blendlink/src/sceneDiagnostics.ts:1496-1499`:

```ts
    if (material.getAlphaMode() !== (evidence.alphaMode ?? 'OPAQUE')) {
      materialEvidenceFailure(
        evidence.sourceMaterial,
        `changed alphaMode from ${evidence.alphaMode ?? 'OPAQUE'} to ${material.getAlphaMode()}.`,
      )
```

with the type at `:494`, `alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND'`. Equality-with-the-recorded-value
cannot catch a recorded value that was wrong.

This is structural, not an oversight in either gate: neither has access to the baked plane. The
only place both the plan and the bake result exist is `material_compiler.py:8291-8305`.

---

## 8. The fix, as designed

Preserved from the review that produced this seam map. **None of it is implemented.**

**8.1 - Carry the measured alpha plane forward as evidence.**
At `material_compiler.py:6870-6898`, compute over *covered texels only*: `min`, `max`, the fraction
of covered texels within 1e-3 of 0.0 and of 1.0, and the fraction strictly between. Store beside
the existing `hasAlpha` on `images["baseColor"]`, e.g.
`alphaEvidence: {"model": "baked-alpha-plane-v1", "min", "max", "binaryFraction", "partialFraction", "coveredTexels"}`.
`alpha_result["rgbMin"][0]` / `["rgbMax"][0]` give min/max for free; the fractions need one numpy
pass over `alpha_plane[coverage]`.

*Why:* every downstream alphaMode decision must read a measurement of what was rendered, not a
routing guess made before any bake ran. Putting it on the dict that already carries `hasAlpha`
keeps one owner for "what the base-colour carrier actually contains".

**8.2 - Decide at the one site where both the plan and the bake result are in scope.**
Replace both lines at `:8299-8300` with a decision derived from
`products["images"]["baseColor"]["alphaEvidence"]` when a plane was baked: OPAQUE when the covered
minimum is provably 1.0; MASK when the partial fraction is negligible and both the 0 and 1
populations exist; BLEND only when a genuine partial-coverage population survives. With no baked
plane, keep the constant-factor rule (`alpha_factor < 1.0 - 1e-9`). Derive `usesAlpha` from the
resulting mode, never independently. Log the decision with the measured numbers.

*Thresholds are deliberately written as predicates, not numbers, above.* See section 10 - the
numbers are the reason this is deferred.

**8.3 - Make the plan's value structurally incapable of reaching the GLB.**
At `:3533-3536`, either (a) leave `alpha_mode=None` when `alpha_baked` is True and require the bake
site to fill it - the existing `if alpha_mode not in {"OPAQUE","MASK","BLEND"}: raise` guards at
`:4226-4230` and `:7806-7811` then become the enforcement that nobody shipped an undecided mode - or
(b) rename the field `planned_alpha_mode` and make the bake site the only writer of the published
one. Delete the limitation string at `:3552-3556` once MASK is real.

*Why:* two writers for one fact is what let the plan win. Anything softer re-opens the moment
someone adds a third publication site. Note the cost recorded in section 4b: option (a) changes the
variant token and renames every generated channel texture. Option (b) does not.

**8.4 - Stop laundering a refusal into a claim.**
Two separate corrections in `_synthesize_surface_routing`. (1) At `:3078`, capture the refusal -
`except (tsl_ir.TslIrRefusal, RecursionError) as refusal:` - and carry it onto the returned routing
dict so the plan can name it. (2) In `record()` at `:3086-3107`, distinguish "proven varying" from
"could not look": when `fold_channels` is empty because the emission refused, the record must carry
an explicit marker (`"foldUnknown": True, "foldRefusal": ...`) rather than an unqualified
`"linked": True`.

*Why:* the repository rule is that failures are loud and named. Beyond alpha, this same laundering
over-bakes Metallic/Roughness/Emission as varying fields that are provably constant - a cost and
fidelity bug that survives even after 8.2 lands. Note that a marker only reaches the plan
fingerprint if it is explicitly carried into the route records; `_channel_plan_fingerprint`
(`:2927-2941`) hashes the *route* records, not the routing records, so this is a decision to make,
not a side effect.

**8.5 - Dilate the alpha plane into the gutter.**
At `bakelib.py:7562-7567`, before zeroing, flood the covered alpha values outward (an iterated 3x3
nearest-covered dilation is enough), then zero only what remains beyond the dilated band -
or write the gutter with the nearest covered alpha value rather than 0.0. Record the measured
post-dilation mip-chain alpha mean on the saved dict so the regression is observable rather than
argued.

*Why:* the RGB path already solved exactly this problem, for exactly this reason, and states the
reason in `flatten_saved_background`'s docstring. Alpha was left behind.

---

## 9. Enumeration lockstep: what has to move together

`alphaMode` is asserted verbatim in at least five places. Changing where it is decided without
touching all of them will either trip the attestation at `:6030` or silently bypass it:

- `material_compiler.py:4226` and `:7806` - `if alpha_mode not in {"OPAQUE","MASK","BLEND"}: raise`
- `material_compiler.py:6029-6034` - compares the emitted GLB value against `fact["alphaMode"]`
- `material_compiler.py:6151` - republishes it as evidence
- `material_compiler.py:8299-8300` - the channels-transport fact site (and `:7831-7832`, the
  image/webColor fact site)
- `sceneDiagnostics.ts:494` declares the union; `:1496-1499` asserts equality

**MASK has downstream consequences that today exist only on the webColor route.** `:4246-4250`
installs the `ROUND` node; `:4332-4340` and `:7435-7445` set `surface_render_method = "DITHERED"` /
`blend_method = "BLEND"` whenever `uses_alpha`. Making MASK reachable on the material-bake route
means deciding whether the generated Blender material needs the same treatment, and answering the
`alphaCutoff` question from section 4d.

**MASK is already proven on the other route**, which is the model to copy:
`packages/blender-addon/tests/material_compiler_check.py:2489-2502` asserts a shared selected-alpha
material splitting into independently attested MASK / OPAQUE / BLEND variants. The contract shape
exists; it has simply never been extended to the bake route.

**Scope note.** `packages/blendlink/dist/addon/*.py` and `dist/blender/*.py` are retained copies at
the same line numbers, so every grep double-hits. Edits land in `packages/blendlink/blender/` and
`packages/blender-addon/` only; `dist` is regenerated.

---

## 10. Why this was deferred

Four reasons, in the order that decided it.

**The thresholds are not measured.** Section 8.2 is written as predicates because the numbers are
not earned. The repository's own pattern - stated in `docs/character-routes-and-deformation-2026.md`
and demonstrated by the TSL bounds in `tsl_ir.py:353-377` - is that a bound is measured against a
gated cell and cited, and that a stale bound quietly caps the compiler until someone re-measures.
That document records two such stale figures capping the emitter for months. Writing `1e-3` and a
partial-coverage fraction into the alphaMode decision without running the ellie carrier through the
new `alphaEvidence` path first would be the same mistake in a new place.

**There is a specific unresolved question inside those thresholds.** Phase 1c measured ellie's
alpha as binary over the *whole image*. The evidence proposed in 8.1 is computed over *covered
texels only*. Those two measurements can disagree: whole-image binary is consistent with
"all-1.0 inside coverage, 0 outside" (which is OPAQUE) and equally with "genuine binary cutout
inside coverage" (which is MASK). Nobody has separated them. Until they are separated, the fix does
not know whether ellie ships OPAQUE or MASK - and those two answers have different downstream work
(section 9).

**The fix changes shipped GLB material state.** Committed showcase GLBs live under
`showcases/ellie/public/models/ellieAnimation/<sha>/` and
`showcases/cube-diorama/public/models/cubeDiorama/<sha>/` - content-addressed, so a recompile
produces new hash directories and new committed bytes. `scripts/test-baked-e2e.mjs` is the enriched
two-state e2e that verifies them. Landing this means recompiling and re-verifying those showcases,
not just running unit suites. If option 8.3(a) is taken, every generated channel texture is renamed
too (section 4b).

**The release is already staged.** `packages/blender-addon/blender_manifest.toml` and
`packages/blendlink/package.json` both read `0.9.0`, and open task #10 is to run the release.
Landing an unmeasured threshold that rewrites shipped material state beside a version bump would
put a guessed bound into a release, and releases are exactly where a guessed bound stops being
easy to revisit.

---

## 11. Test wiring, when this is built

Headless addon suites are **discovered, not enumerated**: `scripts/test-addon-headless.mjs:61-95`
walks `packages/blender-addon/tests/*.py` and registers any module whose source contains a
`print("BLENDLINK_[A-Z0-9_]+")` sentinel; a module with neither a sentinel nor a
`# blendlink-headless-suite: manual <reason>` comment throws at discovery. A new suite file plus a
final `print("BLENDLINK_X_PASSED")` is the whole registration. A human label in `SUITE_LABELS`
(`:20-51`) is optional - a missing one only degrades the console line.

- **New suite** `packages/blender-addon/tests/alpha_mode_from_bake_check.py` printing
  `BLENDLINK_ALPHA_MODE_FROM_BAKE_PASSED`. Three fixtures in one file: (a) a surface-resolvable
  non-Principled material with a constant-1.0 Alpha **and an unrelated refusing node elsewhere in
  the tree** - use a Vector Rotate set to `EULER_XYZ` (`tsl_ir.py:1315`), *not* the noise scale the
  input suggested, per section 3 - asserting the shipped `alphaMode` is `OPAQUE`; (b) binary
  coverage asserting `MASK`; (c) genuine partial coverage asserting `BLEND`. Case (a) is the
  regression that fails at HEAD. Structure to copy: `material_bake_check.py`,
  `material_tsl_ir_check.py`.
- **Routing unit**: extend `packages/blender-addon/tests/channel_routing_check.py` (already
  discovered) with a `_synthesize_surface_routing` case asserting a swallowed `emit_surface`
  refusal does not produce an unqualified `"linked": True` on Alpha - the record must carry the
  fold-unknown marker and the named refusal.
- **Alpha gutter**: extend `packages/blender-addon/tests/material_channel_bake_check.py` (already
  discovered; `save_channel_png` is exercised at `:251`, sentinel at `:283`) with a case that
  builds a known coverage mask, saves with an all-1.0 alpha plane, box-reduces the saved RGBA six
  times and asserts the covered-region alpha mean stays above a threshold at mip4 and mip6. Without
  dilation this reproduces the session's 0.88 / 0.66 - **and is the only way that measurement
  becomes reproducible.** It does not exist today.
- **Vocabulary**: no recommended edit adds or renames a TSL IR op or vocabulary term, so
  `packages/blendlink/conformance/tsl-ir-ops.json` and `vocabulary.json` need no regeneration. If
  `alphaEvidence` becomes a published evidence key, confirm whether it falls under the vocabulary
  artifact before landing - `vocab_test.py` and `tsl_ir_ops_check.py` are the two discovered suites
  that gate those artifacts on both parsers.
- **End-to-end**: `scripts/test-baked-e2e.mjs`, after recompiling the showcase fixtures. See
  section 10.

---

## 12. Still owed

Named so they are not mistaken for answered:

- **The thresholds.** Run ellie's baked carriers through the `alphaEvidence` path and record actual
  covered-texel min / max / partialFraction before any constant is written into the decision.
- **Covered-only versus whole-image binarity.** Decides whether ellie's population is OPAQUE or
  MASK, and therefore how much of section 9's MASK work is actually needed.
- **The `alphaCutoff` question.** If MASK ships, glTF defaults the cutoff to 0.5 and Blendlink
  publishes nothing. Whether 0.5 matches the baked plane's real threshold is unmeasured.
- **Which refusal ellie actually trips.** The scale-40 claim is dead (section 3). The mechanism is
  refusal-agnostic so the defect stands, but the trigger is unknown and must not be cited as
  measured.
- **The 26-of-51 BLEND population.** Measured on a pre-texCoord-fix GLB, per
  `docs/character-routes-and-deformation-2026.md`. Needs re-quoting from a clean HEAD compile
  before it scores anything.
- **The mip measurement's provenance.** 0.88 at mip4 and 0.66 at mip6 were taken this session with
  no committed harness. Until the test in section 11 exists, they are a session note, not a
  repository fact.
