# Pinned EEVEE tangent Normal Map frame specification

Source audit and CPU mathematical controls only. No native draw image/GPU proof,
production change, guard relaxation or node/scene support promotion. The frozen
Mikk WASM pilot is unchanged. Source revision is Blender5.3.0
`02f0899d78e374b63e7181d9061e1f7ab03419cc`; `sources.json` pins every audited file.
All equations below are functional mathematical descriptions, not copied kernels.

## Mesh/corner data and storage

Native draw tangent extraction calls the all-layer Mikk path with original
positions, corner indices, native loop triangles/triangle faces, sharp flags,
vertex/face/corner normals and selected corner UVs. The corner normal wins when
present; fallback selects the appropriate face/vertex normal. Authored quads are
kept as four-corner Mikk faces; n-gons use their native loop triangles. Callback
results write to the ORIGINAL loop ID. A repeated loop write must agree, rather
than becoming a new averaged frame. The separate public calc_tangents API rejects
n-gons and is not a replacement for this draw callback model.

The frozen WASM mixed-face outputs have **5489 unique Walls loops,72 repeated
writes,zero strict Float32/sign conflicts**, and **4444 Plane.021 loops,zero
repeated writes**. All words match native C++; fresh public Plane.021 words
match too. Original corner normals must survive transport. Rebuilding or setting
split normals on a proxy is not an equivalent certificate: the earlier audit
measured changed normal/tangent packed words for Walls.

Normal and tangent XYZ use the same draw quality choice: high quality if the
scene HQ flag OR GPU HQ workaround is active. For ordinary SNORM10, the integer
for each component is trunc(clamp(Float32(x*511),-511,511)); attribute fetch
normalizes it by511. SNORM16 uses trunc(Float32(x*32767)) for admitted unit
vectors, fetched divided by32767. Tangent sign is stored separately as +1/-2
in signed2bit storage, or SHRT_MAX/SHRT_MIN in HQ storage; normalized fetch gives
+1/-1. The sign is not packed using the XYZ scale. No rounding-to-nearest or
pre-pack vector normalization may be introduced. Actual backend/profile must be
observed: the scene flag alone does not describe every GPU workaround.

## Vertex stage, interpolation and fragment base

Let M be the object's world linear transform and A=inverse(M)^transpose. After
native storage decoding, the per-corner world values are:

- N_i = ordinaryNormalize(A * decodedNormal_i).
- T_i = safeNormalize(A * decodedTangentXYZ_i); handedness h_i is unchanged.

The tangent uses the **normal transform**, despite being a tangent: the source's
row-vector `tangent * world_to_object` is algebraically A*tangent in column-vector
notation. Replacing it with the ordinary object vector transform changes
nonuniform-scale results. There is no Gram-Schmidt reorthogonalization.

Both N_i and the full four-component (T_i,h_i) are smooth, perspective-correct
varyings. For screen barycentrics b_i and clip W_i, weights are
lambda_i=(b_i/W_i)/sum_j(b_j/W_j). Let Nraw=sum(lambda_i*N_i) and
T4raw=sum(lambda_i*(T_i,h_i)). Do **not** normalize either interpolated quantity
before the Normal Map node. In particular, handedness is a varying float; it
cannot be replaced with the sign of its interpolation.

Fragment shading stores two different normals: Ni=F*Nraw, and
N=safeNormalize(Nraw)*F, where F=+1 for raster front-facing and -1 otherwise.
Original Normal Map base uses **Ni**. Displaced base uses N only if a generated
displacement graph exists (MAT_DISPLACEMENT_BUMP); otherwise it too uses Ni.
The original Plaster surface has no linked displacement output, so its normal
base is the raw-interpolated Ni path. A proof must bind this graph state; the
base enum string alone does not determine it. This pilot excludes generated
bump displacement and material lighting/BSDF interpretation.

## Tangent node functional result

For base U (Ni in this scope), first check the exact fragment sentinel
T4raw==(0,0,0,+1). That branch returns U immediately, including its possibly
nonunit length; it bypasses strength and final normalization. The branch's
existence is not proof that a missing mesh tangent actually reaches it: mesh
attribute loading first safe-normalizes tangent XYZ. Missing-attribute admission
remains unqualified. Real zero-UV Mikk fallback (+X,-1) is **not** this sentinel.

Otherwise define (T,h)=F*T4raw, with F multiplying all four components. Then
B=h*cross(U,T)*D, where D=-1 for the source OBJECT_NEGATIVE_SCALE flag and +1
otherwise. This flag derives from the original object's negative-scale state.
The raster front-facing factor and negative-object-scale factor are distinct.
At strength s, decode q=2*RGB-1, invert q.y for DirectX convention only, then use
(qx',qy',qz')=(s*q.x,s*q.y,(1-clamp(s,0,1))+clamp(s,0,1)*q.z).
The output is ordinaryNormalize(qx'*T+qy'*B+qz'*U). For the original OPENGL,
Strength1 case, q is unchanged after decoding. Do not normalize q beforehand.
The tangent route returns directly and does not use the non-tangent mix routine.

The safe vertex tangent normalization uses squared-length threshold1e-35;
not-above-threshold (including NaN) gives +X. This must not be confused with the
**ordinary** vertex-normal/final-normal normalization. Their zero-vector GPU
result is not specified by this audit. Parallel N/T can make B=0; cancelling
RGB coefficients or interpolated h=0 can make the final combination zero.
Do not invent a zero/+X/base-normal fallback, reorthogonalize the frame, or
weaken existing frame-cone guards based on these source equations. Those cases
need explicit native GPU observations or conservative refusal.

## CPU controls and next image proof

`reference.py` is a separate GPL-3.0-or-later research oracle, not SDK code. It
contains independently written vector algebra, declared staged Float32
arithmetic and 21 fixed mathematical boundary checks. It makes no bit-parity
claim for GPU normalize, interpolation, FMA or carrier storage. Controls cover
raw Ni/T interpolation against incorrect fragment renormalization, perspective
weights, inverse-transpose versus vector transform, front/back, negative scale,
DirectX, strength0, SNORM10/16 truncation, safe threshold/NaN, exact fragment
sentinel and parallel/zero-final/mixed-sign undefined cases.

```sh
python3 experiments/eevee-tangent-frame-spec/reference.py
```

For the next native unlit field proof, constant RGB axes isolate T/B/N; mixed
RGB (for example .8,.7,.9) distinguishes relative interpolated lengths and must
be included. Pure-axis outputs alone can hide the normalization-order mistake.
Use the actual original normal/map properties and source corner IDs, native
loop triangulation, packed storage profile and unchanged material-displacement
state. Transport original raw N/T/sign as independent custom CORNER attributes,
with exact oriented loop-triangle identity; custom glTF vectors do not gain a
basis rotation automatically. The renderer agent independently owns that
transport and future NativeNormalsRGB/image controls. No GPU work ran here.

## Provenance/license boundary

Mikk headers and the frozen portable oracle are Apache-2.0. The Blender draw,
GPU storage, shader and node graph sources inspected here are GPL-2.0-or-later;
the optional separate CPU reference is GPL-3.0-or-later. No Blender shader or
kernel text is copied or linked into the MIT SDK, and there are no production
code changes. Future runtime work must remain an independent implementation of
the documented mathematics, with source-derived behavior and license provenance
reviewed rather than copying a GPL kernel. Raw numerical observations/specs do
not substitute for the pending native image qualification.
