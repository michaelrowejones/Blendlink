# Static string controls: native text to exact scalar transport

This family verifies the bounded Blender5.3 static-string helper. It does not
send strings to a GPU or implement glyphs, text layout or grapheme operations.
Native host string evaluation feeds existing integer/Boolean selector programs.
Production code and its pinned BLI Unicode case registry are owned separately.

The shared JSON census has manually materialized expected text. Every nonempty
text output has **two independent native witnesses**: native Length must equal
the expected codepoint length, and native Find(actual,expected).Count must be1.
Empty output requires native Length0. The compiler helper must separately resolve
the exact expected text. Witness renders count as one logical string case.

Cases cover all nine classes, both Special Characters outputs, Trim flags and
non-whitespace preservation, negative/out-of-range Slice, non-overlapping and
empty Replace, direct Length/Find controls, typed group instances, reroutes,
native mute bypass, selectors and compositor string comparisons. Case covers
all666upper/669lower mappings, neighboring unmapped identities and literal
Blender-specific sharpß/Turkish/ligature/Deseret controls. It uses pinned native
one-codepoint semantics rather than Python's Unicode-version or expansion rules.

The table is reproducible from the exact pinned upstream C++ source. Run
`python3 experiments/static-string-family/generate_case_table.py --check` to
compile those unchanged functions and compare fresh enumeration of every Unicode
scalar with the committed bytes, without rewriting the table. A changed source
digest refuses before generation. Regeneration and native numerical validation
remain separate steps; this source check earns zero numerical node credit.

All authored strings use `FunctionNodeInputString.string` and actual RNA
readback assertions. Ordinary `NodeSocketString.default_value` can truncate
around1024UTF8bytes; it cannot serve as evidence for the4096-byte boundary or
whole-map expected strings. The shared native registry JSON is explicitly pinned
in source and both staged helper locations. An independent Python AST closure
derives flat exporter imports (including multi-name absolute imports and literal
`_sibling` calls); relative addon-package branches belong to the complete addon
inventory. Both complete staged Python/JSON inventories are checked against their
derived manifests, without treating unflattened UI modules as missing exporter
files. The retained first pilot attempt stopped at that fixture-inventory mistake
before any renders and earns zero numerical credit.

Numbers up to4096 are transported through an independent byte carrier:
`R=(n%256)/256`, `G=floor(n/256)/256`, `B=.25`, `alpha=1`. These half-exact
channels use the existing exact integer MODULO/DIVIDE path before Float32
conversion and preserve odd integers such as2049 and4095 that direct EEVEE half-float
emission can round. Native operators and their inputs remain untouched. Encoded
Float32 words and decoded integer goldens require exact equality; no numerical
tolerance is introduced. A retained float-FLOORED_MODULO carrier attempt
produced native+0 versus Metal-0 for the zero low byte. Switching byte extraction
to integer arithmetic changes only this independent carrier, with no output
repair or string-operator change. The saved source retains its real native string nodes
and Principled graph. An owned temporary Emission output is used only for the
native shader diagnostic; Final/browser material diagnostics make the same
explicit distinction from lighting parity.

The closed matrix pins complete native source/artifact inventories, real native
binary/Node/helper/launcher archives, every saved source and publication, and
independent current runtime emission, maps, vendor and fixture bytes. Browser
runs demand the requested actual WebGPU or WebGL2 API, both physical Metal and
software profiles, no silent adapter fallback, and caller ownership restoration.
Private NUL/surrogate boundary controls are labelled separately and earn no
native numerical credit. The fixture freezes before native/Final capture.

Build once in the owned checkout, coordinate GPU ownership, and use a new ignored
output directory. The matrix already owns all actual saved Final exports:

```sh
PATH=/tmp/mrj-tooling:$PATH npm run build --workspace scenetoweb
PATH=/tmp/mrj-tooling:$PATH node experiments/static-string-family/matrix.mjs \
  artifacts/verification-static-strings-NEW --built
```

A complete proof covers three source contexts (shader/CPU/GPU). Source labels
identify host-string evaluation plus encoded scalar transport, never a GPU
string-arithmetic implementation. The [integrated receipt](evidence.json) closes272native graphs,55saved Finals,
1308browser case-runs and334848Float32 words with zero differences; family
totals are shared across the nine classes and their shader/compositor contexts.
This qualifies the stated partial scalar-control slice only.

Constant-only compositor graphs may finish without initializing a GPU. Their
native metadata records CPU-MF evaluation with null GPU backend/renderer, even
when the authored compositor setting requests GPU. Shader carriers record their
actual EEVEE Metal renderer. The protocol refuses substituting one source stage
for the other; metadata capture never forces GPU initialization.
