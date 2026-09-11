import { describe, expect, it } from 'vitest'
import {
  AI_CATEGORY_LABEL,
  AI_CATEGORY_ORDER,
  AI_TOOL_META,
  aiToolMeta
} from './aiToolOrgs'
import { listToolDisplayNames } from './toolNames'

describe('listToolDisplayNames', () => {
  it('returns deduped display names including Cribble', () => {
    const names = listToolDisplayNames()

    expect(names.length).toBe(new Set(names).size)
    expect(names).toContain('Cribble')
    expect(names).toContain('ChatGPT')
  })
})

describe('AI_TOOL_META', () => {
  it('covers every resolveToolName display name except Cribble', () => {
    expect(AI_TOOL_META['Cribble']).toBeUndefined()
    for (const name of listToolDisplayNames()) {
      if (name === 'Cribble') continue
      const meta = AI_TOOL_META[name]
      expect(meta, `missing meta for ${name}`).toBeTruthy()
      expect(meta.org.trim().length, `empty org for ${name}`).toBeGreaterThan(0)
      expect(AI_CATEGORY_ORDER, `bad category for ${name}`).toContain(meta.category)
    }
  })

  it('classifies every known tool — never falls back to other', () => {
    for (const [name, meta] of Object.entries(AI_TOOL_META)) {
      expect(meta.category, `${name} is unclassified`).not.toBe('other')
    }
  })

  it('folds a lab’s sibling products onto one organization', () => {
    expect(AI_TOOL_META['ChatGPT'].org).toBe('OpenAI')
    expect(AI_TOOL_META['Sora'].org).toBe(AI_TOOL_META['ChatGPT'].org)
    expect(AI_TOOL_META['DALL·E'].org).toBe(AI_TOOL_META['ChatGPT'].org)
    expect(AI_TOOL_META['Bard'].org).toBe(AI_TOOL_META['Gemini'].org)
    expect(AI_TOOL_META['Jules'].org).toBe(AI_TOOL_META['Gemini'].org)
    expect(AI_TOOL_META['Claude Playground'].org).toBe(AI_TOOL_META['Claude'].org)
    expect(AI_TOOL_META['LMArena'].org).toBe(AI_TOOL_META['Arena'].org)
  })
})

describe('aiToolMeta', () => {
  it('returns the registry row for a known name', () => {
    expect(aiToolMeta('Claude')).toEqual({ org: 'Anthropic', category: 'chat' })
  })

  it('falls back to a dash org and other category for unknown names', () => {
    expect(aiToolMeta('Some Unknown Tool')).toEqual({ org: '—', category: 'other' })
    expect(aiToolMeta('')).toEqual({ org: '—', category: 'other' })
  })
})

describe('AI_CATEGORY_LABEL', () => {
  it('labels every category in display order, uppercase', () => {
    for (const category of AI_CATEGORY_ORDER) {
      const label = AI_CATEGORY_LABEL[category]
      expect(label, `missing label for ${category}`).toBeTruthy()
      expect(label).toBe(label.toUpperCase())
    }
  })

  it('lists other last so the fallback chip never leads', () => {
    expect(AI_CATEGORY_ORDER[AI_CATEGORY_ORDER.length - 1]).toBe('other')
    expect(new Set(AI_CATEGORY_ORDER).size).toBe(AI_CATEGORY_ORDER.length)
  })
})
