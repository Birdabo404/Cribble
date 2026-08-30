// Capture/share engine for the ShareSheet: renders a DOM node (the
// off-screen ShareCard) to a high-resolution image blob and delivers it
// via clipboard, download, native share, or the x.com intent composer.
// Browser-only — every function touches window/document/navigator, so
// consumers must call these client-side (the module is meant to be
// lazy-loaded alongside the ShareSheet).

import { toBlob, toCanvas } from 'html-to-image'

export interface CaptureOptions {
  pixelRatio: number
  type: 'image/png' | 'image/jpeg'
  quality?: number
  /** Extra toCanvas passes before encode. Safari drops fonts/images on
   *  the first snapshot; 2 is the safe default. Background X packing
   *  can drop to 1 once the sheet has already waited on fonts + imgs. */
  warmupPasses?: number
}

// Safari/WebKit is known to drop images and embedded fonts on
// html-to-image's first pass (resources resolve after the SVG snapshot
// is serialized). The standard workaround is to render more than once
// and keep only the final pass — the early passes warm the caches.
// Cheap insurance on other browsers too, hence no UA gate.
const WARMUP_PASSES = 2

/**
 * Render `el` to an image blob at `pixelRatio` scale. Warm-up passes
 * use `toCanvas` (skipping the expensive PNG/JPEG encode); only the
 * final pass pays for encoding. Rejects if the browser produces no
 * blob — callers surface that as a capture failure.
 */
export async function captureElementToBlob(
  el: HTMLElement,
  opts: CaptureOptions
): Promise<Blob> {
  const options = {
    pixelRatio: opts.pixelRatio,
    type: opts.type,
    quality: opts.quality
  }
  const warmup = opts.warmupPasses ?? WARMUP_PASSES
  for (let pass = 0; pass < warmup; pass++) {
    await toCanvas(el, options)
  }
  const blob = await toBlob(el, options)
  if (!blob) throw new Error('Capture produced no image')
  return blob
}

// iPadOS 13+ masquerades as macOS, so UA alone misses it — a
// Macintosh UA with a touch screen is an iPad.
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

/**
 * Export scale for the 1080x1350 card. 4x (4320x5400 = 23.3MP) blows
 * past Safari's ~16.7MP canvas area limit on iOS/iPadOS, so those
 * devices drop to 3x (3240x4050 = 13.1MP) — the long edge still
 * clears 4K (3840).
 */
export function sharePixelRatio(): number {
  return isIOS() ? 3 : 4
}

/** Pixel ratio for images destined for X. A 4K PNG is ~11MB — over X's
 *  5MB PNG cap — and X recompresses anyway. 2× is 2160×2700, under the
 *  cap, and still sharp in the 4:5 crop. */
export function xPostPixelRatio(): number {
  return 2
}

/** Copy an image blob to the clipboard. False (never a throw) when the
 *  browser lacks ClipboardItem (Firefox) or the write is denied. */
export async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return false
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return true
  } catch {
    return false
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Deferred revoke: Safari can lose the download if the URL dies
  // before the click is fully processed.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** True when Web Share API Level 2 can share this file (mobile mostly;
 *  desktop browsers largely can't share files). */
export function canShareFiles(file: File): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  )
}

/** Open the native share sheet with the image + text. False when
 *  unsupported, denied, or dismissed by the user (AbortError) — the UI
 *  falls back to another delivery path, never an error state. */
export async function shareFiles(opts: { file: File; text: string }): Promise<boolean> {
  if (!canShareFiles(opts.file)) return false
  try {
    await navigator.share({ files: [opts.file], text: opts.text })
    return true
  } catch {
    return false
  }
}

/** Open the X composer prefilled with `text`. Must run inside the click
 *  handler — awaiting capture first loses the user gesture and browsers
 *  block the popup. A sized popup keeps the share sheet visible so the
 *  paste toast is still on screen. Returns false when the popup is
 *  blocked (caller still copies the card). */
export function openXIntent(text: string): boolean {
  const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}`
  const win = window.open(url, 'cribble-x-share', 'popup=yes,width=550,height=700')
  if (!win) return false
  win.opener = null
  return true
}
