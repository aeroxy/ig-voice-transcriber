import { audioUrlFor, type RecordSourceLike } from '@/lib/relay-store'
import { URL_REPLY_EVENT, URL_REQUEST_EVENT, type UrlReply, type UrlRequest } from '@/types/messages'

/**
 * The one piece that has to run in the page's own world: reading Instagram's
 * Relay store. See src/lib/relay-store.ts for what is in it and why.
 *
 * A main-world script has no extension APIs, so it does not talk to the
 * background. It answers the isolated content script over DOM events instead,
 * and answers *synchronously* — `dispatchEvent` runs listeners inline, so the
 * asking side has its reply by the time its own dispatch returns.
 */

/** Meta's module loader, a global in the page. */
interface PageWindow {
  require?: (name: string) => unknown
}

interface RelayEnvironmentLike {
  getStore(): { getSource(): RecordSourceLike }
}

function recordSource(): RecordSourceLike | null {
  const require = (window as unknown as PageWindow).require
  if (typeof require !== 'function') return null
  try {
    return (require('PolarisRelayEnvironment') as RelayEnvironmentLike).getStore().getSource()
  } catch {
    // Module renamed, or not yet defined. Either way there is nothing to read.
    return null
  }
}

export default defineContentScript({
  matches: ['*://*.instagram.com/direct/*'],
  world: 'MAIN',
  // Before the isolated script, which runs at document_idle: Chrome injects all
  // document_start scripts first, so the listener is guaranteed to exist by the
  // time anything can ask. The store itself is only read on request.
  runAt: 'document_start',
  main() {
    window.addEventListener(URL_REQUEST_EVENT, (e) => {
      const { fbid } = JSON.parse((e as CustomEvent<string>).detail) as UrlRequest
      const source = recordSource()
      const reply: UrlReply = { fbid, url: source ? audioUrlFor(source, fbid) : null }
      window.dispatchEvent(new CustomEvent(URL_REPLY_EVENT, { detail: JSON.stringify(reply) }))
    })
  },
})
