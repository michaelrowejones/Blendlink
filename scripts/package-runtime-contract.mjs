import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { join, resolve } from 'node:path'
import ts from 'typescript'

/** Check the extracted artifact, even when a test's parent node_modules could
 * otherwise supply undeclared imports. Includes literal dynamic imports. */
export function verifyPackedRuntimeImports(packageRoot) {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const declared = new Set([
    pkg.name,
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ])
  function visitDirectory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) { visitDirectory(file); continue }
      if (!entry.name.endsWith('.js')) continue
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
      function check(specifier) {
        if (isBuiltin(specifier)) return
        if (specifier.startsWith('.')) {
          if (!existsSync(resolve(directory, specifier))) {
            throw new Error(`Packed runtime import ${specifier} is missing, imported by ${file}`)
          }
          return
        }
        const dependency = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
        if (!declared.has(dependency)) {
          throw new Error(`Packed runtime imports undeclared dependency ${dependency} from ${file}`)
        }
      }
      function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          check(node.moduleSpecifier.text)
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          check(node.arguments[0].text)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  visitDirectory(join(packageRoot, 'dist'))
}
