# Analytics Setup Guide

FlowState Dashboard includes privacy-first analytics powered by PostHog. Analytics is **opt-in only** and disabled by default.

## Features

- ✅ **Opt-in only** - Users must explicitly enable analytics
- ✅ **Privacy-first** - No sensitive data is tracked (code, file paths, commands, URLs)
- ✅ **Self-hosted support** - Use your own PostHog instance
- ✅ **Automatic data sanitization** - Sensitive data is automatically removed
- ✅ **Error tracking** - Helps identify and fix bugs

## What Gets Tracked (When Enabled)

### Safe to Track:
- Feature usage (button clicks, page views)
- Error events (error type, not content)
- Performance metrics (capture duration, success rates)
- User journey (onboarding completion, first capture, etc.)

### Never Tracked:
- ❌ Code content
- ❌ File paths or workspace paths
- ❌ Terminal commands or output
- ❌ Browser URLs or content
- ❌ Session/capture content
- ❌ User email or personal info

## Setup Instructions

### Option 1: PostHog Cloud (Recommended for Quick Start)

1. Sign up for a free PostHog account at https://posthog.com
2. Create a new project
3. Copy your Project API Key
4. Set environment variables:
   ```bash
   # .env file (create in project root)
   VITE_POSTHOG_API_KEY=phc_your_actual_api_key_here
   VITE_POSTHOG_HOST=https://app.posthog.com
   ```
5. Restart the development server

### Option 2: Self-Hosted PostHog (Recommended for Enterprise)

1. Deploy PostHog on your infrastructure (see https://posthog.com/docs/self-host)
2. Get your API key from your PostHog instance
3. Set environment variables:
   ```bash
   # .env file
   VITE_POSTHOG_API_KEY=phc_your_actual_api_key_here
   VITE_POSTHOG_HOST=https://your-posthog-instance.com
   ```
4. Restart the development server

### Option 3: Configure via Settings (Future Feature)

Users can configure their own PostHog instance in Settings (coming soon).

## User Experience

1. **Default State**: Analytics is **disabled** by default
2. **User Control**: Users can enable/disable analytics in Settings → Privacy & Analytics
3. **Transparency**: Clear explanation of what is and isn't tracked
4. **No Impact**: If analytics fails, the app continues to work normally

## Implementation Details

### Analytics Utility (`src/renderer/src/utils/analytics.ts`)

- Singleton pattern for global analytics instance
- Automatic data sanitization before tracking
- Graceful error handling (never breaks the app)
- Supports opt-in/opt-out at runtime

### Key Tracking Events

- `user_signed_up` - New user registration
- `user_logged_in` - User login
- `onboarding_completed` - Onboarding finished
- `onboarding_skipped` - Onboarding skipped
- `feature_tour_completed` - Feature tour completed
- `capture_started` - Workspace capture initiated
- `capture_completed` - Workspace capture finished (with duration)
- `capture_failed` - Capture error (error type only)
- `analytics_enabled` - User enabled analytics
- `analytics_disabled` - User disabled analytics
- `$pageview` - Page navigation

### Data Sanitization

The `sanitizeProperties()` function automatically removes:
- File paths (Windows and Unix patterns)
- URLs (http/https)
- Code-like content (multi-line with brackets/functions)
- Terminal commands (long command-like strings)
- Any key containing sensitive keywords

## Privacy Policy Considerations

When using analytics, ensure your privacy policy states:
- What data is collected (feature usage, errors, performance)
- What data is NOT collected (code, paths, commands, URLs)
- How data is used (product improvement, bug fixes)
- User control (opt-in, can disable anytime)
- Data retention policies

## Testing

1. Enable analytics in Settings
2. Perform actions (capture, navigate, etc.)
3. Check PostHog dashboard for events
4. Verify no sensitive data appears in events
5. Disable analytics and verify tracking stops

## Troubleshooting

### Analytics Not Working

1. Check browser console for `[Analytics]` logs
2. Verify API key is set correctly
3. Check network tab for PostHog requests
4. Ensure analytics is enabled in Settings
5. Verify PostHog instance is accessible

### Sensitive Data Concerns

- All data is sanitized before sending
- Review `sanitizeProperties()` function
- Test with real data to verify sanitization
- Check PostHog dashboard to confirm no sensitive data

## Future Enhancements

- [ ] Allow users to configure their own PostHog instance
- [ ] Add analytics dashboard in app
- [ ] Export analytics data
- [ ] More granular privacy controls
- [ ] Anonymization options







