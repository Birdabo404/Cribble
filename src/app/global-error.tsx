'use client'

// Last-resort boundary — rendered when the root layout itself crashes, so it
// must supply its own <html>/<body>. globals.css and the webfonts may not be
// loaded here, so everything is inline-styled system mono.

export default function GlobalError({
  error
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          background: '#000000',
          color: '#e4e4e7',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        }}
      >
        <div style={{ padding: '0 24px' }}>
          <p style={{ margin: 0, fontSize: 10, letterSpacing: '0.4em', color: '#71717a' }}>
            <span style={{ color: '#02fe01' }}>{'// '}</span>CORE FAULT
          </p>
          <h1
            style={{
              margin: '18px 0 0',
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '0.06em'
            }}
          >
            The console hit an unrecoverable error.
          </h1>
          <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.8, color: '#a1a1aa' }}>
            Reload the deck to re-establish the link.
          </p>
          {error?.digest ? (
            <p style={{ margin: '16px 0 0', fontSize: 9, letterSpacing: '0.3em', color: '#52525b' }}>
              REF · {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 28,
              padding: '10px 22px',
              borderRadius: 6,
              border: 'none',
              background: '#ffffff',
              color: '#000000',
              fontFamily: 'inherit',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.25em',
              cursor: 'pointer'
            }}
          >
            RELOAD
          </button>
        </div>
      </body>
    </html>
  )
}
