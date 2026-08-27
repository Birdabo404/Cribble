// Settings section ids, shared between the client-side modal (nav,
// context, deep-link parsing) and the server-side /settings/* redirect
// route — which is why this file must stay free of 'use client'.

export const SETTINGS_SECTION_IDS = [
  'account',
  'profile',
  'appearance',
  'notifications',
  'privacy',
  'billing'
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(value)
}
