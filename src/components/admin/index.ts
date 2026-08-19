// Staff console kit. Frame/context + formatDate live in AdminShell;
// everything else is the shared primitive set for /admin pages.

export { AdminFrame, formatDate, useAdmin } from './AdminShell'
export type { StaffMe } from './AdminShell'
export { AdminPageHeader } from './AdminPageHeader'
export type { AdminPageHeaderProps } from './AdminPageHeader'
export { AdminSection } from './AdminSection'
export type { AdminSectionProps } from './AdminSection'
export { AdminButton } from './AdminButton'
export type { AdminButtonProps, AdminButtonVariant } from './AdminButton'
export {
  AdminChip,
  categoryChipMeta,
  chipToneClasses,
  staffChipMeta,
  statusChipMeta,
  tierChipMeta
} from './AdminChip'
export type { AdminChipMeta, AdminChipProps, AdminChipTone } from './AdminChip'
export { AdminEmpty } from './AdminEmpty'
export type { AdminEmptyProps } from './AdminEmpty'
export { AdminNotice } from './AdminNotice'
export type { AdminNoticeProps, AdminNoticeTone } from './AdminNotice'
export { AdminFactGrid } from './AdminFactGrid'
export type { AdminFact, AdminFactGridProps } from './AdminFactGrid'
export { AdminList, AdminListRow } from './AdminList'
export type { AdminListProps, AdminListRowProps } from './AdminList'
export { AdminTable } from './AdminTable'
export type { AdminTableColumn, AdminTableProps } from './AdminTable'
export { AdminAvatar } from './AdminAvatar'
export type { AdminAvatarProps } from './AdminAvatar'
export { AdminSkeletonList } from './AdminSkeletonList'
export type { AdminSkeletonListProps } from './AdminSkeletonList'
export { ReasonDialog } from './ReasonDialog'
