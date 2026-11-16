# Terminal EEVEE white shadow branch

**Qualified bounded partial**, with the exact scope and hashes in
[qualified-evidence.json](qualified-evidence.json). This does not qualify general
Light Path fields or accept the complete Archviz scene.

Archviz Glass uses an EEVEE output whose terminal Mix is driven directly by
Light Path / Is Shadow Ray. Its shadow closure is white Transparent; the
non-shadow closure is also the authored Cycles output. This candidate preserves
that entire primary closure and adds a separate shadow discard on the owned
node-material clone. It never assigns a universal value to Light Path.

Source admission is deliberately limited to the pinned Blender 5.3.0 build
02f0899d78e3, macOS arm64 Metal, static direct links, the authored dual-output
shape, and an unmodified white shadow closure. The visible closure is one
ungrouped Principled with literal Alpha, or one literal-factor white-Transparent/
Principled mix with Principled Alpha one. Positive static visible Alpha is
serialized as a canonical Float32 constant. Other Light Path fields, reverse
branches, nested mixes, groups and source profiles remain outside this route.

`native.py` renders an offscreen caster onto a visible receiver using actual
EEVEE shadow evaluation. The terminal branch must equal the all-transparent
control in every decoded PNG Float32 word; the opaque negative must change more
than 100 words. This is a closure/predicate test, not an EEVEE/Three BRDF test.
The producer then makes an actual Final GLB and material-program sidecar.

`browser.mjs NATIVE_DIRECTORY NEW_DIRECTORY --gpu-lease` installs that exact
Final and tests both node-renderer backends. The compiled caster must equal a
disabled-caster control word for word, an opaque caster must alter more than
100 words, and dispose/remount must restore the same output and source material.
Every output directory is new, with immutable producer copies and hashed raw
binary readbacks. Coordinate the shared GPU before running either producer.

## Retained failed diagnostics

Native r3 passes (0 positive differences; 3,471 opaque negative differences).
Browser r1–r5 are retained failed diagnostics: their opaque negative changes
zero words. That invalidates the browser proof even though installation,
positive equality and remount succeed. The opaque carrier was independently
confirmed to have opacity 1, depth writing enabled and double-sided geometry;
the prior carrier-collapse hypothesis was disproved. Public animation-loop
ticks did not fix the absent shadow. Diagnose the basic renderer shadow control
before changing source admission or relaxing any gate.

Local failed captures live at `/tmp/scenetoweb-shadow-browser-r1` through `r5`;
native captures are `/tmp/scenetoweb-shadow-native-r1` through `r3`. Raw evidence
is not bundled here. The unchanged original Archviz plan still refuses Plaster;
the early candidate clears Glass only at compiler level, which granted no support.

## Closed installed result

The final proof uses an opaque control and the **actual original Glass material**
copied after full loading of the hash-pinned original `.blend`. Material-only
library append omits Blender's legacy EEVEE conversion and is not an equivalent
oracle. Only the controlled fixture is exported; the original source remains
unchanged and no full original-scene acceptance is claimed.

Both actual Finals pass Metal/SwiftShader × WebGPU/WebGL2, including an opaque
second caster, correct visible transparency, exact mask/no-mask primary output,
stock visual restoration and reinstall. Eight tuples close 88 fields / 5,767,168
words. Actual blended fields use RGBA16Float targets, decoded losslessly to
Float32; Alpha equals independently rounded half storage. Separate **unblended**
RGBA32Float probes preserve all 8,192 covered source Alpha words exactly. Native
shadow predicate controls cover another six fields / 393,216 decoded PNG words.
No Blender-versus-Three BRDF or full-scene comparison is inferred.

The scoped runtime owns all five visible channels and transparent/depth-write/
coverage state; it cannot inherit Blender 5.3's missing stock Alpha. Missing or
mismatched material state, incomplete channels and skips refuse. The original
source materials stay unchanged. Owned shadow callbacks invalidate the actual
Three r184 shadow override around affected draws, preserving/restoring app
callbacks and fixing same-object material replacement without patching Three.
Unchanged shader keys keep their existing cache entries.

`read.mjs NATIVE_DIRECTORY BROWSER_DIRECTORY NEW_REPORT` independently verifies
all raw hashes, exact positive controls, discriminating negatives, source/runtime
bytes, real backend/device identities, actual Final declaration, visible Alpha
and lifecycle fields. It refuses overwriting a report. The two independent
closes in the receipt were replayed byte-identically. Old failures remain intact,
including stock Alpha loss and the invalid RGBA32Float blending harness attempt.
