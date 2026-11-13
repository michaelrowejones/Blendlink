import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverBlender } from './discover.js'

const addonModuleDirectory = dirname(fileURLToPath(import.meta.url))
const ADDON_SOURCE = [
  join(addonModuleDirectory, 'addon'),
  join(addonModuleDirectory, '..', '..', 'blender-addon'),
].find((candidate) => existsSync(candidate)) ?? join(addonModuleDirectory, 'addon')
const ADDON_STATUS_PREFIX = '##blendlink-addon-status '

export interface BlenderAddonStatus {
  installed: boolean
  enabled: boolean
  version: string | null
  path: string | null
  fingerprint: string | null
  catalogPath: string | null
  catalogSchemaVersion: number | null
  sceneEffectCount: number | null
  objectBehaviorCount: number | null
  error?: string | null
}

function includedAddonRuntimePath(path: string): boolean {
  const normalized = path.split(sep).join('/')
  const parts = normalized.split('/')
  const name = parts.at(-1) ?? ''
  return !parts.some((part) => part === '__pycache__' || part === '.git' || part === 'tests') &&
    !name.endsWith('.pyc') && !name.endsWith('.zip') && !name.endsWith('_test.py')
}

/** Content identity for the exact runtime tree Blender's extension builder
 * installs. Cache files, tests, Git metadata, and nested build archives are
 * intentionally excluded using the same policy on the Node and Blender side. */
export function fingerprintBlenderAddonTree(root: string): string {
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const name = relative(root, path)
      if (!includedAddonRuntimePath(name)) continue
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(name)
    }
  }
  visit(root)
  files.sort((left, right) => {
    const normalizedLeft = left.split(sep).join('/')
    const normalizedRight = right.split(sep).join('/')
    return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0
  })
  const tree = createHash('sha256')
  for (const name of files) {
    const normalized = name.split(sep).join('/')
    const file = createHash('sha256').update(readFileSync(join(root, name))).digest('hex')
    tree.update(normalized, 'utf8').update('\0').update(file, 'ascii').update('\n')
  }
  return tree.digest('hex')
}

export function bundledBlenderAddonFingerprint(): string {
  if (!existsSync(ADDON_SOURCE)) {
    throw new Error(`The bundled SceneToWeb addon is missing at ${ADDON_SOURCE}`)
  }
  return fingerprintBlenderAddonTree(ADDON_SOURCE)
}

export function bundledBlenderAddonVersion(): string {
  const manifestPath = join(ADDON_SOURCE, 'blender_manifest.toml')
  let text: string
  try {
    text = readFileSync(manifestPath, 'utf8')
  } catch (error) {
    throw new Error(
      `The bundled SceneToWeb addon manifest is missing at ${manifestPath}: ` +
        (error instanceof Error ? error.message : String(error)),
    )
  }
  const version = text.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  if (!version) throw new Error(`The bundled SceneToWeb addon manifest has no valid version: ${manifestPath}`)
  return version
}

export function parseBlenderAddonStatus(output: string): BlenderAddonStatus {
  const line = output.split(/\r?\n/).filter(
    (entry) => entry.startsWith(ADDON_STATUS_PREFIX),
  ).at(-1)
  if (!line) throw new Error('Blender did not emit the SceneToWeb addon-status sentinel')
  let value: unknown
  try {
    value = JSON.parse(line.slice(ADDON_STATUS_PREFIX.length))
  } catch (error) {
    throw new Error(
      'Blender emitted malformed SceneToWeb addon status: ' +
        (error instanceof Error ? error.message : String(error)),
    )
  }
  const status = value as Partial<BlenderAddonStatus>
  if (typeof status.installed !== 'boolean' || typeof status.enabled !== 'boolean' ||
      (status.version !== null && typeof status.version !== 'string') ||
      (status.path !== null && typeof status.path !== 'string') ||
      (status.fingerprint !== null && typeof status.fingerprint !== 'string') ||
      (status.catalogPath !== null && typeof status.catalogPath !== 'string') ||
      (status.catalogSchemaVersion !== null && typeof status.catalogSchemaVersion !== 'number') ||
      (status.sceneEffectCount !== null && typeof status.sceneEffectCount !== 'number') ||
      (status.objectBehaviorCount !== null && typeof status.objectBehaviorCount !== 'number') ||
      (status.error !== undefined && status.error !== null && typeof status.error !== 'string')) {
    throw new Error('Blender emitted an incomplete SceneToWeb addon status')
  }
  return status as BlenderAddonStatus
}

export function inspectBlenderAddon(executable: string): BlenderAddonStatus {
  const script = `
import bpy, hashlib, json, runpy, tomllib
from pathlib import Path
module = "bl_ext.user_default.scenetoweb"
repo = next((item for item in bpy.context.preferences.extensions.repos if item.module == "user_default"), None)
root = Path(repo.directory) / "scenetoweb" if repo else None
manifest = root / "blender_manifest.toml" if root else None
installed = bool(manifest and manifest.exists())
version = None
fingerprint = None
catalog_path = root / "component_schema.py" if root else None
catalog_schema_version = None
scene_effect_count = None
object_behavior_count = None
error = None
if installed:
    try:
        version = tomllib.loads(manifest.read_text(encoding="utf8")).get("version")
        runtime_files = []
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(root)
            parts = relative.parts
            name = relative.name
            if any(part in {"__pycache__", ".git", "tests"} for part in parts):
                continue
            if name.endswith((".pyc", ".zip", "_test.py")):
                continue
            runtime_files.append((relative.as_posix(), path))
        tree = hashlib.sha256()
        for relative, path in sorted(runtime_files):
            tree.update(relative.encode("utf8"))
            tree.update(b"\\0")
            tree.update(hashlib.sha256(path.read_bytes()).hexdigest().encode("ascii"))
            tree.update(b"\\n")
        fingerprint = tree.hexdigest()
        if catalog_path.exists():
            catalog = runpy.run_path(str(catalog_path))
            definitions = catalog.get("COMPONENT_DEFINITIONS", {})
            catalog_schema_version = catalog.get("COMPONENT_SCHEMA_VERSION")
            scene_effect_count = sum(
                1 for value in definitions.values() if "SCENE" in value.get("targets", set())
            )
            object_behavior_count = sum(
                1 for value in definitions.values() if "OBJECT" in value.get("targets", set())
            )
    except Exception as exc:
        error = str(exc)
print(${JSON.stringify(ADDON_STATUS_PREFIX)} + json.dumps({
    "installed": installed,
    "enabled": module in bpy.context.preferences.addons,
    "version": version,
    "path": str(root) if root else None,
    "fingerprint": fingerprint,
    "catalogPath": str(catalog_path) if catalog_path else None,
    "catalogSchemaVersion": catalog_schema_version,
    "sceneEffectCount": scene_effect_count,
    "objectBehaviorCount": object_behavior_count,
    "error": error,
}, sort_keys=True))
`
  const result = spawnSync(executable, [
    '--background', '--python-exit-code', '1', '--python-expr', script,
  ], { encoding: 'utf8', windowsHide: true })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  try {
    return parseBlenderAddonStatus(output)
  } catch (error) {
    const tail = output.trim().split(/\r?\n/).slice(-20).join('\n')
    throw new Error(
      `Could not inspect the installed SceneToWeb addon` +
        `${result.status === null ? '' : ` (Blender exit ${result.status})`}: ` +
        `${error instanceof Error ? error.message : String(error)}` +
        `${tail ? `\n--- Blender output tail ---\n${tail}` : ''}`,
    )
  }
}

export function assertBlenderAddonInstallation(
  status: BlenderAddonStatus,
  expectedVersion: string,
  expectedFingerprint: string,
): void {
  if (!status.error && status.installed && status.enabled &&
      status.version === expectedVersion && status.fingerprint === expectedFingerprint) return
  throw new Error(
    `Blender did not verify the installed SceneToWeb ${expectedVersion} workspace: ` +
      `installed=${status.installed}, enabled=${status.enabled}, ` +
      `version=${status.version ?? 'unknown'}, ` +
      `files=${status.fingerprint?.slice(0, 16) ?? 'unknown'}, ` +
      `expected files=${expectedFingerprint.slice(0, 16)}` +
      `${status.error ? `, inspection error=${status.error}` : ''}. ` +
      'Run `scenetoweb addon install` again and inspect Blender extension permissions if it persists.',
  )
}

/** Build and install the bundled Blender extension into the discovered
 * Blender version. Kept explicit—normal compile operations never mutate the
 * Blender installation. */
export async function installBlenderAddon(
  blenderPath?: string,
): Promise<{ blenderVersion: string; addonVersion: string }> {
  const blender = await discoverBlender(blenderPath)
  if (!existsSync(ADDON_SOURCE)) {
    throw new Error('The bundled SceneToWeb addon is missing; reinstall the scenetoweb package')
  }
  const work = mkdtempSync(join(tmpdir(), 'scenetoweb-addon-'))
  const archive = join(work, 'scenetoweb.zip')
  const migrationState = join(work, 'legacy-addon-preferences.json')
  let legacyMigrationStarted = false
  try {
    run(blender.executable, [
      '--command', 'extension', 'build',
      '--source-dir', ADDON_SOURCE,
      '--output-filepath', archive,
    ], 'build the Blender extension')
    // Old saved scenes use the same RNA/operator identifiers. Disable the
    // legacy extension before enabling this one so registration stays atomic.
    // A partial preparation failure must also restore any captured state.
    legacyMigrationStarted = true
    run(blender.executable, [
      '--background', '--python-exit-code', '1', '--python-expr', `
import addon_utils, bpy, json
from pathlib import Path
legacy = []
for item in list(bpy.context.preferences.addons):
    if item.module == "blendlink" or item.module.startswith("bl_ext.") and item.module.endswith(".blendlink"):
        preferences = item.preferences
        legacy.append({"module": item.module, "preferences": {
            key: getattr(preferences, key) for key in ("category", "overlay_xray", "preview_package")
            if hasattr(preferences, key)
        }})
Path(${JSON.stringify(migrationState)}).write_text(json.dumps(legacy), encoding="utf8")
for item in legacy:
    addon_utils.disable(item["module"], default_set=True)
bpy.ops.wm.save_userpref()
`,
    ], 'prepare the legacy Blender addon migration')
    run(blender.executable, [
      '--command', 'extension', 'install-file',
      '-r', 'user_default', '-e', archive,
    ], 'install the Blender extension')
    const expectedVersion = bundledBlenderAddonVersion()
    const expectedFingerprint = bundledBlenderAddonFingerprint()
    const status = inspectBlenderAddon(blender.executable)
    assertBlenderAddonInstallation(status, expectedVersion, expectedFingerprint)
    // A local checkout/archive must keep working before npm publication,
    // including scenes outside that checkout. A normal registry installation
    // uses its exact release through the private desktop runtime instead.
    const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
    const { resolvePreviewStudioBlendlinkDependency } = await import('./preview.js')
    const dependency = resolvePreviewStudioBlendlinkDependency(packageRoot, expectedVersion)
    const localPreviewPackage = dependency.startsWith('file:') ? packageRoot : ''
    run(blender.executable, [
      '--background', '--python-exit-code', '1', '--python-expr',
      `
import bpy, json
from pathlib import Path
p = bpy.context.preferences.addons["bl_ext.user_default.scenetoweb"].preferences
legacy = json.loads(Path(${JSON.stringify(migrationState)}).read_text(encoding="utf8"))
for item in legacy:
    for key, value in item["preferences"].items():
        if hasattr(p, key):
            setattr(p, key, "SceneToWeb" if key == "category" and value == "Blendlink" else value)
if not p.preview_package:
    p.preview_package = ${JSON.stringify(localPreviewPackage)}
bpy.ops.wm.save_userpref()
`,
    ], 'connect the matching desktop preview compiler')
    return { blenderVersion: blender.version, addonVersion: expectedVersion }
  } catch (error) {
    if (legacyMigrationStarted && existsSync(migrationState)) {
      try {
        run(blender.executable, [
          '--background', '--python-exit-code', '1', '--python-expr', `
import addon_utils, bpy, json
from pathlib import Path
if "bl_ext.user_default.scenetoweb" in bpy.context.preferences.addons:
    addon_utils.disable("bl_ext.user_default.scenetoweb", default_set=True)
for item in json.loads(Path(${JSON.stringify(migrationState)}).read_text(encoding="utf8")):
    addon_utils.enable(item["module"], default_set=True)
    preferences = bpy.context.preferences.addons[item["module"]].preferences
    for key, value in item["preferences"].items():
        if hasattr(preferences, key):
            setattr(preferences, key, value)
bpy.ops.wm.save_userpref()
`,
        ], 'restore the previous Blender addon after the failed installation')
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError],
          'SceneToWeb installation failed and the previous addon could not be restored automatically.')
      }
    }
    throw error
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function run(executable: string, args: string[], action: string): void {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    const tail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim().split(/\r?\n/).slice(-20).join('\n')
    throw new Error(`Could not ${action} (exit ${result.status}):\n${tail}`)
  }
}
