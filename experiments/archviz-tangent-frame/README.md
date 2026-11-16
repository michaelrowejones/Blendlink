# Archviz Plaster tangent-frame barrier

The public Python n-gon restriction can be modeled around, but **a stock glTF
TANGENT accessor is not an EEVEE frame certificate**. Preserve the current
NormalMap/UV/conditioning refusal. No production changes or GPU work were done.

Original official Archviz SHA256:
`9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e`.
CPU evaluation uses Blender 5.3.0 `02f0899d78e3`; pinned source files are recorded
in `sources.json`. The unchanged original and all evaluated datasets, binary,
producer and outputs remain local under `/tmp/scenetoweb-archviz-tangent-cpu-r2`.
`receipt.json` pins those files and includes the compact observations. R1 was
also retained; R2 corrects decimal output roundtripping to float32, records exact
triangle IDs, and adds actual stock-GLB/private-proxy controls.

## Findings on the actual owners

| Source owner | Evaluated triangles | UV area below 1e-8 | Exact zero UV area | Native fallback(+X,-1) corners | Nearly parallel corner references |
| --- | ---: | ---: | ---: | ---: | ---: |
| Walls |2731|193|12|11|2|
| Plane.021 |2198|243|173|309|182|

Walls has 5 n-gons and 1316 quads. Plane.021 has no n-gons and 1075 quads.
All triangles on these evaluated owners use Plaster, as independently recorded
by the BOX material-stage extraction. No geometry or source material was edited.

The standalone probe compiles the **pinned Apache Mikk header**, with an
independently written interface adapter. Input positions, split corner normals,
UVs and loop triangles come from Blender's evaluated mesh. Authored quads remain
quads; only n-gons use native loop triangles. Callback results are written back
by original loop ID in native callback order. This is a source-derived CPU model,
not direct native draw-cache or GPU-buffer readback. On Plane.021, this model
matches every measured float32 component of Blender's public native Mikk output
(maximum numeric difference 0). Signed-zero bit identity was not separately
checked; this is not a raw-byte certificate.

Triangulating every face changes tangent/sign tuples by up to 2.0 on both owners
and creates 44 repeated-original-loop conflicts. The native mixed-face model has
zero such conflicts on both. Quads must retain their authored Mikk treatment.

A private n-gon-only triangulation removes the API error, but reconstructing
Walls with `normals_split_custom_set` changes 97 SNORM10 normal corners, 845
SNORM10 tangent corners and 1 handedness value. Maximum normal difference is
.0044207; maximum tangent-component difference is .9997762. Plane.021's unchanged
tri/quad topology roundtrips exactly. Therefore even selective triangulation
plus a normal setter is **not** a Walls original-corner frame certificate.

## Exact native/source seams

- `mesh_tangent.cc:calc_uv_tangent_tris_quads` explicitly rejects faces with more
  than 4 corners. Python `mesh.calc_tangents` uses this path.
- EEVEE draw's `extract_mesh_vbo_tan.cc` instead calls
  `bke::mesh::calc_uv_tangents` with native corner triangles/face mapping. Its
  `SGLSLMeshToTangent` adapter keeps quads and expands n-gons to loop triangles.
- Stock glTF `primitive_extract.py:prepare_data` calls the same public Python
  tangent API, catches failure, warns, and omits the tangent attribute. The small
  n-gon fixture actually exports a GLB with **no TANGENT**. Stock extraction also
  rounds tangents before vertex welding; the warped-quad fixture loses up to
  .00003725 versus native values. Existing `tangent_export.py` and
  `geometry_export.py` avoid rounding on qualified private meshes, but still
  rely on valid native/private corner data and do not solve the n-gon API or
  original-normal provenance problem.
- Apache Mikk uses a float32 area check against `FLT_MIN`, not the production
  certificate's conservative 1e-8 UV threshold. The tiny-UV fixture computes a
  native tangent at approximately 1e-12 area while the production guard refuses.
  That observation does not justify weakening the guard for all graphs.
- Zero UV faces can join connected valid groups or retain Mikk's default
  tangent(+1,0,0), handedness-1. The zero-UV vertical-triangle fixture returns
  finite unit tangents **parallel to its normal**. Walls loop 941, triangles 485
  and 486, exposes the same failure. Finite/unit alone does not prove a nonzero
  interpolated frame or normal-map output.
- The normal-map shader only returns the input normal early for the distinct
  sentinel `(0,0,0,+1)`. That is not the default(+X,-1) observed here. Inventing a
  new tangent/bitangent or treating all degenerate UVs as neutral normals would
  change native semantics.

Plaster's graph inventory records `OPENGL/TANGENT/DISPLACED`, Strength 1, an
unlinked active material Displacement input and no reachable Bump node.
`node_shader_output_material.cc` only emits displacement for a linked input;
`eevee_shader.cc` defines bump displacement only for nonempty displacement code.
Thus source analysis of this graph expects no displacement-bump normal change,
and `input_normal_displaced` selects Ni. The material's displacement-method RNA
value was not separately recorded; no value is inferred or asserted for it.
This graph-scoped source inference is not a GPU qualification of every mode.

## Small controls and CPU replay

The extractor authors four tiny controls: one concave 5-corner n-gon, an isolated
zero-UV vertical triangle, a tiny-area UV triangle and a warped quad. They test
API refusal, unsafe finite fallback, threshold mismatch and stock rounding.
Only four small fixture GLBs are exported; there is no render, bake or scene save.
`folded-quad-control.json` adds a tiny standalone authored quad with folded UVs:
the native quad model and an explicit two-triangle stream differ in handedness
by 2.0, reproducible directly with the pinned CPU probe without the original scene.

```sh
python3 experiments/archviz-tangent-frame/check.py
python3 experiments/archviz-tangent-frame/check.py --verify-local
```

Developer-only source research reproduction, **not an artist installation
requirement**, using the already audited Blender source checkout:

```sh
clang++ -std=c++17 -O2 -ffp-contract=off \
  -I PINNED_BLENDER_SOURCE/intern/mikktspace \
  experiments/archviz-tangent-frame/mikk-probe.cc -o /tmp/NEW-mikk-probe
blender --background --factory-startup --disable-autoexec --threads 2 \
  --python-exit-code 1 --python experiments/archviz-tangent-frame/extract.py -- \
  IMMUTABLE_ORIGINAL.blend NEW_OUTPUT_DIRECTORY /tmp/NEW-mikk-probe
```

Output directories must be new. The probe has no TBB and
records its native compiler version/flags. Exact source/input/output hashes
must be rechecked when reproducing on another platform. The current receipt
belongs to the retained macOS CPU run, not a universal binary qualification.

## Smallest next unit; no implementation in this batch

A portable, maintainer-built **Apache native Mikk** oracle/transport can remove
the API barrier without requiring an artist to install a C++ compiler. Its API
must accept source positions, original corner normals/UVs, mixed native
tri/quad faces and n-gon loop triangles, with stable original-loop mapping and
write order. Package the tested WASM/native helper as an owned toolchain asset;
pin its source, compiler, bytes and decoded result. Do not substitute a fitted
frame or reconstructed private normal field.

Three's existing `generateTangents(position,normal,texcoord)` Mikk WASM adapter
accepts a triangle stream and has no authored quad-face grouping argument. It
is not automatically equivalent to this native mixed-face contract; the actual
quad controls above already demonstrate the risk of a triangle-only conversion.

The certificate then needs raw float32 original-corner normal/tangent/sign
provenance through private geometry transport and glTF vertex splitting, plus
native storage packing, transforms, interpolation and input-conditioned
nonzero normal proof. Preserve the fallback tuples exactly. Special degenerate
NormalMap semantics need their own qualified domain; they are not a reason to
waive the current guard. Direct frozen corner attributes must avoid both the
lossy proxy normal setter and stock pre-weld rounding. A GPU/native draw-frame
comparison and real decoded glTF binding are still missing.

The BOX color-only port can proceed independently while NormalMap retains its
honest refusal. No supported-node, material or scene credit follows here.

## Licenses

Blender mesh/draw/shader bridge source is GPL-2.0-or-later and is only audited,
not copied into the MIT SDK. Python investigation code is GPL-3.0-or-later.
The compiled Mikk implementation headers are Apache-2.0 (Morten S. Mikkelsen,
Blender Authors and the atomic hash helper's Meta contributors), referenced by
hash from the source checkout rather than vendored. The independent C++ test
adapter is Apache-2.0. A future packaged portable helper must retain all relevant
Apache notices/licenses and mark modifications; no GPL native implementation
has been transplanted into the SDK by this experiment.
