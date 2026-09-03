/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { parseFbid } from './clips'

describe('parseFbid', () => {
  test('lifts the attachment id out of the waveform clipPath', () => {
    expect(parseFbid('waveform-clip-path-2477997293023062')).toBe('2477997293023062')
  })

  test('is null for any other id', () => {
    expect(parseFbid('waveform-clip-path-')).toBeNull()
    expect(parseFbid('some-other-clip-path-123')).toBeNull()
  })
})
