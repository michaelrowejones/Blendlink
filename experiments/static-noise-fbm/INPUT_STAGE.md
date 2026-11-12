# Static coordinate arithmetic admission

Actual native 4.2 EEVEE 4D Color coordinate canaries distinguish source staging:
`((1e8+1)-1e8)-1` and `((1e8-1)-1e8)+1` produce the same native coordinate
result here, while 5.2/5.3 MF retain Float32 intermediates and produce -1/+1.
This evidence is specific to the tested shader input context; it does not
establish a universal binary64 model for all legacy shader operations.

The earlier CPU optimization used Float32 coordinate arithmetic in every
stage. Native 4.2 errors were .022147/.055669 in mapped Color, on both browser
APIs. Declining CPU folding alone makes WebGPU match, while WebGL2 still has
those errors through its older GPU path. Therefore fresh EEVEE 4D Color FBM
with zero Distortion refuses this supported static input subset when any
coordinate/W arithmetic lacks an exact portable certificate. The named reason
asks for literal coordinates or source baking. MF inputs retain their Float32
literal fold. Dynamic inputs, legacy `noise`, other dimensions/modes, and old
serialized GPU paths retain their existing behavior.

The runtime evaluator uses exact input arithmetic for shader/unknown stages
and Float32 stages only for explicit `shader-mf`. `noise_static_inputs.py`
provides the matching read-only source certificate:
`constant_input(expression) -> (Float32 value, all_arithmetic_exact)` or `None`
for unsupported/opaque trees. Callers granting a precision certificate must
require the second value to be true. Inputs and intermediate results are
ordinary finite Float32 values (or zero), with depth32 /256-node limits.
An exponent-gap check prevents binary64 addition from falsely certifying a
Float32 sum after binary64 itself loses a much smaller addend. This helper
does not change the existing Python-double scalar folder.

Generate numeric MF cases and the actual legacy refusal/graph/pixel evidence:

```sh
BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_NOISE_INPUT_STAGE_CANARY=1 BLENDLINK_NOISE_ENGINE=EEVEE \
BLENDLINK_NOISE_EVIDENCE=/absolute/canonical/evidence \
node experiments/noise-fractal-differential/run.mjs --built
```

Use official native 4.2, 5.2 and 5.3 binaries. Native 4.2 records two named
refusals, each with the original authored graph and unchanged native pixels;
the three independent positive carrier/image controls still render. Modern
versions each admit five cases including those controls, and both browser
APIs pass under the unchanged numerical budgets. Read-only default admission
is also covered by `tests/noise_static_input_admission_check.py` on all three
native versions. The previously failing Linux high-detail default raw8 and
normalized4 focused cases remain admitted and pass both built browser APIs.

For the retained 4.2 canaries, native pixel hashes before and after refusal
are identical: `b8f3a7dbc5cc0180392aeac3ec038a55ee9423e1e0e51cddf81de6dbc7cbf384`.
Already serialized shader-context canaries remain unqualified on WebGL2;
re-export applies the fresh-source refusal.
