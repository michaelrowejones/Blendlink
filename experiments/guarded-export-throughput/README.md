# Guarded Final export startup

This CPU-only experiment measures actual forced saved-scene Final exports of an owned constant cube. It creates no render, browser or GPU job. Published GLBs must be byte-identical across identity policies, saved source bytes must remain unchanged, and `verifyAll` must pass. It grants no node numerical credit.

The initial six-export control measured 4.05 s directly versus 7.63 s through the default proof launcher. The guarded native children themselves used 5.41 s. Hashing the 210 MB Blender binary took about 99 ms, and the 127 MB Node binary about 60 ms. The previous per-invocation checks read Blender twice and Node once; helper hashes are below 1 ms. Empty Python startup controls averaged 473 ms without a prefix and 464 ms with a fresh prefix, so the prefix operation itself is not the measured hashing bottleneck. Actual exporter imports still compile afresh and remain mandatory.

`createNodePortBlenderLauncher` retains its default `per-invocation-sha256-v1` behavior. The explicit opt-in `identityPolicy: 'transaction-metadata-v1'` captures full native/Node byte identities once, checks canonical path/device/inode/size/mode/uid/gid/nanosecond mtime/ctime/birthtime before and after every invocation, and continues hashing the small helper/bridge before and after each call. A serial invocation lock rejects overlap. Each native Python action still receives its own fresh prefix before imports. Cancellation, owner-death termination and cleanup remain active; the optional profile also watches its creating transaction process.

A successful caller must `await launcher.finalize()` before archiving. Finalization independently rehashes native/Node bytes, checks copied helper/configuration/launcher identities, refuses failed/aborted calls, seals the exact invocation byte list and blocks further work. `archiveNativeLauncher` and `validateNativeArchive` require that seal, the same metadata and every sealed call. Metadata alone cannot qualify a transaction; no cache is discovered globally or loaded automatically. An unsealed, reused, altered or extended transaction refuses. `dispose()` cleans the owned directory on failure without pretending to finalize it.

The profile assumes an honest local filesystem reporting inode/change times. A privileged writer or unusual filesystem able to preserve every captured metadata field during transient binary mutation is outside this measured profile. The default full per-call SHA path remains available. The optional profile is serial and is not a general parallel native-process pool.

To opt the existing Switch suite into the profile after a shared freeze/build:

```sh
PATH=/tmp/mrj-tooling:$PATH \
SCENETOWEB_NATIVE_IDENTITY_POLICY=transaction-metadata-v1 \
SCENETOWEB_SWITCH_EVIDENCE=artifacts/verification-switch-identity-fresh \
node experiments/static-switch-family/suite.mjs --built
```

The isolated measurement copied published built SDK artifacts and independently re-emitted every current production TypeScript module to attest their bytes. No build or root workspace write occurred. Reproduce the CPU measurements with Node 24 and a matching built SDK:

```sh
node experiments/guarded-export-throughput/startup.mjs
SCENETOWEB_EXPORT_THROUGHPUT_OUTPUT=artifacts/export-startup-fresh \
SCENETOWEB_EXPORT_THROUGHPUT_MODES=guarded,transaction,guarded,transaction \
node experiments/guarded-export-throughput/profile.mjs
```

`evidence.json` contains two paired six-export batches per mode, all boundary/archive costs, source/tool hashes and identical GLB hashes. Tests cover exact-mtime-restored content changes, inode replacement, symlinks, helper/bridge drift, mutation during a child, failure, overlap, unsealed/tampered archives, shell-owner death and transaction-creator death. Raw artifacts remain outside the tracked experiment. Full integrated node numerical replay remains root-owned.
