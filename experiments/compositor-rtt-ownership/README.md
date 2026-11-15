# Private compositor RTT and table ownership

Research-only resource diagnostic for commits `6fe126f` and `bd50628`. It adds no node coverage, native arithmetic, or saved-Final qualification. The genuine fractional Nearest Displace builder uses a deliberately constant Render Layers resolver plus an explicit physical-extent resolver so the control measures resource lifetime and retained guards independently of appearance.

The closed `verification-rtt-table-owner-control-r7` run exercised actual Apple Metal and SwiftShader WebGPU/WebGL2. All 28 resource controls passed: 92 owned texture allocations and 18 GL framebuffer allocations were retired exactly once. Each saved-original-renderer-dispose control realized exactly three textures (one RTT color and two mapping tables), rejected the stale allocation epoch or lost GL context, then retired all three once. Supplied WebGPU devices remained usable afterward. Normal warm/resize, failed mapping allocation followed by retry without disposing the owner, and borrowed texture/added-framebuffer controls also passed. Ordinary non-disposed renderer texture/target counts returned to the independently measured `[1,1]` output baseline; saved disposal ended at `[0,0]`.

The host tests use the real Three `Textures` and `Info` classes with a fake backend. They additionally cover partial allocation/upload failure, no negative counters before native listener registration, disposal-observer resets, replaced backend records, added MSAA/optional auxiliary slots, appended renderbuffers, and idempotence. Shared quad geometry remains borrowed. No native arithmetic, mapping formula, interpolation, or Blur weight calculation changed.

Earlier diagnostic namespaces remain retained with zero credit. The first combined attempt stopped before GPU work because a bare TypeScript rebuild had not reapplied the package post-emit asset rewrite. The next lacked the fixture's explicit source extent resolver. Later assertions exposed a fixture observer that revisited a previously disposed target and newly counted its deliberately retained borrowed replacement; the observer now requires a surviving original manager record. Finally, an exact-message assertion rejected Three's genuine WebGL context-loss refusal despite successful cleanup; the final fixture accepts the named epoch or actual-context refusal. These failures were never rewritten into passes.

Run after the complete package build (including `copy-assets.mjs`):

```sh
node experiments/compositor-rtt-ownership/run.mjs artifacts/verification-rtt-table-owner-control-fresh
```

`evidence.json` pins the immutable report, tested production source, fixture scripts and actual adapter identities. The report's whole-program source-to-built check verified 202 emitted production modules. The full Displace qualification remains a separate native/actual-Final/browser transaction.
