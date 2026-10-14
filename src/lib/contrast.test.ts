/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { legibleColor, parseColor } from './contrast'

const rgb = (css: string) => {
  const c = parseColor(css)
  if (!c) throw new Error(`unparsed: ${css}`)
  return c
}

describe('parseColor', () => {
  test('reads the comma, alpha and space-slash forms', () => {
    expect(parseColor('rgb(239, 239, 239)')).toEqual({ r: 239, g: 239, b: 239, a: 1 })
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseColor('rgb(55 151 240 / 0.5)')).toEqual({ r: 55, g: 151, b: 240, a: 0.5 })
    expect(parseColor('rgb(55 151 240 / 50%)')?.a).toBe(0.5)
  })

  test('is null for anything that is not rgb', () => {
    expect(parseColor('transparent')).toBeNull()
    expect(parseColor('color(srgb 1 1 1)')).toBeNull()
  })
})

describe('legibleColor', () => {
  test('darkens near-white text on the incoming light grey bubble', () => {
    expect(legibleColor(rgb('rgb(250, 250, 250)'), rgb('rgb(239, 239, 239)'))).toBe('#262626')
  })

  test('leaves white on Instagram blue alone', () => {
    expect(legibleColor(rgb('rgb(255, 255, 255)'), rgb('rgb(55, 151, 240)'))).toBeNull()
  })

  test('lightens dark text on a dark bubble', () => {
    expect(legibleColor(rgb('rgb(38, 38, 38)'), rgb('rgb(38, 38, 38)'))).toBe('#ffffff')
  })

  test('leaves already-readable text alone', () => {
    expect(legibleColor(rgb('rgb(38, 38, 38)'), rgb('rgb(239, 239, 239)'))).toBeNull()
  })
})
