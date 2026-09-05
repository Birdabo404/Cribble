// GitHub linguist colours for the language dot in a HANGAR bay's
// telemetry strip. A hand-picked slice of github-linguist/languages.yml
// covering what Cribble pilots actually ship; anything else renders
// with no colour (the pane falls back to its neutral dot) rather than
// a wrong one. Stored on the card at resolve time so the client never
// needs this table.

const LINGUIST_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Java: '#b07219',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Dart: '#00B4AB',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Elixir: '#6e4a7e',
  Zig: '#ec915c',
  Lua: '#000080',
  Haskell: '#5e5086',
  Scala: '#c22d40',
  'Objective-C': '#438eff',
  'Jupyter Notebook': '#DA5B0B',
  MDX: '#fcb32c',
  Astro: '#ff5a03'
}

const BY_LOWER = new Map(
  Object.entries(LINGUIST_COLORS).map(([name, color]) => [name.toLowerCase(), color])
)

/** Hex colour for a linguist language name, or null when unknown.
 *  Case-insensitive so "typescript" from a hand-typed source still
 *  matches. */
export function languageColor(name: string | null | undefined): string | null {
  if (!name) return null
  return LINGUIST_COLORS[name] ?? BY_LOWER.get(name.trim().toLowerCase()) ?? null
}
