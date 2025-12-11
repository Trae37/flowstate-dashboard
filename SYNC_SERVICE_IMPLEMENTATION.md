# Sync Service Implementation Guide

## Overview

The sync service is a backend API that connects the FlowState mobile app with the desktop app, allowing phone notifications to trigger workspace captures on the desktop.

## Quick Start: Firebase (Easiest Option)

### Step 1: Set Up Firebase

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create new project: "FlowState Sync"
3. Enable Realtime Database
4. Get configuration credentials

### Step 2: Database Structure

```
flowstate-sync/
├── users/
│   └── {userId}/
│       ├── devices/
│       │   ├── {deviceId}/
│       │   │   ├── type: "desktop" | "mobile"
│       │   │   ├── pairedAt: timestamp
│       │   │   └── lastSeen: timestamp
│       └── notifications/
│           └── {notificationId}/
│               ├── appName: string
│               ├── title: string
│               ├── body: string
│               ├── timestamp: string
│               ├── deviceId: string (source)
│               ├── delivered: boolean
│               └── createdAt: timestamp
```

### Step 3: Desktop App Integration

Add Firebase SDK to desktop app:

```bash
npm install firebase
```

Create `src/main/sync-service-firebase.ts`:

```typescript
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, push, set, query, orderByChild, equalTo, limitToLast } from 'firebase/database';

const firebaseConfig = {
  // Your Firebase config
  apiKey: "...",
  authDomain: "...",
  databaseURL: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

export async function setupFirebaseSync(userId: number, deviceId: string) {
  // Listen for new notifications
  const notificationsRef = ref(database, `users/${userId}/notifications`);
  const notificationsQuery = query(
    notificationsRef,
    orderByChild('delivered'),
    equalTo(false),
    limitToLast(10)
  );
  
  onValue(notificationsQuery, (snapshot) => {
    const notifications = snapshot.val();
    if (notifications) {
      Object.values(notifications).forEach((notification: any) => {
        // Only process notifications from mobile devices
        if (notification.deviceId !== deviceId) {
          handlePhoneNotification(userId, notification);
          
          // Mark as delivered
          set(ref(database, `users/${userId}/notifications/${notification.id}/delivered`), true);
        }
      });
    }
  });
}

function handlePhoneNotification(userId: number, notification: any) {
  // Trigger capture (already implemented in main.ts)
}
```

## Alternative: Custom REST API

### Step 1: Create Backend Service

**Project Structure:**
```
flowstate-sync-service/
├── src/
│   ├── server.ts
│   ├── routes/
│   │   ├── notifications.ts
│   │   ├── pairing.ts
│   │   └── auth.ts
│   ├── models/
│   │   ├── Notification.ts
│   │   └── Device.ts
│   └── database/
│       └── db.ts
├── package.json
└── tsconfig.json
```

### Step 2: Implement API Endpoints

**src/routes/notifications.ts:**
```typescript
import express from 'express';
import { db } from '../database/db';

const router = express.Router();

// Phone sends notification
router.post('/', async (req, res) => {
  const { userId, deviceId, appName, title, body, timestamp } = req.body;
  
  // Store notification
  const notification = await db.notifications.create({
    userId,
    deviceId,
    appName,
    title,
    body,
    timestamp,
    delivered: false,
    createdAt: new Date()
  });
  
  res.json({ success: true, id: notification.id });
});

// Desktop polls for notifications
router.get('/pending', async (req, res) => {
  const { userId, deviceId } = req.query;
  
  // Get undelivered notifications for this user
  // Exclude notifications from the same device (desktop)
  const notifications = await db.notifications.findMany({
    where: {
      userId: Number(userId),
      delivered: false,
      deviceId: { not: deviceId } // Exclude desktop's own notifications
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  
  res.json({ notifications });
});

// Mark notifications as delivered
router.post('/ack', async (req, res) => {
  const { notificationIds } = req.body;
  
  await db.notifications.updateMany({
    where: { id: { in: notificationIds } },
    data: { delivered: true }
  });
  
  res.json({ success: true });
});

export default router;
```

### Step 3: Update Desktop App

**src/main/sync-service-client.ts:**
```typescript
export interface SyncServiceConfig {
  baseUrl: string;
  userId: number;
  deviceId: string;
  apiKey?: string;
}

export interface PhoneNotification {
  id: number;
  appName: string;
  title?: string;
  body?: string;
  timestamp: string;
}

export async function pollPhoneNotifications(
  config: SyncServiceConfig
): Promise<PhoneNotification[]> {
  try {
    const response = await fetch(
      `${config.baseUrl}/api/notifications/pending?userId=${config.userId}&deviceId=${config.deviceId}`,
      {
        headers: {
          'Authorization': config.apiKey ? `Bearer ${config.apiKey}` : '',
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Sync service error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.notifications || [];
  } catch (error) {
    console.error('[Sync Service] Error polling notifications:', error);
    return [];
  }
}

export async function acknowledgeNotifications(
  config: SyncServiceConfig,
  notificationIds: number[]
): Promise<void> {
  try {
    await fetch(`${config.baseUrl}/api/notifications/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': config.apiKey ? `Bearer ${config.apiKey}` : '',
      },
      body: JSON.stringify({ notificationIds })
    });
  } catch (error) {
    console.error('[Sync Service] Error acknowledging notifications:', error);
  }
}
```

## Update Desktop App to Use Sync Service

Update `src/main/main.ts` to actually poll the sync service:

```typescript
async function pollPhoneNotifications(): Promise<void> {
  const users = prepare('SELECT id FROM users').all() as { id: number }[];
  
  for (const user of users) {
    const userId = user.id;
    const userSettings = getAllSettings(userId);
    const autoSaveEnabled = userSettings.autoSaveEnabled === 'true';
    const notificationCaptureEnabled = userSettings.notificationCaptureEnabled !== 'false';
    const syncServiceUrl = userSettings.syncServiceUrl; // User's sync service URL
    
    if (!autoSaveEnabled || !notificationCaptureEnabled || !syncServiceUrl) {
      continue;
    }
    
    // Get device ID (generate and store if not exists)
    let deviceId = userSettings.desktopDeviceId;
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      // Save to settings
      const { setSetting } = await import('./database.js');
      setSetting('desktopDeviceId', deviceId, userId);
    }
    
    // Poll sync service
    const { pollPhoneNotifications, acknowledgeNotifications } = await import('./sync-service-client.js');
    const notifications = await pollPhoneNotifications({
      baseUrl: syncServiceUrl,
      userId,
      deviceId
    });
    
    // Process each notification
    const notificationIds: number[] = [];
    for (const notification of notifications) {
      await handlePhoneNotification(userId, notification, lastCaptureTime, lastNotificationTime);
      notificationIds.push(notification.id);
    }
    
    // Acknowledge notifications
    if (notificationIds.length > 0) {
      await acknowledgeNotifications({
        baseUrl: syncServiceUrl,
        userId,
        deviceId
      }, notificationIds);
    }
  }
}
```

## Next Steps

1. **Choose sync service** (Firebase or custom API)
2. **Set up backend** (if custom)
3. **Create iOS app** (see `PHONE_APP_ARCHITECTURE.md`)
4. **Implement pairing** (QR code or manual code)
5. **Test end-to-end** (phone → sync → desktop → capture)

## Testing Without Phone App

You can test the desktop integration by manually sending notifications to the sync service:

```bash
# Using curl
curl -X POST https://your-sync-service.com/api/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "deviceId": "test-phone",
    "appName": "slack",
    "title": "Test Message",
    "body": "This is a test",
    "timestamp": "2025-11-28T22:00:00Z"
  }'
```

The desktop app should pick it up on the next poll and trigger a capture.





