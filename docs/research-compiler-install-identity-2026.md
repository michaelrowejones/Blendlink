# Compiler cache identity versus local-package install identity

Status: evidence-backed audit and shipped local-package identity helper  
Capability: `BLD-CACHE-001`  
Relation to Needle: No analogue found in the pinned Blender export path  
Implementation: compiler invalidation, source `glblib.py` identity, and
content-addressed local dogfood replacement shipped in the working tree  
Evidence date: 2026-07-26

## Conclusion

The Splash `already Final` result after repacking Blendlink was not caused by
the scene compiler omitting `material_compiler.py` from its cache key. The new
archive was written over the same local tarball pathname and retained the same
package version, while npm left the already-installed package in place.
Blendlink therefore executed the old package, computed the old compiler
signature, and correctly found the old artifact current relative to those
installed bytes. A process cannot invalidate against compiler bytes that the
package manager never installed.

The production cache key already includes:

- the `.blend` bytes;
- resolved scene settings and config bytes;
- declared extra inputs;
- Blender version;
- the deterministic TypeScript/JavaScript compiler-stage signature; and
- the Blender Python pipeline signature.

For a built or packed CLI, `pythonPipelineSignature()` hashes every Python file
in `dist/blender`, including `material_compiler.py`. The current repository
`dist/blender/material_compiler.py` and the forced-installed Splash copy both
have SHA-256
`376ab6f575eb26b3d68882ddd6a7d4416b58a628b7bf4e0e11d5ca53365658aa`;
their Python pipeline signatures both equal `285872a8252c6226`. The repository
and installed `dist/sync.js` files also have the same SHA-256
`1cb4544982adde0046be4c845f6db7a42d874b2a95043785f5e43016b451587f`.

## Actual failure chain

The retained evidence is in the ignored Splash dogfood fixture:

`artifacts/release-dogfood/blender-4-splash`.

1. Its dependency locator remained
   `file:../blendlink-0.8.0.tgz`, and every rehearsal archive continued to
   declare version `0.8.0`.
2. npm's cache records multiple different SHA-512 integrities and byte lengths
   for that one locator. The path was mutable even though its name and package
   identity were stable.
3. The 2026-07-24 17:43 npm 11.12.1 log reports `reify moves {}` and does not
   fetch or replace Blendlink. It only adds a missing nested `meshoptimizer`.
4. The later explicit forced installs at 17:49 and 17:59 report
   `placeDep ROOT blendlink@0.8.0 REPLACE`. Only then did the executing package
   receive the changed compiler.
5. Because the forced command used `--no-save`, the two lock views now
   disagree. The root `package-lock.json` records old integrity
   `sha512-ExDF...`, while `node_modules/.package-lock.json` and the current
   archive record `sha512-mqS38...`. A later clean install is therefore not a
   safe continuation of the current dogfood state.

This agrees with npm's documented model: a lockfile describes the exact
dependency tree, a local tarball has a `file:` resolved locator, and `integrity`
is the SRI of the unpacked artifact. npm also maintains a hidden
`node_modules/.package-lock.json` for the installed tree:

- <https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/>
- <https://docs.npmjs.com/cli/v11/commands/npm-install/>

## Existing cache behavior and one adjacent hole

The relevant implementation is in `packages/blendlink/src/sync.ts`:

- `pythonPipelineSignature()` hashes the exact built Python directory and adds
  shared add-on sources when running from a source checkout.
- `compilerPipelineSignature()` hashes the listed deterministic JS/TS compiler
  stages.
- `sourceHash()` includes both signatures.
- the unchanged fast path requires `manifest.sourceHash === sourceHash(...)`
  plus complete, hash-valid published artifacts.

`packages/blendlink/src/syncIntegrity.test.ts` already proves that edits to the
source-checkout material compiler and web-light policy change the Python
signature, and that a built CLI follows the copied policy it actually executes.

The adjacent source-checkout omission is now closed. `export_scene.py` imports
`glblib.py` from the add-on fallback, and `pythonPipelineSignature()` now adds
that module to its explicit source inventory. The registered mutation test
fails on the former list and passes on the current one.

## Designs compared

### A. Content-addressed dogfood archive locator (recommended)

After `npm pack`, retain or copy the archive under a name containing its full
SHA-256 (the internal package version can remain unchanged for a dirty local
rehearsal). Update the dogfood fixture to that exact `file:` locator and run an
ordinary saved install. Refuse to compile until all of these agree:

- SHA-512 of the selected archive;
- root-lock `integrity`;
- hidden-lock `integrity`; and
- an installed compiler-tree fingerprint.

Why this is the smallest robust design:

- npm sees a different dependency spec, so replacement does not depend on
  `--force`;
- the root lock remains truthful;
- the packed distribution is still what the demo exercises;
- stale package installation fails before Blender spends time compiling; and
- no scene manifest or public schema needs to change.

Released packages should continue to use a unique immutable semantic version
and the release manifest's existing archive SHA-256/SRI. Content-addressed
local names solve dirty same-version rehearsals; they are not a replacement for
release versioning.

### B. Direct source-directory dependency

Point demos at `file:<checkout>/packages/blendlink` and build before use. This
is convenient and makes changed local bytes visible immediately, but it stops
the demo from exercising npm-pack inclusion, copied Python assets, and the
consumer archive. It is suitable for fast iteration only if the packed
consumer gate remains separate; it is weaker as the only release dogfood path.

### C. Force reinstall the mutable pathname

`npm install <archive> --force` did replace the package in the observed run.
It is a tactical recovery, not a reliable identity design: it disables npm
protections, can leave the committed/root lock stale when combined with
`--no-save`, and requires every caller to remember both the force and the
post-install check.

### D. Persist a compiler identity in each scene manifest

An additive full compiler identity would make reports and bug reproduction
clearer, and could explain an `already Final` result. It does not solve this
failure: an old installed CLI can only report its own old identity. The
existing `sourceHash` already provides the behavioral invalidation once the new
package is actually installed. Treat a manifest field as observability, not as
the package replacement fix.

## Shipped implementation and evidence

`scripts/prepare-dogfood-package.mjs` packs the real Blendlink package, names
the retained archive with its full byte SHA-256, and optionally installs it
into a named consumer with an ordinary saved npm install:

```powershell
npm run dogfood:package -- --output artifacts/dogfood-packages
npm run dogfood:package -- --output <archive-dir> --install <website-root>
```

After installation, `scripts/local-package-identity.mjs` refuses unless the
selected archive SHA-512 SRI, root `package-lock.json`, hidden
`node_modules/.package-lock.json`, dependency/resolved locators, version, and
installed package-tree fingerprint all agree. It preserves an existing
`dependencies`, `devDependencies`, or `optionalDependencies` placement and
requires the package to occur in exactly one of those sections. It uses an
isolated temporary npm cache and never relies on `--force` or `--no-save`.

Executing the shipped Blender Python modules can create interpreter-owned
`__pycache__` directories and `.pyc`/`.pyo` files inside an otherwise exact
installed tree. Those bytes are not package content, so the tree walker ignores
only directories named exactly `__pycache__` and files ending in the ordinary
lowercase `.pyc` or `.pyo` extensions. It does not ignore a general cache
directory, extension family, or hidden file. The focused fixture first proves
all three bytecode forms leave identity unchanged, then adds `cache.bin` beside
them and proves identity changes.

`node scripts/test-dogfood-package-identity.mjs` creates two archives with the
same internal version and different compiler-marker bytes. Their full SHA-256
names differ, an ordinary second npm install replaces the first tree, an
existing development-only consumer remains in `devDependencies`, both lock
views match the selected archive, and a deliberately corrupted root-lock
integrity is refused. The same fixture proves the narrow bytecode rule above.
Last focused pass on 2026-07-26 with Node 24.15.0:

```text
BLENDLINK_DOGFOOD_PACKAGE_IDENTITY_PASSED d72f57ee5717 -> cc8dc5a0cead
```

The test is part of `test:package` and `test:full`.

## Implemented seams and remaining observability

1. The package/rehearsal helper near
   `scripts/build-release-artifacts.mjs` that derives the immutable local
   archive name from packed bytes, installs it without `--no-save`, and checks
   archive/root-lock/hidden-lock/installed-tree identity is shipped.
2. The no-Blender integration test beside `scripts/test-package.mjs` creates
   two different archives with the same internal version, gives them
   different content-addressed locators, installs them in sequence, and proves
   the second installed compiler marker and both lock integrities match the
   second archive. It also proves a deliberately mismatched lock is refused by the
   helper. It also proves interpreter bytecode does not create a false
   installed-tree mismatch while an unrelated added file still does.
3. `glblib.py` is in the source fallback inventory in
   `pythonPipelineSignature()`, with the analogous mutation case in
   `packages/blendlink/src/syncIntegrity.test.ts`.

If compiler observability is desired, centralize the JS/Python inventory in
   a small `compilerIdentity` module, expose a full SHA-256, stamp it
   additively in `SceneManifest`, and make the current short `sourceHash`
   consume that value. Unit tests should prove source and packed layouts,
   manifest parse/round-trip, and a changed compiler identity invalidating the
   unchanged fast path. This remains secondary observability work.

## Needle comparison

The pinned Needle Blender add-on is 1.4.2. Its inspected
`blender_export.py` has SHA-256
`6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77`.
That operator runs the glTF export when invoked; no analogous whole-scene
`already Final` cache keyed by add-on/compiler bytes was found in the inspected
export path. This capability is therefore **No analogue**, not a parity claim.
Needle's separate lightmap UV cache is narrower and does not address npm/local
compiler package replacement.
