/**
 * Transcripts, kept so they survive scrolling.
 *
 * Instagram virtualises the thread: scroll a voice message out of view and
 * React destroys the bubble, taking our injected transcript with it. Coming
 * back re-creates it from scratch. Without a cache every clip would have to be
 * transcribed again each time it scrolled past.
 *
 * The key is the attachment's fbid, which Instagram stamps into the waveform
 * SVG (`waveform-clip-path-<fbid>`) and which its Relay store files the audio
 * under. A quoted reply to a voice note carries the original's fbid, so the
 * quote shows the same transcript without a second upload.
 *
 * `chrome.storage.local` rather than IndexedDB: this runs in a service worker,
 * the records are a few hundred bytes each against a 10MB quota, and there is
 * no schema to migrate.
 */

const PREFIX = 'transcript:'
/** Above this many stored transcripts, the oldest are dropped. */
const MAX_ENTRIES = 1000
const PRUNE_TO = 800
/**
 * Writes tolerated between sweeps. Finding the oldest entries means reading
 * every key, so doing it on each save would put an O(all-storage) read on the
 * path of every transcription. Amortised instead: storage can overshoot the cap
 * by at most this much before a sweep brings it back down.
 */
const WRITES_PER_SWEEP = 200
const COUNTER_KEY = 'transcript_writes_since_sweep'

interface Entry {
  text: string
  /** When we stored it, used only for pruning. */
  at: number
}

const keyFor = (fbid: string) => `${PREFIX}${fbid}`

export async function get(fbid: string): Promise<string | null> {
  const key = keyFor(fbid)
  const stored = await chrome.storage.local.get(key)
  const entry = stored[key] as Entry | undefined
  return entry?.text ?? null
}

export async function set(fbid: string, text: string): Promise<void> {
  await chrome.storage.local.set({ [keyFor(fbid)]: { text, at: Date.now() } satisfies Entry })

  const { [COUNTER_KEY]: written } = await chrome.storage.local.get(COUNTER_KEY)
  const count = (typeof written === 'number' ? written : 0) + 1
  if (count < WRITES_PER_SWEEP) {
    await chrome.storage.local.set({ [COUNTER_KEY]: count })
    return
  }
  await chrome.storage.local.set({ [COUNTER_KEY]: 0 })
  await sweep()
}

/** Keeps storage from growing without limit over years of use. */
async function sweep(): Promise<void> {
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

/** How many transcripts are cached right now. */
export async function count(): Promise<number> {
  const all = await chrome.storage.local.get(null)
  return Object.keys(all).filter((k) => k.startsWith(PREFIX)).length
}

/**
 * Forget every cached transcript, and report how many went.
 *
 * Only this extension's own keys. Instagram's own storage is never touched, and
 * neither is the timeout setting — everything removed here is re-derivable by
 * pressing Transcribe again.
 */
export async function clearAll(): Promise<number> {
  const all = await chrome.storage.local.get(null)
  const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX))
  await chrome.storage.local.remove([...keys, COUNTER_KEY])
  return keys.length
}
