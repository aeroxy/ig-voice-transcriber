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
 */

const FILENAME = /audioclip-(\d+)-(\d+)\.mp4/
const THREAD_PATH = /\/direct\/t\/(\d+)/

export interface Entry {
  sentAtMs: number
  durationMs: number
  url: string
  /**
   * The thread the clip was fetched for, or null when the requesting document
   * could not be determined. Switching threads is a same-tab SPA navigation, so
   * `forget()` never fires for it and a tab's entries would otherwise accumulate
   * across every thread visited — letting one thread's clip answer another's
   * lookup.
   */
  threadId: string | null
}

/** The thread id out of an Instagram DM URL, or null if there isn't one. */
export function parseThreadId(url: string | undefined): string | null {
  return (url && THREAD_PATH.exec(url)?.[1]) || null
}

/** Per tab, so two open threads can never hand each other's audio over. */
const keyFor = (tabId: number) => `clips:${tabId}`

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
  return { sentAtMs, durationMs, url, threadId: null }
}

async function read(tabId: number): Promise<Entry[]> {
  const key = keyFor(tabId)
  const stored = await chrome.storage.session.get(key)
  return (stored[key] as Entry[] | undefined) ?? []
}

export function record(tabId: number, url: string, documentUrl?: string): Promise<void> {
  const entry = parseClipUrl(url)
  if (!entry) return Promise.resolve()
  entry.threadId = parseThreadId(documentUrl)

  writes = writes.then(async () => {
    const entries = await read(tabId)
    // Instagram re-requests the same clip with different byte ranges and fresh
    // signatures; keyed on sentAtMs so we keep one (newest) URL per clip.
    const existing = entries.findIndex((e) => e.sentAtMs === entry.sentAtMs)
    if (existing === -1) entries.push(entry)
    else entries[existing] = entry
    await chrome.storage.session.set({ [keyFor(tabId)]: entries })
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
export async function resolve(tabId: number, clip: ClipRef): Promise<Entry | null> {
  const candidates = (await read(tabId))
    .filter((e) => e.durationMs === clip.durationMs && sameThread(e.threadId, clip.threadId))
    .sort((a, b) => a.sentAtMs - b.sentAtMs)

  // Ranking only means something when the DOM and our URL list agree on how
  // many clips of this length exist. They can disagree, because the thread is
  // virtualised and only part of it is rendered — and then the k-th rendered
  // clip is not the k-th URL, so we would attach one person's transcript to
  // another message. Refuse instead: a visible failure beats a silent swap.
  if (candidates.length !== clip.sameDurationCount) return null

  return candidates[clip.sameDurationRank] ?? null
}

/**
 * Lenient when either side is unknown rather than refusing outright: a missing
 * `documentUrl` should not make a clip permanently unresolvable, and the
 * same-duration count check below still guards against a wrong match.
 */
function sameThread(a: string | null, b: string | null): boolean {
  return a === null || b === null || a === b
}

/** A navigated-away tab's URLs are stale and its signatures expire; drop them. */
export async function forget(tabId: number): Promise<void> {
  await chrome.storage.session.remove(keyFor(tabId))
}
