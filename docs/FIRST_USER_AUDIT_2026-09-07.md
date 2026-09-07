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
