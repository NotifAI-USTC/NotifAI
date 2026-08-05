export function isValidApiBaseUrl(value: unknown, baseOrigin: string): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false

  const isAbsolute = /^https?:\/\//i.test(trimmed)
  const isRootRelative =
    trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('\\')
  if (!isAbsolute && !isRootRelative) return false

  try {
    const parsed = new URL(trimmed, baseOrigin)
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    )
  } catch {
    return false
  }
}
