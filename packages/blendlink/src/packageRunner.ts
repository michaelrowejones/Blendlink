import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface PackageManagerDeclaration {
  packageManager?: string
}

/** Resolve the command prefix used to run a package.json script.
 *
 * Keep this module dependency-free: project setup needs the answer before a
 * website has installed Blendlink's compiler toolchain.
 */
export function websitePackageRunner(
  root: string,
  packageJson: PackageManagerDeclaration,
): string {
  const declared = packageJson.packageManager?.split('@')[0]
  if (declared === 'pnpm') return 'pnpm'
  if (declared === 'yarn') return 'yarn'
  if (declared === 'bun') return 'bun run'
  if (declared === 'npm') return 'npm run'
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun run'
  return 'npm run'
}
