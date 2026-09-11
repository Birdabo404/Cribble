# Agent harness brand assets — provenance & licensing

Self-hosted brand marks for the coding-agent harnesses rendered by
`TokenAgentIcon` (registry: `src/lib/harnessBrands.ts`). Assets are pinned:
sourced from an exact upstream revision, hashed here, and never hotlinked.

Policy:

- Every `.svg` in this folder must pass the fail-closed validator in
  `src/lib/svgAssetValidator.ts` — enforced by
  `src/lib/svgAssetValidator.test.ts`, which gates all SVGs in this folder,
  and `src/lib/harnessBrands.test.ts`, which gates every asset the registry
  references. Update an asset ⇒ update its hash and revision here.
- The file licenses below cover redistribution of the artwork files. The
  marks themselves remain trademarks of their respective owners and are
  used nominatively, solely to identify the harness they belong to.

## pi.svg

- Source: Pi coding agent (pi.dev) site favicon — the project's square mark
  (white glyph on `#09090b`, radius-120 tile)
- Repository: https://github.com/earendil-works/pi-website — `src/favicon.svg`
- Pinned revision: `2f5e410b97474d0a34ec2500aa1aa58d6c3f992c`
- Direct file: https://raw.githubusercontent.com/earendil-works/pi-website/2f5e410b97474d0a34ec2500aa1aa58d6c3f992c/src/favicon.svg
- SHA-256: `a5624bc3b8cac94de75f6f13701eca2ad3ef67bbeba286c4af3f398806f0858a`
- License: MIT (repository license)
- Fetched: 2026-08-29
- Modifications: none — byte-identical to the pinned revision, and verified
  byte-identical to the live https://pi.dev/favicon.svg on the fetch date.

## opencode.svg

- Source: OpenCode master identity mark (near-black tile, white glyph)
- Repository: https://github.com/anomalyco/opencode (formerly sst/opencode)
  — `packages/identity/mark.svg`
- Pinned revision: `dc4449df0d52199704ea4989a5a993ebbc605612`
- Direct file: https://raw.githubusercontent.com/anomalyco/opencode/dc4449df0d52199704ea4989a5a993ebbc605612/packages/identity/mark.svg
- SHA-256: `e29bbe33380ad1c1ada9134b52f229d30e9776d60481512c9d81f2bb6f37def9`
- License: MIT (repository license)
- Fetched: 2026-08-29
- Modifications: none. Note: the upstream file legitimately contains a
  nested `<svg>` wrapper and a `<style>` block with passive
  `@media (prefers-color-scheme)` rules — both are explicitly permitted by
  the SVG validator.

## hermes.png

- Source: Hermes agent brand mark by Nous Research
- Repository: https://github.com/NousResearch/hermes-agent
- SHA-256: `4a0fdd278fc1c6019655e94f1f057d43c605985ae61a1247081eb48a17930c47`
- License: MIT (repository license)
- Fetched: 2026-08-27
- Modifications: re-encoded/downscaled locally to a 256×256 PNG at fetch
  time; the original upstream bytes were not preserved, and the repo's
  current icon revisions no longer byte-match, so this file is pinned by
  its own hash above rather than an upstream revision. If it is ever
  re-fetched, record the exact upstream path + commit here.

## Vector marks without files here

Codex (OpenAI), Claude Code, Cursor, Gemini CLI and GitHub Copilot render
from Simple Icons path data (CC0 1.0) embedded in
`src/lib/harnessBrands.ts` — no binary asset to pin.

### Monochrome harness marks (`HARNESS_MARKS` in `src/lib/aiToolMarks.ts`)

The AI board and Burn Board draw every mark as single-fill `currentColor`
geometry on a 24-unit grid. Three harness marks are traced onto that grid
from the harness's own published mark; the path data lives in
`src/lib/aiToolMarks.ts`, provenance is recorded here.

- **Hermes** — derived from `hermes.png` above (same MIT license and
  hash). Auto-traced (potrace) after a 64×64 Lanczos downsample, threshold
  128, speckles under 3px dropped; rescaled 64 → 24 and clamped to the
  box. Ink is the fill; the white tile is left open. 11 subpaths, evenodd.
- **Pi** — derived from `pi.svg` above (same MIT license and revision).
  The two glyph paths are lifted verbatim and rescaled from the 800-unit
  tile to a 22-unit box with a 1-unit margin; the `#09090b` tile rect is
  dropped. 3 subpaths, evenodd.
- **OpenCode** — derived from `opencode.svg` above (same MIT license and
  revision). The white frame path is lifted and the grey `#5A5858` block
  is merged into it as ink (single colour has no mid-tone), leaving the
  upper third of the counter as the one cut; the `#131010` tile rect is
  dropped. Rescaled from the 512 tile so the 320-tall frame spans the
  same 22-unit height / 1-unit margin as Pi (cell = 4.4), centred
  horizontally. 2 subpaths, evenodd.
- **oh-my-pi (OMP)** — hand-traced from the project's own icon.
  - Source: oh-my-pi brand icon (π with a plug connector on the right leg)
  - Repository: https://github.com/can1357/oh-my-pi — `assets/icon.svg`
  - Pinned revision: `2be354322dee0cdd95bc42fc61c72ef9767b653b`
  - Direct file: https://raw.githubusercontent.com/can1357/oh-my-pi/2be354322dee0cdd95bc42fc61c72ef9767b653b/assets/icon.svg
  - SHA-256 (upstream file): `727019727006f26fe3d1f187d3fe9830f26213733a51721096a2044ab059cf61`
  - License: MIT (repository license)
  - Fetched: 2026-09-12
  - Modifications: bar, legs and connector body unioned into one outline;
    the two connector prongs cut as counters (widened 0.66 → 0.8 units so
    they register at 24px); the two orange accent dots on the bar omitted
    (sub-pixel at board sizes); brand colours dropped for `currentColor`.
    Rescaled from the 120×90 art box to a 22-unit width, centred
    vertically. 3 subpaths, evenodd. The upstream file itself is not
    shipped.
