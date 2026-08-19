'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  AdminAvatar,
  AdminButton,
  AdminChip,
  AdminEmpty,
  AdminFactGrid,
  AdminList,
  AdminListRow,
  AdminNotice,
  AdminSection,
  AdminSkeletonList,
  ReasonDialog,
  formatDate,
  staffChipMeta,
  statusChipMeta,
  tierChipMeta,
  useAdmin,
  type AdminChipMeta,
  type StaffMe
} from '@/components/admin'
import { TextArea } from '@/components/settings/Field'
import { Skeleton } from '@/components/settings/Skeleton'
import { getPlate, PLATES } from '@/lib/cosmetics/plates'

// One user's moderation dossier plus every action staff can take on
// them. Each mutation opens the reason dialog; the API enforces the
// same guardrails the UI reflects (no self-targets, owners untouchable,
// moderators only actionable by the owner), so hiding a button here is
// cosmetic — the server is the gate. Layout: identity header, then
// Moderation + Team review on the left and Entitlements + Staff access
// on the right (lg), with the audit history full-width below.

interface UserDetail {
  userId: number
  username: string | null
  display_name: string
  profile_image: string | null
  status: string
  tier: string
  team_review_status: string | null
  team_approved_at: string | null
  role: string | null
  staff_role: 'owner' | 'moderator' | null
  admin_notes: string | null
  created_at: string | null
  last_login: string | null
  last_extension_sync: string | null
  onboarded_at: string | null
  total_score: number
  active_sessions: number
  profile: {
    bio: string | null
    location: string | null
    website: string | null
    banner_image: string | null
    banner_animated: boolean
    equipped_plate: string | null
    is_private: boolean
    socials: Record<string, string | null>
  }
  cosmetics: {
    item_type: string
    item_id: string
    acquired_via: string
    source_order_id: string | null
    created_at: string
  }[]
  audit: {
    id: number
    admin_username: string | null
    admin_user_id: number | null
    action: string
    old_values: Record<string, unknown> | null
    new_values: Record<string, unknown> | null
    reason: string | null
    created_at: string
  }[]
}

type StatusAction = 'ban' | 'suspend' | 'unban'
type ModeratableField = 'bio' | 'location' | 'website' | 'banner' | 'socials'

type DialogSpec =
  | { kind: 'status'; action: StatusAction }
  | { kind: 'moderate'; fields: ModeratableField[] }
  | { kind: 'notes'; notes: string }
  | { kind: 'entitlement'; action: 'grant_pro' | 'revoke_pro' | 'grant_plate' | 'revoke_plate'; plateId?: string }
  | { kind: 'staff'; action: 'promote' | 'demote' }
  | { kind: 'team_reject' }

const QUIET_LINK =
  'text-[color:var(--st-text-muted)] transition-colors duration-150 hover:text-[color:var(--st-text)]'

/** Team review status → chip; not a closed union server-side, so this
 *  maps the two decided states and lets anything else read as pending. */
function teamReviewChipMeta(status: string): AdminChipMeta {
  if (status === 'approved') return { label: 'APPROVED', tone: 'good' }
  if (status === 'rejected') return { label: 'REJECTED', tone: 'danger' }
  return { label: status.toUpperCase(), tone: 'warn' }
}

/** `Overview / {current}` — the frame does not provide breadcrumbs, so
 *  the dossier renders its own above the identity panel. */
function Breadcrumb({ current }: { current: ReactNode }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-5"
    >
      <Link href="/admin" className={QUIET_LINK}>
        Overview
      </Link>
      <span aria-hidden className="text-[color:var(--st-text-faint)]">
        /
      </span>
      {current}
    </nav>
  )
}

/** Sub-heading inside a section panel (sentence case, quiet). */
function SubHeading({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h3 className="text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
      {children}
      {count !== undefined && (
        <span className="ml-2 font-data text-[11px] font-medium tabular-nums text-[color:var(--st-text-faint)]">
          {count}
        </span>
      )}
    </h3>
  )
}

/** Collapsed old/new values on a history row — JSON stays behind the
 *  disclosure instead of dumping into the line. */
function DiffDetails({
  oldValues,
  newValues
}: {
  oldValues: Record<string, unknown> | null
  newValues: Record<string, unknown> | null
}) {
  return (
    <details className="mt-1">
      <summary className="w-fit cursor-pointer select-none text-[11.5px] leading-4 text-[color:var(--st-text-muted)] transition-colors duration-150 hover:text-[color:var(--st-text)]">
        Diff
      </summary>
      <div className="mt-1.5 space-y-1.5">
        {oldValues && <DiffBlock label="Old" value={oldValues} />}
        {newValues && <DiffBlock label="New" value={newValues} />}
      </div>
    </details>
  )
}

function DiffBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  return (
    <div>
      <span className="font-data text-[10px] font-medium text-[color:var(--st-text-faint)]">
        {label}
      </span>
      <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-[color:var(--st-border)] bg-[color:var(--st-canvas)] px-2.5 py-2 font-data text-[11px] leading-4 text-[color:var(--st-text-muted)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

/** Identity-panel-shaped placeholder so the page does not jump when the
 *  dossier lands. */
function DossierSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <AdminSection>
        <div className="flex flex-wrap items-center gap-4">
          <Skeleton className="h-[52px] w-[52px] shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-44 max-w-full" />
            <Skeleton className="mt-2 h-3.5 w-56 max-w-full" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[color:var(--st-border)] pt-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index}>
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="mt-1.5 h-3.5 w-24 max-w-full" />
            </div>
          ))}
        </div>
      </AdminSection>
      <AdminSection flush>
        <AdminSkeletonList rows={4} />
      </AdminSection>
    </div>
  )
}

function AdminUserDetail({ me, userId }: { me: StaffMe; userId: number }) {
  const [user, setUser] = useState<UserDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [selectedFields, setSelectedFields] = useState<Set<ModeratableField>>(new Set())
  const [notesDraft, setNotesDraft] = useState('')
  const [plateToGrant, setPlateToGrant] = useState('')
  const [teamWorking, setTeamWorking] = useState(false)
  const [teamError, setTeamError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/users/${userId}`, { credentials: 'include' })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.user) {
      setLoadError(data?.error ?? 'Failed to load user.')
      return
    }
    const detail = data.user as UserDetail
    setUser(detail)
    setNotesDraft(detail.admin_notes ?? '')
    setSelectedFields(new Set())
    setLoadError(null)
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  const isSelf = user !== null && user.userId === me.userId
  const actionable =
    user !== null &&
    !isSelf &&
    user.staff_role !== 'owner' &&
    (user.staff_role !== 'moderator' || me.role === 'owner')

  const guardMessage = useMemo(() => {
    if (!user) return null
    if (isSelf) return 'This is your own account — staff actions are disabled.'
    if (user.staff_role === 'owner') return 'Owner accounts cannot be targeted from the panel.'
    if (user.staff_role === 'moderator' && me.role !== 'owner') {
      return 'Only the owner can act on staff accounts.'
    }
    return null
  }, [user, isSelf, me.role])

  /** Fire the mutation behind an open dialog; error string keeps it open. */
  const confirmDialog = useCallback(
    async (spec: DialogSpec, reason: string): Promise<string | null> => {
      let url: string
      let method = 'POST'
      let body: Record<string, unknown>

      switch (spec.kind) {
        case 'status':
          url = `/api/admin/users/${userId}/status`
          body = { action: spec.action, reason }
          break
        case 'moderate':
          url = `/api/admin/users/${userId}/moderate`
          body = { fields: spec.fields, reason }
          break
        case 'notes':
          url = `/api/admin/users/${userId}/notes`
          method = 'PATCH'
          body = { notes: spec.notes, reason }
          break
        case 'entitlement':
          url = `/api/admin/users/${userId}/entitlements`
          body = { action: spec.action, plateId: spec.plateId, reason }
          break
        case 'staff':
          url = '/api/admin/staff'
          body = { userId, action: spec.action, reason }
          break
        case 'team_reject':
          url = `/api/admin/teams/${userId}/review`
          body = { action: 'reject', reason }
          break
        default: {
          const exhaustive: never = spec
          return exhaustive
        }
      }

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        return data?.error ?? 'Action failed.'
      }
      await load()
      return null
    },
    [userId, load]
  )

  const dialogCopy = useMemo((): {
    title: string
    description: string
    confirmLabel: string
    danger: boolean
  } | null => {
    if (!dialog || !user) return null
    const handle = `@${user.username ?? user.userId}`
    switch (dialog.kind) {
      case 'status': {
        const action = dialog.action
        switch (action) {
          case 'ban':
            return {
              title: `Ban ${handle}`,
              description:
                'Destroys every live session, blocks future sign-ins and hides the account from all public surfaces. Reversible via unban.',
              confirmLabel: 'Ban user',
              danger: true
            }
          case 'suspend':
            return {
              title: `Suspend ${handle}`,
              description:
                'Soft state: they keep access, but disappear from the leaderboard and user search until restored.',
              confirmLabel: 'Suspend',
              danger: true
            }
          case 'unban':
            return {
              title: `Restore ${handle}`,
              description: 'Sets the account back to active and lifts every restriction.',
              confirmLabel: 'Restore',
              danger: false
            }
          default: {
            const exhaustive: never = action
            return exhaustive
          }
        }
      }
      case 'moderate':
        return {
          title: `Clear content — ${handle}`,
          description: `Wipes: ${dialog.fields.join(', ')}. The removed values are preserved in the audit log.`,
          confirmLabel: 'Clear selected',
          danger: true
        }
      case 'notes':
        return {
          title: `Staff notes — ${handle}`,
          description: 'Replaces the internal notes on this account. Never shown publicly.',
          confirmLabel: 'Save notes',
          danger: false
        }
      case 'entitlement': {
        const action = dialog.action
        switch (action) {
          case 'grant_pro':
            return {
              title: `Grant Pro — ${handle}`,
              description:
                'Runs the same fulfillment as a paid subscription: tier PRO, premium metadata and the welcome notification.',
              confirmLabel: 'Grant Pro',
              danger: false
            }
          case 'revoke_pro':
            return {
              title: `Revoke Pro — ${handle}`,
              description: 'Drops the tier back to FREE, mirroring a subscription revocation.',
              confirmLabel: 'Revoke Pro',
              danger: true
            }
          case 'grant_plate':
            return {
              title: `Grant plate — ${handle}`,
              description: `Grants "${getPlate(dialog.plateId ?? '')?.name ?? dialog.plateId}" as an admin grant (no order attached).`,
              confirmLabel: 'Grant plate',
              danger: false
            }
          case 'revoke_plate':
            return {
              title: `Revoke plate — ${handle}`,
              description: `Removes "${getPlate(dialog.plateId ?? '')?.name ?? dialog.plateId}" from their inventory. The audit log keeps how it was acquired.`,
              confirmLabel: 'Revoke plate',
              danger: true
            }
          default: {
            const exhaustive: never = action
            return exhaustive
          }
        }
      }
      case 'team_reject':
        return {
          title: `Reject team — ${handle}`,
          description:
            'Marks the team review as rejected and reverts the tier to FREE. Billing is untouched: cancel and refund the Polar subscription manually.',
          confirmLabel: 'Reject team',
          danger: true
        }
      case 'staff': {
        const action = dialog.action
        switch (action) {
          case 'promote':
            return {
              title: `Promote ${handle}`,
              description:
                'Grants moderator access: user moderation and the audit log. No entitlement or staff powers.',
              confirmLabel: 'Promote',
              danger: false
            }
          case 'demote':
            return {
              title: `Demote ${handle}`,
              description: 'Removes moderator access immediately.',
              confirmLabel: 'Demote',
              danger: true
            }
          default: {
            const exhaustive: never = action
            return exhaustive
          }
        }
      }
      default: {
        const exhaustive: never = dialog
        return exhaustive
      }
    }
  }, [dialog, user])

  // One-click approve, mirroring the /admin/teams queue (rejecting still
  // demands a written reason via the dialog).
  const approveTeam = async () => {
    if (teamWorking) return
    setTeamWorking(true)
    setTeamError(null)
    try {
      const res = await fetch(`/api/admin/teams/${userId}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Failed to approve team.')
      }
      await load()
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : 'Failed to approve team.')
    } finally {
      setTeamWorking(false)
    }
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <Breadcrumb
          current={
            <span className="font-data text-[11.5px] text-[color:var(--st-text-muted)]">
              #{userId}
            </span>
          }
        />
        <AdminNotice tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={load}
              className="font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </AdminNotice>
      </div>
    )
  }
  if (!user) {
    return (
      <div className="space-y-6">
        <Breadcrumb current={<Skeleton className="h-3.5 w-32" />} />
        <DossierSkeleton />
      </div>
    )
  }

  const status = statusChipMeta(user.status)
  const staff = staffChipMeta(user.staff_role)
  const tier = tierChipMeta(user.tier)
  const teamChip =
    user.team_review_status !== null ? teamReviewChipMeta(user.team_review_status) : null
  const socialsEntries = Object.entries(user.profile.socials).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0
  )

  const contentRows: { field: ModeratableField; label: string; value: string | null }[] = [
    { field: 'bio', label: 'Bio', value: user.profile.bio },
    { field: 'location', label: 'Location', value: user.profile.location },
    { field: 'website', label: 'Website', value: user.profile.website },
    { field: 'banner', label: 'Banner', value: user.profile.banner_image },
    {
      field: 'socials',
      label: 'Socials',
      value: socialsEntries.length
        ? socialsEntries.map(([key, value]) => `${key}: ${value}`).join(' · ')
        : null
    }
  ]

  const toggleField = (field: ModeratableField) => {
    setSelectedFields((current) => {
      const next = new Set(current)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  const ownedPlateIds = new Set(
    user.cosmetics.filter((c) => c.item_type === 'plate').map((c) => c.item_id)
  )
  const grantablePlates = PLATES.filter((plate) => !ownedPlateIds.has(plate.id))

  const moderationSection = actionable && (
    <AdminSection title="Moderation">
      <div className="space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {user.status !== 'banned' && (
              <>
                {user.status !== 'suspended' && (
                  <AdminButton
                    variant="warn"
                    onClick={() => setDialog({ kind: 'status', action: 'suspend' })}
                  >
                    Suspend
                  </AdminButton>
                )}
                {user.status === 'suspended' && (
                  <AdminButton
                    variant="good"
                    onClick={() => setDialog({ kind: 'status', action: 'unban' })}
                  >
                    Restore
                  </AdminButton>
                )}
                <AdminButton
                  variant="danger"
                  onClick={() => setDialog({ kind: 'status', action: 'ban' })}
                >
                  Ban
                </AdminButton>
              </>
            )}
            {user.status === 'banned' && (
              <AdminButton
                variant="good"
                onClick={() => setDialog({ kind: 'status', action: 'unban' })}
              >
                Unban
              </AdminButton>
            )}
          </div>
          <p className="mt-2 text-[12px] leading-4 text-[color:var(--st-text-muted)]">
            Ban blocks sign-in, kills sessions and hides the account everywhere. Suspend only
            hides them from the leaderboard and search.
          </p>
        </div>

        <div className="border-t border-[color:var(--st-border)] pt-4">
          <SubHeading>Profile content</SubHeading>
          <p className="mt-0.5 text-[12px] leading-4 text-[color:var(--st-text-muted)]">
            Select fields to wipe — the removed values are preserved in the audit log.
          </p>
          <div className="mt-2 space-y-1">
            {contentRows.map((row) => (
              <label
                key={row.field}
                className={`flex items-start gap-3 rounded-md px-2 py-1.5 text-[12.5px] leading-5 ${
                  row.value
                    ? 'cursor-pointer transition-colors duration-150 hover:bg-[color:var(--st-panel-hover)]'
                    : 'opacity-40'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={!row.value}
                  checked={selectedFields.has(row.field)}
                  onChange={() => toggleField(row.field)}
                  className="mt-1 accent-[color:var(--st-danger)]"
                />
                <span className="w-16 shrink-0 text-[12px] leading-5 text-[color:var(--st-text-muted)]">
                  {row.label}
                </span>
                <span className="min-w-0 break-words text-[color:var(--st-text)]">
                  {row.value ?? <span className="text-[color:var(--st-text-faint)]">Empty</span>}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3">
            <AdminButton
              variant="danger"
              disabled={selectedFields.size === 0}
              onClick={() => setDialog({ kind: 'moderate', fields: Array.from(selectedFields) })}
            >
              Clear selected ({selectedFields.size})
            </AdminButton>
          </div>
        </div>

        <div className="border-t border-[color:var(--st-border)] pt-4">
          <TextArea
            label="Staff notes"
            description="Internal context for the next moderator — never shown publicly."
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value.slice(0, 2000))}
            maxLength={2000}
            rows={3}
            placeholder="Context for the next moderator…"
          />
          <div className="mt-3">
            <AdminButton
              variant="primary"
              disabled={notesDraft.trim() === (user.admin_notes ?? '')}
              onClick={() => setDialog({ kind: 'notes', notes: notesDraft })}
            >
              Save notes
            </AdminButton>
          </div>
        </div>
      </div>
    </AdminSection>
  )

  // Visible whenever the account ever bought a team plan; the decision
  // buttons are owner-only shortcuts into the same API the /admin/teams
  // queue uses.
  const teamReviewSection = user.team_review_status !== null && (
    <AdminSection
      title="Team review"
      action={
        <Link href="/admin/teams" className={QUIET_LINK}>
          Review queue
        </Link>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {teamChip && <AdminChip tone={teamChip.tone}>{teamChip.label}</AdminChip>}
          {user.team_review_status === 'approved' && (
            <span className="text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
              approved{' '}
              <span className="font-data text-[11.5px]">{formatDate(user.team_approved_at)}</span>
            </span>
          )}
        </div>
        {me.role === 'owner' && actionable && (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {user.team_review_status !== 'approved' && (
                <AdminButton variant="good" pending={teamWorking} onClick={approveTeam}>
                  Approve team
                </AdminButton>
              )}
              {user.team_review_status !== 'rejected' && (
                <AdminButton
                  variant="danger"
                  disabled={teamWorking}
                  onClick={() => setDialog({ kind: 'team_reject' })}
                >
                  Reject team
                </AdminButton>
              )}
            </div>
            <p className="mt-2 text-[12px] leading-4 text-[color:var(--st-text-muted)]">
              Rejecting reverts the tier to FREE — refund the Polar subscription manually.
            </p>
          </div>
        )}
        {teamError && <AdminNotice tone="danger">{teamError}</AdminNotice>}
      </div>
    </AdminSection>
  )

  const entitlementsSection = actionable && me.role === 'owner' && (
    <AdminSection title="Entitlements" description="Owner only — grants mirror paid fulfillment.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">Tier</span>
          <AdminChip tone={tier.tone}>{tier.label}</AdminChip>
          {/* Team accounts never get the Pro buttons — their tier is owned
              by the Team review section (the API refuses grant_pro /
              revoke_pro on TEAM targets too). */}
          {user.tier === 'TEAM' ? (
            <span className="text-[12px] leading-4 text-[color:var(--st-text-muted)]">
              Team plan — managed from the Team review section.
            </span>
          ) : user.tier !== 'PRO' ? (
            <AdminButton
              variant="good"
              onClick={() => setDialog({ kind: 'entitlement', action: 'grant_pro' })}
            >
              Grant Pro
            </AdminButton>
          ) : (
            <AdminButton
              variant="danger"
              onClick={() => setDialog({ kind: 'entitlement', action: 'revoke_pro' })}
            >
              Revoke Pro
            </AdminButton>
          )}
        </div>

        <div className="border-t border-[color:var(--st-border)] pt-4">
          <SubHeading count={ownedPlateIds.size}>Owned plates</SubHeading>
          {user.cosmetics.length === 0 ? (
            <p className="mt-2 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
              No cosmetics owned.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {user.cosmetics.map((item) => (
                <li
                  key={`${item.item_type}:${item.item_id}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-5"
                >
                  <span className="text-[color:var(--st-text)]">
                    {getPlate(item.item_id)?.name ?? item.item_id}
                  </span>
                  <span className="text-[color:var(--st-text-faint)]">
                    via {item.acquired_via}
                    {item.source_order_id ? (
                      <>
                        {' · '}
                        <span className="font-data text-[11px]">{item.source_order_id}</span>
                      </>
                    ) : null}
                  </span>
                  <span className="ml-auto">
                    <AdminButton
                      variant="danger"
                      onClick={() =>
                        setDialog({
                          kind: 'entitlement',
                          action: 'revoke_plate',
                          plateId: item.item_id
                        })
                      }
                    >
                      Revoke
                    </AdminButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={plateToGrant}
              onChange={(e) => setPlateToGrant(e.target.value)}
              aria-label="Plate to grant"
              className="st-input h-11 rounded-lg px-3 text-[13px] md:h-8"
            >
              <option value="">Select a plate…</option>
              {grantablePlates.map((plate) => (
                <option key={plate.id} value={plate.id}>
                  {plate.name} ({plate.rarity})
                </option>
              ))}
            </select>
            <AdminButton
              variant="good"
              disabled={!plateToGrant}
              onClick={() =>
                setDialog({ kind: 'entitlement', action: 'grant_plate', plateId: plateToGrant })
              }
            >
              Grant plate
            </AdminButton>
          </div>
        </div>
      </div>
    </AdminSection>
  )

  const staffAccessSection = me.role === 'owner' && !isSelf && user.staff_role !== 'owner' && (
    <AdminSection title="Staff access" description="Owner only.">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {user.staff_role === 'moderator' ? (
            <AdminButton
              variant="danger"
              onClick={() => setDialog({ kind: 'staff', action: 'demote' })}
            >
              Demote moderator
            </AdminButton>
          ) : (
            <AdminButton
              variant="good"
              onClick={() => setDialog({ kind: 'staff', action: 'promote' })}
            >
              Promote to moderator
            </AdminButton>
          )}
        </div>
        <p className="text-[12px] leading-4 text-[color:var(--st-text-muted)]">
          Moderators can moderate users and read the audit log. Owners can only be changed via
          the environment allowlist or the database.
        </p>
      </div>
    </AdminSection>
  )

  return (
    <div className="space-y-6">
      <Breadcrumb
        current={
          <span className="flex min-w-0 items-baseline gap-x-1.5">
            <span className="truncate font-medium text-[color:var(--st-text)]">
              {user.display_name}
            </span>
            <span className="shrink-0 font-data text-[11.5px] text-[color:var(--st-text-muted)]">
              {user.username ? `@${user.username}` : `#${user.userId}`}
            </span>
          </span>
        }
      />

      <AdminSection>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <AdminAvatar src={user.profile_image} alt={user.display_name} size={52} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-semibold leading-6 tracking-[-0.01em] text-[color:var(--st-text)]">
              {user.display_name}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
              <span className="font-data text-[11.5px]">
                @{user.username ?? '—'} · #{user.userId}
              </span>
              {user.username && (
                <Link
                  href={`/u/${encodeURIComponent(user.username)}`}
                  className={`${QUIET_LINK} underline-offset-2 hover:underline`}
                >
                  Public profile
                </Link>
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {staff && <AdminChip tone={staff.tone}>{staff.label}</AdminChip>}
            <AdminChip tone={tier.tone}>{tier.label}</AdminChip>
            <AdminChip tone={status.tone}>{status.label}</AdminChip>
          </div>
        </div>
        <AdminFactGrid
          columns={4}
          className="mt-5 border-t border-[color:var(--st-border)] pt-4"
          facts={[
            {
              label: 'Created',
              value: <span className="font-data text-[12px]">{formatDate(user.created_at)}</span>
            },
            {
              label: 'Last login',
              value: <span className="font-data text-[12px]">{formatDate(user.last_login)}</span>
            },
            {
              label: 'Last sync',
              value: (
                <span className="font-data text-[12px]">
                  {formatDate(user.last_extension_sync)}
                </span>
              )
            },
            {
              label: 'Onboarded',
              value: user.onboarded_at ? (
                <span className="font-data text-[12px]">{formatDate(user.onboarded_at)}</span>
              ) : (
                'No'
              )
            },
            {
              label: 'Score',
              value: <span className="tabular-nums">{user.total_score.toLocaleString()}</span>
            },
            {
              label: 'Live sessions',
              value: <span className="tabular-nums">{user.active_sessions}</span>
            },
            { label: 'Private', value: user.profile.is_private ? 'Yes' : 'No' },
            { label: 'Role badge', value: user.role ?? '—' }
          ]}
        />
      </AdminSection>

      {guardMessage && <AdminNotice tone="warning">{guardMessage}</AdminNotice>}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          {moderationSection}
          {teamReviewSection}
        </div>
        <div className="min-w-0 space-y-6">
          {entitlementsSection}
          {staffAccessSection}
        </div>
      </div>

      <AdminSection title="History" count={user.audit.length} flush>
        {user.audit.length === 0 ? (
          <AdminEmpty title="No staff actions on this user yet." />
        ) : (
          <AdminList>
            {user.audit.map((entry) => (
              <AdminListRow key={entry.id}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] leading-5">
                    <span className="shrink-0 font-data text-[11px] text-[color:var(--st-text-faint)]">
                      {formatDate(entry.created_at)}
                    </span>
                    <span className="text-[color:var(--st-text-muted)]">
                      @{entry.admin_username ?? `#${entry.admin_user_id ?? '?'}`}
                    </span>
                    <span className="font-data text-[12px] font-medium text-[color:var(--st-text)]">
                      {entry.action}
                    </span>
                  </p>
                  {entry.reason && (
                    <p className="mt-0.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                      “{entry.reason}”
                    </p>
                  )}
                  {(entry.old_values || entry.new_values) && (
                    <DiffDetails oldValues={entry.old_values} newValues={entry.new_values} />
                  )}
                </div>
              </AdminListRow>
            ))}
          </AdminList>
        )}
      </AdminSection>

      {dialog && dialogCopy && (
        <ReasonDialog
          title={dialogCopy.title}
          description={dialogCopy.description}
          confirmLabel={dialogCopy.confirmLabel}
          danger={dialogCopy.danger}
          onConfirm={(reason) => confirmDialog(dialog, reason)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

export default function AdminUserPage() {
  const params = useParams<{ id: string }>()
  const userId = Number(params.id)
  const me = useAdmin()

  if (!Number.isInteger(userId) || userId <= 0) {
    return (
      <div className="space-y-6">
        <Breadcrumb
          current={<span className="text-[color:var(--st-text-muted)]">Unknown user</span>}
        />
        <AdminNotice tone="danger">Invalid user id.</AdminNotice>
      </div>
    )
  }

  return <AdminUserDetail me={me} userId={userId} />
}
