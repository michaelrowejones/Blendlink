# Blendlink

Blendlink compiles a `.blend` into portable web scene artifacts — GLB, textures,
a validated manifest, and typed bindings. This glossary fixes the vocabulary the
compiler, the add-on, and the docs share. It is a glossary only: no
implementation detail belongs here.

## Language

### Capture routes

The word "bake" names three different operations. Keeping them distinct is
load-bearing: a diagnostic that says only "needs bake" cannot tell an artist
which one they need.

**Appearance bake**:
Capture of the final lit Cycles result into an atlas that the runtime renders
unlit. Deliberately flattens lighting, and no runtime light affects the result.
_Avoid_: baking, flatten, texture bake

**Lighting bake**:
Capture of indirect diffuse light into a lightmap on a separate UV set. The
authored material survives and continues to respond to runtime lighting.
_Avoid_: lightmapping, GI bake

**Material bake**:
Capture of a material's individual input channels — base colour, metallic,
roughness, normal, emission, alpha — into images, producing an ordinary glTF
PBR material that remains lit at runtime. Captures inputs, never appearance.
_Avoid_: PBR bake, texture bake, material flatten

**Evaluated-geometry route**:
Emission of Blender's depsgraph-evaluated result for a generator that glTF
cannot represent — particle systems, hair curves, grease pencil, curves —
as ordinary meshes or instances.
_Avoid_: realize, apply modifiers, convert to mesh

### Material channel classification

**Channel**:
One input of a material's surface shader, classified and transported
independently of the others. Portability is a property of a channel, not of a
whole material.

**Passthrough channel**:
A channel already expressible in stock glTF — a constant that becomes a factor,
or an image texture in an arrangement the exporter recognises. Costs nothing.
_Avoid_: exact, stock, native

**Baked channel**:
A channel whose authored graph is not expressible in glTF, captured to an image
by the Material bake. Freezes that input; an animated or driven input cannot be
a baked channel.

**Refused channel**:
A channel that can be neither passed through nor baked, blocking publication
with a named artist remedy. Refusal is a designed outcome, not a failure.
_Avoid_: unsupported, failed, error

### UV routing

**Tileable material**:
A material whose graph is driven only by the mesh's own UVs, so one 0..1 tile
reproduces it everywhere. Bakes to a small tile, keeps the artist's authored
UVs — including tiling beyond 0..1 — and repeat-wraps. Overlapping UVs are
correct here.
_Avoid_: repeating, seamless

**Unique material**:
A material whose graph is driven by position, object, or generated coordinates,
so its pattern cannot repeat. Requires a non-overlapping unwrap and unique
texture space.
_Avoid_: non-tiling, world-space, unwrapped

### Fidelity claims

**Channel fidelity**:
The claim that a baked channel numerically reproduces its source graph within a
stated tolerance. Provable, and the only claim the compiler gates on.

**Appearance parity**:
The claim that a runtime render matches a Blender render. Not provable across
different light-transport implementations, and therefore only ever a
diagnostic — never a gate, and never a promise made to an artist.
_Avoid_: pixel parity, matches Blender, looks the same

### Consolidation

**Consolidation**:
Reduction of texture, material, and draw-call count by making Unique materials
share one baked atlas set. Permitted through shared textures, material dedup,
and batched drawing; forbidden where it would merge meshes, because node
identity, per-object culling, states, and components depend on meshes staying
separate.
_Avoid_: merging, joining, flattening

### Presentation

**Presentation**:
The artist's scene-level choice of Hybrid, Realtime, or Fully Baked, refined by
per-object Automatic, Realtime, or Baked intent.

**Component**:
A versioned, namespaced record attached to a scene or an object that declares
website behaviour — an effect, a visibility rule, an interaction, an animation,
or audio — without embedding application code in the `.blend`.

**Website Surface**:
A Blender-authored mesh whose pixels are supplied at runtime by application
code rather than by the compiler.
