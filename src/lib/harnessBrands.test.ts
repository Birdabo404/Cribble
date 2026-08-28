import { describe, expect, it } from 'vitest'
import { harnessBrandForLabel } from './harnessBrands'

describe('harness brand registry', () => {
  it('resolves the official Pi and OpenCode image marks', () => {
    expect(harnessBrandForLabel('Pi')).toMatchObject({
      label: 'Pi',
      imageSrc: '/agents/pi.svg'
    })
    expect(harnessBrandForLabel('OpenCode')).toMatchObject({
      label: 'OpenCode',
      imageSrc: '/agents/opencode.svg'
    })
  })

  it('preserves Hermes and leaves unknown labels unregistered', () => {
    expect(harnessBrandForLabel('Hermes')).toMatchObject({
      label: 'Hermes',
      imageSrc: '/agents/hermes.png'
    })
    expect(harnessBrandForLabel('My New Agent')).toBeNull()
  })
})
