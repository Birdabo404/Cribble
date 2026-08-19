'use client'

// Shared avatar for queues and dossiers. Remote profile images come from
// arbitrary hosts, so this stays a plain <img> like the rest of the admin
// surface; the empty state is a quiet --st-panel-hover disc.

export interface AdminAvatarProps {
  src: string | null
  alt: string
  /** Pixel size (width = height). */
  size?: number
}

export function AdminAvatar({ src, alt, size = 32 }: AdminAvatarProps) {
  const box = { width: size, height: size }
  if (!src) {
    return (
      <span
        aria-hidden
        style={box}
        className="block shrink-0 rounded-full border border-[color:var(--st-border)] bg-[color:var(--st-panel-hover)]"
      />
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      style={box}
      className="shrink-0 rounded-full border border-[color:var(--st-border)] object-cover"
    />
  )
}
