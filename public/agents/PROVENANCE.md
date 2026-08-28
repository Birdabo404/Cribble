# Harness icon provenance

These files are copied into `public/agents`; the application never hotlinks brand assets at runtime.

## Pi (`pi.svg`)

- Upstream project: https://github.com/earendil-works/pi
- Pinned project revision: `ccfe79ed238674f760c986e3a61493aab794000a`
- Pinned evidence: the README at that revision embeds the project-supplied square logo from `https://pi.dev/logo-auto.svg`: https://github.com/earendil-works/pi/blob/ccfe79ed238674f760c986e3a61493aab794000a/README.md#L1-L5
- Retrieved asset URL: `https://pi.dev/logo-auto.svg` (retrieved through GitHub's content proxy for the pinned README reference; bytes are unchanged)
- Format/dimensions: SVG, `viewBox="0 0 800 800"`
- SHA-256: `03d509c104b9570063fa268fd3235ed7e0e41dafd93124ca94cae3726f58f117`
- Basis: the upstream repository is MIT licensed (`LICENSE` at the pinned revision), and upstream explicitly publishes this image as its “pi logo” in the project README. It is used here only to identify Pi, without modification or implied endorsement.
- Collector evidence: `Birdabo404/cribble-agent` commit `b0786fa122bfc889c5f08b320b94f0b404130567`, `test/supplemental.test.js`, records ccusage metadata containing `pi-agent`. `pi` is the canonical product/CLI name and `pi-coding-agent` follows the upstream package identity (`@earendil-works/pi-coding-agent`) named in the pinned repository.

## OpenCode (`opencode.svg`)

- Upstream project: https://github.com/anomalyco/opencode
- Pinned revision: `5f5ea53afb2630227ead917f1a0ddf784c33150c`
- Exact source: https://github.com/anomalyco/opencode/blob/5f5ea53afb2630227ead917f1a0ddf784c33150c/packages/console/app/src/asset/brand/opencode-logo-dark-square.svg
- Raw source: https://raw.githubusercontent.com/anomalyco/opencode/5f5ea53afb2630227ead917f1a0ddf784c33150c/packages/console/app/src/asset/brand/opencode-logo-dark-square.svg
- Format/dimensions: SVG, `width="300" height="300" viewBox="0 0 300 300"`
- SHA-256: `d6a0e3b8a295f413543f41cb73957e670351b5cb088c8d9dbd186b9e9d633cca`
- Basis: the asset is published in upstream's dedicated brand-assets directory and the pinned repository is MIT licensed. It is used unmodified only to identify OpenCode, consistent with https://opencode.ai/brand, without implied endorsement.

## Verification

```sh
file public/agents/pi.svg public/agents/opencode.svg
sha256sum public/agents/pi.svg public/agents/opencode.svg
npm run validate:agent-svgs
npm test -- --run scripts/validate-agent-svgs.test.ts
```

The validator permits only same-document fragment references such as `url(#clip-id)` and
`href="#symbol-id"`. It rejects scripts, `foreignObject`, event-handler attributes, external
`href`/`src` values, and every non-fragment `url(...)` value (including HTTP(S),
protocol-relative, `data:`, and `javascript:` references). Embedded and attribute CSS is
fail-closed against markup, escapes, malformed comments, active `expression`/`behavior`/
`-moz-binding` constructs, and all at-rules except the official Pi asset's passive `@media`
rule; this includes quoted, `url(...)`, escaped, case-varied, and comment-obscured `@import`
forms. The test command verifies both shipped official assets plus adversarial unsafe fixtures.
