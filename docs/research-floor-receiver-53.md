# Cube Floor receiver research, Blender 5.3

The original Cube Diorama Floor is a promising **explicitly reviewed receiver
proxy**, but this research does not justify automatically removing its SIMPLE
subdivision. Geometric coincidence does not preserve its complete shading
inputs. No optimization or proxy is implemented, and no port or appearance
qualification credit is earned.

## Actual asset, inspected without evaluated Floor geometry

The original source SHA-256 is
`a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e`.
An owned `Floor` copy was loaded from that source without linking it to a scene.
Only the owned source arrays and settings were inspected. The original file was
never saved; its byte hash was unchanged. Within the native invocation, the
owned object/mesh identity, positions/topology, face material/smooth/hide flags,
UV arrays, attribute schema, source material bindings, authored transform and
modifier settings were hashed before and after and remained equal. This is a
bounded read-only state check, not a full-scene appearance or export proof.

The source has 4,225 vertices, 8,320 edges, 4,096 quads and 16,384 loops. Local
positions have 65 distinct X values, 65 Y values and one Z value, with bounds
`[-1,-1,0]` to `[1,1,0]`. All 4,096 faces are smooth and use material index0;
there are no custom normals. Besides topology, position and selection storage,
the inspected attribute schema contains one corner `FLOAT2` layer, `UVMap`,
which is the active render UV. Auto texture space reports origin `[0,0,0]`
and size `[1,1,1]`. An unlinked object's cached `matrix_world` is not used as
evidence of its authored scene-space transform.

The sole modifier is SIMPLE Subdivision: viewport4, render5, quality3,
`uv_smooth=PRESERVE_CORNERS`, `boundary_smooth=ALL`, creases enabled, custom
normals disabled, limit surface enabled. The render setting yields 8,388,608
triangles by the separately tested exact count; this study never allocated or
evaluated that Floor result.

`Boards - Basketweave` routes an explicit UV Map through an Image Texture into
color processing and Bump, then into Principled Normal. Its inspected Material
Output has a Surface link and no Displacement link. The material's `BOTH`
displacement setting alone is not evidence of connected true displacement.
The inspected reachable material graph has no Generated/Geometry/Attribute
node, but its UV sampling and bump derivatives still prevent a geometry-only
substitution proof.

The actual Floor's UV field is **not exactly affine**:

- Maximum component residual from a global double-precision least-squares
  affine fit against the source local positions: `1.054399790878513e-5` UV.
- Maximum source-quad component of `UV0 + UV2 - UV1 - UV3`:
  `5.960464477539062e-7` UV.
- UV bounds: approximately `[-0.12940431,-0.12941378]` to
  `[1.12940431,1.12940550]`.

These source-array measurements are not rendered errors, not a perceptual
threshold and not a measured difference against the actual level5 result.
Their nonzero values defeat a claim of exact affine UV preservation. They must
not be replaced by the much larger synthetic counterexample below.

## Why coincident geometry is insufficient

Pinned Blender revision
`02f0899d78e374b63e7181d9061e1f7ab03419cc` handles geometry and UV interpolation
separately. [Modifier settings](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/blenkernel/intern/subdiv_modifier.cc)
retain the UV face-varying mode even for SIMPLE geometry.
[UV mode conversion](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/blenkernel/intern/subdiv.cc)
maps `PRESERVE_CORNERS` to corners-only linear preservation, while `NONE` maps
to all-linear face-varying interpolation.
[Mesh construction](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/blenkernel/intern/subdiv_mesh.cc)
evaluates UV layers with `eval_face_varying`; it separately interpolates
attributes, ORCO and custom normals. Its SIMPLE bounds-cache reuse says min/max
positions remain unchanged, not that shader fields or tangents are identical.
[Evaluator setup](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/blenkernel/intern/subdiv_eval.cc)
supplies face-varying UV data and separate ORCO vertex data. Exact source byte
hashes and the modifier's requested-resolution source are recorded in the
[research source pins](../experiments/floor-receiver-research/sources.json).

Twelve small owned native controls evaluated **separate single-quad meshes**
at SIMPLE level2, each yielding 16 faces. They covered affine and deliberately
nonaffine UVs under all six native UV smoothing modes. None evaluated Floor.
All stayed in the Z=0 plane, with +Z normals. The nonaffine control used corner
UVs `(0,0), (1,0), (1,1), (0.25,1)`. Against a coarse quad explicitly split on
diagonal0–2, the sampled refined field differed by up to `0.0625` in U for
`PRESERVE_CORNERS`. This is a constructed counterexample to geometry-only
reasoning, **not a Floor appearance measurement**.

For the ideal affine control, `PRESERVE_CORNERS` produced zero sampled UV and
tangent differences in this small case. The `NONE` control still showed
`1.1920928955078125e-7` UV and `1.4900906819548254e-7` tangent component
differences from the analytic targets. Small floating-point controls cannot
establish universal exactness. All synthetic controls called native tangent
calculation, whose [pinned implementation uses MikkTSpace](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/blenkernel/intern/mesh_tangent.cc),
on their own temporary evaluated meshes; Floor's source mesh was
never used as the tangent scratch mesh.

## Bounded next proposal

Keep the existing named Floor resource refusal in this batch. A future explicit
receiver-proxy intent could retain the authored 4,096 quads, giving 8,192
triangles before additional proxy refinement, instead of silently removing the
artist's modifier. That triangle reduction is a count, not a measured timing
claim. Copy the actual UV arrays, material indices, smoothing and relevant
attributes; preserve original object transform and texture-space semantics.
The original object, mesh, materials and modifier stack must remain unchanged.

The normal baker and exported receiver must share the same declared proxy UVs,
triangulation and actual Mikk tangent basis, with separate base/coat-normal
bindings. Source sampling must explicitly describe which original or proxy
field is sampled; a flat geometric proxy must never silently replace a varying
Generated/Object/UV/material field. Reject unproven custom normals, displacement,
shape keys/deformation, topology-dependent nodes or attributes, changed material
assignment, and unsupported downstream modifiers. Normal fields alone do not
prove preservation of the other surface channels.

Qualification would need native controls for UV seams/nonaffinity, smooth and
custom normals, mirrored/nonuniform transforms, Generated texture space,
attribute/topology consumers and tangent handedness, followed by bounded native
appearance comparisons and actual saved Final loading on both browser APIs.
For this asset the UV-image/Bump chain needs a declared appearance tolerance and
review. No such tolerance or original/proxy appearance comparison was measured
here. A future automatic fast path would require an independently proven,
much narrower consumed-field contract; planarity alone is insufficient.

This checkpoint performed zero actual Floor evaluations, renders or bakes and
requested no GPU initialization. It changed no production source or fixtures.
The local query/report/log hashes in the source pins identify research artifacts;
they are not a closed immutable numerical qualification receipt.
