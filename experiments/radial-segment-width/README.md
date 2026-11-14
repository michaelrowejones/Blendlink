# Radial Tiling: regular full-roundness Segment Width

This is a deliberately partial Blender5.3 port: **Segment Width**, integer literal
Sides2..64, Roundness exactly1, both Normalize states. Other outputs and branches
remain named refusals. The official Radial demo uses Segment Coordinates with
a spatially computed stepped Sides field, so this slice does not unlock that scene.
The [read-only source correction](demo-controls.md) derives discrete Sides3/8/12
from the authored STEPPED Map Range rather than assuming a linear/fractional
field. The older pilot scope contains that superseded inference; its numeric
Width measurements remain historical and are not rewritten.

The pinned native regular/full-roundness branch returns the half-sector angle
`PI / Sides` as Width. Vector only participates in the other output components;
the later origin and Normalize adjustments also leave Width unchanged. Native
source and runtime therefore prune Vector only for this proven selected-output
invariant. An unsupported/expensive coordinate field does not become a fabricated
coordinate producer, baked texture, or claimed general Radial implementation.

Shader extraction admits the measured EEVEE Metal source profile; the compositor
has its own measured CPU/GPU provenance. CPU MF uses the double `M_PI` macro before
storing Float32, whereas GPU source uses Float32 PI. The separate native anchors
retain one-ULP differences rather than pretending their stages are bit-identical.
[numeric-contract.json](./numeric-contract.json) predeclares **both** two-ULP and
absolute2^-22 bounds. Alpha1 and power-of-two Sides widths remain exact-word
controls. The shader constant is evaluated by the live node kernel, without any
native-output lookup table or stored pixels in production.

One shared [cases.json](./cases.json) defines the dynamic native/browser census:
all63Sides×bothNormalize states, plus explicit Value, reroute, group and varying
image-Vector routes. Only selected graphs are saved for actual Final publication.
The EEVEE reference is a real field shader atlas; a separately calibrated
power-of-two digit carrier preserves the admitted positive Float32 widths through
the native half target. Raw packed pixels and actual saved source remain pinned.
Native compositor outputs use raw Float32 files. The runner and closed reader
import one immutable protocol status descriptor and independent current runtime
archive checks, including native source/helper/binary identities.

Actual saved Final exercises both the compositor pipeline and the installed live
material program. The material's live Base Color is rendered under an explicitly
named fragment diagnostic, isolating node/transport correctness from Principled
lighting. This does not assert EEVEE/Three lighting parity. Repeated apply/dispose
restores material/callback ownership and the exact independently warmed renderer
cache identities. A division-only kernel owns no textures/RTTs or frame readback;
these are resource controls, not an FPS or performance benchmark.

Build once in the owned worktree, coordinate the GPU slot, and choose a new ignored
output directory. Capture already performs the saved Final exports; do not repeat
them separately.

```sh
PATH=/tmp/mrj-tooling:$PATH npm run build --workspace scenetoweb
PATH=/tmp/mrj-tooling:$PATH node experiments/radial-segment-width/matrix.mjs \
  artifacts/verification-radial-width-NEW
```

## Fractional full-roundness follow-up research

[transpiler-feasibility.mjs](./transpiler-feasibility.mjs) mechanically assists the
larger GPU algorithm with Three r184's GLSLDecoder/TSLEncoder. It verifies the
upstream SHA, preprocesses native aliases, supplies scalar `square`, maps native
`atan2` to TSL's two-argument `atan`, and materializes initialized local variables
before their later assignments. Generated output stays in ignored research
artifacts; no production dispatcher imports it. Translation alone earns zero
native numerical, Final or official-scene coverage. Actual API compilation,
source-stage branch controls, unchanged authored-scene acceptance, and
register/shader-size/completed-draw costs remain separate gates.
