# Bounded static shader Repeat

The first live slice targets EEVEE Metal shader graphs from Blender5.3.0 build`02f0899d78e3` on macOS arm64. Iterations must resolve to a fixed typed Integer in0..64. A zone has1..4 independent Float/3D Vector states. Each iteration copies its own state or adds/subtracts one bounded sixteenth-grid literal step, or the native integer iteration counter. Zero iterations forward the selected initial expression and prune the inactive body, while retaining the existing owner-tree animation/driver refusal.

Nonzero seeds are bounded sixteenth-grid literals within±16 only, including assembled literal vector components. All UV field seeds refuse, including explicitly authored clamp[0,1] then SNAP.25 shapes: a one-ULP producer difference can cross a quarter boundary, and fixture raster-center margins do not establish arbitrary mesh-UV phase safety. The old scalar/vector/group field examples remain in `unqualified_field_cases()` as research and explicit native/runtime refusal controls. No original scene is rewritten. Zero counts still forward the selected upstream expression under its existing qualification. All accepted state arithmetic stays on the1/16 grid within±2048 and is exactly representable in Float32. Direct cross-state aliases, constant overwrites, nonlinear recurrences, nested/chained zones, texture/derivative bodies, alternate types, Cycles, dynamic iteration counts and animation/drivers remain unqualified.

The backend emits a real bounded shader Loop rather than recursively expanding expression trees. Each next value is staged before its state assignment. Identical serialized loop uses share an explicitly staged variable within a channel; this matters when a carrier or ordinary DIVIDE creates multiple branch scopes. Runtime validation independently derives schema, lexical state types and cost, caps8 unique loops and8192 iteration-weighted operations per channel, and owns an immutable clone of deferred IR. Source emission has2048-visit/depth64 and group-depth16 bounds. Cancellation refuses graph construction before allocation; it preserves the existing installation signal contract after settlement. Loops own no textures or render targets.

The proof uses an independent reversible signed carrier OUTSIDE the operator. For a selected component`v`, it encodes integer`n=(v+2048)*16` into`high=floor(n/256)` and`low=n-high*256`, then RGB=`(high/256,low/256,0)` with alpha1. This preserves node words through native emission's negative clamp and HDR storage. Carrier formulas, bounds and encoding are separately authored and pinned; they do not quantize, repair or change a loop state. Literal, counter, signed-vector, four-state, group and inactive-body cases require exact native/browser carrier words.

The fixed matrix has49 native graphs and11 saved Final scenes, plus240 built browser cases across Metal/SwiftShader and actual WebGPU/WebGL2. Raw and actual imported Final material installations compare every word, verify publication pins and caller material/callback ownership, and restore the resource baseline after reapplication. Eleven malformed/field/cancelled raw controls must refuse. Actual generated shader inspection requires exactly one loop for every positive-count case, zero for zero-count cases, and at most128KB of fragment source; this catches accidental carrier duplication and expression unrolling. Raw programs are deliberately mutated after construction to prove deferred compilation cannot bypass the frozen iteration/body limits.

```sh
npm run build --workspace=scenetoweb
node --test experiments/shader-static-repeat/protocol.test.mjs
npx vitest run packages/blendlink/src/tslRepeat.test.ts
node experiments/shader-static-repeat/matrix.mjs artifacts/verification-static-repeat
node experiments/shader-static-repeat/verify.mjs artifacts/verification-static-repeat experiments/shader-static-repeat/evidence.json
```

Capture already performs the native references and all sixteen Final publications; do not export twice. The closed reader requires the exact native helper/oracle/fixture census, fresh disposed Python prefixes and archived launcher/helper/executable identities, unchanged saved sources, actual publication files, complete browser/runtime/vendor/map/fixture archives and a fresh independent closing emission. The frozen protocol status contract must be registered in the shared preflight catalog. Native creation, private pilots and source availability grant no numerical coverage; only the completed integrated receipt qualifies this partial slice.

The official Mandelbrot Grow source remains blocked by its actual scripted`frame` driver,200-frame range, nonlinear recurrence and downstream Bump derivative contract. Correct transport needs a source-frame clock shared with real playback, pause and seek. Renderer elapsed time or a current-frame capture would not preserve those semantics. `research.json` retains this distinction and the source/pipeline counterexamples; this work grants no original-demo fidelity credit.

The current admitted census is49native graphs (48production plus independent calibration),11saved Final scenes and240browser case runs across both APIs/profiles,61440compared Float32 words. These are expected builders, not qualification results; a fresh integrated full matrix must close before any capability promotion. Positive field cases are excluded from these totals.

The [integrated receipt](evidence.json) closes49native graphs,11saved Finals,
240browser case-runs/61440Float32 words with zero differences and13fresh
Python prefixes. This is the literal-seed scope; old field-containing pilots
remain research and do not qualify UV seeds or the original Mandelbrot.
