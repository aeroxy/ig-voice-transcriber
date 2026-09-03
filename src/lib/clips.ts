import type { ClipRef } from '@/types/messages'

/**
 * Finding voice messages in an Instagram thread.
 *
 * Instagram renders a voice message as a play button + waveform + progress bar.
 * The waveform is an SVG, and the clip's mask inside it is named after the
 * attachment:
 *
 *   <svg aria-label="Waveform for audio message">
 *     <clipPath id="waveform-clip-path-2477997293023062">
 *
 * That number is Instagram's `attachment_fbid` — the same id the page's Relay
 * store files the CDN url under — so it identifies the clip exactly. See
 * `src/lib/relay-store.ts` for the other half of the join.
 */

const WAVEFORM = '[aria-label="Waveform for audio message"]'
const PROGRESS_BAR = '[aria-label="Audio progress bar"]'
const CLIP_PATH_ID = /^waveform-clip-path-(\d+)$/

/** Our injected UI, marked so we never process the same clip twice. */
export const MOUNTED_ATTR = 'data-igvt-mounted'

export interface FoundClip {
  ref: ClipRef
  /** The bubble the clip lives in — where the transcript gets mounted. */
  container: HTMLElement
}

/** The fbid out of a waveform's clipPath id, or null for any other id. */
export function parseFbid(clipPathId: string): string | null {
  return CLIP_PATH_ID.exec(clipPathId)?.[1] ?? null
}

/**
 * The voice-message block: the column that stacks the player row on top of
 * Instagram's own transcription line.
 *
 *   column                                   <- what this returns
 *     row     [play | waveform | 0:02]
 *     line    "View transcription"
 *
 * Getting this level right is the whole point. Stopping one level lower — at
 * the first ancestor holding the play button and the progress bar — lands inside
 * the horizontal row, where anything appended is laid out beside the duration
 * pill instead of beneath the player, and a full-width child squeezes the
 * waveform out of existence.
 *
 * Instagram's class names here are generated, so the landmark is structural:
 * the nearest ancestor that holds the progress bar and stacks its children in a
 * column. Verified against the live DOM — the row holding play/waveform/duration
 * is the level below, and appending there puts our line beside the duration pill
 * instead of under the player.
 *
 * The text match is only a fallback, and deliberately second: matching
 * Instagram's own "View transcription" copy would tie this to an English UI,
 * and it can also be tripped by a quoted reply that merely contains the word.
 */
function bubbleFor(waveform: Element): HTMLElement | null {
  let node = waveform.parentElement
  let byText: HTMLElement | null = null

  for (let hop = 0; hop < 10 && node; hop++) {
    if (node.querySelector(PROGRESS_BAR)) {
      if (getComputedStyle(node).flexDirection === 'column') return node
      if (!byText && /transcri/i.test(node.textContent ?? '')) byText = node
    }
    node = node.parentElement
  }
  return byText
}

/** Every voice clip currently rendered in the thread, in DOM order. */
export function findClips(root: ParentNode = document): FoundClip[] {
  const found: FoundClip[] = []

  for (const waveform of root.querySelectorAll(WAVEFORM)) {
    const container = bubbleFor(waveform)
    // Named in the selector, not just validated after: any other id-bearing
    // clipPath Instagram adds ahead of this one must not shadow it.
    const clipPath = waveform.querySelector('clipPath[id^="waveform-clip-path-"]')
    const fbid = clipPath && parseFbid(clipPath.id)
    if (!container || !fbid) continue
    found.push({ ref: { fbid }, container })
  }

  return found
}
