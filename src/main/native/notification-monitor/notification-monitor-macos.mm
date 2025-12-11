#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <AppKit/AppKit.h>
#include <napi.h>
#include <string>

// Forward declaration
class NotificationMonitor;

// Objective-C delegate for handling notifications
@interface NotificationMonitorDelegate : NSObject <UNUserNotificationCenterDelegate>
@property (nonatomic, assign) NotificationMonitor* cppInstance;
- (instancetype)initWithInstance:(NotificationMonitor*)instance;
- (void)startMonitoring;
- (void)stopMonitoring;
@end

// C++ class wrapper
class NotificationMonitor : public Napi::ObjectWrap<NotificationMonitor> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    NotificationMonitor(const Napi::CallbackInfo& info);
    ~NotificationMonitor();
    
    // Called from Objective-C delegate
    void OnNotificationReceived(const std::string& appName, 
                                const std::string& title, 
                                const std::string& body);
    
private:
    static Napi::FunctionReference constructor;
    NotificationMonitorDelegate* delegate_;
    Napi::FunctionReference callback_;
    
    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
};

// Implementation of Objective-C delegate
@implementation NotificationMonitorDelegate

- (instancetype)initWithInstance:(NotificationMonitor*)instance {
    self = [super init];
    if (self) {
        self.cppInstance = instance;
        UNUserNotificationCenter* center = [UNUserNotificationCenter currentNotificationCenter];
        center.delegate = self;
    }
    return self;
}

- (void)startMonitoring {
    UNUserNotificationCenter* center = [UNUserNotificationCenter currentNotificationCenter];
    
    // Request notification permissions
    UNAuthorizationOptions options = UNAuthorizationOptionAlert | UNAuthorizationOptionSound;
    [center requestAuthorizationWithOptions:options
                          completionHandler:^(BOOL granted, NSError * _Nullable error) {
        if (granted) {
            NSLog(@"[NotificationMonitor] Permission granted");
        } else {
            NSLog(@"[NotificationMonitor] Permission denied: %@", error.localizedDescription);
        }
    }];
    
    // Note: We can't directly monitor all notifications on macOS without
    // additional setup. This implementation focuses on receiving notifications
    // when they arrive while the app is running.
}

- (void)stopMonitoring {
    // Cleanup if needed
}

// Called when a notification arrives while app is in foreground
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
    
    UNNotificationRequest* request = notification.request;
    UNNotificationContent* content = request.content;
    
    // Extract notification info
    NSString* appIdentifier = notification.request.content.userInfo[@"appIdentifier"];
    NSString* appName = appIdentifier ?: @"Unknown";
    NSString* title = content.title ?: @"";
    NSString* body = content.body ?: @"";
    
    // Try to get app name from bundle identifier
    if (appIdentifier) {
        NSRunningApplication* app = [[NSRunningApplication runningApplicationsWithBundleIdentifier:appIdentifier] firstObject];
        if (app && app.localizedName) {
            appName = app.localizedName;
        }
    }
    
    // Call C++ callback
    if (self.cppInstance) {
        self.cppInstance->OnNotificationReceived(
            std::string([appName UTF8String]),
            std::string([title UTF8String]),
            std::string([body UTF8String])
        );
    }
    
    // Show notification even when app is in foreground
    completionHandler(UNNotificationPresentationOptionAlert | UNNotificationPresentationOptionSound);
}

@end

// C++ Implementation
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
    : Napi::ObjectWrap<NotificationMonitor>(info), delegate_(nullptr) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return;
    }
    
    Napi::Function cb = info[0].As<Napi::Function>();
    this->callback_ = Napi::Persistent(cb);
    
    // Create Objective-C delegate
    this->delegate_ = [[NotificationMonitorDelegate alloc] initWithInstance:this];
}

NotificationMonitor::~NotificationMonitor() {
    if (delegate_) {
        [delegate_ stopMonitoring];
        delegate_ = nullptr;
    }
}

void NotificationMonitor::OnNotificationReceived(const std::string& appName,
                                                  const std::string& title,
                                                  const std::string& body) {
    Napi::Env env = callback_.Env();
    Napi::HandleScope scope(env);
    
    try {
        Napi::Object notificationObj = Napi::Object::New(env);
        notificationObj.Set("appName", Napi::String::New(env, appName));
        notificationObj.Set("title", Napi::String::New(env, title));
        notificationObj.Set("body", Napi::String::New(env, body));
        
        // Get current timestamp
        NSDate* now = [NSDate date];
        NSISO8601DateFormatter* formatter = [[NSISO8601DateFormatter alloc] init];
        NSString* timestamp = [formatter stringFromDate:now];
        notificationObj.Set("timestamp", Napi::String::New(env, [timestamp UTF8String]));
        
        // Call JavaScript callback
        callback_.Call({notificationObj});
    } catch (const std::exception& e) {
        // Error handling
    }
}

Napi::Value NotificationMonitor::Start(const Napi::CallbackInfo& info) {
    if (delegate_) {
        [delegate_ startMonitoring];
    }
    return info.Env().Undefined();
}

Napi::Value NotificationMonitor::Stop(const Napi::CallbackInfo& info) {
    if (delegate_) {
        [delegate_ stopMonitoring];
    }
    return info.Env().Undefined();
}

// Override Init to use our implementation
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return NotificationMonitor::Init(env, exports);
}

NODE_API_MODULE(notification_monitor, Init)





