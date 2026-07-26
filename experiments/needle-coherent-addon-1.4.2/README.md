# Needle add-on 1.4.2 coherent package-stack fixture

## Scope

This directory isolates the six npm declarations returned by the pinned
Needle Blender add-on 1.4.2 `expectedPackageVersions()` implementation. It
answers only two questions:

1. Can npm resolve those declarations into a deterministic lock?
2. Does the locked dependency tree pass `npm ls --all`?

It does not contain a website, export a `.blend`, or establish browser-level
end-to-end evidence.

## Primary source

The declaration was read from:

```text
C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\.cache\needle-spike\addon\Needle Engine Exporter for Blender\utils_npm.py
```

- Add-on version: `1.4.2`
- `utils_npm.py` SHA-256:
  `23eb59a19af03ee5aad0985d764dfffac9b7c4d4167e2ef3654a7a76d364d8d3`
- Capture date: `2026-07-23`
- Toolchain: Node.js `24.15.0`, npm `11.12.1`, Windows

The add-on calls the helper package `@needle-tools/helper`; “engine-helper” is
not the package name in the inspected source.

## Resolution

| Add-on declaration | Locked direct version | Registry package |
| --- | --- | --- |
| `@needle-tools/engine: 5.1.4` | `5.1.4` | `@needle-tools/engine` |
| `three: npm:@needle-tools/three@^0.169.19` | `0.169.21` | `@needle-tools/three` |
| `@types/three: 0.169.0` | `0.169.0` | `@types/three` |
| `@needle-tools/helper: 2.0.0` | `2.0.0` | `@needle-tools/helper` |
| `@needle-tools/needle-component-compiler: version-3` | `3.0.20` | `@needle-tools/needle-component-compiler` |
| `@needle-tools/gltf-build-pipeline: 3.0.0` | `3.0.0` | `@needle-tools/gltf-build-pipeline` |

The caret alias is materially different from an exact Three pin. The project
resolves `three` to `@needle-tools/three@0.169.21`, while
`@needle-tools/engine@5.1.4` resolves its own import to a nested exact
`@needle-tools/three@0.169.19`:

```text
project -> node_modules/three -> @needle-tools/three 0.169.21
engine  -> node_modules/@needle-tools/engine/node_modules/three
        -> @needle-tools/three 0.169.19
```

This is a clean npm tree, but it is not a single-copy Three tree. Claims that
depend on cross-copy Three identity still need a browser fixture.

## Verification

The first install created `package-lock.json`. Replaying the lock succeeded:

```powershell
npm.cmd ci --cache .npm-cache --prefer-offline --no-audit --no-fund
```

The exact full-tree check then succeeded:

```powershell
npm.cmd ls --all
```

- Exit code: `0`
- Output lines: `747`
- Installed packages reported by npm: `482`

Platform-inapplicable optional packages are shown as unmet optional
dependencies, but npm reports no invalid, missing-required, or peer-dependency
tree error.

## Content identity

Fixture files:

| File | SHA-256 |
| --- | --- |
| `package.json` | `41753af69993e942ded85003cddd81f861cc0eb215b28fd42653a73aba89debc` |
| `package-lock.json` | `70b4564d2a569b78e0fd47c9f33e6d5ba87a747717b9c898790b451d5b7febd5` |

Installed package manifests:

| Installed manifest | Version | SHA-256 |
| --- | --- | --- |
| `node_modules/@needle-tools/engine/package.json` | `5.1.4` | `522f0a5aa64c22fe76a5d7c6fd0f039fce396eb841324512862c0d704bcacb38` |
| `node_modules/three/package.json` | `0.169.21` | `65fe3f7a609ac1145cbc8e58d0cfe254f2cabb16f5e3c41acf68f0cac4ec64a7` |
| `node_modules/@needle-tools/engine/node_modules/three/package.json` | `0.169.19` | `17bdbf08346fcbab12c79ca75847a0e90f26be57a0faac241a4a3564faa9e463` |
| `node_modules/@types/three/package.json` | `0.169.0` | `353d3b30e526b50573f1b1be21314e99df8dcac6a849f6d939a487dc03a65973` |
| `node_modules/@needle-tools/helper/package.json` | `2.0.0` | `b72e5a112dddb70e4fd59f06a94064035764de5ef9317e015fe2e52dfb5f7d27` |
| `node_modules/@needle-tools/needle-component-compiler/package.json` | `3.0.20` | `d0be1622e6593ba287dc19f29fee2ad375e4e91419c7e0e3585a5452037bd7ac` |
| `node_modules/@needle-tools/gltf-build-pipeline/package.json` | `3.0.0` | `c5d25e13d4d17e3a8d7fa2695ca404a824d85fae36eb16a90ad5cd7cc3c0077e` |

Registry tarball identity recorded by npm:

| Package | npm SHA-1 | Lock integrity |
| --- | --- | --- |
| `@needle-tools/engine@5.1.4` | `83f24cc20b64dd7e6296bf5a4788ea5a3fa91242` | `sha512-B8m1A6hj7qIhPXPqHDZGniu2ggZ4T1IY5H7Frk7A5n9v9bLJ0JqG0gQkKsIN1O1O+kDmV9P+HzI1p+yS0aBC7g==` |
| `@needle-tools/three@0.169.21` | `2e3b4652f7f2f60f18696843e06165fa707305f9` | `sha512-kTAYJ+1Q1gaLPmW+uwxm4em/XeKvYSdbxW8JnK5NzTW4EPbTEX1p74PWHs1AIk6DuU7eO1k7FE3nJqVTjm/YcQ==` |
| `@needle-tools/three@0.169.19` | `cdfbb92babf02a75553743cb7ac6ef306e367132` | `sha512-KFSiYJWMNhqSeXXj4KY2Kb5D0NPJYaPL4EuYtpqvYPcTifMMQjP5AgG5Zgf4MsF5SR6fHGM5RlY44L5u8/5QNg==` |
| `@types/three@0.169.0` | `9cf4c33575721669d88846f22b265696d2c2e7a6` | `sha512-oan7qCgJBt03wIaK+4xPWclYRPG9wzcg7Z2f5T8xYTNEF95kh0t0lklxLLYBDo7gQiGLYzE6iF4ta7nXF2bcsw==` |
| `@needle-tools/helper@2.0.0` | `d34f230715147039339d8cbe5ee89b227b14cb63` | `sha512-E+zQQfFSqnqzGe/cfo+NaIbVQNijwDenkU8SXVK7ZoOYdoW6ftHd7w9/QwPU44QoQ/a5axjgFLBOZEr+C/J5Jw==` |
| `@needle-tools/needle-component-compiler@3.0.20` | `fe6bc5c0b136c332f3730f307dbeed7caca76886` | `sha512-KK1h6elw1mkbc+GdZ3u0v3oko7p+CskDHk/MbgibslbhBdCPDyeJOp5Gbm+ZZ2hHrKoUAipF3YoT4AsfDO27pQ==` |
| `@needle-tools/gltf-build-pipeline@3.0.0` | `053b8ee7f416fd9c13cf48c67c666390409ed91a` | `sha512-sjZayNmXg0oxmV/N4CJzkWfDK4FfXLJgCj2R18/gxcujNWHYlHXSZDNDY5kMRyvcRrtWmmKcTmGsPGVwqXMqhA==` |

The registry URLs and integrity values are preserved in `package-lock.json`;
the installed tree can therefore be replayed independently of mutable npm
dist-tags.
