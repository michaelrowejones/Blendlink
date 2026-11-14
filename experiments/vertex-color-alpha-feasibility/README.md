# Vertex Color Alpha — saved scalar transport feasibility

Research/prototype only. This changes no SDK, shader emitter, existing RGB
route or capability classification. The [strict receipt](evidence.json) closes
two guarded native Python invocations, four stock/custom GLBs and one actual
saved-and-reloaded artist scene exported through a private scalar carrier.
There are zero native shader renders, GPU calibration jobs, actual SDK Finals,
browser renders or node-port credits.

## Native contract and current blocker

Pinned Blender5.3 source is in [sources.json](sources.json). The EEVEE Color
Attribute node (`ShaderNodeVertexColor`) returns the attribute's alpha directly.
A nonempty name selects that color layer; an empty name selects the active
**render** color attribute, which can differ from the editor's active layer.
FLOAT_COLOR fetch is F32x4 identity. BYTE_COLOR fetch instead uses normalized
U16x4, with alpha byte multiplied by257; RGB alone receives sRGB/working-space
conversion. This makes alpha a data channel rather than a color transform.
POINT values are gathered to face corners; CORNER values are already in corner
order. Native raster interpolation remains to be measured against actual saved
scene/browser paths; source identity is not an interpolation proof.

The actual bundled5.3 stock exporter has an alpha-only branch that warns and
omits color attributes even when `export_vertex_color='ACTIVE'`. When Color and
Alpha both participate, it exports VEC4 COLOR_0 as normalized UINT16, including
FLOAT_COLOR sources. In this fixture, authored0.1 becomes6554/65535. That is a
real transport change, not a Three.js scalar swizzle issue.

A private FLOAT_COLOR custom attribute can preserve raw RGBA, but a private
**FLOAT scalar** is smaller and avoids introducing unused RGB or COLOR_0 alpha
coupling. It must remain an ordinary custom semantic, not be renamed into an
invalid SCALAR COLOR_0. Existing RGB/color-export settings must remain intact in
production; research uses `export_vertex_color='NONE'` only to isolate the
scalar transport and prove it is independent of the broken stock alpha route.

## Small actual saved-source proof

The artist fixture is one static four-vertex/two-triangle quad, one POINT
FLOAT_COLOR `Paint` layer, and actual Vertex Color Alpha -> Principled Alpha.
The script saves and reloads that authored `.blend` before creating transport
resources. Its source words include0,0.1,1/3,1; no artist alpha is rounded,
quantized, clamped or repaired.

The export-only mesh copy retains the original material by reference. An owned
private FLOAT/POINT attribute receives alpha bytes directly from the original
RGBA storage. The source tree is never copied or rewritten. Stock glTF custom
attribute export yields `_SCENETOWEB_VCOL_ALPHA`, SCALAR/FLOAT5126,
normalized=false, count4 matching POSITION. All four words are exact.
The narrow reader explicitly checks contiguous stride4, alignment and buffer
span; it does not claim general interleaved/sparse parser coverage.

Actual Three.js GLTFLoader parses the resulting GLB without a renderer. Its
geometry exposes lowercase `_scenetoweb_vcol_alpha`, itemSize1, Float32Array,
normalized=false, POSITION-matched count and all original words exactly.
Private mesh/object cleanup restores original source RGBA, links, ID pointers,
users, selection/frame and active object. The authored file hash remains
unchanged. This is saved-source transport proof, not a built SceneToWeb Final.

## Proposed first production slice

- Blender5.3 EEVEE, static primary Mesh, FLOAT_COLOR POINT/CORNER alpha only.
- Present named layer or explicitly resolved active-render layer; empty-name
  lookup must not use editor-active color index.
- Initial raw alpha inputs +0 or finite positive normals in[0,1]. BYTE_COLOR,
  missing/wrong-type layers, negative-zero/subnormal/HDR/nonfinite inputs,
  animation/drivers, modifiers/deformation, skins and instances defer/refuse.
- Owned scalar custom semantic with actual per-primitive/material owner,
  source-layer and type/count/non-normalization attestation. A semantic string
  or mesh-extra flag alone cannot authorize lookup. Runtime must check the
  actual decoded BufferAttribute identity and schema before a typed scalar read.
- Existing Color output/RGB carrier and exporter settings stay unchanged.
  Reserve/namesafely validate private semantics; never trust Blender's automatic
  `.001` name suffix as the intended exported binding.
- Reuse private carrier/lifecycle and primitive rewrite infrastructure, with
  a separate scalar binding rather than pretending every COLOR_0 is VEC4.
  Geometry with both Color and Alpha must avoid applying alpha twice.

Required first regressions are a CORNER seam with two triangles sharing position
but different alpha, two materials/primitive reorder, default-render vs editor-
active disagreement, reserved attribute collision, shared source mesh/material
owners, repeated export/dispose, wrong decoded width/type/count/normalization,
and missing primitive binding. Verify source alpha against actual indices and
loop/vertex ownership, not accessor-row ordering. This POINT/single-primitive
research fixture intentionally does not claim those cases yet.

Then add an unchanged saved scene with an orthographic camera and Vertex Color
Alpha displayed as grayscale, independent interpolation/input controls and
explicit raw-vs-EEVEE-film precision accounting. Ordinary non-half alpha values
must be included without inventing an artist-input grid. Actual native EEVEE,
built saved Final and both browser APIs/profiles must close before expanding
the already-partial node's Alpha scope. No general interpolation, transparent
BSDF, legacy/version, named-attribute family or whole-scene appearance credit
follows from this transport receipt.

## Repeatable no-render collector / strict reader

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/vertex-color-alpha-feasibility/run.mjs artifacts/verification-vertex-alpha-fresh
```

The collector pins fixture/reader sources, bundled exporter files and actual
Three loader sources before/after capture. The shared native archive reader
requires exactly `probe.py` and `saved-scalar.py` once each, with fresh owned
Python prefixes and no Final export-script actions. It validates actual GLB and
saved-source bytes and loads the real scalar attribute. Raw assets are ignored,
machine-local under the receipt's recorded directory. Upstream shader sources
are pinned/reviewed only; no GPL shader bodies are copied into the MIT runtime.
