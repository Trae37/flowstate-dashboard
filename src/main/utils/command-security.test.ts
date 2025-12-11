import { describe, it, expect } from 'vitest';
import { validateFilePathForCommand, sanitizeCommandArg } from './command-security';

describe('command-security', () => {
  describe('validateFilePathForCommand', () => {
    it('should accept normal file paths', () => {
      expect(validateFilePathForCommand('C:\\Users\\test\\file.txt')).toBe(true);
      expect(validateFilePathForCommand('/home/user/file.txt')).toBe(true);
    });

    it('should reject paths with command injection attempts', () => {
      expect(validateFilePathForCommand('test.txt; rm -rf /')).toBe(false);
      expect(validateFilePathForCommand('test.txt && del *.*')).toBe(false);
      expect(validateFilePathForCommand('test.txt | cat')).toBe(false);
    });

    it('should reject paths with suspicious characters', () => {
      expect(validateFilePathForCommand('test.txt`whoami`')).toBe(false);
      expect(validateFilePathForCommand('$(cat /etc/passwd)')).toBe(false);
    });
  });

  describe('sanitizeCommandArg', () => {
    it('should escape special shell characters', () => {
      const result = sanitizeCommandArg('hello & world');
      expect(result).not.toContain('&');
    });

    it('should handle quotes properly', () => {
      const result = sanitizeCommandArg('test"quote');
      expect(result).toBeDefined();
    });

    it('should preserve normal text', () => {
      const result = sanitizeCommandArg('normal-file-name.txt');
      expect(result).toContain('normal-file-name.txt');
    });
  });
});
