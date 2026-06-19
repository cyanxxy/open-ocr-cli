import { describe, expect, it } from 'vitest';

import { getUnsupportedUrls, isSupportedHttpUrl, parseSupportedHttpUrl } from './urlValidation';

describe('urlValidation', () => {
  describe('parseSupportedHttpUrl', () => {
    it('accepts http and https URLs', () => {
      expect(parseSupportedHttpUrl('http://example.com')?.protocol).toBe('http:');
      expect(parseSupportedHttpUrl('https://example.com/doc.pdf')?.protocol).toBe('https:');
    });

    it('rejects non-http(s) schemes (the SSRF/XSS-adjacent ones)', () => {
      expect(parseSupportedHttpUrl('javascript:alert(1)')).toBeNull();
      expect(parseSupportedHttpUrl('file:///etc/passwd')).toBeNull();
      expect(parseSupportedHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(parseSupportedHttpUrl('ftp://example.com/file')).toBeNull();
      expect(parseSupportedHttpUrl('mailto:user@example.com')).toBeNull();
    });

    it('returns null for empty or malformed input', () => {
      expect(parseSupportedHttpUrl('')).toBeNull();
      expect(parseSupportedHttpUrl('not a url')).toBeNull();
      expect(parseSupportedHttpUrl('://missing-scheme')).toBeNull();
    });
  });

  describe('isSupportedHttpUrl', () => {
    it('mirrors parseSupportedHttpUrl as a boolean', () => {
      expect(isSupportedHttpUrl('https://example.com')).toBe(true);
      expect(isSupportedHttpUrl('javascript:alert(1)')).toBe(false);
    });
  });

  describe('getUnsupportedUrls', () => {
    it('returns only the unsupported URLs from a mixed list', () => {
      const urls = ['https://ok.com', 'javascript:bad', 'http://ok2.com', 'file:///x'];
      expect(getUnsupportedUrls(urls)).toEqual(['javascript:bad', 'file:///x']);
    });

    it('returns an empty array when every URL is supported', () => {
      expect(getUnsupportedUrls(['https://a.com', 'http://b.com'])).toEqual([]);
    });
  });
});
