/** Build artifact gate for dsh-nga-sidebar. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanOutput } from './artifact-utils.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = join(root, 'lib')
const phase = process.argv[2] ?? 'post'

function fail(message) {
  console.error(`verify-artifacts [${phase}] FAIL: ${message}`)
  process.exit(1)
}

function listFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}

if (phase === 'pre') {
  if (existsSync(libDir)) console.error('verify-artifacts [pre] cleaning lib')
  cleanOutput(libDir)
  process.exit(0)
}

const required = ['lib/index.js', 'lib/client.js', 'lib/types/index.d.ts']
for (const path of required) {
  if (!existsSync(join(root, path))) fail(`missing artifact ${path}`)
}

const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
if (!client.includes('__ModuleLoader__.load')) {
  fail('lib/client.js lacks the window.__ModuleLoader__.load banner - loader protocol broken')
}

const scriptFiles = listFiles(libDir).filter(file => extname(file) === '.js')
for (const file of scriptFiles) {
  const source = readFileSync(file, 'utf8')
  const tsImports = source.match(/(?:from\s*|require\(\s*|import(?:\s*\(\s*|\s+))['"][^'"]+\.(?:ts|tsx|mts|cts)['"]/g) ?? []
  if (tsImports.length > 0) {
    fail(`${relative(root, file)} still contains .ts imports: ${tsImports.join(', ')}`)
  }
}

console.log(`verify-artifacts [${phase}] OK`)
