/**
 * Transcripts, kept so they survive scrolling.
 *
 * Instagram virtualises the thread: scroll a voice message out of view and
 * React destroys the bubble, taking our injected transcript with it. Coming
 * back re-creates it from scratch. Without a cache every clip would have to be
 * transcribed again each time it scrolled past.
 *
 * The key is `sentAtMs`, lifted from the clip's own CDN filename
 * (`audioclip-<sentAtMs>-<durationMs>.mp4`). That is the only stable identity
 * available — Instagram's markup carries no message id, no data attributes,
 * nothing but generated class names — and it is why this lives in the
 * background rather than the content script, which never sees the URL.
 *
 * `chrome.storage.local` rather than IndexedDB: this runs in a service worker,
 * the records are a few hundred bytes each against a 10MB quota, and there is
 * no schema to migrate.
 */

const PREFIX = 'transcript:'
/** Above this many stored transcripts, the oldest are dropped. */
const MAX_ENTRIES = 1000
const PRUNE_TO = 800

interface Entry {
  text: string
  /** When we stored it, used only for pruning. */
  at: number
}

const keyFor = (sentAtMs: number) => `${PREFIX}${sentAtMs}`

export async function get(sentAtMs: number): Promise<string | null> {
  const key = keyFor(sentAtMs)
  const stored = await chrome.storage.local.get(key)
  const entry = stored[key] as Entry | undefined
  return entry?.text ?? null
}

export async function set(sentAtMs: number, text: string): Promise<void> {
  await chrome.storage.local.set({ [keyFor(sentAtMs)]: { text, at: Date.now() } satisfies Entry })
  await prune()
}

/**
 * Keeps storage from growing without limit over years of use. Cheap because it
 * only does real work once past the cap.
 */
async function prune(): Promise<void> {
  const all = await chrome.storage.local.get(null)
  const entries = Object.entries(all).filter(([k]) => k.startsWith(PREFIX))
  if (entries.length <= MAX_ENTRIES) return

  const oldestFirst = entries.sort(
    ([, a], [, b]) => ((a as Entry).at ?? 0) - ((b as Entry).at ?? 0),
  )
  await chrome.storage.local.remove(
    oldestFirst.slice(0, entries.length - PRUNE_TO).map(([k]) => k),
  )
}
