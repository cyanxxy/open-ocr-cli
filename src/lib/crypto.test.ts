import { describe, it, expect } from 'vitest';
import { encryptData, decryptData } from './crypto';

describe('crypto', () => {
  const testApiKey = 'test-api-key-12345';
  const emptyApiKey = '';
  const longApiKey = 'a'.repeat(1000);

  describe('encryptData', () => {
    it('should encrypt an API key', async () => {
      const encrypted = await encryptData(testApiKey);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(testApiKey);
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it('should handle empty string', async () => {
      const encrypted = await encryptData(emptyApiKey);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
    });

    it('should handle long API keys', async () => {
      const encrypted = await encryptData(longApiKey);

      expect(encrypted).toBeDefined();
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it('should handle special characters', async () => {
      const specialKey = 'api-key-!@#$%^&*()_+-=[]{}|;:,.<>?';
      const encrypted = await encryptData(specialKey);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(specialKey);
    });
  });

  describe('decryptData', () => {
    it('should decrypt encrypted API key', async () => {
      const encrypted = await encryptData(testApiKey);
      const decrypted = await decryptData(encrypted);

      expect(decrypted).toBe(testApiKey);
    });

    it('should handle empty encrypted string', async () => {
      const decrypted = await decryptData('');

      expect(decrypted).toBe('');
    });

    it('should handle round-trip encryption/decryption', async () => {
      const originalKeys = [
        'short',
        'medium-length-key',
        longApiKey,
        'special-chars-!@#$%',
        '123456789',
        'AIzaSyDummyKeyForTesting123456789',
      ];

      for (const originalKey of originalKeys) {
        const encrypted = await encryptData(originalKey);
        const decrypted = await decryptData(encrypted);

        expect(decrypted).toBe(originalKey);
      }
    });

    it('should handle malformed encrypted data gracefully', async () => {
      const malformedData = 'not-base64-data';

      await expect(async () => {
        const result = await decryptData(malformedData);
        expect(typeof result).toBe('string');
      }).not.toThrow();
    });

    it('should handle invalid base64 strings', async () => {
      const invalidBase64 = 'invalid base64 string with spaces!';

      await expect(async () => {
        await decryptData(invalidBase64);
      }).not.toThrow();
    });
  });

  describe('encryption consistency', () => {
    it('should maintain data integrity through multiple encrypt/decrypt cycles', async () => {
      let current = testApiKey;

      // Encrypt and decrypt multiple times
      for (let i = 0; i < 5; i++) {
        const encrypted = await encryptData(current);
        current = await decryptData(encrypted);
      }

      expect(current).toBe(testApiKey);
    });

    it('should handle Unicode characters properly', async () => {
      const unicodeKey = 'api-key-ñáéíóú-中文-🔑';
      const encrypted = await encryptData(unicodeKey);
      const decrypted = await decryptData(encrypted);

      expect(decrypted).toBe(unicodeKey);
    });
  });

  // NOTE: this is reversible XOR obfuscation (with a key kept in localStorage),
  // not encryption. Its only goal is to keep the API key out of plaintext in
  // localStorage against casual inspection — it does not provide confidentiality.
  describe('obfuscation properties', () => {
    it('should not store the original key in plaintext form', async () => {
      const encrypted = await encryptData(testApiKey);

      // The obfuscated result shouldn't contain the original key verbatim
      expect(encrypted.includes(testApiKey)).toBe(false);
    });

    it('should handle concurrent operations', async () => {
      const keys = ['key1', 'key2', 'key3'];
      const promises = keys.map((key) => encryptData(key));

      const encrypted = await Promise.all(promises);
      const decryptPromises = encrypted.map((enc) => decryptData(enc));
      const decrypted = await Promise.all(decryptPromises);

      expect(decrypted).toEqual(keys);
    });
  });
});
