import { Resend } from 'resend'

// Server-only Resend wrapper for waitlist beta invites.
//
// The client is constructed lazily inside the send call — a top-level
// `new Resend(process.env.RESEND_API_KEY)` would throw at import time
// and break `next build` on machines with zero env configured (the
// .env.example placeholder philosophy: private config is absent, code
// fails closed at request time instead).

export function isInviteEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.INVITE_EMAIL_FROM)
}

export interface WaitlistInviteEmail {
  to: string
  code: string
  joinUrl: string
  waitlistId: string
}

export type InviteEmailResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string }

// Failure text is persisted to waitlist_invites.last_error and shown in
// the admin queue — keep it short and free of provider payload dumps.
const ERROR_MAX = 300

function sanitizeError(name: string, message: string): string {
  return `${name}: ${message}`.slice(0, ERROR_MAX)
}

// Email palette: fixed dark rendering of the landing page's zinc +
// hacker-green accent. Inline styles only, no external assets — the
// lowest common denominator across email clients.
const BG = '#09090b'
const CARD_BORDER = '#27272a'
const TEXT = '#e4e4e7'
const MUTED = '#a1a1aa'
const FAINT = '#71717a'
const ACCENT = '#02fe01'

function renderText(code: string, joinUrl: string): string {
  return [
    'cribble. — private beta',
    '',
    'you joined the waitlist. this is the one email we promised:',
    'the gates are open.',
    '',
    'accept your invite:',
    joinUrl,
    '',
    'or paste this code at login:',
    code,
    '',
    'single-use · expires in 30 days',
    '',
    '— cribble · ranking AI users, worldwide'
  ].join('\n')
}

function renderHtml(code: string, joinUrl: string): string {
  const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
  return `<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: ${BG};">
    <div style="background-color: ${BG}; padding: 40px 16px;">
      <div style="max-width: 480px; margin: 0 auto; font-family: ${mono}; color: ${TEXT};">
        <p style="margin: 0; font-size: 10px; letter-spacing: 0.25em; color: ${FAINT};">PRIVATE BETA &middot; INVITE-ONLY</p>
        <p style="margin: 16px 0 0; font-size: 28px; font-weight: 600; color: #fafafa;">cribble<span style="color: ${ACCENT};">.</span></p>
        <p style="margin: 24px 0 0; font-size: 14px; line-height: 1.7; color: ${MUTED};">you joined the waitlist. this is the one email we promised: the gates are open.</p>
        <p style="margin: 28px 0 0;">
          <a href="${joinUrl}" style="display: inline-block; background-color: ${ACCENT}; color: ${BG}; font-family: ${mono}; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-decoration: none; padding: 12px 22px; border-radius: 6px;">accept invite &rarr;</a>
        </p>
        <p style="margin: 28px 0 0; font-size: 12px; color: ${FAINT};">or paste this code at login:</p>
        <p style="margin: 8px 0 0; display: inline-block; border: 1px solid ${CARD_BORDER}; border-radius: 6px; padding: 10px 14px; font-size: 15px; letter-spacing: 0.12em; color: ${TEXT};">${code}</p>
        <p style="margin: 24px 0 0; font-size: 11px; color: ${FAINT};">single-use &middot; expires in 30 days</p>
        <hr style="margin: 32px 0 0; border: none; border-top: 1px solid ${CARD_BORDER};" />
        <p style="margin: 16px 0 0; font-size: 11px; line-height: 1.7; color: ${FAINT};">cribble &middot; ranking AI users, worldwide<br />you're getting this one-time email because you joined the waitlist.</p>
      </div>
    </div>
  </body>
</html>`
}

export async function sendWaitlistInviteEmail({
  to,
  code,
  joinUrl,
  waitlistId
}: WaitlistInviteEmail): Promise<InviteEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.INVITE_EMAIL_FROM
  if (!apiKey || !from) {
    return { ok: false, error: 'Email delivery is not configured' }
  }

  const resend = new Resend(apiKey)

  try {
    const { data, error } = await resend.emails.send(
      {
        from,
        to,
        subject: 'Your Cribble beta invite',
        html: renderHtml(code, joinUrl),
        text: renderText(code, joinUrl)
      },
      // Stable across retries of the same waitlist entry: Resend dedupes
      // idempotency keys for 24h, so an ambiguous failure (e.g. a timeout
      // after the provider accepted) cannot double-deliver on retry.
      { idempotencyKey: `waitlist-invite/${waitlistId}` }
    )

    if (error) {
      return { ok: false, error: sanitizeError(error.name, error.message) }
    }
    return { ok: true, messageId: data?.id ?? null }
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error'
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: sanitizeError(name, message) }
  }
}
