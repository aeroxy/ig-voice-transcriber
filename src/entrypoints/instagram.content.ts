import { findClips, MOUNTED_ATTR } from '@/lib/clips'
import type { ClipRef, LookupResult, TranscribeResult } from '@/types/messages'

/**
 * Puts a working Transcribe control on every voice message in a thread.
 *
 * Instagram ships its own transcription and, at least for this account, it is
 * broken server-side: the mutation returns
 * `xig_media_message_transcription: null` with a CRITICAL `field_exception`,
 * `is_transient: false`, `allow_user_retry: false` — so its own "try again" can
 * never succeed. The audio is fine (standard MP4/HE-AAC, decodes cleanly), so
 * all that's missing is a transcriber that works.
 */

const STYLE_ID = 'igvt-styles'
const ROW_CLASS = 'igvt-row'

/**
 * Everything inherits the bubble's own colour instead of picking one.
 * Instagram's outgoing bubbles are a saturated blue with white text and its
 * incoming bubbles are light grey with near-black text, so any fixed colour is
 * illegible against one of them. `inherit` is right for both.
 */
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .igvt-block { display:block; width:100%; color:inherit; }
    .igvt-row { display:block; margin-top:2px; font-size:12px; line-height:1.4; color:inherit; }
    .igvt-btn {
      border:0; background:none; padding:0; font:inherit; color:inherit;
      cursor:pointer; opacity:.85; text-decoration:underline;
    }
    .igvt-btn:hover { opacity:1; }
    .igvt-btn[disabled] { cursor:default; text-decoration:none; opacity:.6; }
    .igvt-text { margin-top:2px; font-size:13px; line-height:1.45; color:inherit; white-space:pre-wrap; }
    .igvt-err { margin-top:2px; font-size:12px; line-height:1.4; color:inherit; opacity:.75; }
  `
  document.head.appendChild(style)
}

function showTranscript(output: HTMLElement, text: string): void {
  output.className = 'igvt-text'
  output.textContent = text
}

async function mount(container: HTMLElement, clip: ClipRef): Promise<void> {
  container.setAttribute(MOUNTED_ATTR, '1')

  const row = document.createElement('div')
  row.className = ROW_CLASS
  const output = document.createElement('div')

  const block = document.createElement('div')
  block.className = 'igvt-block'
  block.append(row, output)
  // The container is the column that stacks the player over Instagram's own
  // transcription line, so appending puts us directly beneath that line.
  container.append(block)

  // Ask for an existing transcript before offering to fetch one. Scrolling a
  // clip out of view and back destroys these nodes and runs mount() again, so
  // without this every clip would show "Transcribe" afresh however many times
  // it had already been transcribed.
  let cached: string | null = null
  try {
    cached = ((await chrome.runtime.sendMessage({ type: 'LOOKUP', clip })) as LookupResult).text
  } catch {
    // Extension reloaded under a live page, or worker restarting. Fall through
    // and offer the button.
  }
  if (cached) {
    showTranscript(output, cached)
    return
  }

  const button = document.createElement('button')
  button.className = 'igvt-btn'
  button.textContent = 'Transcribe'
  row.appendChild(button)

  button.addEventListener('click', async () => {
    button.disabled = true
    button.textContent = 'Transcribing…'
    output.className = ''
    output.textContent = ''

    let result: TranscribeResult
    try {
      result = (await chrome.runtime.sendMessage({ type: 'TRANSCRIBE', clip })) as TranscribeResult
    } catch (e) {
      // Almost always the worker being replaced mid-call, or the extension
      // having been reloaded under a page that still holds the old context.
      result = { ok: false, error: `Extension not reachable: ${(e as Error).message}` }
    }

    if (result.ok) {
      showTranscript(output, result.text)
      row.remove()
      return
    }

    output.className = 'igvt-err'
    output.textContent = result.error
    button.disabled = false
    button.textContent = 'Retry'
  })
}

function scan(): void {
  for (const { ref, container } of findClips()) {
    // The attribute alone is not enough: this markup is React-owned, so a
    // re-render can drop our nodes while leaving the attribute behind. Checking
    // for the row means we simply remount when that happens.
    if (container.hasAttribute(MOUNTED_ATTR) && container.querySelector('.igvt-block')) {
      continue
    }
    mount(container, ref).catch((e: unknown) =>
      console.error('[IGVT] failed to mount a clip:', e),
    )
  }
}

export default defineContentScript({
  matches: ['*://*.instagram.com/direct/*'],
  runAt: 'document_idle',
  main() {
    injectStyles()
    scan()

    // The thread is virtualised and messages arrive over the socket, so clips
    // appear long after load. Debounced because Instagram mutates constantly.
    let queued = 0
    const observer = new MutationObserver(() => {
      clearTimeout(queued)
      queued = window.setTimeout(scan, 250)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  },
})
