// JSON-LD structured data (schema.org), rendered from server components.
// `<` is escaped so user-controlled strings (bios, usernames) cannot
// break out of the script tag.
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c')
      }}
    />
  )
}
