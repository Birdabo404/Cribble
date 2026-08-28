import { Resend } from 'resend'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_PAYMENT_X_HANDLE,
  BILLBOARD_PAYMENT_X_URL,
  type BillboardPlacement
} from '@/lib/billboard'

// Server-only Resend wrapper for Billboard sponsorship payment mail —
// the approval notice for the self-serve checkout flow. On approval the
// review route sends the buyer the exact ask and where to pay: the
// "pay & go live" button on their sponsorship tracker, which runs the
// checkout and activates the ad the moment payment completes. Replies
// (SPONSORSHIP_EMAIL_REPLY_TO, the founder inbox) and X DM stay open
// as backup channels for questions.
//
// The client is constructed lazily inside the send call — a top-level
// `new Resend(process.env.RESEND_API_KEY)` would throw at import time
// and break `next build` on machines with zero env configured (the
// .env.example placeholder philosophy: private config is absent, code
// fails closed at request time instead).

/** All three vars or nothing: buyers reply to this mail with questions,
 *  so without the reply-to inbox those replies would strand — it gates
 *  the send like the provider key and sender do. */
export function isSponsorshipEmailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY &&
      process.env.SPONSORSHIP_EMAIL_FROM &&
      process.env.SPONSORSHIP_EMAIL_REPLY_TO
  )
}

export interface SponsorshipPaymentEmail {
  to: string
  adId: number
  /** The approval decision timestamp (billboard_ads.reviewed_at) — the
   *  idempotency key derives from it, so a re-approve after a resubmit
   *  emails again while a retried double-approve cannot. */
  reviewedAt: string
  placement: BillboardPlacement
  /** The exact ask, named by the review route's approvedPriceLine —
   *  computed there so the pricing math never forks. */
  priceLine: string
}

export type SponsorshipEmailResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string }

// Failure text lands in the admin's approve notice — keep it short and
// free of provider payload dumps.
const ERROR_MAX = 300

function sanitizeError(name: string, message: string): string {
  return `${name}: ${message}`.slice(0, ERROR_MAX)
}

// Where the email points: the buyer's status tracker, which hosts the
// "pay & go live" checkout button. Always production — this mail only
// goes out for real approvals.
const BILLBOARD_URL = 'https://cribble.dev/sponsorship'

// Email palette: fixed dark rendering of the landing page's zinc +
// hacker-green accent. Inline styles only, no external assets — the
// lowest common denominator across email clients.
const BG = '#09090b'
const CARD_BORDER = '#27272a'
const TEXT = '#e4e4e7'
const MUTED = '#a1a1aa'
const FAINT = '#71717a'
const ACCENT = '#02fe01'

function placementLabel(placement: BillboardPlacement): string {
  switch (placement) {
    case 'flipper':
      return 'the flipper'
    case 'rail':
      return 'a profile rail slot'
    // Unreachable through the review route (leaderboard payment is
    // self-serve Polar bidding, migration 055 — the approve flow skips
    // this email for that placement), kept total for the type.
    case 'leaderboard':
      return 'the leaderboard sponsor board'
    default: {
      const exhaustive: never = placement
      return exhaustive
    }
  }
}

function renderText(placement: BillboardPlacement, priceLine: string): string {
  return [
    'cribble. — sponsorship',
    '',
    'your sponsor ad passed review. one step left: payment.',
    '',
    `the ask: ${priceLine} — ${placementLabel(placement)}, live for ${BILLBOARD_DURATION_DAYS} days once payment is confirmed.`,
    '',
    'payment is self-serve — open your sponsorship tracker and hit "pay & go live" on your ad. your ad activates automatically the moment payment completes. the checkout total includes a small processing fee on top of the listed price.',
    '',
    'pay & go live (and track your ad):',
    BILLBOARD_URL,
    '',
    `stuck or have questions? DM @${BILLBOARD_PAYMENT_X_HANDLE} on X:`,
    BILLBOARD_PAYMENT_X_URL,
    '',
    '— cribble · ranking AI users, worldwide'
  ].join('\n')
}

function renderHtml(placement: BillboardPlacement, priceLine: string): string {
  const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
  return `<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: ${BG};">
    <div style="background-color: ${BG}; padding: 40px 16px;">
      <div style="max-width: 480px; margin: 0 auto; font-family: ${mono}; color: ${TEXT};">
        <p style="margin: 0; font-size: 10px; letter-spacing: 0.25em; color: ${FAINT};">SPONSORSHIP &middot; AD APPROVED</p>
        <p style="margin: 16px 0 0; font-size: 28px; font-weight: 600; color: #fafafa;">cribble<span style="color: ${ACCENT};">.</span></p>
        <p style="margin: 24px 0 0; font-size: 14px; line-height: 1.7; color: ${MUTED};">your sponsor ad passed review. one step left: payment.</p>
        <p style="margin: 20px 0 0; display: inline-block; border: 1px solid ${CARD_BORDER}; border-radius: 6px; padding: 10px 14px; font-size: 15px; letter-spacing: 0.04em; color: ${TEXT};">${priceLine}</p>
        <p style="margin: 10px 0 0; font-size: 12px; line-height: 1.7; color: ${FAINT};">${placementLabel(placement)} &middot; live ${BILLBOARD_DURATION_DAYS} days once payment is confirmed</p>
        <p style="margin: 24px 0 0; font-size: 14px; line-height: 1.7; color: ${MUTED};">payment is self-serve &mdash; open your sponsorship tracker and hit &quot;pay &amp; go live&quot; on your ad. your ad activates automatically the moment payment completes. the checkout total includes a small processing fee on top of the listed price.</p>
        <p style="margin: 28px 0 0;">
          <a href="${BILLBOARD_URL}" style="display: inline-block; background-color: ${ACCENT}; color: ${BG}; font-family: ${mono}; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-decoration: none; padding: 12px 22px; border-radius: 6px;">pay &amp; go live &rarr;</a>
        </p>
        <p style="margin: 10px 0 0; font-size: 12px; color: ${FAINT};">the same page tracks your ad's status.</p>
        <p style="margin: 24px 0 0; font-size: 12px; color: ${FAINT};">stuck or have questions? <a href="${BILLBOARD_PAYMENT_X_URL}" style="color: ${MUTED};">DM @${BILLBOARD_PAYMENT_X_HANDLE} on X</a>.</p>
        <hr style="margin: 32px 0 0; border: none; border-top: 1px solid ${CARD_BORDER};" />
        <p style="margin: 16px 0 0; font-size: 11px; line-height: 1.7; color: ${FAINT};">cribble &middot; ranking AI users, worldwide<br />you're getting this because your sponsor ad was approved at cribble.dev/sponsorship.</p>
      </div>
    </div>
  </body>
</html>`
}

export async function sendSponsorshipPaymentEmail({
  to,
  adId,
  reviewedAt,
  placement,
  priceLine
}: SponsorshipPaymentEmail): Promise<SponsorshipEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.SPONSORSHIP_EMAIL_FROM
  const replyTo = process.env.SPONSORSHIP_EMAIL_REPLY_TO
  if (!apiKey || !from || !replyTo) {
    return { ok: false, error: 'Email delivery is not configured' }
  }

  const resend = new Resend(apiKey)

  try {
    const { data, error } = await resend.emails.send(
      {
        from,
        to,
        replyTo,
        subject: 'Your Cribble sponsorship is approved — payment details',
        html: renderHtml(placement, priceLine),
        text: renderText(placement, priceLine)
      },
      // Stable across retries of the same approval decision: Resend
      // dedupes idempotency keys for 24h, so an ambiguous failure (e.g.
      // a timeout after the provider accepted) cannot double-deliver on
      // retry. reviewed_at rides in the key so a re-approve after a
      // resubmit is a fresh decision that emails again.
      { idempotencyKey: `billboard-payment/${adId}/${reviewedAt}` }
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
