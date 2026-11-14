# GLSL source/AST census contract

`assertGlslSourceCensus(preprocessedGlsl, actualDecoderAst)` compares independently
lexed source declarations with the actual Three GLSLDecoder output before
TSLEncoder runs. It returns a frozen, source-hashed status record with zero
numerical credit, or throws `GlslSourceCensusError`. Neither input is mutated.
The source lexer does not import or reuse Three tokenization, parser or AST code.

The exact ordered census includes function names/return types and every ordered
parameter's type, name, explicit `in`/`out`/`inout` direction and `const` flag.
Native and decoded duplicate definitions are rejected by overload identity
(name plus parameter types). Distinct overloads remain distinct. Ordinary
scalar/vector globals are compared by type/name/const flag, including chained
declarations. Unknown AST top-level executable nodes refuse; comments do not
manufacture declarations. Missing/extra/changed/reordered signatures fail.

This reviewed subset requires explicitly preprocessed GLSL: no unresolved
preprocessor directives, BSL attributes/references, struct definitions,
prototypes, aggregate/array declarations, parameter precision qualifiers or
unnamed parameters. Unsupported syntax refuses by name. Bounds are1MiB UTF8,
250000tokens, delimiter depth128,256functions,32parameters per function and
512globals. Delimiter and top-level scans are iterative; AST global chains are
bounded and cycle-checked. This is a declaration census, not a complete GLSL
validator or a proof of function-body arithmetic, loop/control-flow fidelity,
shader validity, dependency resolution, numerical parity or compatible licensing.
Those retain separate gates.

The research Radial CLI invokes this gate immediately after actual decoder
parsing and before mutable-local/tail-return transformations and TSL emission.
The pinned Apache source's generated candidate remains byte-identical:
34474bytes, SHA256
`79a9d9a49e7532644704488ed5caf2e9aac8209615214f853888c4a78be9cf45`
with the existing tail-return option. No production SDK or active numerical
matrix fixture is changed. Retained research receipts describe their own prior
CLI snapshot; changing this tooling does not recapture their numerics.

Synthetic unit sources exercise dropped/extra/duplicate signatures, direction
and const loss, wrong globals, stray top-level expressions, malformed/bounded
input and generation byte equality. The ordinary pipeline test command runs
them without network, Blender, browsers or native source caches:

```sh
node --test scripts/lib/glsl-source-census.test.mjs
```

Optional read-only local cache diagnostics require exact pinned source SHA256s:

```sh
SCENETOWEB_RADIAL_GLSL_SOURCE=/path/to/pinned/shared.glsl \
SCENETOWEB_GABOR_GLSL_SOURCE=/path/to/pinned/gpu_shader_material_tex_gabor.bsl.hh \
node --test scripts/lib/glsl-source-census.test.mjs
```

They copy no native function body into the repository or browser/runtime. The
Gabor diagnostic records the old incomplete adapter's10native/9decoded mismatch,
identifies the retained `[[node]]` annotation, and separately verifies10/10 after
its explicit declaration-only ABI adaptation. No grammar repair, compile/draw,
new node support, GPU string/kernel or material/scene claim follows.
