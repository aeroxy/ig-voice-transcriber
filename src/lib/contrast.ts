/**
 * Picking a legible text colour for our injected line.
 *
 * `color: inherit` is right when the bubble sets its own text colour, but an
 * incoming voice-message bubble can hand us near-white text on its light grey
 * fill. So we measure what we would actually render and only step in when it is
 * unreadable — a bubble that already works (outgoing: white on blue) is left
 * alone rather than flipped to black by a stricter rule.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Below this we override. WCAG's 3:1 is the "large text" floor; Instagram's own white-on-blue sits just above it, so a lower bar leaves that alone. */
const ILLEGIBLE = 2

/**
 * A computed CSS colour, as `getComputedStyle` serialises it: `rgb(r, g, b)`,
 * `rgba(r, g, b, a)`, or the space-separated `rgb(r g b / a)` form. Null for
 * anything else (named colours never appear in computed values).
 */
export function parseColor(css: string): Rgba | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(
    css.trim(),
  )
  if (!m) return null
  const alpha = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4])
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha }
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

/**
 * The colour to force onto text that would render as `text` over `background`,
 * or null when `text` is already readable and should be left as it is.
 */
export function legibleColor(text: Rgba, background: Rgba): string | null {
  if (contrastRatio(text, background) >= ILLEGIBLE) return null
  return contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? '#262626' : '#ffffff'
}
