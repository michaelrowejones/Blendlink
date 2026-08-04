import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

/**
 * Publication of the artifact set Blender declares beside its temp GLB.
 *
 * Blender writes every sidecar as `<temp glb> + suffix`; publication moves
 * them onto the real GLB's name family. That rename is not bookkeeping:
 * the material-programs sidecar references its texture_ref images BY
 * BASENAME, and the runtime resolves those names against the sidecar's own
 * URL, so relocating an image without rewriting the reference publishes a
 * document that can only 404. It shipped exactly that way once — every
 * program image on the ellie showcase resolved to a 404 body whose length
 * failed the sidecar's own byte pin.
 *
 * That contract was then restated in three places (the Python writer, this
 * rewrite, and sync's verify) because nothing owned it. It lives here now:
 * `materialProgramsImageReferences` is the single reader, used both to
 * rewrite at publication and to check at verify time.
 */

/** Every image basename a material-programs sidecar references.
 *
 * Read textually rather than by parsing: a `"` inside a JSON string value
 * is escaped as `\"`, so this pattern cannot match inside embedded IR
 * content, and the sidecar never has to survive a parse-and-reserialize
 * that would perturb the Python writer's canonical float spellings, key
 * order, and ASCII escapes. Non-standard number tokens likewise never
 * reach a parser. */
export function materialProgramsImageReferences(sidecar: string): string[] {
  return [...sidecar.matchAll(/"file":"([^"\\]+)"/g)].map((match) => match[1])
}

export function renameOrCopy(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch {
    // Cross-device rename (temp dir on another volume): fall back to copy.
    writeFileSync(to, readFileSync(from))
  }
}

export interface MaterialProgramsPublication {
  path: string
  texturePaths?: string[]
  bytes: number
  hash: string
}

export interface StagedPublication {
  /** Move one declared sidecar onto the published name family. */
  relocate(tempPath: string): string
  /** Move the material-programs sidecar and its texture_ref images, rewrite
   * the sidecar's basename references to the published names, and re-pin
   * its bytes and hash — publish, then attest, exactly as the GLB does. */
  publishMaterialPrograms<T extends { path: string; texturePaths?: string[] }>(
    programs: T,
  ): T & MaterialProgramsPublication
}

export function createStagedPublication(
  { tempGlb, outPath }: { tempGlb: string; outPath: string },
): StagedPublication {
  const outBase = outPath.replace(/\.glb$/i, '')
  const stagedPrefix = resolve(tempGlb) + '.'

  const relocate = (tempPath: string): string => {
    if (!existsSync(tempPath)) {
      throw new Error(`Declared export sidecar disappeared before publication: ${tempPath}`)
    }
    if (!resolve(tempPath).startsWith(stagedPrefix)) {
      throw new Error(
        `Refusing to relocate an export sidecar outside the owned Blender output set: ${tempPath}`,
      )
    }
    const finalPath = outBase + tempPath
      .slice(tempGlb.length)
      .replace(/^\.glb/i, '')
      .replace(/^\.state\./, '.')
    renameOrCopy(tempPath, finalPath)
    return finalPath
  }

  return {
    relocate,
    publishMaterialPrograms(programs) {
      const finalPath = relocate(programs.path)
      const stagedTextures = programs.texturePaths ?? []
      if (!stagedTextures.length) {
        const payload = readFileSync(finalPath)
        return {
          ...programs,
          path: finalPath,
          bytes: payload.byteLength,
          hash: createHash('sha256').update(payload).digest('hex').slice(0, 16),
        }
      }

      const renamed = new Map<string, string>()
      const texturePaths = stagedTextures.map((tempPath) => {
        const relocated = relocate(tempPath)
        renamed.set(basename(tempPath), basename(relocated))
        return relocated
      })

      let sidecar = readFileSync(finalPath, 'utf8')
      for (const [staged, published] of renamed) {
        const search = `"file":${JSON.stringify(staged)}`
        const occurrences = sidecar.split(search).length - 1
        if (occurrences !== 1) {
          throw new Error(
            `material programs sidecar references ${staged} ${occurrences} ` +
            'times; publication expected exactly one image entry per relocated texture',
          )
        }
        sidecar = sidecar.replace(search, `"file":${JSON.stringify(published)}`)
      }

      const staleReference = materialProgramsImageReferences(sidecar)
        .find((file) => file.startsWith(`${basename(tempGlb)}.`))
      if (staleReference) {
        throw new Error(
          `material programs sidecar still references the staging name ${staleReference} ` +
          `after publication rewrote ${renamed.size} image(s)`,
        )
      }

      const payload = Buffer.from(sidecar, 'utf8')
      writeFileSync(finalPath, payload)
      return {
        ...programs,
        path: finalPath,
        texturePaths,
        bytes: payload.byteLength,
        hash: createHash('sha256').update(payload).digest('hex').slice(0, 16),
      }
    },
  }
}
