import { describe, it, expect } from 'vitest';
import { validateEmail, validatePassword, validateUsername, sanitizeString } from './security';

describe('security utils', () => {
  describe('validateEmail', () => {
    it('should accept valid email addresses', () => {
      const result = validateEmail('user@example.com');
      expect(result).toBe(true);
    });

    it('should reject emails without @', () => {
      const result = validateEmail('userexample.com');
      expect(result).toBe(false);
    });

    it('should reject very long emails', () => {
      const longEmail = 'a'.repeat(300) + '@example.com';
      const result = validateEmail(longEmail);
      expect(result).toBe(false);
    });
  });

  describe('validatePassword', () => {
    it('should accept valid passwords', () => {
      const result = validatePassword('SecurePass1');
      expect(result.valid).toBe(true);
    });

    it('should reject short passwords', () => {
      const result = validatePassword('Short1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('8 characters');
    });

    it('should reject common weak passwords', () => {
      const result = validatePassword('password');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too common');
    });

    it('should reject very long passwords', () => {
      const result = validatePassword('a'.repeat(200));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('128 characters');
    });
  });

  describe('validateUsername', () => {
    it('should accept valid usernames', () => {
      const result = validateUsername('user123');
      expect(result).toBe(true);
    });

    it('should reject usernames that are too short', () => {
      const result = validateUsername('ab');
      expect(result).toBe(false);
    });

    it('should reject usernames with special characters', () => {
      const result = validateUsername('user@123');
      expect(result).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    it('should remove control characters', () => {
      const result = sanitizeString('hello\x00world');
      expect(result).not.toContain('\x00');
    });

    it('should trim whitespace', () => {
      const result = sanitizeString('  test  ');
      expect(result).toBe('test');
    });

    it('should handle normal strings', () => {
      const result = sanitizeString('hello world');
      expect(result).toBe('hello world');
    });

    it('should limit string length', () => {
      const result = sanitizeString('a'.repeat(2000), 100);
      expect(result.length).toBe(100);
    });
  });
});
