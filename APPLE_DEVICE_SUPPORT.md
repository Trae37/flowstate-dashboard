# Apple Device Support for Notification Monitoring

## Overview

FlowState needs to monitor notifications from communication apps on Apple devices (macOS, iOS, iPadOS). **Native APIs are absolutely required** for Apple devices because:

1. **No Windows on Apple devices** - Window focus monitoring doesn't apply
2. **iOS/iPadOS are mobile** - No window system to monitor
3. **macOS requires permissions** - Native APIs are the only reliable way to detect notifications
4. **Apple's security model** - Apps must explicitly request notification access

## Platform-Specific Implementation

### macOS (Desktop)

**Required API: UNUserNotificationCenter**

```swift
// Swift/Objective-C implementation needed
import UserNotifications

class NotificationMonitor: NSObject, UNUserNotificationCenterDelegate {
    let center = UNUserNotificationCenter.current()
    
    func startMonitoring() {
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            if granted {
                // Start monitoring
            }
        }
    }
    
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                              willPresent notification: UNNotification,
                              withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Notification received - send to Electron
        sendToElectron(notification)
    }
}
```

**Permissions Required:**
- User must grant notification access in System Preferences
- App must request permission on first launch

**Implementation Steps:**
1. Create Objective-C++ native module using `node-addon-api`
2. Implement `UNUserNotificationCenterDelegate`
3. Request notification permissions
4. Forward notifications to Electron main process

### iOS/iPadOS (Mobile)

**Required API: UNUserNotificationCenter** (same as macOS)

**Additional Considerations:**
- iOS apps run in background with limitations
- Need to handle background notification delivery
- May need push notification certificates for some apps

**Implementation:**
- Similar to macOS but with iOS-specific background handling
- Requires iOS app wrapper or React Native bridge
- Electron doesn't run on iOS - would need native iOS app

### Current Status

**macOS Support:**
- ✅ Structure in place for native module
- ⚠️ Native module needs to be built
- ⚠️ Requires user permission grant

**iOS/iPadOS Support:**
- ⚠️ Requires separate native iOS app
- ⚠️ Electron doesn't run on iOS
- ⚠️ Would need React Native or native Swift/Objective-C app

## Why Native APIs Are Required

### macOS

1. **Window Focus Doesn't Work Well:**
   - macOS has multiple desktops/spaces
   - Notifications appear even when app isn't focused
   - User might not switch windows immediately

2. **Permission Model:**
   - macOS requires explicit notification access
   - Without permission, no way to detect notifications
   - Native APIs are the only official way

3. **Accuracy:**
   - Native APIs detect actual notifications
   - Window focus only detects when user switches apps
   - Native APIs can get notification content (title, body)

### iOS/iPadOS

1. **No Window System:**
   - Mobile devices don't have windows
   - Can't monitor window focus
   - Native APIs are the only option

2. **Background Limitations:**
   - iOS limits background processing
   - Need proper notification handling
   - Requires native app implementation

## Implementation Roadmap

### Phase 1: macOS Native Module (Priority)

1. **Create Native Module:**
   ```bash
   npm install --save-dev node-addon-api
   ```

2. **Build Objective-C++ Module:**
   - Implement `UNUserNotificationCenterDelegate`
   - Request permissions
   - Forward notifications to Electron

3. **Integrate with Electron:**
   - Use `ipcMain` to receive notifications
   - Send to renderer process
   - Display notification alerts

### Phase 2: iOS/iPadOS (Future)

1. **Evaluate Options:**
   - Native iOS app (Swift/Objective-C)
   - React Native wrapper
   - Electron alternative for mobile

2. **Cross-Platform Sync:**
   - Sync notification state across devices
   - Use iCloud or backend service

## Code Structure

```
src/
├── main/
│   ├── notification-monitor-native.ts    # TypeScript wrapper
│   └── native/
│       ├── notification-monitor.mm        # macOS Objective-C++
│       └── binding.gyp                   # Build configuration
└── renderer/
    └── components/
        └── NotificationAlert.tsx          # UI component
```

## Testing

### macOS Testing:
1. Grant notification permissions
2. Send test notification from Slack/WhatsApp
3. Verify FlowState detects and displays alert
4. Test permission denial scenario

### iOS Testing:
1. Build native iOS app
2. Test notification detection
3. Test background delivery
4. Test cross-device sync

## References

- [Apple UserNotifications Framework](https://developer.apple.com/documentation/usernotifications)
- [Node Addon API](https://github.com/nodejs/node-addon-api)
- [Electron Native Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)





