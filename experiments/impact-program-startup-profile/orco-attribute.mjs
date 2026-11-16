// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental source-CPU ORCO normalization/transport. No SDK admission.
const requireValid = condition => { if (!condition) throw new Error('Unproved source ORCO attribute inputs') }
import { Float32BufferAttribute } from 'three'
import { attribute, varying } from 'three/tsl'

/** Model only BKE_mesh_orco_verts_transform's finite nonzero component path.
 * Inputs must already have independent post-modifier/texspace association.
 * This does not infer ORCO ancestry from arbitrary evaluated positions. */
export function sourceCpuRawOrco(positions, location, size) {
    requireValid(positions.length % 3 === 0)
    requireValid(location.length === 3 && size.length === 3)
    const center = location.map(Math.fround), half = size.map(Math.fround)
    requireValid(center.every(Number.isFinite) && half.every(value => Number.isFinite(value) && value !== 0))
    const raw = Float32Array.from(positions, (value, index) => {
        requireValid(Number.isFinite(value))
        return Math.fround(Math.fround(Math.fround(value) - center[index % 3]) / half[index % 3])
    })
    requireValid(raw.every(Number.isFinite))
    return raw
}

/** ORCO is a Blender-dimensionless semantic coordinate, not a spatial vector:
 * do not glTF-axis-swizzle these three lanes or normalize them as normals. */
export function sourceOrcoAttribute(raw) {
    requireValid(raw instanceof Float32Array && raw.length % 3 === 0 && raw.every(Number.isFinite))
    return new Float32BufferAttribute(raw, 3, false)
}

/** EEVEE attr_load_orco transforms raw CD_ORCO in its VERTEX stage before
 * interpolation. Explicit varying prevents accidentally moving this operation
 * into fragment-position math. Native/render comparison is still required. */
export function sourceGeneratedAttribute(name = '_scenetoweb_orco') {
    return varying(attribute(name, 'vec3').mul(.5).add(.5))
}
