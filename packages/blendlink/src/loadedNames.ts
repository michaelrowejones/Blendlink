import type { Document, Node } from '@gltf-transform/core'

/** Exact Three PropertyBinding.sanitizeNodeName behavior used by GLTFLoader. */
export function sanitizeLoadedNodeName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[\[\]%$.:/]/g, '')
}

/**
 * Produce the readable authored-node name used by the generated API when that
 * mapping is unambiguous. Anonymous nodes are deliberately absent: depending
 * on their attachments, GLTFLoader may expose an empty name or a mesh-derived
 * implementation name. Neither is an authored binding contract. Typegen keeps
 * those nodes renderable and reports their omission. GLTFLoader's private
 * unique-name allocator also shares state with meshes, cameras, and nodes, so
 * guessing numeric suffixes is not stable across Three releases. Stable
 * `blendlink_id` extras are the runtime identity contract; sanitized authored-
 * name collisions are rejected instead of silently binding the wrong object.
 */
export function allocateLoadedNodeNames(document: Document): Map<Node, string> {
  const used = new Map<string, string>()
  const output = new Map<Node, string>()
  // GLTFLoader reserves each scene name before it requests that scene's
  // nodes. A scene/node collision therefore suffixes the node at runtime.
  // Block it up front, just like a node/node collision.
  for (const scene of document.getRoot().listScenes()) {
    const raw = scene.getName()
    if (!raw) continue
    const base = sanitizeLoadedNodeName(raw)
    if (base) used.set(base, `scene "${raw}"`)
  }
  for (const node of document.getRoot().listNodes()) {
    const raw = node.getName()
    if (!raw) continue
    const base = sanitizeLoadedNodeName(raw)
    if (!base) {
      throw new Error(
        `Blendlink cannot publish node "${raw}": Three.js sanitizes its entire name away. ` +
        'Rename it in Blender to include at least one letter or number.',
      )
    }
    const prior = used.get(base)
    if (prior !== undefined) {
      throw new Error(
        `Blendlink cannot publish ${prior} and node "${raw}": both reserve the ` +
        `sanitized Three.js name "${base}". Rename one in Blender so generated bindings stay deterministic.`,
      )
    }
    used.set(base, `node "${raw}"`)
    output.set(node, base)
  }
  return output
}
