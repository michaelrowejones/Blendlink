# Physical camera DOF candidate

This is an explicit, **unqualified** research route, not automatic native-camera
DOF support. Both first candidates have correct numerical CoC but **fail visual fidelity**. Candidate 1:
foreground silhouettes stay too sharp and sparse near-field gathering makes
repeated/halo edges. Do not enable it in generated websites or count it as a
supported Blender node/scene. The existing camera warning remains active.

The source presentation now transports evaluated camera lens, f-stop, aperture
shape, focus, projection, clipping, Y-up transform, frame and physical render
extent. Extraction does not save or alter the source. The SDK opt-in is
`sourceCameraDepthOfField: 'experimental-physical-coc-v1'`; absent this explicit
request, the metadata has no rendering effect. The separate artistic website
DOF component is unchanged and cannot combine with this candidate.

## Source and mathematical scope

Pinned Blender source: `02f0899d78e374b63e7181d9061e1f7ab03419cc`.
`sources.json` hashes the audited files. EEVEE's perspective aperture radius is
`lens_mm * .001 / (2 * max(fstop, 1e-5))`. Project that aperture at the evaluated
focus plane to obtain pixel CoC bias; signed radius at positive camera-axis
depth `z` is `bias * (1 - focus/z)`. Near is negative. This is the total optical
footprint; native temporal jitter/post splitting is excluded. Scene unit scale
does not appear in that native aperture calculation; nonunit glTF scale is
conservatively excluded here.

The independent CPU/native oracle explicitly projects aperture and center
points with homogeneous coordinates before the inverse-depth MADD. Native
focus-object extraction uses axial distance, including evaluated bone matrices,
but that input is rejected for rendering until tracking is qualified.

Three r184's [DepthOfFieldNode](https://threejs.org/docs/pages/DepthOfFieldNode.html)
uses an artistic smoothstep range in world units; its `focalLength` parameter
is not the camera lens in millimeters. No range conversion is used here.

## Candidate 1 sampling history and common exclusions

Full physical drawing-buffer resolution, with no silent quality reduction:
32 adaptive central-disk samples + 32 inverse foreground-disk samples + center
= 65 color reads and 65 depth reads per output pixel. A uniform-area disk is
used, with the authored native maximum radius retained up to 100 pixels.
New intermediate RTTs use the existing owned-resource lifecycle; caller-owned
input textures and quad geometry remain borrowed. DOF precedes HDR website
effects, native compositor, and display transform.

Rendering refuses other source builds, non-perspective cameras, animated or
constrained camera/scene optics, object/bone focus, polygon/anamorphic aperture,
jittered DOF, render borders, nonsquare pixels, nonunit glTF units, radius over
100 pixels, transparent/cutout/transmission/non-depth-writing materials, or
logarithmic/reversed depth. Active camera name, fixed transform, projection
x/y/w rows, near/far and original aspect ratio are checked before installation
and each render. Changes to transported optical parameters also refuse.
Output size may change at the authored aspect; pixel CoC scales with actual
physical width, with the native pixel-radius cap unchanged.

This is not EEVEE's separate foreground/background reduction, dilation,
coverage, scatter, stabilization or near-field resolve. Hidden surfaces cannot
be recovered from one depth layer. High-contrast edges, bokeh highlights,
occlusion, transparency and temporal behavior remain image-qualification gaps.

## Retained first controls

`impact-optics.json` was extracted read-only from the unchanged official original
SHA256 `6785c3b4c5b50e2eab7b088914f6558b90aa3dad9cd105ef57d2973495c7b69c`.
It is a CPU fixture, not scene acceptance. Actual settings: 50mm, f/0.5,
focus 6.928999900817871, circular aperture, native maximum 100px, jitter off.

Native CPU test:

```sh
blender --background --factory-startup --disable-autoexec --threads 2 \
  --python-exit-code 1 ORIGINAL.blend \
  --python packages/blender-addon/tests/camera_dof_optics_check.py -- NEW_REPORT.json
```

The first browser capture is retained at
`/tmp/scenetoweb-camera-dof-browser-r1/report.json`, with exact producer/browser
snapshots and four 1280x720 sharp/candidate PNGs. Both actual WebGPU and node
WebGL2 compiled and rendered; eight float CoC readbacks each differed from the
independent projected-aperture oracle by less than 0.000001 pixels. All 281
material applications remained active, zero skipped, no browser shader errors.
Candidate first-ready observations were 4.586s WebGPU and 5.688s node WebGL2;
these are single warm-profile observations, **not** performance qualification.

These captures deliberately use a research descriptor: preserved `099e993`
original geometry/material assets plus evaluated optical metadata injected
into a new source-presentation document. The derivative omits the old assetGraph
because that graph describes the old presentation bytes. It is not a fresh
Final/package qualification. The exact R1 producer remains saved in its output
directory if this harness evolves. `runtime-source-observation.json` and its
copied SDK files were collected immediately afterward without intervening
candidate implementation edits; they are explicitly a post-capture observation.

Compare with the retained original EEVEE frame0/64-sample reference at
`/tmp/scenetoweb-impact-native-reference-r2/native.png`, not a newly sharpened or
DOF-disabled Blender source. No new native renders were needed for this pilot.

## Candidate 2: near/far separation and radius-aware foreground bounds

The current experimental implementation adds source-derived **bounding**
principles: 16 physical pixel tiles (native 8 half-resolution pixels), all 256
physical depth pixels observed per tile, native gather-ring count 5 radius
error factor `1+1/5.5`, and radius-aware neighboring tile propagation. The
color and camera-depth images remain full resolution; the tile texture holds
only conservative search bounds, not decimated color. The depth intermediate
is float32. Up to 289 tile reads per bound tile at the native 100px cap.

Separate 128-sample foreground and 64-sample far/background gathers plus center
mean 193 color and 193 depth reads per physical output pixel. In-focus
background pixels can receive blur from neighboring negative-CoC foreground.
Foreground holes gather visible nonforeground radiance before composition,
rather than retaining the original hard foreground silhouette. This remains
an independently implemented approximation: it does not reproduce native
near/far layer weights, occlusion masks, scattering, slight-focus resolve,
spatial filtering or temporal accumulation. The experimental option retains
its optics-contract version `v1`; the inspectable sampling model is
`experimental-physical-coc-near-far-v2`. No stable image contract is implied.

Actual source-backed captures are retained at
`/tmp/scenetoweb-camera-dof-browser-r2`: producer/browser snapshots, complete
SDK source snapshot **before** capture, report, sharp/DOF images for both real
backends and `display-differences.json`. Every preserved `099e993` website file
was checked against the earlier R2 asset pins, the original blend hash stayed
unchanged, and the retained native reference PNG matched its report. The
research descriptor limitation above still applies; this is not fresh Final
package qualification. All 281 materials applied, zero skipped, zero browser
shader errors, all eight numerical CoC readbacks within 0.000001 pixels.

The silhouette is visibly softer, but the complete image remains a **failure**.
The repeated high-contrast edges/halo and foreground radiance/occlusion do not
match EEVEE. The native reference, original full-frame resolution, display
pipeline, frame, material programs and sharp controls were retained. Display
encoded metrics use frozen full-frame, bottom foreground and focus-object
regions; lighting/material differences also contribute, so these numbers do
not isolate optical parity:

| Capture | WebGPU full-frame RGB MAE | WebGPU foreground RGB MAE | node WebGL2 full-frame RGB MAE | node WebGL2 foreground RGB MAE |
| --- | ---: | ---: | ---: | ---: |
| Sharp control (repeat stable) | .02487 | .03239 | .02491 | .03236 |
| Candidate 1 | .02519 | .03595 | .02437 | .03484 |
| Candidate 2 | .02681 | .03946 | .02674 | .04027 |

Candidate 2 first-ready single observations: 5.113s WebGPU, 6.418s node WebGL2;
sharp 3.600s/5.832s. These are not benchmark qualification or steady-state cost.

Run the bounded research harness with explicitly supplied immutable inputs:

```sh
node experiments/camera-dof-physical/run.mjs NEW_OUTPUT_DIRECTORY \
  PRESERVED_WEBSITE_DIRECTORY ORIGINAL_GENERATED_DESCRIPTOR.gen.ts
node experiments/camera-dof-physical/compare.mjs NEW_OUTPUT_DIRECTORY
```

The harness must not overlap other native/GPU qualification. It uses Chromium
with a real adapter/backend, keeps the full 1280x720 output, snapshots imported
SDK source before running, and refuses changed source/asset/reference pins.
Default local input paths refer to this retained pilot; they are not public
release artifacts. The source-presentation metadata is deliberately injected
in a derivative descriptor, not represented as unchanged original Final bytes.

Next bottleneck is faithful source near/far coverage, occlusion and resolve,
with controlled synthetic edges/occluders and original full-frame comparison.
Density alone did not improve this pilot. Automatic native-camera DOF remains
disabled, the source warning remains, and no support/scene-acceptance credit is
granted by either candidate.

## Isolated native DOF delta control

`delta-r1-receipt.json` pins the native DOF-on R2, one native DOF-off render,
all web captures, source snapshots, comparison producer and signed observations.
The off control completed on the same original, native build, EEVEE frame 0,
64 samples and 1280x720; only camera DOF was disabled in memory. The original
file stayed unchanged and DOF was restored; no scene saves occurred.

The native effect's full-frame display RGB MAE is .006885. Candidate 2's web
effect is .015028 WebGPU/.015093 node WebGL2. Its signed-delta MAE versus native
is .012923/.012804: 1.877x/1.860x the error of predicting no DOF. Foreground
delta error is .027759/.028975 versus a no-DOF baseline .018721. Both candidates
still fail after removing fixed baseline differences. Nonlinear light/material,
bloom and display coupling remain; this is not a pass/fail fidelity protocol.

The smallest next unit is source-derived **layer eligibility and overlap plus
slight-focus/focus resolve**, before ring/scatter work. Native foreground weight
starts above full-resolution radius 2.5px and reaches full weight at 3.5px;
background starts above 3px and reaches full weight at 4px. Slight-focus weights
overlap through 5px, while exact focus applies at absolute radius <=.5px. The
current hard .5px sign split incorrectly routes slight-focus surfaces into the
near/far layers. Implementing those equations alone will not qualify native
ring opacity, hidden-surface reconstruction, bright scatter or temporal resolve.

## Private candidate 3 unit and integration boundary

Candidate 3 adds independently written scalar eligibility/overlap equations,
linear disk intersection and explicit premultiplied ordering. A separate
slight-focus field uses 16 symmetric disk pairs plus center at the source
maximum 5-pixel search radius, without reducing the original scene resolution.
Total maximum direct color/depth reads are 225 each per output pixel, plus the
unchanged bounds passes. The inspectable sampling model is
`experimental-physical-coc-layer-resolve-v3`.

The foreground/far large kernels and slight-field coverage remain independent
approximations: native ring occlusion, transparency accumulation, scatter,
spatial filtering and temporal resolve have **not** been ported. Source scalar
math, overlap endpoints and layer composition are tested separately from image
behavior. Native GPU CoC attachment readback is still absent. Neither the first
two failures nor this bounded mathematical unit permit default enablement.

This candidate is a **private research patch, not a published SDK feature**.
The integration checkpoint retains the experiment and `sdk-candidate.patch`;
it does not add an advertised experimental option to the normal published SDK.
The full private branch is retained for exact source-backed proof. The patch
contains SDK/addon changes and focused tests relative to public base
`751dcffec11256f0b6347d833eef4bb9f8525f47`. Apply it only in a separate checkout
of that base, copy this experiment folder, install the pinned repository
dependencies, and run the focused tests/build before the coordinated GPU pilot:

```sh
git apply --unidiff-zero --index /ABSOLUTE/PATH/sdk-candidate.patch
npm run test --workspace scenetoweb -- src/sourceCameraDofLayers.test.ts \
  src/sourceCameraDof.test.ts src/sourceCameraDofCoverage.test.ts \
  src/threeWebgpuPostPipeline.test.ts
npm run build --workspace scenetoweb
```

The harness requires the unchanged original blend, preserved `099e993` website
and original generated descriptor plus the earlier R2 native reference and web
asset pins. Those local artifacts are intentionally not included as source
files or represented as newly distributable release evidence. Every capture
records the candidate patch hash, actual imported SDK source snapshot and
producer bytes. Candidate 3's GPU controls additionally check 19 eligibility
boundary values and three explicitly declared 16x9 constant-HDR synthetic
fixtures; the original-scene images remain full 1280x720. Source math closes
CPU tests before the one requested same-input browser delta pilot.

## Frozen candidate 3 result: still failed

`candidate3-r3-receipt.json` pins clean private source commit
`67d9cb3bddab7c16642fe12aa538c0e32d5f8c35`, the exact patch, source snapshots,
producers, original-scene captures and the signed-delta comparison. The one
coordinated GPU run completed on actual WebGPU and node WebGL2; all 19 layer
boundary readbacks were exact, the three explicitly 16x9 synthetic HDR fixtures
changed by at most .00001099, and all 281 materials applied without errors.
The original-scene captures remained 1280x720; their sharp controls exactly
repeat the earlier absolute difference metrics.

The scalar improvement did **not** improve the image gate. Candidate 3
full-frame signed-delta MAE is .015174 WebGPU/.014306 node WebGL2, or
2.204x/2.078x the no-DOF error. Focus-object delta error is .023816/.022194,
3.281x/3.058x no DOF. Native on/off images were reused byte-for-byte; no second
native render occurred. Ready timings are warmed by the added controls and
are neither startup benchmarks nor comparable to previous rounds.

The remaining accumulator, coverage and occlusion semantics are substantial.
No further sampler rewrite, native support claim or SDK enablement follows
from this batch. The patch and all failures remain research evidence only.

`candidate-sdk-files.json` pins all 16 addon/SDK/test files in the zero-context
patch. The patched private research entrypoint verifies those exact bytes
before reading private scene inputs or opening a browser. Verify without GPU:

```sh
node experiments/camera-dof-physical/run.mjs --check-sdk
```

In the ordinary public SDK checkout that command deliberately refuses the
missing/mismatched private patch. The entrypoint never applies patches itself.
Apply the patch only in the isolated base checkout described above; the normal
published runtime and generated websites have no unqualified DOF API.

A later signed comparison writes fresh observations without replacing the
first control's report:

```sh
node experiments/camera-dof-physical/compare-deltas.mjs \
  NATIVE_OFF_DIRECTORY WEB_CAPTURE_R1 WEB_CAPTURE_R2 WEB_CAPTURE_R3 \
  --out NEW_DELTA_OUTPUT_DIRECTORY
```
