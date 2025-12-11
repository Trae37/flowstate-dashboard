# Step-by-Step Implementation Guide: Native Notification Monitoring

This guide walks you through implementing native notification monitoring for FlowState on **both Windows and macOS**. For iOS/iPadOS support, see `IOS_IMPLEMENTATION.md`.

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Xcode (for macOS/iOS development)
- Basic knowledge of C++/Objective-C (for native modules)

## Step 1: Install Required Dependencies

```bash
# Install native module dependencies
npm install --save-dev node-addon-api @electron/rebuild

# Install runtime dependencies (if not already installed)
npm install dbus-next ffi-napi ref-napi

# Install Electron rebuild tool globally (optional but recommended)
npm install -g @electron/rebuild
```

## Step 2: Create Native Module Directory Structure

```bash
# Create directory for native modules
mkdir -p src/main/native
cd src/main/native
```

Create the following structure:
```
src/main/native/
├── notification-monitor/
│   ├── binding.gyp          # Build configuration
│   ├── notification-monitor.cc    # C++ implementation
│   ├── notification-monitor.h     # Header file
│   └── package.json         # Module metadata
└── README.md                # Build instructions
```

## Step 3: Create Build Configuration (binding.gyp)

Create `src/main/native/notification-monitor/binding.gyp`:

```json
{
  "targets": [
    {
      "target_name": "notification-monitor",
      "sources": [
        "notification-monitor.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.14"
      },
      "conditions": [
        ["OS=='mac'", {
          "sources": [
            "notification-monitor-macos.mm"
          ],
          "frameworks": [
            "UserNotifications.framework",
            "Foundation.framework",
            "AppKit.framework"
          ]
        }],
        ["OS=='win'", {
          "sources": [
            "notification-monitor-windows.cc"
          ],
          "libraries": [
            "windowsapp.lib"
          ]
        }]
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
    }
  ]
}
```

## Step 4: Create Windows Implementation

Create `src/main/native/notification-monitor/notification-monitor-windows.cc` (already created - see file for full implementation).

**Key Points:**
- Uses Windows Runtime (WinRT) APIs
- Requires `UserNotificationListener` API (Windows 10 1809+)
- Needs user permission in Windows Settings
- Uses C++17 with WinRT

## Step 5: Create macOS Implementation

Create `src/main/native/notification-monitor/notification-monitor-macos.mm`:

```objc
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <AppKit/AppKit.h>
#include <napi.h>

// Notification Monitor Delegate
@interface NotificationMonitorDelegate : NSObject <UNUserNotificationCenterDelegate>
@property (nonatomic, strong) Napi::FunctionReference callback;
@property (nonatomic, strong) UNUserNotificationCenter *center;
- (instancetype)initWithCallback:(Napi::Function)callback env:(Napi::Env)env;
- (void)startMonitoring;
@end

@implementation NotificationMonitorDelegate

- (instancetype)initWithCallback:(Napi::Function)callback env:(Napi::Env)env {
    self = [super init];
    if (self) {
        self.callback = Napi::Persistent(callback);
        self.center = [UNUserNotificationCenter currentNotificationCenter];
        self.center.delegate = self;
    }
    return self;
}

- (void)startMonitoring {
    // Request notification permissions
    UNAuthorizationOptions options = UNAuthorizationOptionAlert | UNAuthorizationOptionSound;
    [self.center requestAuthorizationWithOptions:options
                                completionHandler:^(BOOL granted, NSError * _Nullable error) {
        if (granted) {
            NSLog(@"Notification permission granted");
        } else {
            NSLog(@"Notification permission denied: %@", error.localizedDescription);
        }
    }];
}

// This is called when a notification arrives while app is in foreground
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
    
    UNNotificationRequest *request = notification.request;
    UNNotificationContent *content = request.content;
    
    // Extract notification info
    NSString *appName = content.userInfo[@"appName"] ?: @"Unknown";
    NSString *title = content.title ?: @"";
    NSString *body = content.body ?: @"";
    
    // Call JavaScript callback
    Napi::Env env = self.callback.Env();
    Napi::Object notificationObj = Napi::Object::New(env);
    notificationObj.Set("appName", Napi::String::New(env, [appName UTF8String]));
    notificationObj.Set("title", Napi::String::New(env, [title UTF8String]));
    notificationObj.Set("body", Napi::String::New(env, [body UTF8String]));
    notificationObj.Set("timestamp", Napi::String::New(env, [[[NSDate date] ISO8601String] UTF8String]));
    
    self.callback.Call({notificationObj});
    
    // Show notification even when app is in foreground
    completionHandler(UNNotificationPresentationOptionAlert | UNNotificationPresentationOptionSound);
}

@end

// C++ Wrapper
class NotificationMonitor : public Napi::ObjectWrap<NotificationMonitor> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    NotificationMonitor(const Napi::CallbackInfo& info);
    ~NotificationMonitor();
    
private:
    static Napi::FunctionReference constructor;
    NotificationMonitorDelegate *delegate;
    Napi::FunctionReference callback;
    
    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
};

Napi::FunctionReference NotificationMonitor::constructor;

Napi::Object NotificationMonitor::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "NotificationMonitor", {
        InstanceMethod("start", &NotificationMonitor::Start),
        InstanceMethod("stop", &NotificationMonitor::Stop),
    });
    
    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();
    
    exports.Set("NotificationMonitor", func);
    return exports;
}

NotificationMonitor::NotificationMonitor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<NotificationMonitor>(info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return;
    }
    
    Napi::Function cb = info[0].As<Napi::Function>();
    this->callback = Napi::Persistent(cb);
    
    // Create delegate
    this->delegate = [[NotificationMonitorDelegate alloc] 
                       initWithCallback:cb 
                       env:env];
}

NotificationMonitor::~NotificationMonitor() {
    // Cleanup
}

Napi::Value NotificationMonitor::Start(const Napi::CallbackInfo& info) {
    [this->delegate startMonitoring];
    return info.Env().Undefined();
}

Napi::Value NotificationMonitor::Stop(const Napi::CallbackInfo& info) {
    // Stop monitoring
    return info.Env().Undefined();
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return NotificationMonitor::Init(env, exports);
}

NODE_API_MODULE(notification_monitor, Init)
```

## Step 6: Create TypeScript Wrapper

Create `src/main/native/notification-monitor-wrapper.ts`:

```typescript
/**
 * TypeScript wrapper for native notification monitor module
 */

let nativeModule: any = null;

export interface NotificationInfo {
  appName: string;
  title?: string;
  body?: string;
  timestamp: string;
}

export type NotificationCallback = (notification: NotificationInfo) => void;

/**
 * Load the native module
 */
async function loadNativeModule(): Promise<any> {
  if (nativeModule) {
    return nativeModule;
  }

  try {
    // Try to load the native module
    // Path will be different in dev vs production
    const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    const modulePath = isDev
      ? path.join(__dirname, '../../native/notification-monitor/build/Release/notification-monitor.node')
      : path.join(process.resourcesPath, 'native/notification-monitor.node');

    nativeModule = require(modulePath);
    return nativeModule;
  } catch (error) {
    console.error('[Native Module] Failed to load:', error);
    throw error;
  }
}

/**
 * Start monitoring notifications using native module
 */
export async function startNativeNotificationMonitoring(
  callback: NotificationCallback
): Promise<{ success: boolean; error?: string }> {
  try {
    const module = await loadNativeModule();
    const monitor = new module.NotificationMonitor((notification: NotificationInfo) => {
      callback(notification);
    });

    monitor.start();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Stop monitoring notifications
 */
export async function stopNativeNotificationMonitoring(): Promise<void> {
  // Implementation for stopping
}
```

## Step 7: Update package.json Scripts

Add build scripts to `package.json`:

```json
{
  "scripts": {
    "build:native": "cd src/main/native/notification-monitor && node-gyp rebuild",
    "rebuild:native": "electron-rebuild -f -w notification-monitor",
    "postinstall": "npm run build:native"
  }
}
```

## Step 8: Update Notification Monitor to Use Native Module

Update `src/main/notification-monitor-native.ts`:

```typescript
import { startNativeNotificationMonitoring } from './native/notification-monitor-wrapper.js';

export async function startNotificationMonitoring(callback: NotificationCallback): Promise<void> {
  if (isMonitoring) {
    logger.warn('[Notification Monitor] Already monitoring notifications');
    return;
  }

  notificationCallback = callback;
  isMonitoring = true;

  logger.info('[Notification Monitor] Starting native notification monitoring...');

  if (process.platform === 'darwin') {
    // Try native module first
    const result = await startNativeNotificationMonitoring(callback);
    if (result.success) {
      logger.info('[Notification Monitor] Native macOS monitoring started successfully');
      return;
    } else {
      logger.warn(`[Notification Monitor] Native module failed: ${result.error}`);
      logger.info('[Notification Monitor] Falling back to basic monitoring');
      startWindowFocusMonitoring();
    }
  } else if (process.platform === 'win32') {
    // Windows implementation
    startWindowsNativeMonitoring();
  } else if (process.platform === 'linux') {
    startLinuxNativeMonitoring();
  }
}
```

## Step 9: Build the Native Module

### Windows Build Requirements

1. **Visual Studio 2019+** with:
   - Desktop development with C++
   - Windows 10 SDK (10.0.19041.0 or later)
   - C++ CMake tools

2. **Windows SDK**:
   - Must support Windows Runtime (WinRT)
   - Version 10.0.19041.0 or later

### Build Commands (Windows)

```bash
# Install Windows Build Tools (if needed)
npm install --global windows-build-tools

# Navigate to module directory
cd src/main/native/notification-monitor

# Configure build
node-gyp configure

# Build the module
node-gyp build
```

### macOS Build Requirements

1. **Xcode** (latest version)
2. **Command Line Tools**: `xcode-select --install`
3. **macOS SDK** (included with Xcode)

### Build Commands (macOS)

```bash
# Navigate to module directory
cd src/main/native/notification-monitor

# Configure build
node-gyp configure

# Build the module
node-gyp build
```

```bash
# Install node-gyp globally (if not already installed)
npm install -g node-gyp

# Navigate to native module directory
cd src/main/native/notification-monitor

# Configure build
node-gyp configure

# Build the module
node-gyp build

# Or use npm script
npm run build:native
```

## Step 10: Handle Build Output

The built module will be at:
- Development: `src/main/native/notification-monitor/build/Release/notification-monitor.node`
- Production: Needs to be packaged with Electron

Update `electron-builder` config in `package.json`:

```json
{
  "build": {
    "extraFiles": [
      {
        "from": "src/main/native/notification-monitor/build/Release/notification-monitor.node",
        "to": "native/",
        "filter": ["**/*"]
      }
    ]
  }
}
```

## Step 11: Test the Implementation

### Windows Testing

1. **Build the module:**
   ```bash
   npm run build:native
   ```

2. **Grant permissions:**
   - Settings > Privacy > Notifications
   - Enable "Allow apps to access notifications"
   - Enable for FlowState

3. **Start the app:**
   ```bash
   npm run dev
   ```

4. **Test:**
   - Send yourself a Slack message
   - Send yourself a WhatsApp message
   - Verify FlowState shows the alert

### macOS Testing

1. **Build the module:**
   ```bash
   npm run build:native
   ```

2. **Grant permissions:**
   - System Preferences > Notifications > FlowState
   - Enable "Allow Notifications"

3. **Start the app:**
   ```bash
   npm run dev
   ```

4. **Test:**
   - Send yourself a Slack message
   - Send yourself a WhatsApp message
   - Verify FlowState shows the alert

1. **Build the module:**
   ```bash
   npm run build:native
   ```

2. **Start the app:**
   ```bash
   npm run dev
   ```

3. **Grant permissions:**
   - macOS will prompt for notification access
   - Go to System Preferences > Notifications > FlowState
   - Enable "Allow Notifications"

4. **Test:**
   - Send yourself a Slack message
   - Send yourself a WhatsApp message
   - Verify FlowState shows the alert

## Step 12: Handle Permission Requests

Add permission request UI in Settings page:

```typescript
// In Settings.tsx
const requestNotificationPermission = async () => {
  if (window.electronAPI?.requestNotificationPermission) {
    const result = await window.electronAPI.requestNotificationPermission();
    if (result.granted) {
      // Show success message
    } else {
      // Show instructions to enable in System Preferences
    }
  }
};
```

## Step 13: Error Handling & Fallbacks

Update the monitor to gracefully handle failures:

```typescript
export async function startNotificationMonitoring(callback: NotificationCallback): Promise<void> {
  try {
    // Try native first
    if (process.platform === 'darwin') {
      const result = await startNativeNotificationMonitoring(callback);
      if (result.success) {
        return; // Success!
      }
    }
  } catch (error) {
    logger.error('[Notification Monitor] Native module error:', error);
  }

  // Fallback to window focus monitoring
  logger.info('[Notification Monitor] Using fallback window focus monitoring');
  startWindowFocusMonitoring();
}
```

## Troubleshooting

### Build Errors

1. **"node-gyp not found":**
   ```bash
   npm install -g node-gyp
   ```

2. **"Xcode command line tools missing":**
   ```bash
   xcode-select --install
   ```

3. **"Module not found":**
   - Check the path in `notification-monitor-wrapper.ts`
   - Verify the `.node` file exists after build

### Runtime Errors

1. **"Permission denied":**
   - User must grant notification access
   - Check System Preferences > Notifications

2. **"Module load error":**
   - Rebuild for Electron: `npm run rebuild:native`
   - Check Electron version matches build target

## Next Steps

1. ✅ macOS implementation (this guide)
2. ⏭️ Windows implementation (UserNotificationListener API)
3. ⏭️ Linux implementation (D-Bus)
4. ⏭️ iOS/iPadOS (separate native app)

## Resources

- [Node Addon API Documentation](https://github.com/nodejs/node-addon-api)
- [Apple UserNotifications Framework](https://developer.apple.com/documentation/usernotifications)
- [Electron Native Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

