# FlowState Dashboard - Code Quality Guide

## Code Organization

### Directory Structure

```
src/
├── main/                    # Electron main process
│   ├── database.ts         # Database operations
│   ├── auth.ts             # Authentication
│   ├── capture.ts          # Capture orchestration
│   ├── session-management.ts
│   ├── archive-management.ts
│   ├── utils/              # Utility modules
│   │   ├── security.ts     # Security utilities
│   │   ├── logger.ts       # Logging utility
│   │   └── errors.ts       # Error handling
│   └── migrations/         # Database migrations
├── renderer/              # React frontend
│   └── src/
│       ├── pages/         # Route pages
│       ├── components/    # Reusable components
│       └── contexts/      # React contexts
└── preload/               # IPC bridge
```

## Coding Standards

### Naming Conventions

- **Files**: kebab-case (e.g., `session-management.ts`)
- **Functions**: camelCase (e.g., `createWorkSession()`)
- **Interfaces/Types**: PascalCase (e.g., `WorkSession`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_CAPTURE_LIMIT`)
- **Private functions**: No prefix needed (TypeScript handles visibility)

### Type Safety

- **Always use TypeScript types**: Avoid `any` when possible
- **Define interfaces**: For complex objects
- **Use enums**: For fixed sets of values
- **Type guards**: For runtime type checking

### Error Handling

- **Use try-catch**: For all async operations
- **Return standardized responses**: `{ success: boolean, data?, error? }`
- **Log errors**: Use logger utility
- **Don't expose internals**: Generic error messages for users

### Comments

- **JSDoc for functions**: Document parameters and return values
- **Inline comments**: Explain "why", not "what"
- **TODO comments**: Use `// TODO: description` for future work

### Imports

- **Organize imports**: 
  1. External packages
  2. Internal modules
  3. Types/interfaces
- **Use absolute imports**: Where possible
- **Remove unused imports**: Keep code clean

## Best Practices

### 1. Database Operations

```typescript
// ✅ Good: Parameterized query
const user = prepare('SELECT * FROM users WHERE id = ?').get(userId);

// ❌ Bad: String concatenation
const user = prepare(`SELECT * FROM users WHERE id = ${userId}`).get();
```

### 2. Error Handling

```typescript
// ✅ Good: Standardized error response
try {
  const result = someOperation();
  return { success: true, data: result };
} catch (error) {
  logger.error('Operation failed:', error);
  return handleError(error);
}

// ❌ Bad: Throwing errors without handling
const result = someOperation(); // May throw
```

### 3. Input Validation

```typescript
// ✅ Good: Validate before use
const sanitizedEmail = sanitizeString(email.toLowerCase().trim(), 254);
if (!validateEmail(sanitizedEmail)) {
  return { success: false, error: 'Invalid email format' };
}

// ❌ Bad: Using input directly
const user = prepare('SELECT * FROM users WHERE email = ?').get(email);
```

### 4. Type Safety

```typescript
// ✅ Good: Explicit types
interface User {
  id: number;
  email: string;
}

function getUser(id: number): User | null {
  // ...
}

// ❌ Bad: Using any
function getUser(id: any): any {
  // ...
}
```

## Code Review Checklist

- [ ] All inputs validated and sanitized
- [ ] SQL queries use parameterized statements
- [ ] Errors handled gracefully
- [ ] Types defined for all functions
- [ ] No `any` types (unless necessary)
- [ ] Comments explain complex logic
- [ ] No console.log in production code (use logger)
- [ ] No hardcoded secrets or credentials
- [ ] Functions are focused and single-purpose
- [ ] Code is readable and maintainable

## Refactoring Opportunities

1. **Extract common patterns**: IPC handlers share similar structure
2. **Create service layer**: Abstract business logic from IPC handlers
3. **Standardize responses**: Use `createSuccessResponse()` and `createErrorResponse()`
4. **Reduce code duplication**: Shared validation logic
5. **Improve type definitions**: More specific types, fewer `any`







