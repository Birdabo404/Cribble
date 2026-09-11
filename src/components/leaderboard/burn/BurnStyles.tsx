'use client'

// The burn board's stylesheet — every .bb-* rule, mounted once by the
// leaderboard page so the board tabs it shares with GLOBAL / AI / TEAMS
// wear the same register as the two burn sources. It is the AI board's
// discipline in the burn board's palette: a 1px ember frame, hairline
// rows, a 2px rail, `[01]` indices, text toggles in hairline cells, no
// radius on chrome (avatars stay round). Unlike .aib it is theme-aware
// and written in plain px: ember, ink and hairlines all resolve through
// the arena's --lb-* tokens and the mirrored zinc scale, so light mode
// reads ember as rust, green as AA ink, hairlines as near-black.
//
// Three hues, one job each: ember for structure (frame, index, rail,
// hover band, sort glyph, the active cell's rule), money-green for the
// `$` figure, ink for the rest — two inks, no third: captions separate
// from labels by size and seat, never by a fainter grey. Also home to
// .lbt-pv (the persona var swap) and .lbt-money, which the player card's
// stat strip reads.
//
// Grid templates are the consumer's: a `gridClassName` sets display,
// tracks and column-gap only. The slab pads every band through --bb-pad.

export function BurnStyles() {
  return (
    <style jsx global>{`
      /* ================= tokens ================= */
      /* .bb-seg carries the tokens too: the page's board tabs travel
         outside any .bb root. */
      .bb,
      .bb-seg {
        --bb-ink: var(--z100);
        --bb-ink-2: var(--z400);
        --bb-ember: var(--lb-ember);
        --bb-hair: rgb(var(--lb-panel-edge) / 0.09);
        --bb-edge: rgb(var(--lb-panel-edge) / 0.22);
        --bb-rule: rgb(var(--lb-ember) / 0.32);
        --bb-band: rgb(var(--lb-ember) / 0.06);
        --bb-mono: var(--font-data), ui-monospace, 'SF Mono', Menlo, monospace;
        --bb-pixel: var(--font-pixel), ui-monospace, monospace;
        --bb-display: var(--font-display), 'Inter', system-ui, sans-serif;
        --bb-pad: 16px;
        /* ToolMark's monogram square reads this for its hairline */
        --aib-edge: var(--lb-panel-edge);
      }
      /* Light: ink hairlines and the ember rules step up so they survive
         white (0.09 ink over white is a 1.3:1 ghost), and the arena's
         light gold — tuned for GLOBAL's 16px figures — deepens one notch
         here, where it carries 10px titles and 15px indices (2.9:1 →
         5.8:1). Silver and bronze already clear 4.5:1 on white. */
      html.light .bb,
      html.light .bb-seg {
        --bb-hair: rgb(var(--lb-panel-edge) / 0.14);
        --bb-rule: rgb(var(--lb-ember) / 0.55);
        --bb-band: rgb(var(--lb-ember) / 0.09);
        --lb-gold: 140 92 6;
      }
      .bb {
        position: relative;
        color: rgb(var(--bb-ink));
        font-family: var(--bb-mono);
        font-size: 13px;
        line-height: 1.45;
        font-variant-numeric: tabular-nums;
      }
      @media (min-width: 768px) {
        .bb {
          --bb-pad: 20px;
        }
      }
      .bb :focus-visible {
        outline: 1px solid rgb(var(--bb-ember));
        outline-offset: -1px;
      }
      .bb :where(p, ol, h2) {
        margin: 0;
      }

      /* the frame: one solid ember line around the panel sheet */
      .bb-slab {
        background: rgb(var(--lb-panel-bg));
        border: 1px solid rgb(var(--bb-ember));
        border-radius: 0;
      }
      .bb-list {
        min-width: 0;
      }
      /* rules are real elements so the mount cascade can draw them */
      .bb-rule-x {
        display: block;
        height: 1px;
        background: var(--bb-rule);
      }

      /* ================= stat strip ================= */
      .bb-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        overflow: hidden;
      }
      .bb-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 0;
        padding: 16px;
        text-align: center;
      }
      .bb-stat:nth-child(2) {
        border-left: 1px solid var(--bb-hair);
      }
      .bb-stat:nth-child(n + 3) {
        border-top: 1px solid var(--bb-hair);
      }
      .bb-stat:nth-child(4) {
        border-left: 1px solid var(--bb-hair);
      }
      @media (min-width: 768px) {
        .bb-stats {
          grid-template-columns: repeat(4, 1fr);
        }
        .bb-stat:nth-child(n + 3) {
          border-top: 0;
        }
        .bb-stat:nth-child(3) {
          border-left: 1px solid var(--bb-hair);
        }
      }
      .bb-stat-label {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 10px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: rgb(var(--bb-ink-2));
      }
      .bb-stat-value {
        max-width: 100%;
        margin-top: 10px;
        overflow: hidden;
        font-family: var(--bb-pixel);
        font-size: clamp(11px, 2.6vw, 16px);
        line-height: 1.2;
        color: rgb(var(--bb-ink));
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .bb-stat-hint {
        max-width: 100%;
        margin-top: 6px;
        font-size: 10px;
        line-height: 1.6;
        letter-spacing: 0.16em;
        color: rgb(var(--bb-ink-2));
        text-wrap: balance;
      }

      /* ================= toolbar ================= */
      /* Tabs left, the board's own controls right; under sm the tools
         wrapper dissolves so every group is one left-aligned flow item
         with the same 8px × 12px gaps. */
      .bb-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
      }
      .bb-bar-tools {
        display: flex;
        flex: 1 1 auto;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 8px 12px;
      }
      @media (max-width: 639px) {
        .bb-bar-tools {
          display: contents;
        }
      }
      /* A hairline square group of text cells. The ink frame sits a tier
         under the slabs' ember frames, so the controls never outrank the
         ledger they steer. */
      .bb-seg {
        display: inline-flex;
        max-width: 100%;
        overflow-x: auto;
        border: 1px solid var(--bb-edge);
        background: rgb(var(--lb-panel-bg));
        scrollbar-width: none;
      }
      .bb-seg::-webkit-scrollbar {
        display: none;
      }
      .bb-segbtn {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 12px;
        border: 0;
        background: none;
        font-family: var(--bb-mono);
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgb(var(--bb-ink-2));
        white-space: nowrap;
        cursor: pointer;
        transition: color 120ms;
      }
      .bb-segbtn + .bb-segbtn {
        border-left: 1px solid var(--bb-edge);
      }
      .bb-segbtn:hover {
        color: rgb(var(--bb-ink));
      }
      /* current: ember ink and a 2px ember rule on the cell's bottom edge
         (the pager's underline, promoted); inset so nothing shifts */
      .bb-segbtn[aria-selected='true'] {
        color: rgb(var(--bb-ember));
        box-shadow: inset 0 -2px 0 rgb(var(--bb-ember));
      }
      .bb-segbtn[data-ember],
      .bb-segbtn[data-ember]:hover {
        color: rgb(var(--bb-ember));
      }
      .bb-segbtn:disabled {
        color: rgb(var(--bb-ink-2));
        cursor: wait;
      }
      .bb-segbtn:focus-visible {
        outline: 1px solid rgb(var(--bb-ember));
        outline-offset: -1px;
      }
      /* the standings search: one more cell in the group's register —
         same frame, same height, the query in mono ink */
      .bb-search {
        width: 100%;
        align-items: center;
        overflow: hidden;
      }
      @media (min-width: 640px) {
        .bb-search {
          width: 240px;
        }
      }
      .bb-search:focus-within {
        border-color: rgb(var(--bb-ember));
      }
      .bb-search-icon {
        display: flex;
        flex: none;
        padding-left: 10px;
        color: rgb(var(--bb-ink-2));
      }
      .bb-search-input {
        flex: 1 1 auto;
        min-width: 0;
        height: 30px;
        padding: 0 10px;
        border: 0;
        background: none;
        font-family: var(--bb-mono);
        font-size: 11px;
        letter-spacing: 0.04em;
        color: rgb(var(--bb-ink));
      }
      .bb-search-input::placeholder {
        color: rgb(var(--bb-ink-2));
      }
      .bb-search-input:focus-visible {
        outline: 0;
      }
      .bb-search > .bb-segbtn {
        border-left: 1px solid var(--bb-edge);
      }

      /* ================= title bar ================= */
      .bb-titlebar {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 52px;
        padding: 12px var(--bb-pad);
        font-size: 13px;
        color: rgb(var(--bb-ink-2));
      }
      .bb-titlebar-dot {
        font-size: 11px;
        color: rgb(var(--bb-ember));
      }
      .bb-titlebar-text {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .bb-titlebar-name {
        font-weight: 600;
        letter-spacing: 0.1em;
        color: rgb(var(--bb-ink));
      }
      .bb-titlebar-num {
        color: rgb(var(--bb-ink));
      }
      .bb-titlebar-sep {
        margin: 0 10px;
      }
      .bb-titlebar-stamp {
        flex: none;
        font-size: 11px;
        letter-spacing: 0.18em;
        white-space: nowrap;
      }
      /* phones: the range and the stamp don't both fit at 375, and the
         window toggle sits right above the board, so the stamp yields */
      @media (max-width: 767px) {
        .bb-titlebar-sep {
          margin: 0 6px;
        }
        .bb-titlebar-stamp {
          display: none;
        }
      }

      /* ================= header ================= */
      .bb-thead {
        min-height: 40px;
        padding-left: var(--bb-pad);
        padding-right: var(--bb-pad);
      }
      .bb-th {
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        text-align: right;
        color: rgb(var(--bb-ink-2));
        white-space: nowrap;
      }
      .bb-th-left {
        text-align: left;
      }
      /* centring is a desktop column alignment: under md the figures
         zone is one right-aligned stack at the row's edge */
      @media (min-width: 768px) {
        .bb-th-center {
          text-align: center;
        }
      }
      /* the sort glyph sits LEFT of its label so a right-aligned header's
         text edge still lands on the numeral edge beneath it */
      .bb-th-glyph {
        display: inline-block;
        width: 1ch;
        margin-right: 3px;
        color: rgb(var(--bb-ember));
      }

      /* ================= rows ================= */
      .bb-rows {
        position: relative;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .bb-row {
        border-bottom: 1px solid var(--bb-hair);
      }
      .bb-row:last-child {
        border-bottom: 0;
      }
      /* A row is a <button> (CLI: opens the burn card) or a <div> whose
         name is the link (CURSOR: opens the profile) — one hover band,
         one rail, one focus ring for both. */
      .bb-rowbtn {
        position: relative;
        width: 100%;
        min-height: 60px;
        padding: 10px var(--bb-pad);
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      /* the rail: 2px of ember, no shadow, no transition */
      .bb-rowbtn::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 2px;
        background: rgb(var(--bb-ember));
        opacity: 0;
      }
      .bb-rowbtn:hover,
      .bb-rowbtn:focus-visible,
      .bb-rowbtn:has(.bb-rowlink:focus-visible) {
        background: var(--bb-band);
      }
      .bb-rowbtn:hover::before,
      .bb-rowbtn:focus-visible::before,
      .bb-rowbtn:has(.bb-rowlink:focus-visible)::before,
      .bb-row[data-yours] .bb-rowbtn::before {
        opacity: 1;
      }
      .bb-rowbtn:hover .bb-mark,
      .bb-rowbtn:focus-visible .bb-mark {
        color: rgb(var(--bb-ember));
      }
      .bb-rowbtn:has(.bb-rowlink:focus-visible) {
        outline: 1px solid rgb(var(--bb-ember));
        outline-offset: -1px;
      }
      .bb-rowlink {
        color: inherit;
        text-decoration: none;
      }
      .bb .bb-rowlink:focus-visible {
        outline: 0;
      }

      .bb-cell {
        min-width: 0;
      }
      .bb-num {
        text-align: right;
        white-space: nowrap;
      }
      @media (min-width: 768px) {
        .bb-num-center {
          text-align: center;
        }
      }
      .bb-idx {
        display: inline-block;
        font-size: 13px;
        font-weight: 500;
        line-height: 1;
        color: rgb(var(--bb-ember));
        white-space: nowrap;
      }
      @media (min-width: 768px) {
        .bb-idx {
          font-size: 15px;
        }
      }

      /* type: pixel for figures, display for names, mono for the rest */
      .bb-pixel {
        font-family: var(--bb-pixel);
      }
      .bb-tokens {
        font-family: var(--bb-pixel);
        font-size: 14px;
        line-height: 1;
        color: rgb(var(--bb-ink));
        white-space: nowrap;
      }
      .bb-money {
        position: relative;
        font-family: var(--bb-pixel);
        font-size: 15px;
        font-weight: 400;
        line-height: 1;
        white-space: nowrap;
      }
      /* the provisional mark is a footnote reference, not a digit: mono,
         ink-2, hung in the gutter past the figure so the ledger's right
         edge stays flush */
      .bb-money-pv {
        position: absolute;
        top: 0;
        left: 100%;
        margin-left: 3px;
        font-family: var(--bb-mono);
        font-size: 11px;
        line-height: 1;
        color: rgb(var(--bb-ink-2));
      }
      /* Money-green — the hero hue for the sort key. Neon on dark, deep
         green ink on white (6.4:1). .lbt-money is colour only: the stat
         strip's dollar sign sizes itself. */
      .bb-money,
      .lbt-money {
        color: rgb(57 255 136);
      }
      html.light .bb-money,
      html.light .lbt-money {
        color: rgb(22 101 52);
      }
      .bb-name {
        overflow: hidden;
        font-family: var(--bb-display);
        font-size: 13px;
        font-weight: 500;
        line-height: 1.25;
        letter-spacing: -0.01em;
        color: rgb(var(--bb-ink));
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .bb-sub {
        display: block;
        overflow: hidden;
        font-size: 11px;
        line-height: 1.3;
        color: rgb(var(--bb-ink-2));
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* a caption stacked under a figure */
      .bb-num > .bb-sub {
        margin-top: 3px;
      }
      /* PLAYER cell: avatar beside a stack of name line + sub-line */
      .bb-player {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .bb-stack {
        display: block;
        flex: 1;
        min-width: 0;
      }
      .bb-nameline {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      @media (min-width: 768px) {
        .bb-player {
          gap: 12px;
        }
      }
      /* The line under the name: the persona in its tier hue through the
         lbt-pv swap, or on the podium the rank title in the medal hue —
         same metrics, only the ink changes. Not .bb-sub: that is display
         block, and the flame glyph needs a flex line. */
      .bb-persona,
      .bb-title {
        font-size: 10px;
        line-height: 1.3;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .bb-persona {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        margin-top: 2px;
      }
      .bb-persona-label {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* The title is a flex line so the crown can sit in it, aligned by
         its label's baseline (the crown opts out of baseline alignment,
         so a sub-line aligning the title to the handle reads the text). */
      .bb-title {
        display: inline-flex;
        flex: none;
        align-items: baseline;
        gap: 4px;
      }
      /* Rank 1's crown: centred on the 10px caps beside it (the line box
         centre sits ~1px above the cap centre), gold from the title's own
         colour. */
      .bb-crown {
        position: relative;
        top: 1px;
        display: inline-flex;
        flex: none;
        align-self: center;
      }
      .bb-tag {
        display: inline-block;
        flex: none;
        padding: 2px 6px;
        border: 1px solid currentColor;
        font-size: 10px;
        line-height: 1.2;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .bb-tag-you {
        color: rgb(var(--bb-ember));
      }
      .bb-mark {
        flex: none;
        color: rgb(var(--bb-ink));
        transition: color 120ms;
      }
      /* Plain colour classes, after .bb-sub / .bb-tokens so they win the
         tie: ember for CURSOR's token hero (tokens are its sort key and
         green stays reserved for dollars) and the stat glyphs, ink for a
         caption-sized line that is really a name (the phone tool line's
         agent), ink-2 for a glyph beside a label. */
      .bb-ember {
        color: rgb(var(--bb-ember));
      }
      .bb-ink {
        color: rgb(var(--bb-ink));
      }
      .bb-ink-2 {
        color: rgb(var(--bb-ink-2));
      }

      /* Persona visuals: the text/dot authors --pv-hue (bright) and
         --pv-ink (deep) inline; the theme picks which one --pv resolves
         to here — an inline --pv would win the cascade and never swap. */
      .lbt-pv {
        --pv: var(--pv-hue);
      }
      html.light .lbt-pv {
        --pv: var(--pv-ink);
      }

      /* ================= tooltip ================= */
      /* A square hairline caption above a mark, in the header's register.
         Sits above the row's stretched hit areas. */
      .bb-tip {
        position: relative;
        z-index: 1;
        display: inline-flex;
        flex: none;
        align-items: center;
      }
      .bb-tip-bubble {
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        z-index: 5;
        padding: 5px 8px;
        border: 1px solid var(--bb-edge);
        background: rgb(var(--lb-panel-bg));
        font-family: var(--bb-mono);
        font-size: 10px;
        line-height: 1.2;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgb(var(--bb-ink));
        white-space: nowrap;
        transform: translateX(-50%);
        opacity: 0;
        pointer-events: none;
      }
      .bb-tip:hover .bb-tip-bubble,
      .bb-tip:focus-within .bb-tip-bubble {
        opacity: 1;
      }

      /* ================= avatar ================= */
      /* 32px on phones, 36px from md; the monogram scales off the same var */
      .bb-avatar {
        --bb-av: 32px;
        position: relative;
        display: inline-block;
        flex: none;
        width: var(--bb-av);
        height: var(--bb-av);
        border-radius: 9999px;
      }
      @media (min-width: 768px) {
        .bb-avatar {
          --bb-av: 36px;
        }
      }
      .bb-avatar-ring {
        position: absolute;
        inset: -2px;
        border: 2px solid;
        border-radius: 9999px;
        pointer-events: none;
      }
      .bb-avatar-img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border-radius: 9999px;
        object-fit: cover;
      }
      .bb-avatar-fallback {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--bb-hair);
        border-radius: 9999px;
        background: rgb(var(--lb-panel-edge) / 0.05);
        font-size: calc(var(--bb-av) * 0.31);
        font-weight: 600;
        color: rgb(var(--bb-ink-2));
      }

      /* ================= text buttons ================= */
      .bb-toggle {
        padding: 6px 0;
        border: 0;
        background: none;
        font: inherit;
        font-size: 12px;
        letter-spacing: 0.1em;
        color: rgb(var(--bb-ink-2));
        white-space: nowrap;
        cursor: pointer;
        transition: color 120ms;
      }
      .bb-toggle:hover {
        color: rgb(var(--bb-ink));
      }
      .bb-toggle[aria-current] {
        color: rgb(var(--bb-ember));
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 5px;
      }
      .bb-toggle[data-ember],
      .bb-toggle[data-ember]:hover {
        color: rgb(var(--bb-ember));
      }
      .bb-toggle:disabled {
        color: rgb(var(--bb-ink-2));
        opacity: 0.5;
        cursor: default;
      }

      /* ================= pager ================= */
      .bb-pager {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 24px;
      }
      .bb-pager-pages {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0 14px;
      }
      .bb-pager-gap,
      .bb-pager-pos {
        font-size: 12px;
        letter-spacing: 0.1em;
        color: rgb(var(--bb-ink-2));
        white-space: nowrap;
      }
      .bb-pager-pos {
        display: none;
      }
      @media (max-width: 639px) {
        .bb-pager-num,
        .bb-pager-gap {
          display: none;
        }
        .bb-pager-pos {
          display: inline;
        }
      }
      .bb-pager-you {
        display: inline-flex;
        align-items: center;
        gap: 0 8px;
        font-size: 12px;
        letter-spacing: 0.1em;
        color: rgb(var(--bb-ink));
        white-space: nowrap;
      }
      .bb-pager-k {
        color: rgb(var(--bb-ember));
      }
      .bb-pager-dot {
        color: rgb(var(--bb-ink-2));
      }

      /* ================= states ================= */
      .bb-line {
        padding: 28px var(--bb-pad);
        font-size: 13px;
        color: rgb(var(--bb-ink-2));
      }
      .bb-error {
        color: rgb(var(--bb-ink));
      }
      .bb-error .bb-toggle {
        margin-left: 8px;
        color: rgb(var(--bb-ember));
      }
      .bb-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 56px var(--bb-pad);
        text-align: center;
      }
      .bb-empty-title {
        margin-top: 16px;
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: rgb(var(--bb-ink));
      }
      .bb-empty-body {
        max-width: 28rem;
        margin-top: 8px;
        font-size: 11px;
        line-height: 1.7;
        color: rgb(var(--bb-ink-2));
      }
      .bb-empty-action {
        margin-top: 20px;
      }
      .bb-skel {
        color: rgb(var(--lb-panel-edge) / 0.4);
        opacity: 0.5;
      }
      .bb-skelrow {
        width: 100%;
        min-height: 60px;
        padding-left: var(--bb-pad);
        padding-right: var(--bb-pad);
      }
      .bb-skelrow .bb-skel {
        overflow: hidden;
        font-size: 13px;
        letter-spacing: -0.05em;
        white-space: nowrap;
      }

      /* ================= footer ================= */
      .bb-foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px 24px;
        padding: 16px var(--bb-pad);
        border-top: 1px solid var(--bb-rule);
      }
      .bb-footnote {
        margin-left: auto;
        font-size: 11px;
        line-height: 1.7;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgb(var(--bb-ink-2));
      }
      @media (max-width: 639px) {
        .bb-footnote {
          margin-left: 0;
          flex-basis: 100%;
        }
      }
      /* the CTA under the CURSOR slab for a viewer who is not on it */
      .bb-cta {
        display: flex;
        justify-content: center;
        margin-top: 12px;
      }
      /* the long calls to action wrap inside their cell instead of
         scrolling it */
      .bb-cta .bb-segbtn,
      .bb-empty-action .bb-segbtn {
        height: auto;
        min-height: 30px;
        padding: 6px 12px;
        line-height: 1.5;
        text-align: center;
        white-space: normal;
      }

      /* ================= breakpoint helpers =================
         Two classes deep so a consumer's own display utility on the
         same element (flex, grid) loses at the hidden breakpoint and
         wins at the shown one without an !important anywhere. */
      @media (max-width: 767px) {
        .bb .bb-md-only {
          display: none;
        }
      }
      @media (min-width: 768px) {
        .bb .bb-mobile-only {
          display: none;
        }
      }

      /* The toolbar row between the two slabs keeps GLOBAL's CSS reveal
         (the slabs themselves are GSAP's, see burnMotion.mountChrome). */
      .bb-reveal {
        animation: bb-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        animation-delay: var(--rv, 0ms);
      }
      @keyframes bb-reveal-in {
        from {
          opacity: 0;
          transform: translateY(14px);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .bb-toggle,
        .bb-segbtn,
        .bb-mark {
          transition: none;
        }
        .bb-reveal {
          animation: none;
        }
      }
    `}</style>
  )
}
