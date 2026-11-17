export function sanitizeRequestUrl(originalUrl: string): string {
  try {
    const url = new URL(originalUrl, 'http://weshop.local')
    for (const key of new Set(url.searchParams.keys()))
      url.searchParams.set(key, '[redacted]')
    return `${url.pathname}${url.search}`
  }
  catch {
    return originalUrl.split('?')[0] ?? '/'
  }
}
