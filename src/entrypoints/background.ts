import * as registry from '@/lib/audio-registry'
import { transcribe as speechToText } from '@/lib/quillbot'
import * as store from '@/lib/transcript-store'
import type { ClipRef, LookupResult, Request, TranscribeResult } from '@/types/messages'

console.log(`[IGVT] service worker init — v${__VERSION__}, built ${__BUILD_TIME__}`)

/** Hosts Instagram serves voice clips from. */
const CLIP_HOSTS = ['*://*.fbsbx.com/*', '*://*.fbcdn.net/*', '*://*.cdninstagram.com/*']

async function transcribe(tabId: number, clip: ClipRef): Promise<TranscribeResult> {
  const entry = await registry.resolve(tabId, clip)
  if (!entry) {
    return {
      ok: false,
      error: 'Could not find this clip’s audio. Reload the thread, then try again.',
    }
  }

  // A clip scrolled out of view and back is a new set of DOM nodes but the same
  // message, so re-transcribing it would be wasted work and a wasted upload.
  const cached = await store.get(entry.sentAtMs)
  if (cached) return { ok: true, text: cached }

  // Fetched here rather than in the content script: the clip is on a different
  // origin with no CORS headers, so a page-context fetch from instagram.com
  // fails outright. The worker fetches under `host_permissions` instead.
  const res = await fetch(entry.url)
  if (!res.ok) return { ok: false, error: `Could not download the clip (HTTP ${res.status}).` }

  const text = await speechToText(await res.arrayBuffer(), navigator.language)
  await store.set(entry.sentAtMs, text)
  return { ok: true, text }
}

async function lookup(tabId: number, clip: ClipRef): Promise<LookupResult> {
  const entry = await registry.resolve(tabId, clip)
  return { text: entry ? await store.get(entry.sentAtMs) : null }
}

export default defineBackground(() => {
  // Observational only — we never block or modify. This is the sole way to learn
  // a clip's URL; see src/lib/audio-registry.ts for why.
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0) return
      // `documentUrl` is the page that asked for the clip — i.e. the thread —
      // so the thread id comes for free, with no tabs.get round trip. Cast
      // because @types/chrome has not caught up with the API; it is optional at
      // runtime too, and the registry treats a missing one as "unknown thread".
      const { documentUrl } = details as typeof details & { documentUrl?: string }
      void registry.record(details.tabId, details.url, documentUrl).catch((e: unknown) =>
        console.error('[IGVT] failed to record a clip URL:', e),
      )
    },
    { urls: CLIP_HOSTS },
  )

  chrome.tabs.onRemoved.addListener((tabId) => void registry.forget(tabId))
  // A thread switch is a same-tab SPA navigation, but a real reload invalidates
  // every signed URL we hold for that tab.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading' && info.url) void registry.forget(tabId)
  })

  chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
    const tabId = sender.tab?.id

    if (message.type === 'LOOKUP') {
      if (tabId === undefined) {
        sendResponse({ text: null } satisfies LookupResult)
        return false
      }
      lookup(tabId, message.clip).then(sendResponse, () =>
        sendResponse({ text: null } satisfies LookupResult),
      )
      return true
    }

    if (message.type === 'TRANSCRIBE') {
      if (tabId === undefined) {
        sendResponse({ ok: false, error: 'No tab context.' } satisfies TranscribeResult)
        return false
      }
      transcribe(tabId, message.clip).then(sendResponse, (e: unknown) =>
        sendResponse({ ok: false, error: (e as Error).message } satisfies TranscribeResult),
      )
      return true
    }

    return false
  })
})
