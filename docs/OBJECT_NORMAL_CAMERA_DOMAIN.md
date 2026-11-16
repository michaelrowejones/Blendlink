# ObjectNormal material admission under a shifted source camera

This changes one source-material guard, with no runtime normal math or source
camera installation change. Texture Coordinate **Normal** (`object-normal`)
uses native packed corner normals, per-draw owner/view normal transforms and
primary front-facing orientation. Its result does not consume the source
projection matrix, shift, render-border coordinates or window coordinates.
Camera/framing fidelity remains a separate warning and qualification domain.

The exception is deliberately source-scoped: Blender **5.3.0 build
02f0899d78e3**, EEVEE `primary-triangles-v1`, `SNORM10`, and **only ObjectNormal**
among the channel's geometry-context outputs. The active source camera must be
perspective with static optics, a finite rigid non-reflected/sheared pose and
finite shift. Source pixels must be square and rendering single-view. Border
must be disabled, or have the exact full rectangle `(0,0,1,1)` with crop disabled.
The original Archviz camera uses shift_y=-.09 with precisely that full-rectangle
flag, so it has no effective subrect/crop. General render borders are not admitted.

`material_compiler` passes its existing channel IR into the optional
`geometry_ir.validate_owner(..., context_ir)` argument. The camera validator
skips only its projection/border refusal when the entire collected context has
the pinned provenance. Missing/mixed/unknown provenance keeps the original
refusal. Existing class, pose, owner deformation/mesh/normal/condition bounds,
material displacement, instance and plan-scoped cache checks still execute.
The camera check remains before the owner cache. Unscoped direct callers retain
the conservative behavior. The existing no-source-camera behavior is unchanged.

Window, Incoming, Reflection and every other geometry output keep their original
error text and projection restrictions, including mixed ObjectNormal channels.
Shifted ORTHO, Cycles, other native versions/builds and normal profiles do not
gain this exception. The 4.2/5.2 history, ordinary centered camera admission,
runtime API, IR schema and normal calculations remain unchanged. There is no
default camera transport, general Geometry-node promotion or scene acceptance.

## Evidence and regression controls

[The frozen camera experiment](../experiments/camera-projection-shift/README.md)
contains 61 CPU matrix/ray tests and the original-derived native EEVEE shifted
observations. Its corrected R2 compares source-Walls and source-Plane.021 at
64x4 on real WebGPU and node WebGL2: all sixteen positive mask, ObjectNormal,
face-ID and world-position fields pass unchanged native gates; four ignored-
shift negative rows fail. Asymmetric signed XY calibration independently proves
the declared API readback origins. The initial row-layout failure remains saved;
there was no tolerance relaxation. This is field/projection evidence on observed
Metal hardware, not whole-scene or cross-hardware camera qualification.

`packages/blender-addon/tests/geometry_camera_domain_check.py` runs without a
render or source save. On the pinned actual Blender it closes 49 source-policy
checks, including an actual shifted/full-rectangle TexCoord.Normal material
plan with valid channel IR hashes. Actual Window/Reflection/Incoming material
plans retain `material.geometry-context-unproven`, the same diagnostic text,
and per-channel IR refusal. Crop, other versions/builds/profiles, unscoped/mixed
IR, optical animation, nonrigid camera, modifier, multiview and nonsquare pixels
are negative controls. It also verifies that a successful plan cache cannot
admit a subsequent unscoped call. Historical-version branches explicitly keep
centered default callers valid and shifted callers refused.

The automatic headless runner registers its exact sentinel against the pinned
5.3.0/build/Metal/macOS-arm64 profile. Legacy versions and other hosts/backends
receive explicit zero-credit `not-applicable` accounting. Manual legacy execution
selects `BLENDER_EEVEE_NEXT`, while 5.3 selects `BLENDER_EEVEE`; a manual negative
policy check is not native material qualification.

```sh
blender --background --factory-startup --disable-autoexec --threads 2 \
  --python-exit-code 1 \
  --python packages/blender-addon/tests/geometry_camera_domain_check.py
```

Existing `geometry_export_check.py`, `geometry_context_check.py` and default
`camera_data_check.py` also pass on actual 5.3 with their render-reference
environment variables unset. Source policy logs and exact code/log hashes are
recorded in `experiments/camera-projection-shift/source-policy-receipt.json`.
