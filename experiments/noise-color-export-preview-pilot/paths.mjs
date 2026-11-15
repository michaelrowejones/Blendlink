import{realpath}from'node:fs/promises'
import{resolve}from'node:path'
/** Exact alias AND physical roots only; Node/Python publish either spelling. */
export async function allowedRoots(paths){const roots=await Promise.all(paths.map(async path=>[resolve(path),await realpath(path)]));return[...new Set(roots.flat())]}
