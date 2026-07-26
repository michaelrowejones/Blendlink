# Evaluated render-used material bindings

Date: 2026-07-25

Status: **Shipped and verified** for in-scope Mesh export with Blendlink's
owned `export_apply=True` and `export_skins=True` contract. Non-Mesh
conversion remains outside this cell.

## Question

Should a material attached to a Mesh count as `usedBy` when no exported
primitive uses its slot? The concrete failure was one triangle using a
portable Principled material in slot 0 while an unsupported Noise-driven
material remained attached in slot 1. The preflight reported both materials
and could block publication even though Blender omitted slot 1 from the GLB.

## Pinned baseline

`npm run verify:needle-baseline` passed on 2026-07-25:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 130 files, 9 source version identities
(2026-07-25) integration=mixed-source
named=splash-official-preview:coherent
```

The relevant Needle behavior is its unmodified stock-export path:

| Source | Version / normalized path | SHA-256 | Relevant behavior |
| --- | --- | --- | --- |
| Needle Blender add-on | 1.4.2, `blender_export.py` | `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77` | `__runExport` calls `bpy.ops.export_scene.gltf`, requests `export_apply=True`, and does not replace the exporter's material/primitive gather. |
| Blender glTF exporter | 5.2.39, `__init__.py` | `0cd8903bd1a72ef1edbd728bee70d24a3ecc93c9901db68927b00910bb38be70` | `export_materials` defaults to `EXPORT`; `export_apply` means the evaluated Mesh is exported after modifiers. |
| Blender glTF exporter | 5.2.39, `blender/exp/nodes.py` | `43e09e51a9d200ceee03e97881769f061ab5ad6d706eaba6b2cec4f3d3b278ee` | With no modifiers, material lookup comes from object slots. With modifiers and `export_apply`, the exporter disables every ARMATURE modifier while `export_skins=True`, evaluates the temporary Mesh, restores each `show_viewport` value, and uses that Mesh's materials. An evaluated material table exactly equal to `[None]` falls back to the source object slots. |
| Blender glTF exporter | 5.2.39, `blender/exp/primitive_extract.py` | `f3ca65fec33fa15b0360a1621ec621d74cbbf7e42ab25405aa2cd8b798933261` | `primitive_split` reads triangle `material_index` values, takes their unique set, and creates primitives only for those indices. |
| Blender glTF exporter | 5.2.39, `blender/exp/primitives.py` | `5b5e18e43a5db65d3012809c71006d5c4a8a69ab014d5f9477fc421ab46b5eb0` | Each extracted primitive resolves only its own material index. |

The installed Needle file is under the content-identified add-on root recorded
in `docs/needle-baseline.json`. The installed Blender files are under
`Blender 5.2/5.2/scripts/addons_core/io_scene_gltf2/`.

The [Blender 5.2 glTF manual][blender-manual] is useful supporting
documentation: it names evaluated-mesh export after modifiers and describes
glTF materials in terms of exported primitive groups. The installed exporter
source and the emitted GLB remain the behavior-level truth for this cell.

## Designs compared

### A. Read source slots and source face indices

This is cheap and fixes the one-triangle fixture, but it is wrong after a
modifier or Geometry Nodes changes material assignment. It can suppress a
material that Blender actually exports.

### B. Export first, then inspect the GLB

This exactly observes the final artifact, but it is too late for the preflight
and would make artist-facing diagnostics depend on a complete export. It also
forces the Blender-side compiler to learn the GLB material/node mapping merely
to answer a source-ownership question.

### C. Share evaluated material ownership before export

Chosen. `procedural.evaluated_material_uses(obj)` mirrors the stock exporter's
owned split:

- no modifier: source face indices plus object-resolved material slots;
- any modifier: `evaluated_get(...).to_mesh(...)`, evaluated face indices, and
  evaluated Mesh materials;
- because Blendlink owns `export_skins=True`, temporarily disable all ARMATURE
  modifiers before acquiring the current dependency graph and evaluating the
  Mesh, clear the temporary Mesh first, then restore every original
  `show_viewport` value in `finally`;
- when the evaluated material table is exactly `[None]`, use the source object
  slots as the exporter's narrow fallback (other `None` shapes stay literal);
- only material indices owning evaluated faces are returned;
- evaluated-only/reordered materials remain visible in the result;
- a private compiler substitution is allowed only when the material remains at
  the identical editable source slot.

This is a deep module: callers learn one interface while evaluation,
normalization to original material IDs, deterministic ordering, cleanup, and
source-ownership ambiguity stay inside it. `analyze_scene` and
`material_compiler` now cross the same seam.

## Test-first evidence

Regression fixture:
`packages/blender-addon/tests/evaluated_material_bindings_check.py`

The script generates its Blender data in-process, writes
`one-used-slot.blend` as a source artifact in an isolated temporary directory,
and exports five independent stock GLBs:

1. one used portable slot plus one attached-but-unused unsupported slot;
2. the same ownership through an evaluated Triangulate modifier;
3. a Geometry Nodes `Set Material` assignment that exists only in the
   evaluated Mesh;
4. a generated cube whose evaluated material table is exactly `[None]`, with
   an unsupported source material that must remain the emitted primitive and
   the Needs Bake preflight owner;
5. a skinned triangle whose enabled armature deformation makes downstream
   Geometry Nodes choose a different material. With `export_skins=True`, stock
   export disables both a visible and already-hidden ARMATURE modifier,
   chooses the undeformed source material, and restores the exact mixed
   `show_viewport` states.

Before the fix, the exact command failed deterministically twice:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python 'packages\blender-addon\tests\evaluated_material_bindings_check.py'
```

```text
AssertionError: attached-but-unused unsupported material became render-used:
['Unused Unsupported', 'Used Portable']
```

The stock GLB assertion ran first and passed: it contained one primitive and
only `Used Portable`. After the shared helper was installed, the same command
passed:

```text
BLENDLINK_EVALUATED_MATERIAL_BINDINGS_PASSED
blender=5.2.0 LTS used=1 unused=1 evaluatedOnly=1 noneFallback=1 skinArmature=1
```

The evaluated-only selected Website Material remains a loud
`material.evaluated-binding-unsupported` error because no identical editable
source slot can be safely replaced.

The two exporter-alignment additions were also red before the helper changed.
They were run independently by setting
`BLENDLINK_EVALUATED_MATERIAL_CELL` to `none-fallback` and `skin-armature`,
respectively, before the same Blender command above. The `[None]` fixture first
failed with:

```text
AssertionError: Blendlink did not mirror stock [None] material fallback:
(EvaluatedMaterialUse(evaluated_slot_index=0, material=None,
source_slot_index=None, source_candidate_indices=()),)
```

The armature fixture independently failed with:

```text
AssertionError: Blendlink did not evaluate material ownership with skin
ARMATURE modifiers disabled:
(EvaluatedMaterialUse(evaluated_slot_index=1,
material=bpy.data.materials['Skin Deformed Material'],
source_slot_index=None, source_candidate_indices=()),)
```

In the green fixture, each stock GLB primitive and each Blendlink use/plan
names the same material. Both new source materials are deliberately
non-portable Noise-driven graphs, so `analyze_scene` also proves that the
correct material—not merely some material identity—owns the Needs Bake
publication consequence. Repeated helper, scene-analysis, plan, and stock
export calls preserve the source ARMATURE states `(True, False)` and leave the
saved `.blend` clean.

Focused regressions also passed on Blender 5.2.0 LTS:

```text
BLENDLINK_MATERIAL_COMPILER_CHECK_PASSED
BLENDLINK_PLAN_MATERIAL_DIAGNOSTICS_CHECK_PASSED
```

The dedicated differential is part of `npm run test:addon-headless` through
`scripts/test-addon-headless.mjs`.

The same headless suite now also proves that the public export contract cannot
invalidate this analysis after preflight. `run_headless.py` independently
passes conflicting `exporterOverrides` for `export_apply=False` and
`export_skins=False`; `gltf_export_contract()` rejects each with the
artist-readable `evaluated-material contract` diagnostic. The red control
previously accepted `export_apply=False` and failed with:

```text
exporter override silently replaced evaluated-material setting export_apply
```

`npm run test:addon-headless` passed with the five-cell differential and both
override-refusal cells on 2026-07-25.

## Needle relation

**Relation: Improvement. Implementation: Shipped. Evidence: Verified
2026-07-25.**

Needle matches Blender's final result by delegating to the stock exporter, but
the inspected add-on has no analogous preflight that distinguishes a used
primitive material from an attached unused slot. Blendlink now matches the
stock/Needle emitted material set before export and adds an artist-readable,
source-safe refusal when evaluated material ownership cannot support a private
compiler transaction.

## Limits

- This cell covers Mesh objects under Blendlink's owned `export_apply=True`
  and `export_skins=True` contract. The advanced `exporterOverrides` object
  cannot replace either flag; both conflicts now refuse before export. Curves,
  text, surfaces, Grease Pencil, and other conversion paths need their own
  exporter-aligned evidence.
- Loose-edge and loose-point export are not enabled by Blendlink's current
  export contract and are not claimed here.
- The helper resolves the current evaluated dependency graph. Timeline-varying
  geometry remains governed by the separate exhaustive procedural audit.
- A generated material can be inspected without a source slot. It cannot be
  privately replaced until a source-owned binding transaction is independently
  proved.
- Stock glTF Geometry Nodes instance vnodes have their own gather path and are
  not ordinary evaluated Mesh component data. Handling their per-instance
  material ownership in this helper would be an unsupported inference.
  **Gap / Future:** the current generic unrealized-instance Fidelity advice is
  not a material-ownership proof. A separate differential and a precise, loud
  material preflight are required before this path can be claimed as supported.

[blender-manual]: https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html
