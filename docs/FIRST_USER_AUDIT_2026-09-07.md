# First-user audit, 2026-09-07

Blendlink can already take a saved, authored Blender scene through a local
browser preview and into an existing Three.js or React Three Fiber website.
The useful next step is a small private artist pilot. Public distribution still
needs independent release evidence and a clearer supported scene/device scope.

This audit started from `4309e36`. The saved checkout and task worktree had the
same commit and no uncommitted changes. There was no project-local AGENTS.md to
apply; the ancestor AGENTS.md was empty. No portfolio files or remote release
settings were changed.

## What exists

The implementation includes a Blender authoring add-on, save-driven Preview
Studio, Hybrid/Realtime/Fully Baked compilation, lighting and appearance atlases,
GLB and companion-asset publication, typed scene bindings, Three/R3F lifecycle
adapters, and Final compilation plus website build verification. Materials,
animation, compression and renderer restrictions have explicit diagnostics.
This inventory does not imply that every feature received fresh visual testing.

The main integration boundary is useful: Blender owns authored scene intent;
the website owns its renderer, Canvas, page UI and hosting. The generated
installer follows the manifest's companion assets. A generic GLB loader alone
does not reproduce every authored Blendlink setting.

## Failures found and fixed

1. **A locally installed archive could not build outside the monorepo.**
   Vite reported `Rollup failed to resolve import "n8ao-webgpu"` from the
   installed WebGPU pipeline. Existing consumer gates lived below the checkout
   and borrowed this root-only development dependency. The package now carries
   the unchanged, pinned `n8ao-webgpu@0.1.0` runtime with its CC0 license and
   upstream notice. Build assembly redirects the lazy import to that copy.
   It uses the site's Three instance instead of requiring the upstream package's
   incompatible Three peer range or a consumer-specific npm override. The
   package gate checks literal static/dynamic imports for undeclared packages
   and missing relative modules, compares the copied runtime bytes, and verifies
   the notices. Independent temp-directory installs and Vite builds passed.
2. **A successful export could contain a browser-unreadable environment.**
   The baked fixture published PNG bytes under an `.hdr` filename. Preview then
   failed with `THREE.HDRLoader: Bad File Format: bad initial token.` In Blender
   5.2, first access to a lazy generated-color buffer during save reset its
   selected format to PNG. Export trusted the filename. It now checks the
   actual signature before writing packed or linked environment bytes and
   explains the reload/repack remedy. The fixture realizes its pixels, saves
   and reloads an actual HDR before packing. The end-to-end test now decodes
   the published environment with Three's HDRLoader instead of checking only
   byte counts and hashes. The new guard checks format signatures, not every
   possible corrupt HDR/EXR body; browser verification remains necessary.
3. **The starting instructions assumed a public package.** The root README now
   leads to a source/local archive walkthrough. The guide covers Blender setup,
   material and atlas choices, separate private preview and site hookup,
   generated imports, rendering/cleanup, and copying all companion assets.
4. **Connection guidance contradicted the implementation.** The setup contract
   claimed WebGPURenderer was rejected while examples used it. Documentation
   and printed instructions now acknowledge both renderer families and identify
   the Three frame-loop calls. The R3F example no longer assumes a `Default`
   state, a `Key` light group, or a clip to start. Both examples include mobile
   viewport metadata and current package-version placeholders.

## Evidence from this run

Environment: Windows, Node 24.15.0, npm 11.12.1, Blender 5.2.0 LTS, Three
0.184.0. The focused environment regression also passed on Blender 5.1.2.

| Check | Result |
| --- | --- |
| `npm ci` and `npm run build` | Passed |
| `npm run test:unit` | 92 Vitest files, 786 passed and 2 skipped; 19 release-policy tests passed |
| `node scripts/test-examples.mjs` after build | Both committed examples passed TypeScript and Vite |
| `node scripts/test-package.mjs` after build | 335-file archive passed import/license/byte checks and packed consumer builds |
| `node scripts/test-baked-e2e.mjs` after build | Passed the real Blender multi-state bake/export/verify paths, including HDR decoding |
| `environment_payload_check.py` in real Blender | Bad packed/linked payloads refused before publication; valid HDR/EXR bytes preserved |
| Isolated add-on installation | Installed and enabled compiler-matching 0.9.0 in a disposable Blender profile |
| Actual Set Up Blendlink Scene operator | Finished on the default scene, created the Main atlas recipe, saved a real `.blend` |
| First-scene Live Preview | Browser-verified Ready; a material change and Blender save produced a different verified generation automatically |
| Existing Three and R3F sites | Local archive installation, connect, Preview compilation and Final publish/build passed; connect preserved application source |
| Production browsers | Visible scene and no page errors in both sites; WebGPU-family examples and WebGL variants checked, plus independent installed consumers outside the checkout |
| Portrait browser size | 390 x 844 checked; the diagnostic desktop camera crops side objects, demonstrating the need for authored responsive framing |
| `npm run audit:production` | Passed the existing reviewed Sharp workaround; not a vulnerability-free result |

The authored test scenes were a fresh default scene with a saved material edit
and a small two-state diagnostic scene with a realtime object, packed HDR and
Meshopt. They establish workflow behavior, not fidelity for arbitrary production
art. The browser's `Ready` acknowledgement establishes installation and render
completion, not pixel equality with Blender. Headless Chromium viewport resizing
does not establish physical-phone GPU performance.

Local logs, screenshots, scene copies and disposable sites are retained under
`artifacts/verification-newcomer/` in this task worktree and are ignored by git.
The isolated consumer paths are recorded in its `isolated-path.log` and
`isolated-r3f-path.log`. Local archive creation does not publish anything.

The first preview attempt collided with an audit command rebuilding `dist`.
It was rerun without overlapping compiler builds. That interference was not
treated as an exporter defect. Subsequent failures above were independently
reproduced and fixed.

## Remaining work before a public beta

- **Adopt a matching local installation.** The user's existing Blender profile
  reports add-on 0.8.0 against compiler 0.9.0. This audit tested an isolated
  profile. After adopting the changes, install the matching add-on with the
  command in the first-scene guide and restart Blender. That shared installation
  was left for adoption so concurrent work would not switch compiler versions.
- **Run an artist pilot on actual work.** Ask a few artists to use the guide on
  their own saved scenes. Record material refusals, time to first Ready, fidelity
  expectations and understandable remedies. Include an animated character and
  a stylized scene; the small fixtures do not settle those workflows.
- **Keep the compatibility boundary explicit.** Existing sites must use exact
  Three 0.184.0; R3F requires React 19 and Fiber 9. TSL materials require the
  WebGPU renderer family. Broadening these ranges needs evidence, not a relaxed
  package constraint.
- **Measure the shipped site.** Vite reports large chunks even for these small
  scenes. Measure initial transfer, startup, memory and frame time on actual
  mobile hardware. Meshopt increased the tiny fixture's GLB size, as correctly
  reported. Camera framing and lighting need a deliberate website review.
- **Retain fresh release evidence.** Run the complete release suite and the
  supported Blender/OS/browser matrix against the exact candidate archive and
  extension ZIP. This audit did not run the entire headless suite, full codec
  matrix, hosted workflows, or a production CDN/browser gate. Existing offline
  consumer builds still borrow dependencies; the new packed import contract
  catches declaration gaps but does not replace independent npm installs.
- **Review distribution readiness separately.** Follow `RELEASE.md` for package
  ownership, trusted publishing, provenance, retained artifact identity,
  license notices and the existing Sharp/libvips workaround. Remote status was
  not rechecked here. Making the repository public, package publication,
  deployment and marketplace submission require separate approval.

Start with [your first scene on a website](FIRST_SCENE.md). Keep the pilot
focused on getting authored scenes into ordinary sites before adding more
features.

## Preview refinement follow-up

The next pass prioritized a stylized environment. Preview Studio now opens its
loading screen before the initial compile finishes. Browser load failures offer
a retry without another export, including when another tab already validated
the generation. The viewer shows initial errors directly and clears them after
recovery. Runtime failures now reach the CLI through the acknowledgement watcher;
a later save recreates a broken renderer even when compiled output is unchanged.
Status publication also retries brief Windows replacement locks while preserving
the previous complete JSON snapshot.

Verification on this Windows/Blender 5.2 setup:

- `npm run build` and `npm run test:unit` passed: 92 test files, 791 tests passed,
  two codec tests skipped, and 19 release-policy checks passed.
- Real browser checks covered blocked GLB downloads, retry after repeated failure,
  retaining an older scene during an unsuccessful update, per-tab recovery,
  graphics-context loss, and recovery on a save with unchanged compiled output.
- An intentionally invalid first `.blend` displayed Blender's error in the open
  viewer. Replacing it with a valid saved scene reached Ready without restarting.
- The new `scripts/make-preview-diorama.py` produces a self-contained woodland
  scene with 580 triangles and a 512px Appearance atlas. Its current Preview GLB
  is approximately 92kB. It rendered with authored colors at desktop and phone
  widths. Phone framing crops the island edges; responsive composition remains
  an artist decision. This static fixture does not cover animation or TSL.
- Logs, the generated `.blend`, and screenshots remain locally under
  `artifacts/verification-polish/`. `woodland-desktop.png` and
  `woodland-mobile.png` record the visual check.

The existing `showcases/cube-diorama/scene/cube_diorama.blend` did not finish its
initial compile after more than 20 minutes. Blender remained active; the run was
stopped deliberately. It is neither a successful validation nor a diagnosed
hang. Profiling that scene and surfacing detailed bake progress are still needed
before calling large-environment iteration convenient. The authored showcase
file was not edited.

## Compile performance and progress follow-up

The cube diorama's saved Preview recipe uses two samples, a 1024px atlas,
1x supersampling and no denoise. Final uses 16 samples and denoise. A real
Blender 5.2 probe selected the NVIDIA RTX 5080 through OptiX and set Cycles to
GPU. These settings were retained; excessive samples and CPU Cycles were not
the cause of the observed preparation delay on this machine.

Stack samples from the original exporter placed the wait in UV packing,
triangle validation, texel coverage and gutter checks. The export prepared
the geometry once for its plan and then again for its bake. The baseline
was stopped after more than 14 minutes, during the second preparation and
before Cycles baking. This is a lower bound, not a completed compile time.

The exporter now shares one validated layout within the existing material
transaction. Standalone plans still prepare their own layout. UV normalization,
placement and rollback use bulk Blender transfers. A 12,000-loop check measured
0.015–0.020 seconds for scalar transforms versus 0.00048–0.00052 seconds for
bulk transforms on Blender 5.2, with byte-identical float32 UVs and unchanged
pins. This 30–40x improvement applies to those transfers, not the full compile.
The same coordinate contract passed on Blender 5.1.

Preview Studio receives progress even when console progress is disabled. It
shows object/stage labels, total and stage elapsed time, and the actual selected
Cycles backend and sample count. Heartbeats keep the last stage visible without
resetting its clock. The bar represents compiler stages rather than an ETA.
Real browser checks observed both CPU preparation and OptiX GPU / two-sample
metadata from the large scene. Local logs and screenshots are retained under
`artifacts/verification-performance/`.

The real-export regression failed before the change with two preparation calls
and passed afterward with one, a valid plan and a GLB. Bake ladder, evaluated
geometry, saved bake output, GPU preference restoration and the full baked
end-to-end script passed. That script covers baked materials, lighting states,
incremental reuse and output contracts. The full headless Blender/release matrix
has not been rerun for this pass.

The final unit run passed 794 tests across 93 files with two codec skips when
limited to two workers; all 19 release-policy checks passed. An unrestricted
parallel run during the large compile hit three five-second test timeouts. The
bounded rerun retained the same assertions and timeout settings.

The optimized large-scene compile completed in **821.6 seconds (13m 42s)**,
exporting 2,314,974 triangles and an approximately 11 MB GLB. The browser reached
Ready and reported no errors. Preparation/plan occupied roughly 8.5 minutes;
dependency hashing occupied roughly three more minutes before the GPU atlas
bake. Because the baseline was stopped, no exact end-to-end speedup ratio is
claimed. Expensive UV coverage/gutter proofs and dependency hashing remain
priorities for the next performance pass.

The two-sample render in `diorama-ready.png` is visibly noisy and dark. Browser
Ready proves loading and rendering, not visual equivalence or acceptable final
quality. The source also reports missing historical file references, approximate
Filmic/World handling, and material/light limitations. This run neither changed
those settings nor repaired the source artwork.

A later browser run exposed an `EPERM` progress-file replacement lock beyond
the existing bounded retry. Progress publication now retains the last complete
snapshot and lets the next stage/heartbeat try again, instead of throwing from
Blender's stdout callback and terminating Preview. A regression holds the lock
through all retries and verifies recovery on the next heartbeat. Build outcome
publication retains its existing error behavior. The rebuilt woodland viewer
reached Ready without browser errors, reusing its valid bake in a 3.6-second
compile check.

## Bulk hashing and UV validation follow-up

The next pass replaces per-element RNA inspection of numeric mesh attributes
with bulk reads. It inspects each attribute's exposed scalar-property schema
once, frames the field names/types/widths and element count, and hashes numeric
columns using explicit little-endian encoding. Float64 buffers retain the RNA
values, including computed color fields. String attributes and unsupported bulk
reads keep the conservative scalar path. The compiler's existing pipeline
signature invalidates bakes made with the earlier hash encoding.

A real 12,000-vertex attribute fixture fell from 1.097 seconds and 200,000 scalar
property inspections to 0.036 seconds and zero scalar inspections. Edits to
floats, integers, booleans, vectors, both color types, quaternions, matrices and
strings all invalidated the hash. Restoring numeric values restored the hash;
an intentionally unsupported bulk reader still detected edits through fallback.

Direct old/new hashing of the unchanged diorama's evaluated meshes took
**116.21 seconds versus 3.87 seconds**, about 30x faster for this operation.
The Floor accounted for 101.21 seconds of the old result and has 4,194,304
evaluated face corners. This comparison excludes mesh evaluation, materials,
packing, baking and export; it is not a whole-compile speedup.

UV island analysis now snapshots loop vertices, coordinates, edge references
and seam flags with bulk reads. A connected 2,500-quad fixture fell from 0.089
to 0.031 seconds, eliminating 90,000 individual RNA reads. Direct comparisons
on evaluated Curtains, Potted Plant - Bracken and Wooden_Chair retained exactly
the same island roots, display numbering and welded components. Those checks
took 1.58/0.70, 0.61/0.29 and 0.081/0.049 seconds respectively. Regression cases
also distinguish seam-aware tolerance from exact UV welding. Numeric hashing
and island checks passed on Blender 5.1 and 5.2.

Gutter validation now sweeps nearby chart bounds before applying the existing
Euclidean distance and epsilon test. Randomized, overlapping, degenerate and
threshold-boundary cases match an exhaustive search. A grid of 1,600 separated
charts produces zero candidate pairs instead of 1,279,200 distance tests.
Crowded overlapping layouts can still require quadratic work. With several
violations, the first reported pair may change with spatial traversal; the
gutter requirement and rejection decision are unchanged.

The build, 794 unit tests (two codec skips), 19 release-policy checks, focused
bake-ladder/evaluated-geometry/preparation checks, and baked end-to-end suite
passed. The latter verifies reuse of unchanged jobs and invalidation after real
edits. Logs and direct comparisons remain in `artifacts/verification-performance/`.

The forced diorama compile completed in **398.1 seconds (6m 38s)**, versus
821.6 seconds in the preceding pass, about 52% less elapsed time in these local
runs. It rebuilt its atlas (`reused 0/1; rebuilt 1`), exported the same 2,314,974
triangles, and reached browser-verified Ready without browser errors. OptiX,
two samples, atlas resolution and authored geometry settings were unchanged.
`second-diorama-ready.png` records the render, and `second-diorama-stages.json`
records stage transitions. Preparation/plan now occupies roughly 5.5 minutes;
the observed dependency-hashing stage takes roughly six seconds. These runs
do not control every OS/driver cache or background load, so the paired mesh
benchmark remains the narrower evidence for hashing's gain.

The remaining preparation cost is concentrated in the Floor and repeated UV
coverage/packing checks. The Floor starts with 4,096 quads and uses a Simple
Subdivision modifier at four viewport levels (five render levels). Caching
validated layouts across eligible saves is the next quality-preserving step;
an explicit Preview subdivision limit could reduce this workload further when
the artist accepts a geometry tradeoff. Neither feature is implemented in this
pass, and the source `.blend` was not edited.

## Persistent atlas preparation and quality checks

The compiler now retains successful atlas preparation under the project's
private `.blendlink-cache/preparation` directory, with one entry per source
path and Preview/Final profile. Runtime assets do not carry the cache path or
contents. Exact staged evaluated meshes, transforms, UVs, pins, layer order,
camera positions, weights, atlas declaration order, layout settings, Blender
build and Python pipeline sources determine reuse. Sampling, denoising and
lighting-state settings remain bake dependencies but do not change this layout
key. A hit restores packed coordinates, pin/selection attributes and layout
metadata before the normal plan and bake path continues.

The cache uses compressed float32 coordinates and a checksummed payload,
bounded decompression, complete preflight and atomic replacement. Invalid or
incompatible files rebuild normally; unsuccessful layouts never replace a
validated entry. Injected Blender write failures restore the original staged
mesh data before propagating the error. The UI reports when it reuses validated
atlas preparation.

Testing found two invalidations that coordinate-only checks missed. UV packing
changes optional Boolean selection/pin attributes, so restoration must preserve
their values and presence. Blender's temporary datablock `session_uid` also
changes when a file is reopened. Bake fingerprints now exclude that process
identity while continuing to hash the datablock's render inputs.

The generated woodland scene (580 triangles, 512px atlas, 16 samples, denoising)
took **16.9 seconds cold and 2.5 seconds on a forced unchanged compile** with the
final build. The latter explicitly reused preparation and its one atlas bake.
A saved light-energy edit also reused preparation and rebuilt its atlas. That
run took 22.5 seconds while other verification work was active; it demonstrates
correct invalidation, not a measured lighting-edit speedup. These are single
runs with uncontrolled background load and driver caches.

The large diorama remains a limiting case. A private copy took **310.5 seconds**
for a cold two-sample compile, retaining 2,314,974 triangles. A subsequent fresh
Blender process missed the preparation cache. Two isolated input probes found
different evaluated UV bytes on 17 meshes, including Bevel-affected furniture
and beams; their reported changed attributes were source UVs and the staged
atlas layer. Blendlink retains exact matching and falls back to preparation.
No cache speedup is claimed for this file. The earlier 398.1-second run is not
a controlled comparison against this cold run.

On the private copy, increasing Preview from two samples without denoising to
16 samples with denoising produced a substantially cleaner wall, floor and
furniture render. That compile took **394.9 seconds**, used OptiX at 1024px,
retained 2,314,974 triangles and reached browser-verified Ready without browser
errors. `diorama-16-samples-denoised.png` and `diorama-16-status.json` retain the
result; `second-diorama-ready.png` retains the earlier two-sample view. The
timings include a fresh layout and differ in background load, so their
difference is not an isolated cost measurement for sampling or denoising.
The scene's existing material, World and display-transform limitations remain.
Its original source file was not edited.

The cache regression performs real exports on Blender 5.1 and 5.2. It checks
unchanged bake identity, new identities after material/light/quality edits,
geometry/UV/camera/padding/supersample invalidation, pinned layouts, atlas order,
corrupt payloads, rollback and refusal to cache failed layouts. The build,
794 unit tests with two codec skips, 19 release-policy checks and the baked
end-to-end suite passed. The full headless/release matrix was not repeated.
Logs and input probes remain under `artifacts/verification-performance/`.
