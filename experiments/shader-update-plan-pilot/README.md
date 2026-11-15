# Shader update selection pilot

This read-only generation planner extends the existing Blender source-watch idea
to canonical shader compiler dependencies. It does not change the production
watcher, run compilers, cache acceptance or promote coverage.

`snapshotGeneration` validates the real generation receipt/module digest and
upstream input hashes. It reads family dependency lists and native depfiles;
ambiguous or unpinned dependencies refuse. Everything not proven family-local
remains a shared input. The generator script, actual clang binary and planner
are explicitly pinned, supplementing the original pilot's recorded tool inputs.

`planUpdate` identifies unchanged generation inputs, affected families, shared
tool changes, and new/removed families needing review. Its generation key never
acts as a numerical acceptance key. Every changed family requires generation
and fresh verification. Existing native reference/SDK acceptance rules remain.

```
node --test experiments/shader-update-plan-pilot/plan.test.mjs
node experiments/shader-update-plan-pilot/plan.mjs GENERATION GENERATOR CLANG NEW_SNAPSHOT
node experiments/shader-update-plan-pilot/exercise.mjs SNAPSHOT NEW_REPORT
```

The actual three-family pilot snapshot contained 82 conservative shared inputs,
including a normalized compiler invocation profile. Backend defines and target
flags change its key; elapsed timings and output-directory relocation do not.
Six counterfactual changes against that real dependency graph select Gradient
for its body/constants, White Noise for its hash helper, and all three families
for compiler/compatibility/generator changes. Only snapshot copies are mutated;
no actual source edit/rebuild or authoring speedup is implied. Six unit tests
also cover unchanged inputs, missing/invalid hashes, and new/removed families.

Machine-local observations: `/tmp/scenetoweb-shader-update-baseline-r2.json` and
`/tmp/scenetoweb-shader-update-exercise-r2.json`. A future service can consume the
existing source watcher's changed paths and this plan, regenerate affected
families, then run independent native/browser gates. This pilot itself remains
an explicit local command, with no recurring job or automatic support decision.

A combined shared shader library is one generated compilation unit. Changing
any constituent regenerates that combined unit; the per-family plan does not
authorize reusing its old executable or accepting unaffected families without
current shared-runtime checks. Logical family dependencies can select native
reference work, while compiled output/ABI and driver optimization remain bound
to the current generated module. The original three separate libraries are the
measured input to this planner pilot.
