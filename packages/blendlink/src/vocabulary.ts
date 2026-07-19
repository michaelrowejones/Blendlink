import type { BlendSidecar } from './invoke.js'

/**
 * The blendlink vocabulary: things an artist can SAY in Blender that become
 * typed, working web artifacts.
 *
 * Split per the engine-convention research: name suffixes for structural
 * verbs (Godot's collider family, Unity's _LODn), prefixes for anchor
 * empties (Unreal's SOCKET_, bound by parenting — not name-matching, which
 * kills the UCX silent-typo class), custom properties for parameterized
 * values. Matching is case-insensitive with `-`/`_` interchangeable.
 *
 * And the feature no engine ships: a lint pass. Every naming convention's
 * documented failure mode is the silent typo; a build step turns those
 * into warnings.
 */

export interface VocabularyNodeInput {
  name: string
  kind: string
  parent: string | null
  worldPosition: [number, number, number]
  worldQuaternion: [number, number, number, number]
  extras?: Record<string, unknown>
}

export interface ColliderEntry {
  name: string
  /** Mesh-derived shapes, or a primitive from an empty's display type. */
  shape: 'trimesh' | 'convex' | 'box' | 'sphere'
  /** True for -colonly/-convcolonly: hide from the render scene. */
  proxyOnly: boolean
  parent: string | null
  position: [number, number, number]
  quaternion: [number, number, number, number]
  /** Primitive size from the empty's display size (box half-extent / radius). */
  size?: number
}

export interface LodChain {
  base: string
  levels: Array<{ index: number; node: string; distance?: number }>
}

export interface AnchorEntry {
  /** Prefix-stripped name: SOCKET_Muzzle → Muzzle. */
  name: string
  node: string
  parent: string | null
  position: [number, number, number]
  quaternion: [number, number, number, number]
  extras?: Record<string, unknown>
}

export interface PhysicsEntry {
  node: string
  type: 'rigid'
  mass?: number
  friction?: number
  restitution?: number
  layer?: string
}

export interface Vocabulary {
  colliders: ColliderEntry[]
  lods: LodChain[]
  sockets: AnchorEntry[]
  hotspots: AnchorEntry[]
  audio: AnchorEntry[]
  physics: PhysicsEntry[]
  warnings: string[]
}

const COLLIDER = /[-_](conv)?col(only)?$/i
const RIGID = /[-_]rigid$/i
const LOD = /[-_]lod(\d+)$/i
const NOIMP = /[-_]noimp$/i
// Anchor prefixes are EXACT-CASE (Unreal's SOCKET_ convention): the
// case-insensitive version turned every "Socket_2way" electrical fixture
// into an anchor. Suffixes stay tolerant (their typo class is real);
// deliberate ALL-CAPS prefixes don't have that failure mode.
const SOCKET = /^SOCKET[-_](.+)$/
const HOTSPOT = /^HOTSPOT[-_](.+)$/
const AUDIO = /^AUDIO[-_](.+)$/

/** Words that look like vocabulary but don't parse — the lint targets.
 * Prefix tokens require their separator: bare "socket" fired on every
 * WallSocket/EyeSocket in a hard-surface scene. */
const NEAR_MISS = /col+only|con+vcol|^(socket|hotspot|audio)[-_]|[-_]lod[-_]?\d|[-_]noimp/i

/** Blender's duplicate auto-numbering. Godot's canonical suffix bug
 * (godot#78881) is silently ignoring "Crate-col.001"; we parse tolerantly
 * instead — the numbered stem is matched, with an info-level lint. */
const NUMBERED = /^(.+)(\.\d{3})$/

/** Explicit role property: wins over the name when both are present.
 * The escape hatch for the cases where names structurally fail — the
 * 63-byte limit, linked objects that cannot be renamed, multi-role. */
const ROLE_PROPERTY = 'blendlink_role'
const ROLE_VALUES = new Set([
  'col', 'convcol', 'colonly', 'convcolonly', 'rigid', 'noimp',
])

/** Authored parameter properties are namespaced `blendlink_*` — bare names
 * collide with other addons' ID properties, which the glTF exporter dumps
 * wholesale into extras (a real A.N.T. Landscape collision motivated this).
 * Bare names still read, with a deprecation lint, until 1.0. */
function readProp(
  node: VocabularyNodeInput,
  key: string,
  warnings: string[],
): unknown {
  const extras = node.extras
  if (!extras) return undefined
  const namespaced = extras[`blendlink_${key}`]
  if (namespaced !== undefined) return namespaced
  const bare = extras[key]
  if (bare !== undefined) {
    warnings.push(
      `${node.name}: property "${key}" should be "blendlink_${key}" — bare ` +
        `names collide with other addons' extras; bare reading goes away at 1.0.`,
    )
  }
  return bare
}

/** Effective name for suffix matching: tolerate `.NNN` duplicate numbering
 * by folding it into the base ("Crate-col.001" matches as "Crate.001-col"). */
function effectiveName(name: string): { matchName: string; dup: string } {
  const match = name.match(NUMBERED)
  if (!match) return { matchName: name, dup: '' }
  return { matchName: match[1]!, dup: match[2]! }
}

const COLLIDER_SHAPES: Record<string, { convex: boolean; proxyOnly: boolean }> = {
  col: { convex: false, proxyOnly: false },
  convcol: { convex: true, proxyOnly: false },
  colonly: { convex: false, proxyOnly: true },
  convcolonly: { convex: true, proxyOnly: true },
}

export function parseVocabulary(
  nodes: VocabularyNodeInput[],
  sidecar?: Pick<BlendSidecar, 'empties'>,
): Vocabulary {
  const emptyByName = new Map(
    (sidecar?.empties ?? []).map((empty) => [empty.name, empty]),
  )
  const vocabulary: Vocabulary = {
    colliders: [],
    lods: [],
    sockets: [],
    hotspots: [],
    audio: [],
    physics: [],
    warnings: [],
  }
  const lodGroups = new Map<string, LodChain>()

  for (const node of nodes) {
    const { matchName, dup } = effectiveName(node.name)
    if (dup && (matchName.match(COLLIDER) || RIGID.test(matchName) || LOD.test(matchName))) {
      const base = matchName.replace(COLLIDER, '').replace(RIGID, '').replace(LOD, '')
      const tag = matchName.slice(base.length)
      vocabulary.warnings.push(
        `${node.name} carries Blender duplicate numbering after its tag; ` +
          `blendlink parses it anyway, but strict engines (Godot) would not — ` +
          `consider renaming to ${base}${dup}${tag}.`,
      )
    }

    // Explicit property override: wins over the name when both are present.
    const rawRole = node.extras?.[ROLE_PROPERTY]
    let explicitRole: string | null = null
    if (typeof rawRole === 'string') {
      const normalized = rawRole.toLowerCase().trim()
      if (ROLE_VALUES.has(normalized)) {
        explicitRole = normalized
      } else {
        vocabulary.warnings.push(
          `${node.name} has ${ROLE_PROPERTY}="${rawRole}" which is not a known role ` +
            `(${[...ROLE_VALUES].join(', ')}).`,
        )
      }
    }

    // Precedence: property → anchor prefix → name suffix. A deliberate
    // ALL-CAPS prefix outranks a suffix; when both appear the ambiguity is
    // linted instead of silently resolved differently per parser (the
    // hand-mirrored era had TS and the addon disagreeing on SOCKET_Lid-col).
    if (!explicitRole) {
      const socket = node.name.match(SOCKET)
      const hotspot = node.name.match(HOTSPOT)
      const audio = node.name.match(AUDIO)
      const anchorMatch = socket ?? hotspot ?? audio
      if (anchorMatch) {
        if (COLLIDER.test(matchName) || RIGID.test(matchName) || LOD.test(matchName)) {
          vocabulary.warnings.push(
            `${node.name} carries both an anchor prefix and a name suffix — ` +
              `the prefix wins; drop one to make the intent unambiguous.`,
          )
        }
        const entry: AnchorEntry = {
          name: anchorMatch[1]!,
          node: node.name,
          parent: node.parent,
          position: node.worldPosition,
          quaternion: node.worldQuaternion,
          ...(node.extras && Object.keys(node.extras).length > 0
            ? { extras: node.extras }
            : {}),
        }
        if (socket) vocabulary.sockets.push(entry)
        else if (hotspot) vocabulary.hotspots.push(entry)
        else vocabulary.audio.push(entry)
        if (node.kind !== 'Object3D') {
          vocabulary.warnings.push(
            `${node.name} is a ${node.kind}; anchors are usually Empties — its geometry will render.`,
          )
        }
        continue
      }
    }

    const nameCollider = matchName.match(COLLIDER)
    const nameRole = nameCollider
      ? `${nameCollider[1] ? 'conv' : ''}col${nameCollider[2] ? 'only' : ''}`
      : RIGID.test(matchName)
        ? 'rigid'
        : NOIMP.test(matchName)
          ? 'noimp'
          : null
    if (explicitRole && nameRole && explicitRole !== nameRole) {
      vocabulary.warnings.push(
        `${node.name}: name says "${nameRole}" but ${ROLE_PROPERTY} says ` +
          `"${explicitRole}" — the property wins.`,
      )
    }
    const role = explicitRole ?? nameRole

    if (role && role in COLLIDER_SHAPES) {
      const { convex, proxyOnly } = COLLIDER_SHAPES[role]!
      const empty = emptyByName.get(node.name)
      const primitive = empty
        ? empty.displayType === 'SPHERE'
          ? ('sphere' as const)
          : ('box' as const)
        : null
      vocabulary.colliders.push({
        // Logical name: tag stripped, duplicate numbering preserved.
        name: nameCollider ? `${matchName.replace(COLLIDER, '')}${dup}` : node.name,
        shape: primitive ?? (convex ? 'convex' : 'trimesh'),
        proxyOnly,
        parent: node.parent,
        position: node.worldPosition,
        quaternion: node.worldQuaternion,
        ...(empty ? { size: empty.size } : {}),
      })
      continue
    }

    if (role === 'rigid') {
      const mass = readProp(node, 'mass', vocabulary.warnings)
      const friction = readProp(node, 'friction', vocabulary.warnings)
      const restitution = readProp(node, 'restitution', vocabulary.warnings)
      const layer = readProp(node, 'physics_layer', vocabulary.warnings)
      vocabulary.physics.push({
        node: node.name,
        type: 'rigid',
        ...(typeof mass === 'number' ? { mass } : {}),
        ...(typeof friction === 'number' ? { friction } : {}),
        ...(typeof restitution === 'number' ? { restitution } : {}),
        ...(typeof layer === 'string' ? { layer } : {}),
      })
      continue
    }

    if (role === 'noimp') {
      // Exporter directive; when it reaches the parser (GLB-generic flows)
      // there is nothing to remove — report so it is never silent.
      vocabulary.warnings.push(
        `${node.name} is marked noimp but is present in the GLB (the export step removes these; typegen alone cannot).`,
      )
      continue
    }

    const lod = matchName.match(LOD)
    if (lod) {
      const base = `${matchName.replace(LOD, '')}${dup}`
      const chain = lodGroups.get(base) ?? { base, levels: [] }
      const distance = readProp(node, 'lod_distance', vocabulary.warnings)
      chain.levels.push({
        index: Number(lod[1]),
        node: node.name,
        ...(typeof distance === 'number' ? { distance } : {}),
      })
      lodGroups.set(base, chain)
      continue
    }

    // Lint: name gestures at the vocabulary but didn't parse.
    if (NEAR_MISS.test(node.name)) {
      vocabulary.warnings.push(
        `${node.name} looks like a vocabulary token but did not match ` +
          `(-col/-convcol/-colonly/-convcolonly, _LODn, SOCKET_/HOTSPOT_/AUDIO_ prefix).`,
      )
    }
  }

  for (const chain of lodGroups.values()) {
    chain.levels.sort((a, b) => a.index - b.index)
    const indices = chain.levels.map((level) => level.index)
    for (let expected = 0; expected < indices.length; expected++) {
      if (indices[expected] !== expected) {
        vocabulary.warnings.push(
          `LOD chain "${chain.base}" has gaps: found levels [${indices.join(', ')}].`,
        )
        break
      }
    }
    vocabulary.lods.push(chain)
  }
  vocabulary.lods.sort((a, b) => a.base.localeCompare(b.base))

  return vocabulary
}
