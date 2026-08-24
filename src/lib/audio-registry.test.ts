/// <reference types="bun" />
import { beforeEach, describe, expect, test } from 'bun:test'

import type { ClipRef } from '@/types/messages'
import { parseClipUrl, parseThreadId, record, resolve } from './audio-registry'

/**
 * A stand-in for `chrome.storage.session`, and the point of these tests.
 *
 * The registry used to hold its entries in a module-level Map. Chrome terminates
 * an MV3 service worker after roughly 30 seconds idle, so a thread read for a
 * couple of minutes before clicking Transcribe lost every URL Instagram had
 * prefetched, and the clip became unresolvable until the page was reloaded.
 * Keeping the store *outside* the module is what proves the fix: nothing below
 * relies on state that a restart would take with it.
 */
const store = new Map<string, unknown>()

const fakeStorage = {
  get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
  set: async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) store.set(k, v)
  },
  remove: async (key: string) => void store.delete(key),
}

beforeEach(() => {
  store.clear()
  ;(globalThis as unknown as { chrome: unknown }).chrome = { storage: { session: fakeStorage } }
})

const TAB = 7
const clipUrl = (sentAtMs: number, durationMs: number) =>
  `https://cdn.fbsbx.com/v/t59.3654-21/x_n.mp4/audioclip-${sentAtMs}-${durationMs}.mp4?oh=abc`
const thread = (id: string) => `https://www.instagram.com/direct/t/${id}/`

const clip = (over: Partial<ClipRef> = {}): ClipRef => ({
  durationMs: 2769,
  sameDurationRank: 0,
  sameDurationCount: 1,
  threadId: '111',
  ...over,
})

describe('parseClipUrl', () => {
  test('lifts the timestamps out of the filename', () => {
    expect(parseClipUrl(clipUrl(1787501302000, 2769))).toMatchObject({
      sentAtMs: 1787501302000,
      durationMs: 2769,
    })
  })

  test('ignores anything that is not a voice clip', () => {
    expect(parseClipUrl('https://cdn.fbsbx.com/v/t59/photo.jpg')).toBeNull()
  })
})

describe('parseThreadId', () => {
  test('reads the id out of a DM url', () => {
    expect(parseThreadId(thread('17842113803205196'))).toBe('17842113803205196')
  })

  test('is null off a thread page', () => {
    expect(parseThreadId('https://www.instagram.com/direct/inbox/')).toBeNull()
    expect(parseThreadId(undefined)).toBeNull()
  })
})

describe('resolve', () => {
  test('survives the worker being torn down between record and resolve', async () => {
    await record(TAB, clipUrl(1000, 2769), thread('111'))

    // Everything the registry knows is in the store, so a fresh worker — which
    // is what an empty module scope amounts to — can still answer.
    expect(store.size).toBe(1)
    const found = await resolve(TAB, clip())
    expect(found?.sentAtMs).toBe(1000)
  })

  test('will not answer with a clip from another thread in the same tab', async () => {
    // Switching threads is an SPA navigation, so nothing clears the tab's
    // entries; both threads' clips sit in the same bucket.
    await record(TAB, clipUrl(1000, 2769), thread('111'))
    await record(TAB, clipUrl(2000, 2769), thread('222'))

    expect((await resolve(TAB, clip({ threadId: '111' })))?.sentAtMs).toBe(1000)
    expect((await resolve(TAB, clip({ threadId: '222' })))?.sentAtMs).toBe(2000)
  })

  test('keeps one url per clip when Instagram re-requests it', async () => {
    await record(TAB, clipUrl(1000, 2769), thread('111'))
    await record(TAB, `${clipUrl(1000, 2769)}&bytestart=818`, thread('111'))

    const found = await resolve(TAB, clip())
    expect(found?.url).toContain('bytestart=818')
  })

  test('refuses rather than guess when the rendered count disagrees', async () => {
    // Two clips of identical length exist, but the thread is virtualised and
    // only one is on screen. The k-th rendered clip is then not the k-th url, so
    // ranking would attach one message's transcript to another.
    await record(TAB, clipUrl(1000, 2769), thread('111'))
    await record(TAB, clipUrl(2000, 2769), thread('111'))

    expect(await resolve(TAB, clip({ sameDurationCount: 1 }))).toBeNull()
    // With both rendered, the ranking is meaningful again.
    expect((await resolve(TAB, clip({ sameDurationCount: 2, sameDurationRank: 1 })))?.sentAtMs).toBe(2000)
  })

  test('is null for a duration it never saw', async () => {
    await record(TAB, clipUrl(1000, 2769), thread('111'))
    expect(await resolve(TAB, clip({ durationMs: 9999 }))).toBeNull()
  })

  test('does not leak between tabs', async () => {
    await record(TAB, clipUrl(1000, 2769), thread('111'))
    expect(await resolve(TAB + 1, clip())).toBeNull()
  })
})
