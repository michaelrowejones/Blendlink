# Project setup contract

`blendlink connect [site-dir] --blend <saved.blend>` is the artist-facing
website attachment flow. It has two deliberate routes and never silently
switches between them. `blendlink setup` remains a compatibility alias for
existing scripts.

Website attachment is not required for an artist's first browser preview.
`blendlink preview --blend <saved.blend>` creates or reuses a disposable
Preview Studio in a private user-local cache keyed by the absolute `.blend`
path. It scaffolds a minimal Vite/Three/Blendlink viewer, installs only that
cache's dependencies when missing or stale, compiles the scene's Preview
profile, verifies the serving process with a session marker, and opens the
reported loopback URL. `--no-open` performs the same work without launching a
browser. The command stays alive after the first successful compile and watches
the saved `.blend` plus its declared inputs. Each save enters the same
single-flight Preview compiler path and lets Vite refresh the published result.
This is save-driven iteration, not unsaved Blender depsgraph synchronization.
When a later export fails, the error remains loud but the prior published files
and last good browser scene stay available. The cache never becomes a
production project and no file is created beside the artist's `.blend`.

Once a real site is connected, ordinary `blendlink preview` preserves the site
workflow: compile Preview quality, start its configured/discovered dev command,
trust the URL that process reports, and reuse a reachable URL only when the site
declares ownership explicitly. It also remains active as the same save watcher,
including when the site declares an already-running URL; stopping Preview ends
the watcher and any server process Blendlink owns.

## Existing Three.js or React Three Fiber site

When `package.json` declares `three` or `@react-three/fiber`, connect:

1. uses the exact saved `.blend` supplied with `--blend`, otherwise discovers
   nearby `.blend` files (or supplies the inspectable sample when none exists);
2. creates `blendlink.config.mjs` unless the repository already owns one;
3. creates the standard generated/output directories;
4. declares the current Blendlink version when the package has not already
   chosen one;
5. adds `blendlink:connect`, `blendlink:preview`, `blendlink:publish`, and
   `blendlink:check` scripts only where those names are free;
6. makes the website explicitly own exact `three@0.184.0` plus a matching
   r184 `@types/three` patch instead of allowing Blendlink to install a private
   runtime or type universe.

It does not install dependencies, edit an application component, create a
second canvas, or overwrite a script/config choice. A conflicting script is
preserved and printed. A package without a declared Three renderer is rejected
with a path-to-fix instead of receiving a guessed integration.
R3F attachment also validates the supported React 19 / React Three Fiber 9
pair before writing anything, so an incompatible renderer fails at the
connection boundary rather than during a later install or site build.

Existing `genDir` and `outDir` choices are followed exactly. In an ordinary
Three.js project, connect creates one user-owned `install<Scene>({ renderer,
scene })` module per configured scene. In an R3F project it creates a tiny
association component for each scene; Blendlink's package-owned adapter keeps
loader setup, late-load disposal, camera handoff, resize, frame updates, conditional
post-processing ownership, errors, and cleanup out of generated application
code. Both calculate imports from the real generated-module path; neither
silently chooses one scene or assumes `src/generated`. Connect prints the exact
call or element to add while leaving
application source under the website owner's control. R3F integrations declare
their own `use client` boundary, so they are also safe entry points from a
Next.js App Router Server Component. If two otherwise-valid scene names would
collapse to the same integration filename (for example `hero` and
`heroScene`), connect rejects the ambiguity before writing either integration.
The printed action connects that integration before Preview: a Vanilla site
passes its Three `WebGLRenderer`, while R3F mounts the component inside a WebGL
Canvas. This requirement applies to previewing inside that connected site, not
to the private Preview Studio. The standard installer deliberately rejects
`WebGPURenderer`; WebGPU sites keep the portable assets but own their renderer
adapter.

## Empty directory

Without `package.json`, connect creates a minimal, ordinary Three.js + Vite site.
The starter calls the same user-owned `src/blendlink/<Scene>Scene.ts`
integration used when attaching an existing Vanilla site. That integration
imports the scene's actual configured generated-module path, including a custom
`genDir`, then installs it through `blendlink/three`. This single seam makes a
second connect run idempotent and applies the user-owned baked composition plus
the authored look, fog, shadows, environment, camera, playback, LODs, and
reflection probes with lifecycle cleanup. A framed perspective camera is
created only when the artist did not designate one. Portable Components use
the same installed `update` / `render` / `resize` / `dispose` lifecycle;
post-processing effects therefore participate in both preview and final site
rendering. Existing scaffold files are blockers, never overwrite targets.

For an existing React Three Fiber site, connect still never edits an application
component. It creates user-owned `src/blendlink/<Scene>Scene.ts` integrations
instead and prints the exact element for each configured scene to add inside an
existing Canvas. A name already ending in `Scene` is not doubled into
`SceneScene`. Each component restores the prior R3F camera and every owned scene
setting when it unmounts. Its typed `onReady` prop exposes an advanced borrowed
installed handle for integration code such as `setStateAsync`, `setLightGroup`, and
the renderer-neutral `animation` transport. Application UI can read
`availableClips` and immutable `state`, subscribe, then call `play`,
deterministic `playAll`, `pause`, authored-seconds `seek`, or replayable `stop`;
Blendlink retains mixer, frame-loop, and terminal-disposal ownership. Changing
an inline callback does not reinstall the scene; the callback runs once for each
successful installation and the component retains disposal ownership.
`onLoadStateChange` separately reports attempt-scoped Loading,
Preparing, Ready, and Failed facts so the website can own its loading UI and
reset its Error Boundary with `retryKey`. `recoverable` is conservative:
generic installation errors are `false` until a structured cause proves a
retry-safe path; explicitly handled context loss is `true`. Installation and
render-time failures publish Failed and are rethrown for the nearest React Error
Boundary. Status, presentation, and ready callbacks are best-effort observers;
their exceptions are logged without replacing the scene. The
separate `onPresentationStateChange` callback reports renderer Loading,
Bootstrap, Full, or Failed quality plus the first completed-frame observation.
That observation is not a pixel-fidelity, GPU-fence, or display-compositor
claim; production smoke should assert Canvas geometry and pixels separately.
`useCompiledScenePresentation()` from `blendlink/react` merges both streams with
the installed scene, accessible controls, Web Audio readiness, post-processing,
and frame policy without prescribing the website's UI. Its stable `sceneProps`
contains `retryKey` and both callbacks. `retry()` synchronously revokes the old
binding before resetting to Idle and advancing the key, so a late first attempt
cannot repopulate the second attempt. The website deliberately chooses whether
that key remounts the scene only or its Error Boundary and Canvas. Its underlying
framework-neutral store is exported from `blendlink/scene-presentation`.
The generated integration also exports `use<Scene>Scene`. Application behavior
mounted as a child of `<Scene>` can use that hook to read the fully installed
root, camera, and rename-stable generated node map. State preparation and
light-group texture preparation are asynchronous; already prepared light-group
strength/tint changes are synchronous so an application animation loop does
not create promises every frame. `hasPostprocessing` lets an application-owned
composer refuse a competing authored render owner. `addCleanup()` gives advanced site adapters a
way to restore composed material hooks before Blendlink disposes the generated
materials. Children do not mount during Loading or
Preparing, and the view deliberately exposes no `dispose`: Blendlink retains
resource ownership. This is the preferred seam for camera choreography,
site-specific interaction, and other imperative R3F behavior that must never
observe a partially configured scene. The callback remains available for
integration code that cannot be nested, but the component still owns that
borrowed handle's disposal.

```tsx
import { useCompiledScenePresentation } from 'blendlink/react'

function HeroExperience() {
  const presentation = useCompiledScenePresentation()
  return (
    <>
      <SiteSceneErrorBoundary key={presentation.retryKey}>
        <Canvas>
          <HeroScene {...presentation.sceneProps}>
            <HeroBehavior />
          </HeroScene>
        </Canvas>
      </SiteSceneErrorBoundary>
      {presentation.phase === 'failed' ? (
        <button type="button" onClick={presentation.retry}>Retry scene</button>
      ) : null}
      {presentation.presentation?.audio.state === 'blocked' ? (
        <button onClick={() => { void presentation.scene?.components.audio.resume() }}>
          Enable sound
        </button>
      ) : null}
    </>
  )
}

function HeroBehavior() {
  const scene = useHeroScene()
  useEffect(() => {
    const dispose = installSiteBehavior(scene.nodes)
    const unregister = scene.addCleanup(dispose)
    return () => { unregister(); dispose() }
  }, [scene])
  useFrame(() => scene.setLightGroup('Key Light', { strength: keyStrength() }))
  return null
}
```

Render `presentation.accessibleControls` as application-owned native links or
buttons. Their `activate()` callbacks share Blendlink's authored behavior, while
the site retains navigation, focus visuals, analytics, and modified-link-click
policy. Call audio `resume()` directly from the trusted DOM gesture; observing a
blocked state does not grant user activation.

The ordinary Three.js module exposes the complete
installer options, so an application can supply an existing loader or other
deliberate overrides without discarding the generated one-call path. The
package-owned manager refuses Ready when any glTF companion reports an error,
even though Three r184 may recover from a missing image with a null texture.
Application-owned loaders keep their own callback and dependency-failure
policy; Blendlink does not overwrite their manager hooks.
One compiled scene owns a Canvas at a time because camera, environment, look,
and composer are Canvas-global; a competing mount fails with that explanation.
Demand-mode canvases requeue continuous frames only while playback, interactive
controls, Components, or post-processing conservatively require them; Ready,
seek, stop, and semantic commands may still request one-shot frames. A provably
static scene can settle without freezing unknown dynamic behavior. On every R3F
Canvas mode, newly active Blendlink-owned runtime work starts at delta zero and
later update/composer deltas are capped at 100 ms. This matches Needle's
slow-frame bound while leaving the application's R3F clock and explicit
low-level playback updates untouched.
Unmount cancels the private installation attempt, aborting manager-backed
requests where Three/browser support it and discarding non-abortable late work.

Connect declares dependencies but leaves installation to the chosen package
manager. Whenever it adds one, the install action is printed first; hookup is
printed before Preview so the first browser view cannot legitimately contain
no scene. It also prints every filesystem change and the remaining Blender and
commit actions. The older `blendlink init` remains the config-only primitive
for custom automation.

## From Preview to a deployable website

`blendlink publish [scene]` is the deliberate production transaction. It does
not deploy to a Blendlink service or take ownership of hosting. It:

1. compiles the selected scene (or every configured scene) with the Final
   profile;
2. verifies the Final artifacts, recipe version, schema, companions, inputs,
   and hashes;
3. runs the website's existing package-manager `build` script; and
4. verifies the published scene artifacts again after that build; and
5. when `website.browserSmoke.command` is configured, runs that
   application-owned production browser gate.

A selected scene scopes both compilation and verification, so an unrelated
legacy lane cannot block a deliberate publish. A missing build script, failed
build, changed artifact, or recursive `build -> blendlink publish` hook is a
loud failure. Custom deployment pipelines can use `--assets-only`, which skips
only the application build and reports that choice explicitly. Uploading or
deploying the resulting repository remains an intentional, website-owned next
step.

The smoke command receives `BLENDLINK_PUBLISH_BUILD_READY=1`, allowing its
server adapter to start the build that just passed instead of rebuilding it.
This first command seam is optional and intentionally application-owned; a
local production smoke does not prove the eventual CDN, CORS, or deployed
headers.

Application smoke code can import `createBrowserSmokeEvidence` from
`blendlink/browser-smoke`. It classifies application-recorded declared-asset,
console/page, worker-CSP, decoder/CORS, Canvas, WebGL, visible-pixel, and
service-worker facts. It does not start a server, choose a route, create a
browser, or impose a universal pixel threshold. A restrictive CSP fixture that
blocks a Blob worker proves that worker prerequisite only; it is not proof that
an actual required-KTX2 scene failed unless that scene and decoder path were
exercised.

For non-root deployments, the standard Three/R3F installer accepts
`assetBaseUrl` (for example Vite's `import.meta.env.BASE_URL`, a Next base path,
or an absolute CDN root). It rewrites only compiler-owned descriptor and Basis
requests; artist-authored Component media is not relocated. Application-owned
loaders/managers retain their own URL/header/credentials policy and cannot be
combined with `assetBaseUrl` implicitly.

Internal scenes publish beneath a complete graph SHA-256 directory. The
website can opt into immutable caching without copying that digest:

```ts
// next.config.ts
import { compiledSceneImmutableAssetPolicy } from 'blendlink/assets'
import { hero } from './src/generated/hero.gen'

const assets = compiledSceneImmutableAssetPolicy(hero)

export default {
  async headers() {
    return [{
      source: `${assets.urlPrefix}:path*`,
      headers: [{ key: 'Cache-Control', value: assets.cacheControl }],
    }]
  },
}
```

For Vite static output or a CDN, install the same returned prefix/header in the
production host. Do not apply it to the stable compatibility files, all of
`public/models`, HTML, or generated source. Blendlink retains prior graph
directories so old deployments remain addressable; automatic retention cleanup
is not yet provided. If `verify` reports corruption inside one addressed graph,
remove exactly the complete digest directory named in the error and compile
again; Blendlink never overwrites part of an immutable graph. During that
recovery only, intact stable compatibility atlases may act as fingerprint- and
hash-checked incremental bake inputs. They never become the generated URL or
cache authority, and a missing or changed atlas rebuilds only its independent
bake job.

## Blender setup

Website attachment does not mutate artistic source. Open each scene, choose
**Blendlink > Set Up Blendlink Scene**, then review the Main atlas, Preview/Final
profiles, camera, **Website Effects & Behaviors**, and the **Website Ownership**
panel. **Preview Website** uses Preview Studio until a real site is connected.

## Known-issue evidence policy

`packages/blender-addon/blender_known_issues.json` is the product-data registry
for Blender-version warnings. An entry must have:

- a unique lowercase ID;
- a minimum version and optional exclusive upper bound;
- `warning` or `block` severity;
- a concise symptom and concrete artist action;
- at least one HTTPS primary-source URL from Blender's official documentation
  or tracker, or the official Khronos glTF-Blender-IO repository.

Both the addon and `blendlink doctor` validate and consume the registry. A
malformed registry is a loud packaging failure. An empty registry is correct
when no bounded issue has enough evidence; absence of evidence never becomes a
speculative warning.
