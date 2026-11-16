# Original Plaster normal image: bounded CPU input audit

This is a CPU statistics/proposal artifact, with zero support credit. It does not
change the frozen native/browser field experiment, production code, or admissions.
No Blender, browser, GPU, render, or original-save job was run for this audit.

The original packed `Plaster-normal.png` is 1024², Non-Color. Its SHA256 is
`4effabbaf2127fb1639af151bd1dc64a3ad8d73c5e7fbc9dd6436c13e1724b55`.
The earlier native storage metadata reports RGBA8. The exact PNG base channel
byte ranges are R=[46,216], G=[29,220], B=[203,255], A=255. Decoding as Float32
UNORM gives qz≥0.592156887 and max|qx|=0.694117665, where q=2RGB−1.
Independent extrema lose useful correlation: their difference is negative,
whereas **every actual base texel has qz−|qx|≥0.02352941036**.

`image-cone-inputs.json` contains exact base statistics and eleven levels from the
existing source-specialized CPU mip model. Levels above zero are **modeled**, not
new native mip observations. Earlier positive-LOD `kind:'fetch'` rows from
`texelFetch` alias base-level pixels at level-scaled integer coordinates and
are explicitly excluded. This is separate from the R5/R6 `kind:'linear'`
normalized `textureLod` checks: all 44 filtered comparisons remain bit-exact.
Those sampled comparisons do not by themselves certify every stored texel at
every native level. This audit adds no new native mip observations.

For each actual original loop triangle, the audit uses frozen raw corner N and
portable WASM Mikk T, SNORM10 decode, the staged Float32 vertex-normalization
reference, and the recorded source inverse-transpose matrix (identity for both
objects). It computes L, the distance from the origin to the convex hull of the
three vertex normals. Perspective interpolation with positive barycentric
weights has ||Ni||≥L. For T and Ni sharing those weights, their dot product is a
quadratic Bernstein polynomial. Its coefficients are ni·ti and
(ni·tj+nj·ti)/2; their maximum absolute value D bounds |T·Ni|. Thus
C=min(max_i||ti||,D/L) bounds |T·unit(Ni)|.

In real arithmetic B·Ni=0, independent of tangent sign/front-face/negative scale.
The projection of the unnormalized NormalMap result onto unit(Ni) is bounded by
qz*L−|qx|*C. The audit minimizes this expression over the correlated image colors,
retaining minimum blue for each red byte. The expression is concave in RGB, so
its minimum also bounds convex color filtering **within those admitted colors**.
This statement does not establish a native sampler/mip implementation, BOX
weights, GPU interpolation error, or exact Float32 cross-product orthogonality.

| Object | Triangles | Minimum L | Base-level minimum bound | Base triangles unresolved |
| --- | ---: | ---: | ---: | ---: |
| Walls | 2731 | 0.9999999302 | +0.02352941036 | 0 |
| Plane.021 | 2198 | 0.8872425339 | −0.05110381277 | 14 |

All triangles have positive bounds for modeled mip levels1–10. The weakest
Plane.021 level1 bound is +0.01622176402. The complete fourteen unresolved base
triangle IDs and eight worst rows are retained in `image-cone-statistics.json`.
A nonpositive bound is a **failure to prove nonzero**, not evidence that the real
image makes the final vector zero. Pure-B remains an explicit undefined input
boundary from the earlier field experiment; it is outside this image's positive
qz input region and does not by itself refuse the original Plaster material.

These are double-precision convex-hull statistics around a staged Float32 vertex
model, not interval-certified GPU error bounds. The 1e−4 sensitivity counts in
the JSON are descriptive only; no tolerance or admission threshold was changed.
Before production use, the sampler/typed-mip policy and accumulated arithmetic
errors need their own bounded proof. Finite black native carrier values from
the earlier pure-B observations still do not establish a normalize-zero fallback.

The next discriminating step can be restricted to the fourteen unresolved
Plane.021 triangles: subdivide their shared barycentric domain or solve a tighter
correlated projection bound, retaining the real image coefficient cone. If that
still cannot prove nonzero, characterize actual sampled inputs on those triangles
under the correct native sampler. No artist geometry rewrite or invented fallback
is justified by this audit.

Replay in the frozen experiment worktree with the retained raw input archives:

```sh
node experiments/mikk-normal-map-field/image-cone-inputs.mjs /tmp/image-bounds.json
python3 experiments/mikk-normal-map-field/image-cone.py /tmp/image-bounds.json /tmp/scenetoweb-real-mikk-normal-native-r1/capture /tmp/cone-statistics.json
```

The image reader validates the packed PNG hash and observed storage type. The
frame reader validates every N/T byte hash, source profile/NormalMap state, and
records metadata/reference/producer hashes. Six independent geometric/negative
cone controls run before emitting the report. The original `.blend`, native
captures, WASM outputs, and earlier field receipts remain untouched.
