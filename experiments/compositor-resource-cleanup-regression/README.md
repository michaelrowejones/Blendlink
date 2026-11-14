# Resource-only compositor regression

This checkpoint validates allocation cleanup on the frozen resource-only SDK `c0c64b4`. It adds no node admission or capability promotion, and contains no unqualified Noise or Displace prototype. Native captures and saved Final exports were completed before this browser lane; this lane did not rerender or rebuild them.

| Existing family | Fresh native cases | Saved Finals | Browser case-runs | Result |
| --- | ---: | ---: | ---: | --- |
| White Noise default field | 54 + 9 independent controls | 8 | 248 | 7,943,520 words, zero mismatches |
| Wave SAW/TRI axes | 140 + 9 independent controls | 20 | 640 | 10,876,288 words, zero mismatches |
| CPU Blur consumers | 161 | — | 644 | Maximum absolute error 3.814697265625e-6, below the unchanged 2e-5 gate |

Every family ran actual WebGPU and WebGL2 on both Metal and SwiftShader. White Noise and Wave completed their independent native/source/Final/binary/archive readers, including 720 resize frames and 336 installation lifecycle cycles combined. Blur retained zero textures after every case, passed its requested MRT/clear-state checks, and reported no shader, page or console errors. Its error bound is numerical; it is not a general word-exact Blur claim. No frame-rate, whole-install zero-cost, or whole-scene rendering claim is made.

`evidence.json` pins both authoritative family receipts and the Blur results, native launcher archive and source references. `close.mjs` independently re-emits the current production runtime, checks exact module and source-map snapshots and report ordering, verifies actual adapter identities, checks all declared gates/cleanup, and rechecks package bytes. The White Noise/Wave readers additionally close complete vendor and browser fixture snapshots. The older Blur harness retains production module/map and harness hashes; its native archive declares canonical SDK Python and two test helpers, so this wrapper does not claim a complete addon-root import census for that capture.

The tested resource-only tarball and the primary checkout tarball are byte-identical: SHA-256 `370391707a67aa97873b54a6ace656987a690f65cb4653ef28474092054892d5`, 2,791,186 bytes. Name, version, integrity and package tree fingerprint also match. Tests ran in the resource worktree; the matching primary packet does not imply a separate primary GPU/native rerun. Other ports retain their earlier evidence lineages.

Raw artifacts are ignored and machine-local under `artifacts/verification-resource-next43-*`. The command journal and process logs are retained under `/tmp/scenetoweb-resource-*`. Metal used the bundled Chromium channel and empty extra launch arguments. Software used no explicit channel and the explicit SwiftShader ANGLE/WebGPU flags. The GPU lease was released to the Noise diagnostic lane after all browser work completed.

For a new frozen transaction, first capture native/Final references with each existing family harness. Use a fresh evidence namespace; do not overwrite this checkpoint. Then run each field family's `run.mjs --built` and `run.mjs --built --final` with its reference-directory environment variable and both profiles, followed by its existing `verify.mjs`. Blur uses `experiments/native-compositor-differential/run.mjs --built --timeout-ms 1200000` with the fresh CPU reference directory and separate output directories per profile. `close.mjs` deliberately names this retained transaction and can reclose its unchanged local artifacts without another numerical run.
