import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const AUDIO_ROOT = join(ROOT, 'public', 'audio')
const SOURCE_ROOT = join(ROOT, 'src')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

function publicAudioAssets(): string[] {
  return filesBelow(AUDIO_ROOT)
    .filter((path) => statSync(path).isFile())
    .map((path) => `/audio/${relative(AUDIO_ROOT, path).split(sep).join('/')}`)
    .sort()
}

function referencedAudioAssets(): string[] {
  const references = new Set<string>()
  const publicAudioUrl = /['"`]((?:\/audio\/)[^'"`?#]+)['"`]/g

  for (const path of filesBelow(SOURCE_ROOT)) {
    if (!SOURCE_EXTENSIONS.has(extname(path)) || path === __filename) continue
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(publicAudioUrl)) references.add(match[1])
  }

  return [...references].sort()
}

describe('public audio ownership', () => {
  it('keeps public audio files and source references in exact agreement', () => {
    expect(publicAudioAssets()).toEqual(referencedAudioAssets())
  })
})
