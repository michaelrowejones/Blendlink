# Interactivity and progressive delivery: deep-module design

**Date:** 2026-07-21
**Last verified:** 2026-07-23
**Status:** researched, implemented in a bounded first slice, and dogfood-verified
**Scope:** Blendlink's current Three/R3F object interactions, interaction-triggered
resources, semantic controls, audio policy, and application-owned routing.

## Executive decision

Blendlink should deepen its existing component runtime rather than add a second
public behavior framework. The recommended module has one installation entry
point and returns one application-facing handle:

```ts
declare function installSceneInteractivity(
  options: InstallSceneInteractivityOptions,
): Promise<InstalledSceneInteractivity>

interface InstalledSceneInteractivity {
  readonly controls: readonly SceneInteractionControl[]
  prepare(controlIds?: readonly string[], options?: { signal?: AbortSignal }): Promise<void>
  dispatch(event: SceneInteractionEvent): Promise<SceneInteractionResult>
  dispose(): void
}
```

The implementation should be private to the compiled-scene runtime. A generated
R3F binding exposes the ready handle as `scene.interactions`; a Vanilla binding
can expose the same handle. The website receives semantic control descriptions
and typed intents, but it retains ownership of DOM, layout, focus presentation,
routing, analytics, the Canvas, and deployment.

The module must hide:

- validation and target resolution;
- one shared picking/event coordinator per installation;
- resource-key deduplication and ownership leases;
- gesture-gated Web Audio resume;
- preparation, renderer-specific GPU warm-up, and atomic commit ordering;
- animation/audio/hover ownership and frame-activity leases;
- generation checks, rollback, late-result cleanup, and reverse disposal.

This is a deep **Module** because a caller learns four stable operations while
the **Implementation** absorbs many changing browser, Three, R3F, and ownership
rules. Deleting it would force every generated binding and website to rebuild
input arbitration, accessibility metadata, audio policy, preload state,
resource promotion, rollback, and cleanup. That deletion test is strong.

The most important product rule is also the simplest: a raycast is not an
accessible control, and a fetched texture is not a GPU-ready first frame.
Blendlink should represent both distinctions truthfully.

## Method and version of reality

This audit used current primary documentation and the exact installed sources
used by the dogfood site:

- React `19.2.4`
- Next.js `16.2.6`
- Three `0.184.0` / revision 184
- React Three Fiber `9.6.1`
- Drei `10.7.7`

The inspected Blendlink implementation is primarily:

- `packages/blendlink/src/componentRuntime.ts`
- `packages/blendlink/src/threeComponents.ts`
- `packages/blendlink/src/reactThreeFiber.ts`
- `packages/blendlink/src/threeRuntime.ts`
- `packages/blendlink/src/bakedRecipe.ts`

The inspected dogfood implementation is primarily:

- `MichaelRoweJonesSite/src/components/workbench/ObjectHitLayer.tsx`
- `MichaelRoweJonesSite/src/components/workbench/WorkbenchPoster.tsx`
- `MichaelRoweJonesSite/src/blendlink/ComponentLabScene.ts`

Claims about package behavior below were checked against installed source, not
inferred from package names. Browser-standard claims use W3C/WHATWG sources.

## Evidence from the current implementation

### Existing foundations worth keeping

`installRuntimeComponents()` is already a useful transaction. It installs in
order, rolls successful installations back in reverse if a later adapter
fails, disposes in reverse, and wraps failures with component identity. The
runtime already defines `InteractionService` and `AccessibilityService`
capabilities. These are good internal **Seams**; replacing them with a new
public event framework would lose locality.

`installThreeComponents()` also preserves important ownership decisions:

- `audio-source` is ordered before `play-audio-on-click`;
- application-owned loaders can be supplied;
- URL opening can be delegated through `openUrl` / `openComponentUrl` instead
  of assuming global navigation;
- unsafe URL schemes are validated before listeners are installed;
- component installation participates in the shared rollback transaction.

The baked-state runtime already demonstrates the correct promotion shape.
`setStateAsync()` prepares every required texture before committing texture and
visibility changes together. The GLB contains a bootstrap atlas, while
`qualityReady` can promote the visible scene to a canonical delivery later.
That implementation is the local precedent for interactivity: preserve the
last complete presentation while preparing, then commit a complete next state.

### Current gaps

The Three interaction helpers do not use the runtime's interaction or
accessibility services. Every click component creates its own `Raycaster` and
canvas `click` listener; every hover component creates its own `Raycaster` plus
`pointermove` and `pointerleave` listeners. This creates N raycasts for N
behaviors and bypasses R3F's event ordering, propagation, capture, and event
source. R3F already centralizes intersections and lets nearer objects stop
events from reaching farther objects. [R3F events](https://r3f.docs.pmnd.rs/api/events)
and the exact [R3F 9.6.1 event source](https://github.com/pmndrs/react-three-fiber/blob/v9.6.1/packages/fiber/src/core/events.ts)
are the primary references.

The registry declares that `blendlink.open-url` requires
`dom-accessibility`, but the current Three installer supplies no accessibility
service. The current link, animation, and audio triggers therefore have no
package-provided focus target, accessible name, role, keyboard activation, or
focus equivalent for hover. This is a contract gap, not a cosmetic omission.

Audio loading is part of initial component installation. Authored `autoplay`
calls `THREE.Audio.play()` immediately, and click-to-play calls `play()` without
first resuming a suspended `AudioContext`. Three r184's `Audio.play()` creates a
buffer source and starts it; it does not resume the context. Three's singleton
`AudioContext.getContext()` creates the native context on first use. Compare
the installed behavior with the [Three r184 Audio source](https://github.com/mrdoob/three.js/blob/r184/src/audio/Audio.js)
and [AudioContext source](https://github.com/mrdoob/three.js/blob/r184/src/audio/AudioContext.js).

The R3F adapter starts scene installation in an Effect and returns `null` until
ready. React explicitly says that Suspense does not detect fetching started in
an Effect or event handler. An outer Suspense boundary therefore cannot make
the current installation itself Suspense-aware. React also retries an initial
render that suspended before mounting from scratch, while Strict Mode runs an
extra development setup/cleanup cycle for Effects. [React Suspense](https://react.dev/reference/react/Suspense)
and [React Strict Mode](https://react.dev/reference/react/StrictMode) define
those lifecycle facts.

R3F `useLoader` is Suspense-aware because it reads a cached `suspend-react`
entry keyed by loader and input; `useLoader.preload` starts the same cached
loader work. That establishes network/loader readiness, not scene mutation or
GPU presentation. Cached results also cannot be disposed as though one
component uniquely owns them. [R3F `useLoader` documentation](https://r3f.docs.pmnd.rs/api/hooks#useloader)
and the exact [9.6.1 hook source](https://github.com/pmndrs/react-three-fiber/blob/v9.6.1/packages/fiber/src/core/hooks.tsx)
support this limit.

Drei `Preload` is not a stronger barrier. In installed 10.7.7 it runs a layout
Effect, temporarily makes invisible objects visible when `all` is set, calls
synchronous `gl.compile()`, renders through a `CubeCamera`, restores visibility,
and returns. It neither participates in render-time Suspense nor documents an
all-resources-presented guarantee. See the exact [Drei 10.7.7 source](https://github.com/pmndrs/drei/blob/v10.7.7/src/core/Preload.tsx).

Three r184 provides useful, narrower primitives:

- `renderer.initTexture(texture)` initializes and uploads a known texture to
  avoid first-render decode/upload stalls;
- `renderer.compileAsync(scene, camera, targetScene)` resolves when known
  materials can render without avoidable shader-compilation stalls, using
  `KHR_parallel_shader_compile` when available.

Those operations improve preparation but do not prove that an arbitrary custom
shader, post-processing target, late dynamic branch, or final frame has been
presented. [Three WebGLRenderer documentation](https://threejs.org/docs/pages/WebGLRenderer.html)
and the exact [r184 renderer source](https://github.com/mrdoob/three.js/blob/r184/src/renderers/WebGLRenderer.js)
define the narrower guarantees.

## Dogfood findings

The flagship site's strongest interactivity is application-owned DOM, not raw
Canvas input:

- `ObjectHitLayer` projects scene targets into transparent anchors with real
  `href` values. It keeps modified and middle click browser behavior, suppresses
  activation after more than 10 pixels of movement, and uses `touch-action:
  pan-y` so object targets do not casually steal page scrolling.
- Its projected anchors are intentionally removed from accessibility and tab
  order. `WorkbenchPoster` owns the visible semantic navigation with real Next
  `Link` elements, labels, focus state, 44-pixel minimum control height, arrow
  navigation, Home/End, Enter, and Space.
- `ComponentLabScene` supplies `openComponentUrl` and reports a typed custom
  event instead of navigating the test route. Its source comment explicitly
  reserves routing and analytics for the site.

This is the correct ownership model. The weakness is duplication: target
identity, projection, drag suppression, activation, focus/hover coupling, and
route intent are currently composed manually in the application. Blendlink
should supply stable semantic descriptions and a dispatcher, while leaving the
actual DOM and route policy in the site.

Next's current guidance reinforces that boundary. It recommends `<Link>` for
navigation unless programmatic routing is specifically needed, and warns that
untrusted values passed to `router.push` can execute unsafe schemes. The
dogfood site's real anchors preserve browser affordances, while its
`router.push` path is appropriate for cinematic transitions. [Next `useRouter`](https://nextjs.org/docs/app/api-reference/functions/use-router)
and [Next `Link`](https://nextjs.org/docs/app/api-reference/components/link)
are the primary sources.

No general analytics sink was found in the audited dogfood path. The code
proves route-policy ownership and an intent seam, not end-to-end analytics.
Analytics should be exercised when a real application adapter exists rather
than simulated inside Blendlink.

## Platform constraints the interface must encode

### Pointer, touch, and cancellation

Pointer Events unify mouse, pen, and touch, but explicitly do not cover
keyboard access. The specification encourages high-level `click`, focus, and
blur where possible and explicit keyboard handling when low-level pointer
events are used. `touch-action` declares which direct-manipulation gestures the
browser may own; when the browser takes over a gesture it can issue
`pointercancel`. Pointer capture has explicit set, release, and lost-capture
semantics. [Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/)
defines all of these contracts.

Consequences for Blendlink:

- activation is an up/click outcome, not an irreversible pointer-down side
  effect;
- a drag/scroll threshold and `pointercancel` must clear candidate activation;
- hover must not be required for touch functionality;
- focus and hover are separate input states that may drive the same visual
  emphasis;
- one input coordinator arbitrates the nearest eligible target and pointer
  capture; components do not attach independent canvas listeners;
- the website chooses `touch-action` because it owns page scrolling and layout.

WCAG's Pointer Cancellation guidance requires an opportunity to abort or undo
down-event activation, and Target Size (Minimum) defines a 24 by 24 CSS pixel
minimum subject to listed exceptions. The flagship's 44-pixel controls are a
good stronger application choice. [WCAG pointer cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html)
and [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
are the references.

### Keyboard and semantic controls

Canvas coordinates cannot by themselves supply link/button semantics. A native
anchor preserves destination, context-menu, new-tab, copy-link, keyboard, and
assistive-technology behavior. A native button supplies Enter/Space activation
and focus behavior. Merely adding an ARIA role does not create those behaviors;
the WAI-ARIA button pattern requires the author to implement them. [WAI-ARIA
button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
and the [HTML canvas fallback model](https://html.spec.whatwg.org/multipage/canvas.html#the-canvas-element)
are the primary references.

`SceneInteractionControl` should therefore be data suitable for application
DOM, not package-inserted markup:

```ts
interface SceneInteractionControl {
  readonly id: string
  readonly targetId: string
  readonly kind: 'link' | 'button'
  readonly label: string
  readonly href?: string
  readonly target?: '_self' | '_blank'
  readonly disabled: boolean
}
```

An Open Link control must have a real label. Object name is useful diagnostic
context but is not a safe production fallback for an accessible name. Blendlink
should add an accessible-label authoring field only through the existing
additive schema discipline, permit an application override keyed by stable
component ID, and make Publish fail loudly when a production interactive
control has neither. This is future schema/UI work, not an implicit reshape in
this design pass.

### Web Audio and trusted activation

The Web Audio specification lets a user agent prevent an `AudioContext` from
starting until the document is allowed to start it. `resume()` is asynchronous,
but the request must be initiated from the trusted activation path. HTML tracks
transient and sticky user activation separately, and some APIs consume
transient activation. [Web Audio's allowed-to-start model](https://webaudio.github.io/web-audio-api/#allowed-to-start)
and [HTML user activation](https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation)
are the primary sources.

The dispatch invariant is therefore unusual but essential: for an `activate`
event, every gesture-gated operation (`AudioContext.resume`, application
navigation/new-window policy, fullscreen if later supported) is invoked
synchronously before the first `await`. The returned Promise reports later
preparation and playback outcome; it does not defer the user-activation request
until after resource loading.

Autoplay should not mean "audible." It should produce one of:

```ts
type AudioActivationState =
  | 'loading'
  | 'ready'
  | 'blocked'
  | 'playing'
  | 'failed'
```

`blocked` is recoverable from the next trusted activation. If context resume
fails, Blendlink reports component ID, source URL, context state, and recovery
direction. It must not silently mark Three's `isPlaying` as audible success.

## Recommended deep interface

### One entry point

```ts
interface InstallSceneInteractivityOptions {
  readonly components: readonly PortableComponentRecord[]
  readonly bindings: SceneBindings<THREE.Object3D>
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.Camera
  readonly root: THREE.Object3D
  readonly input: SceneInputAdapter
  readonly perform: (intent: ApplicationIntent) => void
  readonly onStatus?: (status: SceneInteractionStatus) => void
}

type SceneInteractionEvent =
  | { type: 'activate'; controlId: string; source: 'pointer' | 'keyboard' }
  | { type: 'hover'; controlId: string; active: boolean }
  | { type: 'focus'; controlId: string; active: boolean }

type ApplicationIntent =
  | { type: 'open-url'; componentId: string; url: string; target: '_self' | '_blank' }
  | { type: 'diagnostic'; componentId: string; message: string }

type SceneInteractionResult =
  | { status: 'committed' }
  | { status: 'delegated'; intent: ApplicationIntent }
  | { status: 'ignored'; reason: 'disposed' | 'disabled' | 'stale' }
```

`perform` is one application-policy seam, not separate router and analytics
ports. A site can validate route locality, record analytics, begin a cinematic
transition, then call `router.push`; a Preview adapter can call `window.open`.
Keeping those steps together preserves application ordering and avoids a
half-navigation when one callback throws. `perform` must be called
synchronously for gesture-sensitive intents and must never receive an unsafe
or unvalidated URL.

The installed handle's `controls` are immutable and ordered by stable component
ID. `prepare()` is optional and idempotent. `dispatch()` is the sole behavior
input; R3F, Vanilla Three, and application DOM controls all feed it. Status is
an observer supplied at installation so the core does not impose a React store
or loading UI.

### Installation and activation order

1. **Plan without side effects.** Parse enabled records, validate URLs and
   labels, resolve stable targets, detect duplicate/conflicting controls, and
   build immutable control/effect plans. No scene mutation, audio context, DOM
   listener, or network request occurs.
2. **Acquire ownership.** Create generation and resource leases, then register
   every target with the input adapter. If any registration fails, unregister
   all prior targets in reverse order and throw a component-contextual install
   error.
3. **Publish controls.** Only after registration succeeds does the handle
   become visible to the application. This prevents a DOM control from
   dispatching into a partially installed behavior graph.
4. **Prepare opportunistically.** `prepare()` fetches/decodes audio and future
   action resources, initializes known textures, and compiles known material
   paths without changing the currently committed presentation. Calls dedupe
   by content/resource key and use leases rather than global ownership.
5. **Activate synchronously at the gesture gate.** Resume the shared audio
   context and invoke application intent policy before the first `await`.
6. **Finish preparation.** Await the resource lease, reject obsolete
   generations, and keep the last complete presentation on failure.
7. **Commit once.** Apply every prepared material/visibility/action change in
   one synchronous batch, acquire any frame-activity lease, and invalidate once.
8. **Report outcome.** Publish exact `ready`, `blocked`, `committed`, or `failed`
   state. A successful commit is not called "presented" until a renderer-owned
   frame completion observation exists.

### Atomic and progressive resource rules

- A render-time Suspense cache may hold only detached preparation. It must not
  mutate the active Three world because React may abandon a suspended render
  before an Effect cleanup exists.
- Initial scene reveal can use a cached Promise read during render so Suspense
  owns fallback timing. Active-world attachment, camera/environment handoff,
  and component activation remain a lifecycle commit.
- Every preparation attempt has a generation. Late results may populate a
  shared cache if their lease is still valid, but they cannot mutate the active
  scene after replacement or disposal.
- Package-owned resources are abortable only to the extent their underlying
  loaders support abort. Application-owned loaders/managers/caches are never
  aborted, cleared, or disposed by Blendlink.
- `initTexture` and `compileAsync` are renderer-specific preparation steps for
  known resources. They are not a universal GPU-ready barrier.
- Interaction-triggered baked-state changes delegate to the existing
  `setStateAsync` transaction rather than reimplementing atlas promotion.
- The default/bootstrap presentation stays visible until the entire next
  dependency set is prepared. A failure leaves it unchanged and reports a
  recoverable error.
- Cached R3F loader results use reference/lease ownership. Component unmount
  does not call `useLoader.clear` or dispose a shared GLTF merely because one
  consumer disappeared.

### Error, retry, and disposal contract

- Install failures throw `SceneInteractivityInstallError` with component ID,
  behavior type, target, cause, and rollback errors.
- Preparation failures are recoverable and scoped to the affected controls.
  Calling `prepare` again creates a new attempt generation; a rejected Promise
  is not reused forever.
- Dispatch after disposal returns `ignored/disposed`; it never performs a late
  intent or scene mutation.
- If application `perform` throws, Blendlink reports one contextual failure and
  does not fall back to global navigation. A fallback could double-navigate or
  bypass application policy.
- Disposal is idempotent, generation-gates every late continuation,
  unregisters input in reverse order, releases continuous-frame leases, stops
  module-owned mixers/audio nodes, then releases resource leases.
- Shared application resources and borrowed AudioListeners are released, not
  destroyed. Package-owned resources are disposed only after the last lease.
- Disposal continues after individual cleanup failures and throws/reports one
  aggregate error, matching the existing runtime transaction.
- No missing target, missing label, absent input capability, blocked audio,
  unsafe URL, or unsupported adapter becomes a silent skip.

### Strict Mode invariant

For setup/cleanup/setup, the first generation must be observably gone before
the second generation can commit. Deduplicated preparation may continue under
a shared lease, but input handlers, active-world mutations, camera/audio
ownership, and application intents are attempt-owned. A stale attempt can
neither dispose the current attempt's resource nor publish its status.

## Dependency categories and adapters

Using the codebase-design dependency categories:

| Dependency | Category | Design consequence |
|---|---|---|
| component validation, target planning, generations, ordering, result state | in-process | keep inside the deep module; test through its interface |
| Three scene, camera, mixer, raycaster, texture preparation | in-process | renderer implementation detail; no public port solely for tests |
| R3F input manager and Vanilla canvas input | in-process, two real adapters | one private `SceneInputAdapter` seam is justified because both production adapters exist |
| application DOM controls | in-process application adapter | consumes `controls` and calls `dispatch`; Blendlink does not insert markup |
| application router plus analytics policy | in-process application adapter | one `perform(intent)` seam; Preview and dogfood application are two real adapters |
| package-owned fetch/load/decode | true external browser APIs | private loader adapter; browser integration tests plus controllable test adapter |
| application-owned loader/cache | external supplied adapter | borrow only; never abort/dispose; seam already real because package-owned and app-owned paths exist |
| WebGL driver and Web Audio policy | true external | browser tests and status outcomes; mocks cannot establish presentation or audibility |

The input **Adapter** interface should stay internal until a third-party adapter
is actually shipped. One adapter would be a hypothetical **Seam**; R3F and
Vanilla make it real today. Tests add an in-memory adapter but do not force that
test seam into the application-facing interface.

The application-facing `perform` seam is also real today: Preview can use a
carefully constrained browser opener, while the dogfood site uses Next routing
and cinematic policy. The component lab's event reporter is a third useful
test/acceptance adapter.

The **Interface is the test surface**. New tests should assert controls,
dispatch outcomes, status, atomic visible state, and disposal through
`InstalledSceneInteractivity`; they should not assert private maps, raycaster
instances, or registration arrays. Once equivalent interface tests exist, old
per-helper listener tests should be replaced rather than layered indefinitely.

## Designs compared

### Design A — deepen the existing component transaction (recommended)

`installThreeComponents()` calls the private interactivity module, supplies the
R3F or Vanilla input adapter, and exposes the installed handle through the
ready compiled-scene handle.

Advantages:

- one component graph and one rollback transaction;
- generated bindings stay tiny;
- maximum locality for target resolution, audio-source ordering, frame
  activity, and disposal;
- Vanilla and R3F share semantic controls and outcomes;
- the site learns no cache, manager, raycaster, or AudioContext rules.

Costs:

- the current monolithic Three component file must be split carefully;
- R3F event integration may require declarative registration of loaded target
  objects instead of imperative private handler mutation;
- the ready scene handle grows one intentional application integration surface.

### Design B — separate public interaction runtime

The website creates an interaction runtime, registers component records and
Three objects, installs framework adapters, and coordinates it with the scene
runtime.

Advantages:

- maximum host customization;
- independently replaceable picking and DOM layers;
- easy standalone testing.

Costs:

- shallow for normal callers: the website must understand install order,
  resource ownership, scene replacement, and disposal;
- two transactions can disagree about readiness;
- generated bindings become wiring code;
- artists can author an interaction that the application accidentally never
  installs;
- route and input flexibility are purchased by leaking engine lifecycle
  complexity, contrary to Blendlink's promise.

Design A has greater **Depth**, **leverage**, and **locality**. Design B should
remain an internal decomposition technique, not the default product interface.

## Verification plan

### Interface-level unit and integration tests

- controls are immutable, stably ordered, safe-URL validated, and require a
  real accessible label;
- one pointer move/click produces one shared raycast and nearest eligible
  target resolution across many components;
- pointer move beyond threshold, `pointercancel`, and lost capture suppress
  activation;
- focus and hover independently acquire/release the same emphasis without
  clobbering the other owner;
- native-link application adapter preserves modified/middle click while plain
  activation delegates once;
- audio resume is invoked synchronously before any preparation await;
- blocked/resumed/failed audio states are observable and retryable;
- two prepare callers share work; aborting one lease does not abort the other;
- failed prepare leaves the previous baked/material state unchanged;
- commit changes all prepared resources together and invalidates once;
- Strict Mode setup/cleanup/setup permits only the newest generation to
  register, commit, report, or dispose;
- a `perform` exception does not cause fallback navigation;
- reverse disposal is idempotent and aggregates cleanup errors.

### Real-browser evidence required

- Chromium, Firefox, and WebKit pointer/touch behavior with page scroll,
  cancellation, capture loss, occlusion, and multi-pointer input;
- keyboard, focus-visible, screen-reader name/role/value, and native anchor
  new-tab/context-menu behavior on a production application route;
- normal-profile Web Audio blocked -> trusted-gesture resume -> audible
  playback, including iOS Safari and Android Chrome;
- throttled audio/texture/state preparation where the old presentation remains
  complete until one atomic commit;
- WebGL `initTexture`/`compileAsync` evidence followed by an instrumented first
  presented frame; distinguish `prepared`, `committed`, and `presented`;
- R3F demand mode settling to idle after hover/one-shot animation while looped
  animation/audio/postprocessing continues correctly;
- route analytics and cinematic navigation in the real dogfood site, since the
  current route hook proves policy ownership but not an analytics sink.

### Highest-confidence implementation sequence

1. Implement the private interaction plan and handle behind the existing
   component transaction; do not change manifest shape.
2. Replace per-component canvas listeners with one Vanilla coordinator and add
   the R3F event adapter through documented R3F events.
3. Expose immutable semantic controls and dispatch on the ready scene handle;
   add an additive accessible-label field only with exporter/add-on/schema and
   Publish-lint coverage.
4. Dogfood the controls in `ObjectHitLayer`/`WorkbenchPoster`, preserving real
   anchors and app-owned cinematic routing.
5. Add the Canvas/application-scoped audio coordinator and truthful blocked /
   resume / failure status.
6. Move interaction resource acquisition into leased preparation, reuse baked
   `setStateAsync` for state changes, and add renderer-specific preparation
   without claiming universal GPU readiness.
7. Add cached render-time preparation to the R3F binding only after Strict Mode
   and abandoned-render lease tests pass. Commit remains outside the cache.

## Conclusion

Blendlink does not need a broad visual-scripting runtime or a package-owned DOM
layer. It needs one deep interactivity module that turns artist-authored
components into validated targets, semantic controls, progressively prepared
effects, and atomic outcomes. R3F and Vanilla are renderer adapters; native DOM
controls, routing, analytics, and loading presentation remain application
concerns.

That boundary makes the artist experience simpler without making the developer
experience magical: the generated scene owns hard Three/WebGL/Web Audio
lifecycle rules, while the site receives small, explicit facts it can render,
route, measure, retry, and style.

## Implementation checkpoint (2026-07-21)

Implemented in this pass:

- `threeInteractions.ts` now owns one canvas listener set, one root raycast,
  nearest visible target selection, target/component composition, touch-safe
  hover behavior, idempotent cleanup, and immutable semantic controls.
- the first-party Open URL, Play Animation, and Play Audio click components use
  that shared service; artist-facing accessible labels flow through the addon,
  component schema, manifest values, and runtime fallback.
- the R3F handle exposes the controls without rendering DOM, and the dogfood
  component lab renders ordinary application-owned anchors/buttons with keyboard
  focus and activation evidence.
- lifecycle adapters can report `isActive`; demand rendering is requested for
  transitions and remains continuous only for active or conservatively unknown
  update work.
- baked-atlas quality promotion now prepares the complete active set before one
  synchronous commit. The embedded bootstrap remains the complete first paint.

Verified: the aggregate Blendlink gate passed 360 unit/contract tests (two
explicitly skipped unit cases are exercised by the required real-tool gate),
real Khronos KTX/HDR tools, workspace and packed Vanilla/R3F consumers, package
contents, headless plus isolated-archive Blender add-on checks, and two-state
Appearance/Lighting baked e2e. The dogfood Final publish, Next production build,
11 responsive hero/lab browser checks, two 19-component interaction/retry checks,
TypeScript, cloud source/card comparison, and both repositories' diff checks
also passed.

Still future work rather than an implemented claim:

- pointer capture, drag-threshold, cancellation, and modified/middle-click
  arbitration across the real browser/device matrix;
- a Canvas-scoped Web Audio unlock/status coordinator;
- leased preparation for interaction-triggered assets and a generic atomic
  state transaction beyond the baked-atlas promotion;
- proof of the final presented GPU frame, which `compileAsync` or texture
  prewarming alone cannot establish.

## Animation transport checkpoint (2026-07-23)

The developer-facing animation gap was evaluated as three interfaces:

1. expose raw Three `AnimationMixer`, clips, and actions through the R3F handle;
2. accept only application callbacks for play/pause requests; or
3. expose a small renderer-neutral transport while the installed scene retains
   mixer, render-loop, and disposal ownership.

The first design is shallow: it leaks the exact animation library, gives Manual
and NLA scenes different control models, and makes every website reconstruct
loop/seek/disposal policy. The callback-only design is too indirect for ordinary
application UI and has no readable state. The third design passes the deletion
test and is now implemented. Removing it would scatter clip-name validation,
authored speed/loop semantics, exact NLA sampling, demand invalidation, replay,
subscription, and terminal disposal into every Vanilla/R3F consumer.

`CompiledSceneAnimationTransport` therefore exposes only:

- immutable available clip metadata and current
  `idle | playing | paused | finished` state;
- `play(name?)`, deterministic `playAll()`, `pause()`, authored-seconds
  `seek()`, replayable `stop()`, and optional state subscription;
- one conservative `requiresContinuousFrames` fact.

The installed scene still owns `update()` and terminal `dispose()`. The ready
R3F handle exposes the narrow transport, not the mixer/actions, and the runtime
object is now a frozen facade rather than a TypeScript-only alias. The advanced
`onReady` and framework-neutral presentation store still expose a borrowed full
installed handle for diagnostics/integration; callers must not dispose it while
the adapter is mounted. Blender remains
the source of clip, selected NLA sequence, loop, and speed. Crossfade graphs,
Animator parameters, application state machines, UI, and analytics remain
outside the interface.

This follows the current primary contracts rather than inventing glTF runtime
semantics. Khronos explicitly leaves animation selection, autoplay, loops, and
stop behavior to clients; Three exposes action pause/time/running plus mixer
update/setTime/stop primitives.
([glTF 2.0 animation runtime boundary](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#animations),
[Three AnimationAction](https://threejs.org/docs/pages/AnimationAction.html),
[Three AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html))

Focused tests prove Manual play/pause/seek/stop/replay, deterministic Start All,
once settling, unknown-duration conservative behavior, ping-pong seek parity,
finite settled zero-duration Repeat/Ping-Pong, invalid command diagnostics,
serialized complete delivery under reentrant or throwing subscribers,
request-frame guarantees, and terminal teardown. They also repair an important
render-loop bug: the supported NLA scheduler keeps its
Three actions paused because it samples exact strip time itself. Action-level
`isRunning()` therefore cannot be its liveness signal; the transport's own
phase now keeps demand mode active until the sequence finishes.

The independent production-dist browser gate now mounts ReactDOM, R3F 9.6.1,
Three 0.184, and `frameloop="demand"`. It runs a strict no-emit TypeScript check
before Vite and proves one nonblank initial Manual frame before interaction,
a first-wake animation time of zero after 1.35 seconds dormant, active
play/resume renders, zero tail renders after pause or bounded NLA completion
settles, an immediate seeked
pose and pixel displacement, replayable stop at the start pose, stale-handle
rejection, exact-once geometry/material disposal, and no renders after
unmount. The NLA path reaches its end while every internally sampled Three
action remains paused. This gate also exposed a production handoff race: the
async Ready invalidation could be consumed while the positive-priority
presentation gate still blocked Fiber. The adapter now invalidates again after
the committed Ready state removes that gate, making the initial static scene
visible without requiring the first application command.

The MichaelRoweJonesSite dogfood then exposed the always-loop form of the same
clock-ownership problem. Its 12-effect SwiftShader lab produced ordinary
`0.4–0.8s` frames; a click action received `0.829s` and then `0.427s`, completing
the `1.041667s` LoopOnce clip before the application sampler observed it. Pinned
Needle Engine 5.1.7 `engine_time.ts` caps global delta at `0.1s`, and
`engine_context.ts` passes that value to the composer. Blendlink matches the
stability bound at the narrower R3F ownership seam: newly active package work
starts at zero and later package update/composer deltas cap at 100 ms, while the
website's R3F clock and explicit low-level playback updates stay exact. The
production Next regression holds rAF for 1.5 seconds—longer than the clip—and
still observes a visible intermediate pose.
