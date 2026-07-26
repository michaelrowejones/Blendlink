# R3F preload/attempt lease prototype

This prototype answers one narrow ownership question before Blendlink exposes a
Suspense/preload interface: can a renderer-bound, single-commit scene candidate
be safely started by a Client Component render and cleaned up if React abandons
that render?

Run:

```powershell
node experiments/r3f-preload-lease-prototype/run.mjs
```

The real React 19.0.0 browser differential proves:

- a lease acquired by a component that suspends before first commit has no
  Effect cleanup and remains owned by the module cache after the component is
  removed;
- acquiring from a committed owner and placing only the `use(lease.ready)`
  reader beneath Suspense gives cleanup a real lifetime;
- a one-microtask retirement handoff collapses root Strict Mode's
  setup/cleanup/setup replay into one attempt, while final unmount still
  cancels and disposes exactly once;
- a deliberately non-cooperative late result cannot activate and is disposed;
- renderer-bound candidates remain exclusive across logical owners, and retry
  receives a new attempt identity.

This is **Prototype** evidence, not a shipped interface. The candidate is a
controlled fake and the result does not prove GLB/KTX/HDR/EXR cancellation,
GPU-readiness, or cross-browser timing. See
[`../../docs/research-r3f-preload-lease-2026.md`](../../docs/research-r3f-preload-lease-2026.md)
for the production recommendation and limitations.
