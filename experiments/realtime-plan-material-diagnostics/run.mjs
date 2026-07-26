import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)))
const repository = resolve(root, '..', '..')
const blender = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
const fixture = join(root, 'fixture', 'realtime-needs-bake.blend')
const evidencePath = join(root, 'evidence.json')
mkdirSync(dirname(fixture), { recursive: true })

const generated = spawnSync(blender, [
  '--background',
  '--factory-startup',
  '--python-exit-code', '1',
  '--python', join(root, 'make_fixture.py'),
  '--', fixture,
], { cwd: root, encoding: 'utf8', windowsHide: true })
if (generated.status !== 0 || !generated.stdout.includes('BLENDLINK_REALTIME_PLAN_FIXTURE')) {
  throw new Error(`Fixture generation failed:\n${generated.stdout}\n${generated.stderr}`)
}

const planned = spawnSync(process.execPath, [
  join(repository, 'packages', 'blendlink', 'dist', 'cli.js'),
  'plan',
  'realtimeNeedsBake',
  '--json',
], { cwd: root, encoding: 'utf8', windowsHide: true })
if (planned.status !== 1) {
  throw new Error(`Expected plan exit 1, received ${planned.status}:\n${planned.stdout}\n${planned.stderr}`)
}
const output = JSON.parse(planned.stdout)
const scene = output.scenes?.[0]
const issue = scene?.inspection?.errors?.[0]
if (
  scene?.plan !== null
  || issue?.code !== 'material.used-needs-bake'
  || issue?.material !== 'Autumn Shader to RGB'
  || !issue.usedBy?.includes('Realtime Needs Bake')
) {
  throw new Error(`Plan did not expose the used material loss:\n${planned.stdout}`)
}

const acknowledgedJson = spawnSync(process.execPath, [
  join(repository, 'packages', 'blendlink', 'dist', 'cli.js'),
  'plan',
  'realtimeNeedsBakeAcknowledged',
  '--json',
], { cwd: root, encoding: 'utf8', windowsHide: true })
if (acknowledgedJson.status !== 0) {
  throw new Error(
    `Expected acknowledged JSON plan exit 0, received ${acknowledgedJson.status}:\n` +
    `${acknowledgedJson.stdout}\n${acknowledgedJson.stderr}`,
  )
}
const acknowledgedOutput = JSON.parse(acknowledgedJson.stdout)
const acknowledgedScene = acknowledgedOutput.scenes?.[0]
const warning = acknowledgedScene?.inspection?.warnings?.[0]
if (
  acknowledgedScene?.plan !== null
  || acknowledgedScene?.inspection?.errors?.length !== 0
  || warning?.code !== 'material.used-needs-bake'
  || warning?.material !== 'Autumn Shader to RGB'
  || warning?.acknowledgedBy !== 'src/materials/installAutumnMaterials.ts'
) {
  throw new Error(
    `Acknowledged JSON plan did not preserve the loud warning:\n${acknowledgedJson.stdout}`,
  )
}

const acknowledgedHuman = spawnSync(process.execPath, [
  join(repository, 'packages', 'blendlink', 'dist', 'cli.js'),
  'plan',
  'realtimeNeedsBakeAcknowledged',
], { cwd: root, encoding: 'utf8', windowsHide: true })
if (
  acknowledgedHuman.status !== 0
  || !acknowledgedHuman.stderr.includes('realtime plan acknowledged')
  || !acknowledgedHuman.stderr.includes('Autumn Shader to RGB')
  || !acknowledgedHuman.stderr.includes('src/materials/installAutumnMaterials.ts')
) {
  throw new Error(
    `Acknowledged human plan did not preserve the loud warning:\n` +
    `${acknowledgedHuman.stdout}\n${acknowledgedHuman.stderr}`,
  )
}

const evidence = {
  schemaVersion: 1,
  unacknowledged: {
    command: 'blendlink plan realtimeNeedsBake --json',
    exitCode: planned.status,
    scene,
  },
  acknowledgedJson: {
    command: 'blendlink plan realtimeNeedsBakeAcknowledged --json',
    exitCode: acknowledgedJson.status,
    scene: acknowledgedScene,
  },
  acknowledgedHuman: {
    command: 'blendlink plan realtimeNeedsBakeAcknowledged',
    exitCode: acknowledgedHuman.status,
    stderr: acknowledgedHuman.stderr.trim(),
  },
}
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
console.log('BLENDLINK_REALTIME_PLAN_DIAGNOSTICS_PASSED')
console.log(JSON.stringify(evidence, null, 2))
