// Fail-closed validator for the pinned SVG brand assets under
// /public/agents. These files are third-party artwork committed into the
// repo, so they get a supply-chain gate: a test validates every one of
// them, and anything the validator cannot positively parse and approve is
// rejected — unknown elements, unknown attributes, or malformed markup all
// fail, rather than falling through.
//
// Permitted, because the official assets legitimately use them:
//   - same-document fragment references — url(#id), href="#id" — for
//     clip paths, masks and gradients;
//   - passive media rules — @media blocks (e.g. prefers-color-scheme)
//     whose declarations pass the same CSS checks as everything else.
//
// Rejected outright:
//   - scripts and active content (script/foreignObject/SMIL animation/
//     image/filter are simply not in the element allowlist);
//   - event handler attributes (on*);
//   - external references of any kind (non-fragment href/url(), data: and
//     javascript: URLs, DOCTYPEs and entities that could smuggle them);
//   - unsafe CSS (@import and every other at-rule besides @media,
//     expression(), behavior:, -moz-binding).

export type SvgValidationResult = { ok: true } | { ok: false; reason: string }

const fail = (reason: string): SvgValidationResult => ({ ok: false, reason })

/** Structural and shape elements the pinned brand marks may use.
 *  Case-sensitive, matching the SVG spec — <SCRIPT> is just as unknown
 *  as <script>. */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'use',
  'symbol',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'style'
])

const ALLOWED_ATTRIBUTES = new Set([
  // Document / identity
  'xmlns',
  'xmlns:xlink',
  'version',
  'id',
  'class',
  // Geometry
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'pathLength',
  'transform',
  'transform-origin',
  // Paint
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'color',
  'display',
  'visibility',
  'paint-order',
  'shape-rendering',
  'vector-effect',
  // Gradients
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  // Clip / mask
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'mask',
  'mask-type',
  'maskUnits',
  'maskContentUnits',
  // Same-document links (value still restricted to fragments below)
  'href',
  'xlink:href',
  // Inline CSS (validated by the same CSS rules as <style> content)
  'style',
  // <style> element metadata
  'type',
  'media',
  // Accessibility
  'aria-hidden',
  'role',
  'focusable'
])

/** Only the five XML named entities are allowed anywhere in the document;
 *  numeric character references could smuggle obfuscated URLs. */
const FORBIDDEN_ENTITY = /&(?!(?:amp|lt|gt|quot|apos);)/i

const CLOSE_TAG = /^<\/([A-Za-z][A-Za-z0-9:-]*)\s*>/
// Attribute values must be quoted and free of '<'; anything else fails the
// whole tag match and therefore the document.
const OPEN_TAG =
  /^<([A-Za-z][A-Za-z0-9:-]*)((?:\s+[A-Za-z][A-Za-z0-9:_-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/
const ATTRIBUTE = /([A-Za-z][A-Za-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Every url(...) in CSS or attribute values must target the document
 *  itself: url(#id), url('#id') or url("#id"). */
function urlsAreFragmentOnly(compactLower: string): boolean {
  let from = 0
  for (;;) {
    const at = compactLower.indexOf('url(', from)
    if (at === -1) return true
    const rest = compactLower.slice(at + 4)
    if (!rest.startsWith('#') && !rest.startsWith("'#") && !rest.startsWith('"#')) {
      return false
    }
    from = at + 4
  }
}

/** Shared checks for CSS bodies (<style> content, style="" values). */
function cssViolation(css: string): string | null {
  // Passive media rules only: @media is the single permitted at-rule, so
  // @import (and @charset/@namespace/@font-face/…) never gets a foothold.
  for (const match of css.matchAll(/@([A-Za-z-]*)/g)) {
    if (match[1].toLowerCase() !== 'media') {
      return `at-rule @${match[1] || '(empty)'} is not allowed`
    }
  }
  if (/expression\s*\(/i.test(css)) return 'CSS expression() is not allowed'
  if (/behavior\s*:/i.test(css)) return 'CSS behavior: is not allowed'
  if (/-moz-binding/i.test(css)) return 'CSS -moz-binding is not allowed'

  const compact = css.replace(/\s+/g, '').toLowerCase()
  if (compact.includes('javascript:')) return 'javascript: URL in CSS'
  if (compact.includes('vbscript:')) return 'vbscript: URL in CSS'
  if (compact.includes('data:')) return 'data: URL in CSS'
  if (!urlsAreFragmentOnly(compact)) {
    return 'CSS url() must reference a same-document fragment'
  }
  return null
}

/** Checks one attribute value for smuggled active content or external
 *  references, regardless of which attribute carries it. */
function valueViolation(value: string): string | null {
  const compact = value.replace(/\s+/g, '').toLowerCase()
  if (compact.includes('javascript:')) return 'javascript: URL in attribute'
  if (compact.includes('vbscript:')) return 'vbscript: URL in attribute'
  if (compact.includes('data:')) return 'data: URL in attribute'
  if (!urlsAreFragmentOnly(compact)) {
    return 'url() in attribute must reference a same-document fragment'
  }
  return null
}

export function validateSvgAsset(source: string): SvgValidationResult {
  if (typeof source !== 'string') return fail('not a string')

  let doc = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  if (doc.trim() === '') return fail('empty document')

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(doc)) {
    return fail('control characters in document')
  }

  // At most one XML declaration, at the very start.
  doc = doc.replace(/^\s*<\?xml[^<>]*\?>/, '')
  if (doc.includes('<?')) return fail('processing instructions are not allowed')

  // Comments are inert once removed; strays mean broken nesting.
  doc = doc.replace(/<!--[\s\S]*?-->/g, '')
  if (doc.includes('<!--') || doc.includes('-->')) return fail('malformed comment')

  // No DOCTYPE / CDATA / entity declarations — these are the classic
  // vectors for external references and payload smuggling.
  if (doc.includes('<!')) return fail('markup declarations are not allowed')

  if (FORBIDDEN_ENTITY.test(doc)) {
    return fail('only the five XML named entities are allowed')
  }

  const stack: string[] = []
  let rootSeen = false
  let index = 0

  while (index < doc.length) {
    const lt = doc.indexOf('<', index)

    const text = lt === -1 ? doc.slice(index) : doc.slice(index, lt)
    if (stack.length === 0 && text.trim() !== '') {
      return fail('text content outside the root element')
    }
    if (lt === -1) break

    const rest = doc.slice(lt)

    const closing = CLOSE_TAG.exec(rest)
    if (closing) {
      const open = stack.pop()
      if (open !== closing[1]) {
        return fail(`mismatched closing tag </${closing[1]}>`)
      }
      index = lt + closing[0].length
      continue
    }

    const opening = OPEN_TAG.exec(rest)
    if (!opening) return fail('unparseable tag')
    const [tag, name, attributes, selfClosing] = opening

    if (!ALLOWED_ELEMENTS.has(name)) return fail(`element <${name}> is not allowed`)
    if (stack.length === 0) {
      if (rootSeen) return fail('multiple root elements')
      if (name !== 'svg') return fail('root element must be <svg>')
      rootSeen = true
    }

    for (const attribute of attributes.matchAll(ATTRIBUTE)) {
      const attrName = attribute[1]
      const attrValue = attribute[2] ?? attribute[3] ?? ''
      if (/^on/i.test(attrName)) {
        return fail(`event handler attribute ${attrName} is not allowed`)
      }
      if (!ALLOWED_ATTRIBUTES.has(attrName)) {
        return fail(`attribute ${attrName} is not allowed`)
      }
      if (attrName === 'href' || attrName === 'xlink:href') {
        if (!attrValue.startsWith('#')) {
          return fail(`${attrName} must reference a same-document fragment`)
        }
      }
      const generic = valueViolation(attrValue)
      if (generic) return fail(generic)
      if (attrName === 'style') {
        const css = cssViolation(attrValue)
        if (css) return fail(css)
      }
      if (attrName === 'type' && attrValue.trim().toLowerCase() !== 'text/css') {
        return fail('type attribute must be text/css')
      }
    }

    index = lt + tag.length
    if (selfClosing) continue

    if (name === 'style') {
      const end = doc.indexOf('</style>', index)
      if (end === -1) return fail('unterminated <style> element')
      const css = cssViolation(doc.slice(index, end))
      if (css) return fail(css)
      index = end + '</style>'.length
      continue
    }

    stack.push(name)
  }

  if (stack.length > 0) return fail(`unclosed element <${stack[stack.length - 1]}>`)
  if (!rootSeen) return fail('no <svg> root element')
  return { ok: true }
}
