# Structural work analysis for node ports

`material-ir-structure-v1` analyzes a `blendlink-tsl-ir-v1` document or an actual
`blendlink-material-programs-v1` sidecar whose channels contain `.tslIr`.
It changes neither IR nor runtime behavior. Its structural gates supplement
native correctness and measured browser gates; they cannot qualify performance.

```sh
node scripts/audit-node-port-cost.mjs --input actual.materials.json \
  --output artifacts/cost-new.json --profile declared-webgpu-metal \
  --pixel-digest-elements 65536
node --test scripts/lib/node-port-cost.test.mjs
```

The CLI uses Node core only. Output creation is exclusive. Accepted input bytes,
analyzer source and optional limits bytes are hashed. Malformed inputs retain a
failure receipt; existing outputs are preserved. A profile is only a declared
label, not a measured adapter identity. No numerical evidence is reused.

A separate optional limits document has this shape:

```json
{"schemaVersion":1,"model":"node-port-structural-limits-v1","maximum":{"expressionOccurrences":1000,"maximumExpressionDepth":32,"declaredFloat32PayloadBytes":1048576}}
```

Exceeding a structural maximum exits 1; successful analysis exits 0 while
`performanceQualified` remains false. Unrecognized metrics, invalid limits and
malformed graph structures refuse. This is not a complete runtime IR validator.

## Stable metrics, version 1

| Metric | Exact meaning within this input |
| --- | --- |
| `programs` | Channel IR documents, not compiled GPU programs or draw calls. |
| `expressionOccurrences` | Expanded object occurrences carrying an `op` field, including repeated serialized subtrees. |
| `maximumExpressionDepth` | Maximum nested expression depth; metadata containers do not add expression depth. |
| `literalExpressions` | Explicit `const_float` / `const_vec3` leaves, not an inferred constant-folding result. |
| `imageExpressionOccurrences` | `tex_image` / `texture_ref` occurrences, not texture samples or allocations. |
| `externalImageExpressionOccurrences` | `texture_ref` occurrences. |
| `embeddedPixelElements` | Declared RGBA array lengths after dimension/length checks. |
| `tableExpressionOccurrences`, `opaqueTableElements` | Known `curve_native`, `curve_rgb`, `ramp_lut` value-array occurrences and lengths. |
| `declaredFloat32PayloadBytes` | Four bytes per declared embedded image/table element; not GPU residency or upload format. |
| `externalImageDeclarations`, `declaredExternalImageBytes` | Sidecar image-record count and sum of declared byte metadata; asset pins/files are not validated. |

Traversal is bounded to 64 MiB input, 4,096 materials/channel documents/image records, 100,000 containers,
1,000,000 scalar visits and nesting depth 256. Expanded shared-DAG paths count
separately; cycles, sparse non-payload arrays, accessors and nonfinite inspected
numbers refuse. Opaque pixel/table elements are not visited by default and do
not participate in subtree equality. Their validity remains a runtime/export
responsibility. Unknown operations remain visible with unknown lowering costs.

Repeated subtree hashes preserve signed zero and include source/model metadata.
They establish structural equality only. They do not establish purity, safe
sharing across owners/stages, compiler common-subexpression elimination or
savings. Payload-containing subtree hashes remain unknown.

Optional pixel digests inspect at most 262,144 elements, explicitly requested by
budget. They require finite exact Float32 values and hash little-endian numeric
bytes plus dimensions. `embeddedImagePayloads` separates occurrence logical
bytes from confirmed unique/repeated logical bytes in the inspected subset.
Cross-channel scopes are listed. Unvisited arrays remain unknown, coverage is
explicit, and unique-byte counts cannot be used as enforceable global limits.
These are not unique source-file storage, actual runtime duplication, GPU
residency or predicted savings.

## Efficiency invariants to earn

1. Preserve native execution stages. The pinned Blender 5.3 evaluator routes
   single-value compositor units through CPU multi-functions, even in GPU mode;
   other units use shader operations. Its shader linker also distinguishes
   uniforms from rarely changing constant options. An optimization must retain
   these stage/model semantics and pass native differential tests.
   [Evaluator](https://raw.githubusercontent.com/blender/blender/02f0899d78e3/source/blender/compositor/intern/node_tree_evaluator.cc),
   [shader operation](https://raw.githubusercontent.com/blender/blender/02f0899d78e3/source/blender/compositor/intern/shader_operation.cc).
2. Share verified node instances within the correct build context. Three r184's
   default node hash is identity-based, with sharing determined through the
   builder. Temporary-node dependency handling can avoid repeated evaluation;
   equal serialized objects alone do not prove it happened. Inspect generated
   shader/resource observations before introducing a CSE rewrite.
   [Node](https://raw.githubusercontent.com/mrdoob/three.js/r184/src/nodes/core/Node.js),
   [TempNode](https://raw.githubusercontent.com/mrdoob/three.js/r184/src/nodes/core/TempNode.js).
3. Keep immutable-image caching explicit and owned. In pinned r184, RTT work
   updates per render unless its update controls skip it; resize can invalidate
   its target. A cache needs first draw, resize/DPR, changed input, reinstall and
   disposal proof. Do not extend immutable-image caching to scene-dependent
   graphs from this report.
   [RTT source](https://raw.githubusercontent.com/mrdoob/three.js/r184/src/nodes/utils/RTTNode.js).
4. Preserve existing per-material/owner variant and resource handles. Current
   `tslMaterialRuntime.ts` keys clones by material, binding extras and owner
   where needed, and disposes their resources. Repeated same-output nodes may
   be candidates inside that scope; a global hash cache must not merge owners,
   live uniforms, geometry bindings or native source models. No cache is added
   by this tool.
5. Measure resource/pass and renderer costs independently. EEVEE's own manual
   describes memory/quality tradeoffs and warns that GPU-memory feasibility
   cannot be estimated reliably in general. Count actual pass execution,
   sampler bindings, cold upload/compile and steady frames on the intended
   backend; keep native device, WebGPU/WebGL2, hardware/software and viewport/DPR
   profiles separate. Existing owned-material disposal and last-good-scene
   recovery must continue to pass.
   [EEVEE performance](https://docs.blender.org/manual/en/5.3/render/eevee/render_settings/performance.html),
   [EEVEE limits](https://docs.blender.org/manual/en/5.3/render/eevee/limitations/limitations.html).

The six pinned implementation references and their SHA256 values are recorded
in `node-port-cost.sources.json`. Current Three r184 behavior, rather than
unversioned documentation, governs implementation suggestions. Instructions,
physical texture samples, render passes, GPU memory and timings remain null in
every report; opcode complexity, storage declarations and driver compilation
must not be converted into invented milliseconds.
