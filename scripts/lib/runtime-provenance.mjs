// Verify every production module against independently derived TypeScript output.
// The capture is shared by native shader/compositor proofs; it never writes dist.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { createCompilerTrace } from './runtime-compiler-trace.mjs'

export const hash = content => createHash('sha256').update(content).digest('hex')
export const normalizeEmit = content => content.replaceAll('\r\n', '\n').replace(/^\/\/# sourceMappingURL=.*$/gm, '').trimEnd()

export async function captureRuntimeProvenance({ root, built, label = 'runtime', compilerInputs = false }) {
  const trace = compilerInputs ? createCompilerTrace() : null
  const system = trace ? trace.wrap(ts.sys) : ts.sys
  const configuration = ts.readConfigFile(join(root, 'packages/blendlink/tsconfig.json'), system.readFile)
  if (configuration.error) throw new Error(ts.flattenDiagnosticMessageText(configuration.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(configuration.config, system, join(root, 'packages/blendlink'))
  const provenance = { mode: built ? 'built' : 'source', typescript: ts.version, modules: [] }
  // Reviewed package build rewrites. No other emitted bytes are ignored.
  const postEmitRules = [{ module: 'threeWebgpuPostPipeline',
    from: "import('n8ao-webgpu')", to: "import('./vendor/n8ao-webgpu/index.js')" }]
  const sourceDirectory = join(root, 'packages/blendlink/src')
  const sourceRecords = await Promise.all((await readdir(sourceDirectory)).sort()
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'))
    .map(async filename => {
      const source = join(sourceDirectory, filename)
      return { name: filename.slice(0, -3), source, contents: await readFile(source, 'utf8'),
        sourceTime: (await stat(source)).mtimeMs }
    }))
  const expectedOutputs = new Map()
  if (built) {
    // Whole-program emission preserves type-only export and const-enum semantics.
    const options = { ...parsed.options, declaration: false, sourceMap: false, noEmit: false }
    const host = ts.createCompilerHost(options)
    const originalReadFile = host.readFile.bind(host)
    const capturedSources = new Map(sourceRecords.map(record => [record.source, record.contents]))
    host.readFile = filename => capturedSources.get(resolve(filename)) ?? originalReadFile(filename)
    if (trace) trace.wrap(host, true)
    const program = ts.createProgram({ rootNames: parsed.fileNames, options, host })
    const emitted = program.emit(undefined, (filename, contents) => {
      if (filename.endsWith('.js')) expectedOutputs.set(resolve(filename), normalizeEmit(contents))
    })
    assert.equal(emitted.emitSkipped, false, 'Could not derive current production JavaScript for --built verification')
    if (trace) provenance.compilerAttestation = trace.finish(program)
  }
  for (const { name, source, contents, sourceTime } of sourceRecords) {
    const emitted = join(root, 'packages/blendlink/dist', name + '.js')
    let expected = built ? expectedOutputs.get(emitted) : normalizeEmit(ts.transpileModule(contents, { fileName: source,
      compilerOptions: { ...parsed.options, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler, sourceMap: false, declaration: false } }).outputText)
    assert.notEqual(expected, undefined, `Missing independently emitted JavaScript for ${name}`)
    const rule = postEmitRules.find(rule => rule.module === name)
    if (rule) {
      assert.equal(expected.split(rule.from).length, 2, `${name} no longer matches its reviewed package post-emit rule`)
      expected = expected.replace(rule.from, rule.to)
    }
    let actual, emittedTime
    try { actual = normalizeEmit(await readFile(emitted, 'utf8')); emittedTime = (await stat(emitted)).mtimeMs }
    catch (error) { if (built) throw new Error(`Missing built ${label} module ${name}; run npm run build first`, { cause: error }) }
    provenance.modules.push({ name, sourceSha256: hash(contents), expectedEmitterSha256: hash(expected),
      emitterSha256: actual === undefined ? null : hash(actual), sourceMtimeMs: sourceTime, emitterMtimeMs: emittedTime ?? null,
      emitterMatchesSource: actual === expected, postEmitTransform: rule ?? null })
    if (built) {
      assert.ok(emittedTime >= sourceTime, `${name} dist predates source; rebuild before --built verification`)
      assert.ok(actual === expected, `${name} emitted JavaScript differs from current source; rebuild before --built verification`)
    }
  }
  provenance.postEmitRules = postEmitRules
  provenance.copyAssetsSha256 = hash(await readFile(join(root, 'packages/blendlink/scripts/copy-assets.mjs')))
  return { provenance, sourceRecords }
}

/** Freeze exactly the modules that passed the whole-program build check. */
export async function captureRuntimeSnapshot({ root, built, destination, label = 'runtime', compilerInputs = false }) {
  const { provenance, sourceRecords } = await captureRuntimeProvenance({ root, built, label, compilerInputs })
  const directory = join(root, 'packages/blendlink', built ? 'dist' : 'src')
  const extension = built ? '.js' : '.ts'
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  provenance.snapshot = { directory: destination, mode: provenance.mode, files: [], sourceMaps: [] }
  for (const module of provenance.modules) {
    const name = module.name + extension
    const contents = await readFile(join(directory, name))
    const tested = built ? hash(normalizeEmit(contents.toString('utf8'))) : hash(contents)
    assert.equal(tested, built ? module.emitterSha256 : module.sourceSha256,
      `${name} changed while the immutable test snapshot was prepared; retry the run`)
    await writeFile(join(destination, name), contents)
    module.testedSnapshotSha256 = hash(contents)
    provenance.snapshot.files.push({ name, sha256: module.testedSnapshotSha256 })
    if (built) {
      const mapName = name + '.map'
      try {
        const contents = await readFile(join(directory, mapName))
        await writeFile(join(destination, mapName), contents)
        provenance.snapshot.sourceMaps.push({ name: mapName, sha256: hash(contents) })
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  return { provenance, sourceRecords }
}
