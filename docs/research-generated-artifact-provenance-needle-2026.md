# Generated artifact path provenance: exact Needle baseline

- Last updated: 2026-07-26
- Capability ID: `BLD-PROV-001`
- Relation: **Improvement** over the analogous Needle public/local ownership
  boundary and its package-local declaration leak
- Implementation: **Shipped**
- Evidence: **Verified Needle source bytes, generated local artifacts, ignore
  ownership, and two existing production output trees**. Blendlink's focused
  typegen/cache/sync regression passed 19/19 on 2026-07-26. The current
  `npm run test:full` package/add-on/archive gate and the exact dogfood-site
  Final publication, generated-closure scan, Next build, and 25/25 browser
  smoke gate also passed that day.

## Decision

Public Blendlink output must be machine-independent. Generated TypeScript,
manifests, companions, package contents, and copied website assets may contain
project-relative, slash-normalized identifiers, but must not contain an
artist's absolute Blender path, website path, home directory, drive letter, or
UNC share. If exact local paths are useful for diagnostics, they belong in an
explicitly ignored local provenance artifact, not in the public dependency
closure.

This is a scoped improvement over the exact Needle behavior, not a claim that
Needle never emits absolute paths. Needle 5.1.4/5.1.7 has the right ownership
shape in several places:

- Blender's generated `meta.json` uses the `.blend` basename for its title and
  does not serialize the Blender or web-project absolute path;
- the component compiler writes project-relative imports to
  `register-types.js`;
- the Vite integration writes a project-relative entry to
  `.vscode/settings.json` and removes stale absolute entries; and
- the inspected production output trees contain no local absolute-path match.

However, the current Vite editor-binding generator writes an ambient
declaration below the installed Engine package whose JSDoc contains the
absolute GLB path. It can also contain an absolute application source path on
Windows. That file is local dependency/editor state under ignored
`node_modules` and was absent from the inspected production outputs. Blendlink
should preserve Needle's public/local ownership boundary while also avoiding
the local-path leak in any artifact Blendlink itself classifies as public.

## Exact identities and source observations

The broad inventory is intentionally `integration=mixed-source`; the coherent
Splash lane is named separately in `docs/needle-baseline.json`. Claims below
are attributed to the exact package that owns them.

| Source | Exact identity | Relevant behavior |
| --- | --- | --- |
| Needle Blender add-on `__init__.py` | add-on **1.4.2**; normalized path `Needle Engine Exporter for Blender/__init__.py`; SHA-256 `980226a628182e9e0b1d443c0e294f799162c76e06c5f599dacc20c614a8c96e`; baseline file ID `addon-init` | Establishes the audited add-on version. |
| Add-on `utils_meta.py` | add-on **1.4.2**; normalized path `Needle Engine Exporter for Blender/utils_meta.py`; SHA-256 `de89554d906f9e10a8ef6191a0e5285881b6e5b651e7ee7e3ae1db8b905c2dc8` | Writes `meta.json`; title is `bpy.path.basename(...)`, and no source/project absolute path is emitted. |
| Add-on `component_watcher.py` and `utils_npm.py` | add-on **1.4.2**; normalized watcher path `Needle Engine Exporter for Blender/component_watcher.py`; SHA-256 `e4937908640961572a191e6d4b05f9c4d9166d64bdc18b47c98fba2b9912c319`; `utils_npm.py` SHA-256 `23eb59a19af03ee5aad0985d764dfffac9b7c4d4167e2ef3654a7a76d364d8d3` (`addon-npm-utils`) | Delegates `.ts` component processing to the `version-3` component compiler. Absolute input paths are process arguments, not automatically public artifact fields. |
| Engine Vite binding entrypoint `plugins/vite/dts-generator.js` | identical bytes in pinned Engine **5.1.4** and **5.1.7**; normalized path `node_modules/@needle-tools/engine/plugins/vite/dts-generator.js`; SHA-256 `18cb5acde42993c71e902a6acc9014ecf31d6c50cf1e410dfb3c0ea3d0abdb5b` | Writes bindings below package-local `.needle/generated`; computes `.vscode/settings.json` with `path.relative(...)` and removes older absolute `needle-html-data.json` entries. |
| Engine binding scan `plugins/dts-generator/dts.scan.js` | identical bytes in pinned Engine **5.1.4** and **5.1.7**; SHA-256 `5084953a9d20b61501a424ee99f414bd746a710135506475cd77c415395aa226` | Labels `glbSrc` as project-relative, but strips the root with separator-sensitive string replacement. |
| Engine GLB discovery `plugins/dts-generator/glb.discovery.js` | identical bytes in pinned Engine **5.1.4** and **5.1.7**; SHA-256 `3a7b4ecb432f7bea5a982a6be9c796c22cfee22064c5efca7c21208723bff02b` | Builds absolute filesystem paths for scanning, then attempts to derive relative source-file labels with the same separator-sensitive replacement. |
| Engine writer/code generator | Engine **5.1.4/5.1.7**; `plugins/dts-generator/dts.writer.js` SHA-256 `29b8e37ff0d2b30530646d8f5f664530616d60ba50085931cacce7f4b313b033`; `plugins/dts-generator/dts.codegen.js` SHA-256 `2ce452c1b20042c8ecde26cca86c515e32eb197e4cecdc6a1cb8b3b2ae9d50a9` | Persists `glbSrc` and referring source-file labels as JSDoc without an additional redaction boundary. HTML completion output contains semantic node/component names, not filesystem paths. |
| Needle component compiler `dist/register-types.js` | `@needle-tools/needle-component-compiler` **3.0.20** from the coherent add-on 1.4.2 fixture lock; normalized path `experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/needle-component-compiler/dist/register-types.js`; SHA-256 `0b84769dd4c95c0c5b41f314d7f127ec2e54e056dd1c019b77a728377607953d` | Emits imports using `path.relative(directory, sourceFile).replace(/\\/g, "/")`; it does not put an absolute source path in the registry text. |
| Needle Blender schema writer `dist/impl/blender-compiler.js` | component compiler **3.0.20**; SHA-256 `67f1dc11b1c5c487bc48f2fbb38b6096de3e58b4673c7dde2f91df0e4e8030a6` | Emits component/property JSON only; source paths are used for compiler bookkeeping, not written as schema fields. |

The exact 3.0.20 compiler identity is scoped to
`experiments/needle-coherent-addon-1.4.2/package-lock.json`, SHA-256
`70b4564d2a569b78e0fd47c9f33e6d5ba87a747717b9c898790b451d5b7febd5`
(baseline file ID `coherent-fixture-lock`). It must not be conflated with the
historical mixed-source spike's compiler 1.10.3.

## Observed generated artifacts

### Public or project-owned outputs

The historical spike's `src/generated/meta.json` has SHA-256
`6c66080d2fdb432ffd5fd3ba5e1bb94aa39d26b1516e46d63629c207084521e9`.
It contains compression/runtime settings, `Needle Engine for Blender 5.2.0
LTS (Addon 1.4.2)`, the basename-derived title `blendlink-sample`, a public
description/poster path, and the selected team ID. It contains no absolute
Blender or website path.

The inspected `.vscode/settings.json` entry is:

```json
"node_modules/@needle-tools/engine/.needle/generated/needle-html-data.json"
```

This is project-relative. The component compiler's registry source likewise
normalizes relative imports to forward slashes.

Binary/text scans of both existing `experiments/needle-spike/dist` and the
coherent `experiments/needle-splash-official-preview/dist` returned no
`C:\Users`, `C:/Users`, or `micha` match. This is evidence for those two output
trees only, not a universal Needle deployment claim.

### Local editor provenance

The Engine-generated local declaration in the historical spike has SHA-256
`96af03882baa6ad2002364b99df1782c77f5859c5694e3adbe0d9675f26a36bd`.
Its scene JSDoc includes both:

```text
C:\Users\micha\...\experiments\needle-spike\assets\scene.glb
C:\Users\micha\...\experiments\needle-spike\src\App.tsx
```

The coherent official Preview's corresponding declaration has SHA-256
`b73a3b71c2c9bd16dee8c7f1c5bc21315971f503d8f5a1f80d82aded34c34ea4`
and includes an absolute path to its `assets\scene.glb`; its referring
`index.html` label remains relative. The same generator source bytes are
present in the pinned 5.1.4 and 5.1.7 packages, so this is not inferred from
version similarity.

`git check-ignore -v` attributes the local declaration to the fixture's
`node_modules/` rule. The application repository therefore does not track it,
and the production scans above did not find its paths. One caveat matters:
Engine's package manifest includes `.needle` in its npm `files` list even
though a source comment calls the generated subdirectory non-published. The
audited evidence proves ignored application state and absence from the two
build outputs; it does not prove exclusion from every hypothetical dependency
repacking workflow.

## Blendlink comparison and acceptance seam

| Capability ID | Relation | State | Evidence state |
| --- | --- | --- | --- |
| `BLD-PROV-001` | **Improvement** over Needle's current local declaration leak, while matching its relative public registry/metadata boundary | **Shipped** | Needle behavior is **Verified** by exact source/artifact hashes and output scans above. On Node 24.15.0/npm 11.12.1, `npm.cmd test -w blendlink -- --run src/generatedProvenance.test.ts src/syncIntegrity.test.ts` passed 2 files / 19 tests and `npm.cmd run build -w blendlink` passed on 2026-07-26. `npm run test:full` then passed 702 unit tests, real Blender/KTX tools, packed Vanilla/R3F consumers, the 276-file package, add-on headless/archive, and baked e2e. The exact packed site regeneration produced no absolute paths or outside-project basenames in its public generated artifacts; `npm run blendlink:publish -- workbenchDogfood` passed its Next production build and 25/25 browser smokes. Hosted-repository scans remain a publication gate. |

The shipped seam is centralized in `generatedProvenance.ts`. Project-owned
source and dependency paths become slash-normalized project-relative labels.
An outside path becomes the opaque public label `external/<sha256>` without
its basename, plus an additive `localPathKey` (or
`sourceBlendLocalPathKey`). The exact absolute path is written atomically only
to Blendlink's per-user OS cache, outside the project, generated companions,
runtime graph, and package. The key binds a canonical local path to the cache
record; malformed, missing, or key/path-mismatched state returns no path. Sync
and the Blender addon then report stale state and require a local resync rather
than interpreting the opaque label as a usable filesystem path.

The focused regression generates a manifest and TypeScript header from
distinct project and outside paths, proves that project paths stay relative,
proves that an outside basename and absolute fixture root are absent, and
round-trips the exact path only through a private cache before rejecting a
tampered record. The sync suite separately proves private-cache resolution and
the missing-cache stale result. This validates the owning serialization and
local drift seams, not the complete package or website publication closure.
The remaining release gate must regenerate each application-facing binding,
manifest, and companion from distinctive absolute source/site paths, then scan
the complete public closure for those values and common Windows-drive, UNC,
and POSIX-home forms. A focused unit assertion cannot by itself validate that
broader package/deployment claim.

## Reproduction commands

Run from the Blendlink repository on Windows/PowerShell 5.1:

```powershell
npm.cmd run verify:needle-baseline

npm.cmd test -w blendlink -- --run `
  src/generatedProvenance.test.ts src/syncIntegrity.test.ts

npm.cmd run build -w blendlink

Get-FileHash -Algorithm SHA256 -LiteralPath <each-source-or-artifact>

Select-String `
  -Path 'experiments\needle-spike\node_modules\@needle-tools\engine\.needle\generated\needle-bindings.gen.d.ts' `
  -Pattern 'C:\\Users|C:/Users|Referenced from'

git -C experiments/needle-spike check-ignore -v `
  'node_modules/@needle-tools/engine/.needle/generated/needle-bindings.gen.d.ts' `
  '.vscode/settings.json' `
  'src/generated/meta.json'

rg -a -n -i 'C:\\Users|C:/Users|micha' experiments/needle-spike/dist
rg -a -n -i 'C:\\Users|C:/Users|micha' experiments/needle-splash-official-preview/dist
```

`npm.cmd run verify:needle-baseline` passed on 2026-07-26:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 131 files, 9 source version identities
(2026-07-25) integration=mixed-source
named=splash-official-preview:coherent
```

The focused Blendlink commands above passed on 2026-07-26 under Node 24.15.0
and npm 11.12.1. `npm run test:full`, the installed-addon/archive check, and
the regenerated MichaelRoweJonesSite publication/path scan remain **Pending
current run** on these implementation bytes.
