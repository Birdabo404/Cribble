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
// Solid green-tinted hex instead of rgba: old Outlook drops alpha colors.
const ACCENT_WASH = '#0c1409'

const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
const SERIF = "Georgia, 'Times New Roman', serif"

const SUBJECT = 'your rank is unclaimed'
const PREHEADER = 'the one email we promised. thirty days.'

function renderText(code: string, joinUrl: string): string {
  return [
    'your rank is unclaimed.',
    '',
    'you asked us to ping you when the board opened. it did.',
    '',
    'claim your rank:',
    joinUrl,
    '',
    'or paste this key at login:',
    code,
    '',
    'single-use · expires in 30 days',
    '',
    '— cribble · ranking AI users, worldwide'
  ].join('\n')
}

function renderHtml(code: string, joinUrl: string): string {
  // Whitespace eaters after the preheader keep Gmail's preview from
  // pulling the eyebrow or wordmark in after the promised line.
  const preheaderPad = '&#847;&zwnj;'.repeat(48)
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="dark" />
  </head>
  <body style="margin: 0; padding: 0; background-color: ${BG};">
    <div style="display: none; overflow: hidden; visibility: hidden; mso-hide: all; max-height: 0; max-width: 0; opacity: 0; font-size: 1px; line-height: 1px; color: ${BG};">${PREHEADER}${preheaderPad}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${BG};">
      <tr>
        <td align="center" style="padding: 40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px;">
            <tr>
              <td style="font-family: ${MONO}; font-size: 10px; letter-spacing: 0.25em; color: ${FAINT};"><span style="color: ${ACCENT};">&#9679;</span>&nbsp;SEAT OPEN</td>
            </tr>
            <tr>
              <td style="padding: 16px 0 0; font-family: ${MONO}; font-size: 24px; font-weight: 600; color: #fafafa;">cribble<span style="color: ${ACCENT};">.</span></td>
            </tr>
            <tr>
              <td style="padding: 28px 0 0; font-family: ${SERIF}; font-size: 30px; line-height: 1.25; color: #fafafa;">your rank is unclaimed.</td>
            </tr>
            <tr>
              <td style="padding: 14px 0 0; font-family: ${MONO}; font-size: 14px; line-height: 1.7; color: ${MUTED};">you asked us to ping you when the board opened. it did.</td>
            </tr>
            <tr>
              <td style="padding: 28px 0 0;">
                <a href="${joinUrl}" style="display: block; text-decoration: none;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${ACCENT_WASH}; border-left: 3px solid ${ACCENT}; border-top: 1px solid ${CARD_BORDER}; border-right: 1px solid ${CARD_BORDER}; border-bottom: 1px solid ${CARD_BORDER};">
                    <tr>
                      <td style="padding: 14px 18px 6px; font-family: ${MONO}; font-size: 9px; letter-spacing: 0.3em; color: ${FAINT};">WORLDWIDE</td>
                    </tr>
                    <tr>
                      <td style="padding: 0 18px 16px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="1%" style="padding-right: 14px; font-family: ${MONO}; font-size: 16px; font-weight: 700; white-space: nowrap; color: ${ACCENT};"># &mdash;</td>
                            <td style="font-family: ${MONO}; font-size: 16px; color: ${TEXT};">you</td>
                            <td align="right" style="font-family: ${MONO}; font-size: 13px; color: ${FAINT};">unranked</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 0 0;">
                <a href="${joinUrl}" style="display: block; background-color: ${ACCENT}; color: ${BG}; font-family: ${MONO}; font-size: 14px; font-weight: 700; letter-spacing: 0.08em; text-align: center; text-decoration: none; padding: 14px 20px;">claim your rank &rarr;</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 28px 0 0; font-family: ${MONO}; font-size: 12px; color: ${FAINT};">or paste this key at login:</td>
            </tr>
            <tr>
              <td style="padding: 8px 0 0;"><span style="display: inline-block; border: 1px solid ${CARD_BORDER}; padding: 10px 14px; font-family: ${MONO}; font-size: 15px; letter-spacing: 0.12em; color: ${TEXT};">${code}</span></td>
            </tr>
            <tr>
              <td style="padding: 20px 0 0; font-family: ${MONO}; font-size: 11px; color: ${FAINT};">single-use &middot; expires in 30 days</td>
            </tr>
            <tr>
              <td style="padding: 32px 0 0;"><hr style="margin: 0; border: none; border-top: 1px solid ${CARD_BORDER};" /></td>
            </tr>
            <tr>
              <td style="padding: 16px 0 0; font-family: ${MONO}; font-size: 11px; line-height: 1.7; color: ${FAINT};">cribble &middot; ranking AI users, worldwide<br />you're getting this one-time email because you joined the waitlist.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
        subject: SUBJECT,
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
