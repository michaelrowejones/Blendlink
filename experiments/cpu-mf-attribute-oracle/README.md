# Private Geometry Nodes CPU-MF attribute oracle — research prototype

This prototype reads one-point geometry attributes to avoid half-float image
carriers for selected **CPU multi-function** reference values. It adds no SDK
route, generic native folding, node support, EEVEE/GPU kernel parity, actual
material/Final/browser qualification, FPS or scene acceptance credit.

## Source stage and useful limits

Pinned Blender5.3.0 build02f0899d78e3 source identities are in [sources.json](sources.json).
The compositor evaluator selects `MultiFunctionProcedureOperation` for
single-value units even under GPU-authored settings. That operation invokes the
node's registered `build_multi_function`. Geometry Nodes builds through the
same registered callback and its constant path calls the function on a one-item
mask. `StringToValue` and `MatrixMultiply` have reviewed context-free callbacks.
This establishes shared source, not universal bit equivalence between execution
contexts: Geo supplies its own user data and compositor conversion/scheduling
still require separate verification. Shader GPU callbacks are different paths.

`StoreNamedAttribute` and RNA expose native INT32, FLOAT, FLOAT4X4 and QUATERNION
storage. The prototype requires matching active source/target socket types,
POINT domain and exactly one vertex. It uses `foreach_get` into native32bit
arrays, without float images, color management, normalization or encode/decode
arithmetic. The asymmetric dyadic matrix calibration establishes columns-first
native storage ordering; quaternion basis controls establish W/X/Y/Z order.

The helper accepts only its reviewed class/kind allowlist and explicit typed
constants, at most64cases/512nodes. It refuses unknown/context/dynamic inputs,
implicit output casts, nonfinite values, negative zero and subnormal evaluation
inputs. No Position/Index/SceneTime/Attribute/ID/default-coordinate field,
animation, driver, zone or arbitrary authored tree is evaluated. Numeric
controls are authored directly on private nodes; INT controls use InputInt to
avoid UI range clamps. A private modifier binds only Geometry input/output,
without legacy numeric `modifier['Socket_N']` storage. Future exposed5.3 socket
bindings would require actual `modifier.properties.inputs.<identifier>.value`
RNA inspection and readback, not guessing the legacy API.

## Actual calibration and retained failures

The [closed positive pilot](evidence.json) evaluates25cases/70native32bit words:
INT32 min/max/2049; ordinary non-half Float32,2016.125,2049,+0,min-normal and a
negative normal; actual parser Value/Length endpoints and overflow; asymmetric
Combine Matrix plus Multiply Matrix by identity; and five quaternion basis/sign
controls. Every admitted raw word/integer matches exactly. Six named refusal
controls include negative zero, subnormals, a context node, implicit field and
dynamic input. Four direct raw-storage controls independently preserve -0,
minimum/maximum subnormal and minimum normal words through `foreach_set/get`.

The [first failed calibration](failed-calibration.json) is retained unchanged.
Its negative-zero RNA input retained0x80000000, but the node-evaluation output
became+0. The subnormal requests already read back as0 at the RNA setter.
An isolated negative-zero diagnostic reproduced the output canonicalization;
it was not explained by cross-case common-subexpression sharing. The precise
internal cause is unproven. No FPU/DNA changes, tolerance, sign restoration or
normalization repair was introduced. Direct raw attribute storage is capable of
preserving these words; that does not qualify their node-evaluation path.

The failed source snapshot and guarded artifacts remain in the owned ignored
`artifacts/verification-cpu-mf-attribute-r1/frozen-sources` transaction. The
positive receipt closes one actual guarded native invocation/fresh Python cache
prefix with the shared strict script census and native-binary/helper archive.
It performs zero render/bake/GPU initialization calls. Private scene, mesh,
object, modifier and group ownership are restored and pre-existing ID users,
scene/frame/engine, selection and active-object snapshots agree exactly.

One observed25-case CPU batch took5.762ms graph construction,1.438ms evaluation,
0.093ms attribute readback and0.229ms cleanup; the guarded whole transaction was
1510ms including process/archive work. These are one batch on the measured Mac,
not a performance distribution, FPS figure or established speedup. Cold native
startup remains separate. The prospective gain is simpler raw INT32/matrix/
quaternion proof transport and fewer bespoke carriers; saved Final and browser
checks remain necessary for actual port admission.

## Replay and next step

```sh
node experiments/cpu-mf-attribute-oracle/run.mjs \
  artifacts/verification-cpu-mf-attribute-NEW
```

The runner requires a fresh owned output location and uses the shared guarded
native launcher/strict archive reader. It never imports SDK code or calls the
GPU. No native node math is emulated in the oracle; expected calibration values
are explicitly authored. Future reuse should add a reviewed pure-class manifest
and source-equivalence/implicit-input checks per class, then compare the same
controls with the actual compositor CPU-MF path. Do not promote a Geometry CPU
reference into EEVEE, compositor-field, material or scene coverage by name.
