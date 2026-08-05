function resolveAppBaseUrl(
  baseUrl = import.meta.env.BASE_URL,
  locationHref = window.location.href,
): URL {
  const url = new URL(baseUrl, locationHref)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

export function buildNoticeUrl(
  id: string,
  baseUrl = import.meta.env.BASE_URL,
  locationHref = window.location.href,
): string {
  const url = resolveAppBaseUrl(baseUrl, locationHref)
  url.hash = `/detail/${encodeURIComponent(id)}`
  return url.href
}

export function resolveAppAssetUrl(
  path: string,
  baseUrl = import.meta.env.BASE_URL,
  locationHref = window.location.href,
): string {
  return new URL(path.replace(/^\/+/, ''), resolveAppBaseUrl(baseUrl, locationHref)).href
}
