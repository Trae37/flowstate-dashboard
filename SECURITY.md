# FlowState Dashboard - Security Documentation

## Security Measures Implemented

### 1. Input Validation

**Location**: `src/main/utils/security.ts`

- **Email Validation**: RFC 5322 compliant regex, max 254 characters
- **Username Validation**: 3-30 chars, alphanumeric + underscore/hyphen
- **Password Validation**: 
  - Min 8 characters, max 128 characters
  - Checks against common weak passwords
- **ID Validation**: Positive integers only
- **Session Token Validation**: 64 hex characters (32 bytes)

### 2. SQL Injection Prevention

**Location**: `src/main/database.ts`

- **Parameterized Queries**: All queries use `prepare()` with `?` placeholders
- **Parameter Sanitization**:
  - Strings: Escape single quotes (`'` → `''`), remove null bytes
  - Numbers: Validate finite numbers
  - Booleans: Convert to 1/0
  - Null/undefined: Convert to SQL NULL
- **Type Validation**: Throws error for unsupported parameter types

### 3. Authentication Security

**Location**: `src/main/auth.ts`

- **Password Hashing**: SHA-256 (suitable for local-first app)
  - **Note**: For production, consider upgrading to bcrypt or argon2
- **Session Tokens**: 32 random bytes (64 hex chars)
- **Session Expiration**: 30 days
- **Input Sanitization**: All user inputs sanitized before database operations

### 4. Rate Limiting

**Location**: `src/main/utils/security.ts`, `src/main/main.ts`

- **Login**: 5 attempts per 15 minutes
- **Signup**: 3 attempts per hour
- **Capture**: 10 captures per minute
- **Implementation**: In-memory rate limiter (simple, effective for single-instance app)

### 5. Path Sanitization

**Location**: `src/main/utils/security.ts`

- **Directory Traversal Prevention**: Removes `..` sequences
- **Null Byte Removal**: Prevents null byte injection
- **Path Normalization**: Standardizes path separators

## Security Recommendations

### High Priority

1. **Password Hashing Upgrade**
   - Current: SHA-256 (simple, fast)
   - Recommended: bcrypt or argon2 (slower, more secure)
   - Impact: Better protection against rainbow table attacks

2. **Session Security**
   - Add session rotation on sensitive operations
   - Implement refresh tokens
   - Add CSRF protection for state-changing operations

3. **Command Injection Review**
   - Review all `exec()`, `spawn()`, `execPromise()` calls
   - Ensure user input is never directly passed to shell commands
   - Use parameterized command execution where possible

### Medium Priority

1. **Data Encryption**
   - Encrypt sensitive data at rest (passwords already hashed)
   - Consider encrypting capture content if it contains sensitive information
   - Use OS keychain for sensitive credentials

2. **Input Length Limits**
   - Enforce maximum lengths on all user inputs
   - Prevent DoS via extremely long inputs
   - Already implemented for email (254), username (30)

3. **Error Message Sanitization**
   - Ensure error messages don't leak sensitive information
   - Don't expose database structure in errors
   - Use generic error messages for authentication failures

### Low Priority

1. **Security Headers** (if adding web features)
   - Content Security Policy
   - X-Frame-Options
   - X-Content-Type-Options

2. **Audit Logging**
   - Log security-relevant events (login attempts, privilege changes)
   - Store audit logs separately from application data

## Security Testing Checklist

- [ ] Test SQL injection attempts
- [ ] Test XSS in user inputs (if web features added)
- [ ] Test rate limiting
- [ ] Test authentication bypass attempts
- [ ] Test path traversal attempts
- [ ] Test command injection in terminal capture
- [ ] Review file permissions on database file
- [ ] Test session token validation
- [ ] Test input validation edge cases

## Known Security Considerations

1. **Local-First Architecture**: Data is stored locally, not in cloud
   - Pros: No network attack surface
   - Cons: Physical access = data access
   - Mitigation: Consider OS-level encryption

2. **Electron Security**: Uses Chromium renderer
   - Context isolation: ✅ Enabled
   - Node integration: ❌ Disabled (good)
   - Preload script: ✅ Used for IPC bridge

3. **Native Modules**: Uses `better-sqlite3` and other native modules
   - Ensure modules are from trusted sources
   - Keep dependencies updated







