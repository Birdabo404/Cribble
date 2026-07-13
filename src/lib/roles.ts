// Single source of truth for the role/status vocabulary ("what do you
// do?"). The /welcome wizard, the profile editor, the onboarding API,
// and every badge that renders a role read from this list, so adding
// or renaming a role here propagates system-wide. The users.user_type
// column deliberately carries no CHECK constraint (migration 016) —
// this module owns the vocabulary and the APIs validate against it.

export interface RoleOption {
  id: string
  /** Card label in pickers (welcome wizard, profile editor). */
  label: string
  /** One-line flavor text under the label in pickers. */
  hint: string
  /** Uppercase badge text on profiles and leaderboard cards. */
  badge: string
}

export const ROLE_OPTIONS: RoleOption[] = [
  { id: 'student', label: 'Student', hint: 'classes, papers, projects', badge: 'STUDENT' },
  { id: 'researcher', label: 'Researcher', hint: 'theses, labs, science', badge: 'RESEARCHER' },
  { id: 'developer', label: 'Developer', hint: 'shipping code daily', badge: 'DEVELOPER' },
  { id: 'designer', label: 'Designer', hint: 'pixels, vectors, taste', badge: 'DESIGNER' },
  { id: 'founder', label: 'Founder', hint: 'building a thing', badge: 'FOUNDER' },
  { id: 'product', label: 'Product', hint: 'specs to shipping', badge: 'PRODUCT' },
  { id: 'writer', label: 'Writer', hint: 'words for a living', badge: 'WRITER' },
  { id: 'other', label: 'Other', hint: 'something else cool', badge: 'EXPLORER' }
]

export const ROLE_IDS = ROLE_OPTIONS.map((r) => r.id)

/** Role id → badge text, for surfaces that only render the chip. */
export const ROLE_META: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.id, r.badge])
)

export const isRoleId = (v: unknown): v is string =>
  typeof v === 'string' && ROLE_IDS.includes(v)
