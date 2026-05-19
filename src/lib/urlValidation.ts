const SUPPORTED_URL_PROTOCOLS = new Set(['http:', 'https:']);

export function parseSupportedHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return SUPPORTED_URL_PROTOCOLS.has(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

export function isSupportedHttpUrl(value: string): boolean {
  return parseSupportedHttpUrl(value) !== null;
}

export function getUnsupportedUrls(urls: string[]): string[] {
  return urls.filter((url) => !isSupportedHttpUrl(url));
}
