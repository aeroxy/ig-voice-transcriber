import { parseThreadId } from '@/lib/audio-registry'
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
  const staged: { durationMs: number; container: HTMLElement }[] = []

  for (const waveform of root.querySelectorAll(WAVEFORM)) {
    const container = bubbleFor(waveform)
    if (!container) continue

    const bar = container.querySelector(PROGRESS_BAR)
    const seconds = Number(bar?.getAttribute('aria-valuemax'))
    // A clip still being laid out reports 0 or NaN; skip it and catch it on a
    // later mutation, rather than registering an unjoinable duration.
    if (!Number.isFinite(seconds) || seconds <= 0) continue

    staged.push({ durationMs: Math.round(seconds * 1000), container })
  }

  // Counted before ranked, because each clip carries the total for its own
  // duration — that total is what lets the background tell "this is the only
  // clip of this length" from "the thread is half virtualised away".
  const totals = new Map<number, number>()
  for (const { durationMs } of staged) {
    totals.set(durationMs, (totals.get(durationMs) ?? 0) + 1)
  }

  const ranks = new Map<number, number>()
  const threadId = parseThreadId(location.href)
  return staged.map(({ durationMs, container }) => {
    const sameDurationRank = ranks.get(durationMs) ?? 0
    ranks.set(durationMs, sameDurationRank + 1)
    return {
      ref: {
        durationMs,
        sameDurationRank,
        sameDurationCount: totals.get(durationMs) ?? 1,
        threadId,
      },
      container,
    }
  })
}
