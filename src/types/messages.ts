/**
 * Message protocol.
 *
 *   instagram content script  →  background          LOOKUP, TRANSCRIBE
 *   instagram content script  ↔  main-world script   URL_REQUEST_EVENT / URL_REPLY_EVENT
 */

/** A voice clip as the Instagram content script sees it. */
export interface ClipRef {
  /**
   * Instagram's own id for the audio attachment, read off the bubble's waveform
   * (`<clipPath id="waveform-clip-path-<fbid>">`). The page's Relay store holds
   * the clip's CDN url under the same `attachment_fbid`, so this is both the
   * join key to the audio and the key the transcript cache uses. A quoted reply
   * to a voice note renders a second waveform with the same fbid: same audio,
   * same transcript.
   */
  fbid: string
}

export type Request =
  /** Any transcript we already hold for this clip, so it survives scrolling. */
  | { type: 'LOOKUP'; clip: ClipRef }
  /** `url` was resolved in the page — see `audioUrlFor` in the content script. */
  | { type: 'TRANSCRIBE'; clip: ClipRef; url: string }

export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string }

export interface LookupResult {
  text: string | null
}

/**
 * DOM events between the isolated content script and the main-world script,
 * which is the only place the Relay store can be read from. Details are JSON
 * strings: a primitive crosses the world boundary intact, an object does not.
 */
export const URL_REQUEST_EVENT = 'igvt:url-request'
export const URL_REPLY_EVENT = 'igvt:url-reply'

export interface UrlRequest {
  fbid: string
}

export interface UrlReply {
  fbid: string
  /** Null when the store has no record for the fbid yet. */
  url: string | null
}
