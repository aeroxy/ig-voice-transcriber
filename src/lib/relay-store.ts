/**
 * Where the audio URL actually lives: Instagram's Relay store.
 *
 * It is in neither the DOM nor IndexedDB, and an earlier version of this
 * extension watched `webRequest` for it and joined on clip duration — a weak
 * key, and one that a reload could never re-learn because Blink's memory cache
 * answers the clip without a request. The store makes all of that unnecessary.
 * Instagram renders each voice note from an `XFBSlideAudioAttachment` record:
 *
 *   {
 *     __typename:           'XFBSlideAudioAttachment',
 *     attachment_fbid:      '2477997293023062',
 *     playable_duration_ms: 17865,
 *     attachment_cdn_url:   'https://cdn.fbsbx.com/…/audioclip-….mp4?…',
 *   }
 *
 * and stamps the same `attachment_fbid` into the bubble's waveform SVG as
 * `<clipPath id="waveform-clip-path-<fbid>">`. That is an exact key from bubble
 * to url, present the moment the bubble renders, with nothing to observe and
 * nothing to rank.
 *
 * The store is a page-world object, so only the main-world script can read it;
 * this module is the pure part, kept apart so it can be tested with a fake
 * source. A linear scan is fine: a thread's store holds a few thousand records.
 */

/** The slice of Relay's `RecordSource` we touch. */
export interface RecordSourceLike {
  getRecordIDs(): string[]
  get(id: string): Record<string, unknown> | null | undefined
}

const AUDIO_TYPENAME = 'XFBSlideAudioAttachment'

/** The CDN url for an audio attachment, or null if the store has no such record. */
export function audioUrlFor(source: RecordSourceLike, fbid: string): string | null {
  for (const id of source.getRecordIDs()) {
    const record = source.get(id)
    if (record?.__typename !== AUDIO_TYPENAME || record.attachment_fbid !== fbid) continue
    // A record for this fbid without a url yet is not the answer; another
    // message carrying the same attachment may hold it, so keep looking.
    const url = record.attachment_cdn_url
    if (typeof url === 'string') return url
  }
  return null
}
