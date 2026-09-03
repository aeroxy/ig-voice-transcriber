import * as registry from '@/lib/audio-registry'
import { transcribe as speechToText } from '@/lib/quillbot'
import * as store from '@/lib/transcript-store'
import type { ClipRef, LookupResult, Request, TranscribeResult } from '@/types/messages'

console.log(`[IGVT] service worker init — v${__VERSION__}, built ${__BUILD_TIME__}`)

/** Hosts Instagram serves voice clips from. */
const CLIP_HOSTS = ['*://*.fbsbx.com/*', '*://*.fbcdn.net/*', '*://*.cdninstagram.com/*']

async function transcribe(clip: ClipRef): Promise<TranscribeResult> {
  const entry = await registry.resolve(clip)
  if (!entry) {
    // Deliberately not "reload the thread": a reload is served from the
    // renderer's memory cache, so it re-requests nothing and the worker learns
    // nothing. A new tab starts with an empty memory cache and does re-request.
    return {
      ok: false,
      error: 'Could not find this clip’s audio. Open the thread in a new tab, then try again.',
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

async function lookup(clip: ClipRef): Promise<LookupResult> {
  const entry = await registry.resolve(clip)
  return { text: entry ? await store.get(entry.sentAtMs) : null }
}

export default defineBackground(() => {
  // Observational only — we never block or modify. This is the sole way to learn
  // a clip's URL; see src/lib/audio-registry.ts for why.
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      // The thread has to come from the tab. Chrome's request details carry no
      // `documentUrl` — that is a Firefox extension to webRequest — and
      // `initiator` is only an origin, so neither can say which conversation
      // asked for the clip. Instagram switches threads by pushState, which
      // updates the tab's url before it fetches, so the tab is current.
      //
      // Parsed first because these hosts also serve every avatar and photo in
      // the thread, and only voice clips are worth a tabs.get round trip.
      if (details.tabId < 0 || !registry.parseClipUrl(details.url)) return
      void chrome.tabs
        .get(details.tabId)
        .then((tab) => registry.record(details.url, tab.url))
        .catch((e: unknown) => console.error('[IGVT] failed to record a clip URL:', e))
    },
    { urls: CLIP_HOSTS },
  )

  chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
    if (message.type === 'LOOKUP') {
      lookup(message.clip).then(sendResponse, () =>
        sendResponse({ text: null } satisfies LookupResult),
      )
      return true
    }

    if (message.type === 'TRANSCRIBE') {
      transcribe(message.clip).then(sendResponse, (e: unknown) =>
        sendResponse({ ok: false, error: (e as Error).message } satisfies TranscribeResult),
      )
      return true
    }

    return false
  })
})
