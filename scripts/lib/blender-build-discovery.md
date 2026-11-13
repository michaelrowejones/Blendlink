# Official Blender build identity

These scripts discover an upstream build and verify its downloaded executable identity. They do not qualify nodes, update capability claims, run numeric proofs, or publish anything.

```sh
node scripts/discover-blender-build.mjs --output artifacts/upstream/discovery.json
node scripts/acquire-blender-build.mjs \
  --discovery artifacts/upstream/discovery.json \
  --cache-dir artifacts/upstream/archive-cache \
  --work-dir artifacts/upstream/native \
  --output artifacts/upstream/acquired.json
```

The discovery CLI has no selector overrides: it chooses the latest official Blender `main` Linux `x86_64` release `tar.xz`. A missing or ambiguous latest checksum fails rather than selecting an older build. It requests the advertised short build hash from the official `blender/blender` GitHub commits API and records the full commit and tree. Versions never stand in for source revisions. Redirects are followed manually and each URL must stay on the exact official download host allowlist. Source resolution permits only the fixed Blender commits API.

The acquisition CLI runs only on Linux x86_64, with Python `tarfile.data_filter` available (Python3.12 or a patched3.11). It hashes and size-checks every cached archive on every invocation. Extraction uses a private directory and a private verified archive copy, bounds member count/expanded storage, rejects escaping paths/links and special files, then checks an executable regular Linuxx86_64 ELF file. It executes that acquired file's `--version` and independently checks version, release cycle, branch, platform and advertised build hash. Successful directories are retained for the actual catalog/proof runner; failed owned directories are removed. The archive cache retains bytes only. No cached numeric proof is reused.

Both commands print JSON to stdout; `--output` also writes the same JSON atomically. Schema1 discovery contains:

- `selection`: fixed app/branch/platform/architecture.
- `build`: exact version string/tuple, release cycle, advertised hash, archive feed timestamp.
- `source`: repository `blender/blender`, full40-character commit and tree.
- `archive`: official URL, filename, exact byte size, checksum URL and SHA256.
- `identity`: canonical SHA256 of those immutable fields, independent of JSON property order. This detects accidental drift, not a cryptographic signature.
- `provenance`: response hashes, effective URLs and discovery time.
- `qualification`: always `unqualified`.

An acquisition preserves these fields, sets `kind` to `blender-build-acquisition`, and adds `native` (`executable`, owned `directory`, actual `version`, `versionTuple`, `buildHash`, `branch`, `platform`, version-output SHA256) plus `acquisition` (`archivePath`, `cacheHit`, `checksumVerified`). The scheduled watcher can consume `.source.commit`, `.source.tree`, `.archive.sha256` and `.native.executable`. A discovery document remains a trusted pipeline artifact: its digest is not an attestation from Blender.

Focused tests use generated tiny tar fixtures and an explicit fake version-probe callback. They exercise actual safe tar extraction but are not evidence that a Linux Blender binary ran on another operating system. Run:

```sh
node --test scripts/lib/blender-build-{discovery,acquisition,cli}.test.mjs
```

On hosts whose system Python lacks `data_filter`, set `BLENDLINK_TEST_PYTHON` to an available Python3.12+ interpreter for the fixture tests. Production acquisition deliberately refuses unsafe older tar extraction instead of falling back.
