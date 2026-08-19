import type { Metadata } from 'next'
import Link from 'next/link'
import { IconCheck, IconX } from '@/components/welcome/icons'

export const metadata: Metadata = {
  title: 'Privacy Policy — Cribble',
  description:
    'How Cribble and the Cribble browser extension collect, use, retain, and delete your data. We measure time spent in AI tools — never what you say to them.'
}

const CONTACT_EMAIL = 'hello@cribble.dev'
const LAST_UPDATED = 'August 17, 2026'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-zinc-100 selection:bg-accent/20">
      <header className="px-6 pt-8">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="font-mono text-sm tracking-[0.4em] font-semibold text-zinc-100 hover:text-zinc-300 transition-colors"
          >
            CRIBBLE<span className="text-accent">.</span>
          </Link>
          <Link
            href="/"
            className="font-mono text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            ← HOME
          </Link>
        </div>
      </header>

      <main className="px-6 py-14">
        <article className="max-w-2xl mx-auto">
          <p className="font-mono text-[10px] tracking-[0.35em] text-zinc-500 uppercase">
            <span className="text-accent">Legal</span>
            <span className="mx-2 text-zinc-700">/</span>
            Privacy
          </p>
          <h1 className="mt-4 font-serif text-4xl md:text-5xl leading-[1.08] text-zinc-300">
            we count <em className="text-zinc-50">showing up</em>, not what you
            say.
          </h1>
          <p className="mt-4 text-sm text-zinc-500 leading-relaxed">
            This privacy policy covers the Cribble website at cribble.dev and
            the Cribble browser extension. Cribble measures which AI tools you
            use and for how long, and turns that into scores, streaks, and
            leaderboards. It never reads what you type, what a model says
            back, or anything else on the page.
          </p>
          <p className="mt-3 font-mono text-[10px] tracking-[0.25em] text-zinc-600 uppercase">
            Last updated {LAST_UPDATED}
          </p>

          <Section index={1} title="What the extension collects">
            <p>
              The extension watches a fixed list of known AI tool domains.
              While a tab on one of those domains is open, it records:
            </p>
            <ul className="mt-5 space-y-3">
              <CollectedItem text="Domains you visit among tracked AI tools (chatgpt.com, claude.ai, …)" />
              <CollectedItem text="Active vs idle minutes per tab" />
              <CollectedItem text="Number of visits per tool" />
              <CollectedItem text="Sync timestamps, used for streak math" />
            </ul>
            <p className="mt-5">
              Browsing anywhere outside that list is never observed or
              recorded. Collected activity is synced to your Cribble account
              and attributed to the browser it came from.
            </p>
          </Section>

          <Section index={2} title="What the extension never collects">
            <ul className="space-y-3">
              <NeverItem text="Your prompts. Ever." />
              <NeverItem text="The model's responses" />
              <NeverItem text="Your chat history or files" />
              <NeverItem text="Keystrokes, clipboard contents, or screen captures" />
            </ul>
            <p className="mt-5">
              The extension does not read, store, or transmit page content
              from any site, including the AI tools it tracks. It logs the
              session, never the conversation.
            </p>
          </Section>

          <Section index={3} title="What your account stores">
            <p>
              Signing in to cribble.dev uses OAuth through GitHub or X. We
              never see your password. Your account stores:
            </p>
            <ul className="mt-5 space-y-3">
              <CollectedItem text="Your OAuth identity: username, display name, and avatar from GitHub or X" />
              <CollectedItem text="Profile details you choose to add (role, goals, preferred tools)" />
              <CollectedItem text="Usage stats derived from extension data: scores, streaks, and ranks" />
              <CollectedItem text="Records linking your browser extension to your account" />
              <CollectedItem text="If you submit a sponsor ad: the ad content you submit and the billing email you provide for it" />
              <CollectedItem text="Your browser's timezone and a two-letter country code, used as coarse context for aggregate trends" />
            </ul>
            <p className="mt-5">
              The timezone is reported by your browser. The country code is
              derived from request metadata at the moment the extension
              syncs — the IP address it comes from is never stored.
            </p>
          </Section>

          <Section index={4} title="How your data is used">
            <p>
              Usage data exists first to compute your scores, streaks, and
              leaderboard positions. Leaderboards and profiles are visible
              to other Cribble users, so your username, avatar, and scores
              are public within the app.
            </p>
            <p className="mt-4">
              We may also publish aggregated, anonymized usage trends — for
              example, total active minutes per AI tool across all users.
              Aggregates are computed over minimum cohort sizes so they can
              never identify an individual. Because a true aggregate
              contains no individual data, aggregates computed before you
              delete your account persist after it. If you would rather not
              be counted at all, you can opt out of aggregate insights in
              settings.
            </p>
            <p className="mt-4">
              We do not sell your data, and we do not share it with third
              parties, except for the infrastructure providers (hosting and
              database services) that process it on our behalf to run
              Cribble. Cribble does show sponsor cards — clearly marked
              paid placements. They are never targeted using your personal
              data; everyone sees the same cards.
            </p>
            <p className="mt-4">
              If Cribble is ever acquired or merged into another company,
              your data transfers with it under the same commitments in this
              policy.
            </p>
          </Section>

          <Section index={5} title="Retention and deletion">
            <p>
              Your data is retained while your account is active. You can
              delete your account at any time from the in-app settings; this
              permanently removes your usage events, daily metrics, scores,
              linked devices, notifications, and sessions.
            </p>
            <p className="mt-4">
              One carve-out: anonymized aggregates already computed under
              Section 4 persist after deletion. They hold totals across many
              users, no individual rows, and nothing that can be traced back
              to you.
            </p>
            <p className="mt-4">
              Uninstalling the extension stops all collection immediately —
              nothing is gathered without it.
            </p>
          </Section>

          <Section index={6} title="Contact">
            <p>
              Questions about this policy or your data? Reach us at{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-accent hover:underline underline-offset-4"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
            <p className="mt-4">
              If this policy changes in a way that affects what we collect or
              how we use it, we will update this page and revise the date at
              the top.
            </p>
          </Section>
        </article>
      </main>

      <footer className="px-6 pb-10">
        <div className="max-w-2xl mx-auto pt-8 border-t border-zinc-900 flex items-center justify-between font-mono text-[10px] tracking-[0.3em] text-zinc-600">
          <span>CRIBBLE · 2026</span>
          <Link href="/" className="hover:text-zinc-300 transition-colors">
            CRIBBLE.DEV
          </Link>
        </div>
      </footer>
    </div>
  )
}

function Section({
  index,
  title,
  children
}: {
  index: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-14">
      <h2 className="font-mono text-[11px] tracking-[0.35em] text-zinc-400 uppercase">
        <span className="text-accent">{String(index).padStart(2, '0')}</span>
        <span className="mx-2 text-zinc-700">/</span>
        {title}
      </h2>
      <div className="mt-4 text-sm text-zinc-400 leading-relaxed">
        {children}
      </div>
    </section>
  )
}

function CollectedItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3 text-sm leading-snug text-zinc-300">
      <IconCheck size={14} className="mt-[3px] shrink-0 text-accent" />
      <span>{text}</span>
    </li>
  )
}

function NeverItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3 text-sm leading-snug text-zinc-300">
      <IconX size={14} className="mt-[3px] shrink-0 text-zinc-600" />
      <span>{text}</span>
    </li>
  )
}
