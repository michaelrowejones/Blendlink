# R3F animation transport browser gate (experiment)

This throwaway browser fixture answers one narrow question: does the
application-facing `R3FCompiledSceneHandle.animation` transport cooperate with
a real ReactDOM + React Three Fiber `frameloop="demand"` Canvas, including the
sampled-action design used by Blendlink's bounded NLA sequence?

Run it with one command from the repository root:

```powershell
node experiments/r3f-animation-transport-browser/run.mjs
```

The driver builds the production `blendlink` workspace, runs a strict no-emit
TypeScript check over the fixture, serves it with local Vite, drives Chromium
through Playwright, writes machine-readable evidence to
`output/evidence.json`, and captures three PNG artifacts.

The first strengthened run exposed a real production defect: a static Manual
scene reached Ready, but its only invalidation could be consumed while the
positive-priority presentation gate still blocked Fiber, leaving zero visible
renders until `play()`. The adapter now invalidates once more after the
committed Ready state removes that gate. The retained regression assertion
requires a nonblank initial static render before any application command.

A later strengthened run slept 1.35 seconds before Manual play and exposed a
second defect: the first demand wake consumed dormant wall time and could finish
a short clip before its first visible frame. The retained assertion requires
the first wake sample to remain Playing at authored time zero.

## Seams under test

- Application commands enter only through the ready-only
  `CompiledScene.useScene().animation` handle.
- Actual `WebGLRenderer.render()` calls are counted per Canvas. This is the
  externally observable result of R3F demand invalidation; the fixture does
  not treat R3F's private `internal.frames` counter as an application contract.
- The production `onReady` diagnostic handle is used only to prove NLA's
  internal Three actions remain paused and to observe exact-once disposal.

## Primary-source basis

The gate records SHA-256 hashes for the listed core runtime sources in its
evidence JSON, plus exact package versions for React, ReactDOM, R3F, Three,
Playwright, Vite, and the TypeScript check.

- R3F 9.6.1's installed loop runs a demand Canvas only while its frame count is
  positive, and an `invalidate()` call made inside `useFrame` schedules a
  follow-up frame:
  `node_modules/@react-three/fiber/dist/events-b389eeca.esm.js`.
- Three 0.184's `AnimationAction.isRunning()` returns false for a paused action:
  `node_modules/three/src/animation/AnimationAction.js`.
- Three 0.184's `AnimationMixer.stopAllAction()` deactivates actions and
  restores the original property state through `_deactivateAction()`:
  `node_modules/three/src/animation/AnimationMixer.js`.
- Blendlink's production R3F adapter owns `update()`, calls `invalidate()` only
  while `requiresContinuousFrames` is true, and disposes on unmount:
  `packages/blendlink/dist/reactThreeFiber.js`.

## Deliberate limits

The loader result is deterministic and application-owned so this experiment
isolates transport and render-loop ownership. It does not establish network,
GLB parsing, decoder, CSP, CDN, cache, multi-strip blending, physical GPU, or
cross-browser behavior.
