import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

function parseGlbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB')
  if (view.getUint32(4, true) !== 2) throw new Error('not glTF 2.0')
  const declaredLength = view.getUint32(8, true)
  if (declaredLength !== bytes.byteLength) {
    throw new Error(`GLB length mismatch: ${declaredLength} != ${bytes.byteLength}`)
  }
  const jsonLength = view.getUint32(12, true)
  const jsonType = view.getUint32(16, true)
  if (jsonType !== 0x4e4f534a) throw new Error('first GLB chunk is not JSON')
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
}

function materialStructure(document) {
  return (document.materials ?? []).map((material) => ({
    name: material.name ?? '',
    alphaMode: material.alphaMode ?? 'OPAQUE',
    alphaCutoff: material.alphaCutoff ?? null,
    doubleSided: material.doubleSided ?? false,
    pbrMetallicRoughness: material.pbrMetallicRoughness ?? null,
    emissiveFactor: material.emissiveFactor ?? null,
    extensions: material.extensions ?? {},
  }))
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Number(value.toFixed(8))
    : value
}

function summarizeThreeMaterial(material) {
  return {
    name: material.name,
    type: material.type,
    transparent: material.transparent,
    opacity: number(material.opacity),
    alphaTest: number(material.alphaTest),
    metalness: number(material.metalness),
    roughness: number(material.roughness),
    clearcoat: number(material.clearcoat),
    clearcoatRoughness: number(material.clearcoatRoughness),
    transmission: number(material.transmission),
    thickness: number(material.thickness),
    ior: number(material.ior),
    attenuationDistance: number(material.attenuationDistance),
    sheen: number(material.sheen),
    sheenRoughness: number(material.sheenRoughness),
    specularIntensity: number(material.specularIntensity),
    anisotropy: number(material.anisotropy),
    anisotropyRotation: number(material.anisotropyRotation),
    iridescence: number(material.iridescence),
    iridescenceIOR: number(material.iridescenceIOR),
    dispersion: number(material.dispersion),
    emissiveIntensity: number(material.emissiveIntensity),
    hasMap: Boolean(material.map),
    mapTransform: material.map ? {
      offset: material.map.offset.toArray().map(number),
      repeat: material.map.repeat.toArray().map(number),
      rotation: number(material.map.rotation),
      channel: material.map.channel,
    } : null,
  }
}

async function loadWithThree(bytes) {
  if (!globalThis.self) globalThis.self = globalThis
  if (!globalThis.ProgressEvent) {
    globalThis.ProgressEvent = class ProgressEvent {
      constructor(type, init = {}) {
        this.type = type
        Object.assign(this, init)
      }
    }
  }
  if (!globalThis.createImageBitmap) {
    globalThis.createImageBitmap = async () => ({
      width: 2,
      height: 2,
      close() {},
    })
  }
  const loader = new GLTFLoader()
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject))
  const materials = new Map()
  gltf.scene.traverse((object) => {
    const list = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of list) {
      if (material && !materials.has(material.uuid)) {
        materials.set(material.uuid, summarizeThreeMaterial(material))
      }
    }
  })
  return [...materials.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function inspectGlb(path) {
  const bytes = readFileSync(path)
  const document = parseGlbJson(bytes)
  return {
    asset: document.asset,
    extensionsUsed: [...(document.extensionsUsed ?? [])].sort(),
    extensionsRequired: [...(document.extensionsRequired ?? [])].sort(),
    materials: materialStructure(document),
    threeMaterials: await loadWithThree(bytes),
  }
}
