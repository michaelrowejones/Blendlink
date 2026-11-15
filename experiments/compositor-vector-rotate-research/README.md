# Compositor Vector Rotate: source and coefficient research

This is research only. No compositor source admission, runtime code, renderer proof, saved Final or support classification changes are included.

The shader route already exists: `tsl_ir.py` emits `vector_rotate`, and `tslNodeRecipe.ts` implements all five modes. Fixed axes and arbitrary-axis rotation use the same Rodrigues form as the pinned EEVEE BSL function. Its Euler helper performs sequential float rotations. That code is a reusable implementation, but it is not automatically the compositor CPU model.

The pinned CPU callback differs in important ways. Axis normalization has a squared-length cutoff of 1e-35. A zero axis produces an identity matrix, followed by the ordinary subtract-center, matrix multiply and add-center stages; it does not directly return the original vector. Installed CPU Euler code uses Float32 sin/cos results, with selected coefficient products promoted to double before Float32 matrix storage, and Invert uses a full matrix inverse. EEVEE uses float coefficients and a transpose for Euler Invert. The existing shader helper's inverse is mathematically equivalent to the EEVEE orientation, with different float grouping that still needs its own compositor proof.

The actual Blender 5.3 compositor schema is three-component Vector/Center/Axis plus an Angle scalar and three-component Euler Rotation. Output is VECTOR3. Defaults are Vector/Center/Rotation zero, Axis `(0,0,1)` and Angle positive zero. There is no exposed implicit Uniform coordinate default. Availability follows the chosen mode. `NodeSocketVectorEuler.default_value` is a mathutils Euler object without `foreach_get`; a bounded native `from_socket` copy into an owned one-input homogeneous group allows raw Float32 reads without copying any user tree.

## Observations

The closed no-render probe evaluated 30 owned Geometry-MF cases covering five modes, both Invert values, ordinary controls, zero angles and zero/unused-axis controls. It includes repeated numerical variants where the mode ignores Axis. All original datablock identities/users were restored. GPU initialization was denied and no render was performed.

For Vector `(0.1,0.2,0.3)` and Center `(0.5,0.5,0.5)`, the CPU zero-axis result is `(0.099999994,0.199999988,0.300000012)`. Its pre-store component hashes confirm those words. The EEVEE zero-axis branch returns the input words directly. This is a genuine staging difference, not permission to replace the CPU path with an identity shortcut.

A direct `mathutils.Matrix.Rotation` / `Euler.to_matrix` / matrix-vector operation disagreed with 18 of the 30 native MF results. The public matrix API adds angle wrapping and uses its own accumulation/inversion paths. It is not a qualified drop-in implementation. A separately staged host interpreter using those public coefficients also disagreed, so this research does not hide the difference behind a storage tolerance.

The bounded alternative worked: evaluate the **same native Vector Rotate MF** on the three basis vectors with Center positive zero and the original active static controls. There were 22 distinct control keys and 66 basis evaluations. Finite normal nonzero coefficients recovered from those outputs, followed by explicitly ordered Float32 `(V-C)`, products, left-associative pair sums and `+C`, predicted all 30 original vectors and all 90 pre-store component hashes exactly. Every observed basis output also matched its pre-store hash. This supports a coefficient foundation; it does not establish arbitrary-field safety or all signed-zero/subnormal cases. Basis hashes describe the basis outputs, not the internal matrix words: surrounding zero products and the final positive-zero addition can erase internal coefficient zero signs. No zero-sign snapping or raw internal matrix-bit recovery is claimed.

## Bounded implementation proposal

Keep a separate native CPU source model. For a first slice, accept static raw normal-or-positive-zero Axis/Angle/Euler/Center controls under reviewed magnitude bounds, and derive nine coefficients through an owned, bounded native MF graph. Cache by a flat active-control word key, native version/build/profile and mode/Invert, with source rechecks before publishing the coefficients. Do not use a containing-tree copy or change the existing copy-only Matrix admission.

A live Vector input would then need only three subtractions, nine multiplications, six pair additions and three center additions, with the native Float32 staging preserved. It adds no texture, render pass, per-frame native work or readback. The implementation should reuse an internal staged-F32 arithmetic mechanism, rather than the shader route's trig/normalization or a new handwritten trig library.

Qualification must first compare native Geometry MF against actual CPU compositor results, including pre-Float-store hash witnesses and the zero-axis recentering counterexample. Then test a bounded varying VECTOR3 producer, separate XYZ and padded RGBA edges, literal and grouped/rerouted controls, signed/cancellation cases and source mutations. FLOAT_VECTOR2 inputs need an explicit qualified drop/pad conversion; a vector-to-scalar mean must not be silently treated as two-component. Linked controls and wider computed graphs should remain refused initially. Source single-value/field scheduling and finite image-domain propagation require independent checks.

The first GPU preflight should test the staged matvec on the declared input domain on both APIs and both profiles. If FMA, cancellation, zero signs or subnormal transport prevents that contract, retain the counterexample and narrow/defer the field slice. No coefficient or output repair, authored-angle quantization, or tolerance widening is proposed.

The EEVEE/GPU-field alternative can reuse the existing fixed-axis Rodrigues kernel with its own source profile, but Euler grouping and arbitrary-axis normalization still require independent numerical contracts. It must not be presented as the CPU route.

`bounded-proposal.md` records the next conditional lattice proof, seven host tests and a resource-free staged TSL prototype. It also records two remaining admission gaps: hidden tiny coefficients and the existing Normalized coordinate producer's bounded CPU differences. No live route is admitted by this research checkpoint. `compiler-evidence.json` corrects the earlier double-trigonometry inference using the installed native function's actual float sin/cos call.

The follow-up `bounded-native-receipt.json` closes 36 fixed-axis boundary keys with 324 basis component words and 324 predicted component words, all exactly matching the native MF and pre-store hashes. `normalized-rows.mjs` and three tests implement the private-consumer host row formula and an independent integer RNE oracle. The source and installed CPU callback confirm half-center Float32 division. These remain research foundations, with no compositor render, source admission or saved Final/browser credit.

## Retained evidence

`receipt.json` pins the successful fifth probe, its complete source/native archive and the earlier failed setup attempts. The first failed probe assumed Euler array access; the second tried to assign an unavailable socket by name. Both stopped before numerical evaluation and retain zero credit. A third and fourth probe retain the public-mathutils counterexamples. Primary source bodies remain in ignored local artifacts with GPL attribution; only their immutable URLs, hashes and license metadata are committed.

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-vector-rotate-research/run.mjs artifacts/verification-vector-rotate-NEW
```
