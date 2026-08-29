import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { validateSvgAsset } from './svgAssetValidator'

const AGENTS_DIR = join(process.cwd(), 'public', 'agents')

const reason = (svg: string) => {
  const result = validateSvgAsset(svg)
  return result.ok ? null : result.reason
}

describe('pinned agent SVG assets', () => {
  const svgFiles = readdirSync(AGENTS_DIR).filter((file) => file.endsWith('.svg'))

  it('has SVG assets to gate (registry image marks ship as svg or png)', () => {
    expect(svgFiles.length).toBeGreaterThan(0)
  })

  for (const file of svgFiles) {
    it(`validates ${file}`, () => {
      const source = readFileSync(join(AGENTS_DIR, file), 'utf8')
      expect(validateSvgAsset(source)).toEqual({ ok: true })
    })
  }
})

describe('validateSvgAsset — permitted constructs', () => {
  it('accepts a minimal brand mark', () => {
    expect(
      reason('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="#09090b"/></svg>')
    ).toBeNull()
  })

  it('accepts an XML declaration and comments', () => {
    expect(
      reason('<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><!-- P shape --><path d="M0 0"/></svg>')
    ).toBeNull()
  })

  it('accepts same-document fragment references (clip paths, masks, uses)', () => {
    expect(
      reason(
        '<svg xmlns="http://www.w3.org/2000/svg">' +
          '<defs><clipPath id="c"><rect width="4" height="4"/></clipPath></defs>' +
          '<g clip-path="url(#c)"><path d="M0 0" mask="url(#m)"/></g>' +
          '<mask id="m" style="mask-type:luminance"><rect width="4" height="4" fill="white"/></mask>' +
          '<use href="#c"/>' +
          '</svg>'
      )
    ).toBeNull()
  })

  it('accepts passive media rules in style content', () => {
    expect(
      reason(
        '<svg xmlns="http://www.w3.org/2000/svg"><style>@media (prefers-color-scheme: dark) { :root { filter: none; } }</style><path d="M0 0"/></svg>'
      )
    ).toBeNull()
  })

  it('accepts a nested svg (the OpenCode identity mark wraps one)', () => {
    expect(
      reason(
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><svg viewBox="0 0 512 512" fill="none"><rect width="512" height="512" fill="#131010"></rect></svg></svg>'
      )
    ).toBeNull()
  })

  it('accepts gradients with fragment fills', () => {
    expect(
      reason(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#217BFE"/></linearGradient></defs><path d="M0 0" fill="url(#g)"/></svg>'
      )
    ).toBeNull()
  })
})

describe('validateSvgAsset — rejected constructs', () => {
  it('rejects scripts', () => {
    expect(reason('<svg xmlns="a"><script>alert(1)</script></svg>')).toMatch(/element <script>/)
  })

  it('rejects event handler attributes', () => {
    expect(reason('<svg xmlns="a"><path d="M0 0" onload="alert(1)"/></svg>')).toMatch(
      /event handler/
    )
    expect(reason('<svg xmlns="a"><rect width="1" height="1" OnClick="x()"/></svg>')).toMatch(
      /event handler/
    )
  })

  it('rejects active content elements (foreignObject, SMIL, image, filter)', () => {
    expect(reason('<svg xmlns="a"><foreignObject><div/></foreignObject></svg>')).toMatch(
      /element <foreignObject>/
    )
    expect(reason('<svg xmlns="a"><animate attributeName="x"/></svg>')).toMatch(
      /element <animate>/
    )
    expect(reason('<svg xmlns="a"><image href="#x"/></svg>')).toMatch(/element <image>/)
    expect(reason('<svg xmlns="a"><filter id="f"/></svg>')).toMatch(/element <filter>/)
  })

  it('rejects external references', () => {
    expect(reason('<svg xmlns="a"><use href="https://evil.example/x.svg#p"/></svg>')).toMatch(
      /same-document fragment/
    )
    expect(reason('<svg xmlns="a"><use xlink:href="//evil.example/x#p"/></svg>')).toMatch(
      /same-document fragment/
    )
    expect(
      reason('<svg xmlns="a"><path d="M0 0" fill="url(http://evil.example/f.svg#g)"/></svg>')
    ).toMatch(/same-document fragment/)
    expect(
      reason('<svg xmlns="a"><style>.x { fill: url("https://evil.example/g") }</style></svg>')
    ).toMatch(/same-document fragment/)
  })

  it('rejects javascript: and data: URLs, including whitespace obfuscation', () => {
    expect(reason('<svg xmlns="a"><use href="#x" style="fill:url(#j);cursor:url(java\nscript:1)"/></svg>')).not.toBeNull()
    expect(reason('<svg xmlns="a"><path d="M0 0" fill="data:image/svg+xml,x"/></svg>')).toMatch(
      /data:/
    )
  })

  it('rejects unsafe CSS imports and every non-media at-rule', () => {
    expect(
      reason('<svg xmlns="a"><style>@import url("https://evil.example/x.css");</style></svg>')
    ).toMatch(/@import/)
    expect(reason('<svg xmlns="a"><style>@font-face { src: local(x) }</style></svg>')).toMatch(
      /@font-face/
    )
    expect(reason('<svg xmlns="a"><style>@keyframes k {}</style></svg>')).toMatch(/@keyframes/)
  })

  it('rejects legacy CSS execution vectors', () => {
    expect(
      reason('<svg xmlns="a"><path d="M0 0" style="width:expression(alert(1))"/></svg>')
    ).toMatch(/expression/)
    expect(reason('<svg xmlns="a"><style>.x{behavior:url(#default#time2)}</style></svg>')).toMatch(
      /behavior/
    )
  })

  it('rejects DOCTYPEs, entities, CDATA and processing instructions', () => {
    expect(reason('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="a"/>')).toMatch(
      /markup declarations/
    )
    expect(reason('<svg xmlns="a"><title>&#106;s</title></svg>')).toMatch(/named entities/)
    expect(reason('<svg xmlns="a"><style><![CDATA[.x{}]]></style></svg>')).not.toBeNull()
    expect(reason('<svg xmlns="a"><?php echo 1 ?></svg>')).toMatch(/processing instructions/)
  })

  it('fails closed on markup it cannot positively parse', () => {
    expect(reason('')).toMatch(/empty/)
    expect(reason('<svg xmlns="a"><path d="M0 0"></svg>')).not.toBeNull()
    expect(reason('<svg xmlns="a"><path d=M0z /></svg>')).toMatch(/unparseable/)
    expect(reason('<svg xmlns="a" bareattr><path d="M0 0"/></svg>')).toMatch(/unparseable/)
    expect(reason('<div><svg xmlns="a"/></div>')).toMatch(/element <div>|root element/)
    expect(reason('<svg xmlns="a"/><svg xmlns="a"/>')).toMatch(/multiple root/)
  })

  it('rejects attributes outside the allowlist', () => {
    expect(reason('<svg xmlns="a"><path d="M0 0" ping="https://x"/></svg>')).toMatch(
      /attribute ping/
    )
  })
})
