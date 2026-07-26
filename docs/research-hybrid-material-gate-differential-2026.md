# Mixed-Hybrid material ownership gate, 2026

Status: **Shipped behavior; Verified by a frozen-source real-Blender
differential on 2026-07-25**

## Question

When one `needsBake` material is used by both an Appearance receiver and a
live Dynamic object, may the Appearance bake exempt the material globally?
Likewise, may a Lighting receiver be exempt because it appears in a bake plan?

No. Ownership conceptually belongs to the material **occurrence**:

- Appearance replaces the complete visible Surface of its static receiver;
- Dynamic objects retain the live material;
- Lighting atlases retain the live PBR material and add indirect lighting.

Only the first occurrence is resolved by the bake. The current planner and
diagnostic contract carries bare object names rather than stable occurrence
IDs, so Blendlink exempts it only when that name maps to one unambiguous plan
occurrence. Duplicate or conflicting names refuse; they are never guessed.

## Designs compared

### A. Material-wide exemption

Exempt a `needsBake` diagnostic when any object using that material appears in
an Appearance atlas. This is a shallow rule, but it silently blesses a shared
Dynamic occurrence. Extending the same rule to any bake-plan object also
silently blesses Lighting, whose runtime still needs the authored material.

**Rejected.**

### B. Unambiguous unique-name occurrence ownership

Derive the set of static Appearance-owned object names from the exact
Preview/Final bake plan. Remove a name from each material diagnostic's
`usedBy` list only when it identifies one unambiguous Appearance occurrence
with no live conflict. Keep duplicate/conflicting, Dynamic, Lighting, and
unplanned names. Apply the same inspection to the exact staged export before
optimization or publication.

**Chosen.** The planner and compiler cross one package-owned interface:
`inspectRealtimePlanMaterialDiagnostics`. The caller does not reconstruct
ownership policy.

### C. A second plan-only Blender pass before compile

Run planning first, then run the real staged export when planning passes.
This would reuse the public planner behavior but doubles Blender evaluation
and permits the source/config revision to differ between classification and
candidate export.

**Rejected.** The staged candidate already contains both its exact bake plan
and diagnostics; classifying that result has greater locality and avoids a
second Blender transaction.

## Needle baseline

Pinned Needle Blender add-on `1.4.2`
`lightmapping/lightmapping.py` (`SHA-256
4e69f0934d9329b2d8480b097baa1d903aa31bed9337c7a2ae0630cbc900b4f1`)
selects each eligible object receiver, attaches one shared image to the actual
materials, and invokes one native multi-object bake while the receivers remain
separate. Its companion
`lightmapping/lightmapping_pack.py` (`SHA-256
242aad7a29c177ac566ad519425ec55cb0376805d02197a0519107a761801cd3`)
keeps per-object atlas transforms.

That supports the object-occurrence ownership principle. No analogous
material-portability publication gate was found in the audited Needle Blender
export wrapper: ordinary materials flow through Blender's stock glTF exporter.
Blendlink therefore matches the useful ownership model and adds a scoped,
artist-readable refusal rather than claiming material parity from a successful
stock export.

The local source identity is governed by
[`needle-baseline.json`](needle-baseline.json); this note does not promote the
mixed-source inventory to a coherent production Needle stack.

## Differential

The fixture and one-command runner are in
[`experiments/hybrid-material-gate-differential`](../experiments/hybrid-material-gate-differential/).
It generates a Cycles-authored `.blend` containing:

| Object | Material | Authored disposition | Required result |
| --- | --- | --- | --- |
| `Appearance Receiver` | `Shared Painterly Surface` | static Appearance | exempt this occurrence |
| `Dynamic Survivor` | `Shared Painterly Surface` | explicit Dynamic, authored atlas preference retained | refuse this occurrence |
| `Lighting Receiver` | `Lighting Painterly Surface` | static Lighting | refuse this occurrence |

Both materials use Noise Texture → Color Ramp → Principled Base Color. They
are valid Cycles inputs but cannot be represented as editable stock glTF, so
the run reaches the ownership gate instead of failing on an unrelated
Appearance-bake blocker.

The gate must prove all of the following:

1. Preview plan exits `1`, returns a real plan, and reports only Dynamic and
   Lighting occurrences.
2. Final plan does the same.
3. The source `.blend` SHA-256 is unchanged after each operation.
4. A forced Final compile exits `1` after creating the real staged candidate.
5. A seeded valid GLB, schema-3 manifest, and generated TypeScript module
   remain byte-identical.
6. No `.blendlink-stage-*`, `.blendlink-next-*`, or
   `.blendlink-backup-*` artifact survives.
7. Blender, exporter, Blendlink dist, fixture, config, runner, and Needle
   source identities are recorded in `evidence.json`.

## Result

The frozen-source command passed:

```powershell
node experiments/hybrid-material-gate-differential/run.mjs
```

```text
BLENDLINK_HYBRID_MATERIAL_GATE_DIFFERENTIAL_PASSED
source=52a67ec99480b86a38b4f8d7f98f34d22149c4cbb541a04146847d5de2e8c350
dist=199693d5258136a981a531a72b0c6b132becaa37058aef023131f454afdff47c
preview=1 final=1 compile=1 preserved=3
```

The exact environment was Blender `5.2.0 LTS`, build
`fbe6228777e7` (executable SHA-256
`e27fbfea8564aa645d4463cb0949695fd85562b9de6df9561b06859a1074adf7`),
installed glTF exporter `5.2.39`, Blendlink `0.8.0`, and Node
`v24.15.0`. The ten-file Blendlink dist identity was
`199693d5258136a981a531a72b0c6b132becaa37058aef023131f454afdff47c`.

Preview and Final each returned the same two errors:

- `Shared Painterly Surface` was unresolved only for `Dynamic Survivor`;
- `Lighting Painterly Surface` was unresolved for `Lighting Receiver`; and
- neither result named `Appearance Receiver`.

The `.blend` retained SHA-256
`52a67ec99480b86a38b4f8d7f98f34d22149c4cbb541a04146847d5de2e8c350`
after generation, Preview planning, Final planning, and forced Final
compilation. Compile refused in `3.693s`, explicitly said the staged export
was discarded, and preserved all three seeded artifacts:

| Artifact | Bytes | SHA-256 before and after |
| --- | ---: | --- |
| GLB | 132 | `bb150e0bff921618a55c2ee4d8a283fbde9be42e4963d102ff30fb0f21b41c76` |
| manifest | 540 | `2148a547fa80147c1781b97d601bb040981bc4a40fbdd487e43247b0d32fcf44` |
| generated module | 138 | `5bd0929bb0687911f6443b585bb8f31ac71f65089d224611ae35fd86ece98593` |

No stage, next-file, backup-file, baked recipe, atlas, or runtime-publication
companion survived. The complete machine-readable identities and exact
diagnostics are in
[`evidence.json`](../experiments/hybrid-material-gate-differential/evidence.json).
That report has SHA-256
`dbfa61863c3e76158c260fb5318c159639421ce851729b2fe8c85c4f2c3471a7`.
The generated `.blend` byte identity has changed across historical Blender
runs; the durable assertion is that all four checkpoints within this named
run match, not that every future generation reproduces the same binary.

This gate is compiler/transaction evidence. It does not prove browser pixels,
texture quality, or authenticated Needle production-transform behavior.
Its object names are unique, so conflicting duplicate-name refusal remains
separate focused-test evidence rather than a claim of this real-Blender cell.
