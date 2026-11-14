# Static compositor quaternion/rotation island — source proposal

Source research only: no SDK, native numerical, saved Final, browser or support
credit. Pins and retained actual catalog schemas are in [sources.json](sources.json).
No numerical job or GPU call was run for this assessment.

## Actual native contract

`FunctionNodeQuaternionToRotation` declares scalar Float inputs W=1, X/Y/Z=0
and one ROTATION output. Its CPU multi-function constructs Quaternion(w,x,y,z)
and calls `math::normalize`. `FunctionNodeRotationToQuaternion` declares one
ROTATION input and scalar Float outputs W/X/Y/Z; its CPU multi-function copies
those four stored quaternion components directly. The same registered function
callbacks serve geometry/compositor function nodes. The retained Blender 5.3
catalog accepts both in compositor root/group contexts and rejects shader trees;
no shader-node claim follows from the separate gpu_fn callbacks.

The Rotation socket's public default is three Euler angles, not four quaternion
components. Output socket storage defaults are not computed output values:
RotationToQuaternion's declared W storage default 0 does not imply an evaluated
identity quaternion has W=0. Initially refuse unlinked ROTATION defaults and all
implicit Float/Vector/Matrix→Rotation conversions rather than inventing a tuple.

## Signed zero and normality

Pinned `normalize_and_get_length` computes `sqrt(dot(q,q))`, then returns
`q*(1/length)` when length is nonzero, otherwise identity `{1,0,0,0}`. Quaternion
scalar multiplication multiplies each component. `canonicalize` is a separate
function that can negate a quaternion when W<0; this path never calls it.
Therefore negative W is retained, and accepted positive-zero components are
multiplied only by a positive finite reciprocal. No canonical sign flip creates
negative zero in this direct route. The zero quaternion returns explicit
positive-zero identity components; it does not evaluate zero times infinity.

For each *literal input* component qᵢ=+0 or |qᵢ|≥2^-16, with |qᵢ|≤4, every nonzero
square is at least 2^-32 and the nonzero squared norm is within [2^-32,64]. Length
is within [2^-16,8]; reciprocal is positive and at least1/8. Nonzero normalized
components are therefore around 2^-19 or larger, comfortably normal Float32;
+0 stays+0. A conservative implementation contract can use the weaker 2^-20
separation. No input/product/output approaches the normal/subnormal boundary.
The native output words must still be classified before Python float promotion;
unexpected -0, subnormal or nonfinite words must refuse, never be repaired.

Do not extrapolate this input proof to arbitrary scalar recombinations from
previous normalized components, Euler conversions, rotation multiplication,
interpolation, inversion, or canonicalization. Those operations are outside the
initial island even when they happen to be static.

## Bounded candidate

- Pinned Blender 5.3.0 build 02f0899d78e3, macOS arm64 CPU compositor only.
- Literal/unlinked bounded W/X/Y/Z or actual Value/group-default Float sources,
  read through the public native scalar-copy buffer before promotion.
- Opaque ROTATION edges only from the reviewed QuaternionToRotation producer,
  with typed group/reroute and unique native same-type bypass traversal.
- Terminal RotationToQuaternion W/X/Y/Z becomes existing VALUE constant IR.
  No ROTATION serialization, MATRIX opcode, new runtime kernel or renderer need.
- Initially refuse fields, context sources, animation, implicit conversions,
  unlinked Rotation defaults, and quaternion-component recombination chains.
- Reuse flat-ID recipe references and both cached transitive source-hop and
  intrinsic-recipe height bounds. Carry the reviewed per-extraction work limits
  and native ownership checks; never reintroduce recursive tuple keys. Prefer a
  shared work context across static families if they can coexist in one graph.
- Private one-point Geometry Nodes CPU carrier runs unchanged native function
  nodes and stores four raw Float attributes. Read/copy/check all four words
  together once per island; subsequent endpoints use the same checked result.
  Preserve source IDs/users/links, scene/frame/context and private cleanup.

The existing Matrix helper is specialized internally. Reuse its reviewed small
mechanisms or extract a bounded shared arena only after its current proof closes;
do not modify the running Matrix union or broaden its supported node language.

## First proof gates after the batch checkpoint

First native basis pilot: zero quaternion plus positive/negative unit W/X/Y/Z,
scaled by 2^-16,1,4. All signs/zero words are manually known; negative W must remain
negative, and all untouched zero components must stay positive zero. Then add
mixed signs, large-plus-minimum components and nonunit tuples to exercise real
normalization. Compare actual compositor CPU outputs independently against the
private CPU-MF carrier; a second call to the same helper is not an oracle.

Freeze exact ordered cases before expensive exports. Retain typed group/reroute
and qualified selector/bypass examples; include raw -0/subnormal/nonfinite,
out-of-bound/computed sources, missing ancestry, stale caches, depth/node/island
limits and mid-extraction source changes as named refusals. Signed-zero controls
must use native raw buffers, not a Python scalar getter/float JSON witness.

Actual saved Final sources must retain both native classes and source ownership.
The browser proof uses existing VALUE→RGBA with alpha1 and Raw32F readback,
requiring exact words on both actual WebGPU/WebGL2 APIs and observed Metal/
SwiftShader profiles. CPU compositor EXR32 permits negative component controls;
no EEVEE half-film carrier, native GPU, XR, shader or whole-scene claim is needed.
Check lifecycle/resource identity, portable constant-result resize behavior and
zero new runtime texture/readback/kernel cost. Only this completed bounded slice
could later justify partial capability entries for these two compositor classes.
