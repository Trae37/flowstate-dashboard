// Test URL validation functions (ESM version)
import { validateExternalUrl } from './dist/main/utils/security.js';

console.log('\n=== TESTING URL VALIDATION ===\n');

const testCases = [
  // Should PASS
  { url: 'https://google.com', expected: true, reason: 'Valid HTTPS URL' },
  { url: 'http://example.com', expected: true, reason: 'Valid HTTP URL' },
  
  // Should FAIL
  { url: 'javascript:alert(1)', expected: false, reason: 'JavaScript protocol (XSS vector)' },
  { url: 'file:///etc/passwd', expected: false, reason: 'File protocol (LFI vector)' },
  { url: 'data:text/html,<script>alert(1)</script>', expected: false, reason: 'Data URI (XSS vector)' },
  { url: 'ftp://files.com', expected: false, reason: 'FTP protocol' },
  { url: '', expected: false, reason: 'Empty string' },
  { url: 'chrome://settings', expected: false, reason: 'Browser internal URL' },
];

console.log('Testing validateExternalUrl():');
console.log('-'.repeat(80));

let passed = 0;
let failed = 0;

testCases.forEach(({ url, expected, reason }) => {
  const result = validateExternalUrl(url);
  const status = result === expected ? '✅ PASS' : '❌ FAIL';
  
  if (result === expected) passed++;
  else failed++;
  
  console.log(`${status} | ${reason}`);
  console.log(`       URL: "${url}"`);
  console.log(`       Expected: ${expected}, Got: ${result}`);
  console.log('');
});

console.log('-'.repeat(80));
console.log(`\nResults: ${passed}/${testCases.length} tests passed`);

if (failed > 0) {
  console.log(`\n❌ ${failed} test(s) FAILED`);
} else {
  console.log('\n✅ ALL TESTS PASSED - URL validation is working correctly!');
}

console.log('\n=== URL VALIDATION TEST COMPLETE ===\n');

process.exit(failed > 0 ? 1 : 0);
