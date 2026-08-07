import { describe, expect, it } from 'vitest'
import { getContrastTextColor } from './color'

describe('getContrastTextColor', () => {
  it('returns dark text for light backgrounds', () => {
    expect(getContrastTextColor('#ffffff')).toBe('#000000')
    expect(getContrastTextColor('#f5f5f5')).toBe('#000000')
  })

  it('returns white text for dark backgrounds', () => {
    expect(getContrastTextColor('#0d0d0d')).toBe('#ffffff')
    expect(getContrastTextColor('#1c1c1e')).toBe('#ffffff')
  })

  it('keeps dark text on medium-bright primary colors', () => {
    expect(getContrastTextColor('#4a6cf7')).toBe('#000000')
  })

  it('falls back to white for invalid input', () => {
    expect(getContrastTextColor('not-a-color')).toBe('#ffffff')
    expect(getContrastTextColor('#12')).toBe('#ffffff')
  })
})
