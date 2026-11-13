# Native fixed compositor Switch

The legacy `check` property and modern unlinked Switch Boolean select the
native Off or On input. The selected graph remains live. Unselected graphs are
not exported dependencies, so an unsupported inactive look does not prevent the
active look from translating. The source tree, links and choice remain authored.
Animation and linked Boolean choices require a separate live-choice contract and
are explicitly refused.

A versioned `fixed-choice-v1` operation preserves the Switch's artist-facing
source identity and selected input. The runtime refuses unknown choices/models;
it never guesses another branch.

There are 11 actual native graphs per Blender version/device: field/constant
pairs in both orders, two fields, two signed/HDR constants, and an inactive
Transform branch that remains unported. CPU and native Metal GPU are separate
on Blender 4.2/5.2/5.3. All 66 graphs passed each built browser backend, maximum
absolute error 4.76837158203125e-7. These are fixed-choice semantics, not a port
of per-pixel or animated Switch controls.

```sh
BLENDLINK_COMPOSITOR_SWITCH_REFERENCES=artifacts/switch-cpu \
  blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_switch_check.py
BLENDLINK_COMPOSITOR_SWITCH_REFERENCES=artifacts/switch-gpu \
BLENDLINK_COMPOSITOR_SWITCH_DEVICE=GPU \
  blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_switch_check.py
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/switch-browser artifacts/switch-cpu artifacts/switch-gpu
```
