// CPU-only audit of an actual exported artifact. Imports the current built
// runtime and public GLTFLoader; never creates a renderer or GPU context.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename, join } from 'node:path'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { installTslMaterials } from '../../packages/blendlink/dist/tslMaterialRuntime.js'

const [glbArg, outputArg] = process.argv.slice(2)
assert.ok(glbArg && outputArg, 'Supply the actual exported .glb and a new audit output JSON path')
const path = resolve(glbArg), programPath = join(dirname(path), basename(path, '.glb') + '.materials.json')
const root = resolve(import.meta.dirname, '../..'), sha = bytes => createHash('sha256').update(bytes).digest('hex')
const [glb, json] = await Promise.all([readFile(path), readFile(programPath)])
const parseStart = performance.now()
const loaded = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '')
const parseMs = performance.now() - parseStart
const prior = new Set(), extras = new Set(), nonTexspace = new Set(), literals = new Set(), layouts = new Set()
loaded.scene.traverse(object => {
    if (!object.isMesh) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material.userData.blendlink_source_material) continue
        prior.add(material.uuid)
        const metadata = object.userData.blendlink_tsl_runtime
        extras.add(JSON.stringify(metadata))
        const { texspace, ...rest } = metadata ?? {}
        nonTexspace.add(JSON.stringify(rest))
        if (texspace) literals.add(JSON.stringify([
            ...texspace.location.map(Math.fround),
            ...texspace.size.map(value => Math.fround((value === 0 ? 1 : value) * 2)),
        ]))
        layouts.add(JSON.stringify(Object.entries(object.geometry.attributes).map(([name, value]) => [name, value.itemSize, value.normalized, value.array.constructor.name])))
    }
})
let installed
try {
    const installStart = performance.now()
    installed = await installTslMaterials({
        root: loaded.scene,
        descriptor: { materialPrograms: { url: 'http://cpu-audit.invalid/materials.json', bytes: json.length, hash: sha(json), materials: Object.keys(JSON.parse(json).materials).length } },
        loadPrograms: async () => JSON.parse(json),
    })
    const installMs = performance.now() - installStart, clones = new Map()
    loaded.scene.traverse(object => {
        if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material.isNodeMaterial) clones.set(material.uuid, material)
        }
    })
    const keyStart = performance.now(), keys = new Set(), roughnessKeys = new Set()
    for (const material of clones.values()) {
        keys.add(material.customProgramCacheKey())
        if (material.roughnessNode) roughnessKeys.add(material.roughnessNode.getCacheKey())
    }
    const cacheKeyMs = performance.now() - keyStart, pins = {}
    for (const file of [
        'packages/blendlink/dist/tslMaterialRuntime.js',
        'packages/blendlink/dist/tslMaterialProgram.js',
        'packages/blendlink/dist/tslNodeRecipe.js',
        'node_modules/three/src/materials/nodes/NodeMaterial.js',
        'node_modules/three/src/nodes/core/Node.js',
        'node_modules/three/src/nodes/core/ConstNode.js',
        'node_modules/three/src/renderers/common/Pipelines.js',
    ]) pins[file] = sha(await readFile(join(root, file)))
    const result = {
        role: 'Single CPU-only actual-artifact audit; no final shader generation, driver compilation, GPU or performance qualification',
        supportCredit: 0, performanceBudgetAcceptance: false, scriptSha256: sha(await readFile(import.meta.filename)),
        glb: path, glbBytes: glb.length, glbSha256: sha(glb), programPath, programBytes: json.length, programSha256: sha(json), pins,
        parseMs, installMs, cacheKeyMs,
        sourceMaterialInstances: prior.size, runtimeExtrasVariants: extras.size,
        metadataVariantsAfterRemovingTexspace: nonTexspace.size,
        effectiveFloat32GeneratedLiteralTuples: literals.size,
        attributedGeometryLayouts: layouts.size,
        nodeMaterialInstances: clones.size, customProgramCacheKeys: keys.size, roughnessNodeCacheKeys: roughnessKeys.size,
        materials: installed.materials, applied: installed.applied, skipped: installed.skipped,
        noisePreparation: installed.noisePreparation ?? null,
    }
    await writeFile(resolve(outputArg), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify(result))
} finally { installed?.dispose() }
