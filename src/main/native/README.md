# Native Notification Monitor Module

This directory contains the native C++/Objective-C module for monitoring system notifications.

## Building

### Prerequisites

1. **Node.js** 18+ and npm
2. **node-gyp**: `npm install -g node-gyp`
3. **Xcode** (macOS): Install from App Store or `xcode-select --install`
4. **Visual Studio Build Tools** (Windows): Install "Desktop development with C++" workload

### Build Commands

```bash
# Navigate to module directory
cd src/main/native/notification-monitor

# Install dependencies (if any)
npm install

# Configure build
node-gyp configure

# Build the module
node-gyp build

# Or use the npm script from project root
npm run build:native
```

### Rebuild for Electron

After building, you need to rebuild for Electron's Node.js version:

```bash
# From project root
npm run rebuild:native
```

Or manually:

```bash
electron-rebuild -f -w notification-monitor
```

## File Structure

```
notification-monitor/
├── binding.gyp                    # Build configuration
├── notification-monitor.cc        # Main C++ entry point
├── notification-monitor.h         # Header file
├── notification-monitor-macos.mm  # macOS Objective-C++ implementation
├── notification-monitor-windows.cc # Windows C++ implementation (future)
└── package.json                   # Module metadata
```

## Output

After building, the compiled module will be at:
- **Development**: `build/Release/notification-monitor.node`
- **Production**: Should be packaged with Electron app

## Troubleshooting

### "node-gyp not found"
```bash
npm install -g node-gyp
```

### "Xcode command line tools missing" (macOS)
```bash
xcode-select --install
```

### "Module not found" at runtime
- Verify the `.node` file exists in `build/Release/`
- Check the path in `notification-monitor-wrapper.ts`
- Rebuild for Electron: `npm run rebuild:native`

### Build errors
- Make sure you have the correct Xcode/Visual Studio tools installed
- Try cleaning and rebuilding: `node-gyp clean && node-gyp rebuild`

## Testing

1. Build the module: `npm run build:native`
2. Start the app: `npm run dev`
3. Grant notification permissions when prompted
4. Send a test notification (Slack, WhatsApp, etc.)
5. Verify the alert appears in FlowState





