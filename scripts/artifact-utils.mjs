import { existsSync, rmSync } from 'node:fs'

/** Remove one controlled output directory synchronously. */
export function cleanOutput(directory) {
  if (existsSync(directory)) rmSync(directory, { recursive: true, force: true })
}
