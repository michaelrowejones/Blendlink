# Bind-pose integrity: the measured seam map for work deliberately not implemented (2026-08-04)

Status: **design only. Nothing in this document was implemented.** No code changed. This file
exists so the next session starts from a verified seam map instead of re-deriving one.

Why it was not implemented is recorded in full in section 7, "Why this was deferred". The short
form: the measurement is sound, but landing it means adding a depsgraph-heavy diagnostic and a new
`analyze_scene` contract field in the middle of the 0.9.0 release, and the candidate set is only
honest once the measurement runs beside it.

Every anchor below was re-verified against HEAD (`a3b8c68`) while writing this. The session that
produced the input design moved the source underneath it, so section 3 lists the line numbers that
were stale and what they are now. Anchor on the identifiers, not the numbers.

---

## 1. The defect

Blender's glTF exporter mutes **only** the ARMATURE modifier before it evaluates the depsgraph.
Every other deformer in the stack still runs, at the export frame's pose. That posed shape is
written as the mesh's **rest** positions. The runtime then applies the inverse bind matrices --
which come from the bones' **rest** matrices -- on top of it. The pose is applied twice.

This is the same exporter behaviour Phase 0a already refuses on *unskinned* meshes
(`frozen_deformer_issues`, `procedural.py:2231`). The skinned case is the half nobody examines:
`_frozen_deformer_issue` returns `None` for any mesh with an ARMATURE modifier
(`procedural.py:2194-2195`), so a rigged character's facial stack -- HOOK-driven LATTICE,
SHRINKWRAP, CORRECTIVE_SMOOTH on a mesh that *also* has an ARMATURE -- is examined by nothing in
the codebase today.

**Measured this session on a production character:**

| symptom | measurement |
| --- | --- |
| lips displaced forward in the shipped bind pose | 28.135 mm |
| centre of the face off the midline | 4.246 mm |
| teeth using SURFACE_DEFORM with no vertex groups | export with `skin: null`, frozen entirely |

Three honest caveats on those numbers, because they will be quoted:

- **The owning mesh of the 28.135 mm figure is not identified in the recorded evidence**, so its
  fraction of a bounding-box diagonal was never computed. That matters: the whole threshold
  argument in section 5 is expressed as a fraction, and this number cannot yet be scored against
  it. See section 8.
- The millimetres are pose-independent; any percentage derived from them is not. The repository has
  already been burned by this once (`procedural.py:3559-3561`: an earlier probe divided by a
  rest-pose diagonal and read 1.627% / 1.083% for the same two millimetre figures that read 1.62% /
  0.91% against the posed one).
- **The teeth are a different defect and are already refused.** A mesh with no ARMATURE modifier at
  all exports with `skin: null`, which is exactly what `frozen_deformer_issues` names (measured at
  143.5% and 144.9%, `procedural.py:2242-2245`) and what the geometry door blocks
  (`export_scene.py:6436-6455`). On ellie those two meshes are further *repaired* by the Phase 1
  SURFACE_DEFORM lowering and so drop out of the refusal (`export_scene.py:6407-6410`). Either way
  they are outside the bind-pose proof's candidate set, and the proof must not be widened to cover
  them or it will produce a second, differently-worded refusal for the same objects.

---

## 2. What already exists

The machinery this proof needs is almost entirely already in the repository. Nothing below is new
work; it is the inventory that makes the design in section 5 small.

**The exporter's own read is already reproduced.** `_applied_mesh` (`procedural.py:3089-3133`)
mutes only *this* object's ARMATURE modifiers, takes the viewport depsgraph, calls
`to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)` and restores `show_viewport` in a
`finally`. Its docstring records that per-object muting is load-bearing, not an optimisation to
undo: batching every candidate's ARMATURE into one depsgraph rebuild would change the evaluated
result of a mesh whose SURFACE_DEFORM target is itself skinned.

**The per-vertex metric exists and is reusable verbatim.** `_lowering_worst`
(`procedural.py:4521-4531`) is the max Euclidean distance between two equal-length point lists,
returning `None` on a length mismatch.

**The thresholds are deliberately single-sourced.** `_DISPLACEMENT_WARN_FRACTION = 0.01`
(`procedural.py:3031`) and `_LOWERING_REFUSE_FRACTION = 0.10` (`procedural.py:3694`), both as a
fraction of the object's bounding-box diagonal, both carrying an inline comment saying they are
shared *on purpose* so the geometry diagnostics cannot disagree about "small".

**The frame the glb bakes is a named constant with the exporter cited.**
`_EXPORTER_FROZEN_FRAME = 0` (`procedural.py:3020-3026`), because
`io_scene_gltf2/blender/exp/export.py:28-29` calls `frame_set(0)` unless `gltf_current_frame` is
set and Blendlink never sets it -- a frame a range starting at 1 never contains.

**The codebase already treats `bone.matrix_local` as the rest matrix** and builds the runtime's
skinning matrix from it: `_lowering_pose_matrices` (`procedural.py:4496-4507`) returns
`posed.matrix @ bone.matrix_local.inverted()`. That is precisely what makes an unclean bind pose a
double transform.

**Skeleton-space conversion is solved.** `_lowering_shipped_rest` (`procedural.py:4442`) computes
`pre = rig.matrix_world.inverted() @ obj.matrix_world` *inside* the `_applied_mesh` block
(`:4461`) and documents that rest positions are returned in the ARMATURE object's space, which is
where the pose matrices act.

**The exporter's skin-selection rule is already ported.** `procedural.py:3579-3585`: `tree.py`
builds `{m.type: m for m in modifiers}` and tests `modifiers["ARMATURE"].object is not None`, so
only the LAST ARMATURE modifier can produce a skin, and `show_viewport` is never consulted.
`_skinned_by_armature` (`procedural.py:1984-1997`) is the same test.

**The budgeting pattern is uniform and has no exceptions.** A depsgraph-free RNA predicate produces
a candidate set; the expensive evaluation is spent once, at export, only on that set.
`deformer_lowering_plan` (`procedural.py:4089`) returns `verified: False` and is measured by
`verify_deformer_lowerings` (`procedural.py:4660`), called exactly once per export behind a
progress tick and gated on a non-empty plan (`export_scene.py:6391-6406`). There is no
"only when the scene has an armature" gate anywhere; the gate is always the candidate set.

**Narrowing is applied three more times.** Leave-one-out probing only for objects that already lost
their keys (`_shape_key_restoring_modifiers`, `procedural.py:3186-3214`); second-sweep attribution
only for warn-severity records (`_attribute_target_perturbation`, `procedural.py:4796-4813`); and a
recorded decision *not* to measure a magnitude because it costs two evaluated meshes per frame per
object (`procedural.py:3563-3567`).

**Every geometry refusal leaves by one door**, and the reason is written down at
`export_scene.py:6419-6423`: these diagnostics are computed in `analyze_scene` and would otherwise
ride the manifest with a zero exit code -- "a record that says 'refuse' and does not refuse is
worse than no record, because it reads as a guarantee."

**Each Blender-side diagnostic key is enumerated three times on the TypeScript side**: the
`BlenderSceneDiagnostics` interface (`sceneDiagnostics.ts:613`), the manifest-report interface
(`:699`), and the field-by-field projection body (`:2254`), whose comment states the rule
explicitly: "a field nobody named here is a field nobody meant to persist."

**`armature.data.pose_position` -- the one RNA switch that isolates a bind pose -- is used nowhere
in the repository.** Re-verified at HEAD: `grep -rn "pose_position"` over `packages/` and
`scripts/` for `*.py`, `*.ts`, `*.mjs`, `*.js` returns nothing.

**The conformance directory does not enumerate diagnostic record codes.**
`packages/blendlink/conformance/` holds exactly `vocabulary.json` and `tsl-ir-ops.json`;
`vocabulary.json`'s own `$comment` scopes it to `collider|rigid|lod|noimp|socket|hotspot|audio|none`.
A new geometry diagnostic is therefore **not** a conformance change.

---

## 3. Corrections to the input seam map

The source moved during the session. These are the differences between the design input and HEAD.
Where a claim was wrong rather than merely stale, it is marked.

**Confirmed exactly as claimed (no correction needed):** `_applied_mesh` 3089-3133;
`_lowering_worst` 4521-4531; `_DISPLACEMENT_WARN_FRACTION` comment+constant 3028-3031;
`_LOWERING_REFUSE_FRACTION` comment+constant 3691-3694; `_EXPORTER_FROZEN_FRAME` 3020-3026;
`_bbox_diagonal` 3136 with the pose-sensitivity note at 3139-3141; `_FROZEN_DEFORMER_INPUTS`
122-137; the 40% false-refusal comment 102-112; `_ALWAYS_DYNAMIC_MODIFIERS` 94-100;
`_skin_approximation_record` ending at 3647 with the Phase 1 banner at 3650; the exporter
skin-selection comment 3579-3585; `_lowering_pose_matrices` 4496-4507 with `matrix_local.inverted()`
at 4506; the float-triples rationale at 4421-4426; `analyze_scene`'s `frozen_deformers` call at
4931 and its `"frozenDeformers"` / `"deformerLowerings"` keys at 4943 / 4948;
`sceneDiagnostics.test.ts`'s `frozenDeformers` block at 1419-1448; `SUITE_LABELS` at
`scripts/test-addon-headless.mjs:20-51`.

**Confirmed refutation.** The input's first finding was that a reported "double-depsgraph refusal
in `bakelib.py` around line 2909" does not exist. Re-verified: `bakelib.py:2903-2912` is inside the
packed-UV gutter/bounds proof; `grep -c "residual\|deviation"` over `bakelib.py` returns **0**; the
only two `to_mesh` calls are the fingerprinting ones at `bakelib.py:739` and `:798`, plus unrelated
`GeometryNodeCurveToMesh` construction. The claim stands at HEAD.

**Wrong function named.** The input says "`frozen_deformer_issues` explicitly exempts every skinned
mesh with an unconditional early return". The early return is real and is at
`procedural.py:2194-2195`, but it lives in the per-object helper **`_frozen_deformer_issue`**
(`:2182`), not in `frozen_deformer_issues` (`:2231`). This matters for the design: partitioning the
exemption per modifier -- the fix for the blind spot in section 6 -- is an edit to
`_frozen_deformer_issue`, not to the collector.

**Function name never verified in the input.** The design refers to the rest-space conversion as
living near `procedural.py:4452-4461` without naming its owner. It is `_lowering_shipped_rest`
(`:4442`). Note also that this function returns `rest` as `Vector`, not float triples -- the
tuples-not-Vector rationale the design cites (`:4421-4426`) belongs to
`_lowering_evaluated_points`, and the new `_bind_pose_points` should follow *that* one.

**`export_scene.py` line numbers all moved by roughly +285.**

| what | input said | HEAD |
| --- | --- | --- |
| Phase 1 measurement block | 6105-6119 | **6391-6406** |
| `lowered_objects` | 6121 | **6407-6410** |
| geometry-refusal-door comment | 6133-6137 | **6419-6428** |
| `frozenDeformers` SystemExit | 6154-6169 | **6436-6455** |
| `dropped_shape_keys` block | 6170 | **6456-6466** |
| `prepare_lowered_skins` inside `emit_gltf` | 6230 | **6516** |

**`sceneDiagnostics.ts` line numbers all moved by roughly +18.**

| what | input said | HEAD |
| --- | --- | --- |
| `BlenderSceneDiagnostics` | 613 (unstated) | **613** |
| `frozenDeformers?` in that interface | 621 | **639** |
| `deformerLowerings?` in that interface | 638 | **656** |
| manifest-report `deformerLowerings?` | 713 | **731** (`frozenDeformers?` at 723) |
| projection comment | 2236-2239 | **2254-2256** |
| `deformerLowerings` const | 2290 | **2308** |
| `...(deformerLowerings ? ...)` spread | 2347 | **2365** |
| `frozenDeformers` spread | 2351 | **2369** |

**`run_headless.py` line numbers all moved.** The Phase 1 synthetic-rig block now runs 643-...:
`DEF-Jaw` / `CTRL-Jaw` created at 654-657, keyed at frames 1 and 10 at 661-663, `build_pair` at
666-685. The depsgraph-free assertion ("`verified is False`, outcome `planned`") the design says to
mirror is at **711-722** (input said 659-666). The restoration-proof idiom is at **727-746** and
**782-790** (input said 673-690 and 727-737). The suite sentinel
`print("BLENDLINK_ADDON_TESTS_PASSED")` is at **12144** (input said 12091).

**Suite discovery gained an opt-out the input does not mention.** `scripts/test-addon-headless.mjs`
still takes the last `print("BLENDLINK_*")` match in each `tests/*.py`, but a module can now opt out
with `# blendlink-headless-suite: manual <reason>`, and any module with neither a sentinel nor an
opt-out is *reported* as unregistered. So a new suite file cannot rot into documentation silently --
but it also cannot be added without either a sentinel or an explicit opt-out.

**`material_compiler._DEFORMING_MODIFIERS`** is at `material_compiler.py:1427` (input said 1420),
with its "modifiers a rest-basis UV-space channel bake is independent of" comment immediately
above and `_deforming_receiver` at `:1437`.

**The two "a modifier-type predicate is neither necessary nor sufficient" records** the design
cites are at `procedural.py:3033-3044` (`_VERTEX_CONTAINER_MODIFIERS`: "Listing a type here is
therefore never the decision") and `procedural.py:3658-3667` (the Phase 1 banner's two refuted
gates). Input said 3660-3667 for the second.

**One citation inside the proposed artist-facing message is inconsistent with the repository's own
and has been corrected below.** The input's sentence cites `io_scene_gltf2 nodes.py:305-313` for
the mute. The repository already cites `nodes.py:294-330` for the whole read (`procedural.py:3093`)
and `nodes.py:308-311` for the mute specifically (`procedural.py:3582`). The message in section 5
uses **308-311**, so the two surfaces do not disagree about the same source lines.

---

## 4. Why a modifier-type table is the wrong instrument here

This has to be stated before the design, because a reviewer's first instinct will be to reach for
one of the three tables that already exist. All three answer different questions, and the
repository has already paid for that mistake once.

- **`material_compiler._DEFORMING_MODIFIERS` (`material_compiler.py:1427`)** answers *"what is a
  rest-basis UV-space channel bake invariant to?"*. It therefore holds SUBSURF/MASK and six
  data-only kinds that move no vertex, and omits DISPLACE/MULTIRES. The repository records the
  measured cost of reusing it, verbatim, at `procedural.py:102-112`: run through the frozen-deformer
  refusal's scope gate on the ellie character it selects five unskinned publish-scoped meshes, **two
  of which deviate by exactly 0.000000 m across all 331 frames -- a 40% false-refusal rate on a hard
  stop.**
- **`_ALWAYS_DYNAMIC_MODIFIERS` (`procedural.py:94-100`)** answers a third, lightmap-safety question
  ("can this deform at all"), is consumed by `automatic_dynamic_reason` on `show_render` rather than
  `show_viewport` (`:2272`), and **contains ARMATURE itself** -- the very modifier this proof mutes.
  Unusable by construction.
- **`_FROZEN_DEFORMER_INPUTS` (`procedural.py:122-137`)** is the one table that was purpose-built,
  and it asks a narrower question than this proof needs: *can the modifier introduce motion from an
  ID-valued input that moves?* It deliberately omits CORRECTIVE_SMOOTH/SMOOTH/LAPLACIANSMOOTH,
  SUBSURF/MULTIRES/MASK, the data-only kinds, ARMATURE and NODES, each with the reason recorded
  inline at `:113-121`.

The bind-pose defect is not about a modifier's *inputs* moving. It is about the modifier running at
a non-rest pose, which any deformer downstream of the rig does -- including ones whose own inputs
are perfectly static, because the rig moved the *mesh* underneath them. No table over modifier types
separates that. **The design therefore uses no modifier-type table at all: the measurement decides,
and attribution is measured leave-one-out.**

That is also the repository's own recorded position twice over. `procedural.py:3033-3044`:
"Listing a type here is therefore never the decision." `procedural.py:3658-3667`: a purity gate over
modifier types "would refuse the good case and wave the bad one through", and "no predicate over
modifier types can certify exactness even for a perfectly pure cage."

---

## 5. The design

Five additions, in one Phase 0e section of `procedural.py` placed immediately after
`_skin_approximation_record` (ends `:3647`) and before the Phase 1 banner (`:3650`), plus one
export-time measurement site, one refusal, and the three TypeScript enumerations.

### 5a. Constants, derived rather than invented

```
# A correct rig's bind pose has EXACTLY zero deviation here: with the ARMATURE
# muted, a deformer the rig does not drive contributes the same thing in Pose
# and Rest position. So unlike the residual diagnostics -- which price an
# approximation with no true zero -- this one measures a contamination against
# a known zero, and the hard line is the shared 1% agreement line itself.
_BIND_POSE_REFUSE_FRACTION = _DISPLACEMENT_WARN_FRACTION      # 1%
_BIND_POSE_WARN_FRACTION = _DISPLACEMENT_WARN_FRACTION / 10.0 # 0.1%
```

The asymmetry against the other two diagnostics is the point and must survive review: the residual
diagnostics price an approximation that has no true zero, so 1% is a warn there. This one measures a
contamination that a correct rig has *none* of, so 1% is a refusal here.

### 5b. `bind_pose_integrity_plan(scene, objects=None)` -- depsgraph-free

Pure RNA. Zero depsgraph evaluation, zero frame stepping -- exactly the shape of
`frozen_deformer_issues` (`:2231`) and `deformer_lowering_plan` (`:4089`).

A candidate is: `obj.type == "MESH"`, not `obj.hide_render`, `len(obj.data.polygons) > 0`,
`_skinned_by_armature(obj)` is True (`:1984`), and `_lowering_live_modifiers(obj)` (`:3772`)
contains at least one non-ARMATURE modifier.

Per candidate record: `object`, `objectId`, `armature` (the *exporter's* selection --
`armatures[-1].object.name`, reusing the rule at `:3579-3585`, not the first ARMATURE and not the
scene's only rig), and `probed` = the live non-ARMATURE modifier names.

Returns `{"candidates": [...], "warnFraction": _BIND_POSE_WARN_FRACTION,
"refuseFraction": _BIND_POSE_REFUSE_FRACTION, "verified": False}`.

`verified: False` is the guarantee that an unmeasured proposal refuses nothing.

### 5c. `_bind_pose_points(obj, rig)` and `_rest_position(scene)`

`_bind_pose_points` opens `_applied_mesh(obj)` (`:3089`) and returns
`[tuple(pre @ v.co) for v in mesh.vertices]` with `pre = rig.matrix_world.inverted() @
obj.matrix_world` **recomputed inside the block**, plus the vertex count. Plain float triples rather
than `Vector`, for the reason recorded at `:4421-4426`.

`_rest_position(scene)` is a `@contextlib.contextmanager` that collects every distinct
`bpy.types.Armature` **datablock** reachable from `scene.objects` where `obj.type == "ARMATURE"`,
deduped by `data.as_pointer()`; saves `(data, data.pose_position)`; sets `pose_position = "REST"`;
calls `bpy.context.view_layer.update()`; yields; and in a `finally` restores the **literal authored
value** LIFO and updates again. Carry the comment the repository already uses at `:4370-4373` and
`:4858-4860`: a driver re-asserts itself on the next depsgraph update.

Three reasons this is the right switch:

- `pose_position` lives on the armature **data**, which several objects can share, so save/restore
  must be keyed by datablock, not by object.
- Flipping it is **one** whole-scene depsgraph rebuild that puts every rig-driven input -- HOOK
  targets, LATTICE objects, SHRINKWRAP cages, bone-parented empties -- into rest simultaneously.
  That is exactly the state the exported `inverseBindMatrices` assume, because the repository builds
  them from `bone.matrix_local` (`:4506`).
- Rest Position bypasses constraints, drivers and actions, so no action unbinding is needed.

### 5d. `verify_bind_pose_integrity(scene, plan)` -- one frame, two rebuilds

Structure: **one frame, two whole-scene depsgraph rebuilds, 2N evaluated meshes.**

1. `plan["verified"] = True`; return `[]` early if there are no candidates.
2. `restore_frame = scene.frame_current`; `scene.frame_set(_EXPORTER_FROZEN_FRAME)`;
   `view_layer.update()`. Frame 0 is the frame the glb bakes (`:3020-3026`).
3. **Posed pass.** For each candidate, `posed[name] = _bind_pose_points(obj, rig)`. This is
   literally what ships as the bind pose.
4. `with _rest_position(scene):` **rest pass** over the same candidates -> `rest[name]`.
5. If the two vertex counts differ, refuse with: *"the modifier stack evaluates to a different
   vertex count in Pose and Rest position, so the shipped bind pose cannot be compared to it vertex
   by vertex"* -- a bone-driven MASK does this. Otherwise
   `deviation = _lowering_worst(posed[name], rest[name])`, reusing `:4521` verbatim.
6. **Denominator:** `diagonal = _bbox_diagonal(obj)` measured **inside** the `_rest_position` block,
   and the record field named `restBboxDiagonal` so the number is reproducible.
7. **Score:** `fraction = deviation / diagonal`. Above `_BIND_POSE_REFUSE_FRACTION` ->
   `outcome: "contaminated"`, `severity: "refuse"`. Above `_BIND_POSE_WARN_FRACTION` ->
   `severity: "warn"`. Otherwise `outcome: "clean"`, `severity: "info"` -- and `deviation` is still
   recorded, because 0.000 is the positive evidence that the proof ran.
8. **Attribution, warn/refuse records only.** For each name in `record["probed"]`, mute that one
   modifier, re-run steps 3-5 for that object alone, and if the deviation collapses below the warn
   line append `{"name": ..., "type": ..., "removedDeviation": ...}` to `record["causedBy"]`.
   Restore `show_viewport` to its literal authored value in a `finally`. Same shape as
   `_shape_key_restoring_modifiers` (`:3186-3214`) and `_attribute_target_perturbation`
   (`:4796-4865`).
9. `finally: scene.frame_set(restore_frame); view_layer.update()`.

The two quantities being compared are exactly:

- **(A)** `_applied_mesh(obj)` at frame 0 with the rig in Pose -- byte-for-byte what
  `io_scene_gltf2` writes as POSITION, since it mutes only ARMATURE.
- **(B)** the same `_applied_mesh(obj)` with `pose_position = "REST"` -- the rest configuration the
  inverse bind matrices assume.

Their difference **is** the contamination three re-applies the bind matrices on top of. There is no
third quantity to model, no oracle to write, and no approximation being priced.

Attribution is measured leave-one-out rather than typed, per section 4. Probing every live
non-ARMATURE modifier rather than a table removes a hand-maintained list -- the stated recurring bug
class -- at a cost of 2 extra evaluations per modifier, spent only on objects that already failed.

### 5e. `_bind_pose_message(record)` -- the artist-facing sentence

One sentence carrying both numbers and naming the *measured* modifiers, in the idiom of
`_lowering_message` (`:4549`) and `_frozen_deformer_reason` (`:2149`):

> `<obj>`: its exported bind pose is `<d*1000:.3f>` mm (`<pct>` of the `<diag:.3f>` m rest
> bounding-box diagonal) away from its rest shape. Blender's glTF exporter mutes only the Armature
> modifier before it evaluates (io_scene_gltf2 nodes.py:308-311), so `<names>` still ran at the
> export frame's pose and that posed shape was written as the mesh's REST positions; the website
> then applies the inverse bind matrices -- which come from the bones' rest matrices -- on top of
> it, so the pose is applied twice. Put the armature in Rest Position and Apply `<names>` there so
> their contribution becomes part of the rest mesh; or delete them and carry the same shape as
> vertex-group weights on `<rig>`; or, if the deformation is meant to follow the pose, it has no
> glTF form and must become joint animation.

`<names>` is `record["causedBy"]` rendered with the existing idiom
`f"{item['name']!r} ({item['type'].lower().replace('_','.')})"` (`:2154`, `:3872`, `:4059`). When
`causedBy` is empty the sentence **must say so explicitly** -- "no single modifier's absence removes
it" -- exactly as `_shape_key_restoring_modifiers`' docstring requires at `:3191-3193`.

Both numbers appear because they do different jobs: the millimetres are what the artist acts on and
are pose-independent; the percentage is what the threshold is expressed in and is not. That is
`_lowering_message`'s precedent.

The citation was changed from the input's `nodes.py:305-313` to `nodes.py:308-311` to agree with
`procedural.py:3582`. See section 3.

### 5f. The `analyze_scene` contract field

Compute `bind_pose = bind_pose_integrity_plan(scene, objects=scoped_objects)` next to the
`frozen_deformers` call at `procedural.py:4931` and publish it as `"bindPoseIntegrity": bind_pose`
in the return dict beside `"frozenDeformers"` (`:4943`) and `"deformerLowerings"` (`:4948`), with
the same comment shape: depsgraph-free, `verified` False until the exporter measures it, nothing
acts on an unverified proposal.

This keeps the live addon able to show the candidate set without evaluating anything, and keeps the
sidecar the single carrier between analyze and export -- the contract `deformerLowerings` already
uses (`export_scene.py:6399` reads it straight back out of `sidecar["diagnostics"]`).

### 5g. The export-time measurement site

Immediately after the `verify_deformer_lowerings` block ends (`export_scene.py:6406`), before
`lowered_objects` at `:6407`:

```
    # Phase 0e. The exporter mutes only ARMATURE before it evaluates, so every
    # other deformer bakes the export frame's POSE into what ships as the REST
    # mesh, and the runtime re-applies the bind matrices on top. analyze_scene
    # produced the depsgraph-free candidate set; this is the only place that
    # measures it, because measuring costs two evaluated meshes per candidate
    # and two whole-scene depsgraph rebuilds -- at ONE frame, not a sweep.
    bind_pose_plan = sidecar["diagnostics"].get("bindPoseIntegrity") or {}
    if bind_pose_plan.get("candidates"):
        progress(0.31, "proving bind-pose integrity")
        procedural.verify_bind_pose_integrity(bpy.context.scene, bind_pose_plan)
        sidecar["diagnostics"]["bindPoseIntegrity"] = bind_pose_plan
    warnings.extend(
        record["message"] for record in bind_pose_plan.get("candidates", ())
        if record.get("severity") == "warn" and record.get("message")
    )
```

Once per export, not per object per frame, and only when the RNA predicate found candidates -- the
identical gate `verify_deformer_lowerings` uses one block above. `progress(0.31, ...)` slots between
the existing 0.30 and the next tick.

**Placement against Phase 1 is load-bearing and must not be "fixed".** This runs after the lowering
measurement and long before `prepare_lowered_skins`, which runs inside `emit_gltf`
(`export_scene.py:6516`). A lowered object gains its synthetic ARMATURE only at that later point, so
it is correctly *not* a candidate here, and its own end-to-end residual is already measured by
`verify_deformer_lowerings`. Moving the bind-pose proof later would double-count the lowering's
approximation as contamination and could refuse an export Phase 1 has just repaired.

### 5h. The refusal

At the geometry refusal door, after the `frozen_deformers` `SystemExit`
(`export_scene.py:6436-6455`) and before the `dropped_shape_keys` block (`:6456`):

```
    contaminated = [
        record for record in bind_pose_plan.get("candidates", ())
        if record.get("severity") == "refuse"
    ]
    if contaminated:
        raise SystemExit(
            "Geometry Fidelity blocked:\n  - " + "\n  - ".join(
                record["reason"] for record in contaminated
            )
        )
```

`export_scene.py:6419-6423` states the rule this obeys: a record that says "refuse" and does not
refuse reads as a guarantee it is not, so every geometry refusal leaves by the same door. The
`SystemExit` with the same `"Geometry Fidelity blocked"` prefix keeps the artist-facing surface
identical to the three refusals already there.

### 5i. The three TypeScript enumerations

They must move together. This is the instance of the recurring bug class, and the projection's own
comment is the argument (`sceneDiagnostics.ts:2254-2256`).

1. **`BlenderSceneDiagnostics`** (`:613`), beside `frozenDeformers?` (`:639`) and
   `deformerLowerings?` (`:656`): add
   `bindPoseIntegrity?: { candidates: BindPoseIntegrityDiagnostic[]; warnFraction: number;
   refuseFraction: number; verified: boolean }` plus an exported `BindPoseIntegrityDiagnostic`
   (`object`, `objectId?`, `armature`, `probed`, `causedBy?`, `deviation?`, `restBboxDiagonal?`,
   `deviationFraction?`, `outcome`, `severity`, `message?`, `reason?`). Document the
   absent-vs-empty rule in the same words the neighbouring fields use.
2. **The manifest-report interface** (`:699`), beside `frozenDeformers?` (`:723`) and
   `deformerLowerings?` (`:731`).
3. **The projection body**: a `bindPoseIntegrity` const built by explicit field-by-field copy --
   deep-copying `probed` and `causedBy`, never aliasing the sidecar graph -- sorted by
   `object.localeCompare`, with derived `contaminated` / `warnings` / `refusals` counts, spread into
   the returned report next to `...(deformerLowerings ? { deformerLowerings } : {})` (`:2365`).

Typing the field without projecting it produces a diagnostic that exists in the sidecar and silently
vanishes from the manifest.

### 5j. Test wiring

- **`packages/blender-addon/tests/run_headless.py`** -- extend the existing Phase 1 synthetic-rig
  block (`DEF-Jaw` / `CTRL-Jaw`, keyed at frames 1 and 10, built at 654-685). Add a mesh that **is**
  skinned (an ARMATURE modifier to that rig with a `DEF-Jaw` vertex group) **and** carries a LATTICE
  whose lattice object is bone-parented to `DEF-Jaw`. With a nonzero pose at frame 0, assert
  `verify_bind_pose_integrity` yields `outcome: "contaminated"`, `severity: "refuse"`, `causedBy`
  naming exactly the LATTICE modifier, and a `deviation` matching the hand-computed bone offset.
  Then unparent the lattice and assert `deviation == 0.0`, `outcome: "clean"`, `severity: "info"`.
  **The zero case is the load-bearing half**, because it is what proves the proof does not
  false-refuse every rig. The suite is already registered (`BLENDLINK_ADDON_TESTS_PASSED`, `:12144`).
- **Restoration proof.** Reuse the idiom at `run_headless.py:727-746` and `:782-790`: capture
  `(obj.data.as_pointer(), obj.data.name, [g.name for g in obj.vertex_groups],
  [(m.type, m.name, m.show_viewport) for m in obj.modifiers], len(bpy.data.meshes))` before and
  after, and **additionally** `[(d.name, d.pose_position) for d in bpy.data.armatures]`. Assert
  equality. The `pose_position` half is new and is the one thing this proof can leak that no
  existing test covers.
- **The depsgraph-free half never refuses.** Assert `bind_pose_integrity_plan(scene, objects=...)`
  returns `verified is False` and that every candidate has no `deviation` key, mirroring the Phase 1
  assertion at `run_headless.py:711-722`.
- **Optional alternative:** a new `tests/bind_pose_integrity_check.py` printing
  `BLENDLINK_BIND_POSE_INTEGRITY_CHECK_PASSED`. Discovery is automatic, but add
  `['bind_pose_integrity_check.py', 'bind-pose integrity proof contract']` to `SUITE_LABELS`
  (`scripts/test-addon-headless.mjs:20-51`) or the console line degrades to a derived label. A
  missing label cannot make the suite not run, by design.
- **`packages/blendlink/src/sceneDiagnostics.test.ts`** -- add a `bindPoseIntegrity` case beside the
  `frozenDeformers` block at `:1419-1448`, with the same three assertions: a sidecar without the key
  produces a report without the key; an empty `candidates` array produces
  `{ objects: [], contaminated: 0, verified: false }`; and the projection deep-copies.
- **Conformance artifacts: not required.** See section 2.
- **End to end:** `npm run test:addon-headless` is the gate; `npm run test:baked-e2e` and
  `npm run test:package` will exercise the new export-time `SystemExit`. **Before landing, grep the
  e2e and dogfood fixture scenes for a skinned mesh carrying a non-ARMATURE deformer** -- a new
  refusal that fires on an existing fixture turns a passing e2e red at the export door, not in a
  unit test.

---

## 6. Risks the design already knows about

These are carried forward from the input, verified against HEAD, and are the reasons the deferral in
section 7 is the honest call rather than a delay.

- **The threshold is unmeasured.** The design sets the refusal line at the shared 1%
  (`_DISPLACEMENT_WARN_FRACTION`), which catches the 28.135 mm lips only if the owning mesh's rest
  bounding-box diagonal is under about 2.8 m. The two diagonals recoverable from
  `procedural.py:3550-3552` (jacket ~0.386 m, body ~0.776 m) would put 28.135 mm at roughly 3.6% on
  the body -- comfortably above 1% -- but **the lips' actual owning mesh is not identified in the
  recorded evidence.** Run the probe and record the fraction *before* committing the constant. Do
  not ship a fraction that lets the known-bad case through, and do not silently swap in an absolute
  millimetre line without a scale argument.
- **The denominator is pose-sensitive and the repository has already been burned.** `_bbox_diagonal`
  reads `obj.bound_box`, which "tracks the current evaluated pose" (`:3139-3141`), and `:3559-3561`
  records the 1.627% / 1.083% versus 1.62% / 0.91% divergence for identical millimetre figures. This
  proof evaluates in two states, so the record **must** name which state's diagonal it divided by
  (`restBboxDiagonal`) or the percentage is not reproducible.
- **The proof is blind to scene-time deformers on skinned meshes.** Flipping `pose_position` does
  not move a WAVE, a keyframed DISPLACE, or a HOOK bound to a non-rig empty with its own action --
  so those measure 0.0 deviation and still freeze into the glb. And `_frozen_deformer_issue` cannot
  catch them either, because `:2194-2195` returns `None` for every skinned mesh. If this gap is not
  named inside the record -- or closed by partitioning that early return per modifier -- an empty
  `bindPoseIntegrity` reads as a guarantee it is not, the exact failure `export_scene.py:6419-6423`
  exists to prevent.
- **`pose_position` lives on the armature data.** A leaked REST flag would silently un-pose the
  artist's whole scene. Save/restore keyed by `data.as_pointer()`, restore the literal authored value
  LIFO in a `finally`.
- **The memory shape differs from the precedent that will be cited against it.**
  `procedural.py:4805-4807` explicitly refused to cache a first-sweep snapshot because "caching would
  size peak memory by the artist's frame range." The batched form here caches one rest snapshot sized
  by **candidate count at a single frame** -- a different and acceptable shape. Say so in the comment,
  or a reviewer will move it to a per-object flip and pay N whole-scene depsgraph rebuilds instead of
  two.
- **`_applied_mesh` yields `obj.data` itself when the object has zero modifiers** (`:3106-3110`). A
  bind-pose candidate always has at least the ARMATURE, so that branch is unreachable today -- but
  any future widening of the candidacy predicate reaches it and would then compare the source Mesh
  against itself and read a confident 0.0. **Guard the candidate predicate, not the measurement.**
- **A mesh skinned by bone-parenting (no ARMATURE modifier) is not a candidate**, because
  `_skinned_by_armature` (`:1984-1997`) is modifier-based to match the exporter's own test. That is
  correct -- bone-parenting ships as a node transform, not a skin -- but the record must not claim
  coverage it does not have.
- **Ordering against Phase 1**, restated because it is the easiest thing to "fix" wrongly: see 5g.

---

## 7. Why this was deferred

The measurement is sound. It compares two evaluations of the same `_applied_mesh` read at one frame,
against a known zero, using metric and thresholds the repository already owns. There is no oracle to
invent and nothing to approximate. That is not the reason it did not land.

**It adds a depsgraph-heavy diagnostic during a release.** 0.9.0 is being cut. Two whole-scene
depsgraph rebuilds plus 2N evaluated meshes, plus leave-one-out attribution on every failing object,
is a new cost on every export of every rigged scene. Its budget is defensible and its gate is the
same one `verify_deformer_lowerings` uses -- but "defensible" is an argument, and a release is the
wrong place to have it. This work needs its headless suite green and its cost measured on a real
character before anyone weighs it, not a version bump running underneath the discussion.

**It adds a new `analyze_scene` contract field during a release.** `bindPoseIntegrity` has to appear
in the sidecar, in `BlenderSceneDiagnostics`, in the manifest-report interface, and in the
field-by-field projection -- four surfaces, three of them in TypeScript, and the manifest is
content-hashed. A schema-visible field is exactly the kind of change that should open a cycle rather
than ride one out.

**The candidate set without the measurement would produce false positives on ordinary SUBSURF
stacks.** The depsgraph-free predicate admits any render-visible skinned mesh with at least one live
non-ARMATURE modifier. On an ordinary rigged character that is close to every mesh in the scene: a
SUBSURF, a CORRECTIVE_SMOOTH, a MASK, a WEIGHTED_NORMAL. None of those is a bind-pose defect, and the
predicate cannot tell -- by design, because section 4 establishes that no modifier-type table can.
The measurement is what converts a list of suspects into a finding. Shipping the plan alone -- for
instance surfacing candidates in the live addon UI ahead of the verifier -- would name clean stacks
and teach artists to ignore the diagnostic before it ever says anything true.

**So the honest sequence is to land the whole thing, with its headless suite, at the start of the
next cycle rather than beside a version bump.** Plan, verifier, refusal, the three TypeScript
enumerations, the two-state restoration proof and the zero case, in one change, measured on a real
character first. Not half of it now.

This is tracked as the pending task "Add the bind-pose integrity proof".

---

## 8. What is still owed

Nothing here is blocked on a decision. Each item is a measurement.

1. **The threshold.** Run the two-pass probe on the production character, identify the mesh owning
   the 28.135 mm lip displacement, and record `deviation / restBboxDiagonal` for it. The 1% constant
   is not committed until that fraction is known to exceed it.
2. **The blind spot.** Decide whether the record names the scene-time-deformer gap in words, or
   whether `_frozen_deformer_issue`'s skinned early return (`procedural.py:2194-2195`) is
   partitioned per modifier so a WAVE or keyframed DISPLACE on a skinned mesh is caught by Phase 0a
   instead. The second is better and is a larger change; the first is the minimum that keeps an
   empty `bindPoseIntegrity` from reading as a guarantee.
3. **The fixture sweep.** Grep the e2e and dogfood scenes for a skinned mesh carrying a
   non-ARMATURE deformer, and measure it, before the refusal exists. A new hard stop that fires on an
   existing fixture fails at the export door.
4. **The cost.** Measure wall-clock for the two rebuilds plus 2N `to_mesh` calls on a real character,
   so the release conversation deferred in section 7 has a number rather than an argument.
5. **The `causedBy`-empty case.** Unproven. The design requires the message to say "no single
   modifier's absence removes it", but whether a real stack produces that outcome -- two deformers
   each individually insufficient -- has not been observed on any character. The eyelashes precedent
   at `procedural.py:3191-3193` says it happens for shape-key containment; nothing yet says it
   happens here.
