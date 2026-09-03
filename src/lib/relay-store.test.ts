/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { audioUrlFor, type RecordSourceLike } from './relay-store'

const source = (records: Record<string, Record<string, unknown>>): RecordSourceLike => ({
  getRecordIDs: () => Object.keys(records),
  get: (id) => records[id],
})

const audio = (fbid: string, url: string) => ({
  __typename: 'XFBSlideAudioAttachment',
  attachment_fbid: fbid,
  playable_duration_ms: 17865,
  attachment_cdn_url: url,
})

describe('audioUrlFor', () => {
  test('finds the attachment by fbid', () => {
    const src = source({
      'client:SlideMessage:mid.a:content:audio_attachments:0': audio('111', 'https://cdn/a.mp4'),
      'client:SlideMessage:mid.b:content:audio_attachments:0': audio('222', 'https://cdn/b.mp4'),
    })
    expect(audioUrlFor(src, '222')).toBe('https://cdn/b.mp4')
  })

  test('is null when the store has not loaded the attachment', () => {
    const src = source({
      'client:root': { __typename: 'Query' },
      'client:SlideMessage:mid.a:content:audio_attachments:0': audio('111', 'https://cdn/a.mp4'),
    })
    expect(audioUrlFor(src, '999')).toBeNull()
  })

  test('skips a record for the fbid that has no url and takes the next', () => {
    const src = source({
      'client:SlideMessage:mid.a:content:audio_attachments:0': {
        __typename: 'XFBSlideAudioAttachment',
        attachment_fbid: '111',
      },
      'client:SlideMessage:mid.b:content:audio_attachments:0': audio('111', 'https://cdn/a.mp4'),
    })
    expect(audioUrlFor(src, '111')).toBe('https://cdn/a.mp4')
  })

  test('ignores records of other types that happen to carry the same id', () => {
    const src = source({
      'client:SlideMessage:mid.a:content:image_attachments:0': {
        __typename: 'XFBSlideImageAttachment',
        attachment_fbid: '111',
        attachment_cdn_url: 'https://cdn/a.jpg',
      },
    })
    expect(audioUrlFor(src, '111')).toBeNull()
  })
})
