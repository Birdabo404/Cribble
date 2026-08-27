// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { TokenAgentIcon } from './TokenAgentIcon'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean; React: typeof React }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { React: typeof React }).React = React

const roots: ReturnType<typeof createRoot>[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.textContent = ''
})

function renderIcon(agent: string, bare = false): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(<TokenAgentIcon agent={agent} size={18} bare={bare} />))
  return host
}

describe('TokenAgentIcon image marks', () => {
  it('replaces a failed image with the deterministic initial at the same dimensions', () => {
    const host = renderIcon('pi-agent')
    const image = host.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/agents/pi.svg')
    expect(image?.getAttribute('width')).toBe('18')
    expect(image?.getAttribute('height')).toBe('18')

    act(() => image?.dispatchEvent(new Event('error')))

    expect(host.querySelector('img')).toBeNull()
    const fallback = host.querySelector('[data-agent-image-fallback]')
    expect(fallback?.textContent).toBe('P')
    expect(fallback?.getAttribute('style')).toContain('width: 18px')
    expect(fallback?.getAttribute('style')).toContain('height: 18px')
  })

  it('keeps the unknown-label and Hermes paths intact', () => {
    const unknown = renderIcon('my-new-agent', true)
    expect(unknown.querySelector('img')).toBeNull()
    expect(unknown.textContent).toContain('M')

    const hermes = renderIcon('hermes-agent')
    expect(hermes.querySelector('img')?.getAttribute('src')).toBe('/agents/hermes.png')
  })
})
