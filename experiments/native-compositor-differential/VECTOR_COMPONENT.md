# Fixed compositor Vector Component

`FunctionNodeGetVectorComponent` qualifies on exact Blender 5.3.0 for typed
integer Index 0, 1 or 2. It lowers to the existing `separate-vector` x/y/z
selection; no new mathematical operation or opcode is introduced. Unlinked
integer defaults and actual Input Integer nodes can pass through reroutes and
groups. Float/Boolean conversion, computed/dynamic selectors, out-of-range
values, animation/drivers, unmeasured versions and unknown schemas refuse.
Existing ordinary Separate XYZ documents retain their behavior.

Blender 4.2.0 and 5.2.0 cannot create the actual node. Their availability
receipts contain zero numerical cases; these are N/A, not empty browser passes.
Creation in GeometryNodeTree does not imply geometry execution support.

The native fixture checks 63 selections per compositor device: four finite
vector sources, three indices, five literal/group/reroute transports, and three
small-value amplification graphs. Each is paired with an independently authored
Separate XYZ graph. Two independent carriers complete 128 scenes/device,
**256 native scenes total**. Recorded native Float32 selection/control words
match, while **1,024 browser readbacks** across physical Metal and SwiftShader,
each through WebGPU/WebGL2, have numeric maximum error **0** under the unchanged
`2e-5` compositor budget. Browser signed-zero bit parity is not claimed.

The oracle's unused scene uses empty one-sample Cycles CPU. Compositor CPU/GPU
is an independent evaluation choice; the fixture records actual graphics
context identity after initialization rather than inferring it from requested
preferences. Fresh hosted OpenGL compositor qualification is separately earned
in the reviewed receipt below.

Source extraction is fingerprinted before/after with input **and output**
defaults, literal properties, groups and links. Eleven actual refusal graphs
and four artificial schema guards remain distinct. A real ZIP of the staged
add-on is extracted into an isolated package namespace; all three selectors
and five transports must match canonical extraction without source changes.
This verifies package-qualified imports and bytes, not additional native pixels.

Generate actual references after a clean, coordinated package build:

```sh
BLENDLINK_COMPOSITOR_COMPONENT_DEVICE=CPU \
BLENDLINK_COMPOSITOR_COMPONENT_REFERENCES="$PWD/artifacts/component/cpu" \
BLENDLINK_COMPOSITOR_COMPONENT_PACKAGED_ADDON="$PWD/packages/blendlink/dist/addon" \
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_vector_component_check.py
```

Repeat with GPU. Then verify actual source/ZIP receipts and compare the built
runtime. The browser runner does not regenerate or modify native pixels:

```sh
node scripts/check-compositor-component.mjs --source artifacts/component/cpu artifacts/component/gpu
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/component/browser artifacts/component/cpu artifacts/component/gpu
node scripts/check-compositor-component.mjs --browser artifacts/component/browser/results.json \
  artifacts/component/cpu artifacts/component/gpu
node --test scripts/compositor-component-policy.test.mjs
```

Use Node24. Set `BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium` for the bundled full
Chromium run; the captured adapter determines actual hardware/software identity.
The strict reader binds every browser case to its native CPU/GPU source list,
checks both APIs, controls, source/model/schema, refusals, package hashes and
shader/backend errors. A count-only or control-only report cannot qualify.
The central compositor parity suite records old-version N/A separately; the
existing native Vector Component 5.3 canary also runs both compositor devices.

This remains a partial fixed-selector port. Arbitrary selectors, geometry
execution, all-node parity and whole-scene display equivalence are not implied.

### Reviewed Linux OpenGL receipt

Checkpoint `9d137e3`, run43411851888/job131839951921 passed with actual
Blender5.3 OpenGL/llvmpipe. The [shared receipt](../vector-component-differential/opengl53-receipt.json)
binds artifact14029991998 and its verified archive digest. Shader proof retains
42 paired selections and two independent native carrier controls (88 browser
carrier reads), plus84 exact raw algebraic controls. Its maximum carrier budget
ratio is0.972426; the independent half-target allowance is not node precision.
The separate compositor CPU/GPU proof contains256 native graphs and512
browser readbacks, maximum error zero. Current-source/ZIP guards and strict
browser readers pass; geometry execution, dynamic selectors, signed-zero
browser parity and actual visitor Final pixel publication remain outside scope.
