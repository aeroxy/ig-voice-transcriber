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
 *
 * Kept in `chrome.storage.session`, not a module-level Map. Instagram
 * prefetches when the thread renders, and the user might not click Transcribe
 * for minutes — by which time Chrome has terminated the service worker and any
 * in-memory state with it, leaving every clip unresolvable until the thread was
 * reloaded. Session storage survives that, and still clears on browser restart,
 * which suits URLs whose signatures expire anyway.
 *
 * Keyed by thread rather than by tab, and never dropped on navigation. Both
 * follow from the same measured fact: **a reload does not re-issue the
 * request.** Blink's per-renderer memory cache answers the clip on a reload
 * without going through the network stack, so `webRequest` never sees it again
 * — verified live, a first load logged the clip and every subsequent reload of
 * that tab logged nothing. Anything discarded on reload is therefore gone for
 * good, which is what made "Reload the thread, then try again" the one action
 * guaranteed not to help. A fresh tab is a fresh memory cache and does re-issue
 * the request, and keying on the thread means that tab's observation answers
 * every other tab showing the same conversation.
 */

const FILENAME = /audioclip-(\d+)-(\d+)\.mp4/
const THREAD_PATH = /\/direct\/t\/(\d+)/

export interface Entry {
  sentAtMs: number
  durationMs: number
  url: string
}

/** The thread id out of an Instagram DM URL, or null if there isn't one. */
export function parseThreadId(url: string | undefined): string | null {
  return (url && THREAD_PATH.exec(url)?.[1]) || null
}

/**
 * Per thread, so two conversations can never hand each other's audio over. An
 * entry that cannot be attributed to a thread has no key and is dropped, rather
 * than kept as a wildcard that some other conversation's lookup could match.
 */
const keyFor = (threadId: string) => `clips:${threadId}`

/**
 * Instagram prefetches several clips at once, so `record` can be re-entered
 * before an earlier read-modify-write has finished. Serialised, because
 * concurrent writers would each read the same array and the last one to land
 * would silently drop the others' entries.
 */
let writes: Promise<unknown> = Promise.resolve()

/** Parse a candidate URL. Returns null for anything that isn't a voice clip. */
export function parseClipUrl(url: string): Entry | null {
  const m = FILENAME.exec(url)
  if (!m) return null
  const sentAtMs = Number(m[1])
  const durationMs = Number(m[2])
  if (!Number.isFinite(sentAtMs) || !Number.isFinite(durationMs)) return null
  return { sentAtMs, durationMs, url }
}

async function read(threadId: string): Promise<Entry[]> {
  const key = keyFor(threadId)
  const stored = await chrome.storage.session.get(key)
  return (stored[key] as Entry[] | undefined) ?? []
}

/** `pageUrl` is the thread that asked for the clip — see `record` in background. */
export function record(url: string, pageUrl: string | undefined): Promise<void> {
  const entry = parseClipUrl(url)
  const threadId = parseThreadId(pageUrl)
  if (!entry || !threadId) return Promise.resolve()

  writes = writes.then(async () => {
    const entries = await read(threadId)
    // Instagram re-requests the same clip with different byte ranges and fresh
    // signatures; keyed on sentAtMs so we keep one (newest) URL per clip.
    const existing = entries.findIndex((e) => e.sentAtMs === entry.sentAtMs)
    if (existing === -1) entries.push(entry)
    else entries[existing] = entry
    await chrome.storage.session.set({ [keyFor(threadId)]: entries })
  })
  return writes.then(() => undefined)
}

/**
 * The entry for a clip the content script found, or null if we cannot identify
 * it with confidence. `sentAtMs` comes back too: it is the clip's stable
 * identity, which is what the transcript cache is keyed on.
 *
 * Chronological order is the link: Instagram appends messages in time order, so
 * the k-th clip of a given duration in the DOM is the k-th by `sentAtMs`.
 */
export async function resolve(clip: ClipRef): Promise<Entry | null> {
  if (!clip.threadId) return null

  const candidates = (await read(clip.threadId))
    .filter((e) => e.durationMs === clip.durationMs)
    .sort((a, b) => a.sentAtMs - b.sentAtMs)

  // Ranking only means something when the DOM and our URL list agree on how
  // many clips of this length exist. They can disagree, because the thread is
  // virtualised and only part of it is rendered — and then the k-th rendered
  // clip is not the k-th URL.
  if (candidates.length === clip.sameDurationCount) return candidates[clip.sameDurationRank] ?? null

  // One known URL and several clips of that length is the case worth answering
  // rather than refusing, and it is what a forwarded voice note looks like:
  // Instagram serves the same CDN object for the original and the forward, so
  // two bubbles share one URL and no amount of watching produces a second.
  // Observed on a live thread — two 17.865 s messages, six requests, one
  // filename. There is nothing to rank, so ranking cannot go wrong; the only
  // way to be wrong is two genuinely different recordings agreeing to the
  // millisecond while one of their URLs went unseen, and the damage is then a
  // confusing transcript on a neighbouring bubble of the same conversation the
  // reader is already looking at — not the cross-thread leak this guard exists
  // for, which the thread key above prevents outright.
  return candidates.length === 1 ? candidates[0]! : null
}
