'use client'

// HANGAR pane — the pilot's fleet of pinned builds on paper, GitHub-pins
// style: up to HANGAR_MAX bays, each a link the server has already
// resolved into a card (GitHub repo telemetry, a site's og: meta, or a
// URL still pending). Bays use the RECORD grid's hairline recipe in
// --pf-line-soft (each owns its top+left border, the grid sits -1px so
// only the dividers show) and a fixed row anatomy — pf-micro label,
// name, two-line description, mono telemetry strip — so every bay lands
// on the same baselines whatever the card says. Ink only: the repo name
// underlines on hover instead of lighting up, language dots are ink
// squares, the DOCK button is the inverted plate. Star counts carry
// data-pf-count so the boot timeline counts them up like RANK and
// SCORE; every bay is a .pf-row, so the existing boot / tab-swap stagger
// applies with no motion code here. The pane title and `n / 6 BAYS`
// aside live in the content column's PanelHeader (paneAside); the
// owner's CUSTOMIZE toggle keeps a toolbar row of its own here.
//
// The whole bay is a stretched link: an absolute <a> under the content,
// content pointer-events-none, controls opting back in — valid HTML
// with buttons inside, and one hover state for the bay. Owners get one
// dashed EMPTY bay that turns into the dock input, plus a CUSTOMIZE
// mode where each bay grows a control row (nudge left / right, undock,
// set in flight) and the stretched link is dropped so nothing fights
// the buttons. The controls are always visible in that mode (the EDIT
// BANNER pattern) and 44px tall on phones.
//
// Writes: every action is one PATCH /api/user/profile — `pins` carries
// the full ordered list, `project_url` IS "set in flight" (the field the
// profile editor already writes; there is no separate endpoint). The
// server validates, resolves new cards and busts the profile cache; the
// pane then calls onChanged() (ProfileClient's silent refetch) and the
// resolved card replaces whatever was rendered optimistically. Bays stay
// dimmed and inert from the request until that refetch lands, so a
// stale order can never be clicked twice. The route echoes the stored
// `pins` / `project_url`, which is how a link the server dropped
// silently (cleanPins never fails a save) earns a DOCK FAILED toast
// instead of a bay that quietly disappears.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import { formatNumber, formatRelative, formatScore } from '@/components/dashboard-v2/format'
import { SocialIcon } from '@/components/leaderboard/icons'
import { toast } from '@/components/Toaster'
import { HANGAR_MAX, type HangarCard } from '@/lib/hangar/types'
import type { PublicProfileData } from '@/types/profile'
import {
  Marker,
  PATH_ARROW_UP_RIGHT,
  PATH_CHEVRON_LEFT,
  PATH_CHEVRON_RIGHT,
  PATH_FORK,
  PATH_GLOBE,
  PATH_PLUS,
  PATH_STAR,
  PATH_X,
  Stroke
} from '../parts'

/* ---------- shared class recipes ----------
   Colour classes are appended per use, never stacked, so no two
   text-/border- utilities ever compete for the same element. Inks are
   the --pf-* tokens via arbitrary values. */

const INK = 'text-[color:var(--pf-ink)]'
const INK_2 = 'text-[color:var(--pf-ink-2)]'
const INK_3 = 'text-[color:var(--pf-ink-3)]'
const HOVER_INK = 'hover:text-[color:var(--pf-ink)]'
const ENABLED_HOVER_INK = 'enabled:hover:text-[color:var(--pf-ink)]'
const PAPER_3_HOVER = 'enabled:hover:bg-[color:var(--pf-paper-3)]'

/** StatCell's hairline bay minus its colour; `relative` for the
 *  stretched link. Docked bays add BAY_EDGE, the empty one BAY_EDGE_EMPTY. */
const BAY = 'pf-row relative border-l border-t px-4 py-3.5 transition-colors sm:py-4'
const BAY_EDGE = 'border-[color:var(--pf-line-soft)]'
const BAY_EDGE_EMPTY = 'border-dashed border-[color:var(--pf-line)]'
const BAY_LABEL = 'pf-micro truncate'
const MICRO = `font-data text-[10px] tabular-nums tracking-[0.18em] sm:text-[9px] ${INK_3}`
const NAME = 'mt-2.5 truncate font-display text-[15px] font-medium leading-5'
/** Two lines of 12px / leading-relaxed (1.625) reserved so bays align. */
const DESCRIPTION = 'mt-1.5 min-h-[39px] text-[12px] leading-relaxed line-clamp-2'
const TELEMETRY = `mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-data text-[10px] tracking-[0.15em] tabular-nums sm:text-[9px] ${INK_3}`
// Keyboard focus is the sheet's one rule (dossier.css "focus": a 1px
// currentColor outline inside the box on every a / button), so no recipe
// here carries a ring of its own. INPUT is the exception the rule leaves
// alone — it inks its own frame on focus.
/** ProfileClient's META_LINK_HIT: a ≈44px phone hit area drawn by the
 *  after: box so the row height stays put; sm+ has a pointer and drops
 *  it. Needs `relative` on the element. */
const HIT_AREA = "after:absolute after:-inset-x-2 after:-inset-y-4 after:content-[''] sm:after:content-none"
/** Text buttons in the PUBLISH YOUR AGENTS → register. */
const TEXT_BTN = `relative font-data text-[10px] tracking-[0.18em] transition-colors ${HIT_AREA}`
/** 44px square on phones, 28px with a pointer. */
const ICON_BTN = `flex h-11 w-11 shrink-0 items-center justify-center transition-colors disabled:opacity-30 sm:h-7 sm:w-7 ${INK_2} ${PAPER_3_HOVER} ${ENABLED_HOVER_INK}`
// EditProfileModal's inputCls on paper, 44px tall on phones (text-base
// below sm: sub-16px inputs make iOS Safari zoom the page on focus).
const INPUT = `pf-frame h-11 w-full min-w-0 bg-[color:var(--pf-paper-3)] px-3 font-data text-base placeholder:text-[color:var(--pf-ink-3)] transition-colors focus:border-[color:var(--pf-ink)] focus:outline-none disabled:opacity-50 sm:h-9 sm:text-sm ${INK}`
const DOCK_BTN = `pf-plate flex h-11 shrink-0 items-center px-3 font-data text-[10px] font-medium tracking-[0.18em] transition-opacity enabled:hover:opacity-90 disabled:opacity-40 sm:h-9`

/** How long the bays stay inert after a successful PATCH if the refetch
 *  never hands down a new payload (refreshProfile swallows its errors). */
const SETTLE_TIMEOUT_MS = 5000

/** What a successful PATCH echoes back for the hangar fields: the pins
 *  as stored (cleanPins drops an unusable link silently, so a list no
 *  longer than the one sent means the new link did not make it) and the
 *  project_url as stored (null when the server refused it). */
interface HangarPatchResult {
  pins?: string[]
  project_url?: string | null
}

/** Whether a dock landed: the echoed list (the pins as the server
 *  stored them) must be longer than the one the new link was appended
 *  to — cleanPins drops an unusable link (private host, over-long) or a
 *  duplicate under its stricter key silently rather than fail the save.
 *  No echo at all reads as accepted; the refetch settles it either way. */
export function dockAccepted(dockedCount: number, echoedPins: string[] | undefined): boolean {
  return echoedPins === undefined || echoedPins.length > dockedCount
}

/* ---------- small helpers ---------- */

/** BAY 01 … BAY 06. */
const bayNo = (index: number) => String(index + 1).padStart(2, '0')

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

const prettyUrl = (raw: string) =>
  raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')

/** Client-side stand-in for the server's urlKey — enough to refuse an
 *  obvious duplicate before it goes out (the server dedupes for real). */
const looseKey = (url: string) => {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\.git$/i, '').replace(/\/+$/, '')
    return `${host}${path}${u.search}`.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

/** A pasted link, made submittable: scheme added when missing, must
 *  parse as http(s) with a dotted host. Null when it is not a link at
 *  all — the server applies its own (stricter) rules on top. */
function normalizeDraft(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

/** What the bay is called: owner/repo, a site's title (host when the
 *  page had none), or the bare host while a link is still resolving. */
function cardName(card: HangarCard): string {
  switch (card.kind) {
    case 'github':
      return `${card.owner}/${card.repo}`
    case 'site':
      return card.title || card.host
    case 'pending':
      return card.host
    default: {
      const exhaustive: never = card
      return exhaustive
    }
  }
}

/** Second line of the bay. GitHub falls back to the repo's homepage so a
 *  description-less repo still says something; pending shows the link
 *  itself so the owner can see what they pasted. */
function cardDescription(card: HangarCard): string | null {
  switch (card.kind) {
    case 'github':
      return card.description ?? (card.homepage ? prettyUrl(card.homepage) : null)
    case 'site':
      return card.description
    case 'pending':
      return prettyUrl(card.url)
    default: {
      const exhaustive: never = card
      return exhaustive
    }
  }
}

/* ===================================================================== */

export function HangarPane({
  profile,
  isYou,
  onChanged
}: {
  profile: PublicProfileData
  isYou: boolean
  /** Called after any successful PATCH — ProfileClient's silent refetch. */
  onChanged: () => void
}) {
  const [customizing, setCustomizing] = useState(false)
  const [docking, setDocking] = useState(false)
  const [draft, setDraft] = useState('')

  // A just-docked URL rendered as a pending bay while its PATCH is out.
  // It remembers the payload that was on screen when it was created: the
  // moment the parent hands down a fresh profile the real card (or
  // nothing, if the server rejected the pin) takes over, so the
  // placeholder can never outlive the refetch or double up with the
  // resolved card.
  const [optimistic, setOptimistic] = useState<{
    card: HangarCard
    seenWith: PublicProfileData
  } | null>(null)

  // One PATCH at a time. `sending` covers the request; `settling` holds
  // the payload that was current when the request succeeded and keeps
  // the bays inert until a different one arrives (or the timeout gives
  // up), so the old order can't be acted on twice.
  const [sending, setSending] = useState(false)
  const [settling, setSettling] = useState<PublicProfileData | null>(null)
  const sendingRef = useRef(false)
  const busy = sending || settling === profile

  useEffect(() => {
    if (settling === null) return
    if (settling !== profile) {
      setSettling(null)
      return
    }
    const t = setTimeout(() => {
      setSettling(null)
      setOptimistic(null)
    }, SETTLE_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [settling, profile])

  // A cached payload written before the field existed (≤ 60s after a
  // deploy) has no hangar at all — read it as an empty fleet.
  const docked: HangarCard[] = profile.hangar ?? []
  const cards: HangarCard[] =
    optimistic !== null && optimistic.seenWith === profile ? [...docked, optimistic.card] : docked
  const pins = docked.map((card) => card.url)
  const full = cards.length >= HANGAR_MAX
  // The NOW BUILDING project is pinned iff a bay is marked in flight.
  const unpinnedProject =
    profile.project !== null && !docked.some((card) => card.inFlight) ? profile.project : null

  /** One PATCH; resolves to the echoed hangar fields on success (so the
   *  caller can read what was actually stored) and null on any failure,
   *  which has already been toasted. */
  const patch = useCallback(
    async (body: Record<string, unknown>, failTitle: string): Promise<HangarPatchResult | null> => {
      if (sendingRef.current) return null
      sendingRef.current = true
      setSending(true)
      try {
        const res = await fetch('/api/user/profile', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || data?.success !== true) {
          toast({
            kind: 'error',
            title: failTitle,
            body: typeof data?.error === 'string' ? data.error : 'Could not update the hangar.'
          })
          return null
        }
        setSettling(profile)
        onChanged()
        return {
          pins: Array.isArray(data.pins)
            ? data.pins.filter((pin: unknown): pin is string => typeof pin === 'string')
            : undefined,
          project_url:
            'project_url' in data
              ? typeof data.project_url === 'string'
                ? data.project_url
                : null
              : undefined
        }
      } catch {
        toast({ kind: 'error', title: failTitle, body: 'Could not reach the server.' })
        return null
      } finally {
        sendingRef.current = false
        setSending(false)
      }
    },
    [onChanged, profile]
  )

  /* ---------- actions (each = one PATCH with the full pins list) ---------- */

  const dock = useCallback(
    async (url: string) => {
      if (busy || full) return
      if (pins.some((pin) => looseKey(pin) === looseKey(url))) {
        toast({ kind: 'info', title: 'ALREADY DOCKED', body: `${hostOf(url)} is in the hangar.` })
        return
      }
      const card: HangarCard = { kind: 'pending', url, host: hostOf(url), inFlight: false }
      setOptimistic({ card, seenWith: profile })
      setDocking(false)
      setDraft('')
      const result = await patch({ pins: [...pins, url] }, 'DOCK FAILED')
      // The save itself can succeed while the server drops the new link
      // (dockAccepted); without this the pending bay would simply vanish
      // on the refetch with nothing said.
      const dropped = result !== null && !dockAccepted(pins.length, result.pins)
      if (dropped) {
        toast({
          kind: 'error',
          title: 'DOCK FAILED',
          body: `${hostOf(url)} was not accepted — public http(s) links only, and a build already in the hangar can't dock twice.`
        })
      }
      if (result === null || dropped) {
        // Revert the placeholder and hand the link back for a fix.
        setOptimistic(null)
        setDraft(url)
        setDocking(true)
      }
    },
    [busy, full, patch, pins, profile]
  )

  const move = useCallback(
    (index: number, dir: -1 | 1) => {
      const target = index + dir
      if (busy || target < 0 || target >= pins.length) return
      const next = [...pins]
      ;[next[index], next[target]] = [next[target], next[index]]
      void patch({ pins: next }, 'REORDER FAILED')
    },
    [busy, patch, pins]
  )

  const undock = useCallback(
    (index: number) => {
      if (busy) return
      void patch({ pins: pins.filter((_, i) => i !== index) }, 'UNDOCK FAILED')
    },
    [busy, patch, pins]
  )

  const setInFlight = useCallback(
    async (url: string) => {
      if (busy) return
      const result = await patch({ project_url: url }, 'SET IN FLIGHT FAILED')
      // A docked pin always passes the project_url rules (same cap, same
      // sanitiser), so a null echo means the stored pin itself no longer
      // does — say so rather than let NOW BUILDING silently clear.
      if (result !== null && result.project_url === null) {
        toast({
          kind: 'error',
          title: 'SET IN FLIGHT FAILED',
          body: `${hostOf(url)} was not accepted as the build in flight.`
        })
      }
    },
    [busy, patch]
  )

  const submitDraft = (e: FormEvent) => {
    e.preventDefault()
    const url = normalizeDraft(draft)
    if (!url) {
      toast({
        kind: 'error',
        title: 'DOCK FAILED',
        body: 'Enter a full link, like https://github.com/you/repo.'
      })
      return
    }
    void dock(url)
  }

  const cancelDraft = () => {
    setDocking(false)
    setDraft('')
  }

  /* ---------- render ---------- */

  return (
    <div className="px-[var(--pf-gutter)] py-5">
      {/* owner toolbar: the title and bay count sit up in the PanelHeader */}
      {isYou && docked.length > 0 && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <span className={MICRO}>FLEET</span>
          <button
            type="button"
            onClick={() => setCustomizing((c) => !c)}
            aria-pressed={customizing}
            className={`${TEXT_BTN} ${customizing ? INK : `${INK_3} ${HOVER_INK}`}`}
          >
            {customizing ? 'DONE' : 'CUSTOMIZE'}
          </button>
        </div>
      )}

      {/* bays own their top+left hairlines; the -1px offset pushes the
          outer edge under the wrapper's clip */}
      <div className="overflow-hidden">
        <div
          aria-busy={busy}
          className={`-ml-px -mt-px grid grid-cols-1 transition-opacity duration-200 sm:grid-cols-2 ${
            busy ? 'opacity-60' : ''
          }`}
        >
          {cards.map((card, index) => (
            <Bay
              key={card.url}
              card={card}
              index={index}
              count={docked.length}
              // the optimistic placeholder is not in `pins` yet, so it
              // gets no controls even in CUSTOMIZE
              customizing={customizing && card !== optimistic?.card}
              busy={busy}
              onMove={move}
              onUndock={undock}
              onSetInFlight={setInFlight}
            />
          ))}

          {isYou && !full && (
            <EmptyBay
              index={cards.length}
              docking={docking}
              draft={draft}
              busy={busy}
              shortcut={unpinnedProject}
              onOpen={() => setDocking(true)}
              onDraft={setDraft}
              onSubmit={submitDraft}
              onCancel={cancelDraft}
              onDockShortcut={(url) => void dock(url)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ===================================================================== */

/** One docked build. Fixed rows (label / name / two-line description /
 *  telemetry, plus the control row in CUSTOMIZE) so every bay in the grid
 *  shares its baselines. Outside CUSTOMIZE the bay is one stretched link
 *  and the content ignores the pointer; in CUSTOMIZE the link goes away
 *  and only the control row takes clicks. */
function Bay({
  card,
  index,
  count,
  customizing,
  busy,
  onMove,
  onUndock,
  onSetInFlight
}: {
  card: HangarCard
  index: number
  /** Docked (server-known) bays — the bounds for the nudge buttons. */
  count: number
  customizing: boolean
  busy: boolean
  onMove: (index: number, dir: -1 | 1) => void
  onUndock: (index: number) => void
  onSetInFlight: (url: string) => void
}) {
  const linked = !customizing
  const name = cardName(card)
  const description = cardDescription(card)

  return (
    <div className={`${BAY} ${BAY_EDGE} group ${linked ? 'hover:bg-[color:var(--pf-paper-3)]' : ''}`}>
      {linked && (
        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${name} in a new tab`}
          className="absolute inset-0 z-0"
        />
      )}

      <div className="pointer-events-none relative z-10">
        {/* 1 · bay label + source cluster */}
        <div className="flex h-4 items-center justify-between gap-2">
          <span className={BAY_LABEL}>BAY {bayNo(index)}</span>
          <span className="flex shrink-0 items-center gap-2">
            {card.inFlight && <InFlightChip />}
            <SourceGlyph card={card} />
            {/* the link-out arrow: printed where there is no pointer
                (a touch screen has no hover to reveal it), and only on
                bay hover / focus where there is one — the FollowButton's
                @media (hover: hover) gate */}
            {linked && (
              <Stroke
                d={PATH_ARROW_UP_RIGHT}
                size={11}
                className={`${INK} transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100`}
              />
            )}
          </span>
        </div>

        {/* 2 · name */}
        <div className={NAME}>
          <BayName card={card} linked={linked} />
        </div>

        {/* 3 · description, two lines reserved */}
        <p className={`${DESCRIPTION} ${card.kind === 'pending' ? INK_3 : INK_2}`}>{description}</p>

        {/* 4 · telemetry */}
        <div className={TELEMETRY}>
          <Telemetry card={card} />
        </div>

        {/* 5 · CUSTOMIZE controls, always visible in that mode. Wraps:
            below sm the three 44px icon buttons leave ~120px at 320px,
            short of SET IN FLIGHT at stencil tracking, so the label takes
            its own row underneath (basis-full), right-aligned. From sm
            it sits at the end of the one row. */}
        {customizing && (
          <div className="pointer-events-auto mt-3 flex flex-wrap items-center gap-0.5 border-t border-[color:var(--pf-line-soft)] pt-2 sm:gap-1">
            <button
              type="button"
              onClick={() => onMove(index, -1)}
              disabled={busy || index === 0}
              aria-label={`Move ${name} to bay ${bayNo(index - 1)}`}
              title="Move earlier"
              className={ICON_BTN}
            >
              <Stroke d={PATH_CHEVRON_LEFT} size={13} />
            </button>
            <button
              type="button"
              onClick={() => onMove(index, 1)}
              disabled={busy || index >= count - 1}
              aria-label={`Move ${name} to bay ${bayNo(index + 1)}`}
              title="Move later"
              className={ICON_BTN}
            >
              <Stroke d={PATH_CHEVRON_RIGHT} size={13} />
            </button>
            <button
              type="button"
              onClick={() => onUndock(index)}
              disabled={busy}
              aria-label={`Undock ${name}`}
              title="Undock"
              className={ICON_BTN}
            >
              <Stroke d={PATH_X} size={12} />
            </button>
            <button
              type="button"
              onClick={() => onSetInFlight(card.url)}
              disabled={busy || card.inFlight}
              aria-label={card.inFlight ? `${name} is in flight` : `Set ${name} in flight`}
              className={`flex h-11 basis-full items-center justify-end gap-1.5 whitespace-nowrap px-2 font-data text-[10px] tracking-[0.18em] transition-colors sm:ml-auto sm:h-7 sm:basis-auto ${
                card.inFlight
                  ? `${INK} disabled:opacity-100`
                  : `${INK_3} ${PAPER_3_HOVER} ${ENABLED_HOVER_INK} disabled:opacity-30`
              }`}
            >
              <Marker hollow={!card.inFlight} />
              {card.inFlight ? 'IN FLIGHT' : 'SET IN FLIGHT'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** The one dashed bay after the docked ones (owner only, never when
 *  full). Idle it reads BAY 0N · EMPTY with the dock CTA (and a one-tap
 *  shortcut for an unpinned NOW BUILDING project); open, it is the URL
 *  form — Enter docks, Escape cancels, CANCEL for thumbs. */
function EmptyBay({
  index,
  docking,
  draft,
  busy,
  shortcut,
  onOpen,
  onDraft,
  onSubmit,
  onCancel,
  onDockShortcut
}: {
  index: number
  docking: boolean
  draft: string
  busy: boolean
  shortcut: { url: string; name: string } | null
  onOpen: () => void
  onDraft: (value: string) => void
  onSubmit: (e: FormEvent) => void
  onCancel: () => void
  onDockShortcut: (url: string) => void
}) {
  const inputId = `pf-hangar-dock-${index}`
  const free = HANGAR_MAX - index

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className={`${BAY} ${BAY_EDGE_EMPTY}`}>
      <div className="flex h-4 items-center justify-between gap-2">
        {docking ? (
          <label htmlFor={inputId} className={BAY_LABEL}>
            BAY {bayNo(index)} · DOCKING
          </label>
        ) : (
          <span className={BAY_LABEL}>BAY {bayNo(index)} · EMPTY</span>
        )}
        <Stroke d={PATH_PLUS} size={11} className={`shrink-0 ${INK_3}`} />
      </div>

      {docking ? (
        <form onSubmit={onSubmit} className="mt-2.5">
          <div className="flex items-center gap-2">
            <input
              id={inputId}
              type="url"
              inputMode="url"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="https://github.com/you/repo"
              disabled={busy}
              className={INPUT}
            />
            <button type="submit" disabled={busy || draft.trim() === ''} className={DOCK_BTN}>
              DOCK
            </button>
          </div>
          <div className={`mt-2 flex min-h-11 items-center justify-between sm:min-h-0 ${MICRO}`}>
            <span className="hidden sm:inline">ENTER DOCKS · ESC CANCELS</span>
            <button
              type="button"
              onClick={onCancel}
              className={`ml-auto flex min-h-11 items-center font-data text-[10px] tracking-[0.18em] transition-colors sm:min-h-0 ${INK_3} ${HOVER_INK}`}
            >
              CANCEL
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={onOpen}
            disabled={busy}
            className={`${NAME} flex min-h-11 w-full items-center gap-2 text-left transition-colors disabled:opacity-40 sm:min-h-0 ${INK_2} ${ENABLED_HOVER_INK}`}
          >
            <Stroke d={PATH_PLUS} size={13} className="shrink-0" />
            DOCK A BUILD
          </button>
          <p className={`${DESCRIPTION} ${INK_3}`}>
            Paste a link — a GitHub repo, a live site, anything you ship. The card fills itself in.
          </p>
          <div className={TELEMETRY}>
            {shortcut ? (
              <button
                type="button"
                onClick={() => onDockShortcut(shortcut.url)}
                disabled={busy}
                title={shortcut.url}
                className={`relative flex min-w-0 max-w-full items-center gap-1.5 transition-colors disabled:opacity-40 ${ENABLED_HOVER_INK} ${HIT_AREA}`}
              >
                <span className="shrink-0">DOCK</span>
                <span className={`truncate tracking-normal ${INK_2}`}>{shortcut.name}</span>
                <span className="shrink-0">→</span>
              </button>
            ) : (
              <span>
                {free} {free === 1 ? 'BAY' : 'BAYS'} FREE
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- bay pieces ---------- */

function InFlightChip() {
  return (
    <span className={`flex items-center gap-1 font-data text-[8px] tracking-[0.18em] ${INK}`}>
      <Marker />
      IN FLIGHT
    </span>
  )
}

/** Source mark: the octocat for GitHub, the site's favicon (globe stroke
 *  when it has none or fails to load), a dim globe while pending. The
 *  broken flag remembers WHICH src failed, so a refetch that hands down
 *  a new icon for the same bay gets a fresh try. */
function SourceGlyph({ card }: { card: HangarCard }) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)

  switch (card.kind) {
    case 'github':
      return <SocialIcon kind="github" size={12} className={INK_2} />
    case 'site': {
      const src = card.icon
      if (src && brokenSrc !== src) {
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            width={12}
            height={12}
            referrerPolicy="no-referrer"
            onError={() => setBrokenSrc(src)}
            className="h-3 w-3 object-contain grayscale"
          />
        )
      }
      return <Stroke d={PATH_GLOBE} size={12} className={INK_2} />
    }
    case 'pending':
      return <Stroke d={PATH_GLOBE} size={12} className={INK_3} />
    default: {
      const exhaustive: never = card
      return exhaustive
    }
  }
}

/** GitHub reads owner/ in the light ink and the repo in full ink — the
 *  convention people recognise instantly; sites show their title; a
 *  pending link its host. The ink part underlines on bay hover while
 *  linked (paper has no highlight colour). */
function BayName({ card, linked }: { card: HangarCard; linked: boolean }) {
  const hover = linked ? 'group-hover:underline group-hover:underline-offset-4' : ''
  switch (card.kind) {
    case 'github':
      return (
        <>
          <span className={INK_3}>{card.owner}/</span>
          <span className={`${INK} ${hover}`}>{card.repo}</span>
        </>
      )
    case 'site':
      return <span className={`${INK} ${hover}`}>{card.title || card.host}</span>
    case 'pending':
      return <span className={`${INK_2} ${hover}`}>{card.host}</span>
    default: {
      const exhaustive: never = card
      return exhaustive
    }
  }
}

/** Language marker · stars (count-up) · forks · PUSHED … / ARCHIVED for
 *  GitHub; the host for a site; RESOLVING… while pending. The language
 *  is an ink square, not GitHub's hue — the paper prints monochrome. */
function Telemetry({ card }: { card: HangarCard }) {
  switch (card.kind) {
    case 'github':
      return (
        <>
          {card.language && (
            <span className="flex items-center gap-1.5">
              <Marker style={{ color: 'var(--pf-ink-2)' }} />
              {card.language}
            </span>
          )}
          <span className="flex items-center gap-1" title={`${formatNumber(card.stars)} stars`}>
            <Stroke d={PATH_STAR} size={9} />
            <span data-pf-count={card.stars} data-pf-format="score">
              {formatScore(card.stars)}
            </span>
          </span>
          <span className="flex items-center gap-1" title={`${formatNumber(card.forks)} forks`}>
            <Stroke d={PATH_FORK} size={9} />
            {formatScore(card.forks)}
          </span>
          {card.archived ? (
            <span>ARCHIVED</span>
          ) : card.pushedAt ? (
            <span title={new Date(card.pushedAt).toLocaleString()}>
              PUSHED {formatRelative(card.pushedAt).toUpperCase()}
            </span>
          ) : null}
        </>
      )
    case 'site':
      return <span className="truncate">{card.host}</span>
    case 'pending':
      return <span>RESOLVING…</span>
    default: {
      const exhaustive: never = card
      return exhaustive
    }
  }
}
