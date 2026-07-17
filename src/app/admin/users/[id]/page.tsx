'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  AdminShell,
  formatDate,
  staffChip,
  statusChip,
  type StaffMe
} from '@/components/admin/AdminShell'
import { ReasonDialog } from '@/components/admin/ReasonDialog'
import { getPlate, PLATES } from '@/lib/cosmetics/plates'

// One user's moderation dossier plus every action staff can take on
// them. Each mutation opens the reason dialog; the API enforces the
// same guardrails the UI reflects (no self-targets, owners untouchable,
// moderators only actionable by the owner), so hiding a button here is
// cosmetic — the server is the gate.

interface UserDetail {
  userId: number
  username: string | null
  display_name: string
  profile_image: string | null
  status: string
  tier: string
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

const chipCls = 'rounded border px-2 py-0.5 text-[10px] tracking-[0.2em]'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
      <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">{title}</h2>
      {children}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] tracking-[0.3em] text-zinc-600">{label}</div>
      <div className="mt-0.5 text-xs text-zinc-300">{value}</div>
    </div>
  )
}

function actionButtonCls(tone: 'danger' | 'warn' | 'good' | 'neutral'): string {
  const base = 'rounded-md border px-3 py-1.5 text-[10px] tracking-[0.2em] transition-colors disabled:cursor-not-allowed disabled:opacity-40'
  switch (tone) {
    case 'danger':
      return `${base} border-red-500/40 text-red-300 hover:bg-red-950/40`
    case 'warn':
      return `${base} border-amber-500/40 text-amber-300 hover:bg-amber-950/40`
    case 'good':
      return `${base} border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/40`
    case 'neutral':
      return `${base} border-white/15 text-zinc-300 hover:bg-white/5`
    default: {
      const exhaustive: never = tone
      return exhaustive
    }
  }
}

function AdminUserDetail({ me, userId }: { me: StaffMe; userId: number }) {
  const [user, setUser] = useState<UserDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [selectedFields, setSelectedFields] = useState<Set<ModeratableField>>(new Set())
  const [notesDraft, setNotesDraft] = useState('')
  const [plateToGrant, setPlateToGrant] = useState('')

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
              title: `BAN ${handle}`,
              description:
                'Destroys every live session, blocks future sign-ins and hides the account from all public surfaces. Reversible via unban.',
              confirmLabel: 'BAN USER',
              danger: true
            }
          case 'suspend':
            return {
              title: `SUSPEND ${handle}`,
              description:
                'Soft state: they keep access, but disappear from the leaderboard and user search until restored.',
              confirmLabel: 'SUSPEND',
              danger: true
            }
          case 'unban':
            return {
              title: `RESTORE ${handle}`,
              description: 'Sets the account back to active and lifts every restriction.',
              confirmLabel: 'RESTORE',
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
          title: `CLEAR CONTENT — ${handle}`,
          description: `Wipes: ${dialog.fields.join(', ')}. The removed values are preserved in the audit log.`,
          confirmLabel: 'CLEAR SELECTED',
          danger: true
        }
      case 'notes':
        return {
          title: `STAFF NOTES — ${handle}`,
          description: 'Replaces the internal notes on this account. Never shown publicly.',
          confirmLabel: 'SAVE NOTES',
          danger: false
        }
      case 'entitlement': {
        const action = dialog.action
        switch (action) {
          case 'grant_pro':
            return {
              title: `GRANT PRO — ${handle}`,
              description:
                'Runs the same fulfillment as a paid subscription: tier PRO, premium metadata and the welcome notification.',
              confirmLabel: 'GRANT PRO',
              danger: false
            }
          case 'revoke_pro':
            return {
              title: `REVOKE PRO — ${handle}`,
              description: 'Drops the tier back to FREE, mirroring a subscription revocation.',
              confirmLabel: 'REVOKE PRO',
              danger: true
            }
          case 'grant_plate':
            return {
              title: `GRANT PLATE — ${handle}`,
              description: `Grants "${getPlate(dialog.plateId ?? '')?.name ?? dialog.plateId}" as an admin grant (no order attached).`,
              confirmLabel: 'GRANT PLATE',
              danger: false
            }
          case 'revoke_plate':
            return {
              title: `REVOKE PLATE — ${handle}`,
              description: `Removes "${getPlate(dialog.plateId ?? '')?.name ?? dialog.plateId}" from their inventory. The audit log keeps how it was acquired.`,
              confirmLabel: 'REVOKE PLATE',
              danger: true
            }
          default: {
            const exhaustive: never = action
            return exhaustive
          }
        }
      }
      case 'staff': {
        const action = dialog.action
        switch (action) {
          case 'promote':
            return {
              title: `PROMOTE ${handle}`,
              description:
                'Grants moderator access: user moderation and the audit log. No entitlement or staff powers.',
              confirmLabel: 'PROMOTE',
              danger: false
            }
          case 'demote':
            return {
              title: `DEMOTE ${handle}`,
              description: 'Removes moderator access immediately.',
              confirmLabel: 'DEMOTE',
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

  if (loadError) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-950/20 p-5 text-sm text-red-300">
        {loadError}
      </div>
    )
  }
  if (!user) {
    return <p className="text-sm text-zinc-500 tracking-[0.2em]">LOADING…</p>
  }

  const status = statusChip(user.status)
  const staff = staffChip(user.staff_role)
  const socialsEntries = Object.entries(user.profile.socials).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0
  )

  const contentRows: { field: ModeratableField; label: string; value: string | null }[] = [
    { field: 'bio', label: 'BIO', value: user.profile.bio },
    { field: 'location', label: 'LOCATION', value: user.profile.location },
    { field: 'website', label: 'WEBSITE', value: user.profile.website },
    { field: 'banner', label: 'BANNER', value: user.profile.banner_image },
    {
      field: 'socials',
      label: 'SOCIALS',
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

  return (
    <>
      {/* identity */}
      <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          {user.profile_image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.profile_image}
              alt={user.display_name}
              className="h-14 w-14 rounded-full border border-zinc-800 object-cover"
            />
          ) : (
            <div className="h-14 w-14 rounded-full border border-zinc-800 bg-zinc-900" />
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight truncate">{user.display_name}</h1>
            <div className="text-sm text-zinc-500">
              @{user.username ?? '—'} · #{user.userId}
              {user.username && (
                <Link
                  href={`/u/${encodeURIComponent(user.username)}`}
                  className="ml-3 text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  PUBLIC PROFILE →
                </Link>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {staff && <span className={`${chipCls} ${staff.className}`}>{staff.label}</span>}
            <span className={`${chipCls} border-zinc-600/40 text-zinc-400`}>{user.tier}</span>
            <span className={`${chipCls} ${status.className}`}>{status.label}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="CREATED" value={formatDate(user.created_at)} />
          <Fact label="LAST LOGIN" value={formatDate(user.last_login)} />
          <Fact label="LAST SYNC" value={formatDate(user.last_extension_sync)} />
          <Fact label="ONBOARDED" value={user.onboarded_at ? formatDate(user.onboarded_at) : 'No'} />
          <Fact label="SCORE" value={user.total_score.toLocaleString()} />
          <Fact label="LIVE SESSIONS" value={user.active_sessions} />
          <Fact label="PRIVATE" value={user.profile.is_private ? 'Yes' : 'No'} />
          <Fact label="ROLE BADGE" value={user.role ?? '—'} />
        </div>
        {guardMessage && (
          <p className="rounded-md border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            {guardMessage}
          </p>
        )}
      </section>

      {/* moderation */}
      {actionable && (
        <Section title="MODERATION">
          <div className="flex flex-wrap items-center gap-2">
            {user.status !== 'banned' && (
              <>
                {user.status !== 'suspended' && (
                  <button
                    onClick={() => setDialog({ kind: 'status', action: 'suspend' })}
                    className={actionButtonCls('warn')}
                  >
                    SUSPEND
                  </button>
                )}
                {user.status === 'suspended' && (
                  <button
                    onClick={() => setDialog({ kind: 'status', action: 'unban' })}
                    className={actionButtonCls('good')}
                  >
                    RESTORE
                  </button>
                )}
                <button
                  onClick={() => setDialog({ kind: 'status', action: 'ban' })}
                  className={actionButtonCls('danger')}
                >
                  BAN
                </button>
              </>
            )}
            {user.status === 'banned' && (
              <button
                onClick={() => setDialog({ kind: 'status', action: 'unban' })}
                className={actionButtonCls('good')}
              >
                UNBAN
              </button>
            )}
            <span className="text-[10px] text-zinc-600">
              Ban: blocks sign-in, kills sessions, hides everywhere. Suspend: hides from
              leaderboard and search only.
            </span>
          </div>

          <div className="space-y-2 border-t border-white/5 pt-4">
            <div className="text-[9px] tracking-[0.3em] text-zinc-600">PROFILE CONTENT</div>
            {contentRows.map((row) => (
              <label
                key={row.field}
                className={`flex items-start gap-3 rounded-md px-2 py-1.5 text-xs ${
                  row.value ? 'cursor-pointer hover:bg-white/[0.03]' : 'opacity-40'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={!row.value}
                  checked={selectedFields.has(row.field)}
                  onChange={() => toggleField(row.field)}
                  className="mt-0.5 accent-red-400"
                />
                <span className="w-20 shrink-0 text-[9px] tracking-[0.25em] text-zinc-500 pt-0.5">
                  {row.label}
                </span>
                <span className="min-w-0 break-words text-zinc-300">{row.value ?? 'empty'}</span>
              </label>
            ))}
            <button
              disabled={selectedFields.size === 0}
              onClick={() => setDialog({ kind: 'moderate', fields: Array.from(selectedFields) })}
              className={actionButtonCls('danger')}
            >
              CLEAR SELECTED ({selectedFields.size})
            </button>
          </div>

          <div className="space-y-2 border-t border-white/5 pt-4">
            <div className="text-[9px] tracking-[0.3em] text-zinc-600">STAFF NOTES (INTERNAL)</div>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value.slice(0, 2000))}
              rows={3}
              placeholder="context for the next moderator…"
              className="w-full resize-none rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:border-accent/50 focus:outline-none"
            />
            <button
              disabled={notesDraft.trim() === (user.admin_notes ?? '')}
              onClick={() => setDialog({ kind: 'notes', notes: notesDraft })}
              className={actionButtonCls('neutral')}
            >
              SAVE NOTES
            </button>
          </div>
        </Section>
      )}

      {/* entitlements — owner only */}
      {actionable && me.role === 'owner' && (
        <Section title="ENTITLEMENTS (OWNER)">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400">
              Tier: <span className="text-zinc-100">{user.tier}</span>
            </span>
            {user.tier !== 'PRO' ? (
              <button
                onClick={() => setDialog({ kind: 'entitlement', action: 'grant_pro' })}
                className={actionButtonCls('good')}
              >
                GRANT PRO
              </button>
            ) : (
              <button
                onClick={() => setDialog({ kind: 'entitlement', action: 'revoke_pro' })}
                className={actionButtonCls('danger')}
              >
                REVOKE PRO
              </button>
            )}
          </div>

          <div className="space-y-2 border-t border-white/5 pt-4">
            <div className="text-[9px] tracking-[0.3em] text-zinc-600">
              OWNED PLATES ({ownedPlateIds.size})
            </div>
            {user.cosmetics.length === 0 ? (
              <p className="text-xs text-zinc-600">No cosmetics owned.</p>
            ) : (
              <ul className="space-y-1.5">
                {user.cosmetics.map((item) => (
                  <li
                    key={`${item.item_type}:${item.item_id}`}
                    className="flex flex-wrap items-center gap-2 text-xs text-zinc-300"
                  >
                    <span className="text-zinc-100">
                      {getPlate(item.item_id)?.name ?? item.item_id}
                    </span>
                    <span className="text-zinc-600">
                      via {item.acquired_via}
                      {item.source_order_id ? ` · ${item.source_order_id}` : ''}
                    </span>
                    <button
                      onClick={() =>
                        setDialog({
                          kind: 'entitlement',
                          action: 'revoke_plate',
                          plateId: item.item_id
                        })
                      }
                      className="ml-auto rounded border border-red-500/30 px-2 py-0.5 text-[9px] tracking-[0.2em] text-red-400 transition-colors hover:bg-red-950/40"
                    >
                      REVOKE
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select
                value={plateToGrant}
                onChange={(e) => setPlateToGrant(e.target.value)}
                className="rounded-md border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white focus:border-accent/50 focus:outline-none"
              >
                <option value="">select a plate…</option>
                {grantablePlates.map((plate) => (
                  <option key={plate.id} value={plate.id}>
                    {plate.name} ({plate.rarity})
                  </option>
                ))}
              </select>
              <button
                disabled={!plateToGrant}
                onClick={() =>
                  setDialog({ kind: 'entitlement', action: 'grant_plate', plateId: plateToGrant })
                }
                className={actionButtonCls('good')}
              >
                GRANT PLATE
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* staff management — owner only */}
      {me.role === 'owner' && !isSelf && user.staff_role !== 'owner' && (
        <Section title="STAFF ACCESS (OWNER)">
          <div className="flex flex-wrap items-center gap-3">
            {user.staff_role === 'moderator' ? (
              <button
                onClick={() => setDialog({ kind: 'staff', action: 'demote' })}
                className={actionButtonCls('danger')}
              >
                DEMOTE MODERATOR
              </button>
            ) : (
              <button
                onClick={() => setDialog({ kind: 'staff', action: 'promote' })}
                className={actionButtonCls('good')}
              >
                PROMOTE TO MODERATOR
              </button>
            )}
            <span className="text-[10px] text-zinc-600">
              Moderators can moderate users and read the audit log. Owners can only be changed
              via the environment allowlist or the database.
            </span>
          </div>
        </Section>
      )}

      {/* audit history */}
      <Section title={`HISTORY (${user.audit.length})`}>
        {user.audit.length === 0 ? (
          <p className="text-xs text-zinc-600">No staff actions on this user yet.</p>
        ) : (
          <ul className="space-y-3">
            {user.audit.map((entry) => (
              <li key={entry.id} className="text-xs text-zinc-400 space-y-0.5">
                <div>
                  <span className="text-zinc-600">{formatDate(entry.created_at)}</span>{' '}
                  <span className="text-zinc-200">
                    @{entry.admin_username ?? `#${entry.admin_user_id ?? '?'}`}
                  </span>{' '}
                  <span className="text-accent">{entry.action}</span>
                </div>
                {entry.reason && <div className="text-zinc-500">“{entry.reason}”</div>}
                {(entry.old_values || entry.new_values) && (
                  <div className="break-all text-[10px] text-zinc-600">
                    {entry.old_values ? `from ${JSON.stringify(entry.old_values)} ` : ''}
                    {entry.new_values ? `to ${JSON.stringify(entry.new_values)}` : ''}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

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
    </>
  )
}

export default function AdminUserPage() {
  const params = useParams<{ id: string }>()
  const userId = Number(params.id)

  return (
    <AdminShell section="USER">
      {(me) =>
        Number.isInteger(userId) && userId > 0 ? (
          <AdminUserDetail me={me} userId={userId} />
        ) : (
          <p className="text-sm text-red-400">Invalid user id.</p>
        )
      }
    </AdminShell>
  )
}
