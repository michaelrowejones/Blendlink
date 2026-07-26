import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runBrowserEvidence } from '../../artifacts/release-dogfood/browser-evidence.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..', '..')
const fixtureRoot = resolve(
  repositoryRoot,
  'artifacts',
  'release-dogfood',
  'blender-4-splash',
)
const outputDirectory = resolve(import.meta.dirname, 'output')

await mkdir(outputDirectory, { recursive: true })

await runBrowserEvidence({
  root: fixtureRoot,
  port: 4181,
  cases: [
    {
      id: 'blender-4-splash-selected-sky-final-density',
      path: '/?scene=sky',
      outputStem: resolve(outputDirectory, 'browser-final-selected-sky'),
      viewport: { width: 1200, height: 600 },
    },
  ],
})
