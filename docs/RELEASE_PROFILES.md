# Current Blender release profiles

The pinned Blender 5.3 lane runs the existing complete local repository contract
without replacing Blender 4.2/5.2 history or widening native GPU claims. It is
defined by `config/release-profiles/blender-5.3-macos-arm64.json` and requires
Blender 5.3.0 build `02f0899d78e3`, glTF exporter 5.3.43, macOS arm64 and CPU
Cycles baking. The probe archives hashes of the installed exporter's Python
sources. Other hosts need separately reviewed profiles and actual evidence.

Use a new evidence directory for every run:

```sh
npm run test:release-profile -- \
  --blender /Applications/Blender.app/Contents/MacOS/Blender \
  --evidence artifacts/release-profile-53-run1
```

The complete command requires committed, tracked-clean gate source, a matching
native identity and the real tools required by `npm run test:full`, including
KTX. It retains raw stdout/stderr, command arguments, exit statuses, durations,
hashes and `report.json`. Focused headless filters are refused. It runs on the
local machine; it does not invoke a hosted workflow or publish anything.

Add `--preflight-only` to check native identity without the complete contract.
`preflight-passed` is not a material, browser or release qualification. A
`local-contract-passed` result still leaves the scene corpus, physical-device
matrix, node-specific native profiles and distribution gates outstanding.

## Initial 5.3 finding

On November 15, the real `run_headless.py` omnibus suite completed with
`BLENDLINK_ADDON_TESTS_PASSED` on the pinned 5.3 host. It also emitted
`BLENDLINK_MATERIAL_RELAXATIONS_NATIVE_NOT_APPLICABLE (5, 3, 43)`: the historical
material-rule tests temporarily substitute exporter 5.2.39. That success checks
policy behavior; it does not prove those rules against actual exporter 5.3.43.

The new profile treats that marker as `blocked-native-qualification`, even when
the child exits zero. Missing full-stage receipts, nonzero exits, signals and
accepted native shutdown failures also cannot qualify. Keep the old controlled
tests; qualify current native exporter behavior independently before changing
the production admission rules. Do not delete the marker to make the gate pass.

The initial actual identity preflight passed. The full 5.3 local contract remains
separate from positive native material-rule qualification.

The clean `a4bdde2` integration checkpoint subsequently passed the complete lane
in `artifacts/v1-53-full-contract-r5`: all required command stages exited zero,
the workspace stayed stable, and the actual policy witness matched its scoped
exclusions. The native identity probe took 0.42 seconds and the complete command
took 282.15 seconds on the named host. These are command durations, not porting
effort or cross-device performance claims. Earlier failed runs remain retained.
See [the 1.0 release plan](V1_RELEASE_PLAN.md) and
[the distribution process](RELEASE.md) for the remaining gates.
