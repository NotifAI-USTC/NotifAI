import { describe, expect, it } from 'vitest'
import { isValidApiBaseUrl } from './apiBaseUrl'

const BUILD_ORIGIN = 'https://build.notifai.invalid'

describe('isValidApiBaseUrl', () => {
  it.each(['/api', '/api/v1/', 'https://api.example.test/v1'])(
    'accepts a clean HTTP API base: %s',
    (value) => {
      expect(isValidApiBaseUrl(value, BUILD_ORIGIN)).toBe(true)
    },
  )

  it.each([
    'api',
    '//api.example.test',
    'https://user:pass@api.example.test',
    'https://api.example.test?tenant=x',
    'https://api.example.test/#v1',
    '/api?tenant=x',
    '/api#v1',
  ])('rejects an ambiguous or unsafe API base: %s', (value) => {
    expect(isValidApiBaseUrl(value, BUILD_ORIGIN)).toBe(false)
  })
})
