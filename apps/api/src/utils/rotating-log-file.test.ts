import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RotatingLogFile } from './rotating-log-file.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function createDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'weshop-log-test-'))
  directories.push(directory)
  return directory
}

describe('rotatingLogFile', () => {
  it('按大小轮转并限制保留文件数', async () => {
    const directory = createDirectory()
    const writer = new RotatingLogFile({ directory, maxBytes: 20, maxFiles: 3 })

    writer.write(`${'a'.repeat(12)}\n`)
    writer.write(`${'b'.repeat(12)}\n`)
    writer.write(`${'c'.repeat(12)}\n`)
    await writer.close()

    expect(readdirSync(directory).sort()).toEqual(['api.log', 'api.log.1', 'api.log.2'])
    expect(readFileSync(path.join(directory, 'api.log'), 'utf8')).toBe(`${'c'.repeat(12)}\n`)
    expect(readFileSync(path.join(directory, 'api.log.1'), 'utf8')).toBe(`${'b'.repeat(12)}\n`)
    expect(readFileSync(path.join(directory, 'api.log.2'), 'utf8')).toBe(`${'a'.repeat(12)}\n`)
  })
})
