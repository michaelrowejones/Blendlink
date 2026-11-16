# Static shifted-camera transport and ObjectNormal dependency pilot

Research candidate only: no default camera installation, geometry guard change,
Window/Incoming/reflection expansion, or original-scene acceptance. The material
field and camera/framing fidelity are separate correctness domains.

## Actual original and its observation cameras

Immutable Archviz original SHA256
`9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e`:
active Camera, PERSP, frame 4, 18mm lens, 32×18mm sensor, AUTO fit, clips .1/100,
shift [0,-.08999999612569809], 1920×1080 square pixels. Its render-border flag is
true, crop-to-border false, and bounds [0,0,1,1]: **effective crop/render-subrect
is false**, despite the blanket flag-based refusal. This equivalence is recorded;
it does not automatically qualify arbitrary border/crop settings.

The native vertical projection offset is -.31999996304512024. A full-size Three
view offset translates it to positive 172.799980px at 1080px height. The derived
64×4 observation scene has the same original optics but another aspect: its
vertical projection offset is approximately -2.88. These are native optical
inputs, not constants fitted to pixel results. The original source stays unchanged.

## Dependency boundary

`geometry_ir.validate_camera` currently groups ObjectNormal with all view
outputs. Runtime ObjectNormal uses packed corner normals, object/world normal
transforms, interpolated normalization and primary front-facing orientation.
It does not read projection coefficients or render-border coordinates. At a
fixed surface point, lens shift translates the image plane without changing
camera pose or the sign of a projected triangle's area. CPU tests cover that
translation/facing property for perspective and orthographic matrices.

The class/rigid-pose/facing domain still matters; do not remove camera checks
wholesale. Window explicitly consumes projection. Incoming/reflection have
other camera-dependent semantics and are not widened by this pilot. A material
may eventually admit **only ObjectNormal** under the proven field domain while
camera framing remains warned/unqualified. The current production guard is intact.

Stock glTF cameras have centered perspective/orthographic schemas; the native
exporter does not publish lens shift. Existing runtime resize updates aspect/
frustum and reconstructs that centered projection. `filmOffset` handles only
one axis and is not a complete vertical/horizontal transport.

## Candidate and CPU closure

`source_camera_projection.py` captures native evaluated `calc_matrix_camera`,
optical parameters, pixel aspect, source render extent, full border flags/
coordinates, frame and camera world transform using the **exact integer glTF
axis permutation**. `source_presentation.py` has an additive optional metadata
field; merely loading it does not install a camera. Cropped/bordered,
constrained/animated, reflected/sheared/scaled and unsupported camera types
remain outside this candidate's admission.

`createExperimentalSourceCameraProjection` creates a new research-owned camera;
it never mutates an application camera. It decodes source XY frustum terms and
uses Three's `setViewOffset`/frustum parameters. Three generates clipping Z for
its active WebGL or WebGPU convention; raw native Z rows are not installed.
The source FOV, sensor fit and pixel aspect are already encoded in the native
matrix, avoiding a copy of Blender's projection kernel. Uniform resize preserves
authored rays; changing aspect refuses rather than silently cropping/reframing.

`native-cpu.json` retains 48 synthetic source cases across PERSP/ORTHO,
AUTO/HORIZONTAL/VERTICAL fit, landscape/portrait, square/nonsquare pixels and
zero/nonzero shifts, plus two explicitly derived original-optics64×4 observations.
Native CPU NDC points and inverse-projection rays are compared on both Three
clip conventions. The actual original and nontrivial border case are refused.
The original full-rectangle flag is recorded and remains unqualified.

The float32 native inverse of a long-range orthographic matrix loses small
near-point Z precision by subtracting values around far/2. Tests independently
check the authored near scalar and bound this CPU-oracle cancellation by
float32 epsilon×far; normalized ray directions and XY remain tightly checked.
There are 61 focused CPU tests. No matrix or ray tolerance was fitted to pixels.

## One bounded browser-only field/projection window

Reuse `/tmp/scenetoweb-box-storage-native-r3`, whose immutable actual EEVEE
capture already contains shifted source-Walls and source-Plane.021 mask,
ObjectNormal, face-ID and world-position fields at 64×4. Bind its exact native
report, producer, geometry fixture, camera world/viewFrame, contract, source
build and selected raw field hashes. No new native rendering is needed.

The new factory is the only positive-camera transport. Source optical matrices
are checked against native `view_frame` corners. Pose comes directly from the
native observation report with the exact glTF basis change, without pixel fit.
Existing field gates remain fixed: mask 0; others existing 1/1024 max absolute.
A fresh camera with ignored shift is drawn as a negative before any reuse of
that negative camera and must exceed the existing position gate. Shader code
never receives native per-pixel answers; host-side comparison performs gating.

```sh
node experiments/camera-projection-shift/browser.mjs \
  /tmp/scenetoweb-box-storage-native-r3 NEW_OUTPUT_DIRECTORY --gpu-lease
```

Run only after explicit GPU scheduling. The four tuples are two actual source
observation geometries on real WebGPU and node WebGL2. Imported SDK source and
all camera/native inputs are pinned and retained before capture. This does not
qualify a default installed source camera, arbitrary resize/crop, Window,
Incoming/reflection, or the original full material/scene. Border/full-rectangle
field admission is a subsequent separately reviewed guard target, not a silent
change to this experiment.

## Replay and remaining work

```sh
npm run test --workspace scenetoweb -- src/sourceCameraProjection.test.ts
npm run build --workspace scenetoweb
blender --background --factory-startup --disable-autoexec --threads 2 \
  --python-exit-code 1 --python experiments/camera-projection-shift/reference.py -- \
  IMMUTABLE_ORIGINAL.blend NEW_CPU_OUTPUT_DIRECTORY
```

No original scenes are saved or edited; the two stock camera-only GLBs are tiny
owned controls. Native reference producers and helper bytes are retained beside
the CPU reports. Backend raster/image controls and actual install/resize/lifecycle
proofs are required before default enabling. This snapshot keeps source camera
metadata and the factory isolated from normal runtime installation.

The private SDK candidate can be replayed against public base
`751dcffec11256f0b6347d833eef4bb9f8525f47` with the experiment folder present:

```sh
git apply --unidiff-zero --index /ABSOLUTE/PATH/sdk-candidate.patch
```

`candidate-sdk-files.json` pins every changed SDK/addon/test file. The browser
entrypoint refuses mismatched candidate bytes before opening GPU. No production
runtime installer consumes the metadata or calls the factory in this snapshot.

## Frozen first capture: failed, then CPU-only row-layout diagnosis

Frozen private candidate `6019e1ba0c4dee223744c93bd34ec0dbe584efcb` produced
`/tmp/scenetoweb-camera-shift-browser-r1`. The original run exited 1: source-
Plane.021's mask matched, but its ObjectNormal comparison had 10 words over the
unchanged 1/1024 gate (maximum .1760581434). Both WebGPU geometries had already
been drawn; all 10 raw positive/negative rows remain in the unchanged report
(8 full uint32 arrays plus 2 pinned raw files). The early host assertion prevented
WebGL2 capture. `browser-r1-receipt.json` pins the full failed report, producers,
camera packets and saved files. This run remains **failed and incomplete**.

CPU diagnosis independently projected the retained decoded world positions
through the native source matrix and pose. The first raw WebGPU row maps to
NDC y=+.75, while the first Blender Image.pixels row maps to -.75. Three 0.184.0's
common readback delegates directly to its backend: WebGPU copies texture rows
unchanged; WebGL calls readPixels unchanged. Those implementations are pinned
in the receipt. The initial producer had no row-origin schema or conversion.
Native Blender pixels use bottom-up order; these WebGPU pixels use top-down.

`replay.mjs` is a separate CPU forensic reader. It preserves every source byte,
reverses **whole rows only**, and applies the original field gates. It verifies
the native source/build/report/raw hashes and all historical source pins before
reading. Its independent position-to-NDC witness covers 76 Plane pixels and 112
Walls pixels: top-left y error is at most .00002607 NDC, versus 1.500024 if
incorrectly interpreted bottom-up. A small asymmetric synthetic test verifies
the row operation without scene pixels.

With that explicit coordinate conversion, all 8 retained WebGPU positives pass
the original gates: Plane normal .00020647, position .00048196; Walls normal
.00008431, position .00048542; both masks and face-ID fields are exact. Ignoring
shift remains discriminating: position fails 83/139 words, maximum
.01418936/.70458984. `r1-layout-diagnosis.json` pins all raw/normalized values
and measurements. These are CPU replay findings, **not a replacement passed
GPU capture, node support credit, guard admission or scene acceptance**.

```sh
node experiments/camera-projection-shift/replay.mjs --self-test
node experiments/camera-projection-shift/replay.mjs \
  /tmp/scenetoweb-camera-shift-browser-r1 \
  /tmp/scenetoweb-box-storage-native-r3 NEW_LAYOUT_DIAGNOSIS.json
```

The corrected producer now declares backend row origins before comparison:
WebGPU top-left is converted to native bottom-left; WebGL2 remains unchanged.
An independent signed XY fullscreen interpolation checks all 256 raw pixel
coordinates against that fixed API convention (2^-20 calibration gate).
Every raw geometry row and calibration is saved before any comparison assertion;
normalized rows are saved separately. The values never choose the row mapping.
Only a newly scheduled four-tuple run can close the missing WebGL2/capture
controls. No subsequent GPU run or production guard change is part of this
checkpoint.

## Corrected R2 bounded field matrix

Frozen producer `6bb3d70fc76c13f6301f425cd76df511022fe282` subsequently ran once
with an explicit browser-only GPU lease. It passed all four tuples: two immutable
original-derived observation geometries on actual Apple Metal WebGPU and node
WebGL2. No new native render was needed. The original full-file hash remains
unchanged. R1's failed report and all its raw rows remain preserved separately.

The independent XY calibration measured 1.49e-8 WebGPU / 5.96e-8 WebGL2 maximum
error against its fixed 2^-20 gate. Across both APIs, all sixteen positive fields
have zero gate violations; masks and face IDs match exactly. Maximum normal
error is .00020647049, maximum world-position encoding error .00048542023,
against the unchanged native 1/1024 field gate. The two ignored-shift negatives
fail 83/139 words on each API (max .01418936/.70458984). There are no shader or
page errors. Raw and normalized bytes are separate and hash-pinned; normalization
only reverses whole WebGPU rows, with WebGL2 bytes unchanged.

`browser-r2-receipt.json` records the exact source/native/build/producer/report
pins, backend identities, calibration, twenty field rows and narrow scope.
`verify.mjs` independently re-reads every raw/normalized/native field on CPU,
verifies source snapshots/producers, checks the predeclared orientation and
calibration, and recomputes every field maximum/violation and negative outcome.

```sh
node experiments/camera-projection-shift/verify.mjs \
  /tmp/scenetoweb-camera-shift-browser-r2 \
  /tmp/scenetoweb-box-storage-native-r3
```

The successful controls justify reviewing an **ObjectNormal-only** projection
guard exception separately. They do not automatically enable camera transport,
admit other geometry outputs or crop settings, certify aspect-changing resize,
or accept the original scene. Production guards and default installation remain
unchanged. ORTHO currently has CPU matrix/ray coverage only, not this GPU image
control. No timings here are performance benchmarks.
