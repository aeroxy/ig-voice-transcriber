import type { ClipRef } from '@/types/messages'

/**
 * Finding voice messages in an Instagram thread.
 *
 * Instagram renders a voice message as a play button + waveform + progress bar,
 * and — this is the awkward part — the audio URL appears nowhere in the DOM,
 * nor in any of its ~30 IndexedDB stores. The only handle the page gives us is
 * the clip's duration, on the progress bar:
 *
 *   <div aria-label="Audio progress bar" aria-valuemax="2.769" …>
 *
 * That is enough, because the CDN filename encodes the same duration in
 * milliseconds (`audioclip-1787501302000-2769.mp4`), so the background worker
 * can join the two. See `src/entrypoints/background.ts`.
 */

const PROGRESS_BAR = '[aria-label="Audio progress bar"]'
const WAVEFORM = '[aria-label="Waveform for audio message"]'

/** Our injected UI, marked so we never process the same clip twice. */
export const MOUNTED_ATTR = 'data-igvt-mounted'

export interface FoundClip {
  ref: ClipRef
  /** The bubble the clip lives in — where the transcript gets mounted. */
  container: HTMLElement
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
 * Instagram's class names here are generated, so the landmark is the content:
 * the nearest ancestor that contains the progress bar *and* the transcription
 * line. The computed-column check is a fallback for a clip rendered without
 * that line.
 */
function bubbleFor(waveform: Element): HTMLElement | null {
  let node = waveform.parentElement
  let column: HTMLElement | null = null

  for (let hop = 0; hop < 10 && node; hop++) {
    if (node.querySelector(PROGRESS_BAR)) {
      if (/transcri/i.test(node.textContent ?? '')) return node
      if (!column && getComputedStyle(node).flexDirection === 'column') column = node
    }
    node = node.parentElement
  }
  return column
}

/** Every voice clip currently rendered in the thread, in DOM order. */
export function findClips(root: ParentNode = document): FoundClip[] {
  const found: FoundClip[] = []
  const waveforms = [...root.querySelectorAll(WAVEFORM)]
  /** How many clips of each duration we have already seen, for the rank. */
  const seenPerDuration = new Map<number, number>()

  waveforms.forEach((waveform) => {
    const container = bubbleFor(waveform)
    if (!container) return

    const bar = container.querySelector(PROGRESS_BAR)
    const seconds = Number(bar?.getAttribute('aria-valuemax'))
    // A clip still being laid out reports 0 or NaN; skip it and catch it on a
    // later mutation, rather than registering an unjoinable duration.
    if (!Number.isFinite(seconds) || seconds <= 0) return

    const durationMs = Math.round(seconds * 1000)
    const sameDurationRank = seenPerDuration.get(durationMs) ?? 0
    seenPerDuration.set(durationMs, sameDurationRank + 1)

    found.push({ ref: { durationMs, sameDurationRank }, container })
  })

  return found
}
