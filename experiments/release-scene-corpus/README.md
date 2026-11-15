# Release scene selection and node backlog

The source-owned [shortlist](../../docs/release-scene-corpus.json) and
[node backlog](../../docs/release-scene-node-backlog.json) make demo-driven
porting explicit. They contain source inventory, not successful exports or
node-support promotions. No downloaded scene or texture is redistributed.

## Audition order

| Original official scene | Authored source | Conservative reachable shader/compositor kinds | Current 5.3 catalog categories | Decision |
| --- | --- | --- | --- | --- |
| Archviz by Marek Moravec | EEVEE; 156 scene objects; CC0 | 15 | 2 supported, 9 partial, 2 unsupported, 2 structural | Selected first live porting target; prove the complete scene before accepting it |
| Impact Fracture by Simon Thommes / Blender Studio | EEVEE; 285 objects; CC0 | 12 | 1 supported, 8 partial, 3 structural | Selected second target; artifact export passes, installed browser initially refuses area lighting |
| Classroom by Christophe Seux | Cycles; 304 scene objects; CC0 | 58 | 13 supported, 30 partial, 7 unsupported, 8 structural | Provisional bake candidate; complexity review required |
| Lone Monk by Carlo Bergonzini / Monorender | Cycles; 1,368 scene objects; CC-BY version unresolved | 50 | 11 supported, 28 partial, 5 unsupported, 6 structural | Provisional; complexity and exact redistribution license unresolved |

These counts describe existing catalog classifications, not scene qualification.
All complete scene graphs remain pending. Archviz and Impact Fracture are fixed
porting targets; the complete positive shortlist is not frozen. Classroom and
Lone Monk remain provisional rather than a hidden unlimited 1.0 commitment.
There are 75 distinct reachable shader/compositor kinds across the four sources.
The full 165-kind authored inventory also preserves unreachable nodes, unused
geometry tool groups and separate geometry modifier nodes.

Classroom references three Render Layers scenes, includes an 8,000-particle HALO
dust source and a substantial compositor. Lone Monk includes 6,000 HAIR collection
instances and uses Particle Info, Light Path and Sky. These dependencies need
deliberate scene-level routes; baking a camera image does not qualify live ports.
Archviz's embedded historic README mentions carpet hair, but the current 5.3
inventory finds no particle systems. Preserve that distinction.

The first actual missing catalog routes are Light Path and Environment Texture
in Archviz. Shared larger-scene gaps include Lens Distortion and Sky. Other
audition gaps are Bokeh Image, Normalize, Glass, Translucent, Displacement,
Dilate/Erode and Particle Info. A world/environment route may belong to scene
preparation rather than a material shader opcode; verify the actual authored
use before implementing a second path.

BMW and Barcelona were also inspected locally. BMW's current official download
has no embedded license, and the author's current portfolio does not supply a
recovered grant. Barcelona's exact CC-BY version remains unresolved. Neither
is declared CC0 or selected merely to make a smaller positive corpus. The
original Cube Diorama, Mandelbrot and Radial Tiling stress receipts remain in
their existing corpus, with their original failure statuses intact.

## Reproduce source acquisition and inspection

Impact Fracture has an authored camera, 282 meshes, two lights and 20,537
render-visible evaluated triangles, with no actions, drivers, node animation,
particles or undefined nodes. The typed libraries/external-Image inventory is
empty; this is narrower than Blender's global file paths. On `5ef60b8`,
source-original `plan --blend --json` exits 0 with eight automatic program
channels for `Material` and an explicitly approximated stock `ground` material.
Active compositor settings are Diamond Sharpen, factor 0.5, followed by Medium
Bloom, threshold 2, smoothness 0.1, clamp maximum 10, strength 1.6 and size 0.5.
Those actual modes still need native/browser qualification.

The first standalone Final on `a45853f` fails after glTF writing with private-mesh
cleanup/binding errors. That failed receipt remains recorded. After the ownership
fix, Final on `6d7c1cf` produces a website with 21 independently hash-checked
files, totaling 12,852,922 bytes across the complete directory, including duplicate
stable/addressed assets. This is not initial network transfer. Original source
bytes remain unchanged. The first installed-browser baseline refuses authored
Rect Area lights with the node renderer despite successful HTTP loads. Artifact
smoke is not visible-scene, fidelity, node-mode or release acceptance. After the
renderer-local Area-light fix, the original website renders on WebGPU and node
WebGL2 with 281 translated assignments and zero skips. The
[new baseline receipt](../../docs/release-scene-browser-baseline.json) pins both
browser captures, a retained website snapshot and the controlled native image.
DOF fidelity and startup performance remain open, and acceptance stays false.

Blender reports two missing global file paths. The
[native closure audit](../../docs/release-scene-closure-audit.json) accounts for
all 16 occurrences as weak append-provenance references on local Geometry Node
groups: 15 reference the author's hair-asset file and one references an old
Viewport Transform Test file. Every owner is outside the current scene's
transitive ID dependency closure, and there are no active Geometry Nodes
modifiers. The locally embedded groups remain; no linked library is loaded.
This supports unused provenance for this exact saved scene, not a blanket
claim that the source has no dangling references. Compiler warnings and
external-dependency policy are unchanged. Edits using those groups need a new
audit.

Reproduce this read-only audit separately; the original inventory's
`sourceClosure` field covers typed libraries and unpacked Images only:

```sh
blender --background --factory-startup --disable-autoexec impact-fracture.blend \
  --python experiments/release-scene-corpus/weak_reference_audit.py -- report.json
```

[Additional auditions](../../docs/release-scene-auditions.json) retain original
source, inventory and plan-log pins. Pebble Scattering returns plan exit 0 but
has twelve linked `NodeUndefined` placeholders in the render-enabled
`GEO-ground/Pebbles` modifier; intended legacy semantics require independent
comparison, so it is not a positive scene. Sample UV Surface's public-checkpoint
plan fails without JSON on evaluated Geometry Nodes material inspection; a
separate structured-refusal fix is tracked by root. Gizmo Array is CC0 and plan
passes, but its original render is only a twelve-triangle default cube without
a camera, suitable as a basic fixture rather than an artist golden scene.
Pizza Delivery is CC0 but needs Holdout/instancer, simulation and broad
compositor support. Color Vortex has mismatched embedded attribution, and Curve
Bevel Profile has no recovered explicit license. None was stripped to pass.

Acquire only the hash-pinned HTTPS originals into this checkout's ignored cache:

```sh
python3 experiments/release-scene-corpus/fetch.py \
  --directory artifacts/v1-corpus/sources
```

`--scene archiviz` (or either other ID) limits acquisition. Existing cached
download bytes must match. ZIP members are checked for traversal/symlinks before
extraction; linked libraries and images stay beside the original source. Fresh
extraction is staged and validated before an atomic directory rename. Cached
members are checked against the archive without writes: changed/missing sources
or sidecars refuse and retain their bytes instead of being repaired. Concurrent
fresh extraction refuses through an exclusive lock; failed staging cleans up.

Open each file with Blender 5.3 build `02f0899d78e3`, auto-execution disabled,
without rendering, baking or saving. For example:

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --disable-autoexec --threads 2 \
  artifacts/v1-corpus/sources/archiviz.blend \
  --python experiments/release-scene-corpus/inventory.py -- \
  artifacts/v1-corpus/inventories/archiviz-final.json
```

Use each manifest `sourcePath` and `inventoryFile` for the other two sources.
Then independently recompute reachability, validate source/build/discovery pins,
and emit the source-owned backlog:

```sh
python3 experiments/release-scene-corpus/backlog.py \
  --inventory-dir artifacts/v1-corpus/inventories \
  --output /tmp/release-scene-node-backlog.json
python3 -m unittest discover -s experiments/release-scene-corpus -p '*_test.py'
```

The initial source inventory took approximately 4.6 seconds for Archviz,
1.2 seconds for Lone Monk and 1.8 seconds for Classroom on the local macOS arm64
Blender 5.3 host, including process startup. Those are source-inspection times,
not export, render, port-authoring or scene-acceptance timings. All source hashes
were unchanged; render/save/bake calls were zero. Backlog regeneration is
byte-identical. Fourteen focused CPU tests cover unused versus reachable modes,
group interfaces and distinct instances, branch retention, recursion refusal,
pin/usage tampering, zero support credit, archive safety, immutable cached sources
and sidecars, and interrupted extraction cleanup.

## Original Final and browser baseline

After building the package, export the untouched selected original with the
actual CLI. Keep a separate new cache/evidence namespace for failed attempts:

```sh
node packages/blendlink/dist/cli.js export --blend /absolute/impact-fracture.blend --out /absolute/website
node experiments/release-scene-corpus/website-smoke.mjs impact-fracture /absolute/impact-fracture.blend /absolute/website /absolute/new-webgpu-evidence webgpu
node experiments/release-scene-corpus/website-smoke.mjs impact-fracture /absolute/impact-fracture.blend /absolute/website /absolute/new-webgl2-evidence webgl2
/absolute/Blender --background --factory-startup --disable-autoexec /absolute/impact-fracture.blend --python-exit-code 1 --python experiments/release-scene-corpus/native-reference.py -- impact-fracture /absolute/new-native-evidence
```

The browser helper pins every website file, validates the original source and
website ownership marker, serves under `/showcase/`, observes the actual context,
and retains errors/screenshot/unchanged-source checks. The WebGL2 case explicitly
makes WebGPU unavailable to exercise the generated app's real fallback. It does
not alter the exported website. The native helper verifies the inventory's exact
Blender build, saves its producer, and records every render-setting override:
Object Mode and a 1280×720 PNG replace the saved editing/output settings; the
authored frame, samples, camera, engine, shading and compositor stay in use.
It never saves the `.blend`. Neither helper grants node support, numerical
fidelity, physical-device compatibility or release-scene acceptance.

Initial successful browser evidence is `/tmp/scenetoweb-impact-original-browser-r2/`
and `-r3/`; the controlled native baseline is
`/tmp/scenetoweb-impact-native-reference-r2/`. The first browser refusal and
failed Final remain separate. Camera DOF and WebGL2 startup are still open gates.

## Discovery boundaries

The inventory traverses typed socket identifiers through nested groups and back
to each instance's parent inputs. It keeps both branches and all material slots,
follows explicit Render Layers scene dependencies and collection/particle
instance objects, and inventories render-enabled Geometry Nodes modifiers in a
separate domain. Full authored usage and conservative reachable usage are
reported independently, including distinct mode sets. Raw local reports retain
socket defaults, scalar settings, curve/ramp points, image settings, owners,
links, group dependencies and source closure hashes for fixture construction.

Reachability is conservative linkage discovery, not proof that every branch or
socket affects a pixel. Collection visibility, engine-specific active-output
selection and evaluated geometry/instances are not semantically reduced.
Sources with drivers are loaded with auto-execution disabled. Input links and
expressions still need the real compiler's admission and native/browser proof.
Historical read-only inventories remain separate from new numerical evidence.

Prioritize shared scene dependencies first, then remaining used nodes/modes.
Authored-but-unreachable kinds remain visible in the backlog and are lower
priority. Geometry modifier kinds are separate evaluated-ingest work, never
silently counted as shader/compositor ports. No raw inventory, catalog category,
native class creation or successful bake can change a support status.
