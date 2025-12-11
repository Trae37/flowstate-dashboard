# Quick Start: Building Native Notification Monitor

## For Windows Users (Current Setup)

**Good news**: The system works immediately with window focus monitoring! No build needed.

```bash
# Just start the app
npm run dev

# The system will:
# 1. Try to load native module (will fail gracefully)
# 2. Automatically use window focus monitoring
# 3. Start working immediately
```

**To test:**
1. Open Slack, WhatsApp, or another communication app
2. Switch to that app (Alt+Tab or click)
3. FlowState will show an alert

## For macOS Users

### Step 1: Install Dependencies

```bash
# Install build tools
npm install --save-dev node-addon-api node-gyp

# Install globally (recommended)
npm install -g node-gyp

# Install Xcode command line tools (if needed)
xcode-select --install
```

### Step 2: Build the Native Module

```bash
# Navigate to the module directory
cd src/main/native/notification-monitor

# Build the module
node-gyp configure
node-gyp build

# Or from project root
npm run build:native
```

### Step 3: Rebuild for Electron

```bash
# From project root
npm run rebuild:native

# Or manually
electron-rebuild -f -w notification-monitor
```

### Step 4: Test

```bash
# Start the app
npm run dev

# Grant notification permissions when prompted
# (System Preferences > Notifications > FlowState)
# Send a test notification (Slack, WhatsApp, etc.)
# Verify alert appears in FlowState
```

## For Windows (Building Native Module - Optional)

If you want to build the Windows native module (for actual notification detection):

1. **Install Visual Studio 2019+** with:
   - Desktop development with C++
   - Universal Windows Platform development
   - Windows 10 SDK (10.0.19041.0+)

2. **Build:**
   ```bash
   cd src/main/native/notification-monitor
   node-gyp configure
   node-gyp build
   ```

3. **Note**: The Windows implementation is a placeholder and needs WinRT completion.
   Window focus monitoring works well as a fallback.

## Troubleshooting

- **"node-gyp not found"**: `npm install -g node-gyp`
- **"Xcode missing"** (macOS): `xcode-select --install`
- **Module not found**: Check path in `notification-monitor-wrapper.ts`
- **Build errors**: Clean and rebuild: `node-gyp clean && node-gyp rebuild`

## Files Created

✅ `src/main/native/notification-monitor/binding.gyp` - Build config
✅ `src/main/native/notification-monitor/notification-monitor-macos.mm` - macOS implementation
✅ `src/main/native/notification-monitor-wrapper.ts` - TypeScript wrapper
✅ `src/main/notification-monitor-native.ts` - Updated to use native module
✅ `src/main/main.ts` - Updated to use async monitoring

## Next Steps

See `IMPLEMENTATION_GUIDE.md` for detailed explanations of each step.

