import { describe, it, expect } from 'vitest';
import { maxFileSizeForMime } from './index';

describe('file constraints', () => {
  it('uses the smaller PDF limit and the raw image limit', () => {
    expect(maxFileSizeForMime('application/pdf')).toEqual({ bytes: 50 * 1024 * 1024, label: '50MB' });
    expect(maxFileSizeForMime('image/png')).toEqual({ bytes: 70 * 1024 * 1024, label: '70MB' });
  });
});
