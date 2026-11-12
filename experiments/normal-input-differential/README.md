# Native Normal direction and Dot

The material Normal node stores its authored direction on the Normal output.
EEVEE uses that vector directly; the existing Cycles path normalizes it.
Dot normalizes the incoming vector, then computes its dot product with the
engine's direction. This is distinct from the legacy compositor Normal node:
its Dot is negative and does not normalize the incoming vector. Modern
compositor schemas expose only the normalized direction output.

Shader admission requires a static finite direction within ±16 and a finite,
nonzero Dot input whose domain can be checked from literals, supported opaque
nearest-image pixels, or the existing validated primary-normal geometry
contract. Zero/subnormal and unknown input domains refuse with the artist's
node name. Cycles zero directions also refuse; EEVEE's raw zero direction
remains defined. Compositor CPU/modern zero constants remain defined, while
legacy GPU zero-direction normalization refuses. Animation is not frozen.

Fresh material references contain 110 graphs per Blender 4.2/5.2/5.3, with
independent RGB precision and row-orientation controls, both source engines,
nonunit directions, finite very small/large inputs and live nearest fields.
All 660 built graph/backend rows passed. Additional native undefined/unsafe
cases are retained as expected admission refusals. Original unbounded probes
which exposed undefined normalization remain exploratory evidence.

The EEVEE geometry proof uses actual Final scene exports, exact Float32 normal
bindings, animated shared owners and cameras, perspective/orthographic views,
front/back faces and rawZ/Yup transport. Each version passes 336 readbacks per
browser backend, 2,016 total. The native EEVEE half-float scene carrier is
independently calibrated; its allowance is separate from the unchanged 2e-5
raster budget. The control also checks browser pixels against the original
authored RGB, so an EEVEE-only run cannot rely on a prior Cycles control.

Compositor fixtures include 120 actual CPU/Metal graphs across all three
versions. Both built browser backends pass with maximum error
4.76837158203125e-7, texture cleanup and caller MRT/clear-state checks. Runtime
rejects unknown models, nonunit serialized directions and invalid outputs.
Normal outputs do not acquire dependencies on unused incoming vectors.

```sh
BLENDLINK_BLENDER=/path/to/blender \
BLENDLINK_NORMAL_INPUT_EVIDENCE=artifacts/normal-input \
  node experiments/normal-input-differential/run.mjs --built
BLENDLINK_GEOMETRY_NORMAL_DOT=1 BLENDLINK_GEOMETRY_ENGINE=EEVEE \
BLENDLINK_GEOMETRY_BLENDER=/path/to/blender \
BLENDLINK_GEOMETRY_NATIVE=artifacts/normal-input-final \
  node experiments/geometry-context-differential/suite.mjs --built --profiles shared
```
