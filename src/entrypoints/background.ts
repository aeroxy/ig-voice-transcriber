import { transcribe as speechToText } from '@/lib/quillbot'
import { getTimeoutMs } from '@/lib/settings'
import * as store from '@/lib/transcript-store'
import type { ClipRef, LookupResult, Request, TranscribeResult } from '@/types/messages'

console.log(`[IGVT] service worker init — v${__VERSION__}, built ${__BUILD_TIME__}`)

/**
 * Hosts Instagram serves voice clips from — the only places this worker will
 * fetch. The url arrives from the page's Relay store via our own content
 * script, so this is not a trust boundary; it is a check that a changed record
 * shape cannot send some other resource's bytes off-machine.
 */
const CLIP_HOST = /(^|\.)(fbsbx\.com|fbcdn\.net|cdninstagram\.com)$/

async function transcribe(clip: ClipRef, url: string): Promise<TranscribeResult> {
  if (!CLIP_HOST.test(new URL(url).hostname)) {
    return { ok: false, error: 'That does not look like an Instagram clip url.' }
  }

  // A clip scrolled out of view and back is a new set of DOM nodes but the same
  // message, so re-transcribing it would be wasted work and a wasted upload.
  const cached = await store.get(clip.fbid)
  if (cached) return { ok: true, text: cached }

  // One deadline for the whole round trip — download and upload both — because
  // that is the wait the user configured, and either fetch can be the one that
  // stalls. Read per request rather than cached: the worker outlives any one
  // transcription, and a value changed in the popup should apply to the next
  // click without waiting for a restart.
  const timeoutMs = await getTimeoutMs()
  const deadline = AbortSignal.timeout(timeoutMs)

  try {
    // Fetched here rather than in the content script: the clip is on a different
    // origin with no CORS headers, so a page-context fetch from instagram.com
    // fails outright. The worker fetches under `host_permissions` instead.
    const res = await fetch(url, { signal: deadline })
    if (!res.ok) return { ok: false, error: `Could not download the clip (HTTP ${res.status}).` }

    const audio = await res.arrayBuffer()
    const text = await speechToText(audio, navigator.language, deadline)
    await store.set(clip.fbid, text)
    return { ok: true, text }
  } catch (e) {
    // `TimeoutError` is what `AbortSignal.timeout` raises, and only it — a
    // `fetch` aborted any other way would surface as `AbortError`, so this
    // cannot mistake some other cancellation for the clock running out.
    if ((e as Error).name !== 'TimeoutError') throw e
    return {
      ok: false,
      error:
        `Timed out after ${Math.round(timeoutMs / 1000)}s. Try again, or raise the ` +
        'timeout from the extension’s toolbar icon.',
    }
  }
}

async function lookup(clip: ClipRef): Promise<LookupResult> {
  return { text: await store.get(clip.fbid) }
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
    if (message.type === 'LOOKUP') {
      lookup(message.clip).then(sendResponse, () =>
        sendResponse({ text: null } satisfies LookupResult),
      )
      return true
    }

    if (message.type === 'TRANSCRIBE') {
      transcribe(message.clip, message.url).then(sendResponse, (e: unknown) =>
        sendResponse({ ok: false, error: (e as Error).message } satisfies TranscribeResult),
      )
      return true
    }

    return false
  })
})
