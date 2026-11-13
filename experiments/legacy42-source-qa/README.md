# Legacy native source QA continuation

This audit covers every automatically discovered addon source suite
alphabetically after `desktop_task_check.py`, with `run_headless.py` last.
Manual installed-ZIP/reinstall/sync suites remain outside this continuation;
the parent task owns rebuilt-install proof. Earlier compositor numeric corpora
are not regenerated. This is source/operator/native-export QA, not browser
numeric or release certification.

From an isolated checkout with locked dependencies, run:

```sh
BLENDLINK_BLENDER=/absolute/path/to/verified/Blender4.2 \
BLENDLINK_LEGACY_QA_EVIDENCE=/tmp/blendlink-legacy-source-proof \
npm exec --yes --package=node@24 -- node experiments/legacy42-source-qa/run.mjs
```

`--only evaluated_geometry_check.py,run_headless.py` selects a focused subset.
The runner requires the official 4.2.0 build `a51f293548ad`, starts a fresh
factory process for each suite with private `BLENDER_USER_RESOURCES`, records
nonzero exits/signals even after a success sentinel, and continues after
failures. Reports are saved before and after each process. They contain native
identity, production and fixture hashes, logs, signals, explicit unavailable
markers and final source stability. No build, user preferences, real source
scene, installed addon or public artifact is changed.

The original stable source receipt at base `3c98ce7` is retained in the QA
worker `artifacts/legacy42-remaining-source/report.json`: 79 of 87 suites
passed; the eight failures were evaluated geometry, evaluated material
bindings, material bake, material compiler, overlay GPU, preparation cache,
presentation and omnibus. The fixes are divided into product and fixture
commits rather than weakening a common assertion.

## Product findings

- UV pin inspection created hidden `.pn.` corner data, changing bake-cache
  fingerprints; direct storage inspection now preserves the attribute roster.
  Private storage names are qualified only for actual 4.2.0/5.2.0/5.3.0;
  unknown versions retain the public collection fallback. Writes materialize
  storage before reacquiring UV layers. Native pin and context regressions
  passed all three versions, including the original heap-corruption control.
- Native 4.2 `uv.select_linked` requires an Image Editor context. A scoped
  temporary editor override restores the previous area/subtype on success and
  exception. The original native selection crash receipt remains in
  `artifacts/cache-fixture-fixed/native-source.crash.txt`.
- A private PNG reload/rewrite rounded resolution through integer pHYs, causing
  different EXIF bytes from the native glTF channel repack. Decoded pixels and
  IDAT already matched. Preserving the live source resolution restores strict
  byte/MIME/hash attestation; no hash check is relaxed or image substituted.
  Default and custom DPI controls plus full material-bake checks pass all three
  native versions. Original bytes are in `artifacts/attestation-trace`.
- [Area strength qualification](AREA_STRENGTH.md) supplies the actual 4.2.0
  normalized-power/zero-exposure interpretation only when both newer RNA fields
  are absent. Every actual native call site passes `bpy.app.version[:3]`:
  validation recompute, sidecar collection, GLB RectArea normalization and final
  published diagnostics. Pure callers acquire no guessed defaults. Missing
  fields on other versions and present malformed fields remain refusals. The
  existing Three radiometric/size conversion is unchanged.
- Native 4.2 Curve to Mesh uses curve radius internally and lacks the modern
  Scale input. The modern explicit field link is retained; actual authored
  endpoint radii and private mesh/group/object cleanup pass all three versions.
  Legacy `GPENCIL` has no native modern drawing converter, so preflight now
  gives a named refusal rather than promising an unavailable route. Modern
  Grease Pencil, Hair Curves and childless particle realization checks remain.
- Native 4.2 adds an identity F-Curve Generator to every driver. The classifier
  now exempts only a `GENERATOR` in `POLYNOMIAL` mode, order 1, nonadditive,
  coefficients exactly `(0, 1)`. Muted modifiers retain their previous behavior;
  all other active mappings stay conservative. Frame expressions, animated
  inputs/actions and dependency inspection are still required. Actual constant
  and frame-changing values were captured independently on all three versions.
  [Pinned BKE source](https://github.com/blender/blender/blob/v4.2.0/source/blender/blenkernel/intern/fcurve.cc)
  `evaluate_fcurve_driver` substitutes the driver result for modifier time.

## Fixture findings and limits

The fixtures choose actual engine enums, construct the actual legacy drawing
schema, explicitly create shader trees, bulk-write pins after releasing native
iterators and reacquire UV wrappers after attribute materialization. All UV,
modifier, material, GLB ownership and restoration checks remain.

Native 4.2 background saves have no post-save UI notification loop; its dirty
bit is explicitly **not applicable**, not mocked clean. The evaluated-binding
fixture independently hashes source geometry/UVs, object state, material slots,
modifier flags/targets and material programs before and after inspection.
Modern dirty-bit assertions stay active.

Three unavailable contexts are explicit rather than treated as numeric passes:

- Legacy overlay drawing prints `BLENDLINK_OVERLAY_GPU_UNAVAILABLE`; its source
  protocol completes without claiming an actual draw.
- Stock 4.2 glTF exporting a grouped Cycles Sun raises the witnessed
  `ShaderNodeTree.append` error. Only that exact version/error is accepted as
  unavailable. Blendlink's approximate/no-numeric diagnostic is still checked,
  and modern actual grouped export checks remain. The stock failure is retained
  in `artifacts/omnibus-after-legacy-light-fixture-2`.
- The actual 4.2 exporter is 4.2.57, outside the existing 5.2.39-only material
  relaxations. The fixture runs those rules with an explicit controlled version
  probe, prints `BLENDLINK_MATERIAL_RELAXATIONS_NATIVE_NOT_APPLICABLE`, and tests
  the actual version among the unverified/refused alternatives. This does not
  qualify those relaxations for native 4.2. The probe is restored afterwards.

## Final receipts

The isolated worker is `/tmp/blendlink-legacy42-remaining-qa`.
`artifacts/legacy42-remaining-final/report.json` records **92/92** source suites,
complete and unchanged production bytes; explicit unavailable markers remain
visible. `artifacts/legacy42-remaining-qualified/report.json` repeats those
checks with initial/final fixture-byte stability as well. Modern omnibus logs
are `/tmp/blendlink-legacy42-omnibus-final-{52,53}.log`, both successful.
Focused geometry, evaluated material bindings, UV pins/context, strand radius,
Area schema, PNG metadata and identity-driver tests also pass actual 4.2/5.2/5.3.
All full material-bake attestation checks pass those three versions. No claim
here covers an installed ZIP or a built browser runtime.

Diagnostic scripts in this directory retain original fingerprint hash updates,
attestation payloads, PNG chunks and last Python lines before native aborts.
They inspect or preserve evidence; none modifies production behavior. Their
outputs are local research receipts and are not packaged runtime dependencies.
