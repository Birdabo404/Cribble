import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const launcher = read('./FeedbackLauncher.tsx')
const context = read('./FeedbackContext.tsx')
const rail = read('../nav/NavRail.tsx')
const layout = read('../../app/(app)/layout.tsx')

describe('feedback placement contract', () => {
  it('keeps desktop left-nav feedback inside the rail above theme controls', () => {
    expect(rail).toContain('<FeedbackRow />\n        <ThemeToggle variant="rail" />')
    expect(rail).toContain('aria-label="Send feedback"')
    expect(rail).toContain('aria-haspopup="dialog"')
  })

  it('removes the content-plane rail offset and hides the floating twin on md+', () => {
    expect(launcher).not.toContain('var(--nav-rail-w)')
    expect(launcher).toContain("prefs.position === 'left' ? 'md:hidden' : ''")
  })

  it('retains floating feedback for top-nav/mobile with safe-area ownership', () => {
    expect(launcher).toContain('bottom-[max(1.25rem,env(safe-area-inset-bottom))]')
    expect(launcher).toContain('left-[max(1.25rem,env(safe-area-inset-left))]')
    expect(launcher).toContain('fixed')
  })

  it('owns exactly one modal above both responsive triggers', () => {
    expect(context).toContain('{open && <FeedbackModal onClose={() => setOpen(false)} />}')
    expect(layout).toContain('<FeedbackProvider>')
    expect(launcher).not.toContain('<FeedbackModal')
    expect(rail).not.toContain('<FeedbackModal')
  })
})
