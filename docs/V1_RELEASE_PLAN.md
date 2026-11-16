# SceneToWeb 1.0 release plan

SceneToWeb 1.0 should let an artist install a Blender extension, preview a saved
scene, make changes, and export a faithful, efficient website. A developer should
be able to install the same result in an existing Three.js or React Three Fiber
site without rebuilding the scene's materials. The compiler and runtime remain
free for commercial use under their documented file-level licenses, with no
account, watermark or required hosting service.

This plan uses source checkpoint `dfb1ef2a53757b547455142fdddedae77d831dc3`,
reviewed November 15, 2026. It defines release work and acceptance targets;
existing tests do not establish that these targets have already passed.

[Release scene progress](RELEASE_SCENE_PROGRESS.md) records the selected first
scene, actual compiler blockers and current implementation work. Its source-owned
corpus and node backlog drive port priority; the remaining catalog follows later.

## The 1.0 promise

The primary audience is Blender artists working with Three.js developers,
freelancers and small agencies. The initial complete workflows are product
showcases, portfolios and small interactive presentations.

1. Install the matching extension ZIP without a terminal or global Node/npm.
   First-run downloads explain their purpose, respect online-access settings,
   report progress and can be retried. Cached tools work offline.
2. Open a saved scene, choose Set Up SceneToWeb Scene, and reach a useful browser
   preview. Readiness explains any changes needed before export.
3. Save a material, camera, transform or qualified transform/skin/morph animation
   edit and see the
   updated scene. Failed updates keep the last good scene; retry and cancellation
   never leave a half-installed scene or corrupt the source.
4. Preserve the authored look through qualified live translation, deliberate
   material/lighting baking, or explicit appearance capture. Each fallback states
   what remains editable, animated, relightable and view-dependent. Unsupported
   behavior has a concrete remedy before a misleading result is published.
5. Export a standalone website folder that works on ordinary static hosting,
   including a subfolder, with all companion assets included.
6. Integrate the exported scene through documented Three/R3F loading, update,
   error and disposal paths. Node-capable rendering is the default example for
   translated materials. Portable glTF-only rendering is an explicit choice.

EEVEE is the reference for live shading where applicable. Cycles generally uses
baking. Complete node coverage continues after 1.0; release does not require every
node, every parameter range, arbitrary graph combinations or exact renderer
identity. Arbitrary animated shader/compositor parameters remain refused unless
deliberately qualified for a release scene. A supported scene must still satisfy
its declared complete workflow.

Multiplayer, XR, a visual scripting editor, managed hosting, arbitrary OSL,
unrestricted volumes/hair/path tracing and blanket Needle feature parity are
outside 1.0. Optional components stay Preview unless they independently pass the
acceptance criteria in [Component acceptance](COMPONENT_ACCEPTANCE.md).

## Existing foundations and release gaps

| Area | Existing foundation | Work required for 1.0 |
| --- | --- | --- |
| Install and preview | Private verified tools, save refresh, last-good recovery, orbit/portrait/capture/compare | Recheck exact candidate from clean profiles; remove confusing states and stale instructions |
| Scene compilation | Live node programs, Hybrid/bake routes, guarded assets and runtime ownership | Prove whole scenes across the selected versions/devices; prioritize failures that prevent promised workflows |
| Coverage | 5.3 has 46 supported, 142 partial, 130 unsupported and 14 structural entries | Track modes and scene success; never present partial scope or research as complete support |
| Developer integration | Packed Three/R3F consumers and public installers | Make node-capable examples copy-paste defaults; test real existing-site update/unmount/retry paths |
| Release assembly | Exact npm tarball/extension ZIP, fingerprints, licenses and checksums | Complete stable release mode, current compatibility matrix and external distribution setup |
| Evidence | Numerous bounded native/browser proofs and historical hosted passes | Bind the complete candidate to current receipts; historical/software browser passes do not certify every physical device |

The first implementation batch completed these source fixes and local checks;
the remaining original-scene and distribution gates stay in force:

- A complete, independently pinned Blender 5.3/exporter 5.3.43 local lane passed
  on macOS arm64. Its four unqualified stock-material shortcuts stay disabled
  and separately accounted for; 4.2/5.2 history remains intact.
- Stable-versus-prerelease policy is implemented and locally tested in both
  retained-release verification and workflow source. No tag, hosted workflow or
  publication was executed.
- [First scene](FIRST_SCENE.md), the committed examples and existing-site setup
  now default to the WebGPURenderer family. Packed consumers and the actual
  guide snippets pass.
- [Release process](RELEASE.md) now agrees with private-tool bootstrap.
  Marketplace review, clean installation on the other desktop platforms and
  exact public-download verification remain pending.

The selected original Archviz scene still refuses Plaster. Glass has a qualified
bounded terminal white-shadow/owned-Alpha route; full-scene acceptance is pending.
Structured plan diagnostics retain the remaining compiler errors. Horizontal Lens Distortion earned only
its independently qualified bounded partial scope; the original Classroom graph
is not accepted. Current evidence and next dependencies are recorded in
[release scene progress](RELEASE_SCENE_PROGRESS.md).

## Compatibility to establish

Blender 5.3 is the primary authoring and new-port target. Blender 4.2 and 5.2
retain versioned compatibility tests and their documented limits. Do not turn a
successful 5.3 node proof into a claim that the complete material suite passes.

The candidate matrix targets Windows x64, Linux x64 and macOS arm64. Milestone 0
freezes the required OS/Blender/browser/device cells and positive/refusal routes;
this does not require every possible Cartesian combination. Each claimed
desktop platform needs clean extension installation, private-tool bootstrap,
preview, edit/update, Final export and installed-consumer evidence. Native
arithmetic/GPU profiles remain scoped to the exact verified builds and hosts;
an unqualified profile must select a qualified route or explain the limitation.

Keep the existing Node 22.15+/24 and exact Three r184 contracts until separately
audited changes justify widening them. Test Chromium, Firefox and actual Safari
on supported hardware; use WebGPU where qualified and node-capable WebGL2 where
required. Verify at least one physical iOS Safari device and one Android Chrome
device for the promised exported scenes. Viewport emulation is supplementary.
Any missing platform evidence must narrow the public claim or hold that gate.

## Complete scene acceptance

Freeze a small release corpus before expanding ports. Start with eight positive
scenes and four expected-refusal/recovery scenes. At least three positive scenes
should come from licensed official Blender demo sources; hash-pin downloads and
record attribution, source version, original file and any separate derivatives.

| Positive scene | Required behavior |
| --- | --- |
| First scene | Fresh install, setup, preview, save update and standalone export |
| Product showcase | Image/PBR materials, glass within declared limits, lights, environment and framing |
| Procedural look | Common Noise/Voronoi/ramp/mapping combinations, supported normal/bump behavior and live edits |
| Stylized composition | Declared compositor effects, alpha, camera and color-management contract |
| Cycles presentation | Deliberate appearance or lighting/material bake, stated camera/lighting limitations |
| Animated asset | Core transform animation plus a skin or morph fixture, correct time and cleanup |
| Small environment | Instances, textures, budget diagnostics and a deliberate optimization/bake path |
| Existing website | One identified shared golden scene in independent Three and R3F projects; exact packed package, load/update/retry/unmount |

The four refusal cases cover unsupported behavior, an exceeded resource budget,
missing/corrupt companions and incompatible tool/runtime versions. Each must
identify the cause and remedy, preserve the source and last good output, and
recover after correction.

An original official demo that refuses is a negative control, not a positive
scene pass. Cube Diorama, Mandelbrot and Radial Tiling retain their original
failures until resolved. A reduced or modified derivative has its own result.
Acquire additional suitable official scenes if the originals remain outside the
bounded 1.0 scope; include both a live and a bake workflow among official passes.

Run clean-profile first installation per required desktop cell against the exact
candidate artifacts. Other positive scenes can reuse that installation with its
identity recorded; they need not repeat bootstrap for every scene. For every
positive scene retain:

- Exact source/tool/package identities, artist actions and fallback decisions.
- Native reference and installed-browser captures at fixed cameras/extents;
  independently declared linear/display/alpha tolerances and a visual review.
  Set numerical gates before candidate comparisons and retain failures.
- The installation receipt and first preview, saved edit, Final export and
  browser loading durations, with download, bake and shader preparation reported
  separately.
- Bytes transferred, draw calls, render passes, textures/targets, frame-time
  distribution and owned resources after repeated replacement/disposal.
- Preview and Final differences explained; final acceptance uses the actual
  exported artifact and public installer, not an experiment-only renderer.

## Performance and usability targets

These initial targets apply to deliberately small/medium fixtures. Milestone 0
must name the exact devices, asset sizes, network profile, sample procedure and
per-scene budgets, then freeze them before implementation comparisons. Larger
scenes receive explicit budgets rather than inheriting these numbers.

| Measurement | Initial target to calibrate and freeze |
| --- | --- |
| First useful preview | Within 5 minutes for the first-scene fixture, including setup on the declared network |
| Cached preview startup | Within 10 seconds for the first-scene fixture |
| Saved small live edit | p95 within 3 seconds from save to visible committed frame; full bakes measured separately |
| Exported initial load | Within 5 seconds at 20 Mbps / 50 ms latency for a small showcase of at most 10 MiB initial transfer |
| Interactive frame time | p95 at most 16.7 ms on the named desktop and 33.3 ms on the named midrange phone after warm-up |
| Repeated lifecycle | 50 update/replace/unmount cycles without stale scenes or monotonically retained owned resources |
| Preview usability | Progress, cancellation, retry, keyboard controls and readable errors at desktop and portrait sizes |
| UI responsiveness | Visible work state within 250 ms; cancel acknowledged within 1 second and work stops at a safe checkpoint |
| Interrupted setup | Interrupted download/cancel leaves no executable partial tools; retry succeeds and cached offline reuse needs no download |

No silent resolution/detail reduction may satisfy a fidelity or performance
gate. A budget change needs a recorded reason and revised scope, never a hidden
tolerance adjustment. Fresh-process compile wall time, GPU execution time and
engineering time remain separate measurements.

## Milestones and exit criteria

Effort ranges are provisional active engineering weeks, not elapsed-time
promises. Independent work overlaps; external access, hardware, user evaluation
and publication can extend the calendar. Budget roughly 12–20 active weeks for
this bounded 1.0, with low confidence until Milestone 0 measures throughput.
This is narrower than completing every node.

| Milestone | Estimated effort | Exit criterion |
| --- | --- | --- |
| 0. Freeze scope and baseline | 1–2 weeks | Eight positive/four negative scenes selected; compatibility cells, budgets, API inventory and ranked blockers recorded; registry/bootstrap/OIDC dependencies identified; actual engineering throughput measured |
| 1. Smooth first scene | 2–3 weeks | Exact installed ZIP passes clean-profile setup, preview, save/error/retry/cancel and website-folder paths; node-capable Three/R3F examples work outside the repo |
| 2. Make the promised scenes faithful | 4–8 weeks | All eight positives pass native-versus-installed review; four negative cases refuse and recover correctly; necessary node/fallback gaps close |
| 3. Performance and compatibility | 2–4 weeks | Frozen budgets and declared desktop/browser/physical-phone matrix pass; complete 5.3 lane and legacy regressions run |
| 4. Internal release candidate | 2–3 weeks | Stable release policy, docs/API/support policy and exact-artifact installation/upgrade rehearsals pass; no unresolved release-blocking defects |
| 5. Validation and public distribution | 2–4 weeks plus external waits | Chosen user-validation stage completed, release infrastructure ready, approved retained artifacts distributed and downloaded bytes verified |

Milestone 1 can proceed alongside scene qualification using exact local archives.
Identify package-name ownership, initial registry bootstrap feasibility and OIDC
binding requirements in Milestone 0. A protected prerelease bootstrap, if required,
precedes public first-run compiler download; its actual registry writes wait for
the authorized distribution stage. After two
measured batches, replace the initial timeline with a forecast based on whole
scene blockers and engineering time, not the number of node classes.

## Work allocation and porting discipline

Use three independent lanes: install/preview/integration; scene fidelity and
targeted ports; performance/packaging/compatibility. Each owns separate files or
an isolated worktree. One integrator controls the candidate and shared GPU jobs.

Allocate about half the effort to complete scene workflows, one quarter to
scene-blocking ports/fallbacks and the rest to performance and distribution.
Research without a named release blocker stays timeboxed. After two engineering
days without a passing vertical slice, review the obstruction and choose a
shared primitive, qualified bake route or explicit scope change.

Prioritize ports by how many promised scenes they unblock, expected frequency,
shared implementation value, fidelity risk and measured runtime cost. Do not
score progress by source-node count alone. Preserve exact source-ID coverage,
dependency-aware regeneration, independent numeric readers and refusal controls.
Retain the faster qualified TSL implementation unless an imported kernel proves
both correctness and acceptable cost. Research and native creation earn no
support credit.

Run fast affected checks per change; run combined checks at integration
boundaries and exact-artifact checks for candidates. Keep spreadsheet maintenance
weekly or for meaningful batches. Track weekly scene passes, blocking defects,
port engineering lead time, first-pass qualification rate and budget regressions.

## User evaluation and release decision

Continue internal testing and official-scene dogfood now. No real-user outreach,
messages, account changes, hosted workflows or public release is part of this
planning task.

After the internal candidate is ready and the owner chooses to involve users,
run a small usability pilot: three to five artists/developers use their own
scenes, install without coaching, publish a result, and return after making an
edit. Record task completion, help needed, unexpected look changes and whether
they use it again. This stage establishes usability and demand; synthetic scene
passes do not establish either. If release precedes that evaluation, state the
missing validation explicitly rather than claiming product-market fit.

The technical release checklist requires:

- Zero open P0/P1 defects: source/output corruption, install/export failure in
  the promised path, silent visual loss, incompatible-version acceptance or
  release security/provenance failures. Lower-severity issues have a documented
  workaround and owner decision.
- Stable public API inventory covering CLI/config, package exports, generated
  bindings, manifests, Blender properties and lifecycle/error behavior, plus
  1.x migration, deprecation, patch and security policies.
- The complete candidate suite in [Release process](RELEASE.md), preview UX,
  current node-family checks, corpus/matrix and independent fresh installation
  all pass on the same reviewed source/artifacts. No required tool/platform skip
  is a pass. Evidence predating an affected change is not candidate evidence.
- Synchronized 1.0 versions, licenses, changelog, limitations, examples, help and
  issue-report instructions. No unresolved source-map/coverage validation drift.
- Exact retained npm tarball and extension ZIP, manifest and checksums; clean
  source identity; install/upgrade/uninstall rehearsal with prior assets intact.
- Stable/prerelease policy tests, registry ownership/trust, protected release
  infrastructure, immutable assets and downloaded-byte/provenance verification.
  Existing required hosted checks remain pending while workflows are paused;
  restore them or approve and document an equivalent policy before release.
- Real deployment of the release fixture under a subfolder and a separate asset
  origin where promised; test asset completeness, CORS/CSP, cache/update behavior
  and old URL retention. Hosting remains application-owned.

First distribute through npm and a matching downloadable extension ZIP when
authorized. Marketplace submission/approval is a separate channel, not a reason
to label an unapproved listing available. Rehearse a broken-release response
using a new patch/deprecation and clear instructions; never overwrite immutable
published bytes.

## Immediate next batch

1. Build the corpus/compatibility scorecard from existing evidence, preserving
   historical failures. Select official positive candidates and freeze the
   first-scene measurement procedure.
2. Correct and verify the node-capable R3F/Three happy path against the packed
   package, including an unsupported-renderer diagnostic.
3. Add a complete pinned Blender 5.3 candidate lane alongside the existing 5.2
   suite; keep native GPU profile claims separate.
4. Implement/test stable publication policy without publishing or dispatching
   hosted workflows. Reconcile the prerequisite documentation.
5. Run the first whole-scene baseline and select the next ports from measured
   blockers. Publish a revised effort forecast after two batches.
