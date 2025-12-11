# Phone App Architecture & Implementation Plan

## Overview

FlowState needs a companion mobile app (iOS/Android) that:
1. Monitors notifications on the phone (Slack, WhatsApp, text messages, etc.)
2. Sends notifications to the desktop app via a sync service
3. Desktop app automatically captures workspace when phone notifications arrive

## Architecture

```
┌─────────────────┐         ┌──────────────┐         ┌─────────────────┐
│  FlowState      │◄───────►│  Sync Service │◄───────►│  FlowState      │
│  Desktop (Win) │         │  (Backend)    │         │  Mobile (iOS)   │
└─────────────────┘         └──────────────┘         └─────────────────┘
      │                            │                            │
      │                            │                            │
      ▼                            ▼                            ▼
  Auto-capture              Store notifications          Monitor notifications
  workspace                Queue for desktop            Send to sync service
```

## Implementation Phases

### Phase 1: Sync Service (Backend)

Create a backend service that:
- Receives notifications from mobile app
- Stores them in a queue per user
- Desktop app polls for pending notifications
- Handles authentication and pairing

**Technology Options:**
- Node.js/Express (matches desktop stack)
- Firebase Realtime Database (easy sync)
- Supabase (PostgreSQL with real-time)
- Custom REST API

### Phase 2: iOS App

Create native iOS app that:
- Monitors notifications using `UNUserNotificationCenter`
- Sends to sync service when notification arrives
- Handles pairing with desktop app
- Manages authentication

### Phase 3: Desktop Integration

Update desktop app to:
- Poll sync service for notifications
- Automatically capture workspace when notification arrives
- Show alert to user
- Handle pairing/authentication

## Detailed Implementation

### Step 1: Create Sync Service API

**Endpoints Needed:**

1. **POST /api/auth/pair** - Pair phone with desktop
   ```json
   {
     "deviceId": "desktop-uuid",
     "deviceType": "desktop",
     "userId": 123
   }
   ```

2. **POST /api/notifications** - Phone sends notification
   ```json
   {
     "userId": 123,
     "deviceId": "phone-uuid",
     "appName": "slack",
     "title": "New message",
     "body": "Message content",
     "timestamp": "2025-11-28T22:00:00Z"
   }
   ```

3. **GET /api/notifications/pending** - Desktop polls for notifications
   ```
   GET /api/notifications/pending?userId=123&deviceId=desktop-uuid
   Response: {
     "notifications": [
       {
         "id": 1,
         "appName": "slack",
         "title": "New message",
         "body": "Message content",
         "timestamp": "2025-11-28T22:00:00Z"
       }
     ]
   }
   ```

4. **POST /api/notifications/ack** - Desktop acknowledges receipt
   ```
   POST /api/notifications/ack
   Body: { "notificationIds": [1, 2, 3] }
   ```

### Step 2: iOS App Structure

**Xcode Project Setup:**
```
FlowStateMobile/
├── App/
│   ├── AppDelegate.swift
│   ├── SceneDelegate.swift
│   └── ContentView.swift
├── Services/
│   ├── NotificationMonitor.swift
│   ├── SyncServiceClient.swift
│   └── PairingManager.swift
├── Models/
│   ├── Notification.swift
│   └── Device.swift
└── Info.plist
```

**Key Components:**

1. **NotificationMonitor.swift**
   ```swift
   import UserNotifications
   
   class NotificationMonitor: NSObject, UNUserNotificationCenterDelegate {
       var onNotification: ((Notification) -> Void)?
       let syncService = SyncServiceClient()
       
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
           let appName = getAppName(from: notification)
           
           // Create notification object
           let notificationObj = Notification(
               appName: appName,
               title: content.title,
               body: content.body,
               timestamp: Date()
           )
           
           // Send to sync service
           syncService.sendNotification(notificationObj)
           
           // Call callback if needed
           onNotification?(notificationObj)
           
           completionHandler([.alert, .sound])
       }
       
       private func getAppName(from notification: UNNotification) -> String {
           // Extract app name from notification
           // Check userInfo or bundle identifier
           if let bundleId = notification.request.content.userInfo["appBundleId"] as? String {
               return getAppDisplayName(from: bundleId)
           }
           return "Unknown"
       }
   }
   ```

2. **SyncServiceClient.swift**
   ```swift
   import Foundation
   
   class SyncServiceClient {
       private let baseURL = "https://api.flowstate.app" // Or your backend URL
       private let userId: Int
       private let deviceId: String
       
       init(userId: Int, deviceId: String) {
           self.userId = userId
           self.deviceId = deviceId
       }
       
       func sendNotification(_ notification: Notification) {
           let url = URL(string: "\(baseURL)/api/notifications")!
           var request = URLRequest(url: url)
           request.httpMethod = "POST"
           request.setValue("application/json", forHTTPHeaderField: "Content-Type")
           
           let body: [String: Any] = [
               "userId": userId,
               "deviceId": deviceId,
               "appName": notification.appName,
               "title": notification.title ?? "",
               "body": notification.body ?? "",
               "timestamp": ISO8601DateFormatter().string(from: notification.timestamp)
           ]
           
           request.httpBody = try? JSONSerialization.data(withJSONObject: body)
           
           URLSession.shared.dataTask(with: request) { data, response, error in
               if let error = error {
                   print("Error sending notification: \(error)")
               }
           }.resume()
       }
       
       func pairWithDesktop(desktopCode: String, completion: @escaping (Bool) -> Void) {
           // Implement pairing logic
       }
   }
   ```

### Step 3: Update Desktop App

**Add Sync Service Integration:**

1. **Create sync service client** (`src/main/sync-service-client.ts`):
   ```typescript
   export interface SyncServiceConfig {
     baseUrl: string;
     userId: number;
     deviceId: string;
   }
   
   export async function pollPhoneNotifications(
     config: SyncServiceConfig
   ): Promise<Array<{ appName: string; title?: string; body?: string; timestamp: string }>> {
     const response = await fetch(
       `${config.baseUrl}/api/notifications/pending?userId=${config.userId}&deviceId=${config.deviceId}`
     );
     const data = await response.json();
     return data.notifications || [];
   }
   ```

2. **Update notification monitoring** to use sync service (already done in main.ts)

3. **Add pairing UI** in Settings page

### Step 4: Pairing Flow

**User Experience:**

1. User opens FlowState desktop app
2. Goes to Settings > Phone Pairing
3. Generates pairing code (QR code or 6-digit code)
4. User opens FlowState mobile app
5. Enters pairing code or scans QR code
6. Apps are now paired and syncing

**Implementation:**

- Desktop generates pairing token
- Stores in database with expiration
- Mobile app sends token to sync service
- Sync service links devices
- Both apps can now communicate

## Technology Stack Recommendations

### Backend/Sync Service
- **Option 1**: Node.js + Express + PostgreSQL
  - Matches desktop stack
  - Full control
  - Need to host yourself

- **Option 2**: Firebase Realtime Database
  - Easy real-time sync
  - Built-in authentication
  - Free tier available

- **Option 3**: Supabase
  - PostgreSQL with real-time
  - Built-in auth
  - Good free tier

### iOS App
- **Language**: Swift
- **Framework**: SwiftUI (modern) or UIKit
- **Notifications**: UNUserNotificationCenter
- **Networking**: URLSession or Alamofire

### Desktop Integration
- Already using Electron/TypeScript
- Add sync service client
- Poll for notifications
- Trigger captures

## Security Considerations

1. **Authentication**: 
   - User must be logged in on both devices
   - Pairing requires authentication
   - Use secure tokens

2. **Encryption**:
   - Encrypt notification data in transit (HTTPS)
   - Consider end-to-end encryption for sensitive data

3. **Privacy**:
   - Only send notification metadata (app name, title, body)
   - Don't send full message content if sensitive
   - User can disable specific apps

## Implementation Priority

1. ✅ **Desktop notification monitoring** (already done)
2. ⏭️ **Sync service backend** (next step)
3. ⏭️ **iOS app** (after backend)
4. ⏭️ **Pairing system** (with iOS app)
5. ⏭️ **Desktop integration** (final step)

## Quick Start: Sync Service

For a quick MVP, you could use:

1. **Firebase Realtime Database** (easiest)
   - Set up Firebase project
   - Create database structure
   - Mobile app writes notifications
   - Desktop app listens for changes

2. **Simple REST API** (more control)
   - Node.js + Express
   - PostgreSQL or SQLite
   - REST endpoints
   - Polling from desktop

## Next Steps

1. **Choose sync service technology**
2. **Set up backend/API**
3. **Create iOS app project**
4. **Implement notification monitoring in iOS**
5. **Implement pairing flow**
6. **Update desktop to poll sync service**
7. **Test end-to-end flow**

See `SYNC_SERVICE_IMPLEMENTATION.md` for detailed backend setup.





