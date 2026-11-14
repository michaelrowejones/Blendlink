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

Cases cover twelve static string classes, including bounded Match String Boolean
controls and INT String to Value / Value to String conversions, both Special
Characters outputs, Trim flags and
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
string-arithmetic implementation. The fresh combined [integrated receipt](evidence.json)
closes458native witness graphs (455production),112actual saved Finals,
2280browser case-runs and583680Float32 words with zero differences and116fresh
Python cache prefixes. All native/Final/browser artifacts close against the
same frozen source, staged helper inventories and independently re-emitted runtime.
The runtime fingerprint is
`fc842bc653dd7505aa2c54a0e0ac54dd28131f197f76eb1291484f9c29204959`.
Family totals are shared across twelve static string classes per source context;
existing compositor Compare controls add separate witnesses. They are not
per-node counts or a whole-node completion claim.

| Source context | Native witness graphs | Actual saved Finals |
| --- | ---: | ---: |
| EEVEE shader | 150 | 36 |
| CPU-authored compositor | 154 | 38 |
| GPU-authored compositor | 154 | 38 |

Constant-only compositor graphs may finish without initializing a GPU. Their
native metadata records CPU-MF evaluation with null GPU backend/renderer, even
when the authored compositor setting requests GPU. Shader carriers record their
actual EEVEE Metal renderer. The protocol refuses substituting one source stage
for the other; metadata capture never forces GPU initialization.

Match String compares the pinned native UTF-8 bytes with Starts With, Ends With,
and Contains. It does not normalize or case-fold. Nineteen authored Boolean
cases cover all menu values, empty text/key, non-match/case sensitivity,
multibyte and combining-mark distinctions, overlapping matches, the4096-byte
boundary, native Menu sources, reroutes and separately bound group instances.
The unchanged native Result drives an explicit Boolean Switch with INT false0
and true1 before the existing byte carrier. This adds no implicit Boolean cast
or runtime string operation. Native no-render policy also checks the direct
shader BOOLEAN constant and compositor BOOLEAN-to-RGBA extraction separately,
so selector folding cannot conceal an accidental INT serialization. Source
identities are recorded in `numeric-contract.json`. Animation and both oversized
Match inputs have named refusal controls. New per-context census totals derive
from the protocol rather than copied fixed counts.


The qualified bounded INT slice extends this same family with17 logical INT
conversion cases (ten String to Value and seven Value to String). No new runtime
string or arithmetic operation is introduced. String to Value follows pinned
`std::from_chars` signed32 ASCII prefix semantics, including native Value0 /
Length0 on overflow or invalid input/base. It never uses Python Unicode digit
classification, whitespace stripping or prefix inference. Value to String uses
lowercase base2..36 digits, sign-aware padding and an output-size check before
constructing zeros. FLOAT modes retain a named refusal. Shared static producers
include literal/InputInt, StringLength/Find, and these integer conversion chains;
arbitrary IntegerMath, animation, fields and implicit casts remain refused.

Parser values are independently checked as typed signed32 helper outputs. The
unchanged native Value then feeds a native decimal INT formatter and the existing
Length +wholeFind.Count witness pair; consumed Length has a separate bounded
integer witness. Standalone formatter endpoint cases keep parse/format bugs from
cancelling. Every parser/formatter socket is selected by active identifier and
type after setting `data_type=INT`. Invalid Base and negative Padding use linked
InputInt values, so UI clamps cannot change the authored control. The fresh combined ROOT matrix qualifies only these bounded INT control routes;
FLOAT conversion and runtime string operations remain unqualified.
