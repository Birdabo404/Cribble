// The HANGAR — a pilot's pinned builds on /u/[username]. Owners store
// up to HANGAR_MAX canonical URLs in users.metadata.pins; the server
// resolves each into one of the card shapes below (GitHub repo, generic
// site, or a still-pending link) and caches the result in link_cards,
// shared across every pilot who pins the same URL. The profile payload
// carries the resolved cards in pin order with inFlight marking the pin
// that matches the owner's NOW BUILDING (metadata.project_url).
//
// This module is the contract between the resolvers / profile builder
// (server) and the HangarPane / PlayerCard (client) — keep it free of
// runtime imports so both sides can pull the types without dragging in
// server code.

/** GitHub-style cap: six bays. */
export const HANGAR_MAX = 6

/** Card kinds persisted in link_cards.kind. `pending` is never stored —
 *  it is what a pin renders as before its card exists or after a failed
 *  fetch. */
export type HangarStoredKind = 'github' | 'site'

export interface HangarGithubCard {
  kind: 'github'
  url: string
  owner: string
  repo: string
  description: string | null
  stars: number
  forks: number
  /** Primary linguist language, e.g. "TypeScript". */
  language: string | null
  /** Hex colour for the language dot, or null when unknown. */
  languageColor: string | null
  /** ISO timestamp of the last push. */
  pushedAt: string | null
  archived: boolean
  homepage: string | null
}

export interface HangarSiteCard {
  kind: 'site'
  url: string
  /** Hostname without www., shown in the telemetry strip. */
  host: string
  title: string | null
  description: string | null
  /** Absolute http(s) favicon URL, or null → globe glyph. */
  icon: string | null
}

export interface HangarPendingCard {
  kind: 'pending'
  url: string
  host: string
}

/** What a resolver produces and link_cards.card stores. */
export type HangarCardData = HangarGithubCard | HangarSiteCard | HangarPendingCard

/** One bay in the public profile payload (PublicProfile.hangar). */
export type HangarCard = HangarCardData & {
  /** True when this pin is the owner's NOW BUILDING project. */
  inFlight: boolean
}
