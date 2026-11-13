# Light Falloff: preserve the source engine

Actual Blender 4.2.0, 5.2.0 and 5.3.0 renders show that an automatic EEVEE to
Cycles channel bake changes this node's output. This is a fallback-safety proof,
not a live Light Falloff port.

The same authored plane, orthographic camera, ALL Material Output and Emission
graph are rendered with both engines. Strength is 2, Smooth is 0 or 1, and each
of Quadratic, Linear and Constant is connected in turn. EEVEE produces 2 for
all six combinations. With Smooth 0, Cycles produces approximately 3.8 for
Linear and 7.22 for Constant; with Smooth 1, even Quadratic changes to about
1.56616. Camera near clipping affects the Cycles ray distance, so camera object
distance alone is not an equivalent input model.

The [receipt](receipt.json) pins 36 native EXR files, 18 same-graph engine pairs,
all three native builds, actual post-render Metal identities and the unchanged
graph checks. Cycles explicitly runs on CPU. Querying the backend after a
render does not establish that a normal background export can attest it before
creating a GPU context, and does not promote the separate Blender 4.2 Squeeze
path.

`engine_fallback.py` now names Light Falloff when an automatic channel fallback
would switch engines. The native regression covers all three outputs, channel
isolation, nested groups, source preservation and the same-engine guard path.
Explicit artist-selected Cycles baking retains its separate intent and checks.

## Blender 4.2 context research

The post-render platform query exposed a possible path around the separate
4.2 background-attestation blocker. In an isolated factory process,
`context42_probe.py` first observes the real "GPU functions for drawing are not
available in background mode" error. An owned empty 1×1 EEVEE scene then
initializes the device; the real platform query reports Metal/Apple M5 Pro.
Removing the temporary scene, camera, object and newly created Render Result
preserves the original scene, selection, active object, object transform,
custom properties, render dimensions and all inspected datablock identities.

The measured cold operation took about 3.4–3.6 seconds on this host. Additional
saved-file probes preserved the filepath and the observed dirty flag (true
before and after); they do not prove behavior from a clean dirty flag. The real missing-camera render failure also preserves the inspected source
state and leaves the backend unavailable, as captured by
`context42_failure_probe.py`. Existing Render Result preservation and GPU device
failure paths still need verification.
This remains research with zero live admission; the production Squeeze 4.2
route continues to refuse. No backend is inferred from preferences or hardware.

To reproduce, run from the repository root with the actual Blender executable:

```sh
BLENDLINK_FALLOFF_EVIDENCE=/absolute/path/to/evidence \
  "$BLENDLINK_BLENDER" --background --factory-startup -t 1 \
  --python-exit-code 1 --python experiments/light-falloff-engine-differential/native.py
```
