# iOS/iPadOS Implementation Guide

## Overview

FlowState needs to monitor notifications on iOS/iPadOS devices (iPhone, iPad). However, **Electron does not run on iOS**, so we need a different approach.

## Options for iOS Support

### Option 1: Native iOS App (Recommended)

Create a separate native iOS app that:
1. Monitors notifications using `UNUserNotificationCenter`
2. Syncs notification state with FlowState desktop app
3. Uses iCloud or a backend service for synchronization

**Pros:**
- Full native iOS experience
- Can run in background (with limitations)
- Access to all iOS notification APIs

**Cons:**
- Requires separate app development
- Need to maintain two codebases
- Requires sync mechanism

### Option 2: React Native Wrapper

Create a React Native app that:
1. Uses native modules for notification monitoring
2. Shares some code with Electron app
3. Syncs via backend service

**Pros:**
- Can share some JavaScript code
- Cross-platform (iOS + Android)

**Cons:**
- Still requires separate app
- More complex setup

### Option 3: Web App with Push Notifications

Create a web-based companion app that:
1. Uses Web Push API
2. Receives notifications via service worker
3. Syncs with desktop app

**Pros:**
- No app store submission needed
- Works in Safari on iOS

**Cons:**
- Limited notification capabilities
- Requires backend service
- Less native feel

## Recommended Approach: Native iOS App

### Architecture

```
┌─────────────────┐         ┌──────────────┐         ┌─────────────────┐
│  FlowState      │◄───────►│  Sync Service │◄───────►│  FlowState iOS  │
│  Desktop (Win)  │         │  (Backend)    │         │  App (Native)   │
└─────────────────┘         └──────────────┘         └─────────────────┘
```

### iOS App Components

1. **Notification Monitor** (Swift)
   ```swift
   import UserNotifications
   
   class NotificationMonitor: NSObject, UNUserNotificationCenterDelegate {
       func startMonitoring() {
           let center = UNUserNotificationCenter.current()
           center.delegate = self
           center.requestAuthorization(options: [.alert, .sound]) { granted, error in
               // Handle permission
           }
       }
       
       func userNotificationCenter(_ center: UNUserNotificationCenter,
                                  willPresent notification: UNNotification,
                                  withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
           // Send to sync service
           sendToSyncService(notification)
       }
   }
   ```

2. **Sync Service Client**
   - Send notifications to backend
   - Receive sync requests from desktop
   - Handle authentication

3. **Backend Sync Service**
   - Store notification events
   - Sync between devices
   - Handle user authentication

### Implementation Steps

#### Step 1: Create iOS App Project

```bash
# Create new Xcode project
# Choose: iOS > App
# Language: Swift
# UI: SwiftUI or UIKit
```

#### Step 2: Add Notification Monitoring

1. **Info.plist** - Add notification usage description:
   ```xml
   <key>NSUserNotificationsUsageDescription</key>
   <string>FlowState needs notification access to help you stay aware of messages while working.</string>
   ```

2. **NotificationMonitor.swift**:
   ```swift
   import UserNotifications
   import Foundation
   
   class NotificationMonitor: NSObject, UNUserNotificationCenterDelegate {
       var onNotification: ((String, String, String) -> Void)?
       
       func startMonitoring() {
           let center = UNUserNotificationCenter.current()
           center.delegate = self
           
           center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
               if granted {
                   print("Notification permission granted")
               }
           }
       }
       
       func userNotificationCenter(_ center: UNUserNotificationCenter,
                                  willPresent notification: UNNotification,
                                  withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
           let content = notification.request.content
           let appName = content.userInfo["appName"] as? String ?? "Unknown"
           let title = content.title
           let body = content.body
           
           // Call callback
           onNotification?(appName, title, body)
           
           // Send to sync service
           sendToSyncService(appName: appName, title: title, body: body)
           
           completionHandler([.alert, .sound])
       }
       
       func sendToSyncService(appName: String, title: String, body: String) {
           // Implement API call to sync service
           // This will notify the desktop app
       }
   }
   ```

#### Step 3: Create Sync Service

**Backend API Endpoints:**

1. **POST /api/notifications** - Receive notification from iOS
2. **GET /api/notifications/pending** - Desktop app polls for new notifications
3. **POST /api/notifications/ack** - Mark notification as received

**Example (Node.js/Express):**

```javascript
const express = require('express');
const app = express();

// Store pending notifications per user
const pendingNotifications = new Map();

// iOS app sends notification
app.post('/api/notifications', (req, res) => {
  const { userId, appName, title, body } = req.body;
  
  if (!pendingNotifications.has(userId)) {
    pendingNotifications.set(userId, []);
  }
  
  pendingNotifications.get(userId).push({
    appName,
    title,
    body,
    timestamp: new Date().toISOString()
  });
  
  res.json({ success: true });
});

// Desktop app polls for notifications
app.get('/api/notifications/pending', (req, res) => {
  const { userId } = req.query;
  const notifications = pendingNotifications.get(userId) || [];
  
  // Clear after sending
  pendingNotifications.set(userId, []);
  
  res.json({ notifications });
});
```

#### Step 4: Update Desktop App

Add polling to desktop app to check for iOS notifications:

```typescript
// In src/main/notification-monitor-native.ts
async function pollIOSNotifications() {
  // Poll sync service for notifications from iOS
  const response = await fetch(`${SYNC_SERVICE_URL}/api/notifications/pending?userId=${userId}`);
  const data = await response.json();
  
  for (const notification of data.notifications) {
    // Trigger callback
    if (notificationCallback) {
      notificationCallback(notification);
    }
  }
}

// Poll every 5 seconds
setInterval(pollIOSNotifications, 5000);
```

## Alternative: Shortcuts App Integration

For a simpler approach, you could use iOS Shortcuts:

1. Create a Shortcut that:
   - Monitors notifications
   - Sends to webhook/API
   - Triggers when specific apps receive messages

2. Desktop app polls the webhook

**Pros:**
- No app development needed
- Uses built-in iOS features

**Cons:**
- Limited capabilities
- Requires manual setup by user
- Less reliable

## Current Status

- ✅ macOS implementation (native module)
- ✅ Windows implementation (native module)
- ⏭️ iOS implementation (requires separate app)
- ⏭️ Sync service (backend required)

## Next Steps

1. **For immediate use**: Focus on Windows + macOS (desktop)
2. **For iOS support**: 
   - Decide on approach (native app vs shortcuts)
   - Create iOS app project
   - Implement sync service
   - Integrate with desktop app

## Resources

- [Apple UserNotifications Framework](https://developer.apple.com/documentation/usernotifications)
- [iOS Background Execution](https://developer.apple.com/documentation/backgroundtasks)
- [UNUserNotificationCenterDelegate](https://developer.apple.com/documentation/usernotifications/unusernotificationcenterdelegate)





