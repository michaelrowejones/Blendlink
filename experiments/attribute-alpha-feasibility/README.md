# Named Attribute Alpha: native and transport feasibility

Research only. No SDK, emitter, capability or node classification changes are made. The bounded pinned Blender 5.3 EEVEE Metal probe performs one independent 64×64 sample-center ramp and six Attribute/Vertex Color render pairs (13 renders total), saves six owned artist graphs and exports six private scalar-carrier GLBs. The independent reader validates raw native words, original source hashes, indexed GLB position/corner/alpha associations, actual GLTFLoader bindings and the guarded native archive. There is no built Final or browser rendering credit.

## Source result and special names

Pinned revision is `02f0899d78e374b63e7181d9061e1f7ab03419cc`; full primary URLs and SHA-256 values are retained in `sources.json` and `special-name-sources.json`.

- `node_shader_attribute.cc`, lines 108–117 and 141–145: GEOMETRY requests `GPU_attribute(CD_AUTO_FROM_NAME, name)`, then calls `node_attribute`; exact lowercase `color` and `temperature` take additional callbacks. Both generic Attribute and Vertex Color outputs receive the same native bump-coordinate handling.
- `node_shader_vertex_color.cc`, lines 65–82: a nonempty name requests the same `CD_AUTO_FROM_NAME` field; its empty-name active-render fallback is a separate path.
- `gpu_shader_material_attribute.bsl.hh`, lines 106–113: `node_attribute` assigns Alpha from `attr.w`. Lines 17–26 explicitly replace `temperature` Alpha with one.
- `gpu_shader_material_vertex_color.bsl.hh`, lines 10–14: Vertex Color Alpha is the incoming `.a` value.
- `attribute_convert.hh`, lines 135–145: FLOAT_COLOR conversion uses raw Float32×4 identity. BYTE_COLOR has a different normalized-integer/color-conversion path and is excluded.
- `extract_mesh_vbo_attributes.cc`, lines 75–98: POINT values gather to corners; CORNER data retains its corner domain.
- Actual EEVEE `eevee_nodetree_lib.bsl.hh`, lines 999–1019: `color` postprocessing changes alpha only in the volume pipeline. A surface Mesh returns its original alpha, matching the reserved-color native control. The similarly named generic material-interface header is explicitly a runtime-generated stub; its example implementation is not used as authority for EEVEE behavior.

The four generic `Paint` controls cover +0, one, nonuniform POINT values (including stored 0.1 and 1/3) and a discontinuous CORNER seam. All 65,536 rendered RGBA words match the native Vertex Color node exactly. An unrelated all-one active/render layer remains selected, proving the named field is used. The reserved `color` surface-Mesh control independently matches another 16,384 words. The source-backed `temperature` counterexample differs in 12,288 RGB words (maximum absolute difference 0.874267578125); its Attribute output is one while Vertex Color retains painted alpha. That negative is expected and retained, not repaired or accepted as equivalent.

These native comparisons use EEVEE's half-film output in an EXR32 container. They establish measured sibling-node equivalence on the controlled surface Mesh cases, not a universal full-Float32 shader arithmetic claim or cross-browser raster proof.

## Owned carrier result and next bounded port

All six original layer arrays remain byte-identical; source graph links, pointers/users, layer selection, scene ownership and saved source hashes are restored after comparisons/export. The existing production `vertex_color_alpha.install` helper writes only private Mesh copies. Actual GLBs use raw FLOAT32 SCALAR custom semantics; the existing material/owner indexed-triangle attestation passes, and this research reader separately recomputes each exported position/corner/alpha association. Actual GLTFLoader exposes the expected count-matched, unnormalized Float32 scalar bindings. Alpha words never pass through COLOR_0, integer normalization or color-space conversion.

A useful next slice is `ShaderNodeAttribute`, GEOMETRY, Alpha only, with an explicit nonempty named FLOAT_COLOR POINT/CORNER layer on the already-qualified bounded static primary surface Mesh. Reuse the existing profile guard, `vertex_color_alpha` operation, private F32 scalar installation/association proof and runtime binding; no new shader kernel, texture or pass is needed. Exact lowercase `temperature` must named-refuse. Lowercase `color` can share the route only under that surface-Mesh contract, supported by the actual EEVEE branch and native control. Empty names, missing layers, BYTE_COLOR, other domains, OBJECT/INSTANCER/VIEW_LAYER/LIGHT types and volume pipelines receive no inference from this research.

The next implementation needs source-policy positives/refusals and source/group-binding preservation, then an explicit family variant in the existing Vertex Alpha saved-Final/native/browser harness. Fresh actual Final transport, EEVEE reference and both APIs/profiles must close before an Attribute scope is added. The current emitter still refuses GEOMETRY Alpha; these results do not change that behavior or promote the already-partial Attribute class.

## Retained observations

```sh
node experiments/attribute-alpha-feasibility/run.mjs artifacts/verification-attribute-alpha-NEW
node experiments/attribute-alpha-feasibility/close.mjs artifacts/verification-attribute-alpha-NEW
```

`receipt.json` pins the local successful `v2` closure. The preceding `v1` stopped before rendering because the research script omitted the canonical Blender-helper path; its incomplete native archive/log remain separate and earn no credit. The successful rerun uses both supported source paths with a fresh guarded Python prefix. No original demos or private user scenes are opened or altered.
