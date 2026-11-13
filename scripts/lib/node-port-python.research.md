# Hermetic native proof imports

`createNodePortBlenderLauncher({blender, directory, timeoutMs})` returns a
proof-only executable, file identities, its owned directory and an idempotent
`dispose()`. The actual Blender binary remains `identity.native`; the proxy is
`identity.launcher`. `identity.node`, `helper`, `bridge` and `configuration` pin
the separate execution inputs. Pass the executable as the suite's `--blender`
so its SDK Final exports use the same import policy. Dispose after all owned
commands stop. Dry runs should not create this launcher or hash native tools.

Each Python invocation receives a fresh private `sys.pycache_prefix` and
`sys.dont_write_bytecode=True` before its first Python action, before Blender's
`--` script-argument delimiter. Version-only queries keep their original argv.
A POSIX shell supervisor forwards safely quoted pinned Node/bridge paths and
`"$@"`; the actual Blender child uses argv-only spawn. The Node bridge records
per-invocation exit, timeout, abort, cache cleanup and underlying identities.
It stays in the proof's process group. Parent watching handles the SDK's
single-PID SIGKILL; signal handling also covers ordinary group cancellation.

The launcher supports macOS/Linux. Actual native cache captures below are from
macOS arm64; they do not claim a measured Linux GPU or Windows profile. Imports
that happened before the bootstrap cannot be retroactively replaced. Proofs
must start a fresh factory process. An entire OS/job SIGKILL cannot execute
cleanup and may leave empty owned temporary directories. No project/user cache
is deleted. No shader program, sidecar IR, SDK production flag or export source
is modified.

## Why environment settings are insufficient

Actual Blender 4.2.0 (Python 3.11.7), 5.2.0 and 5.3.0 (Python 3.13.13) set both
`isolated` and `ignore_environment`. They ignore `PYTHONPYCACHEPREFIX` and
`PYTHONDONTWRITEBYTECODE`. Real Squeeze source imports and the full copied
add-on's package-qualified imports load stale timestamp/size bytecode after
same-size source mutations at a fixed mtime. File hashes then describe newer
source than the executed code. Disabling bytecode writes alone still reads
those caches.

The native reproducer changes only private copies: Squeeze `_literal` bound
16 to 15, and TSL `IR_MODEL` v1 to v2. It compares the actual loaded function
code hash with independently compiled current bytes and checks an actual
`emit_channel` output model. The new launcher passes on all three versions:
current code runs, existing project caches remain byte/size/mtime-identical,
owned prefixes are disposed, and original project sources/caches plus caller
settings remain unchanged. Twelve fresh native subprocesses are research
controls, not node numerical qualification.

A separate fresh Blender 5.2 SDK sync publishes an actual Final GLB and
manifest. Its native `export_scene.py` call crosses the proxy with the prefix
bootstrap before `--python`; source bytes and distribution caches stay
unchanged. This earns routing/ownership evidence only, with zero pixel credit.

## Reproduce

Run from a stable checkout with Node 24 and the actual native binaries:

```sh
npm exec --yes --package=node@24 -- node --test \
  scripts/lib/node-port-python.test.mjs

npm exec --yes --package=node@24 -- node scripts/lib/node-port-python.native.mjs \
  --blender "$BLENDLINK_BLENDER42" --blender "$BLENDLINK_BLENDER52" \
  --blender "$BLENDLINK_BLENDER53" --output artifacts/python-launcher-native-new

npm exec --yes --package=node@24 -- npm run build --workspace blendlink
npm exec --yes --package=node@24 -- node scripts/lib/node-port-python.sdk.mjs \
  --blender "$BLENDLINK_BLENDER52" --output artifacts/python-launcher-sdk-new
```

Output directories must be fresh and their parent must exist. The native
reproducer intentionally retains staged old caches and failed-import controls.
It copies launcher snapshots/receipts before disposing the executable. Unit
tests cover quoted paths, delimiters, version passthrough, fresh prefixes,
failed spawn, nonzero exit, timeout, abort, pinned binary changes, SDK single-PID
SIGKILL and process-group TERM. `node-port-python.research.json` pins the
retained local evidence; no old numerical receipt is reclassified or reused.
