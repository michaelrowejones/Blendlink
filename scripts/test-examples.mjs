// Compile the committed examples/ consumers against the bindings the
// CURRENT compiler generates. Each example is copied to a temp workspace
// inside the repository (so three/react resolve from the root
// node_modules), receives the workspace-built blendlink package, has its
// src/blendlink + src/generated modules produced by setupWebsiteProject +
// `blendlink typegen`, and must pass tsc and a Vite build. Drift between
// the generated bindings and the committed example source fails here, not
// in a user project.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'

const root = resolve(import.meta.dirname, '..')
const work = mkdtempSync(join(root, '.blendlink-examples-'))
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const packageUnderTest = join(root, 'packages', 'blendlink')
const cli = join(packageUnderTest, 'dist', 'cli.js')
const { setupWebsiteProject } = await import(pathToFileURL(
  join(packageUnderTest, 'dist', 'projectSetup.js'),
).href)

function run(label, command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status === 0 && !result.error) return
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  throw new Error(
    `${label} failed${result.status === null ? '' : ` (exit ${result.status})`}: ` +
      `${result.error?.message ?? output.split(/\r?\n/).slice(-30).join('\n')}`,
  )
}

async function prepare(exampleName) {
  const source = join(root, 'examples', exampleName)
  if (!existsSync(join(source, 'package.json'))) {
    throw new Error(`example ${exampleName} is missing its package.json`)
  }
  const directory = join(work, exampleName)
  cpSync(source, directory, { recursive: true })

  const target = join(directory, 'node_modules', 'blendlink')
  mkdirSync(join(directory, 'node_modules'), { recursive: true })
  cpSync(packageUnderTest, target, { recursive: true, errorOnExist: true })

  // The discovery fixture makes setupWebsiteProject scaffold the
  // hero-scene integration the committed example source imports.
  writeFileSync(join(directory, 'hero.blend'), 'discovery fixture only')
  await setupWebsiteProject(directory)

  const generated = join(directory, 'src', 'generated')
  const models = join(directory, 'public', 'models')
  mkdirSync(generated, { recursive: true })
  mkdirSync(models, { recursive: true })
  const glbPath = join(models, 'hero.glb')
  const document = new Document()
  document.createScene('Scene').addChild(document.createNode('Realtime Mesh'))
  writeFileSync(glbPath, await new NodeIO().writeBinary(document))
  run(
    `${exampleName} typegen`,
    process.execPath,
    [cli, 'typegen', glbPath, '--name', 'hero', '--url', '/models/hero.glb', '--out', generated],
    directory,
  )
  return directory
}

try {
  for (const exampleName of ['vanilla-three', 'react-three-fiber']) {
    const directory = await prepare(exampleName)
    run(
      `${exampleName} TypeScript`,
      process.execPath, [tsc, '--project', 'tsconfig.json'], directory,
    )
    run(`${exampleName} Vite`, process.execPath, [vite, 'build'], directory)
    console.log(`BLENDLINK_EXAMPLE_BUILT ${exampleName}`)
  }
  console.log('BLENDLINK_EXAMPLES_PASSED')
} finally {
  const owned = resolve(work)
  if (!owned.startsWith(root) || !owned.includes('.blendlink-examples-')) {
    throw new Error(`Refusing to remove unexpected examples-test path: ${owned}`)
  }
  rmSync(owned, { recursive: true, force: true })
}
