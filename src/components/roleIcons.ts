// Role id → glyph, shared by every surface that renders a role
// (profile badge, leaderboard card, welcome wizard, profile editor).
// Ids mirror ROLE_OPTIONS in src/lib/roles.ts.

import {
  IconCode,
  IconCompass,
  IconFeather,
  IconFlask,
  IconGraduationCap,
  IconPenTool,
  IconRocket,
  IconSparkles,
  type IconProps
} from '@/components/welcome/icons'

export type RoleIconComponent = (p: IconProps) => JSX.Element

export const ROLE_ICONS: Record<string, RoleIconComponent> = {
  student: IconGraduationCap,
  researcher: IconFlask,
  developer: IconCode,
  designer: IconPenTool,
  founder: IconRocket,
  product: IconCompass,
  writer: IconFeather,
  other: IconSparkles
}
