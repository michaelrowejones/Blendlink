# Portable object behaviors and accessibility: evidence-first audit

**Date:** 2026-07-21  
**Scope:** the eight first-party object behaviors in the compiled WebGL runtime,
followed by targeted ownership/security fixes and an exported R3F dogfood pass.

## Executive finding

None of the eight behaviors has enough evidence for an unqualified **Production**
claim yet. The initial audit found a URL-scheme bypass, activation through nearer
occluders, and three overlapping-owner cleanup defects. Those defects were fixed
and the same real-browser harness was rerun successfully. The remaining release
blockers are primarily accessibility and platform coverage: interactive Canvas
regions still have no generated keyboard/focus semantics, and audio autoplay has
no application-facing blocked/resume state.

The current implementation installs `click`, `pointermove`, and `pointerleave` listeners directly on `renderer.domElement` and raycasts only the configured target subtree. It does not create a DOM link/button, focus target, accessible name, keyboard handler, or focus-visible presentation. This is not made accessible by React Three Fiber: the R3F adapter passes the same renderer and scene into the same imperative installer. R3F's own event system supports pointer events with depth ordering, propagation, capture, custom event sources, and explicit event-manager connection, but Blendlink's raw listeners bypass those semantics. [R3F event system](https://r3f.docs.pmnd.rs/api/events)

This matters independently of framework taste. WCAG 2.1.1 requires pointer functionality to have a keyboard equivalent, and the HTML canvas specification tells authors to map interactive canvas regions one-to-one to focusable fallback content. The current adapter does neither. [WCAG keyboard requirement](https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html) [HTML canvas fallback and focus model](https://html.spec.whatwg.org/multipage/canvas.html#the-canvas-element)

## What was actually exercised

The browser harness imports the built package's `dist/threeComponents.js`, creates a real `THREE.WebGLRenderer`, installs real portable component records, and drives trusted Playwright mouse, touchscreen, and keyboard input. It is not a mocked adapter-registry test.

- Blendlink package version: `0.8.0`
- Built behavior runtime SHA-256: `64FA45A4BF6FDBFE7923CE86257C60E2EE0712B94FCE2B884D2DDBF452A2C27B`
- Browser Three.js: `0.184.0` (`REVISION 184`)
- Installed R3F inspected: `9.6.1`; repository React: `19.0.0`; dogfood-site React: `19.2.4`
- Browser: system Chrome `150.0.0.0`, headless, Windows, SwiftShader, 900×760 viewport, touch enabled
- Browser result: no page exceptions and no console errors

Artifacts:

- [`browser-report.json`](../artifacts/component-behaviors-accessibility-2026/browser-report.json) — machine-readable observations
- [`browser-harness.png`](../artifacts/component-behaviors-accessibility-2026/browser-harness.png) — rendered WebGL harness
- [`harness.html`](../artifacts/component-behaviors-accessibility-2026/harness.html) — exact browser fixture
- [`run-audit.cjs`](../artifacts/component-behaviors-accessibility-2026/run-audit.cjs) — trusted-input runner

The first harness uses constructed `PortableComponentRecord` values, so the
matrix below deliberately preserves its pre-fix observations. A second,
application-owned component lab now closes the serialization/R3F boundary with
`ComponentLab.blend`, a compiled GLB and generated descriptor containing all 19
records, and a production Next.js route. Its post-fix results are recorded in
the final section rather than retroactively rewriting the diagnostic baseline.

## Component acceptance matrix

Legend: **Pass** = observed in the real browser harness; **Fail** = observed incorrect or absent; **Source** = established only by installed source; **Gap** = not exercised through that path.

| Behavior | Browser runtime | Pointer / touch | Keyboard and accessibility | Failure behavior | Sequential cleanup | Overlapping installs | R3F / exported scene | Evidence status |
|---|---|---|---|---|---|---|---|---|
| Keep Visible Through Objects | **Pass:** two occluders reached opacity `0.2`; moving camera restored both | N/A | N/A | Target lookup is loud in shared resolver (**Source**) | **Pass:** shared and two-element material assignments restored; source shared material unchanged | **Fail:** nested install restored disposed first-generation clones, not authored materials | Same core adapter (**Source**); exported/R3F **Gap** | **Preview**; production blocked by overlap and broader scene cases |
| Open Link | **Pass:** callback received authored URL and `_blank` | **Pass:** trusted mouse and touch each activated once; **Fail:** activates behind an occluder | **Fail:** canvas had no `tabindex`, role, label, focus, or Enter activation | **Fail/security:** direct `javascript:` and `data:` rejected, but leading-space ` javascript:` accepted and browser parsed it as `javascript:` | Listener removal works across repeated fresh setups (**Pass**) | No shared mutation; duplicate owners would create duplicate activation (**Source**) | Same raw canvas adapter (**Source**); exported/R3F **Gap** | **Gap**, security and WCAG blocker |
| Emphasize on Hover (registry label: Hover) | **Pass:** mouse scaled `1 → 1.5 → 1` | **Fail:** touch tap left scale at `1`; **Fail:** target emphasized behind occluder | **Fail:** no focus target or focus equivalent | Invalid non-positive scale is loud (**Source**) | Guarded authored-scale restoration is implemented (**Source**); browser mouse leave restored | Scale ownership is not coordinated (**Source**) | Same raw canvas adapter (**Source**); exported/R3F **Gap** | **Gap**, mouse-only and occlusion-incorrect |
| Start Hidden (registry label: Hide on Start) | **Pass:** immediately hidden | N/A | Runtime state itself has no interactive affordance | Missing target is loud via shared resolver (**Source**) | **Pass:** one install restored authored visibility | **Fail:** disposing first owner made target visible while second owner remained | Same core adapter (**Source**); exported/R3F **Gap** | **Preview**, overlap blocker |
| Look At Object (registry label: Look At) | **Pass:** world aim dot product `1.0` under a rotated parent | N/A | N/A | **Pass:** missing reference named component, ID, and target | **Pass:** authored quaternion restored; a later external quaternion was preserved | **Fail:** first disposal restored rotation under second owner | Same core adapter (**Source**); exported/R3F **Gap** | **Preview**; `keepUp` field and non-uniform parents unresolved |
| Play Animation on Click | **Pass:** click advanced position to `1.0` at 0.25 s with 2× speed; replay reset to `0.4`; loop reached `0.5` after 1.25 s | Mouse click **Pass**; touch inherits same click path (**Source**, not isolated in animation test); occlusion defect shared | **Fail:** same inaccessible canvas-only activation | **Pass:** missing clip lists available clip `Move` | **Pass:** disposal restored animated value to `0` in fixture | Multiple mixers/actions are uncoordinated (**Source**) | Same core adapter (**Source**); exported/R3F **Gap** | **Preview**, accessibility and ownership gaps |
| Audio Source | **Pass:** real `PositionalAudio` had linear model, `refDistance=2`, `maxDistance=8` | Autoplay is not a user input | No application-facing blocked/retry/status control | **Pass:** simulated HTTP 404 produced component ID + URL and removed audio/listener | **Pass:** last owner removed audio nodes and listener; load rollback clean | **Pass:** same listener shared; first dispose retained it; last removed it | Same core adapter (**Source**); exported/R3F **Gap** | **Preview**; autoplay and audible/device evidence missing |
| Play Audio on Click | **Pass:** first trusted touch played, second touch with toggle stopped | **Pass:** trusted touch; mouse uses same tested click coordinator; occlusion defect shared | **Fail:** same inaccessible canvas-only activation | **Pass:** missing source named unresolved ID and repair direction | **Pass:** trigger listener and source graph removed in fixture | Audio listener ownership **Pass**; duplicate trigger ownership uncoordinated (**Source**) | Same core adapter (**Source**); exported/R3F **Gap** | **Gap**, accessibility blocker |

## Detailed findings

### 1. One pointer coordinator is needed, not eight canvas listeners

`onClick()` listens for DOM `click`; `onHover()` listens for `pointermove` and `pointerleave`. Both raycast `intersectObject(target, true)`, never the scene/root. The browser therefore confirmed that Hover and Open Link activate even when another mesh is visibly in front. R3F documents that its event system orders all raycast intersections by distance and uses propagation/`stopPropagation()` to let nearer objects occlude farther interactive objects. Blendlink currently opts out of that model. [R3F event propagation](https://r3f.docs.pmnd.rs/api/events)

The use of DOM `click` explains why trusted touchscreen tap activates Open Link: Pointer Events defines click as a high-level activation event and encourages it over device-specific down/up events. It does not solve keyboard access when the receiving canvas is not focusable and has no activation behavior. The Pointer Events specification explicitly says keyboard interfaces may need keyboard handlers. [Pointer Events click and input guidance](https://www.w3.org/TR/pointerevents/#the-click-auxclick-and-contextmenu-events)

Recommended deep module: an installation-scoped `InteractionCoordinator` that owns one set of canvas listeners, raycasts the full interactive root, resolves the nearest eligible target, and arbitrates hover/click across all behavior records. It should have an explicit application-facing semantic-control seam rather than pretending a raycast is accessible.

Two credible accessibility designs were considered:

1. **Package-generated DOM proxies.** Blendlink creates focusable links/buttons for interactive 3D objects. This can meet keyboard and assistive-technology requirements, but Blendlink currently lacks an accessible-name field and it risks taking over site layout/presentation.
2. **Host-owned semantic controls with package intents.** Blendlink exposes stable interaction intents (`link`, `button`, label, disabled state, activate/focus/blur) and the application maps them to visible or visually-hidden DOM controls. This respects the product boundary that the site owns presentation, but it must be a required production contract, not an optional callback that leaves canvas-only interaction labeled Production.

The second design best matches Blendlink's product boundary. A small optional default proxy layer could support Preview, while Publish verification should reject interactive components without an accessible host binding or explicit documented opt-out.

### 2. URL validation has a browser-confirmed scheme bypass

The runtime's scheme regex is anchored at character zero and returns the original untrimmed string. It rejected `javascript:alert(1)` and `data:text/html,x`, but accepted ` javascript:alert(1)`. In the same browser, `new URL(value, location.href).protocol` returned `javascript:`. The URL Standard warns that URL security depends on context and that recipients must not trust passed URLs; it defines parsing through the URL API rather than a prefix regex. [WHATWG URL security considerations](https://url.spec.whatwg.org/#security)

Required fix: trim ASCII whitespace, parse with `new URL(value, applicationBase)`, validate the parsed protocol, and separately define whether protocol-relative external URLs are allowed. Test embedded controls, backslashes, credentials, and percent-encoded edge cases. Navigation must receive the canonical validated value.

### 3. Authored-mutation cleanup is sequentially careful but not overlap-safe

Single-install cleanup was good:

- see-through cloned every material in a two-element assignment, left a shared source material and an off-axis user untouched, restored when the camera cleared, and restored again on disposal;
- Look At restored its authored quaternion only if its last applied quaternion still owned the value, preserving a later external mutation;
- Hide on Start restored the authored visibility;
- animation disposal restored the test track to its original value.

Three overlapping cases failed:

- Hide on Start owner A saw `visible === false` and restored `true` while owner B was active.
- Look At owner A saw its installed quaternion and restored the authored quaternion while owner B was active.
- See Through owner B cloned owner A's clones; after A then B disposal, the mesh referenced A's already-disposed clone array.

R3F's compiled-scene slot reduces overlap for one scene per Canvas, but the public Three installer and Preview swaps still need truthful ownership. Use per-object/property reference-counted mutation leases. See-through needs a per-mesh lease that captures exactly one authored assignment, shares one clone assignment, combines active fade requests deterministically, and restores only after the last owner.

### 4. Look At has an exposed no-op and a documented parent limitation

The browser verified accurate aim under a rotated, uniformly scaled parent. Three.js documents that `Object3D.lookAt()` does not support non-uniformly scaled parents. That unsupported combination is currently neither detected nor reported. [Three.js `Object3D.lookAt`](https://threejs.org/docs/pages/Object3D.html#lookAt)

The exposed `keepUp` field is never read by the adapter. Three's `up` vector already influences `lookAt()`, so the current implementation always behaves as though authored up is retained. Toggling the field cannot change behavior. Implement and test a defined false behavior or remove the field; it cannot remain a verified control as-is. [Three.js `Object3D.up`](https://threejs.org/docs/pages/Object3D.html#up)

### 5. Animation behavior works, but cleanup should follow Three's memory contract

The real AnimationMixer path verified non-loop playback, 2× speed, replay reset, looping, missing-clip diagnostics, and pose restoration. However, runtime disposal calls `stopAllAction()` only. Three documents `uncacheRoot()` as the operation that deallocates mixer resources for a root after actions are stopped. Add it and include repeated-install heap/resource evidence before claiming full mixer cleanup. [Three.js `AnimationMixer.uncacheRoot`](https://threejs.org/docs/pages/AnimationMixer.html#uncacheRoot)

`speed` and `clampWhenFinished` are read by the adapter but are not current registry fields; the harness injected speed to exercise the implemented path. They should not be described as artist controls until the schema/UI intentionally exposes them.

### 6. Audio ownership is promising; autoplay truthfulness is not

The shared listener behavior matches Three's recommendation that an application usually has one `AudioListener` attached to the camera. Two overlapping installs reused the same listener; disposing one retained it and disposing the last removed it. Audio load failure removed the partially added audio and listener, and its error included component ID, URL, and underlying failure. [Three.js `AudioListener`](https://threejs.org/docs/pages/AudioListener.html)

Spatial fields materially reached the browser's PannerNode: linear distance model, full-volume radius 2, silent radius 8, and rolloff 1. Under the Web Audio specification's linear formula, those values yield gain 1 through the reference distance and gain 0 at/after max distance. This establishes the intended mathematical falloff, not an audible physical-device result. [Web Audio linear distance formula](https://www.w3.org/TR/webaudio/#dom-distancemodeltype-linear)

Autoplay remains unverified and architecturally incomplete. The adapter immediately calls `audio.play()` and exposes no suspended/blocked state, gesture-resume coordinator, or retry. The Web Audio specification permits user agents to keep a context from running until sticky activation, and Chrome's published policy directs applications to resume the context after user interaction. [Web Audio allowed-to-start model](https://www.w3.org/TR/webaudio/#allowed-to-start) [Chrome Web Audio autoplay policy](https://developer.chrome.com/blog/web-audio-autoplay)

The headless system-Chrome run reported `AudioContext.state === "running"` before trusted input even with restrictive flags. That environment therefore cannot prove gesture-blocked behavior. It does prove that the adapter creates/plays and configures audio when policy permits it. A normal desktop profile, iOS Safari, Android Chrome, and an audible-output capture remain required.

Recommended deep module: an application/Canvas-scoped audio coordinator that owns the shared listener and context-resume gesture, reports `loading | blocked | ready | playing | failed`, retries resume from a trusted DOM action, and reference-counts sources/triggers. Do not report Three's `isPlaying` as audible playback while the context is suspended.

## Evidence still missing

- manual Blender add/edit/disable/copy/paste/remove and save/reopen persistence for all eight types
- Firefox, Safari, iOS, Android, screen-reader, switch-control, and reduced-motion evidence
- non-uniform parent detection for Look At
- skinned/instanced/transparent occluders and moving/animated occluders for See Through
- visible focus design and accessible names/roles
- normal-browser autoplay blocking, context resume, background-tab behavior, and audible spatial measurements
- repeated-install memory profiles for AnimationMixer and Web Audio graphs
- external URL navigation through host analytics/router policy and CSP sandbox combinations

## Commands run

```powershell
node artifacts/component-behaviors-accessibility-2026/run-audit.cjs
npx vitest run packages/blendlink/src/threeComponents.test.ts packages/blendlink/src/componentRuntime.test.ts --reporter=dot
```

The browser command passed and wrote the cited report/screenshot. The focused unit command passed 27/27 tests; those tests are supporting regression evidence, not proof of browser usability or accessibility.

## Post-audit implementation evidence

After preserving the failing observations above, the runtime was changed behind
the existing `installThreeComponents()` interface and the same real-Chrome
harness was rerun on 2026-07-21. The refreshed `browser-report.json` now
establishes:

- whitespace-prefixed `javascript:` is rejected after URL parsing;
- Open URL and Hover no longer activate through a nearer rendered occluder;
- overlapping Start Hidden and Look At owners retain the active mutation until
  the final owner disposes;
- overlapping See Through owners restore the authored material assignment and
  never leave a first-generation disposed clone installed; and
- the prior single-install, trusted mouse/touch, animation, and shared-audio
  results remain green with no console error or page exception.

A dedicated six-case regression suite also covers those five corrected
contracts plus `AnimationMixer.uncacheRoot()` on disposal. Together with the
existing component suites, 43 focused tests passed after the changes.

This evidence does **not** close the accessibility gap. The Canvas still has no
focusable one-to-one fallback controls, accessible names, keyboard activation,
or focus equivalent for Hover, and autoplay still has no application-facing
blocked/resume state. The dogfood route therefore supplies a host-owned DOM
link for Open URL and explicitly labels the remaining canvas-only interactions;
it does not relabel the pointer adapter as accessible Production behavior.

The application-owned dogfood route subsequently closed the missing integrated
path without replacing the browser harness above. A deterministic Blender 5.2
fixture saved all 19 records through the installed add-on, compiled a schema-v3
manifest and GLB, and mounted them through the generated R3F binding. Production
Chrome then observed all eight object records materially:

- See Through held its blocker at authored opacity `0.18`;
- Open URL delivered the authored URL and target to the site's navigation hook;
- Hover reached scale `1.20` and restored after pointer leave;
- Start Hidden was invisible at ready;
- Look At's world-direction dot product to its target exceeded `0.99`;
- Play Animation changed the exported action pose after a trusted click;
- Audio Source attached a real positional audio node; and
- Play Audio on Click changed that node to `isPlaying` after trusted input.

The same route verified application-owned loading, failure, retry, a focusable
DOM link for the Open URL intent, and no axe WCAG A/AA violation. This is one
Chrome/SwiftShader acceptance environment, not an audible-device, screen-reader,
mobile-browser, or cross-browser certification. All eight adapters therefore
remain Preview in the public catalog.
