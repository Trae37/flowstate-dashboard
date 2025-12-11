# Notification Monitoring Implementation Guide

This document describes the APIs and implementation strategies for monitoring system notifications across Windows, macOS, and Linux to trigger automatic workspace captures.

## Overview

FlowState can automatically capture your workspace when you receive notifications from communication apps (Slack, WhatsApp, Telegram, Email, Zoom, etc.). This ensures you never lose your work context when stepping away to handle messages.

## Platform-Specific APIs

### Windows

**Primary API: UserNotificationListener**
- **Documentation**: https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/notification-listener
- **Requirements**: Windows 10 version 1809 or later
- **Permissions**: Requires user consent in Windows Settings
- **Implementation**: 
  - Use Windows Runtime API via native module (C++/C#)
  - Or use `ffi-napi` to call Windows APIs directly
  - Alternative: Monitor notification history via PowerShell

**Key APIs:**
```cpp
// C++/WinRT example
#include <winrt/Windows.UI.Notifications.h>
using namespace winrt::Windows::UI::Notifications;

// Get notification listener
auto listener = UserNotificationListener::Current();

// Request access
auto accessStatus = await listener.RequestAccessAsync();

// Monitor notifications
listener.NotificationChanged([](auto sender, auto args) {
    // Handle notification
});
```

**PowerShell Alternative:**
```powershell
# Check notification history (limited)
Get-WinEvent -LogName Microsoft-Windows-UserModePowerShell/Operational
```

### macOS

**Primary API: UNUserNotificationCenter**
- **Documentation**: https://developer.apple.com/documentation/usernotifications
- **Requirements**: macOS 10.14+
- **Permissions**: Requires notification access in System Preferences
- **Implementation**:
  - Use Objective-C/Swift native module
  - Or use `osascript` for limited monitoring
  - Best: Create native Electron addon

**Key APIs:**
```swift
// Swift example
import UserNotifications

let center = UNUserNotificationCenter.current()

// Request authorization
center.requestAuthorization(options: [.alert, .sound]) { granted, error in
    // Handle authorization
}

// Set delegate to receive notifications
center.delegate = self

// Implement delegate method
func userNotificationCenter(_ center: UNUserNotificationCenter,
                          willPresent notification: UNNotification,
                          withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    // Handle incoming notification
}
```

**osascript Alternative (Limited):**
```applescript
tell application "System Events"
    -- Limited access to notification center
end tell
```

### Linux

**Primary API: D-Bus Notifications Interface**
- **Documentation**: https://specifications.freedesktop.org/notification-spec/notification-spec-latest.html
- **Requirements**: Desktop environment with D-Bus (GNOME, KDE, etc.)
- **Implementation**: Use `dbus-next` npm package

**Key APIs:**
```javascript
// JavaScript/Node.js example using dbus-next
const dbus = require('dbus-next');
const bus = dbus.sessionBus();

// Get notification service
const notificationService = await bus.getProxyObject(
  'org.freedesktop.Notifications',
  '/org/freedesktop/Notifications'
);

// Monitor notification signals
const notifications = notificationService.getInterface('org.freedesktop.Notifications');

// Listen for notification events
// Note: D-Bus doesn't provide direct notification monitoring,
// but we can monitor the service and check for active notifications
```

## Implementation Strategy

### Current Implementation

The current implementation uses a **hybrid approach**:

1. **Primary Method**: Window Focus Monitoring
   - Monitors when users switch to communication apps
   - Works without special permissions
   - Reliable across all platforms
   - Less invasive than direct notification monitoring

2. **Future Enhancement**: Native Notification APIs
   - Direct notification monitoring when permissions are available
   - More accurate detection
   - Requires platform-specific native modules

### Recommended Native Module Setup

For full notification monitoring, create native Electron addons:

#### Windows Native Module

1. **Create C++ addon** using `node-addon-api`:
```cpp
// notification-listener.cpp
#include <napi.h>
#include <windows.ui.notifications.h>

class NotificationListener : public Napi::ObjectWrap<NotificationListener> {
  // Implementation using Windows Runtime APIs
};
```

2. **Build with electron-rebuild**:
```bash
npm install --save-dev @electron/rebuild
npm run rebuild
```

#### macOS Native Module

1. **Create Objective-C++ addon**:
```objc
// notification-monitor.mm
#import <UserNotifications/UserNotifications.h>

// Implement UNUserNotificationCenterDelegate
```

2. **Request permissions in Info.plist**:
```xml
<key>NSUserNotificationsUsageDescription</key>
<string>FlowState needs notification access to automatically capture your workspace when you receive messages.</string>
```

#### Linux D-Bus Module

Use the existing `dbus-next` package - no native module needed for basic functionality.

## Installation

Install required dependencies:

```bash
npm install dbus-next ffi-napi ref-napi
npm install --save-dev @electron/rebuild
```

## Configuration

### User Settings

Add to user settings:
- `notificationCaptureEnabled`: Boolean (default: true)
- Controls whether notification-triggered captures are enabled

### Permissions

**Windows:**
1. Settings > Privacy > Notifications
2. Enable "Allow apps to access notifications"
3. Enable for FlowState

**macOS:**
1. System Preferences > Notifications
2. Find FlowState
3. Enable "Allow Notifications"

**Linux:**
- No special permissions needed for D-Bus
- May need to install `xdotool` for window focus monitoring

## Testing

Test notification monitoring:

1. **Enable auto-save** in FlowState settings
2. **Open a communication app** (Slack, WhatsApp, etc.)
3. **Switch to the app** or receive a notification
4. **Verify** that a capture is triggered automatically

## Limitations

1. **Windows**: Full notification access requires native module or Windows Runtime API
2. **macOS**: Requires user to grant notification permissions
3. **Linux**: D-Bus monitoring is limited; window focus is more reliable
4. **Privacy**: Users must explicitly grant notification access

## Future Enhancements

1. **Native Modules**: Build platform-specific native modules for direct notification access
2. **Notification Content**: Extract notification title/body to create more descriptive capture names
3. **Smart Filtering**: Only capture for specific notification types (mentions, DMs, etc.)
4. **Rate Limiting**: Intelligent cooldown based on notification frequency
5. **User Preferences**: Allow users to select which apps trigger captures

## References

- Windows Notification Listener: https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/notification-listener
- macOS UserNotifications: https://developer.apple.com/documentation/usernotifications
- D-Bus Notifications Spec: https://specifications.freedesktop.org/notification-spec/notification-spec-latest.html
- Electron Native Modules: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules





