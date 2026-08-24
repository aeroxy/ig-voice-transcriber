/**
 * Message protocol.
 *
 *   instagram content script  →  background   LOOKUP, TRANSCRIBE
 */

/** A voice clip as the Instagram content script sees it. */
export interface ClipRef {
  /**
   * Clip length in whole milliseconds, read from the progress bar's
   * `aria-valuemax` (seconds) and rounded. This is the join key against the
   * audio URL, whose filename encodes the same number —
   * `audioclip-<sentAtMs>-<durationMs>.mp4`.
   */
  durationMs: number
  /**
   * 0-based rank of this clip *among clips sharing its `durationMs`*, in DOM
   * order. Two voice notes can round to the same millisecond length, so
   * duration alone is not a unique key; this disambiguates. Instagram appends
   * messages chronologically, so the k-th such clip in the DOM is the k-th by
   * the `sentAtMs` in its URL.
   */
  sameDurationRank: number
  /**
   * How many clips of this `durationMs` are rendered right now. The background
   * compares it against how many URLs it holds for that duration: if they
   * disagree, the thread is only partly rendered and the rank cannot be trusted,
   * so it refuses rather than risk attaching the wrong transcript.
   */
  sameDurationCount: number
  /** The DM thread this clip was found in, so a tab's other threads can't answer for it. */
  threadId: string | null
}

export type Request =
  /** Any transcript we already hold for this clip, so it survives scrolling. */
  | { type: 'LOOKUP'; clip: ClipRef }
  | { type: 'TRANSCRIBE'; clip: ClipRef }

export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string }

/** `text` is null when nothing is cached for that clip. */
export type LookupResult = { text: string | null }
