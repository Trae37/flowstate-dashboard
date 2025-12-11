# Sentry Crash Reporting Setup

Sentry is configured and ready to use for crash reporting. Follow these steps to activate it:

## 1. Create a Free Sentry Account

1. Go to [sentry.io](https://sentry.io/signup/)
2. Sign up for a free account (5,000 errors/month free forever)
3. Create a new project:
   - Platform: **Electron**
   - Project name: **flowstate-dashboard**

## 2. Get Your DSN (Data Source Name)

After creating the project, Sentry will show you a DSN that looks like:
```
https://abc123def456@o123456.ingest.sentry.io/7891011
```

Copy this DSN.

## 3. Add DSN to Your Build Process

### Option A: Environment Variable (Recommended)
Set the environment variable before building:

**Windows (PowerShell):**
```powershell
$env:SENTRY_DSN="https://abc123def456@o123456.ingest.sentry.io/7891011"
npm run build:app
```

**macOS/Linux:**
```bash
export SENTRY_DSN="https://abc123def456@o123456.ingest.sentry.io/7891011"
npm run build:app
```

### Option B: Hardcode in main.ts (Less secure, but simpler)
Replace line 61 in `src/main/main.ts`:

```typescript
dsn: 'https://your-actual-sentry-dsn@sentry.io/your-project-id',
```

**⚠️ WARNING:** If you commit this to GitHub, your DSN will be public. Use Option A for open source projects.

## 4. Test It Works

After building with your DSN:

1. Run the app in production mode
2. Trigger an error (click something that crashes)
3. Check your Sentry dashboard - you should see the error appear within seconds

## 5. What Gets Sent to Sentry?

**Privacy-First Configuration:**
- ✅ Error messages and stack traces
- ✅ App version and environment
- ✅ User OS and version
- ❌ **NO file paths** (automatically stripped)
- ❌ **NO user data** (code, passwords, etc.)
- ❌ **NO personal information**

All sensitive data is filtered out in the `beforeSend` hook (lines 64-93 in main.ts).

## 6. Disable Sentry (Optional)

Sentry only runs in production builds (`app.isPackaged`).

To completely disable it:
1. Don't set the `SENTRY_DSN` environment variable
2. The placeholder DSN will be used, and Sentry won't send anything

## Free Tier Limits

Sentry's free tier includes:
- 5,000 errors per month
- 1 project
- 1 team member
- 30-day error retention
- Full feature access

This is more than enough for most indie apps!

## Need Help?

- Sentry Docs: https://docs.sentry.io/platforms/javascript/guides/electron/
- Sentry Support: https://sentry.io/support/
