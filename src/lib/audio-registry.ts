import type { ClipRef } from '@/types/messages'

/**
 * Instagram's voice-clip URLs, learned by watching the requests Instagram makes.
 *
 * Why this exists: the URL is not in the DOM and not in IndexedDB (all ~30
 * stores checked — no hits for the CDN host or the media id). It only ever
 * appears as a network request. The good news is that Instagram *prefetches*
 * every clip when it renders a thread, so by the time the user clicks
 * Transcribe the URL has already gone past — no playback required.
 *
 * The filename carries everything needed to join it to a clip in the DOM:
 *
 *   …/audioclip-1787501302000-2769.mp4?…
 *                └ sentAtMs    └ durationMs
 */

const FILENAME = /audioclip-(\d+)-(\d+)\.mp4/

export interface Entry {
  sentAtMs: number
  durationMs: number
  url: string
}

/** Per tab, so two open threads can never hand each other's audio over. */
const byTab = new Map<number, Entry[]>()

/** Parse a candidate URL. Returns null for anything that isn't a voice clip. */
export function parseClipUrl(url: string): Entry | null {
  const m = FILENAME.exec(url)
  if (!m) return null
  const sentAtMs = Number(m[1])
  const durationMs = Number(m[2])
  if (!Number.isFinite(sentAtMs) || !Number.isFinite(durationMs)) return null
  return { sentAtMs, durationMs, url }
}

export function record(tabId: number, url: string): void {
  const entry = parseClipUrl(url)
  if (!entry) return

  const entries = byTab.get(tabId) ?? []
  // Instagram re-requests the same clip with different byte ranges and fresh
  // signatures; keyed on sentAtMs so we keep one (newest) URL per clip.
  const existing = entries.findIndex((e) => e.sentAtMs === entry.sentAtMs)
  if (existing === -1) entries.push(entry)
  else entries[existing] = entry
  byTab.set(tabId, entries)
}

/**
 * The entry for a clip the content script found, or null if we never saw it.
 * `sentAtMs` comes back too: it is the clip's stable identity, which is what the
 * transcript cache is keyed on.
 *
 * Chronological order is the link: Instagram appends messages in time order, so
 * the k-th clip of a given duration in the DOM is the k-th by `sentAtMs`.
 */
export function resolve(tabId: number, clip: ClipRef): Entry | null {
  const candidates = (byTab.get(tabId) ?? [])
    .filter((e) => e.durationMs === clip.durationMs)
    .sort((a, b) => a.sentAtMs - b.sentAtMs)
  return candidates[clip.sameDurationRank] ?? null
}

/** A navigated-away tab's URLs are stale and its signatures expire; drop them. */
export function forget(tabId: number): void {
  byTab.delete(tabId)
}
