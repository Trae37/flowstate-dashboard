# Windows Build Notes

## Important: Windows Native Module Requirements

The Windows notification monitoring implementation uses **Windows Runtime (WinRT) APIs**, which require special build configuration.

## Prerequisites

1. **Visual Studio 2019 or later** with:
   - "Desktop development with C++" workload
   - "Universal Windows Platform development" workload (for WinRT)
   - Windows 10 SDK (10.0.19041.0 or later)

2. **Windows 10 version 1809 or later** (for UserNotificationListener API)

## Build Configuration

The `binding.gyp` file is configured for Windows, but you may need to adjust:

1. **Windows SDK Version**: Ensure you have the correct SDK version
2. **C++ Standard**: Set to C++17 or later
3. **WinRT Support**: Enable Windows Runtime support

## Current Implementation Status

The Windows implementation (`notification-monitor-windows.cc`) is a **placeholder** that needs to be completed with full WinRT support.

### To Complete Windows Implementation:

1. **Install C++/WinRT NuGet package** or use the Windows SDK version
2. **Update binding.gyp** to include WinRT headers
3. **Implement UserNotificationListener** API calls
4. **Handle permission requests**

### Alternative: Use Existing Windows Implementation

For now, the system will fall back to **window focus monitoring**, which:
- ✅ Works without special permissions
- ✅ Works on all Windows versions
- ✅ Reliable and simple
- ⚠️ Only detects when user switches to app (not actual notifications)

## Building on Windows

```bash
# Install Windows Build Tools (if needed)
npm install --global windows-build-tools

# Navigate to module directory
cd src/main/native/notification-monitor

# Configure build
node-gyp configure

# Build
node-gyp build
```

## Troubleshooting Windows Build

1. **"Windows SDK not found"**:
   - Install via Visual Studio Installer
   - Ensure version 10.0.19041.0 or later

2. **"WinRT headers not found"**:
   - Install "Universal Windows Platform development" workload
   - Check that Windows 10 SDK is installed

3. **"C++/WinRT not available"**:
   - The current implementation doesn't require C++/WinRT yet
   - Will be needed for full notification monitoring

## Next Steps

1. **For immediate use**: Window focus monitoring works well on Windows
2. **For full WinRT support**: Complete the Windows implementation with proper WinRT setup
3. **For testing**: Build and test the current fallback implementation





