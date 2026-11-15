# Static Input Rotation feasibility

Research only: zero support, rendering, browser and GPU credit. Current qualified Static Euler/Quaternion helpers and their source contracts are unchanged.

Pinned `FunctionNodeInputRotation` reads three native `rotation_euler` storage floats, constructs `EulerXYZ`, and calls `math::to_quaternion`. `FunctionNodeEulerToRotation` uses the same `math::to_quaternion(EulerXYZ(float3))` in its multi-function. The difference is construction of an MF constant versus executing the MF lambda. `FunctionNodeRotationToQuaternion` copies W/X/Y/Z. No mathutils conversion, normalization or live ROTATION transport is needed.

The retained CPU-MF experiment creates one owned point and two actual native constructor→Rotation to Quaternion branches. Every component is captured as raw FLOAT and independently hashed before its FLOAT attribute store. The 30-node carrier's node/link identities, input raw words, Hash type/Seed, Store schema/selection and modifier binding are checked around evaluation. Twelve triples cover zero, individual axes at2^-16/1, all-min/all-one, nonhalf values and adjacent boundary words. All48 component words and48 hash witnesses agree exactly; all outputs are normal/+0 and hashes match their raw stored words. This supports source-derived reuse for the existing positive literal domain; it does not establish arbitrary-angle behavior.

The same process repeats public `path_resolve(name,False).foreach_get(array('f'))` calibration on Input Rotation Euler, Input Vector and Vector Rotate Vector/Center arrays:12 patterns/36words preserve negative zero and signed subnormals. Indexed Python reads retain the counterexample (subnormal→signed zero). `raw_float_array.py` is an experimental bounded whole-property reader (five actual indexed/width/missing/scalar/bool-length refusals checked), not a source admission policy or a qualified SDK replacement; scalars remain on their existing route.

One owned prefix invocation is retained in `artifacts/verification-public-input-rotation-r3/native-python-proof/`; its complete archive was independently validated before launcher disposal. No render/bake/GPU initialization occurred after denial-canary checks. Source trees, IDs/users, active object, selection, scene/frame and original context were restored. The compact evidence pins report/receipt/archive bytes; no native body is shipped in browser runtime.

A minimal future production route should use a separate evaluator/cache/model for actual `FunctionNodeInputRotation` followed by existing Rotation to Quaternion scalar component presentation. Reuse bounded typed group/reroute traversal and flat immutable recipes, but intercept Input Rotation explicitly and require unmuted native no-input/single-ROTATION-output schema. Read raw positive zero/positive[2^-16,1] radians before promotion and revalidate property words, actual group ancestry, source animation/topology and root/context at EOF and cached returns. It should retain an owned native carrier snapshot and pre-store hashes, refuse negative zero/subnormal/nonfinite inputs and outputs, and leave Quaternion normalization and Euler constructor admission unchanged. Native CPU compositor vs MF and actual saved-Final/browser proof remain required before promotion.

To reproduce into a fresh ignored namespace:

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/public-input-rotation/run.mjs artifacts/verification-public-input-rotation-fresh
```

The earlier r1 twin pass and r2 script-import setup failure remain separate zero-credit namespaces. The helper-backed corrected r3 repeated all twelve twins and raw calibration checks with a complete independently validated one-prefix archive.

Signed-domain follow-up: `signed-evidence.json` retains40 native twins/160 component words and160 hash witnesses, spanning signed normal min-bound, ±1, ±8, ±π/±2π, cancellation neighbors and mixed turns. Every twin agrees, but18 cases fail the unchanged output hash gate because native signed-zero components become +0 at the Float attribute sink.22 pass all current guards. This supports investigating signed normal |angle|≤8 only with the existing data-dependent output refusal; it grants no compositor/browser credit or sign repair. One complete independently validated prefix is retained.
